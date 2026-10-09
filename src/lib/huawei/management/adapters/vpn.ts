import "server-only";
import { isIP } from "node:net";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { HuaweiApiError, huaweiFetch as nativeFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listEipsForProject } from "@/lib/huawei/services/eip";
import { listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import type { ManagementAdapter } from "../types";

/*
 * Native v5 S2C VPN verified subset, checked against the current international API reference
 * (vpn_api_0027 connection create, updated 2025-12-31; vpn_api_0014 gateway create,
 * vpn_api_0016 gateway list, vpn_api_0019 availability zones, and vpn_api_0021 customer
 * gateway create, updated 2025-11-13):
 * - Public connection vgw_ip is the EIP ID (UUID) of the gateway's eip1/eip2, never the
 *   ip_address; private-network gateways would use private IPs but are out of scope here.
 * - IKE/IPsec values are native lowercase: ike_version v1/v2, sha2-256-family authentication,
 *   aes-*-family encryption, groupN DH/PFS groups, transform_protocol esp, tunnel mode.
 * - peer_subnets is mandatory for IPv4 VPC-attached gateways for every style (policy, static,
 *   and BGP); only IPv6 or ER-attached policy/BGP gateways are exempt. Max 50 peer subnets.
 * - Policy style: max 5 policy_rules, each with a unique single-CIDR source and max 50
 *   destinations; rule_index is deprecated and never sent.
 * - Tunnel addresses are optional (auto-allocated), but when provided both must be
 *   169.254.x.x/30 host addresses of the same /30 block, excluding 169.254.195.x.
 * - Active-standby gateways require ha_role master on eip1 connections and slave on eip2.
 * - The v5 gateway create API exposes no prepaid order envelope, so API-created gateways are
 *   pay-per-use; EIP charge_mode/bandwidth fields only apply to newly created EIPs, which
 *   this draft never issues (existing unbound EIP ids are bound only).
 * Deliberate gaps of this draft (advanced features not typed here):
 * - ER-attached gateways (attachment_type "er", er_id), IPv6 (ip_version "ipv6",
 *   local_subnets_v6, peer_subnets_v6, policy_rules_v6), private network gateways
 *   (network_type "private", access_vpc_id/access_subnet_id/access_private_ip_1/2), the GM
 *   flavor (certificate-based IKE with digital-envelope-v2 authentication; the preshared-key
 *   schema of this draft does not apply to it), Professional1/2-NonFixedIP flavors, the
 *   policy-template style, tags, gateway policy templates, specification change routes,
 *   gateway certificates, connection monitors, NQA/health-check/hub flags, connection log
 *   routes, quotas, resource tag routes, batch connection create, and the P2C family.
 * - The peer-configuration export route returns the full peer device configuration including
 *   the preshared key, so it is not surfaced; peer settings are managed through the native
 *   IKE/IPsec policy and preshared key fields.
 * - Classic (v2) site-to-site schemas are not mixed in; only v5 routes are called.
 */

async function huaweiFetch<T>(session: BetterUiSession, service: "vpn", path: string, init?: RequestInit): Promise<T> {
  try {
    const body = await nativeFetch<T>(session, service, path, init), row = asRecord(body);
    if (row.error_code !== undefined && String(row.error_code) !== "0") throw new HuaweiApiError("Huawei rejected this VPN request.", 502);
    return body;
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected this VPN request.", error.status);
    throw new Error("Huawei returned an unverifiable VPN response. Check native state before retrying.");
  }
}
async function huaweiList<T>(session: BetterUiSession, service: "vpn", path: string, pagination: Pagination): Promise<T> {
  return collectList(cursor => { const url = new URL(path, "https://local.invalid"); if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor)); return huaweiFetch<T>(session, service, url.pathname + url.search); }, pagination);
}

const root = (session: BetterUiSession) => `/v5/${session.projectId}`;
const gatewayPrefix = "gateway:";
const cgwPrefix = "cgw:";
const connectionPrefix = "connection:";
const gatewayStable = ["ACTIVE"];
const connectionStable = ["NORMAL"];
const ikeVersions = ["v1", "v2"];
const authAlgorithms = ["sha2-512", "sha2-384", "sha2-256", "sha1", "md5"];
const encryptionAlgorithms = ["aes-256-gcm-16", "aes-128-gcm-16", "aes-256", "aes-192", "aes-128", "3des"];
const dhGroups = ["group1", "group2", "group5", "group14", "group15", "group16", "group19", "group20", "group21"];
const pfsChoices = [...dhGroups, "disable"];
const styles = ["policy", "static", "bgp"];
const haModes = ["active-active", "active-standby"];
const maxLocalSubnets = 50;
const maxPolicyRules = 5;
const maxPeerSubnets = 50;
/* Explicit catalog-key to native flavor mapping; gm and the NonFixedIP variants are not
 * offered because this draft only creates preshared-key IPv4 VPC gateways. */
