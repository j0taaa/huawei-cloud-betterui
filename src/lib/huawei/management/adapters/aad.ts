import "server-only";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { isIP } from "node:net";
import { asArray, asRecord, asString, firstString, numberWithUnit, timestampSeconds } from "@/lib/huawei/parsers";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import { aadDomains, aadFetch, aadInstanceBlackwhite, aadInstanceRules, aadInstances, aadPackages, aadPolicies, aadProtectedIps, aadRowName, aadUnboundIps, aadVerifyEcho } from "@/lib/huawei/services/aad-native";
import type { ManagementAdapter } from "../types";

// Anti-DDoS Advanced Protection management. CNAD /v1/cnad calls are global account-token calls
// proved through IAM by the shared native helper, while AAD /v1/aad, /v2/aad, and
// /v1/{project}/aad/external calls use the selected project's token, so the adapter itself is not
// account-wide. Writes verify their result by re-reading native state whenever a read API exists;
// outcomes that Huawei only acknowledges without a verifiable completion (policy protocol
// handling, unreadable black/white lists, web protection switches, rule creation without a native
// rule ID, and not-yet-visible or still-listed changes) are reported as asynchronous accepted
// work without a fabricated job ID so the framework records them as submitted manual follow-ups.
const aadInventoryKey = cloudCacheKeys.listAadProtection;
const domainNamePattern = "^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$";
const external = (s: BetterUiSession) => `/v1/${s.projectId}/aad/external`;

function findOwnedRow(rows: Record<string, unknown>[], resource: ManagementResource | undefined, prefix: string, label: string, idKey: string) {
  if (!resource?.id.startsWith(`${prefix}:`)) throw new ManagementInputError(`Select a current Anti-DDoS ${label}.`);
  const id = resource.id.slice(prefix.length + 1);
  const row = rows.find(item => String(item[idKey]) === id);
  if (!row) throw new ManagementInputError(`The Anti-DDoS ${label} no longer exists in this account.`, 404);
  return { id, row };
}

async function findOwned(s: BetterUiSession, resource: ManagementResource | undefined, prefix: string, label: string, list: () => Promise<Record<string, unknown>[]>, idKey: string) {
  return findOwnedRow(await list(), resource, prefix, label, idKey);
}

// Mutations require the resource's current fresh name to match the selection, so a renamed
// package, policy, or domain can never be changed or deleted through a stale confirmation.
async function owned(s: BetterUiSession, resource: ManagementResource | undefined, prefix: string, label: string, list: () => Promise<Record<string, unknown>[]>, idKey: string, nameOf: (row: Record<string, unknown>) => string) {
  const found = await findOwned(s, resource, prefix, label, list, idKey);
  if (resource!.name !== nameOf(found.row)) throw new ManagementInputError(`The selected Anti-DDoS ${label} was renamed or the selection is stale. Refresh the list and try again.`, 409);
  return found;
}

async function ownedPolicy(s: BetterUiSession, resource: ManagementResource | undefined) {
  const policy = await owned(s, resource, "policy", "policy", () => aadPolicies(s), "id", aadRowName.policy);
  const packageId = typeof policy.row.package_id === "string" && policy.row.package_id ? policy.row.package_id : undefined;
  if (!packageId) throw new ManagementInputError("The policy's Anti-DDoS package could not be verified. Refresh the list and retry.");
  const policyName = typeof policy.row.name === "string" && policy.row.name.trim() ? policy.row.name : undefined;
  return { ...policy, packageId, policyName };
}

// Binding changes are verified through the policy's name, so the name must be known and nonempty
// beforehand and no other policy in the account may share it.
async function ownedPolicyForBinding(s: BetterUiSession, resource: ManagementResource | undefined) {
  const rows = await aadPolicies(s);
  const found = findOwnedRow(rows, resource, "policy", "policy", "id");
  if (resource!.name !== aadRowName.policy(found.row)) throw new ManagementInputError("The selected Anti-DDoS policy was renamed or the selection is stale. Refresh the list and try again.", 409);
  const policyName = typeof found.row.name === "string" && found.row.name.trim() ? found.row.name : undefined;
  if (!policyName) throw new ManagementInputError("The policy's current name could not be verified. Refresh the list and retry.");
  if (rows.some(row => row !== found.row && row.name === policyName)) throw new ManagementInputError("Another Anti-DDoS policy in this account has the same name, so binding changes cannot be verified. Rename one policy first.", 409);
  const packageId = typeof found.row.package_id === "string" && found.row.package_id ? found.row.package_id : undefined;
  if (!packageId) throw new ManagementInputError("The policy's Anti-DDoS package could not be verified. Refresh the list and retry.");
  return { id: found.id, row: found.row, packageId, policyName };
}

async function showPolicy(s: BetterUiSession, policyId: string, expectedPackageId?: string) {
  const detail = await aadFetch(s, `/v1/cnad/policies/${encodeURIComponent(policyId)}`);
  if (typeof detail.id !== "string" || detail.id !== policyId) throw new ManagementInputError("Huawei returned a different AAD policy.", 404);
  if (expectedPackageId !== undefined) aadVerifyEcho(detail, "package_id", expectedPackageId);
  return detail;
}

function ipEntries(values: unknown[], label: string) {
  const ips: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !isIP(value)) throw new Error(`Huawei returned an invalid entry in the AAD ${label}.`);
    ips.push(value);
  }
  return ips;
}

// The black/white lists are only known when both native arrays actually exist; entries must be valid IPs.
function bwLists(detail: Record<string, unknown>) {
  const bw = asRecord(asRecord(detail.pop_policy).bw_list);
  if (!Array.isArray(bw.black_ip_list) || !Array.isArray(bw.white_ip_list)) return { known: false, black: [] as string[], white: [] as string[] };
  return { known: true, black: ipEntries(bw.black_ip_list, "blacklist"), white: ipEntries(bw.white_ip_list, "whitelist") };
}

function instanceIps(instance: Record<string, unknown>) {
  const ips = instance.ips;
  if (!Array.isArray(ips) || !ips.length) throw new Error("Huawei returned no IP list for this AAD instance.");
  const rows = ips.map(asRecord);
  for (const entry of rows) if (typeof entry.ip !== "string" || !entry.ip.trim()) throw new Error("Huawei returned an AAD instance IP without an address.");
  return rows;
}

function ownedInstanceIp(instance: Record<string, unknown>, value: unknown) {
  const ips = instanceIps(instance).map(entry => String(entry.ip));
  if (typeof value !== "string" || !ips.includes(value)) throw new ManagementInputError("Select an IP address that belongs to this Anti-DDoS instance.", 404);
  return value;
}

function ipList(value: unknown, label: string, max: number) {
  const entries = String(value ?? "").split(/[\s,;]+/).map(entry => entry.trim()).filter(Boolean);
  if (!entries.length) throw new ManagementInputError(`Enter at least one ${label} IP address.`);
  const unique = [...new Set(entries)];
  if (unique.length > max) throw new ManagementInputError(`Enter at most ${max} ${label} IP addresses.`);
  for (const entry of unique) if (!isIP(entry)) throw new ManagementInputError(`${label} entries must be valid IPv4 or IPv6 addresses.`);
  return unique;
}

