import "server-only";
import { isIP } from "node:net";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { huaweiFetch as nativeFetch, HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import type { ManagementAdapter } from "../types";

// Native Direct Connect v3 contracts (project-scoped /dcaas endpoints) verified against
// the cached huaweicloud-sdk-dc v3 models: virtual-gateways, virtual-interfaces, and
// vif-peers. Physical connections and hosting orders are never created or ordered here.
const active = ["ACTIVE"];
const peerActive = ["ACTIVE", "DOWN"];
const v4AddressPattern = "^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(/(3[0-2]|[12]?\\d))?$";
const nameField: ManagementField = { key: "name", label: "Name", required: true, min: 1, max: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$", help: "1-64 letters, digits, underscores, or hyphens, starting with a letter or digit." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 128, help: "Up to 128 characters. Leave empty to keep the current description." };
const routeModeField: ManagementField = { key: "routeMode", label: "Routing mode", type: "select", required: true, choices: [{ value: "static", label: "Static routes" }, { value: "bgp", label: "BGP dynamic routing" }] };
const bgpAsnField: ManagementField = { key: "bgpAsn", label: "Customer BGP ASN", type: "number", min: 1, max: 4294967295, help: "Required for BGP routing: the autonomous system number on your side of the session." };
const bgpMd5Field: ManagementField = { key: "bgpMd5", label: "BGP MD5 authentication key", type: "password", max: 128, help: "Optional MD5 password for the BGP session. Leave empty for none." };
const remoteSubnetsField: ManagementField = { key: "remoteSubnets", label: "Remote subnets (CIDRs)", type: "list", max: 50, help: "The customer-side CIDRs reachable through this interface, for example 172.16.0.0/16. Required for static routing." };

async function huaweiFetch<T>(session: BetterUiSession, service: "dc", path: string, init?: RequestInit): Promise<T> {
  try {
    const body = await nativeFetch<T>(session, service, path, init), row = asRecord(body);
    if (row.error_code || row.error) throw new HuaweiApiError("Huawei rejected this Direct Connect request.", 502);
    return body;
  } catch (error) { if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected this Direct Connect request.", error.status); throw new Error("Huawei returned an unverifiable Direct Connect response. Check native state before retrying."); }
}
async function huaweiList<T>(session: BetterUiSession, service: "dc", path: string, pagination: Pagination): Promise<T> {
  return collectList(cursor => { const url = new URL(path, "https://local.invalid"); if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor)); return huaweiFetch<T>(session, service, url.pathname + url.search); }, pagination);
}
function verifiedRows(value: unknown, label: string, session: BetterUiSession) {
  if (!Array.isArray(value)) throw new ManagementInputError(`Huawei returned an incomplete ${label} inventory.`, 409);
  const rows = value.map(asRecord), ids = rows.map(row => firstString([row.id], ""));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ManagementInputError(`Huawei returned an unverified ${label} inventory.`, 409);
  for (const row of rows) assertProjectOwned(row, session, label);
  return rows;
}
function verifiedPeers(value: unknown, vifId: string, session: BetterUiSession) {
  const rows = verifiedRows(value, "virtual interface peer", session);
  if (rows.some(row => row.vif_id !== vifId || !["ipv4", "ipv6"].includes(firstString([row.address_family], "")))) throw new ManagementInputError("Huawei returned an unverified peer parent or address family.", 409);
  return rows;
}
function isIPv4(text: string) { return isIP(text) === 4; }
function isIPv6(text: string) { return isIP(text) === 6; }
function verifiedAcknowledgement(response: Record<string, unknown>, field: string, session: BetterUiSession, expected?: string) {
  const record = asRecord(response[field]), id = firstString([record.id], "");
  if (!id || (expected && id !== expected)) throw new Error("Huawei returned an unverified Direct Connect acknowledgement. Check native state before retrying.");
  if (record.tenant_id && record.tenant_id !== session.projectId) throw new Error("Huawei returned an unverified Direct Connect acknowledgement. Check native state before retrying.");
  return { id, record };
}

function assertCidr(value: string, family: "ipv4" | "ipv6", label: string) {
  const [address, prefix = "", extra] = value.split("/");
  if (extra !== undefined) throw new ManagementInputError(`${label} must contain one CIDR prefix.`);
  const size = Number(prefix);
  const valid = family === "ipv6"
    ? isIPv6(address) && /^\d+$/.test(prefix) && size >= 0 && size <= 128
    : isIPv4(address) && /^\d+$/.test(prefix) && size >= 0 && size <= 32;
  if (!valid) throw new ManagementInputError(`${label} must be an ${family === "ipv6" ? "IPv6" : "IPv4"} CIDR such as ${family === "ipv6" ? "2001:db8::/64" : "172.16.0.0/16"}.`);
}

function cidrList(selection: unknown, family: "ipv4" | "ipv6", label: string) {
  const list = Array.isArray(selection) ? selection.map(String).filter(Boolean) : [];
  for (const item of list) assertCidr(item, family, label);
  return [...new Set(list)];
}

function assertGatewayAddress(value: string, family: "ipv4" | "ipv6", label: string) {
  const [address, prefix, extra] = value.split("/");
  if (extra !== undefined) throw new ManagementInputError(`${label} must contain at most one prefix.`);
  const addressValid = family === "ipv6" ? isIPv6(address) : isIPv4(address);
  const prefixValid = prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= (family === "ipv6" ? 128 : 32));
  if (!addressValid || !prefixValid) throw new ManagementInputError(`${label} must be an ${family === "ipv6" ? "IPv6" : "IPv4"} address, optionally with a prefix length, such as 10.0.0.1/30.`);
}

