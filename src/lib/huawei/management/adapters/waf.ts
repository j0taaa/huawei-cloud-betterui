import "server-only";
import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const base = (s: BetterUiSession) => `/v1/${s.projectId}/waf`;
const hostPrefixes = ["host:"]; const policyPrefixes = ["policy:"];
const policyName: ManagementField = { key: "name", label: "Policy name", required: true, max: 64, pattern: "^[A-Za-z0-9_]{1,64}$" };
const policyChoice: ManagementField = { key: "policy", label: "Protection policy", type: "select", source: "policies", required: true };
const ruleChoice: ManagementField = { key: "rule", label: "IP rule", type: "select", source: "ipRules", required: true };
const originFields: ManagementField[] = [
  { key: "frontProtocol", label: "Client protocol", type: "select", required: true, defaultValue: "HTTPS", choices: ["HTTPS", "HTTP"].map(value => ({ value, label: value })) },
  { key: "backProtocol", label: "Origin protocol", type: "select", required: true, defaultValue: "HTTPS", choices: ["HTTPS", "HTTP"].map(value => ({ value, label: value })) },
  { key: "address", label: "Public origin IPv4 address", required: true, max: 15, help: "Cloud CNAME access requires a public origin address, such as the EIP of an ELB. Private origins require a different WAF access mode." },
  { key: "port", label: "Origin port", type: "number", required: true, min: 1, max: 65535, defaultValue: 443 },
  { key: "certificate", label: "HTTPS certificate", type: "select", source: "certificates", help: "Required for HTTPS clients. The certificate must be current and cover this domain." },
];
async function list(s: BetterUiSession, path: string) {
  const body = await huaweiList<Record<string, unknown>>(s, "waf", `${path}${path.includes("?") ? "&" : "?"}page=1&pagesize=100`, { items: ["items"], kind: "page", parameter: "page", size: 100, first: 1, total: ["total"] });
  return asArray(body.items).map(asRecord);
}
async function hosts(s: BetterUiSession) { return (await list(s, `${base(s)}/instance?enterprise_project_id=all_granted_eps`)).filter(host => !host.projectid || host.projectid === s.projectId); }
const policies = (s: BetterUiSession) => list(s, `${base(s)}/policy?enterprise_project_id=all_granted_eps`);
async function certificates(s: BetterUiSession) {
  const groups = await Promise.all([true, false].map(bound => list(s, `${base(s)}/certificate?enterprise_project_id=all_granted_eps&host=${bound}`)));
  return [...new Map(groups.flat().filter(cert => cert.id).map(cert => [String(cert.id), cert])).values()];
}
const target = (s: BetterUiSession, type: "host" | "policy", id: string) => `${base(s)}/${type === "host" ? "instance" : "policy"}/${encodeURIComponent(id)}?enterprise_project_id=all_granted_eps`;
async function owned(s: BetterUiSession, resource: ManagementResource | undefined, type: "host" | "policy") {
  if (!resource || !resource.id.startsWith(`${type}:`)) throw new ManagementInputError(`Select a current WAF ${type}.`);
  const id = resource.id.slice(type.length + 1);
  if (!(await (type === "host" ? hosts(s) : policies(s))).some(item => item.id === id)) throw new ManagementInputError(`The ${type} no longer belongs to this project.`, 404);
  const detail = await huaweiFetch<Record<string, unknown>>(s, "waf", target(s, type, id));
  if (detail.id !== id || (type === "host" && detail.projectid !== s.projectId)) throw new ManagementInputError(`Huawei returned an unverified WAF ${type}.`, 404);
  return detail;
}
function publicIpv4(value: unknown) {
  const address = String(value); const [a, b, c] = address.split(".").map(Number);
  if (isIP(address) !== 4 || a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) throw new ManagementInputError("Cloud CNAME access requires a public origin IPv4 address.");
  return address;
}
async function origin(s: BetterUiSession, v: ManagementValues, hostname: string) {
  const server = { front_protocol: v.frontProtocol, back_protocol: v.backProtocol, address: publicIpv4(v.address), port: Number(v.port), type: "ipv4" };
  if (!["HTTP", "HTTPS"].includes(String(v.frontProtocol)) || !["HTTP", "HTTPS"].includes(String(v.backProtocol))) throw new ManagementInputError("Select HTTP or HTTPS protocols.");
  if (v.frontProtocol === "HTTP") return { server: [server] };
  const cert = (await certificates(s)).find(cert => cert.id === v.certificate && cert.exp_status !== 1);
  if (!cert) throw new ManagementInputError("Select a current certificate for HTTPS clients.");
  const detail = await huaweiFetch<Record<string, unknown>>(s, "waf", `${base(s)}/certificate/${encodeURIComponent(String(cert.id))}?enterprise_project_id=all_granted_eps`);
  if (detail.id !== cert.id) throw new ManagementInputError("Huawei returned a different certificate.");
  let leaf: X509Certificate;
  try { leaf = new X509Certificate(String(detail.content)); } catch { throw new ManagementInputError("The certificate's public contents could not be verified."); }
  if (Date.parse(leaf.validFrom) > Date.now() || Date.parse(leaf.validTo) <= Date.now() || !leaf.checkHost(hostname)) throw new ManagementInputError("The certificate must be currently valid and cover this domain.");
  return { server: [server], certificateid: cert.id, certificatename: cert.name };
}
async function rules(s: BetterUiSession, policyId: string) { return (await list(s, `${base(s)}/policy/${encodeURIComponent(policyId)}/whiteblackip?enterprise_project_id=all_granted_eps`)).filter(rule => rule.policyid === policyId); }
function ipAddress(value: unknown) {
  const text = String(value); const [address, prefix, extra] = text.split("/"); const version = isIP(address);
  if (!version || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) throw new ManagementInputError("Enter one valid IPv4/IPv6 address or CIDR.");
  return text;
}
const choices = (items: Record<string, unknown>[]): ManagementChoice[] => items.filter(item => item.id).map(item => ({ value: String(item.id), label: asString(item.name, String(item.id)) }));
const policyImpact = "This change affects every domain bound to this policy. Blocking can deny legitimate traffic; allowing can bypass IP restrictions. Review the policy's bound domains first.";
export const wafManagement: ManagementAdapter = {
  title: "Cloud Web Application Firewall",
  operations: [
    { id: "create", label: "Add pay-per-use cloud domain", kind: "create", description: "Register one cloud CNAME domain with one public origin and a current protection policy. DNS onboarding remains a separate step.", fields: [{ key: "hostname", label: "Domain name", required: true, max: 64, pattern: "^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$" }, policyChoice, ...originFields, { key: "proxy", label: "Another proxy/CDN is in front of WAF", type: "boolean", defaultValue: false }], impact: "The domain uses pay-per-use WAF billing without a dedicated IP. Protection requires DNS onboarding and origin access rules; registering a domain does not prove traffic is protected." },
    { id: "create-policy", label: "Create protection policy", kind: "create", description: "Create a default WAF protection policy. Bind it to a domain separately.", fields: [policyName] },
    { id: "inspect-host", label: "Inspect domain and onboarding", kind: "inspect", resourcePrefixes: hostPrefixes, description: "Inspect protocols, origins, protection, DNS access state, and CNAME access code. No certificate private keys are displayed.", fields: [] },
    { id: "origin", label: "Replace origin configuration", kind: "update", resourcePrefixes: hostPrefixes, description: "Replace the complete origin server set with one public IPv4 origin and the selected client/origin protocols.", fields: originFields, confirmation: true, impact: "All traffic is forwarded to the new origin. Existing extra origins are removed. Protocol and certificate changes can affect clients and origin connections." },
    { id: "protect", label: "Enable domain protection", kind: "action", resourcePrefixes: hostPrefixes, description: "Enable WAF attack detection according to the domain's current policy.", fields: [], confirmation: true, impact: "The current policy starts enforcing its detection and blocking actions. Rules can reject traffic that previously passed." },
    { id: "pause", label: "Pause domain protection", kind: "action", resourcePrefixes: hostPrefixes, description: "Keep forwarding traffic through WAF while pausing attack detection.", fields: [], confirmation: true, impact: "WAF forwards requests without attack detection until protection is enabled again." },
    { id: "bypass", label: "Bypass WAF", kind: "action", resourcePrefixes: hostPrefixes, description: "Route the domain's requests directly to its origin without WAF inspection.", fields: [], confirmation: true, impact: "WAF protection is bypassed. Requests reach the origin without its attack detection or filtering." },
    { id: "bind-policy", label: "Bind protection policy", kind: "update", resourcePrefixes: hostPrefixes, description: "Add this domain to a current cloud policy while preserving that policy's other domain bindings.", fields: [policyChoice], confirmation: true, impact: "The new policy's rules apply to this domain immediately. Existing bindings on the destination policy are preserved." },
    { id: "delete-host", label: "Remove cloud domain", kind: "delete", resourcePrefixes: hostPrefixes, description: "Remove this domain's WAF configuration. Update its DNS before removing a domain that uses WAF CNAME access.", fields: [], confirmation: true, impact: "The domain loses WAF protection. DNS records still pointing at WAF can stop serving the website. This removes the domain configuration and does not cancel a WAF subscription." },
    { id: "inspect-policy", label: "Inspect policy and bound domains", kind: "inspect", resourcePrefixes: policyPrefixes, description: "Inspect basic protection level and all policy domain bindings.", fields: [] },
    { id: "rename-policy", label: "Rename policy", kind: "update", resourcePrefixes: policyPrefixes, description: "Rename the policy without changing rules or bindings.", fields: [policyName] },
    { id: "level", label: "Set basic protection level", kind: "update", resourcePrefixes: policyPrefixes, description: "Set the basic web protection sensitivity for every bound domain.", fields: [{ key: "level", label: "Protection level", type: "select", required: true, choices: [{ value: "1", label: "Loose" }, { value: "2", label: "Medium" }, { value: "3", label: "Strict" }] }], confirmation: true, impact: "Changing sensitivity changes blocking across all bound domains. Strict mode can reject requests that previously passed." },
    { id: "delete-policy", label: "Delete unbound policy", kind: "delete", resourcePrefixes: policyPrefixes, description: "Permanently delete a policy with no bound cloud or dedicated domains.", fields: [], confirmation: true, impact: "The policy and all of its rules are permanently removed. Bindings must be removed first." },
    { id: "ip-rules", label: "View IP rules", kind: "inspect", resourcePrefixes: policyPrefixes, description: "List IPv4/IPv6 allow, block, and log rules belonging to this policy.", fields: [] },
    { id: "create-ip-rule", label: "Create IP rule", kind: "action", resourcePrefixes: policyPrefixes, description: "Create one permanent IP/CIDR rule affecting every bound domain.", fields: [{ key: "name", label: "Rule name", required: true, max: 256 }, { key: "address", label: "IP address or CIDR", required: true, max: 64 }, { key: "action", label: "Action", type: "select", required: true, defaultValue: "2", choices: [{ value: "2", label: "Log only" }, { value: "0", label: "Block" }, { value: "1", label: "Allow" }] }, { key: "description", label: "Description", max: 256 }], confirmation: true, impact: policyImpact },
    { id: "ip-rule-status", label: "Enable or disable IP rule", kind: "update", resourcePrefixes: policyPrefixes, description: "Change the current state of one policy-owned IP rule.", fields: [ruleChoice, { key: "enabled", label: "Enable rule", type: "boolean", defaultValue: true }], confirmation: true, impact: policyImpact },
    { id: "delete-ip-rule", label: "Delete IP rule", kind: "action", resourcePrefixes: policyPrefixes, description: "Delete one IP rule belonging to this policy.", fields: [ruleChoice], confirmation: true, impact: policyImpact },
  ],
  inventory: async s => { const [domains, policyRows] = await Promise.all([hosts(s), policies(s)]); return [...domains.map(host => ({ id: `host:${host.id}`, name: asString(host.hostname), status: String(host.protect_status), values: { policyId: asString(host.policyid, "") } })), ...policyRows.map(policy => ({ id: `policy:${policy.id}`, name: asString(policy.name), status: "Available", values: { name: asString(policy.name) } }))]; },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create" || operation === "origin") { const [policyRows, certs] = await Promise.all([policies(s), certificates(s)]); return { policies: choices(policyRows), certificates: choices(certs.filter(cert => cert.exp_status !== 1)) }; }
    if (operation === "bind-policy") return { policies: choices(await policies(s)) };
    if (operation === "ip-rule-status" || operation === "delete-ip-rule") { const policy = await owned(s, resource, "policy"); return { ipRules: (await rules(s, String(policy.id))).map(rule => ({ value: String(rule.id), label: `${rule.name} · ${rule.addr} · action ${rule.white} · ${Number(rule.status) === 1 ? "Enabled" : "Disabled"}` })) }; }
    return {};
  },
  execute: async (s, operation, v, resource) => {
    const write = (path: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "waf", path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (operation === "create-policy") { const result = await write(`${base(s)}/policy`, "POST", { name: v.name, log_action_replaced: true }); if (!result.id) throw new Error("Huawei returned no policy ID. Check policies before retrying."); return { message: "Protection policy created. It has not been bound to a domain.", resourceId: `policy:${result.id}` }; }
    if (operation === "create") {
      if (!(await policies(s)).some(policy => policy.id === v.policy)) throw new ManagementInputError("Select a current protection policy.");
      const result = await write(`${base(s)}/instance`, "POST", { hostname: v.hostname, policyid: v.policy, ...(await origin(s, v, String(v.hostname))), proxy: v.proxy === true, exclusive_ip: false, paid_type: "postPaid" });
      if (!result.id || result.hostname !== v.hostname) throw new Error("Huawei returned no verified domain ID. Check protected domains before retrying.");
      return { message: "Cloud domain registered. Complete DNS onboarding and verify the access state before treating traffic as protected.", resourceId: `host:${result.id}`, asynchronous: true };
    }
    const type = resource?.id.startsWith("host:") ? "host" : "policy"; const current = await owned(s, resource, type); const id = String(current.id); const path = target(s, type, id);
    if (type === "host") {
      if (operation === "inspect-host") return { message: "Current WAF domain configuration and access state.", facts: [{ label: "Domain", value: String(current.hostname) }, { label: "Protection", value: current.protect_status === 1 ? "Enabled" : current.protect_status === 0 ? "Paused" : current.protect_status === -1 ? "Bypassed" : "Unknown" }, { label: "Traffic access", value: current.access_status === 1 ? "Accessible" : "Not verified accessible" }, { label: "CNAME access code", value: asString(current.access_code, "Not reported") }, { label: "Policy", value: asString(current.policyid, "Not reported") }, { label: "HTTPS certificate", value: asString(current.certificatename, "None") }, ...asArray(current.server).map(asRecord).map(server => ({ label: `${server.front_protocol} → ${server.back_protocol}`, value: `${server.address}:${server.port}` }))] };
      if (current.locked !== 0) throw new ManagementInputError("The domain is locked or its lock state could not be verified.", 409);
      if (operation === "origin") { await write(path, "PATCH", await origin(s, v, String(current.hostname))); return { message: "Origin configuration replaced. Check website access and origin health." }; }
      if (["protect", "pause", "bypass"].includes(operation)) { const state = operation === "protect" ? 1 : operation === "pause" ? 0 : -1; await write(`${base(s)}/instance/${encodeURIComponent(id)}/protect-status?enterprise_project_id=all_granted_eps`, "PUT", { protect_status: state }); return { message: operation === "protect" ? "Domain protection enabled." : operation === "pause" ? "Attack detection paused; traffic forwarding remains enabled." : "WAF protection bypassed." }; }
      if (operation === "bind-policy") {
        const policy = await owned(s, { id: `policy:${v.policy}`, name: String(v.policy) }, "policy");
        if (!Array.isArray(policy.hosts) || !Array.isArray(policy.bind_host)) throw new ManagementInputError("The policy binding lists could not be verified.");
        const existing = asArray(policy.hosts).map(String); const bindings = asArray(policy.bind_host).map(asRecord);
        if (bindings.some(binding => binding.waf_type !== "cloud")) throw new ManagementInputError("This policy also binds dedicated WAF domains. Use the complete mixed-domain workflow to change its bindings.");
        const available = await hosts(s); const ids = [...new Set([...existing, ...bindings.map(binding => String(binding.id)), id])];
        if (!ids.every(hostId => available.some(host => host.id === hostId))) throw new ManagementInputError("Every existing policy binding must be verified in this project.");
        await write(target(s, "policy", String(policy.id)), "PATCH", { hosts: ids }); return { message: "Policy bound to this domain; the destination policy's existing cloud domains are preserved." };
      }
      if (operation === "delete-host") { await write(path, "DELETE"); return { message: "Cloud domain configuration removed. Check its DNS and website access." }; }
    } else {
      if (operation === "inspect-policy") return { message: "Current protection policy and bindings.", facts: [{ label: "Policy", value: String(current.name) }, { label: "Basic level", value: String(current.level ?? "Unknown") }, { label: "Bound domains", value: asArray(current.bind_host).map(asRecord).map(host => `${host.hostname} · ${host.waf_type}`).join(", ") || asArray(current.hosts).map(String).join(", ") || "None" }] };
      if (operation === "rename-policy" || operation === "level") { await write(path, "PATCH", operation === "rename-policy" ? { name: v.name } : { level: Number(v.level) }); return { message: operation === "rename-policy" ? "Policy renamed." : "Basic protection sensitivity updated for all bound domains." }; }
      if (operation === "delete-policy") { if (!Array.isArray(current.hosts) || !Array.isArray(current.bind_host)) throw new ManagementInputError("The policy binding lists could not be verified."); if (asArray(current.hosts).length || asArray(current.bind_host).length || (await hosts(s)).some(host => host.policyid === id)) throw new ManagementInputError("Unbind every domain before deleting this policy.", 409); await write(path, "DELETE"); return { message: "Unbound protection policy deleted." }; }
      if (operation === "ip-rules") { const items = await rules(s, id); return { message: `${items.length} policy-owned IP rules.`, facts: items.map(rule => ({ label: `${rule.name} · ${rule.addr}`, value: `Action ${rule.white} · ${Number(rule.status) === 1 ? "Enabled" : "Disabled"}` })) }; }
      if (operation === "create-ip-rule") { const result = await write(`${base(s)}/policy/${encodeURIComponent(id)}/whiteblackip?enterprise_project_id=all_granted_eps`, "POST", { name: v.name, addr: ipAddress(v.address), white: Number(v.action), time_mode: "permanent", description: v.description ?? "" }); if (!result.id || result.policyid !== id) throw new Error("Huawei returned no verified IP rule. Check rules before retrying."); return { message: "Permanent IP rule created for this policy.", resourceId: resource!.id }; }
      if (operation === "ip-rule-status" || operation === "delete-ip-rule") {
        if (!(await rules(s, id)).some(rule => rule.id === v.rule)) throw new ManagementInputError("The rule no longer belongs to this policy.", 404);
        const rulePath = `${base(s)}/policy/${encodeURIComponent(id)}/whiteblackip/${encodeURIComponent(String(v.rule))}`;
        const rule = await huaweiFetch<Record<string, unknown>>(s, "waf", `${rulePath}?enterprise_project_id=all_granted_eps`);
        if (rule.id !== v.rule || rule.policyid !== id) throw new ManagementInputError("Huawei returned a rule from a different policy.", 404);
        if (operation === "delete-ip-rule") await write(`${rulePath}?enterprise_project_id=all_granted_eps`, "DELETE"); else await write(`${rulePath}/status?enterprise_project_id=all_granted_eps`, "PUT", { status: v.enabled === true ? 1 : 0 });
        return { message: operation === "delete-ip-rule" ? "Policy-owned IP rule deleted." : "IP rule status updated." };
      }
    }
    throw new ManagementInputError("Unsupported WAF operation for this resource.");
  },
  invalidationKeys: () => [cloudCacheKeys.listWafInstances],
};