function portList(value: unknown, label: string) {
  const ports = [...new Set(asArray(value).map(item => String(item).trim()).filter(Boolean))].map(Number);
  if (ports.some(port => !Number.isSafeInteger(port) || port < 1 || port > 65535)) throw new ManagementInputError(`${label} must be whole ports between 1 and 65535.`);
  return ports;
}

function originAddress(value: unknown, type: string) {
  const text = String(value ?? "").trim();
  if (type === "0") {
    if (!isIP(text)) throw new ManagementInputError("Enter one origin IPv4 or IPv6 address.");
    return text;
  }
  if (!new RegExp(domainNamePattern, "u").test(text)) throw new ManagementInputError("Enter one origin domain name.");
  return text;
}

function ruleSelection(value: unknown) {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { throw new ManagementInputError("Select a forwarding rule."); }
  const record = asRecord(parsed);
  if (typeof record.ip !== "string" || !record.ip || typeof record.ruleId !== "string" || !record.ruleId) throw new ManagementInputError("Select a forwarding rule.");
  return { ip: record.ip, ruleId: record.ruleId };
}

type ForwardingRule = { ruleId: string; protocol: string; forwardPort: number; sourcePort: number; sourceIp: string; status: unknown };

// Only TCP and UDP are known forwarding protocols; any other native value is reported as Unknown
// instead of echoing a raw code, and unusable rows block management.
function parseRule(row: Record<string, unknown>): ForwardingRule {
  if (typeof row.rule_id !== "string" || !row.rule_id) throw new Error("Huawei returned a forwarding rule without a usable ID.");
  if (typeof row.forward_protocol !== "string" || !row.forward_protocol.trim()) throw new Error("Huawei returned a forwarding rule without a usable protocol.");
  if (typeof row.forward_port !== "number" || !Number.isSafeInteger(row.forward_port) || row.forward_port < 1 || row.forward_port > 65535) throw new Error("Huawei returned a forwarding rule without a usable forwarding port.");
  if (typeof row.source_port !== "number" || !Number.isSafeInteger(row.source_port) || row.source_port < 1 || row.source_port > 65535) throw new Error("Huawei returned a forwarding rule without a usable origin port.");
  if (typeof row.source_ip !== "string" || !row.source_ip.trim()) throw new Error("Huawei returned a forwarding rule without usable origin addresses.");
  return { ruleId: row.rule_id, protocol: row.forward_protocol === "tcp" || row.forward_protocol === "udp" ? row.forward_protocol : "Unknown", forwardPort: row.forward_port, sourcePort: row.source_port, sourceIp: row.source_ip, status: row.status };
}

// A batch acknowledgement only proves native acceptance for the single submitted rule; zero or
// unexpected counts after a write stay uncertain instead of claiming a definitive rejection.
function verifyBatchAck(result: Record<string, unknown>, label: string) {
  const success = result.success_num;
  if (typeof success !== "number" || !Number.isSafeInteger(success)) throw new Error(`Huawei returned no verifiable confirmation for the ${label}. Check rules before retrying.`);
  if (success !== 1) throw new Error(`Huawei acknowledged the ${label} but its result is uncertain. Check rules before retrying.`);
}

async function ipOwners(s: BetterUiSession) {
  const owners = new Map<string, Record<string, unknown>[]>();
  for (const row of await aadInstances(s)) for (const entry of instanceIps(row)) {
    const ip = String(entry.ip);
    owners.set(ip, [...(owners.get(ip) ?? []), row]);
  }
  return owners;
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? String(value) : "-");
const pair = (current: unknown, total: unknown) => (typeof current === "number" && typeof total === "number" ? `${current} of ${total}` : "-");
// Native status codes are only reported from the known whitelist; anything else is Unknown.
const knownStatus = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2 ? String(value) : "Unknown");
const originLabel = (type: unknown, servers: unknown) => {
  const kind = typeof type === "number" && Number.isSafeInteger(type) ? type : undefined;
  return `${asString(servers, "-")} (${kind === 0 ? "origin IP" : kind === 1 ? "origin domain" : "Unknown"})`;
};

// A policy binding is only reported as unbound when the native field is a known empty string.
function policyBindingLabel(row: Record<string, unknown>) {
  if (typeof row.policy_name !== "string") return "Unknown";
  return row.policy_name.trim() ? row.policy_name : "Unbound";
}

function nativeList(value: unknown, allowed?: string[]) {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) return "Unknown";
  const entries = value.filter(item => item.trim());
  if (allowed && entries.some(item => !allowed.includes(item))) return "Unknown";
  return entries.length ? entries.join(", ") : "None reported";
}

const policyNameField: ManagementField = { key: "name", label: "Policy name", required: true, max: 128 };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 512, allowEmpty: true };
const packageChoice: ManagementField = { key: "package", label: "Anti-DDoS package", type: "select", source: "packages", required: true };
const bwTypeField: ManagementField = { key: "type", label: "List type", type: "select", required: true, choices: [{ value: "black", label: "Blacklist (drop)" }, { value: "white", label: "Whitelist (allow)" }] };
const bwIpsField: ManagementField = { key: "ips", label: "IP addresses", type: "textarea", required: true, maxBytes: 8192, help: "IPv4 or IPv6 addresses, one per line or comma-separated. Blacklisted traffic is dropped and whitelisted addresses bypass cleaning." };
const thresholdField: ManagementField = { key: "threshold", label: "Cleaning threshold", type: "number", required: true, min: 1, help: "Traffic cleaning starts above this threshold for every protected IP bound to the policy." };
const protocolField = (key: string, label: string): ManagementField => ({ key, label, type: "select", required: true, choices: [{ value: "block", label: "Block" }, { value: "unblock", label: "Allow" }, { value: "limiting", label: "Rate-limit" }] });
const limitingField = (key: string, label: string): ManagementField => ({ key, label, type: "number", min: 1, help: "Required positive whole number while this protocol is set to rate-limit. Leave it empty when the protocol is not rate-limited." });
const ruleIpField: ManagementField = { key: "ip", label: "Instance IP", type: "select", source: "instanceIps", required: true };
const ruleProtocolField: ManagementField = { key: "protocol", label: "Forwarding protocol", type: "select", required: true, choices: [{ value: "tcp", label: "TCP" }, { value: "udp", label: "UDP" }] };
const rulePortField = (key: string, label: string): ManagementField => ({ key, label, type: "number", required: true, min: 1, max: 65535 });
const ruleSourceField: ManagementField = { key: "sourceIp", label: "Origin IP addresses", required: true, max: 2048, help: "Comma-separated origin IPv4/IPv6 addresses, up to 20. Traffic received on the forwarding port is forwarded to these origins." };
const ruleChoiceField: ManagementField = { key: "rule", label: "Forwarding rule", type: "select", source: "ipRules", required: true };
const realServerTypeField: ManagementField = { key: "realServerType", label: "Origin type", type: "select", required: true, choices: [{ value: "0", label: "Origin IP address" }, { value: "1", label: "Origin domain name" }] };
const realServerField: ManagementField = { key: "realServer", label: "Origin address", required: true, max: 255 };
const portListField = (key: string, label: string): ManagementField => ({ key, label, type: "list", help: "Port numbers, one per entry. At least one HTTP or HTTPS port is required." });