const catalogFlavors: Record<string, string> = { basic: "Basic", professional1: "Professional1", professional2: "Professional2" };
const nameField: ManagementField = { key: "name", label: "Name", required: true, min: 1, max: 64, pattern: "^[A-Za-z0-9_.-]{1,64}$", help: "1-64 characters: letters, digits, underscores, hyphens, and periods." };
const pskField: ManagementField = { key: "psk", label: "Preshared key", type: "password", required: true, min: 8, max: 128, help: "8-128 characters combining at least three of lowercase, uppercase, digits, and the special characters ~!@#$%^*()-_+={} ,./:; . Never re-enter a masked value." };
const enterpriseProjectField: ManagementField = { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0", pattern: "^(?:0|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$", help: "The default enterprise project (0) or an enterprise project UUID." };
const ikeFields: ManagementField[] = [
  { key: "ikeVersion", label: "IKE version", type: "select", required: true, defaultValue: "v2", choices: ikeVersions.map((value) => ({ value, label: value })) },
  { key: "ikeAuthentication", label: "IKE authentication algorithm", type: "select", required: true, defaultValue: "sha2-256", choices: authAlgorithms.map((value) => ({ value, label: value })) },
  { key: "ikeEncryption", label: "IKE encryption algorithm", type: "select", required: true, defaultValue: "aes-128", choices: encryptionAlgorithms.map((value) => ({ value, label: value })) },
  { key: "ikeDhGroup", label: "IKE DH group", type: "select", required: true, defaultValue: "group15", choices: dhGroups.map((value) => ({ value, label: value })) },
  { key: "ikeLifetime", label: "IKE lifetime (seconds)", type: "number", required: true, min: 60, max: 604800, defaultValue: 86400 },
];
const ipsecFields: ManagementField[] = [
  { key: "ipsecAuthentication", label: "IPsec authentication algorithm", type: "select", required: true, defaultValue: "sha2-256", choices: authAlgorithms.map((value) => ({ value, label: value })) },
  { key: "ipsecEncryption", label: "IPsec encryption algorithm", type: "select", required: true, defaultValue: "aes-128", choices: encryptionAlgorithms.map((value) => ({ value, label: value })) },
  { key: "ipsecPfs", label: "IPsec PFS group", type: "select", required: true, defaultValue: "group15", choices: pfsChoices.map((value) => ({ value, label: value })) },
  { key: "ipsecLifetime", label: "IPsec lifetime (seconds)", type: "number", required: true, min: 30, max: 604800, defaultValue: 3600 },
];

function rowsOf(body: Record<string, unknown>, key: string, kind: string) {
  const rows = body[key];
  if (!Array.isArray(rows)) throw new Error(`Huawei returned an invalid VPN ${kind} list.`);
  const records = rows.map(asRecord);
  const ids = records.map((row) => asString(row.id, ""));
  if (ids.some((id) => !id)) throw new Error(`Huawei returned an invalid VPN ${kind} list.`);
  if (new Set(ids).size !== ids.length) throw new Error(`Huawei returned a VPN ${kind} list with duplicate IDs.`);
  return records;
}

function assertOwned(record: Record<string, unknown>, session: BetterUiSession, kind: string) {
  if (record.project_id !== undefined && record.project_id !== session.projectId) throw new ManagementInputError(`Huawei returned a ${kind} that belongs to another project.`, 404);
}

async function fetchVgws(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "vpn", `${root(session)}/vpn-gateways`);
  const rows = rowsOf(body, "vpn_gateways", "gateway");
  rows.forEach(row => assertOwned(row, session, "gateway"));
  return rows;
}

async function fetchCgws(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "vpn", `${root(session)}/customer-gateways?limit=2000`, { items: ["customer_gateways"], kind: "marker", parameter: "marker", size: 2000, next: ["page_info.next_marker"] });
  const rows = rowsOf(body, "customer_gateways", "customer gateway");
  rows.forEach(row => assertOwned(row, session, "customer gateway"));
  return rows;
}

async function fetchConnections(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "vpn", `${root(session)}/vpn-connection?limit=2000`, { items: ["vpn_connections"], kind: "marker", parameter: "marker", size: 2000, next: ["page_info.next_marker"] });
  const rows = rowsOf(body, "vpn_connections", "connection");
  rows.forEach(row => assertOwned(row, session, "connection"));
  if (rows.some(row => typeof row.vgw_id !== "string" || !row.vgw_id || typeof row.cgw_id !== "string" || !row.cgw_id)) throw new ManagementInputError("Huawei returned a VPN connection without verified parent identities.", 409);
  return rows;
}

async function fetchVgw(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "vpn", `${root(session)}/vpn-gateways/${encodeURIComponent(id)}`);
  const record = asRecord(body.vpn_gateway);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("Huawei returned a different VPN gateway.", 404);
  assertOwned(record, session, "VPN gateway");
  return record;
}

async function fetchCgw(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "vpn", `${root(session)}/customer-gateways/${encodeURIComponent(id)}`);
  const record = asRecord(body.customer_gateway);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("Huawei returned a different customer gateway.", 404);
  assertOwned(record, session, "customer gateway");
  return record;
}

async function fetchConnection(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "vpn", `${root(session)}/vpn-connection/${encodeURIComponent(id)}`);
  const record = asRecord(body.vpn_connection);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("Huawei returned a different VPN connection.", 404);
  assertOwned(record, session, "VPN connection");
  return record;
}

async function availabilityCatalog(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "vpn", `${root(session)}/vpn-gateways/availability-zones`);
  const zonesByFlavor = asRecord(body.availability_zones);
  const flavors = Object.entries(catalogFlavors).flatMap(([key, flavor]) => {
    const zones = (() => { const row = zonesByFlavor[key]; if (row === undefined) return []; const zones = asRecord(row).vpc; if (!Array.isArray(zones) || zones.some(zone => typeof zone !== "string" || !zone) || new Set(zones).size !== zones.length) throw new ManagementInputError("Huawei returned an incomplete VPN zone catalog.", 409); return zones as string[]; })();
    return zones.length ? [{ flavor, zones }] : [];
  });
  if (!flavors.length) throw new Error("Huawei returned no VPN gateway availability zones for VPC attachment.");
  return { flavors, zones: [...new Set(flavors.flatMap((entry) => entry.zones))] };
}

function parseKind(resource: ManagementResource | undefined, prefix: string, label: string) {
  if (!resource?.id.startsWith(prefix)) throw new ManagementInputError(`Select a current ${label}.`);
  const id = resource.id.slice(prefix.length);
  if (!id) throw new ManagementInputError(`Select a current ${label}.`);
  return id;
}

function assertStatus(record: Record<string, unknown>, allowed: string[], label: string) {
  const status = firstString([record.status], "");
  if (!allowed.includes(status)) throw new ManagementInputError(`The ${label} is not in a verified state for this operation. Wait for a stable state before retrying.`, 409);
}

/* The framework already enforces exact-name confirmation against the inventory name; this
 * fresh compare guarantees the confirmed name still matches the live cloud record. */
function assertFreshName(resource: ManagementResource, record: Record<string, unknown>, label: string) {
  if (resource.name !== firstString([record.name], "")) throw new ManagementInputError(`The ${label} was renamed or the selection is stale. Refresh the list and confirm the current name.`, 409);
}

function cidrInt(octets: number[]) {
  return ((octets[0] * 2 ** 24) + (octets[1] * 2 ** 16) + (octets[2] * 2 ** 8) + octets[3]) >>> 0;
}

const reservedPeerBlocks: Array<[number[], number]> = [[[100, 64, 0, 0], 10], [[214, 0, 0, 0], 8]];

function cidrList(value: unknown, label: string, options: { max?: number; reserved?: boolean } = {}) {
  const items = String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!items.length) throw new ManagementInputError(`${label} is required.`);
  const cidrs = [...new Set(items)];
  for (const cidr of cidrs) {
    const [address, prefix, extra] = cidr.split("/");
    if (extra !== undefined || isIP(address ?? "") !== 4 || !/^\d{1,2}$/.test(prefix ?? "") || Number(prefix) > 32) throw new ManagementInputError(`${label} must be a list of IPv4 CIDR blocks such as 192.168.0.0/16.`);
    if (options.reserved) {
      const octets = address.split(".").map(Number);
      for (const [base, bits] of reservedPeerBlocks) {
        if (Number(prefix) >= bits && (cidrInt(octets) >>> (32 - bits)) === (cidrInt(base) >>> (32 - bits))) throw new ManagementInputError(`${label} cannot use the reserved CIDR block ${base.join(".")} /${bits}.`);
      }
    }
  }
  if (options.max !== undefined && cidrs.length > options.max) throw new ManagementInputError(`${label} accepts at most ${options.max} CIDR blocks.`);
  return cidrs;
}