function bgpSettings(routeMode: string, values: ManagementValues) {
  if (routeMode === "static") {
    if (values.bgpAsn !== undefined || values.bgpMd5) throw new ManagementInputError("BGP settings cannot be combined with static routing.", 409);
    return {};
  }
  if (routeMode !== "bgp") throw new ManagementInputError("Select a routing mode.");
  const asn = Number(values.bgpAsn);
  if (!Number.isSafeInteger(asn) || asn < 1 || asn > 4294967295) throw new ManagementInputError("Enter the customer-side BGP ASN (1-4294967295).");
  return { bgp_asn: asn, ...(values.bgpMd5 ? { bgp_md5: String(values.bgpMd5) } : {}) };
}

function parseEndpointSelection(selection: unknown, vpcId: string, vpcs: Awaited<ReturnType<typeof listVpcsForProject>>, subnets: Awaited<ReturnType<typeof listSubnetsForProject>>) {
  const list = Array.isArray(selection) ? selection.map(String) : [];
  const cidrs: string[] = [];
  for (const item of list) {
    let pair: unknown;
    try { pair = JSON.parse(item); } catch { throw new ManagementInputError("Select local endpoints from the provided VPC subnet list."); }
    if (!Array.isArray(pair) || pair.length !== 2) throw new ManagementInputError("Select local endpoints from the provided VPC subnet list.");
    const [owner, cidr] = pair.map(String);
    assertCidr(cidr, "ipv4", "Local endpoint");
    if (owner !== vpcId) throw new ManagementInputError("Every local endpoint must belong to the selected VPC.", 409);
    const vpc = vpcs.find((candidate) => candidate.id === vpcId);
    const known = (Boolean(vpc) && (vpc!.cidr === cidr || vpc!.secondaryCidrs.includes(cidr))) || subnets.some((subnet) => subnet.vpcId === vpcId && subnet.cidr === cidr);
    if (!known) throw new ManagementInputError(`The local endpoint ${cidr} is no longer available in this VPC.`, 404);
    if (!cidrs.includes(cidr)) cidrs.push(cidr);
  }
  return cidrs;
}

function endpointChoices(vpcs: Awaited<ReturnType<typeof listVpcsForProject>>, subnets: Awaited<ReturnType<typeof listSubnetsForProject>>): ManagementChoice[] {
  const choices: ManagementChoice[] = [];
  for (const vpc of vpcs) {
    if (vpc.cidr && vpc.cidr !== "-") choices.push({ value: JSON.stringify([vpc.id, vpc.cidr]), label: `${vpc.name} · VPC CIDR ${vpc.cidr}` });
    for (const subnet of subnets.filter((subnet) => subnet.vpcId === vpc.id)) choices.push({ value: JSON.stringify([vpc.id, subnet.cidr]), label: `${subnet.name} · ${subnet.cidr} · ${vpc.name}` });
  }
  return choices;
}