const limitFields = [
  { protocol: "udp", key: "udpTrafficLimiting", body: "udp_traffic_limiting", label: "UDP rate limit" },
  { protocol: "udp", key: "udpFragmentRateLimiting", body: "udp_fragment_rate_limiting", label: "UDP fragment rate limit" },
  { protocol: "tcp", key: "tcpTrafficLimiting", body: "tcp_traffic_limiting", label: "TCP rate limit" },
  { protocol: "tcp", key: "tcpFragmentRateLimiting", body: "tcp_fragment_rate_limiting", label: "TCP fragment rate limit" },
  { protocol: "icmp", key: "icmpTrafficLimiting", body: "icmp_traffic_limiting", label: "ICMP rate limit" },
  { protocol: "other", key: "otherTrafficLimiting", body: "other_traffic_limiting", label: "Other protocols rate limit" },
] as const;

export const aadManagement: ManagementAdapter = {
  title: "Anti-DDoS Advanced Protection",
  operations: [
    { id: "create-policy", label: "Create protection policy", kind: "create", description: "Create one protection policy on a current Anti-DDoS package. Policies organize protected IPs and their cleaning settings; purchasing, renewing, or cancelling packages is not part of this workflow.", fields: [policyNameField, packageChoice, descriptionField] },
    { id: "inspect-package", label: "View package", kind: "inspect", resourcePrefixes: ["package:"], description: "Inspect the package's native quotas, bandwidths, and policy count.", fields: [] },
    { id: "rename-package", label: "Rename package", kind: "update", resourcePrefixes: ["package:"], description: "Rename the package without changing its protection, bandwidth, or billing. Package purchase, renewal, refund, and cancellation are not part of this workflow.", fields: [{ key: "name", label: "Package name", required: true, max: 128 }] },
    { id: "package-ips", label: "View protected IPs", kind: "inspect", resourcePrefixes: ["package:"], description: "List this package's protected IPs with their policy bindings and unbound count.", fields: [] },
    { id: "inspect-policy", label: "View policy", kind: "inspect", resourcePrefixes: ["policy:"], description: "Inspect the policy's cleaning threshold, protocol handling summary, and black/white list counts.", fields: [] },
    { id: "policy-settings", label: "Replace protection settings", kind: "update", resourcePrefixes: ["policy:"], description: "Replace the policy's name, description, cleaning threshold, and complete protocol handling. Every protocol must be set explicitly, and every rate-limited protocol requires its rate limits.", fields: [policyNameField, descriptionField, thresholdField, protocolField("udp", "UDP handling"), protocolField("tcp", "TCP handling"), protocolField("icmp", "ICMP handling"), protocolField("other", "Other protocols"), limitingField("udpTrafficLimiting", "UDP rate limit"), limitingField("udpFragmentRateLimiting", "UDP fragment rate limit"), limitingField("tcpTrafficLimiting", "TCP rate limit"), limitingField("tcpFragmentRateLimiting", "TCP fragment rate limit"), limitingField("icmpTrafficLimiting", "ICMP rate limit"), limitingField("otherTrafficLimiting", "Other protocols rate limit")], confirmation: true, impact: "These settings replace the policy's complete protocol handling for every bound protected IP. Blocking drops traffic, rate-limiting throttles it, and a wrong cleaning threshold can leave attacks uncleaned or clean legitimate traffic." },
    { id: "policy-blackwhite", label: "View black/white lists", kind: "inspect", resourcePrefixes: ["policy:"], description: "List the policy's native black and white IP lists.", fields: [] },
    { id: "policy-blackwhite-add", label: "Add black/white entries", kind: "action", resourcePrefixes: ["policy:"], description: "Add IPv4/IPv6 addresses to this policy's black or white list.", fields: [bwTypeField, bwIpsField], confirmation: true, impact: "Blacklisted addresses are dropped for every protected IP bound to this policy; whitelisted addresses bypass cleaning for them." },
    { id: "policy-blackwhite-delete", label: "Remove black/white entries", kind: "action", resourcePrefixes: ["policy:"], description: "Remove addresses from this policy's black or white list.", fields: [bwTypeField, bwIpsField], confirmation: true, impact: "Removed entries return to normal cleaning. Removing a whitelist entry can drop traffic that depended on it; removing a blacklist entry restores cleaning for that address." },
    { id: "bind-ips", label: "Bind protected IPs", kind: "update", resourcePrefixes: ["policy:"], description: "Bind unbound protected IPs from this policy's package to this policy.", fields: [{ key: "ips", label: "Protected IPs", type: "list", source: "bindableIps", required: true }], confirmation: true, impact: "This policy's cleaning threshold, protocol handling, and black/white lists start applying to the selected protected IPs." },
    { id: "unbind-ips", label: "Unbind protected IPs", kind: "update", resourcePrefixes: ["policy:"], description: "Unbind protected IPs from this policy.", fields: [{ key: "ips", label: "Protected IPs", type: "list", source: "boundIps", required: true }], confirmation: true, impact: "The selected protected IPs lose this policy's cleaning settings and fall back to the package defaults." },
    { id: "inspect-protected-ip", label: "View protected IP", kind: "inspect", resourcePrefixes: ["protected-ip:"], description: "Inspect the protected IP's native status, policy, package, and tag.", fields: [] },
    { id: "tag-protected-ip", label: "Edit protected IP tag", kind: "update", resourcePrefixes: ["protected-ip:"], description: "Set or clear the protected IP's local tag. Tags are labels only and never change protection.", fields: [{ key: "tag", label: "Tag", max: 128, allowEmpty: true }] },
    { id: "inspect-instance", label: "View instance", kind: "inspect", resourcePrefixes: ["instance:"], description: "Inspect the high-defense instance's IPs, bandwidths, and expiry.", fields: [] },
    { id: "instance-blackwhite", label: "View instance black/white lists", kind: "inspect", resourcePrefixes: ["instance:"], description: "List this instance's native black and white IP lists from the v2 read API.", fields: [] },
    { id: "instance-blackwhite-add", label: "Add instance black/white entries", kind: "action", resourcePrefixes: ["instance:"], description: "Add IPv4/IPv6 addresses to this instance's black or white list and verify them against the native list.", fields: [bwTypeField, bwIpsField], confirmation: true, impact: "Blacklisted addresses are dropped by this high-defense instance; whitelisted addresses bypass its filtering." },
    { id: "instance-blackwhite-delete", label: "Remove instance black/white entries", kind: "action", resourcePrefixes: ["instance:"], description: "Remove addresses from this instance's black or white list and verify them against the native list.", fields: [bwTypeField, bwIpsField], confirmation: true, impact: "Removed entries return to this instance's normal filtering." },
    { id: "instance-rules", label: "View forwarding rules", kind: "inspect", resourcePrefixes: ["instance:"], description: "List the forwarding rules of one instance IP.", fields: [ruleIpField] },
    { id: "create-rule", label: "Create forwarding rule", kind: "action", resourcePrefixes: ["instance:"], description: "Create one TCP/UDP forwarding rule on one instance IP.", fields: [ruleIpField, ruleProtocolField, rulePortField("forwardPort", "Forwarding port"), rulePortField("sourcePort", "Origin port"), ruleSourceField], confirmation: true, impact: "Traffic to this high-defense IP on the forwarding port is forwarded to the origin addresses. Forwarded traffic is billed and origin connectivity changes." },
    { id: "update-rule", label: "Replace forwarding rule", kind: "action", resourcePrefixes: ["instance:"], description: "Replace one forwarding rule's protocol, ports, and origins.", fields: [ruleChoiceField, ruleProtocolField, rulePortField("forwardPort", "Forwarding port"), rulePortField("sourcePort", "Origin port"), ruleSourceField], confirmation: true, impact: "Forwarding switches to the new protocol, ports, and origins immediately; the previous forwarding stops." },
    { id: "delete-rule", label: "Delete forwarding rule", kind: "action", resourcePrefixes: ["instance:"], description: "Delete one forwarding rule.", fields: [ruleChoiceField], confirmation: true, impact: "Forwarding for this rule stops immediately; traffic to the high-defense IP on this port is no longer forwarded." },
    { id: "create-domain", label: "Add protected domain", kind: "create", description: "Add one protected domain on current high-defense instance IPs of one enterprise project. DNS must be pointed at the returned CNAME separately.", impact: "The domain is configured for high-defense cleaning. Traffic only flows after DNS points to the returned CNAME, and the origin must accept Huawei's return-to-origin IP ranges.", fields: [
      { key: "domainName", label: "Domain name", required: true, max: 128, pattern: domainNamePattern },
      { key: "enterpriseProjectId", label: "Enterprise project ID", required: true, max: 64, defaultValue: "0", help: "Must match the enterprise project of every selected high-defense instance IP." },
      { key: "vips", label: "High-defense instance IPs", type: "list", source: "instanceIps", required: true },
      realServerTypeField,
      realServerField,
      portListField("portHttp", "HTTP ports"),
      portListField("portHttps", "HTTPS ports"),
    ] },
    { id: "inspect-domain", label: "View domain", kind: "inspect", resourcePrefixes: ["domain:"], description: "Inspect the domain's CNAME, protocols, origin, and web protection status.", fields: [] },
    { id: "update-domain-origin", label: "Replace origin", kind: "update", resourcePrefixes: ["domain:"], description: "Replace the domain's origin address. Only the settings visible in the protected-domain list are re-checked afterwards.", fields: [realServerTypeField, realServerField], confirmation: true, impact: "All of the domain's protected traffic is forwarded to the new origin. An incorrect origin takes the service down." },
    { id: "domain-web-switch", label: "Set web protection switches", kind: "update", resourcePrefixes: ["domain:"], description: "Request enabling or disabling of web basic protection and CC protection for this domain. The resulting switch states cannot be read back through the current API.", fields: [{ key: "wafSwitch", label: "Web basic protection", type: "boolean", required: true, defaultValue: true }, { key: "ccSwitch", label: "CC protection", type: "boolean", required: true, defaultValue: false }], confirmation: true, impact: "Web basic protection filters this domain's HTTP/S traffic; disabling it stops filtering. CC protection adds rate-based blocking and requires web basic protection." },
    { id: "delete-domain", label: "Delete protected domain", kind: "delete", resourcePrefixes: ["domain:"], description: "Delete the protected domain. Point its DNS elsewhere first.", fields: [], confirmation: true, impact: "High-defense protection for this domain stops immediately. DNS records still pointing at the high-defense CNAME stop serving traffic." },
  ],
  inventory: async s => {
    const [packageRows, policyRows, ipRows, instanceRows, domainRows] = await Promise.all([aadPackages(s), aadPolicies(s), aadProtectedIps(s), aadInstances(s), aadDomains(s)]);
    return [
      ...packageRows.map(row => ({ id: `package:${row.package_id}`, name: aadRowName.package(row), values: { region: asString(row.region_id, "") } })),
      ...policyRows.map(row => ({ id: `policy:${row.id}`, name: aadRowName.policy(row), values: { packageId: asString(row.package_id, ""), packageName: asString(row.package_name, "") } })),
      ...ipRows.map(row => ({ id: `protected-ip:${row.id}`, name: aadRowName.protectedIp(row), values: { ip: asString(row.ip, ""), packageId: asString(row.package_id, ""), policyName: row.policy_name, tag: asString(row.tag, "") } })),
      ...instanceRows.map(row => ({ id: `instance:${row.instance_id}`, name: aadRowName.instance(row), values: { enterpriseProjectId: asString(row.enterprise_project_id, "") } })),
      ...domainRows.map(row => ({ id: `domain:${row.domain_id}`, name: aadRowName.domain(row), values: { enterpriseProjectId: asString(row.enterprise_project_id, "") } })),
    ];
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-policy") return { packages: (await aadPackages(s)).map(row => ({ value: String(row.package_id), label: aadRowName.package(row) })) };
    if (operation === "bind-ips" || operation === "unbind-ips") {
      if (!resource) return {};
      const policy = await ownedPolicy(s, resource);
      const rows = await aadProtectedIps(s, policy.packageId);
      if (operation === "bind-ips") return { bindableIps: rows.filter(row => !row.policy_name.trim()).map(row => ({ value: String(row.id), label: `${asString(row.ip, String(row.id))} · unbound` })) };
      return { boundIps: rows.filter(row => policy.policyName !== undefined && row.policy_name === policy.policyName).map(row => ({ value: String(row.id), label: asString(row.ip, String(row.id)) })) };
    }
    if (["instance-rules", "create-rule", "update-rule", "delete-rule"].includes(operation)) {
      if (!resource) return {};
      const instance = operation === "instance-rules"
        ? await findOwned(s, resource, "instance", "instance", () => aadInstances(s), "instance_id")
        : await owned(s, resource, "instance", "instance", () => aadInstances(s), "instance_id", aadRowName.instance);
      const ips = instanceIps(instance.row);
      if (operation === "update-rule" || operation === "delete-rule") {
        const rules = await Promise.all(ips.map(entry => aadInstanceRules(s, instance.id, String(entry.ip))));
        return { ipRules: rules.flatMap((list, index) => list.map(parseRule).map(rule => ({ value: JSON.stringify({ ip: String(ips[index].ip), ruleId: rule.ruleId }), label: `${ips[index].ip} · ${rule.protocol} ${rule.forwardPort} → ${rule.sourcePort} · ${rule.sourceIp}` }))) };
      }
      return { instanceIps: ips.map(entry => ({ value: String(entry.ip), label: String(entry.ip) })) };
    }
    if (operation === "create-domain") {
      const owners = await ipOwners(s);
      return { instanceIps: [...owners.entries()].map(([ip, ownerRows]) => ({ value: ip, label: ownerRows.length === 1 ? `${ip} · ${aadRowName.instance(ownerRows[0])}` : `${ip} · shared by multiple instances` })) };
    }
    return {};
  },
  execute: async (s, operation, v, resource) => {
    const write = (path: string, method: string, body?: unknown) => aadFetch(s, path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

    if (operation === "create-policy") {
      if (typeof v.name !== "string" || !v.name.trim()) throw new ManagementInputError("Policy name is required.");
      const packageId = String(v.package ?? "");
      if (!(await aadPackages(s)).some(row => String(row.package_id) === packageId)) throw new ManagementInputError("Select a current Anti-DDoS package.", 404);
      const result = await write("/v1/cnad/policies", "POST", { name: v.name, package_id: packageId, description: v.description ?? "" });
      if (typeof result.id !== "string" || !result.id) throw new Error("Huawei returned no ID for the new AAD policy. Check policies before retrying.");
      aadVerifyEcho(result, "package_id", packageId);
      return { message: "Protection policy created. Bind protected IPs to apply its cleaning settings.", resourceId: `policy:${result.id}` };
    }

    if (operation === "create-domain") {
      if (typeof v.domainName !== "string" || !v.domainName.trim()) throw new ManagementInputError("Enter a domain name.");
      const vips = [...new Set(asArray(v.vips).map(item => String(item)))];
      if (!vips.length) throw new ManagementInputError("Select at least one high-defense instance IP.");
      const owners = await ipOwners(s);
      for (const vip of vips) {
        const ownerRows = owners.get(vip);
        if (!ownerRows?.length) throw new ManagementInputError("Every selected high-defense IP must be a current instance IP.", 404);
        if (ownerRows.length > 1) throw new ManagementInputError("A selected high-defense IP is shared by multiple instances; its enterprise project cannot be verified.", 409);
      }
      const eps = String(v.enterpriseProjectId ?? "").trim();
      if (!eps) throw new ManagementInputError("Enter the enterprise project ID of the selected high-defense instance IPs.");
      for (const vip of vips) {
        const owner = owners.get(vip)![0];
        if (typeof owner.enterprise_project_id !== "string" || owner.enterprise_project_id !== eps) throw new ManagementInputError("The selected high-defense IPs must belong to the same enterprise project as the domain.");
      }
      if (v.realServerType !== "0" && v.realServerType !== "1") throw new ManagementInputError("Select an origin type.");
      const realServer = originAddress(v.realServer, v.realServerType);
      const portHttp = portList(v.portHttp, "HTTP ports");
      const portHttps = portList(v.portHttps, "HTTPS ports");
      if (!portHttp.length && !portHttps.length) throw new ManagementInputError("Enter at least one HTTP or HTTPS port.");
      const result = await write(`${external(s)}/domains`, "POST", { domain_name: v.domainName, enterprise_project_id: eps, vips, real_server_type: Number(v.realServerType), ...(portHttp.length ? { port_http: portHttp } : {}), ...(portHttps.length ? { port_https: portHttps } : {}), real_server: realServer });
      const domainId = firstString([result.domainId, result.domain_id], "");
      if (!domainId) throw new Error("Huawei returned no domain ID for the new protected domain. Check protected domains before retrying.");
      const cname = asString(result.cname, "");
      return { message: cname ? `Protected domain created. Point its DNS CNAME at ${cname} to route traffic through Anti-DDoS cleaning.` : "Protected domain created. Complete DNS onboarding with the CNAME shown in the Anti-DDoS console.", resourceId: `domain:${domainId}` };
    }

    if (["inspect-package", "package-ips", "rename-package"].includes(operation)) {
      const pkg = operation === "rename-package"
        ? await owned(s, resource, "package", "package", () => aadPackages(s), "package_id", aadRowName.package)
        : await findOwned(s, resource, "package", "package", () => aadPackages(s), "package_id");
      if (operation === "inspect-package") {
        return { message: "Current Anti-DDoS package configuration.", facts: [
          { label: "Package", value: aadRowName.package(pkg.row) },
          { label: "Region", value: asString(pkg.row.region_id) },
          { label: "Instance type", value: ["cnad", "aad"].includes(String(pkg.row.instance_type)) ? String(pkg.row.instance_type) : "Unknown" },
          { label: "Protection type", value: num(pkg.row.protection_type) },
          { label: "Protected IP quota", value: pair(pkg.row.ip_num_now, pkg.row.ip_num) },
          { label: "Protection quota", value: pair(pkg.row.protection_num_now, pkg.row.protection_num) },
          { label: "Basic cleaning bandwidth", value: numberWithUnit(pkg.row.basic_bandwidth, "Mbps") },
          { label: "Elastic cleaning bandwidth", value: numberWithUnit(pkg.row.elastic_bandwidth, "Mbps") },
          { label: "Service bandwidth", value: numberWithUnit(pkg.row.service_bandwidth, "Mbps") },
          { label: "Cleaning bandwidth", value: numberWithUnit(pkg.row.clean_bandwidth, "Mbps") },
          { label: "Policies", value: num(pkg.row.policy_num) },
          { label: "Created", value: timestampSeconds(pkg.row.create_time) },
          ...(typeof pkg.row.count_down_tips === "string" && pkg.row.count_down_tips.trim() ? [{ label: "Subscription notice", value: String(pkg.row.count_down_tips) }] : []),
        ] };
      }
      if (operation === "package-ips") {
        const [rows, unbound] = await Promise.all([aadProtectedIps(s, pkg.id), aadUnboundIps(s, pkg.id)]);
        return { message: `${rows.length} protected IPs on this package.`, facts: [
          { label: "Protected IPs", value: String(rows.length) },
          { label: "Unbound to a policy", value: String(unbound.length) },
          ...rows.map(row => ({ label: asString(row.ip, String(row.id)), value: `Policy ${policyBindingLabel(row)} · tag ${asString(row.tag, "-")}` })),
        ] };
      }
      if (typeof v.name !== "string" || !v.name.trim()) throw new ManagementInputError("Package name is required.");
      const result = await write(`/v1/cnad/packages/${encodeURIComponent(pkg.id)}/name`, "PUT", { name: v.name });
      aadVerifyEcho(result, "package_id", pkg.id);
      const after = (await aadPackages(s)).find(row => String(row.package_id) === pkg.id);
      if (!after || aadRowName.package(after) !== v.name) throw new Error("Huawei accepted the package rename but it could not be verified. Check the package before retrying.");
      return { message: "Package renamed without changing its protection or billing.", resourceId: resource!.id };
    }

    if (["inspect-policy", "policy-settings", "policy-blackwhite", "policy-blackwhite-add", "policy-blackwhite-delete", "bind-ips", "unbind-ips"].includes(operation)) {
      const isMutation = operation !== "inspect-policy" && operation !== "policy-blackwhite";
      const policy = isMutation ? await ownedPolicy(s, resource) : await findOwned(s, resource, "policy", "policy", () => aadPolicies(s), "id");
      if (operation === "inspect-policy") {
        const expectedPackage = typeof policy.row.package_id === "string" && policy.row.package_id ? policy.row.package_id : undefined;
        const detail = await showPolicy(s, policy.id, expectedPackage);
        const pop = asRecord(detail.pop_policy);
        const bw = bwLists(detail);
        return { message: "Current protection policy configuration.", facts: [
          { label: "Policy", value: aadRowName.policy(policy.row) },
          { label: "Package", value: asString(policy.row.package_name, asString(policy.row.package_id, "-")) },
          { label: "Description", value: asString(policy.row.description, "-") },
          { label: "Cleaning threshold", value: num(detail.clean_threshold) },
          { label: "Protected IPs", value: num(policy.row.num_protected_ip) },
          ...(detail.pop_policy ? [
            { label: "Blocked protocols", value: nativeList(pop.block_protocol, ["tcp", "udp", "icmp", "other", "TCP", "UDP", "ICMP", "OTHER"]) },
            { label: "Blocked locations", value: nativeList(pop.block_location) },
            { label: "Connection protection", value: typeof pop.connection_protection === "boolean" ? (pop.connection_protection ? "Enabled" : "Disabled") : "Unknown" },
            { label: "Blacklisted IPs", value: bw.known ? String(bw.black.length) : "Unknown" },
            { label: "Whitelisted IPs", value: bw.known ? String(bw.white.length) : "Unknown" },
          ] : []),
        ] };
      }
      if (operation === "policy-settings") {
        for (const key of ["udp", "tcp", "icmp", "other"]) if (!["block", "unblock", "limiting"].includes(String(v[key]))) throw new ManagementInputError("Select block, allow, or rate-limit for every protocol.");
        if (typeof v.name !== "string" || !v.name.trim()) throw new ManagementInputError("Policy name is required.");
        if (typeof v.threshold !== "number" || !Number.isSafeInteger(v.threshold) || v.threshold < 1) throw new ManagementInputError("Enter a cleaning threshold of at least 1.");
        const body: Record<string, unknown> = { name: v.name, threshold: v.threshold, description: v.description ?? "", udp: v.udp, tcp: v.tcp, icmp: v.icmp, other: v.other };
        for (const entry of limitFields) {
          const value = v[entry.key];
          if (v[entry.protocol] === "limiting") {
            if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new ManagementInputError(`${entry.label} must be a positive whole number while ${entry.protocol.toUpperCase()} handling is set to rate-limit.`);
            body[entry.body] = value;
          } else if (value !== undefined) {
            throw new ManagementInputError(`${entry.label} requires ${entry.protocol.toUpperCase()} handling to be set to rate-limit.`);
          }
        }
        const { id: policyId, packageId } = policy as { id: string; row: Record<string, unknown>; packageId: string; policyName: string | undefined };
        const result = await write(`/v1/cnad/policies/${encodeURIComponent(policyId)}`, "PUT", body);
        aadVerifyEcho(result, "id", policyId);
        aadVerifyEcho(result, "package_id", packageId);
        const detail = await showPolicy(s, policyId, packageId);
        if (typeof detail.clean_threshold !== "number" || detail.clean_threshold !== v.threshold || typeof detail.name !== "string" || detail.name !== v.name) throw new Error("Huawei accepted the policy settings but the cleaning threshold could not be verified. Check the policy before retrying.");
        return { message: "Protection settings accepted. The cleaning threshold and name were verified; protocol handling cannot be read back through the current API, so review it in the Anti-DDoS console.", resourceId: resource!.id, asynchronous: true };
      }
      if (operation === "policy-blackwhite") {
        const lists = bwLists(await showPolicy(s, policy.id));
        if (!lists.known) return { message: "The policy reported no black/white list data." };
        return { message: `${lists.black.length} blacklisted and ${lists.white.length} whitelisted IPs.`, facts: [
          ...lists.black.map(ip => ({ label: ip, value: "Blacklisted" })),
          ...lists.white.map(ip => ({ label: ip, value: "Whitelisted" })),
        ] };
      }
      if (operation === "policy-blackwhite-add" || operation === "policy-blackwhite-delete") {
        if (v.type !== "black" && v.type !== "white") throw new ManagementInputError("Select a blacklist or whitelist type.");
        const ips = ipList(v.ips, "black/white list", 100);
        const adding = operation === "policy-blackwhite-add";
        const { id: policyId, packageId } = policy as { id: string; row: Record<string, unknown>; packageId: string; policyName: string | undefined };
        const result = await write(`/v1/cnad/policies/${encodeURIComponent(policyId)}/ip-list/${adding ? "add" : "delete"}`, "POST", { type: v.type, ip_list: ips });
        aadVerifyEcho(result, "id", policyId);
        aadVerifyEcho(result, "package_id", packageId);
        const lists = bwLists(await showPolicy(s, policyId, packageId));
        if (!lists.known) return { message: `Change accepted. Huawei did not return the policy's current ${v.type} list to verify against; review it in the Anti-DDoS console.`, resourceId: resource!.id, asynchronous: true };
        const current = v.type === "black" ? lists.black : lists.white;
        const missing = adding ? ips.filter(ip => !current.includes(ip)) : ips.filter(ip => current.includes(ip));
        if (missing.length) throw new Error(`Huawei accepted the ${v.type} list change but ${missing.length} of its entries could not be verified. Check the policy before retrying.`);
        return { message: adding ? `${ips.length} ${v.type === "black" ? "blacklisted" : "whitelisted"} IPs added to this policy.` : `${ips.length} ${v.type === "black" ? "blacklisted" : "whitelisted"} IPs removed from this policy.`, resourceId: resource!.id };
      }
      const { id: policyId, packageId, policyName } = await ownedPolicyForBinding(s, resource);
      const ids = [...new Set(asArray(v.ips).map(item => String(item)))];
      if (!ids.length) throw new ManagementInputError("Select at least one protected IP.");
      const rows = await aadProtectedIps(s, packageId);
      const targets = rows.filter(row => ids.includes(String(row.id)));
      if (targets.length !== ids.length) throw new ManagementInputError("Every selected protected IP must belong to this policy's package.", 404);
      for (const row of targets) {
        if (operation === "bind-ips" && row.policy_name.trim()) throw new ManagementInputError("Unbind the selected protected IPs from their current policy first.", 409);
        if (operation === "unbind-ips" && row.policy_name !== policyName) throw new ManagementInputError("Select only protected IPs currently bound to this policy.", 409);
      }
      const binding = operation === "bind-ips" ? "binding" : "unbinding";
      const result = await write(`/v1/cnad/policies/${encodeURIComponent(policyId)}/${operation === "bind-ips" ? "bind" : "unbind"}`, "POST", { package_id: packageId, id_list: ids });
      aadVerifyEcho(result, "package_id", packageId);
      aadVerifyEcho(result, "id", policyId);
      const after = (await aadProtectedIps(s, packageId)).filter(row => ids.includes(String(row.id)));
      if (after.length !== ids.length) throw new Error(`Huawei accepted the ${binding} but the protected IPs could not be re-read. Check the policy before retrying.`);
      if (after.some(row => operation === "bind-ips" ? row.policy_name !== policyName : row.policy_name === policyName)) throw new Error(`Huawei accepted the ${binding} but it could not be verified on the protected IPs. Check the policy before retrying.`);
      return { message: operation === "bind-ips" ? `${ids.length} protected IP${ids.length === 1 ? "" : "s"} bound to this policy.` : `${ids.length} protected IP${ids.length === 1 ? "" : "s"} unbound from this policy.`, resourceId: resource!.id };
    }

    if (operation === "inspect-protected-ip" || operation === "tag-protected-ip") {
      const target = operation === "tag-protected-ip"
        ? await owned(s, resource, "protected-ip", "protected IP", () => aadProtectedIps(s), "id", aadRowName.protectedIp)
        : await findOwned(s, resource, "protected-ip", "protected IP", () => aadProtectedIps(s), "id");
      if (operation === "inspect-protected-ip") {
        const statusDetail = asRecord(target.row.status_detail);
        return { message: "Current protected IP configuration.", facts: [
          { label: "IP address", value: asString(target.row.ip, target.id) },
          { label: "Name", value: asString(target.row.name, "-") },
          { label: "Type", value: asString(target.row.type, "-") },
          { label: "Native status", value: knownStatus(target.row.status) },
          { label: "Block time", value: timestampSeconds(statusDetail.block_time) },
          { label: "Unblock time", value: timestampSeconds(statusDetail.unblock_time) },
          { label: "Policy", value: policyBindingLabel(target.row) },
          { label: "Package", value: asString(target.row.package_name, asString(target.row.package_id, "-")) },
          { label: "Region", value: asString(target.row.region, "-") },
          { label: "Tag", value: asString(target.row.tag, "-") },
        ] };
      }
      const tag = String(v.tag ?? "").trim();
      const result = await write("/v1/cnad/protected-ips/tags", "PUT", { id: target.id, tag });
      aadVerifyEcho(result, "id", target.id);
      const after = (await aadProtectedIps(s)).find(row => String(row.id) === target.id);
      if (!after || typeof after.tag !== "string" || after.tag.trim() !== tag) throw new Error("Huawei accepted the tag change but it could not be verified. Check the protected IP before retrying.");
      return { message: tag ? "Protected IP tag updated." : "Protected IP tag cleared.", resourceId: resource!.id };
    }

    if (["inspect-instance", "instance-blackwhite", "instance-blackwhite-add", "instance-blackwhite-delete", "instance-rules", "create-rule", "update-rule", "delete-rule"].includes(operation)) {
      const isMutation = operation !== "inspect-instance" && operation !== "instance-rules" && operation !== "instance-blackwhite";
      const instance = isMutation
        ? await owned(s, resource, "instance", "instance", () => aadInstances(s), "instance_id", aadRowName.instance)
        : await findOwned(s, resource, "instance", "instance", () => aadInstances(s), "instance_id");
      if (operation === "inspect-instance") {
        return { message: "Current high-defense instance configuration.", facts: [
          { label: "Instance", value: aadRowName.instance(instance.row) },
          { label: "Enterprise project", value: asString(instance.row.enterprise_project_id, "-") },
          { label: "Service bandwidth", value: numberWithUnit(instance.row.service_bandwidth, "Mbps") },
          { label: "Expires", value: timestampSeconds(instance.row.expire_time) },
          ...instanceIps(instance.row).map(entry => ({ label: String(entry.ip), value: `Basic ${numberWithUnit(entry.basic_bandwidth, "Mbps")} · elastic ${numberWithUnit(entry.elastic_bandwidth, "Mbps")} · status ${knownStatus(entry.ip_status)}` })),
        ] };
      }
      if (operation === "instance-blackwhite") {
        const [black, white] = await Promise.all([aadInstanceBlackwhite(s, instance.id, "black"), aadInstanceBlackwhite(s, instance.id, "white")]);
        return { message: `${black.length} blacklisted and ${white.length} whitelisted IPs on this instance.`, facts: [
          ...black.map(ip => ({ label: ip, value: "Blacklisted" })),
          ...white.map(ip => ({ label: ip, value: "Whitelisted" })),
        ] };
      }
      if (operation === "instance-blackwhite-add" || operation === "instance-blackwhite-delete") {
        if (v.type !== "black" && v.type !== "white") throw new ManagementInputError("Select a blacklist or whitelist type.");
        const ips = ipList(v.ips, "black/white list", 100);
        const adding = operation === "instance-blackwhite-add";
        const result = await write(`${external(s)}/bwlist`, adding ? "POST" : "DELETE", { instance_id: instance.id, type: v.type, ips });
        aadVerifyEcho(result, "instance_id", instance.id);
        const current = await aadInstanceBlackwhite(s, instance.id, v.type);
        const missing = adding ? ips.filter(ip => !current.includes(ip)) : ips.filter(ip => current.includes(ip));
        if (missing.length) return { message: `Huawei accepted the instance ${v.type} list change but ${missing.length} of its entries are not yet ${adding ? "visible in" : "removed from"} the native list. Verify the change in the Anti-DDoS console.`, resourceId: resource!.id, asynchronous: true };
        return { message: adding ? `${ips.length} ${v.type === "black" ? "blacklisted" : "whitelisted"} IPs added to this instance and verified.` : `${ips.length} ${v.type === "black" ? "blacklisted" : "whitelisted"} IPs removed from this instance and verified.`, resourceId: resource!.id };
      }
      if (operation === "instance-rules") {
        const ip = ownedInstanceIp(instance.row, v.ip);
        const rules = (await aadInstanceRules(s, instance.id, ip)).map(parseRule);
        return { message: `${rules.length} forwarding rule${rules.length === 1 ? "" : "s"} for ${ip}.`, facts: rules.map(rule => ({ label: `${rule.protocol} ${rule.forwardPort} → ${rule.sourcePort}`, value: `Origin ${rule.sourceIp} · rule ${rule.ruleId} · status ${knownStatus(rule.status)}` })) };
      }
      const selection = operation === "create-rule" ? undefined : ruleSelection(v.rule);
      const ip = ownedInstanceIp(instance.row, operation === "create-rule" ? v.ip : selection!.ip);
      const rulePath = `/v1/aad/instances/${encodeURIComponent(instance.id)}/${encodeURIComponent(ip)}/rules`;
      if (operation === "delete-rule") {
        if (!(await aadInstanceRules(s, instance.id, ip)).map(parseRule).some(rule => rule.ruleId === selection!.ruleId)) throw new ManagementInputError("The forwarding rule no longer exists on this instance IP.", 404);
        const result = await write(`${rulePath}/batch-delete`, "POST", { ids: [selection!.ruleId] });
        verifyBatchAck(result, "forwarding rule deletion");
        aadVerifyEcho(result, "rule_id", selection!.ruleId);
        aadVerifyEcho(result, "instance_id", instance.id);
        const after = (await aadInstanceRules(s, instance.id, ip)).map(parseRule);
        if (after.some(rule => rule.ruleId === selection!.ruleId)) throw new Error("Huawei accepted the deletion but the rule is still listed. Check rules before retrying.");
        return { message: "Forwarding rule deleted. Traffic to this port is no longer forwarded.", resourceId: resource!.id };
      }
      if (v.protocol !== "tcp" && v.protocol !== "udp") throw new ManagementInputError("Select a TCP or UDP forwarding protocol.");
      for (const key of ["forwardPort", "sourcePort"]) if (typeof v[key] !== "number" || !Number.isSafeInteger(v[key]) || v[key] < 1 || v[key] > 65535) throw new ManagementInputError("Enter forwarding and origin ports between 1 and 65535.");
      const body = { forward_protocol: String(v.protocol), forward_port: Number(v.forwardPort), source_port: Number(v.sourcePort), source_ip: ipList(v.sourceIp, "origin", 20).join(",") };
      if (operation === "create-rule") {
        // Native batch creation only acknowledges success_num and never returns the new rule's ID,
        // so the created rule is never guessed from matching settings or borrowed from concurrent rows.
        const result = await write(`${rulePath}/batch-create`, "POST", { rules: [body] });
        verifyBatchAck(result, "forwarding rule creation");
        aadVerifyEcho(result, "instance_id", instance.id);
        return { message: "Forwarding rule creation accepted. Huawei returns no ID for newly created rules, so verify the rule in the Anti-DDoS console before relying on it.", resourceId: resource!.id, asynchronous: true };
      }
      if (!(await aadInstanceRules(s, instance.id, ip)).map(parseRule).some(rule => rule.ruleId === selection!.ruleId)) throw new ManagementInputError("The forwarding rule no longer exists on this instance IP.", 404);
      const result = await write(`${rulePath}/${encodeURIComponent(selection!.ruleId)}`, "PUT", body);
      aadVerifyEcho(result, "rule_id", selection!.ruleId);
      aadVerifyEcho(result, "instance_id", instance.id);
      const after = (await aadInstanceRules(s, instance.id, ip)).map(parseRule);
      const updated = after.find(rule => rule.ruleId === selection!.ruleId);
      if (!updated || updated.protocol !== body.forward_protocol || updated.forwardPort !== body.forward_port || updated.sourcePort !== body.source_port || updated.sourceIp !== body.source_ip) throw new Error("Huawei accepted the forwarding rule change but the original rule could not be verified. Check rules before retrying.");
      return { message: "Forwarding rule replaced and verified on the instance IP.", resourceId: resource!.id };
    }

    if (operation === "inspect-domain" || operation === "update-domain-origin" || operation === "domain-web-switch" || operation === "delete-domain") {
      const domain = operation === "inspect-domain"
        ? await findOwned(s, resource, "domain", "protected domain", () => aadDomains(s), "domain_id")
        : await owned(s, resource, "domain", "protected domain", () => aadDomains(s), "domain_id", aadRowName.domain);
      if (operation === "inspect-domain") {
        return { message: "Current protected domain configuration.", facts: [
          { label: "Domain", value: aadRowName.domain(domain.row) },
          { label: "CNAME", value: asString(domain.row.cname, "Not reported") },
          { label: "Protocols", value: nativeList(domain.row.protocol, ["HTTP", "HTTPS"]) },
          { label: "Origin", value: originLabel(domain.row.real_server_type, domain.row.real_servers) },
          { label: "Web protection status", value: knownStatus(domain.row.waf_status) },
          { label: "Enterprise project", value: asString(domain.row.enterprise_project_id, "-") },
        ] };
      }
      if (operation === "update-domain-origin") {
        if (v.realServerType !== "0" && v.realServerType !== "1") throw new ManagementInputError("Select an origin type.");
        const realServer = originAddress(v.realServer, v.realServerType);
        const before = domain.row;
        const result = await write(`/v1/aad/protected-domains/${encodeURIComponent(domain.id)}`, "PUT", { real_server_type: Number(v.realServerType), real_servers: realServer });
        aadVerifyEcho(result, "domain_id", domain.id);
        const after = (await aadDomains(s)).find(row => String(row.domain_id) === domain.id);
        if (!after || typeof after.real_server_type !== "number" || after.real_server_type !== Number(v.realServerType) || typeof after.real_servers !== "string" || after.real_servers !== realServer) throw new Error("Huawei accepted the origin change but it could not be verified. Check the domain before retrying.");
        for (const key of ["domain_name", "cname", "protocol", "waf_status", "enterprise_project_id"]) {
          if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) throw new Error(`Huawei accepted the origin change but the domain's ${key.replaceAll("_", " ")} changed unexpectedly. Check the domain before retrying.`);
        }
        return { message: "Origin replaced. Only the settings visible in the protected-domain list (name, CNAME, protocols, web protection status, enterprise project) were re-checked; other native domain settings were not part of this update.", resourceId: resource!.id };
      }
      if (operation === "domain-web-switch") {
        if (typeof v.wafSwitch !== "boolean" || typeof v.ccSwitch !== "boolean") throw new ManagementInputError("Set both web protection switches.");
        const waf = v.wafSwitch;
        const cc = v.ccSwitch;
        if (cc && !waf) throw new ManagementInputError("CC protection requires web basic protection to be enabled.");
        const result = await write(`${external(s)}/domains/switch`, "POST", { domain_id: domain.id, waf_switch: waf ? 0 : 1, cc_switch: cc ? 0 : 1 });
        aadVerifyEcho(result, "domain_id", domain.id);
        return { message: `Huawei accepted the request to ${waf ? "enable" : "disable"} web basic protection and ${cc ? "enable" : "disable"} CC protection for this domain. The switch states cannot be read back through the current API; verify them in the Anti-DDoS console.`, resourceId: resource!.id, asynchronous: true };
      }
      const result = await write("/v2/aad/domains", "DELETE", { domain_id: [domain.id] });
      aadVerifyEcho(result, "domain_id", domain.id);
      if ((await aadDomains(s)).some(row => String(row.domain_id) === domain.id)) return { message: "Huawei accepted the protected-domain deletion but the domain is still listed. Verify the deletion in the Anti-DDoS console before retrying.", resourceId: resource!.id, asynchronous: true };
      return { message: "Protected domain deleted. Update its DNS records: records still pointing at the high-defense CNAME stop serving traffic.", resourceId: resource!.id };
    }

    throw new ManagementInputError("Unsupported AAD operation.");
  },
  invalidationKeys: () => [aadInventoryKey],
};