function optionalCidrList(value: unknown, label: string, options: { max?: number } = {}) {
  const text = String(value ?? "").trim();
  return text ? cidrList(text, label, options) : [];
}

function ipv4Address(value: unknown, label: string) {
  const address = String(value ?? "").trim();
  if (!address) throw new ManagementInputError(`${label} is required.`);
  if (isIP(address) !== 4) throw new ManagementInputError(`${label} must be an IPv4 address in dotted decimal notation.`);
  return address;
}

function tunnelHost(text: string, label: string) {
  const [address, prefix, extra] = text.split("/");
  if (extra !== undefined || prefix !== "30" || isIP(address ?? "") !== 4) throw new ManagementInputError(`${label} must be a link-local address with a /30 mask, such as 169.254.56.225/30.`);
  const octets = address.split(".").map(Number);
  if (octets[0] !== 169 || octets[1] !== 254) throw new ManagementInputError(`${label} must start with 169.254.`);
  if (octets[2] === 195) throw new ManagementInputError(`${label} cannot use the reserved 169.254.195.x range.`);
  return octets;
}

/* Both addresses are optional (the cloud allocates them), but when one is provided both must
 * be the two usable host addresses of the same 169.254.x.x/30 block. */
function tunnelAddressPair(localValue: unknown, peerValue: unknown) {
  const local = String(localValue ?? "").trim();
  const peer = String(peerValue ?? "").trim();
  if (!local && !peer) return [];
  if (!local || !peer) throw new ManagementInputError("Provide both tunnel addresses or leave both empty; the cloud allocates them automatically when omitted.");
  const localOctets = tunnelHost(local, "Tunnel local address");
  const peerOctets = tunnelHost(peer, "Tunnel peer address");
  const block = (octets: number[]) => (octets[2] << 8) | (octets[3] & 0xfc);
  if (block(localOctets) !== block(peerOctets)) throw new ManagementInputError("Both tunnel addresses must be host addresses of the same /30 block.");
  const localHost = localOctets[3] & 3;
  const peerHost = peerOctets[3] & 3;
  if (localHost === peerHost || ![1, 2].includes(localHost) || ![1, 2].includes(peerHost)) throw new ManagementInputError("The tunnel addresses must be the two usable host addresses of the /30 block, not its network or broadcast address.");
  return [local, peer];
}