async function connectionRows(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "dc", `/v3/${session.projectId}/dcaas/direct-connects?limit=100`, { items: ["direct_connects"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker", "next_marker"] });
  return verifiedRows(body.direct_connects, "physical connection", session);
}
function assertCircuitCapacity(connection: Record<string, unknown> | undefined, bandwidth: number) {
  if (!connection || connection.status !== "ACTIVE" || connection.admin_state_up !== true) throw new ManagementInputError("The selected physical connection must be verified ACTIVE and administratively enabled.", 409);
  const capacity = connection.bandwidth;
  if (typeof capacity !== "number" || !Number.isSafeInteger(capacity) || capacity < 2 || bandwidth > capacity) throw new ManagementInputError("The interface bandwidth exceeds or cannot be verified against the physical connection capacity.", 409);
}

async function gatewayRows(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "dc", `/v3/${session.projectId}/dcaas/virtual-gateways?limit=100`, { items: ["virtual_gateways"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker", "next_marker"] });
  return verifiedRows(body.virtual_gateways, "virtual gateway", session);
}

async function interfaceRows(session: BetterUiSession, vgwId?: string) {
  const query = new URLSearchParams({ limit: "100" });
  if (vgwId) query.set("vgw_id", vgwId);
  const body = await huaweiList<Record<string, unknown>>(session, "dc", `/v3/${session.projectId}/dcaas/virtual-interfaces?${query}`, { items: ["virtual_interfaces"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker", "next_marker"] });
  const rows = verifiedRows(body.virtual_interfaces, "virtual interface", session);
  if (rows.some(row => !firstString([row.vgw_id], ""))) throw new ManagementInputError("Huawei returned an unverified virtual interface parent.", 409);
  if (vgwId && rows.some(row => row.vgw_id !== vgwId)) throw new ManagementInputError("Huawei returned interfaces from another virtual gateway.", 409);
  return rows;
}

async function gatewayRecord(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dc", `/v3/${session.projectId}/dcaas/virtual-gateways/${encodeURIComponent(id)}`);
  const record = asRecord(body.virtual_gateway);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("The virtual gateway was not found in this project.", 404);
  assertProjectOwned(record, session, "Direct Connect resource");
  return record;
}

async function interfaceRecord(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dc", `/v3/${session.projectId}/dcaas/virtual-interfaces/${encodeURIComponent(id)}`);
  const record = asRecord(body.virtual_interface);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("The virtual interface was not found in this project.", 404);
  assertProjectOwned(record, session, "Direct Connect resource");
  return record;
}

function assertProjectOwned(record: Record<string, unknown>, session: BetterUiSession, label: string) {
  if (record.tenant_id !== undefined && (typeof record.tenant_id !== "string" || !record.tenant_id)) throw new ManagementInputError(`Huawei returned an unverified ${label} project identity.`, 409);
  const tenant = firstString([record.tenant_id], "");
  if (tenant && tenant !== session.projectId) throw new ManagementInputError(`The ${label} does not belong to the selected project.`, 409);
}

function assertReady(record: Record<string, unknown>, label: string, statuses = active) {
  const status = firstString([record.status], "");
  if (!statuses.includes(status)) throw new ManagementInputError(`The ${label} is ${status || "in an unknown state"}; retry when it is ${statuses.join(" or ")}.`, 409);
}

function gatewayIdOf(resource?: ManagementResource) {
  const id = resource?.id ?? "";
  if (!id.startsWith("vgw:")) throw new ManagementInputError("Select a virtual gateway for this operation.", 409);
  return id.slice("vgw:".length);
}

function interfaceIdOf(resource?: ManagementResource) {
  const id = resource?.id ?? "";
  if (!id.startsWith("vif:")) throw new ManagementInputError("Select a virtual interface for this operation.", 409);
  return id.slice("vif:".length);
}

function peerKeyOf(resource?: ManagementResource) {
  const id = resource?.id ?? "";
  if (!id.startsWith("peer:")) throw new ManagementInputError("Select a virtual interface peer for this operation.", 409);
  const [vifId = "", peerId = "", extra] = id.slice("peer:".length).split("/");
  if (!vifId || !peerId || extra !== undefined) throw new ManagementInputError("Select a virtual interface peer for this operation.", 409);
  return { vifId, peerId };
}

const operations: ManagementOperation[] = [
  { id: "create-gateway", label: "Create virtual gateway", kind: "create", description: "Create a virtual gateway on one of this project's VPCs with the local subnets reachable through Direct Connect.", impact: "A virtual gateway has no hourly cost, but traffic forwarded through virtual interfaces attached to it is billed as Direct Connect data transfer.", fields: [
    nameField,
    descriptionField,
    { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true, help: "Only VPCs owned by this project are offered." },
    { key: "localSubnets", label: "Local endpoints", type: "list", source: "localSubnets", required: true, max: 50, help: "The VPC CIDR or subnets reachable from your network through this gateway." },
  ] },
  { id: "inspect-gateway", label: "View virtual gateway", kind: "inspect", description: "Show the gateway's VPC, local endpoints, BGP ASN, and state.", fields: [], resourcePrefixes: ["vgw:"] },
  { id: "update-gateway", label: "Edit virtual gateway", kind: "update", description: "Rename the gateway, change its description, or replace the local endpoints. Leave local endpoints empty to keep the current ones.", fields: [nameField, descriptionField, { key: "localSubnets", label: "Local endpoints", type: "list", source: "localSubnets", max: 50, help: "Leave empty to keep the current local endpoints." }], allowedStatuses: active, resourcePrefixes: ["vgw:"], confirmation: true, impact: "Removing local endpoints immediately stops Direct Connect traffic to those subnets." },
  { id: "delete-gateway", label: "Delete virtual gateway", kind: "delete", description: "Permanently delete a virtual gateway that has no virtual interfaces attached.", fields: [], allowedStatuses: active, resourcePrefixes: ["vgw:"], impact: "The virtual gateway is permanently removed. Direct Connect traffic routed through it stops." },
  { id: "create-interface", label: "Create virtual interface", kind: "create", description: "Attach a new private virtual interface between one of this project's active Direct Connect connections and a virtual gateway, with static or BGP routing.", impact: "Data transfer through this virtual interface is billed by Direct Connect usage once the provider completes the circuit configuration. Routing changes affect all traffic between your network and the VPC.", fields: [
    nameField,
    descriptionField,
    { key: "directConnect", label: "Direct Connect connection", type: "select", source: "directConnects", required: true, help: "An active physical connection owned by this project. Physical circuits and hosting orders are purchased in the Direct Connect console, not here." },
    { key: "virtualGateway", label: "Virtual gateway", type: "select", source: "virtualGateways", required: true },
    { key: "vlan", label: "VLAN", type: "number", required: true, min: 0, max: 3999, help: "The VLAN ID agreed with the line provider; a hosted connection must use its own VLAN." },
    { key: "bandwidth", label: "Bandwidth (Mbit/s)", type: "number", required: true, min: 2, max: 2147483647, help: "The virtual interface bandwidth in Mbit/s." },
    routeModeField,
    bgpAsnField,
    bgpMd5Field,
    { key: "localGatewayIp", label: "Cloud-side gateway address", required: true, max: 64, pattern: v4AddressPattern, help: "The Huawei-side point-to-point address, for example 10.0.0.1/30." },
    { key: "remoteGatewayIp", label: "Customer-side gateway address", required: true, max: 64, pattern: v4AddressPattern, help: "Your-side point-to-point address, for example 10.0.0.2/30." },
    remoteSubnetsField,
  ] },
  { id: "inspect-interface", label: "View virtual interface", kind: "inspect", description: "Show the interface's gateway, connection, VLAN, bandwidth, addresses, remote subnets, and BGP peers.", fields: [], resourcePrefixes: ["vif:"] },
  { id: "update-interface", label: "Edit virtual interface", kind: "update", description: "Rename the interface, change its description or bandwidth, set BGP priority, or replace the remote subnets. Empty optional fields keep their current values.", fields: [
    nameField,
    descriptionField,
    { key: "bandwidth", label: "Bandwidth (Mbit/s)", type: "number", min: 2, max: 2147483647, help: "Leave empty to keep the current bandwidth." },
    { key: "priority", label: "BGP priority", type: "select", choices: [{ value: "normal", label: "normal" }, { value: "low", label: "low" }], help: "Only BGP-routed interfaces support priority." },
    remoteSubnetsField,
  ], allowedStatuses: active, resourcePrefixes: ["vif:"], confirmation: true, impact: "Bandwidth changes adjust Direct Connect data transfer billing. Replacing remote subnets rewrites which customer networks are routed through this interface." },
  { id: "delete-interface", label: "Delete virtual interface", kind: "delete", description: "Permanently delete a virtual interface together with its peers.", fields: [], allowedStatuses: active, resourcePrefixes: ["vif:"], impact: "The virtual interface and its peers are permanently removed. All traffic between your network and the VPC through this interface is interrupted." },
  { id: "create-peer", label: "Add peer address family", kind: "action", description: "Add an IPv4 or IPv6 peer to this virtual interface. A virtual interface supports at most two peers, one per address family; the IPv4 peer is created with the interface.", fields: [
    nameField,
    descriptionField,
    { key: "addressFamily", label: "Address family", type: "select", required: true, choices: [{ value: "ipv4", label: "IPv4" }, { value: "ipv6", label: "IPv6" }] },
    routeModeField,
    { key: "localGatewayIp", label: "Cloud-side gateway address", required: true, max: 64, help: "The Huawei-side point-to-point address for this peer." },
    { key: "remoteGatewayIp", label: "Customer-side gateway address", required: true, max: 64, help: "Your-side point-to-point address for this peer." },
    bgpAsnField,
    bgpMd5Field,
    remoteSubnetsField,
  ], allowedStatuses: active, resourcePrefixes: ["vif:"], impact: "The new peer starts forwarding after both sides configure matching addresses and routing. Mismatched settings interrupt this peer's traffic." },
  { id: "inspect-peer", label: "View peer", kind: "inspect", description: "Show the peer's address family, routing, addresses, remote subnets, and BGP state.", fields: [], resourcePrefixes: ["peer:"] },
  { id: "update-peer", label: "Edit peer", kind: "update", description: "Rename the peer, change its description, or replace its remote subnets. Empty optional fields keep their current values.", fields: [nameField, descriptionField, { ...remoteSubnetsField, help: "Leave empty to keep the current remote subnets. CIDRs must match the peer's address family." }], allowedStatuses: peerActive, resourcePrefixes: ["peer:"], confirmation: true, impact: "Replacing remote subnets rewrites which customer networks this peer routes." },
  { id: "delete-peer", label: "Delete peer", kind: "delete", description: "Delete one peer of a virtual interface. The last remaining peer cannot be deleted; delete the virtual interface instead.", fields: [], allowedStatuses: peerActive, resourcePrefixes: ["peer:"], impact: "Routing for this peer's address family stops immediately." },
];

export const directConnectManagement: ManagementAdapter = {
  title: "Direct Connect",
  operations,
  inventory: async (session) => {
    const [gateways, interfaces] = await Promise.all([gatewayRows(session), interfaceRows(session)]);
    return [
      ...gateways.map((gateway) => ({
        id: `vgw:${asString(gateway.id)}`,
        name: firstString([gateway.name], asString(gateway.id)),
        status: firstString([gateway.status], "UNKNOWN"),
        values: { name: firstString([gateway.name], ""), vpcId: firstString([gateway.vpc_id], ""), endpoints: asArray(gateway.local_ep_group).map(String).join(", ") },
      })),
      ...interfaces.flatMap((row) => {
        const peers = row.vif_peers === undefined ? [] : verifiedPeers(row.vif_peers, asString(row.id), session);
        return [
          { id: `vif:${asString(row.id)}`, name: firstString([row.name], asString(row.id)), status: firstString([row.status], "UNKNOWN"), values: { name: firstString([row.name], ""), vlan: Number(row.vlan) || 0, bandwidth: Number(row.bandwidth) || 0, gateway: firstString([row.vgw_id], ""), routeMode: firstString([asRecord(peers[0]).route_mode], "") } },
          ...peers.map((peer) => ({ id: `peer:${asString(row.id)}/${asString(peer.id)}`, name: firstString([peer.name], asString(peer.id)), status: firstString([peer.status], "UNKNOWN"), values: { name: firstString([peer.name], ""), family: firstString([peer.address_family], ""), routeMode: firstString([peer.route_mode], "") } })),
        ];
      }),
    ];
  },
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-gateway") {
      const [vpcs, subnets] = await Promise.all([listVpcsForProject(session), listSubnetsForProject(session)]);
      return { vpcs: vpcs.map((vpc) => ({ value: vpc.id, label: `${vpc.name} · ${vpc.cidr}` })), localSubnets: endpointChoices(vpcs, subnets) };
    }
    if (operation === "create-interface") {
      const [connections, gateways] = await Promise.all([connectionRows(session), gatewayRows(session)]);
      return {
        directConnects: connections.filter((connection) => connection.status === "ACTIVE" && connection.admin_state_up === true && ["standard", "hosting"].includes(asString(connection.type))).map((connection) => ({ value: asString(connection.id), label: `${firstString([connection.name], asString(connection.id))} · ${connection.bandwidth} Mbit/s · VLAN ${connection.vlan ?? "Unknown"}` })),
        virtualGateways: gateways.filter((gateway) => firstString([gateway.status], "") === "ACTIVE" && gateway.type === "default").map((gateway) => ({ value: asString(gateway.id), label: `${firstString([gateway.name], asString(gateway.id))} · ${firstString([gateway.vpc_id], "")}` })),
      };
    }
    if (operation === "update-gateway" && resource) {
      const record = await gatewayRecord(session, gatewayIdOf(resource));
      const vpcId = firstString([record.vpc_id], "");
      const [vpcs, subnets] = await Promise.all([listVpcsForProject(session), listSubnetsForProject(session)]);
      const owned = vpcs.filter((vpc) => vpc.id === vpcId);
      if (!owned.length) return {};
      return { localSubnets: endpointChoices(owned, subnets) };
    }
    return {};
  },
  invalidationKeys: () => [cloudCacheKeys.listDirectConnectConnections, cloudCacheKeys.summary],
  poll: async (session, entry) => {
    const target = entry.resultResourceId ?? entry.resourceId ?? "";
    const deleting = ["Delete virtual gateway", "Delete virtual interface", "Delete peer"].includes(entry.operation);
    if (!["Create virtual gateway", "Create virtual interface", "Add peer address family", "Delete virtual gateway", "Delete virtual interface", "Delete peer"].includes(entry.operation)) throw new ManagementInputError("This operation has no Direct Connect resource-state observation.");
    const prefix = entry.operation.includes("virtual gateway") ? "vgw:" : entry.operation.includes("virtual interface") ? "vif:" : "peer:";
    if (!target.startsWith(prefix)) throw new ManagementInputError("This history entry has a different Direct Connect operation identity.");
    let record: Record<string, unknown>;
    let nativeId: string;
    try {
      if (target.startsWith("vgw:")) {
        nativeId = target.slice(4);
        if (!nativeId || nativeId !== entry.jobId) throw new ManagementInputError("This history entry has a different virtual gateway identity.");
        record = await gatewayRecord(session, nativeId);
      } else if (target.startsWith("vif:")) {
        nativeId = target.slice(4);
        if (!nativeId || nativeId !== entry.jobId) throw new ManagementInputError("This history entry has a different virtual interface identity.");
        record = await interfaceRecord(session, nativeId);
      } else if (target.startsWith("peer:")) {
        const { vifId, peerId } = peerKeyOf({ id: target, name: "" });
        nativeId = peerId;
        if (peerId !== entry.jobId) throw new ManagementInputError("This history entry has a different peer identity.");
        const parent = await interfaceRecord(session, vifId);
        const peer = verifiedPeers(parent.vif_peers, vifId, session).find(row => row.id === peerId);
        if (!peer) return deleting ? { state: "succeeded", message: "The original peer is absent from its verified parent interface.", resourceId: target } : { state: "failed", message: "The original peer is absent from its verified parent interface." };
        record = peer;
      } else throw new ManagementInputError("This history entry has no verified Direct Connect resource identity.");
    } catch (error) {
      if (error instanceof HuaweiApiError && error.status === 404) return deleting ? { state: "succeeded", message: "The original resource is no longer present in native inventory.", resourceId: target } : { state: "failed", message: "The original resource is no longer present in native inventory." };
      throw error;
    }
    if (deleting) return { state: "submitted", message: "Deletion was accepted, but the original resource is still present." };
    if (record.status === "ACTIVE") return { state: "succeeded", message: "The original resource reports ACTIVE. This confirms cloud configuration; end-to-end forwarding also depends on your router.", resourceId: target };
    if (["ERROR", "REJECTED"].includes(firstString([record.status], ""))) return { state: "failed", message: "The original resource reports an unsuccessful native state. Inspect its configuration before retrying." };
    return { state: "submitted", message: "The original resource has not reached a verified ACTIVE state." };
  },
  execute: async (session, operation, values, resource) => {
    const base = `/v3/${session.projectId}/dcaas`;
    if (operation === "create-gateway") {
      const [vpcs, subnets] = await Promise.all([listVpcsForProject(session), listSubnetsForProject(session)]);
      const vpc = vpcs.find((candidate) => candidate.id === values.vpc);
      if (!vpc) throw new ManagementInputError("The selected VPC is no longer available in this project.", 404);
      const endpoints = parseEndpointSelection(values.localSubnets, vpc.id, vpcs, subnets);
      if (!endpoints.length) throw new ManagementInputError("Select at least one local endpoint.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "dc", `${base}/virtual-gateways`, { method: "POST", body: JSON.stringify({ virtual_gateway: { vpc_id: vpc.id, name: values.name, local_ep_group: endpoints, ...(values.description ? { description: String(values.description) } : {}) } }) });
      const { id, record } = verifiedAcknowledgement(response, "virtual_gateway", session);
      if (record.vpc_id !== vpc.id) throw new Error("Huawei returned a virtual gateway for a different VPC. Check native state before retrying.");
      return { message: "Virtual gateway creation accepted. Observe its native status; attach a virtual interface to forward traffic through it.", resourceId: `vgw:${id}`, jobId: id, asynchronous: true };
    }
    if (operation === "inspect-gateway") {
      const record = await gatewayRecord(session, gatewayIdOf(resource));
      return { message: "Virtual gateway details loaded.", facts: [
        { label: "VPC", value: firstString([record.vpc_id], "-") },
        { label: "Local endpoints (IPv4)", value: asArray(record.local_ep_group).map(String).join(", ") || "None" },
        { label: "Local endpoints (IPv6)", value: asArray(record.local_ep_group_ipv6).map(String).join(", ") || "None" },
        { label: "BGP ASN", value: record.bgp_asn ? String(record.bgp_asn) : "Auto-assigned" },
        { label: "Status", value: firstString([record.status], "-") },
        { label: "Admin state", value: record.admin_state_up === false ? "Down" : "Up" },
        { label: "Type", value: firstString([record.type], "-") },
        { label: "Enterprise project", value: firstString([record.enterprise_project_id], "-") },
        { label: "Devices", value: [firstString([record.device_id], ""), firstString([record.redundant_device_id], "")].filter(Boolean).join(", ") || "-" },
      ] };
    }
    if (operation === "update-gateway") {
      const id = gatewayIdOf(resource);
      const record = await gatewayRecord(session, id);
      assertProjectOwned(record, session, "virtual gateway");
      assertReady(record, "virtual gateway");
      const body: Record<string, unknown> = { name: values.name };
      if (values.description) body.description = String(values.description);
      if (Array.isArray(values.localSubnets) && values.localSubnets.length) {
        const [vpcs, subnets] = await Promise.all([listVpcsForProject(session), listSubnetsForProject(session)]);
        const vpcId = firstString([record.vpc_id], "");
        if (!vpcs.some((vpc) => vpc.id === vpcId)) throw new ManagementInputError("The gateway's VPC is no longer available in this project.", 409);
        body.local_ep_group = parseEndpointSelection(values.localSubnets, vpcId, vpcs, subnets);
      }
      const response = await huaweiFetch<Record<string, unknown>>(session, "dc", `${base}/virtual-gateways/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ virtual_gateway: body }) });
      verifiedAcknowledgement(response, "virtual_gateway", session, id);
      return { message: "Virtual gateway update accepted. Inspect its current configuration to verify the change.", resourceId: resource!.id };
    }
    if (operation === "delete-gateway") {
      const id = gatewayIdOf(resource);
      const record = await gatewayRecord(session, id);
      assertProjectOwned(record, session, "virtual gateway");
      assertReady(record, "virtual gateway");
      const children = await interfaceRows(session, id);
      if (children.length) throw new ManagementInputError(`The virtual gateway still has ${children.length} virtual interface${children.length === 1 ? "" : "s"}. Delete them first.`, 409);
      await huaweiFetch(session, "dc", `${base}/virtual-gateways/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { message: "Virtual gateway deletion accepted; observe removal from native inventory.", resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    if (operation === "create-interface") {
      const routeMode = String(values.routeMode);
      const bgp = bgpSettings(routeMode, values);
      const remoteSubnets = cidrList(values.remoteSubnets, "ipv4", "Remote subnet");
      if (routeMode === "static" && !remoteSubnets.length) throw new ManagementInputError("Static routing requires at least one remote subnet CIDR.");
      const localGatewayIp = String(values.localGatewayIp);
      const remoteGatewayIp = String(values.remoteGatewayIp);
      assertGatewayAddress(localGatewayIp, "ipv4", "Cloud-side gateway address");
      assertGatewayAddress(remoteGatewayIp, "ipv4", "Customer-side gateway address");
      const vlan = Number(values.vlan);
      const bandwidth = Number(values.bandwidth);
      if (!Number.isSafeInteger(vlan) || vlan < 0 || vlan > 3999 || !Number.isSafeInteger(bandwidth) || bandwidth < 2 || bandwidth > 2147483647) throw new ManagementInputError("Select a valid VLAN and bandwidth.");
      const [connections, gateways] = await Promise.all([connectionRows(session), gatewayRows(session)]);
      const connection = connections.find((candidate) => candidate.id === values.directConnect);
      if (!connection) throw new ManagementInputError("The selected Direct Connect connection is no longer available in this project.", 404);
      if (connection.status !== "ACTIVE") throw new ManagementInputError(`The Direct Connect connection is ${connection.status}; wait until it is ACTIVE.`, 409);
      assertCircuitCapacity(connection, bandwidth);
      if (!["standard", "hosting"].includes(asString(connection.type))) throw new ManagementInputError("The selected connection has an unverified native type.", 409);
      if (connection.type === "hosting") {
        const connectionVlan = Number(connection.vlan);
        if (connection.vlan === undefined || !Number.isSafeInteger(connectionVlan) || connectionVlan < 0 || connectionVlan > 3999) throw new ManagementInputError("Huawei returned an unverified hosted connection VLAN.", 409);
        if (connectionVlan !== vlan) throw new ManagementInputError(`Hosted connections require the interface VLAN to match the connection VLAN (${connection.vlan}).`, 409);
      }
      const gateway = gateways.find((candidate) => asString(candidate.id) === values.virtualGateway);
      if (!gateway) throw new ManagementInputError("The selected virtual gateway is no longer available in this project.", 404);
      assertProjectOwned(gateway, session, "virtual gateway");
      assertReady(gateway, "virtual gateway");
      if (gateway.type !== "default") throw new ManagementInputError("Select a verified VPC virtual gateway.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "dc", `${base}/virtual-interfaces`, { method: "POST", body: JSON.stringify({ virtual_interface: {
        name: values.name,
        type: "private",
        address_family: "ipv4",
        direct_connect_id: connection.id,
        vgw_id: asString(gateway.id),
        vlan,
        bandwidth,
        route_mode: routeMode,
        local_gateway_v4_ip: localGatewayIp,
        remote_gateway_v4_ip: remoteGatewayIp,
        ...bgp,
        ...(remoteSubnets.length ? { remote_ep_group: remoteSubnets } : {}),
        ...(values.description ? { description: String(values.description) } : {}),
      } }) });
      const { id, record } = verifiedAcknowledgement(response, "virtual_interface", session);
      if (record.vgw_id !== gateway.id || record.direct_connect_id !== connection.id) throw new Error("Huawei returned a virtual interface with different parents. Check native state before retrying.");
      return { message: "Virtual interface creation accepted. Observe its native status and configure matching routing on your router; cloud configuration alone does not confirm end-to-end forwarding.", resourceId: `vif:${id}`, jobId: id, asynchronous: true };
    }
    if (operation === "inspect-interface") {
      const record = await interfaceRecord(session, interfaceIdOf(resource));
      const peers = verifiedPeers(record.vif_peers, firstString([record.id], ""), session);
      return { message: "Virtual interface details loaded.", facts: [
        { label: "Virtual gateway", value: firstString([record.vgw_id], "-") },
        { label: "Direct Connect connection", value: firstString([record.direct_connect_id], "-") },
        { label: "VLAN", value: String(record.vlan ?? "-") },
        { label: "Bandwidth", value: record.bandwidth ? `${record.bandwidth} Mbit/s` : "-" },
        { label: "Priority", value: firstString([record.priority], "-") },
        { label: "Address family", value: firstString([record.address_family], "-") },
        { label: "Cloud-side address", value: firstString([record.local_gateway_v4_ip, record.local_gateway_v6_ip], "-") },
        { label: "Customer-side address", value: firstString([record.remote_gateway_v4_ip, record.remote_gateway_v6_ip], "-") },
        { label: "Remote subnets", value: asArray(record.remote_ep_group).map(String).join(", ") || "None" },
        { label: "Status", value: firstString([record.status], "-") },
        { label: "Admin state", value: record.admin_state_up === false ? "Down" : "Up" },
        { label: "Route limit", value: String(record.route_limit ?? "-") },
        { label: "Created", value: firstString([record.create_time, record.created_at], "-") },
        { label: "Updated", value: firstString([record.update_time, record.updated_at], "-") },
        ...peers.map((peer) => ({ label: `Peer ${firstString([peer.name], "-")} · ${firstString([peer.address_family], "-")}`, value: `${firstString([peer.route_mode], "-")} · ${firstString([peer.status], "-")}${peer.bgp_asn ? ` · ASN ${peer.bgp_asn}` : ""}${peer.receive_route_num !== undefined ? ` · ${peer.receive_route_num} routes received` : ""}` })),
      ] };
    }
    if (operation === "update-interface") {
      const id = interfaceIdOf(resource);
      const record = await interfaceRecord(session, id);
      assertProjectOwned(record, session, "virtual interface");
      assertReady(record, "virtual interface");
      const body: Record<string, unknown> = { name: values.name };
      if (values.description) body.description = String(values.description);
      if (values.bandwidth !== undefined) {
        const bandwidth = Number(values.bandwidth);
        if (!Number.isSafeInteger(bandwidth) || bandwidth < 2 || bandwidth > 2147483647) throw new ManagementInputError("Bandwidth must be an integer from 2 to 2147483647 Mbit/s.");
        if (bandwidth === Number(record.bandwidth)) throw new ManagementInputError(`The new bandwidth must differ from the current ${record.bandwidth} Mbit/s.`, 409);
        const connections = await connectionRows(session);
        assertCircuitCapacity(connections.find(row => row.id === record.direct_connect_id), bandwidth);
        body.bandwidth = bandwidth;
      }
      if (values.priority !== undefined) {
        if (!asArray(record.vif_peers).map(asRecord).some((peer) => firstString([peer.route_mode], "") === "bgp")) throw new ManagementInputError("Priority applies to BGP-routed interfaces only.", 409);
        body.priority = String(values.priority);
      }
      if (Array.isArray(values.remoteSubnets) && values.remoteSubnets.length) {
        const reportedFamily = firstString([record.address_family], "");
        if (!["ipv4", "ipv6"].includes(reportedFamily)) throw new ManagementInputError("Huawei returned an unverified interface address family.", 409);
        const family = reportedFamily === "ipv6" ? "ipv6" : "ipv4";
        body.remote_ep_group = cidrList(values.remoteSubnets, family, "Remote subnet");
      }
      const response = await huaweiFetch<Record<string, unknown>>(session, "dc", `${base}/virtual-interfaces/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ virtual_interface: body }) });
      verifiedAcknowledgement(response, "virtual_interface", session, id);
      return { message: "Virtual interface update accepted. Inspect its current configuration to verify the change.", resourceId: resource!.id };
    }
    if (operation === "delete-interface") {
      const id = interfaceIdOf(resource);
      const record = await interfaceRecord(session, id);
      assertProjectOwned(record, session, "virtual interface");
      assertReady(record, "virtual interface");
      await huaweiFetch(session, "dc", `${base}/virtual-interfaces/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { message: "Virtual interface deletion accepted. Traffic is interrupted; observe native removal.", resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    if (operation === "create-peer") {
      const vifId = interfaceIdOf(resource);
      const record = await interfaceRecord(session, vifId);
      assertProjectOwned(record, session, "virtual interface");
      assertReady(record, "virtual interface");
      const peers = verifiedPeers(record.vif_peers, firstString([record.id], ""), session);
      if (peers.length >= 2) throw new ManagementInputError("This virtual interface already has the maximum of two peers.", 409);
      const requestedFamily = String(values.addressFamily);
      if (requestedFamily !== "ipv4" && requestedFamily !== "ipv6") throw new ManagementInputError("Select an address family.");
      const family: "ipv4" | "ipv6" = requestedFamily;
      if (peers.some((peer) => firstString([peer.address_family], "") === family)) throw new ManagementInputError(`This virtual interface already has an ${family} peer.`, 409);
      const routeMode = String(values.routeMode);
      const bgp = bgpSettings(routeMode, values);
      const remoteSubnets = cidrList(values.remoteSubnets, family, "Remote subnet");
      if (routeMode === "static" && !remoteSubnets.length) throw new ManagementInputError("Static routing requires at least one remote subnet CIDR.");
      const localGatewayIp = String(values.localGatewayIp);
      const remoteGatewayIp = String(values.remoteGatewayIp);
      assertGatewayAddress(localGatewayIp, family, "Cloud-side gateway address");
      assertGatewayAddress(remoteGatewayIp, family, "Customer-side gateway address");
      const response = await huaweiFetch<Record<string, unknown>>(session, "dc", `${base}/vif-peers`, { method: "POST", body: JSON.stringify({ vif_peer: {
        name: values.name,
        vif_id: vifId,
        address_family: family,
        route_mode: routeMode,
        local_gateway_ip: localGatewayIp,
        remote_gateway_ip: remoteGatewayIp,
        ...bgp,
        ...(remoteSubnets.length ? { remote_ep_group: remoteSubnets } : {}),
        ...(values.description ? { description: String(values.description) } : {}),
      } }) });
      const { id, record: peer } = verifiedAcknowledgement(response, "vif_peer", session);
      if (peer.vif_id !== vifId || peer.address_family !== family) throw new Error("Huawei returned a peer with a different parent or address family. Check native state before retrying.");
      return { message: "Peer creation accepted. Observe its native status and configure matching addresses and routing on your router.", resourceId: `peer:${vifId}/${id}`, jobId: id, asynchronous: true };
    }
    if (operation === "inspect-peer" || operation === "update-peer" || operation === "delete-peer") {
      const { vifId, peerId } = peerKeyOf(resource);
      const record = await interfaceRecord(session, vifId);
      const peers = verifiedPeers(record.vif_peers, firstString([record.id], ""), session);
      const peer = peers.find((candidate) => asString(candidate.id) === peerId);
      if (!peer) throw new ManagementInputError("The peer was not found on this virtual interface.", 404);
      const linkedVif = firstString([peer.vif_id], "");
      if (linkedVif && linkedVif !== vifId) throw new ManagementInputError("The peer does not belong to this virtual interface.", 409);
      if (operation === "inspect-peer") {
        return { message: "Peer details loaded.", facts: [
          { label: "Address family", value: firstString([peer.address_family], "-") },
          { label: "Route mode", value: firstString([peer.route_mode], "-") },
          { label: "Cloud-side address", value: firstString([peer.local_gateway_ip], "-") },
          { label: "Customer-side address", value: firstString([peer.remote_gateway_ip], "-") },
          { label: "Remote subnets", value: asArray(peer.remote_ep_group).map(String).join(", ") || "None" },
          { label: "BGP ASN", value: peer.bgp_asn ? String(peer.bgp_asn) : "-" },
          { label: "BGP status", value: firstString([peer.bgp_status], "-") },
          { label: "BGP route limit", value: String(peer.bgp_route_limit ?? "-") },
          { label: "Routes received", value: String(peer.receive_route_num ?? "-") },
          { label: "BFD", value: peer.enable_bfd === true ? "Enabled" : "Disabled" },
          { label: "NQA", value: peer.enable_nqa === true ? "Enabled" : "Disabled" },
          { label: "Status", value: firstString([peer.status], "-") },
          { label: "Device", value: firstString([peer.device_id], "-") },
        ] };
      }
      assertProjectOwned(record, session, "virtual interface");
      assertReady(record, "virtual interface");
      assertProjectOwned(peer, session, "peer");
      assertReady(peer, "peer", peerActive);
      if (operation === "update-peer") {
        const body: Record<string, unknown> = { name: values.name };
        if (values.description) body.description = String(values.description);
        if (Array.isArray(values.remoteSubnets) && values.remoteSubnets.length) {
          const family = firstString([peer.address_family], "") === "ipv6" ? "ipv6" : "ipv4";
          body.remote_ep_group = cidrList(values.remoteSubnets, family, "Remote subnet");
        }
        const response = await huaweiFetch<Record<string, unknown>>(session, "dc", `${base}/vif-peers/${encodeURIComponent(peerId)}`, { method: "PUT", body: JSON.stringify({ vif_peer: body }) });
        verifiedAcknowledgement(response, "vif_peer", session, peerId);
        return { message: "Peer update accepted. Inspect its current configuration to verify the change.", resourceId: resource!.id };
      }
      if (peers.length <= 1) throw new ManagementInputError("A virtual interface must keep at least one peer; delete the virtual interface instead.", 409);
      await huaweiFetch(session, "dc", `${base}/vif-peers/${encodeURIComponent(peerId)}`, { method: "DELETE" });
      return { message: "Peer deletion accepted. Routing for this address family stops; observe native removal.", resourceId: resource!.id, jobId: peerId, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported Direct Connect operation.");
  },
};