function assertPsk(value: string) {
  if (value.length < 8 || value.length > 128) throw new ManagementInputError("The preshared key must be 8 to 128 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The preshared key must combine at least three of lowercase letters, uppercase letters, digits, and special characters.");
  if (!/^[A-Za-z0-9~!@#$%^*()_+={}.,:;\-\/]+$/.test(value)) throw new ManagementInputError("The preshared key uses characters outside the supported set (~!@#$%^*()-_+={} ,./:;).");
}

function parseGatewayChoice(value: unknown): [string, string] {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { throw new ManagementInputError("Select a current gateway and gateway EIP."); }
  if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((item) => typeof item !== "string" || !item)) throw new ManagementInputError("Select a current gateway and gateway EIP.");
  return [parsed[0], parsed[1]];
}

function assertChoice(value: string, choices: string[], label: string) {
  if (!choices.includes(value)) throw new ManagementInputError(`Select a supported ${label}.`);
}

function ikeBody(values: ManagementValues) {
  const lifetime = Number(values.ikeLifetime);
  if (!Number.isSafeInteger(lifetime) || lifetime < 60 || lifetime > 604800) throw new ManagementInputError("The IKE lifetime must be 60 to 604800 seconds.");
  const version = String(values.ikeVersion);
  assertChoice(version, ikeVersions, "IKE version");
  assertChoice(String(values.ikeAuthentication), authAlgorithms, "IKE authentication algorithm");
  assertChoice(String(values.ikeEncryption), encryptionAlgorithms, "IKE encryption algorithm");
  assertChoice(String(values.ikeDhGroup), dhGroups, "IKE DH group");
  return {
    ike_version: version,
    /* The negotiation mode is mandatory for IKEv1 and defaults to main in the native API. */
    ...(version === "v1" ? { phase1_negotiation_mode: "main" } : {}),
    authentication_algorithm: String(values.ikeAuthentication),
    encryption_algorithm: String(values.ikeEncryption),
    dh_group: String(values.ikeDhGroup),
    lifetime_seconds: lifetime,
  };
}

function ipsecBody(values: ManagementValues) {
  const lifetime = Number(values.ipsecLifetime);
  if (!Number.isSafeInteger(lifetime) || lifetime < 30 || lifetime > 604800) throw new ManagementInputError("The IPsec lifetime must be 30 to 604800 seconds.");
  assertChoice(String(values.ipsecAuthentication), authAlgorithms, "IPsec authentication algorithm");
  assertChoice(String(values.ipsecEncryption), encryptionAlgorithms, "IPsec encryption algorithm");
  assertChoice(String(values.ipsecPfs), pfsChoices, "IPsec PFS group");
  return { authentication_algorithm: String(values.ipsecAuthentication), encryption_algorithm: String(values.ipsecEncryption), pfs: String(values.ipsecPfs), transform_protocol: "esp", lifetime_seconds: lifetime, encapsulation_mode: "tunnel" };
}

function unboundEips(rows: Awaited<ReturnType<typeof listEipsForProject>>) {
  return rows.filter((ip) => ip.ipVersion === "4" && ip.status === "DOWN" && ["", "-"].includes(ip.portId) && ip.lockStatus !== "FREEZED");
}

function gatewayEips(record: Record<string, unknown>) {
  return [asRecord(record.eip1), asRecord(record.eip2)].flatMap((eip, index) => {
    const id = firstString([eip.id], "");
    return id ? [{ id, address: firstString([eip.ip_address], ""), role: index === 0 ? "master" : "slave" }] : [];
  });
}

function ackRecord(session: BetterUiSession, body: Record<string, unknown>, key: string, id: string, label: string) {
  const record = asRecord(body[key]);
  if (firstString([record.id], "") !== id) throw new Error(`Huawei did not confirm the ${label} mutation. The cloud may have accepted this request; check the current state before retrying.`);
  assertAckOwned(record, session);
  return record;
}

function assertAckOwned(record: Record<string, unknown>, session: BetterUiSession) {
  if (record.project_id !== undefined && record.project_id !== session.projectId) throw new Error("Huawei did not confirm the selected VPN project. The request may have been accepted; inspect native state before retrying.");
}

function supportedGateway(record: Record<string, unknown>) {
  return record.network_type === "public" && record.attachment_type === "vpc" && record.ip_version === "ipv4" && Object.values(catalogFlavors).includes(firstString([record.flavor], "")) && haModes.includes(firstString([record.ha_mode], ""));
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create VPN gateway", kind: "create", description: "Create one pay-per-use public VPN gateway attached to a current VPC subnet, using the native flavor and availability-zone catalog and unbound IPv4 EIPs owned by this project.", fields: [
    { ...nameField, label: "Gateway name" },
    { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true },
    { key: "subnet", label: "Gateway subnet", type: "select", source: "subnets", required: true, help: "A current subnet of the selected VPC; the gateway attaches to this subnet." },
    { key: "localSubnets", label: "Local subnets", type: "textarea", required: true, help: "Comma-separated IPv4 CIDR blocks reachable through this gateway, for example 192.168.0.0/16. Up to 50 blocks." },
    { key: "flavor", label: "Gateway flavor", type: "select", source: "flavors", required: true, help: "Flavors the native VPN catalog currently offers for VPC attachment in this region." },
    { key: "az1", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "az2", label: "Backup availability zone", type: "select", source: "zones", help: "Required (and distinct from the primary) when the flavor supports two zones; leave empty for single-zone flavors." },
    { key: "haMode", label: "HA mode", type: "select", required: true, defaultValue: "active-active", choices: haModes.map((value) => ({ value, label: value === "active-active" ? "active-active" : "active-standby (EIP 2 is the standby)" })) },
    { key: "eip1", label: "Elastic IP (tunnel 1)", type: "select", source: "eips", required: true, help: "An unbound IPv4 EIP owned by this project. It is bound to the gateway and keeps its own charges." },
    { key: "eip2", label: "Elastic IP (tunnel 2)", type: "select", source: "eips", help: "Optional second unbound IPv4 EIP: the second tunnel of active-active gateways, or the standby EIP of active-standby gateways." },
    enterpriseProjectField,
  ], impact: "The gateway flavor is billed hourly while the gateway exists (the v5 API creates pay-per-use gateways only; no prepaid order is placed). The selected EIPs are bound to the gateway and keep their EIP and bandwidth charges." },
  { id: "inspect", label: "Inspect gateway", kind: "inspect", resourcePrefixes: [gatewayPrefix], description: "Show the gateway's attachment, flavor, zones, EIPs, and connection usage.", fields: [] },
  { id: "update", label: "Rename gateway or set local subnets", kind: "update", resourcePrefixes: [gatewayPrefix], allowedStatuses: gatewayStable, description: "Rename the gateway and optionally replace its local subnet list. All other settings are preserved by the partial update body.", fields: [
    { ...nameField, label: "Gateway name" },
    { key: "localSubnets", label: "Local subnets", type: "textarea", help: "Leave empty to keep the current local subnets. Otherwise a comma-separated IPv4 CIDR list (up to 50) that replaces them." },
  ], impact: "Changing local subnets changes which networks the gateway serves; affected tunnels re-negotiate their policies." },
  { id: "delete", label: "Delete VPN gateway", kind: "delete", resourcePrefixes: [gatewayPrefix], allowedStatuses: [...gatewayStable, "ERROR"], description: "Permanently delete a gateway that no VPN connection references. Bound EIPs remain allocated.", fields: [], confirmation: true, impact: "The gateway and its tunnels are permanently removed and connectivity through it stops. Its EIPs are released by the gateway but remain allocated and billed until deleted separately." },
  { id: "create-cgw", label: "Create customer gateway", kind: "create", description: "Register one peer device by its IPv4 address, optionally with its BGP ASN.", fields: [
    { ...nameField, label: "Customer gateway name" },
    { key: "peerAddress", label: "Peer gateway address", required: true, max: 45, help: "The peer device's IPv4 address in dotted decimal notation." },
    { key: "bgpAsn", label: "BGP ASN", type: "number", min: 1, max: 4294967295, help: "Optional. The peer's BGP autonomous system number (1 to 4294967295); BGP-style connections need it." },
  ] },
  { id: "inspect-cgw", label: "Inspect customer gateway", kind: "inspect", resourcePrefixes: [cgwPrefix], description: "Show the peer identifier and BGP ASN.", fields: [] },
  { id: "rename-cgw", label: "Rename customer gateway", kind: "update", resourcePrefixes: [cgwPrefix], description: "Rename the peer device record.", fields: [{ ...nameField, label: "Customer gateway name" }] },
  { id: "delete-cgw", label: "Delete customer gateway", kind: "delete", resourcePrefixes: [cgwPrefix], description: "Permanently delete a peer device record that no VPN connection references.", fields: [], confirmation: true, impact: "The peer record is permanently removed. VPN connections referencing it must be deleted first." },
  { id: "create-connection", label: "Create VPN connection", kind: "create", description: "Create one encrypted tunnel between a current gateway EIP and a current customer gateway, with native IKE and IPsec policies and a secret preshared key.", fields: [
    { ...nameField, label: "Connection name" },
    { key: "gateway", label: "Gateway and gateway EIP", type: "select", source: "gateways", required: true, help: "A current ACTIVE gateway and one of its bound EIPs for this tunnel. The native API receives the gateway id and the EIP id." },
    { key: "cgw", label: "Customer gateway", type: "select", source: "cgws", required: true },
    { key: "style", label: "Routing style", type: "select", required: true, defaultValue: "static", choices: [{ value: "policy", label: "Policy" }, { value: "static", label: "Static routes" }, { value: "bgp", label: "BGP" }] },
    { key: "localSubnets", label: "Local subnets", type: "textarea", help: "Policy style only: comma-separated local IPv4 CIDR blocks (up to 5). One policy rule is created per local subnet." },
    { key: "peerSubnets", label: "Peer subnets", type: "textarea", required: true, help: "Comma-separated peer IPv4 CIDR blocks (up to 50). Required for every routing style on IPv4 VPC gateways; reserved ranges such as 100.64.0.0/10 and 214.0.0.0/8 are refused." },
    { key: "tunnelLocalAddress", label: "Tunnel local address", max: 45, help: "Optional, for example 169.254.56.225/30. Leave both tunnel addresses empty to let the cloud allocate them." },
    { key: "tunnelPeerAddress", label: "Tunnel peer address", max: 45, help: "Optional, for example 169.254.56.226/30. Must be the other usable host address of the same /30 block as the local address." },
    pskField,
    ...ikeFields,
    ...ipsecFields,
  ], impact: "The tunnel negotiates automatically. Incorrect peer addressing, subnets, or policy settings can expose or block traffic between the networks. The peer device must use identical IKE/IPsec settings and the same preshared key." },
  { id: "inspect-connection", label: "Inspect connection", kind: "inspect", resourcePrefixes: [connectionPrefix], description: "Show the tunnel's parents, routing style, policy rules, and IKE/IPsec policies. The preshared key is never displayed.", fields: [] },
  { id: "rename-connection", label: "Rename connection", kind: "update", resourcePrefixes: [connectionPrefix], allowedStatuses: connectionStable, description: "Rename the connection without changing its policies.", fields: [{ ...nameField, label: "Connection name" }] },
  { id: "connection-policy", label: "Update peer tunnel policy", kind: "update", resourcePrefixes: [connectionPrefix], allowedStatuses: connectionStable, description: "Replace the connection's IKE and IPsec policy settings and optionally set a new preshared key. All other connection settings are preserved by the partial update body.", fields: [
    { ...pskField, label: "New preshared key", required: false, help: "Leave empty to keep the current key. Never re-enter a masked value." },
    ...ikeFields,
    ...ipsecFields,
  ], confirmation: true, impact: "The accepted policy forces the tunnel to re-negotiate. The peer device must use identical settings and the same preshared key, or the tunnel stays down. Acceptance does not by itself confirm the tunnel came back up." },
  { id: "reset-connection", label: "Reset tunnel", kind: "action", resourcePrefixes: [connectionPrefix], allowedStatuses: connectionStable, description: "Tear down and re-negotiate the tunnel.", fields: [], confirmation: true, impact: "Traffic through the tunnel is interrupted until the new tunnel is up. Acceptance of the reset does not by itself confirm the tunnel re-established; verify the connection status afterwards." },
  { id: "delete-connection", label: "Delete connection", kind: "delete", resourcePrefixes: [connectionPrefix], allowedStatuses: [...connectionStable, "ERROR"], description: "Permanently delete the tunnel.", fields: [], confirmation: true, impact: "Site-to-site connectivity through this tunnel stops immediately and the peer device keeps retrying." },
];

export const vpnManagement: ManagementAdapter = {
  title: "Enterprise VPN",
  operations,
  inventory: async (session) => {
    const [gateways, cgws, connections] = await Promise.all([fetchVgws(session), fetchCgws(session), fetchConnections(session)]);
    return [
      ...gateways.map((gateway) => ({
        id: `${gatewayPrefix}${asString(gateway.id)}`,
        name: firstString([gateway.name], asString(gateway.id)),
        status: firstString([gateway.status], "UNKNOWN"),
        values: { kind: "gateway", flavor: asString(gateway.flavor, "-"), attachment: asString(gateway.attachment_type, "-"), vpc: asString(gateway.vpc_id, "-"), eip: firstString([asRecord(gateway.eip1).ip_address], "-"), connections: Number(gateway.used_connection_number) || 0 },
      })),
      ...cgws.map((cgw) => ({
        id: `${cgwPrefix}${asString(cgw.id)}`,
        name: firstString([cgw.name], asString(cgw.id)),
        status: "Available",
        values: { kind: "customer gateway", peer: asString(cgw.id_value, "-"), bgpAsn: Number(cgw.bgp_asn) || 0 },
      })),
      ...connections.map((connection) => ({
        id: `${connectionPrefix}${asString(connection.id)}`,
        name: firstString([connection.name], asString(connection.id)),
        status: firstString([connection.status], "UNKNOWN"),
        values: { kind: "connection", style: asString(connection.style, "-"), vgw: asString(connection.vgw_id, "-"), cgw: asString(connection.cgw_id, "-"), vgwEip: asString(connection.vgw_ip, "-"), peerSubnets: asArray(connection.peer_subnets).map(String).join(", ") || "-" },
      })),
    ];
  },
  options: async (session, operation): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [vpcs, subnets, eips, catalog] = await Promise.all([listVpcsForProject(session), listSubnetsForProject(session), listEipsForProject(session), availabilityCatalog(session)]);
      return {
        vpcs: vpcs.map((vpc) => ({ value: vpc.id, label: `${vpc.name} · ${vpc.cidr}` })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        flavors: catalog.flavors.map((entry) => ({ value: entry.flavor, label: entry.flavor })),
        zones: catalog.zones.map((zone) => ({ value: zone, label: zone })),
        eips: unboundEips(eips).map((ip) => ({ value: ip.id, label: `${ip.ipAddress} · ${ip.name}` })),
      };
    }
    if (operation === "create-connection") {
      const [gateways, cgws] = await Promise.all([fetchVgws(session), fetchCgws(session)]);
      const choices: ManagementChoice[] = [];
      for (const gateway of gateways) {
        if (!gatewayStable.includes(firstString([gateway.status], "")) || !supportedGateway(gateway)) continue;
        const standby = firstString([gateway.ha_mode], "") === "active-standby";
        for (const eip of gatewayEips(gateway)) {
          const role = standby ? ` · ${eip.role === "master" ? "active" : "standby"}` : "";
          choices.push({ value: JSON.stringify([asString(gateway.id), eip.id]), label: `${firstString([gateway.name], asString(gateway.id))} · ${eip.address || eip.id}${role}` });
        }
      }
      return {
        gateways: choices,
        cgws: cgws.map((cgw) => ({ value: asString(cgw.id), label: `${firstString([cgw.name], asString(cgw.id))} · ${asString(cgw.id_value, "-")}` })),
      };
    }
    return {};
  },
  poll: async (session, entry) => {
    const target = entry.resultResourceId ?? entry.resourceId ?? "";
    const separator = target.indexOf(":");
    const prefix = separator === -1 ? "" : target.slice(0, separator + 1);
    const id = separator === -1 ? "" : target.slice(separator + 1);
    if (!id || ![gatewayPrefix, cgwPrefix, connectionPrefix].includes(prefix)) throw new ManagementInputError("The stored VPN resource reference is not a native gateway, customer gateway, or connection id.");
    const expected: Record<string, string> = { "Create VPN gateway": gatewayPrefix, "Delete VPN gateway": gatewayPrefix, "Create VPN connection": connectionPrefix, "Delete connection": connectionPrefix, "Delete customer gateway": cgwPrefix };
    if (expected[entry.operation] !== prefix || entry.jobId !== id) throw new ManagementInputError("This history entry has no verified original VPN operation identity.");
    const deleting = entry.operation.startsWith("Delete");
    try {
      if (prefix === gatewayPrefix) {
        const status = asString((await fetchVgw(session, id)).status, "");
        if (deleting) return { state: "submitted", message: `The gateway is still present (${["ACTIVE", "NORMAL", "ERROR", "PENDING_DELETE", "DELETING"].includes(status) ? status : "unverified state"}); deletion is still being processed.` };
        if (status === "ACTIVE") return { state: "succeeded", message: "The VPN gateway is ACTIVE.", resourceId: target };
        if (status === "ERROR") return { state: "failed", message: "The VPN gateway ended in ERROR state." };
        return { state: "submitted", message: `The VPN gateway is ${["PENDING_CREATE", "CREATING", "PENDING_UPDATE", "UPDATING"].includes(status) ? status : "an unverified state"}.` };
      }
      if (prefix === connectionPrefix) {
        const status = asString((await fetchConnection(session, id)).status, "");
        if (deleting) return { state: "submitted", message: `The connection is still present (${["ACTIVE", "NORMAL", "ERROR", "PENDING_DELETE", "DELETING"].includes(status) ? status : "unverified state"}); deletion is still being processed.` };
        if (connectionStable.includes(status)) return { state: "succeeded", message: "The VPN connection is NORMAL.", resourceId: target };
        if (status === "ERROR") return { state: "failed", message: "The VPN connection ended in ERROR state." };
        return { state: "submitted", message: `The VPN connection is ${["PENDING_CREATE", "CREATING", "PENDING_UPDATE", "UPDATING"].includes(status) ? status : "an unverified state"}.` };
      }
      await fetchCgw(session, id);
      if (deleting) return { state: "submitted", message: "The customer gateway is still present; deletion is still being processed." };
      return { state: "succeeded", message: "The customer gateway is present.", resourceId: target };
    } catch (error) {
      if (error instanceof HuaweiApiError && error.status === 404) {
        if (deleting) return { state: "succeeded", message: "The resource no longer exists in this project." };
        return { state: "failed", message: "The resource is no longer visible. Verify the current cloud state directly." };
      }
      throw error;
    }
  },
  invalidationKeys: () => [cloudCacheKeys.summary, cloudCacheKeys.listEips, cloudCacheKeys.listVpnConnections],
  execute: async (session, operation, values, resource) => {
    const send = (path: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(session, "vpn", `${root(session)}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

    if (operation === "create") {
      const localSubnets = cidrList(values.localSubnets, "Local subnets", { max: maxLocalSubnets });
      const [vpcs, subnets, eips, catalog] = await Promise.all([listVpcsForProject(session), listSubnetsForProject(session), listEipsForProject(session), availabilityCatalog(session)]);
      if (!vpcs.some((vpc) => vpc.id === values.vpc)) throw new ManagementInputError("The selected VPC is no longer available in this project.", 404);
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.", 404);
      if (subnet.vpcId !== values.vpc) throw new ManagementInputError("The selected subnet does not belong to the selected VPC.");
      const flavor = catalog.flavors.find((entry) => entry.flavor === values.flavor);
      if (!flavor) throw new ManagementInputError("The selected gateway flavor is no longer available in this region.");
      const az1 = String(values.az1 ?? "");
      const az2 = String(values.az2 ?? "");
      let zoneIds: string[];
      if (flavor.zones.length === 1) {
        if (az2) throw new ManagementInputError("Only one availability zone is supported for this flavor; leave the backup zone empty.");
        if (az1 !== flavor.zones[0]) throw new ManagementInputError("The selected availability zone is not available for this flavor.");
        zoneIds = [az1];
      } else {
        if (!az1 || !az2) throw new ManagementInputError("This flavor deploys across two availability zones; select both.");
        if (az1 === az2) throw new ManagementInputError("The backup availability zone must differ from the primary zone.");
        if (!flavor.zones.includes(az1) || !flavor.zones.includes(az2)) throw new ManagementInputError("The selected availability zones are not available for this flavor.");
        zoneIds = [az1, az2];
      }
      const haMode = String(values.haMode ?? "active-active");
      assertChoice(haMode, haModes, "HA mode");
      const available = unboundEips(eips);
      if (!available.some((ip) => ip.id === values.eip1)) throw new ManagementInputError("Select an unbound IPv4 EIP owned by this project.");
      const gatewayBody: Record<string, unknown> = {
        name: values.name,
        attachment_type: "vpc",
        network_type: "public",
        ip_version: "ipv4",
        ha_mode: haMode,
        vpc_id: values.vpc,
        connect_subnet: subnet.id,
        local_subnets: localSubnets,
        flavor: values.flavor,
        availability_zone_ids: zoneIds,
        eip1: { id: values.eip1 },
        enterprise_project_id: values.enterpriseProjectId ?? "0",
      };
      const eip2 = String(values.eip2 ?? "");
      if (eip2) {
        if (eip2 === String(values.eip1)) throw new ManagementInputError("The second tunnel EIP must differ from the first.");
        if (!available.some((ip) => ip.id === eip2)) throw new ManagementInputError("Select an unbound IPv4 EIP owned by this project for the second tunnel.");
        gatewayBody.eip2 = { id: eip2 };
      }
      const response = await send("/vpn-gateways", "POST", { vpn_gateway: gatewayBody });
      assertAckOwned(asRecord(response.vpn_gateway), session);
      const id = firstString([asRecord(response.vpn_gateway).id], "");
      if (!id) throw new Error("Huawei returned no VPN gateway ID. The cloud may have accepted this request; check gateways before retrying.");
      const ackName = firstString([asRecord(response.vpn_gateway).name], "");
      if (ackName && ackName !== values.name) throw new Error("Huawei confirmed a different VPN gateway name. The cloud may have accepted this request; check gateways before retrying.");
      return { message: "Gateway creation submitted. The gateway is billed hourly while it exists; refresh to verify it becomes ACTIVE.", resourceId: `${gatewayPrefix}${id}`, jobId: id, asynchronous: true };
    }

    if (operation === "create-cgw") {
      const peerAddress = ipv4Address(values.peerAddress, "Peer gateway address");
      const cgwBody: Record<string, unknown> = { name: values.name, id_type: "ip", id_value: peerAddress };
      if ((values.bgpAsn ?? "") !== "") {
        const asn = Number(values.bgpAsn);
        if (!Number.isSafeInteger(asn) || asn < 1 || asn > 4294967295) throw new ManagementInputError("The BGP ASN must be a whole number from 1 to 4294967295.");
        cgwBody.bgp_asn = asn;
      }
      const response = await send("/customer-gateways", "POST", { customer_gateway: cgwBody });
      assertAckOwned(asRecord(response.customer_gateway), session);
      const id = firstString([asRecord(response.customer_gateway).id], "");
      if (!id) throw new Error("Huawei returned no customer gateway ID. The cloud may have accepted this request; check customer gateways before retrying.");
      return { message: "Customer gateway created.", resourceId: `${cgwPrefix}${id}` };
    }

    if (operation === "create-connection") {
      const [vgwId, vgwEipId] = parseGatewayChoice(values.gateway);
      const style = String(values.style);
      assertChoice(style, styles, "routing style");
      const gateway = await fetchVgw(session, vgwId);
      if (!supportedGateway(gateway)) throw new ManagementInputError("This gateway requires a different native connection schema. Select a public IPv4 VPC gateway of a supported PSK flavor.", 409);
      if (!gatewayStable.includes(firstString([gateway.status], ""))) throw new ManagementInputError("The selected gateway is not ACTIVE. Wait for a stable state before creating connections.", 409);
      const eips = gatewayEips(gateway);
      const eip = eips.find((item) => item.id === vgwEipId);
      if (!eip) throw new ManagementInputError("The selected gateway EIP no longer belongs to this gateway.", 409);
      const cgw = await fetchCgw(session, String(values.cgw));
      if (cgw.id_type !== "ip" || isIP(firstString([cgw.id_value], "")) !== 4) throw new ManagementInputError("Select a verified IPv4 customer gateway.", 409);
      const psk = String(values.psk ?? "");
      assertPsk(psk);
      const peerSubnets = cidrList(values.peerSubnets, "Peer subnets", { max: maxPeerSubnets, reserved: true });
      const connectionBody: Record<string, unknown> = {
        name: values.name,
        vgw_id: asString(gateway.id),
        vgw_ip: eip.id,
        cgw_id: asString(cgw.id),
        style,
        peer_subnets: peerSubnets,
        psk,
        ikepolicy: ikeBody(values),
        ipsecpolicy: ipsecBody(values),
      };
      const [tunnelLocal, tunnelPeer] = tunnelAddressPair(values.tunnelLocalAddress, values.tunnelPeerAddress);
      if (tunnelLocal) {
        connectionBody.tunnel_local_address = tunnelLocal;
        connectionBody.tunnel_peer_address = tunnelPeer;
      }
      if (firstString([gateway.ha_mode], "") === "active-standby") connectionBody.ha_role = eip.role;
      if (style === "policy") {
        const localSubnets = cidrList(values.localSubnets, "Local subnets", { max: maxPolicyRules });
        connectionBody.policy_rules = localSubnets.map((source) => ({ source, destination: peerSubnets }));
      } else if (style === "bgp") {
        const gatewayAsn = gateway.bgp_asn;
        if (typeof gatewayAsn !== "number" || !Number.isSafeInteger(gatewayAsn) || gatewayAsn < 1 || gatewayAsn > 4294967295) throw new ManagementInputError("The selected VPN gateway has no verified BGP ASN.", 409);
        const asn = cgw.bgp_asn;
        if (typeof asn !== "number" || !Number.isSafeInteger(asn) || asn < 1 || asn > 4294967295) throw new ManagementInputError("The selected customer gateway has no valid BGP ASN (1 to 4294967295). Set it before creating BGP connections.", 409);
      }
      const response = await send("/vpn-connection", "POST", { vpn_connection: connectionBody });
      const record = asRecord(response.vpn_connection);
      assertAckOwned(record, session);
      const id = firstString([record.id], "");
      if (!id) throw new Error("Huawei returned no VPN connection ID. The cloud may have accepted this request; check connections before retrying.");
      const ackVgw = firstString([record.vgw_id], "");
      if (ackVgw && ackVgw !== asString(gateway.id)) throw new Error("Huawei confirmed a different gateway for this connection. The cloud may have accepted this request; check connections before retrying.");
      const ackCgw = firstString([record.cgw_id], "");
      if (ackCgw && ackCgw !== asString(cgw.id)) throw new Error("Huawei confirmed a different customer gateway for this connection. The cloud may have accepted this request; check connections before retrying.");
      return { message: "Connection creation submitted. The tunnel negotiates automatically; refresh to verify it becomes NORMAL.", resourceId: `${connectionPrefix}${id}`, jobId: id, asynchronous: true };
    }

    if (operation === "inspect" || operation === "update" || operation === "delete") {
      const id = parseKind(resource, gatewayPrefix, "VPN gateway");
      const record = await fetchVgw(session, id);
      if (operation === "inspect") {
        const eip1 = asRecord(record.eip1);
        const eip2 = asRecord(record.eip2);
        return { message: "Current VPN gateway configuration.", facts: [
          { label: "Status", value: asString(record.status, "Unknown") },
          { label: "Attachment", value: `${asString(record.attachment_type, "-")} · ${asString(record.network_type, "-")} network` },
          { label: "VPC", value: asString(record.vpc_id, "-") },
          { label: "Gateway subnet", value: asString(record.connect_subnet, "-") },
          { label: "Local subnets", value: asArray(record.local_subnets).map(String).join(", ") || "-" },
          { label: "Flavor", value: asString(record.flavor, "-") },
          { label: "HA mode", value: asString(record.ha_mode, "-") },
          { label: "Availability zones", value: asArray(record.availability_zone_ids).map(String).join(", ") || "-" },
          { label: "EIP 1", value: `${firstString([eip1.ip_address], "-")} · ${firstString([eip1.id], "-")}` },
          { label: "EIP 2", value: `${firstString([eip2.ip_address], "-")} · ${firstString([eip2.id], "-")}` },
          { label: "Connections used", value: String(Number(record.used_connection_number) || 0) },
          { label: "Created", value: firstString([record.created_at], "-") },
          { label: "Updated", value: firstString([record.updated_at], "-") },
        ] };
      }
      if (operation === "update") {
        if (String(values.localSubnets ?? "").trim() && !supportedGateway(record)) throw new ManagementInputError("This gateway requires a different native subnet schema.", 409);
        assertStatus(record, gatewayStable, "gateway");
        const gatewayBody: Record<string, unknown> = { name: values.name };
        const localSubnets = optionalCidrList(values.localSubnets, "Local subnets", { max: maxLocalSubnets });
        if (localSubnets.length) gatewayBody.local_subnets = localSubnets;
        const response = await send(`/vpn-gateways/${encodeURIComponent(id)}`, "PUT", { vpn_gateway: gatewayBody });
        ackRecord(session, response, "vpn_gateway", id, "gateway");
        return { message: "Gateway update accepted. Tunnels re-negotiate when local subnets change; verify the gateway afterwards.", resourceId: `${gatewayPrefix}${id}` };
      }
      assertStatus(record, [...gatewayStable, "ERROR"], "gateway");
      assertFreshName(resource!, record, "gateway");
      const used = record.used_connection_number;
      if (typeof used !== "number" || !Number.isSafeInteger(used) || used < 0) throw new ManagementInputError("The gateway connection count is unverified. Refresh before deletion.", 409);
      if (used > 0) throw new ManagementInputError(`${used} VPN connections still use this gateway. Delete them first.`, 409);
      if ((await fetchConnections(session)).some((connection) => asString(connection.vgw_id, "") === id)) throw new ManagementInputError("VPN connections still reference this gateway. Delete them first.", 409);
      await send(`/vpn-gateways/${encodeURIComponent(id)}`, "DELETE");
      return { message: "Gateway deletion submitted. Refresh to verify the gateway is removed; its EIPs remain allocated.", resourceId: `${gatewayPrefix}${id}`, jobId: id, asynchronous: true };
    }

    if (operation === "inspect-cgw" || operation === "rename-cgw" || operation === "delete-cgw") {
      const id = parseKind(resource, cgwPrefix, "customer gateway");
      const record = await fetchCgw(session, id);
      if (operation === "inspect-cgw") {
        const asn = Number(record.bgp_asn);
        return { message: "Current customer gateway configuration.", facts: [
          { label: "Peer identifier", value: `${asString(record.id_type, "-")} · ${asString(record.id_value, "-")}` },
          { label: "BGP ASN", value: Number.isSafeInteger(asn) && asn > 0 ? String(asn) : "Not set" },
          { label: "Created", value: firstString([record.created_at], "-") },
          { label: "Updated", value: firstString([record.updated_at], "-") },
        ] };
      }
      if (operation === "rename-cgw") {
        const response = await send(`/customer-gateways/${encodeURIComponent(id)}`, "PUT", { customer_gateway: { name: values.name } });
        ackRecord(session, response, "customer_gateway", id, "customer gateway");
        return { message: "Customer gateway rename accepted. Inspect it to verify the change.", resourceId: `${cgwPrefix}${id}` };
      }
      assertFreshName(resource!, record, "customer gateway");
      if ((await fetchConnections(session)).some((connection) => asString(connection.cgw_id, "") === id)) throw new ManagementInputError("VPN connections still reference this customer gateway. Delete them first.", 409);
      await send(`/customer-gateways/${encodeURIComponent(id)}`, "DELETE");
      return { message: "Customer gateway deletion accepted. Observe its original identity to verify removal.", resourceId: `${cgwPrefix}${id}`, jobId: id, asynchronous: true };
    }

    if (["inspect-connection", "rename-connection", "connection-policy", "reset-connection", "delete-connection"].includes(operation)) {
      const id = parseKind(resource, connectionPrefix, "VPN connection");
      const record = await fetchConnection(session, id);
      if (operation === "inspect-connection") {
        const ike = asRecord(record.ikepolicy);
        const ipsec = asRecord(record.ipsecpolicy);
        const rules = asArray(record.policy_rules).map(asRecord).map((rule, index) => ({
          label: `Policy rule ${index}`,
          value: `${firstString([rule.source], "-")} → ${asArray(rule.destination).map(String).join(", ") || "-"}`,
        }));
        return { message: "Current VPN connection and peer tunnel policy.", facts: [
          { label: "Status", value: asString(record.status, "Unknown") },
          { label: "Style", value: asString(record.style, "-") },
          { label: "Gateway", value: `${asString(record.vgw_id, "-")} · EIP ${asString(record.vgw_ip, "-")}` },
          { label: "Customer gateway", value: asString(record.cgw_id, "-") },
          { label: "Peer subnets", value: asArray(record.peer_subnets).map(String).join(", ") || "-" },
          { label: "Tunnel addresses", value: `${asString(record.tunnel_local_address, "-")} ↔ ${asString(record.tunnel_peer_address, "-")}` },
          ...rules,
          { label: "IKE policy", value: `${asString(ike.ike_version, "-")} · ${asString(ike.authentication_algorithm, "-")} · ${asString(ike.encryption_algorithm, "-")} · ${asString(ike.dh_group, "-")} · ${Number(ike.lifetime_seconds) || 0} s` },
          { label: "IPsec policy", value: `${asString(ipsec.authentication_algorithm, "-")} · ${asString(ipsec.encryption_algorithm, "-")} · PFS ${asString(ipsec.pfs, "-")} · ${asString(ipsec.transform_protocol, "-")} · ${Number(ipsec.lifetime_seconds) || 0} s` },
          { label: "HA role", value: asString(record.ha_role, "-") },
          { label: "Connection monitor", value: asString(record.connection_monitor_id, "None") },
          { label: "Created", value: firstString([record.created_at], "-") },
        ] };
      }
      if (typeof record.vgw_id !== "string" || !record.vgw_id || typeof record.cgw_id !== "string" || !record.cgw_id) throw new ManagementInputError("The connection parent identities are unverified.", 409);
      const [parentGateway] = await Promise.all([fetchVgw(session, record.vgw_id), fetchCgw(session, record.cgw_id)]);
      if (operation === "connection-policy" && !supportedGateway(parentGateway)) throw new ManagementInputError("This connection requires a different native policy schema.", 409);
      if (operation === "rename-connection") {
        assertStatus(record, connectionStable, "connection");
        const response = await send(`/vpn-connection/${encodeURIComponent(id)}`, "PUT", { vpn_connection: { name: values.name } });
        ackRecord(session, response, "vpn_connection", id, "connection");
        return { message: "Connection rename accepted. Verify the connection afterwards.", resourceId: `${connectionPrefix}${id}` };
      }
      if (operation === "connection-policy") {
        assertStatus(record, connectionStable, "connection");
        const policyBody: Record<string, unknown> = { ikepolicy: ikeBody(values), ipsecpolicy: ipsecBody(values) };
        const psk = String(values.psk ?? "");
        if (psk) {
          if (/^\*+$/.test(psk)) throw new ManagementInputError("A masked preshared key is never re-sent. Enter the new key or leave the field empty.");
          assertPsk(psk);
          policyBody.psk = psk;
        }
        const response = await send(`/vpn-connection/${encodeURIComponent(id)}`, "PUT", { vpn_connection: policyBody });
        ackRecord(session, response, "vpn_connection", id, "connection");
        return { message: "Peer tunnel policy update accepted. The tunnel re-negotiates; the peer device must use identical settings. Verify the connection status afterwards.", resourceId: `${connectionPrefix}${id}` };
      }
      if (operation === "reset-connection") {
        assertStatus(record, connectionStable, "connection");
        await send(`/vpn-connection/${encodeURIComponent(id)}/reset`, "POST");
        return { message: "Tunnel reset accepted. Traffic is interrupted while the cloud tears down and re-negotiates the tunnel; verify the connection status afterwards.", resourceId: `${connectionPrefix}${id}` };
      }
      assertStatus(record, [...connectionStable, "ERROR"], "connection");
      assertFreshName(resource!, record, "connection");
      await send(`/vpn-connection/${encodeURIComponent(id)}`, "DELETE");
      return { message: "Connection deletion submitted. Site-to-site connectivity through this tunnel stops.", resourceId: `${connectionPrefix}${id}`, jobId: id, asynchronous: true };
    }

    throw new ManagementInputError("Unsupported VPN operation.");
  },
};
