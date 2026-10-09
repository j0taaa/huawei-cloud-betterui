import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { huaweiFetch as nativeFetch, HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import type { ManagementAdapter } from "../types";

async function huaweiFetch<T>(session: BetterUiSession, service: "hss", path: string, init?: RequestInit): Promise<T> {
  try {
    const headers = new Headers(init?.headers); headers.set("region", session.region);
    const body = await nativeFetch<T>(session, service, path, { ...init, headers }), row = asRecord(body);
    if (row.error_code !== undefined && String(row.error_code) !== "0") throw new HuaweiApiError("Huawei rejected this HSS request.", 502);
    return body;
  } catch (error) { if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected this HSS request.", error.status); throw new Error("Huawei returned an unverifiable HSS response. Check native state before retrying."); }
}
async function huaweiList<T>(session: BetterUiSession, service: "hss", path: string, pagination: Pagination): Promise<T> {
  return collectList(cursor => { const url = new URL(path, "https://local.invalid"); if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor)); return huaweiFetch<T>(session, service, url.pathname + url.search); }, pagination);
}

// Native HSS v5 contracts verified against the cached official SDK:
// hosts and groups (host-management), protection switching with entitled quotas
// (host-management/protection + billing/quotas-detail), weak-password manual
// detection and scan status, security events (event/events + event/operate),
// and protection policies (host-management/policies). HSS protects existing
// hosts; it does not provision compute, and every mutation returns an empty
// body, so outcomes report honestly observed resource state instead of task IDs.
const base = (s: BetterUiSession) => `/v5/${s.projectId}`;
const hostPrefixes = ["host:"]; const groupPrefixes = ["group:"];
const paidEditions = ["hss.version.advanced", "hss.version.enterprise", "hss.version.premium", "hss.version.wtp", "hss.version.container.enterprise"];
const editionLabels: Record<string, string> = {
  "hss.version.null": "None", "hss.version.basic": "Basic (free)", "hss.version.advanced": "Advanced",
  "hss.version.enterprise": "Enterprise", "hss.version.premium": "Premium", "hss.version.wtp": "Web tamper protection",
  "hss.version.container.enterprise": "Container enterprise",
};
const agentLabels: Record<string, string> = { installed: "Installed", not_installed: "Not installed", online: "Online", offline: "Offline", install_failed: "Install failed", installing: "Installing" };
const protectLabels: Record<string, string> = { closed: "Closed", opened: "Protecting", protection_exception: "Protection exception" };
const detectLabels: Record<string, string> = { undetected: "Not detected", clean: "No risk", risk: "Risk found", scanning: "Scanning" };
const scanLabels: Record<string, string> = { neverscan: "Never scanned", scanning: "Scanning", scaned: "Scan finished", failed: "Scan failed", over_time: "Scan timed out (30 minutes)", longscanning: "Scan timed out (60 minutes)" };
const policyLabels: Record<string, string> = { not_applied: "Not applied", protection_degradation_not_applied: "Degraded, not applied", processing: "Applying", applied: "Applied" };
const chargingLabels: Record<string, string> = { packet_cycle: "Yearly/monthly", on_demand: "Pay-per-use" };
const groupNameField: ManagementField = { key: "name", label: "Host group name", required: true, min: 1, max: 256, help: "A descriptive host group name, up to 256 characters." };
const memberHostsField: ManagementField = { key: "hosts", label: "Member hosts", type: "list", source: "groupCandidates", required: true, max: 100, help: "Current hosts that belong to no host group." };

function search(s: BetterUiSession, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  void s;
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  return `?${params}`;
}

/** Malformed or duplicate rows fail closed instead of producing partial inventories. */
function checkedRows(rows: unknown, keys: string[], label: string) {
  if (!Array.isArray(rows)) throw new ManagementInputError(`Huawei returned an incomplete HSS ${label} inventory.`, 409);
  const seen = new Set<string>();
  const items: Record<string, unknown>[] = [];
  for (const row of rows) {
    const item = asRecord(row);
    const id = firstString(keys.map((key) => item[key]), "");
    if (!id) throw new Error(`Huawei returned an HSS ${label} row without an ID.`);
    if (seen.has(id)) throw new Error(`Huawei returned a duplicate HSS ${label} row.`);
    seen.add(id);
    items.push(item);
  }
  return items;
}

async function listRows(s: BetterUiSession, path: string, label: string, keys: string[], extra: Record<string, string | number> = {}) {
  const body = await huaweiList<Record<string, unknown>>(s, "hss", `${path}${search(s, { limit: 100, ...extra })}`, { items: ["data_list"], kind: "offset", parameter: "offset", size: 100, total: ["total_num", "total_count"] });
  const rows = checkedRows(body.data_list, keys, label);
  if (rows.some(row => row.project_id !== undefined && row.project_id !== s.projectId)) throw new ManagementInputError("Huawei returned an HSS resource from another project.", 409);
  return rows;
}

const hostRows = (s: BetterUiSession) => listRows(s, `${base(s)}/host-management/hosts`, "host", ["host_id"]);
const groupRows = (s: BetterUiSession) => listRows(s, `${base(s)}/host-management/groups`, "host group", ["group_id"]);
const quotaRows = (s: BetterUiSession, version?: string) => listRows(s, `${base(s)}/billing/quotas-detail`, "protection quota", ["resource_id"], { quota_status: "normal", used_status: "idle", ...(version ? { version } : {}) });
async function eventRows(s: BetterUiSession, hostId: string, handleStatus?: string) {
  const rows = await listRows(s, `${base(s)}/event/events`, "security event", ["event_id"], { category: "host", host_id: hostId, last_days: 30, ...(handleStatus ? { handle_status: handleStatus } : {}) });
  if (rows.some(row => firstString([row.host_id, asRecord(row.resource_info).vm_uuid], "") !== hostId)) throw new ManagementInputError("Huawei returned a security event with an unverified host parent.", 409);
  return rows;
}
// ListPoliciesRequest documents no region parameter, so this list is project-scoped only.
async function policyRows(s: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(s, "hss", `${base(s)}/host-management/policies?${new URLSearchParams({ limit: "100" })}`, { items: ["data_list"], kind: "offset", parameter: "offset", size: 100, total: ["total_num", "total_count"] });
  return checkedRows(body.data_list, ["policy_id"], "protection policy");
}

function prefixedId(resource: ManagementResource | undefined, prefix: "host:" | "group:") {
  if (!resource?.id.startsWith(prefix) || resource.id.length <= prefix.length) throw new ManagementInputError(`Select a current HSS ${prefix === "host:" ? "host" : "host group"}.`);
  return resource.id.slice(prefix.length);
}

async function currentHost(s: BetterUiSession, resource: ManagementResource | undefined) {
  const id = prefixedId(resource, "host:");
  const host = (await hostRows(s)).find((item) => firstString([item.host_id], "") === id);
  if (!host) throw new ManagementInputError("The host no longer belongs to this project.", 404);
  return host;
}

async function currentGroup(s: BetterUiSession, resource: ManagementResource | undefined) {
  const id = prefixedId(resource, "group:");
  const group = (await groupRows(s)).find((item) => firstString([item.group_id], "") === id);
  if (!group) throw new ManagementInputError("The host group no longer belongs to this project.", 404);
  return group;
}

/** Membership is derived from live hosts and must match the group's reported count, or nothing is rewritten. */
async function groupMemberIds(s: BetterUiSession, group: Record<string, unknown>) {
  const groupId = firstString([group.group_id], "");
  const members = (await hostRows(s)).filter((item) => firstString([item.group_id], "") === groupId).map((item) => firstString([item.host_id], ""));
  const reported = group.host_num;
  if (typeof reported !== "number" || !Number.isSafeInteger(reported) || reported < 0 || members.length !== reported) throw new ManagementInputError("The group's reported membership does not match its hosts. Refresh the inventory and retry.", 409);
  return members;
}

function epoch(value: unknown) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return "-";
  const date = new Date(time > 1e11 ? time : time * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "-";
}

function expired(value: unknown) {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 && (time > 1e11 ? time : time * 1000) <= Date.now();
}

function parseOffering(value: unknown) {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { return []; }
  return Array.isArray(parsed) ? parsed : [];
}

/** An idle, current entitlement row must independently confirm its status even though the query filtered it. */
function idleQuotaRow(row: Record<string, unknown>) {
  return row.quota_status === "normal" && row.used_status === "idle" && (row.host_id === "" || row.host_id === undefined) && typeof row.expire_time === "number" && Number.isFinite(row.expire_time) && row.expire_time >= 0 && !expired(row.expire_time);
}

function quotaChoice(row: Record<string, unknown>): ManagementChoice | null {
  const version = firstString([row.version], "");
  const chargingMode = firstString([row.charging_mode], "");
  const resourceId = firstString([row.resource_id], "");
  if (!paidEditions.includes(version) || !["packet_cycle", "on_demand"].includes(chargingMode) || !resourceId || !idleQuotaRow(row)) return null;
  const label = `${editionLabels[version] ?? version} edition · ${chargingLabels[chargingMode] ?? chargingMode} quota${Number(row.expire_time) > 0 ? ` · expires ${epoch(row.expire_time)}` : ""}`;
  return { value: JSON.stringify([version, chargingMode, resourceId]), label };
}

async function entitledQuota(s: BetterUiSession, offering: unknown) {
  const parsed = parseOffering(offering);
  if (parsed.length !== 3 || parsed.some(value => typeof value !== "string")) throw new ManagementInputError("Select an available protection edition and quota.");
  const [version, chargingMode, resourceId] = parsed.map(String);
  if (!paidEditions.includes(version) || !["packet_cycle", "on_demand"].includes(chargingMode) || !resourceId) throw new ManagementInputError("Select an available protection edition and quota.");
  const quota = (await quotaRows(s, version)).find((row) => firstString([row.resource_id], "") === resourceId);
  if (!quota || quota.version !== version || quota.charging_mode !== chargingMode || !idleQuotaRow(quota)) throw new ManagementInputError("The selected protection quota is no longer idle and current in this project.", 409);
  return { version, chargingMode, resourceId };
}

async function agentReady(s: BetterUiSession, resource: ManagementResource | undefined) {
  const host = await currentHost(s, resource);
  const agentStatus = firstString([host.agent_status], "");
  if (!["installed", "online"].includes(agentStatus)) throw new ManagementInputError(`The HSS agent is ${agentLabels[agentStatus] ?? (agentStatus || "not reported")} on this host. Protection and scans require an installed, online agent.`, 409);
  return host;
}

async function observeHost(s: BetterUiSession, hostId: string) {
  return hostRows(s).then((rows) => rows.find((item) => firstString([item.host_id], "") === hostId)).catch(() => undefined);
}

const operations: ManagementOperation[] = [
  { id: "create-group", label: "Create host group", kind: "create", description: "Create one host group from current project hosts that belong to no group.", fields: [groupNameField, memberHostsField], impact: "Grouping hosts changes how protection policies are applied to the selected hosts." },
  { id: "rename-group", label: "Rename host group", kind: "update", resourcePrefixes: groupPrefixes, description: "Change the group name while preserving its verified current membership.", fields: [groupNameField] },
  { id: "edit-group-hosts", label: "Replace group membership", kind: "update", resourcePrefixes: groupPrefixes, description: "Replace the complete membership of this group. An empty selection removes every host from the group.", fields: [{ ...memberHostsField, required: false, help: "The complete new membership: this group's current hosts plus hosts that belong to no group. Leave empty to empty the group." }], confirmation: true, impact: "The group's membership is replaced by the selection. Protection policy application changes for every removed or added host." },
  { id: "delete-group", label: "Delete empty host group", kind: "delete", resourcePrefixes: groupPrefixes, description: "Permanently delete a group that currently has no member hosts.", fields: [], confirmation: true, impact: "The empty host group is permanently removed." },
  { id: "inspect-host", label: "Inspect host protection", kind: "inspect", resourcePrefixes: hostPrefixes, description: "Show agent, edition, protection, entitlement, grouping, and risk states. Agent installation commands and private payloads are never returned.", fields: [] },
  { id: "protect", label: "Activate paid protection", kind: "action", resourcePrefixes: hostPrefixes, description: "Move one eligible host from the free edition to a paid edition using an existing idle entitlement. No new order is created.", fields: [{ key: "edition", label: "Protection edition and quota", type: "select", source: "editions", required: true, help: "Idle, current entitlements in this project. Pay-per-use entitlements start billing immediately." }], confirmation: true, impact: "The selected paid edition starts protecting this host and consumes one idle entitlement. Pay-per-use entitlements begin billing immediately; yearly/monthly entitlements continue their existing subscription. No new purchase order is created; activating pay-per-use protection authorizes its recurring charges." },
  { id: "unprotect", label: "Deactivate paid protection", kind: "action", resourcePrefixes: hostPrefixes, description: "Request the free basic edition for this host. Verify quota usage and billing after the change.", fields: [], confirmation: true, impact: "Paid protection stops and the host keeps only free basic protection. This request does not cancel the entitlement. Verify its usage and continuing subscription or pay-per-use billing separately." },
  { id: "scan", label: "Run weak-password detection", kind: "action", resourcePrefixes: hostPrefixes, description: "Start one native weak-password detection scan on this host.", fields: [], impact: "A weak-password detection scan runs on this host and can report weak credentials as risks." },
  { id: "scan-status", label: "View scan status", kind: "inspect", resourcePrefixes: hostPrefixes, description: "Show the current weak-password detection scan status and last completion time.", fields: [] },
  { id: "events", label: "View security events", kind: "inspect", resourcePrefixes: hostPrefixes, description: "List this host's security events from the last 30 days with severity and handling state.", fields: [] },
  { id: "handle-event", label: "Mark event handled", kind: "action", resourcePrefixes: hostPrefixes, description: "Mark one current unhandled security event of this host as handled.", fields: [{ key: "event", label: "Unhandled security event", type: "select", source: "unhandledEvents", required: true }, { key: "remark", label: "Handling remark", max: 256 }], confirmation: true, impact: "The event is marked as handled. Marking does not quarantine files or stop processes; the underlying threat remains until it is remediated." },
  { id: "policies", label: "View protection policies", kind: "inspect", resourcePrefixes: hostPrefixes, description: "List this project's protection policies and their application status.", fields: [] },
];

export const hssManagement: ManagementAdapter = {
  title: "Host Security Service",
  operations,
  inventory: async (s) => {
    const [hosts, groups] = await Promise.all([hostRows(s), groupRows(s)]);
    return [
      ...hosts.map((host) => ({
        id: `host:${firstString([host.host_id], "")}`,
        name: firstString([host.host_name, host.host_id], "-"),
        status: firstString([host.protect_status], "UNKNOWN"),
        values: {
          name: firstString([host.host_name, host.host_id], "-"),
          agentStatus: firstString([host.agent_status], "UNKNOWN"),
          version: firstString([host.version], "hss.version.null"),
          chargingMode: firstString([host.charging_mode], ""),
          resourceId: firstString([host.resource_id], ""),
          groupId: firstString([host.group_id], ""),
          groupName: firstString([host.group_name], ""),
          policyGroupName: firstString([host.policy_group_name], ""),
          osType: firstString([host.os_type], ""),
          privateIp: firstString([host.private_ip], ""),
          publicIp: firstString([host.public_ip], ""),
          detectResult: firstString([host.detect_result], ""),
          vulnerabilityCount: Number(host.vulnerability) || 0,
          baselineCount: Number(host.baseline) || 0,
          intrusionCount: Number(host.intrusion) || 0,
        },
      })),
      ...groups.map((group) => ({
        id: `group:${firstString([group.group_id], "")}`,
        name: firstString([group.group_name, group.group_id], "-"),
        status: "Available",
        values: { name: firstString([group.group_name], ""), hostNum: Number(group.host_num) || 0, riskHostNum: Number(group.risk_host_num) || 0, unprotectHostNum: Number(group.unprotect_host_num) || 0 },
      })),
    ];
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "protect") {
      const quotas = (await quotaRows(s)).map(quotaChoice).filter((choice): choice is ManagementChoice => !!choice);
      if (!resource) return { editions: quotas };
      const host = (await hostRows(s)).find((item) => `host:${firstString([item.host_id], "")}` === resource.id);
      const version = host ? firstString([host.version], "") : "";
      const agent = host ? firstString([host.agent_status], "") : "";
      return { editions: !host || !["hss.version.null", "hss.version.basic"].includes(version) || !["installed", "online"].includes(agent) ? [] : quotas };
    }
    if (operation === "create-group" || operation === "edit-group-hosts") {
      const hosts = await hostRows(s);
      const groupId = operation === "edit-group-hosts" ? prefixedId(resource, "group:") : "";
      return { groupCandidates: hosts.filter((host) => {
        const current = firstString([host.group_id], "");
        return !current || (groupId && current === groupId);
      }).map((host) => ({ value: firstString([host.host_id], ""), label: `${firstString([host.host_name, host.host_id], "-")} · ${agentLabels[firstString([host.agent_status], "")] ?? "Agent unknown"} · ${firstString([host.os_type], "-")}` })) };
    }
    if (operation === "handle-event") {
      const hostId = prefixedId(resource, "host:");
      const rows = await eventRows(s, hostId, "unhandled");
      return { unhandledEvents: rows.filter((row) => row.handle_status === "unhandled" && asArray(row.operate_accept_list).includes("mark_as_handled")).map((row) => {
        const eventClassId = firstString([row.event_class_id], "");
        const eventId = firstString([row.event_id], "");
        const eventType = Number(row.event_type);
        const occurTime = Number(row.occur_time);
        return { value: JSON.stringify([eventClassId, eventId, eventType, occurTime]), label: `${firstString([row.event_name, eventClassId], "-")} · ${firstString([row.severity], "-")} · ${epoch(row.occur_time)}` };
      }) };
    }
    return {};
  },
  poll: async (s, entry) => {
    if (entry.operation === "Delete host group") {
      if (!entry.resourceId?.startsWith("group:") || entry.jobId !== entry.resourceId.slice(6)) throw new ManagementInputError("This history entry has no verified HSS group deletion identity.");
      const rows = await groupRows(s);
      return rows.some(row => row.group_id === entry.jobId) ? { state: "submitted", message: "The original host group is still present." } : { state: "succeeded", message: "The original host group is absent from the complete native inventory.", resourceId: entry.resourceId };
    }
    if (!["Activate paid protection", "Deactivate paid protection"].includes(entry.operation) || !entry.resourceId?.startsWith("host:") || !entry.jobId) throw new ManagementInputError("This HSS operation has no original protection observation.");
    const host = await currentHost(s, { id: entry.resourceId, name: "" });
    const complete = entry.operation === "Activate paid protection" ? host.resource_id === entry.jobId && paidEditions.includes(firstString([host.version], "")) && host.protect_status === "opened" : host.version === "hss.version.basic";
    return complete ? { state: "succeeded", message: "The original host now reports the requested protection state. Check entitlement billing separately.", resourceId: entry.resourceId } : { state: "submitted", message: "The original host has not yet reached the requested protection state." };
  },
  invalidationKeys: () => [cloudCacheKeys.listHssHosts, cloudCacheKeys.summary],
  execute: async (s, operation, values, resource) => {
    if (operation === "create-group") {
      const name = String(values.name);
      const hosts = values.hosts as string[] | undefined;
      if (!Array.isArray(hosts) || !hosts.length || hosts.some(id => typeof id !== "string") || new Set(hosts).size !== hosts.length || hosts.length > 100) throw new ManagementInputError("Select at least one member host.");
      const [groups, liveHosts] = await Promise.all([groupRows(s), hostRows(s)]);
      if (groups.some((group) => firstString([group.group_name], "") === name)) throw new ManagementInputError("A host group with this name already exists in this project.", 409);
      const known = new Set(liveHosts.map((host) => firstString([host.host_id], "")));
      if (hosts.some((id) => !known.has(id))) throw new ManagementInputError("The selected hosts are no longer available in this project.", 404);
      if (liveHosts.some((host) => hosts.includes(firstString([host.host_id], "")) && firstString([host.group_id], "") !== "")) throw new ManagementInputError("Some selected hosts already belong to a host group. Edit that group's membership instead.", 409);
      await huaweiFetch(s, "hss", `${base(s)}/host-management/groups${search(s)}`, { method: "POST", body: JSON.stringify({ group_name: name, host_id_list: hosts }) });
      const created = await groupRows(s).then((rows) => rows.find((group) => firstString([group.group_name], "") === name)).catch(() => undefined);
      if (!created) return { message: "Host group creation accepted. The new group was not yet visible; reload the inventory to verify it." };
      const observedMembers = await groupMemberIds(s, created).catch(() => undefined);
      if (!observedMembers || observedMembers.length !== hosts.length || observedMembers.some(id => !hosts.includes(id))) return { message: "Host group creation accepted. The group is visible but its exact selected membership has not been verified; reload the inventory to verify it.", resourceId: `group:${firstString([created.group_id], "")}` };
      return { message: `Host group created with ${hosts.length} member host${hosts.length === 1 ? "" : "s"}.`, resourceId: `group:${firstString([created.group_id], "")}` };
    }
    if (operation === "rename-group") {
      const group = await currentGroup(s, resource);
      const name = String(values.name);
      const groupId = firstString([group.group_id], "");
      const [groups, members] = await Promise.all([groupRows(s), groupMemberIds(s, group)]);
      if (groups.some((other) => firstString([other.group_id], "") !== groupId && firstString([other.group_name], "") === name)) throw new ManagementInputError("A host group with this name already exists in this project.", 409);
      await huaweiFetch(s, "hss", `${base(s)}/host-management/groups${search(s)}`, { method: "PUT", body: JSON.stringify({ group_id: groupId, group_name: name, host_id_list: members }) });
      return { message: "Host group rename accepted with its verified existing membership. Inspect the group to verify the change.", resourceId: resource!.id };
    }
    if (operation === "edit-group-hosts") {
      const group = await currentGroup(s, resource);
      const groupId = firstString([group.group_id], "");
      const selected = values.hosts as string[] | undefined;
      const hosts = selected ?? [];
      if (!Array.isArray(hosts) || hosts.some(id => typeof id !== "string") || new Set(hosts).size !== hosts.length || hosts.length > 100) throw new ManagementInputError("Select distinct current hosts, up to 100.");
      const liveHosts = await hostRows(s);
      const reported = group.host_num;
      const currentMembers = liveHosts.filter((item) => firstString([item.group_id], "") === groupId);
      if (typeof reported !== "number" || !Number.isSafeInteger(reported) || reported < 0 || currentMembers.length !== reported) throw new ManagementInputError("The group's reported membership does not match its hosts. Refresh the inventory and retry.", 409);
      const known = new Set(liveHosts.map((host) => firstString([host.host_id], "")));
      if (hosts.some((id) => !known.has(id))) throw new ManagementInputError("The selected hosts are no longer available in this project.", 404);
      if (liveHosts.some((host) => hosts.includes(firstString([host.host_id], "")) && firstString([host.group_id], "") !== "" && firstString([host.group_id], "") !== groupId)) throw new ManagementInputError("Some selected hosts already belong to another host group.", 409);
      await huaweiFetch(s, "hss", `${base(s)}/host-management/groups${search(s)}`, { method: "PUT", body: JSON.stringify({ group_id: groupId, group_name: firstString([group.group_name], ""), host_id_list: hosts }) });
      const observed = await groupRows(s).then((rows) => rows.find((row) => firstString([row.group_id], "") === groupId)).catch(() => undefined);
      const observedMembers = observed ? await groupMemberIds(s, observed).catch(() => undefined) : undefined;
      if (!observedMembers || observedMembers.length !== hosts.length || observedMembers.some(id => !hosts.includes(id))) return { message: "Group membership replacement accepted. The reported membership did not yet match the selection; reload the inventory to verify it.", resourceId: resource!.id };
      return { message: `Group membership replaced with ${hosts.length} host${hosts.length === 1 ? "" : "s"}.`, resourceId: resource!.id };
    }
    if (operation === "delete-group") {
      const group = await currentGroup(s, resource);
      const groupId = firstString([group.group_id], "");
      if (group.group_name !== resource!.name) throw new ManagementInputError("The group name changed. Refresh before confirming deletion.", 409);
      const members = await groupMemberIds(s, group);
      if (members.length) throw new ManagementInputError("Remove every host from this group before deleting it.", 409);
      if (Number(group.host_num) > 0) throw new ManagementInputError("The group's reported membership does not match its hosts. Refresh the inventory and retry.", 409);
      await huaweiFetch(s, "hss", `${base(s)}/host-management/groups${search(s, { group_id: groupId })}`, { method: "DELETE" });
      return { message: "Empty host group deletion accepted. Observe its original native identity to verify removal.", resourceId: resource!.id, jobId: groupId, asynchronous: true };
    }
    const hostId = prefixedId(resource, "host:");
    if (operation === "inspect-host") {
      const host = await currentHost(s, resource);
      const version = firstString([host.version], "hss.version.null");
      const chargingMode = firstString([host.charging_mode], "");
      return { message: "Current HSS host protection state.", facts: [
        { label: "Agent", value: agentLabels[firstString([host.agent_status], "")] ?? firstString([host.agent_status], "Not reported") },
        { label: "Edition", value: editionLabels[version] ?? version },
        { label: "Protection", value: protectLabels[firstString([host.protect_status], "")] ?? firstString([host.protect_status], "Not reported") },
        { label: "Charging mode", value: chargingLabels[chargingMode] ?? (chargingMode || "Not reported") },
        { label: "Entitled resource", value: firstString([host.resource_id], "None") },
        { label: "Host group", value: firstString([host.group_name], "None") },
        { label: "Policy group", value: firstString([host.policy_group_name], "None") },
        { label: "Operating system", value: [firstString([host.os_type], ""), firstString([host.os_name], "")].filter(Boolean).join(" · ") || "Not reported" },
        { label: "Private IP", value: firstString([host.private_ip], "None") },
        { label: "Public IP", value: firstString([host.public_ip], "None") },
        { label: "Detection result", value: detectLabels[firstString([host.detect_result], "")] ?? firstString([host.detect_result], "Not reported") },
        { label: "Vulnerabilities", value: String(Number(host.vulnerability) || 0) },
        { label: "Baseline risks", value: String(Number(host.baseline) || 0) },
        { label: "Intrusions", value: String(Number(host.intrusion) || 0) },
        { label: "Edition expiry", value: epoch(host.expire_time) },
      ] };
    }
    if (operation === "protect") {
      const host = await agentReady(s, resource);
      const version = firstString([host.version], "");
      if (!["hss.version.null", "hss.version.basic"].includes(version)) throw new ManagementInputError("The host already has a paid protection edition.", 409);
      const quota = await entitledQuota(s, values.edition);
      await huaweiFetch(s, "hss", `${base(s)}/host-management/protection${search(s)}`, { method: "POST", body: JSON.stringify({ version: quota.version, charging_mode: quota.chargingMode, resource_id: quota.resourceId, host_id_list: [hostId] }) });
      const observed = await observeHost(s, hostId);
      if (!observed) return { message: "Protection activation accepted. Observe the original host and entitlement to verify activation.", resourceId: resource!.id, jobId: quota.resourceId, asynchronous: true };
      const observedVersion = firstString([observed.version], "");
      if (observedVersion !== quota.version || observed.resource_id !== quota.resourceId || observed.charging_mode !== quota.chargingMode || observed.protect_status !== "opened") return { message: `Protection activation accepted; the host still reports ${editionLabels[observedVersion] ?? (observedVersion || "no edition")}. Activation may still be propagating; observe the original host and entitlement.`, resourceId: resource!.id, jobId: quota.resourceId, asynchronous: true };
      return { message: `Paid protection activated: the host now reports the ${editionLabels[observedVersion] ?? observedVersion} edition.`, resourceId: resource!.id };
    }
    if (operation === "unprotect") {
      const host = await currentHost(s, resource);
      if (host.host_name !== resource!.name) throw new ManagementInputError("The host name changed. Refresh before confirming protection removal.", 409);
      const version = firstString([host.version], "");
      if (!paidEditions.includes(version)) throw new ManagementInputError("The host does not have a paid protection edition.", 409);
      const chargingMode = firstString([host.charging_mode], "");
      const resourceId = firstString([host.resource_id], "");
      if (!["packet_cycle", "on_demand"].includes(chargingMode) || !resourceId) throw new ManagementInputError("The host's current entitlement could not be verified. Refresh the inventory and retry.", 409);
      await huaweiFetch(s, "hss", `${base(s)}/host-management/protection${search(s)}`, { method: "POST", body: JSON.stringify({ version: "hss.version.basic", charging_mode: chargingMode, resource_id: resourceId, host_id_list: [hostId] }) });
      const observed = await observeHost(s, hostId);
      if (!observed) return { message: "Protection deactivation accepted. Observe the original host to verify the edition change.", resourceId: resource!.id, jobId: resourceId, asynchronous: true };
      const observedVersion = firstString([observed.version], "");
      if (observedVersion !== "hss.version.basic") return { message: `Protection deactivation accepted; the host still reports the ${editionLabels[observedVersion] ?? observedVersion} edition. The change may still be propagating; observe the original host.`, resourceId: resource!.id, jobId: resourceId, asynchronous: true };
      return { message: "Paid protection deactivated; the host returned to the free basic edition and now reports the basic edition. Check quota usage and billing separately.", resourceId: resource!.id };
    }
    if (operation === "scan") {
      await agentReady(s, resource);
      await huaweiFetch(s, "hss", `${base(s)}/host-management/${encodeURIComponent(hostId)}/manual-detect`, { method: "POST", body: JSON.stringify({ type: "pwd" }) });
      const status = await huaweiFetch<Record<string, unknown>>(s, "hss", `${base(s)}/host-management/${encodeURIComponent(hostId)}/scan-status?type=pwd`).catch(() => undefined);
      const observed = status ? firstString([status.scan_status], "") : "";
      return { message: observed ? `Weak-password detection scan submitted; the host currently reports: ${scanLabels[observed] ?? observed}.` : "Weak-password detection scan submitted. The scan status could not be re-read; use View scan status to verify.", resourceId: resource!.id };
    }
    if (operation === "scan-status") {
      await currentHost(s, resource);
      const status = await huaweiFetch<Record<string, unknown>>(s, "hss", `${base(s)}/host-management/${encodeURIComponent(hostId)}/scan-status?type=pwd`);
      const observed = firstString([status.scan_status], "");
      return { message: "Current weak-password detection scan status.", facts: [
        { label: "Scan status", value: scanLabels[observed] ?? (observed || "Not reported") },
        { label: "Last completed", value: epoch(status.scaned_time) },
      ] };
    }
    if (operation === "events") {
      await currentHost(s, resource);
      const rows = await eventRows(s, hostId);
      return { message: `${rows.length} security event${rows.length === 1 ? "" : "s"} loaded from the last 30 days.`, facts: rows.map((row) => ({
        label: `${firstString([row.event_name, row.event_class_id], "-")} · ${firstString([row.severity], "-")} · ${firstString([row.handle_status], "-")}`,
        value: `${epoch(row.occur_time)} · ${firstString([row.event_id], "-")}`,
      })) };
    }
    if (operation === "handle-event") {
      await currentHost(s, resource);
      const parsed = parseOffering(values.event);
      const eventClassId = typeof parsed[0] === "string" ? parsed[0] : "";
      const eventId = typeof parsed[1] === "string" ? parsed[1] : "";
      const eventType = Number(parsed[2]);
      const occurTime = Number(parsed[3]);
      if (parsed.length !== 4 || !eventClassId || !eventId || !Number.isSafeInteger(eventType) || !Number.isSafeInteger(occurTime)) throw new ManagementInputError("Select a current unhandled security event of this host.");
      const rows = await eventRows(s, hostId, "unhandled");
      const target = rows.find((row) => firstString([row.event_id], "") === eventId);
      if (!target) throw new ManagementInputError("The selected security event was not found among this host's unhandled events.", 404);
      if (target.handle_status !== "unhandled") throw new ManagementInputError("The selected security event is already handled.", 409);
      if (firstString([target.event_class_id], "") !== eventClassId || Number(target.event_type) !== eventType || Number(target.occur_time) !== occurTime) throw new ManagementInputError("The selected security event changed. Refresh the form and select it again.", 409);
      if (!asArray(target.operate_accept_list).includes("mark_as_handled")) throw new ManagementInputError("Huawei does not currently offer marking this event as handled.", 409);
      const remark = String(values.remark ?? "").trim();
      await huaweiFetch(s, "hss", `${base(s)}/event/operate${search(s)}`, { method: "POST", body: JSON.stringify({ operate_type: "mark_as_handled", ...(remark ? { handler: remark } : {}), operate_event_list: [{ event_class_id: eventClassId, event_id: eventId, event_type: eventType, occur_time: occurTime }] }) });
      return { message: "Security event marked as handled. Marking does not remove the underlying threat; review the host's risks.", resourceId: resource!.id };
    }
    if (operation === "policies") {
      await currentHost(s, resource);
      const rows = await policyRows(s);
      return { message: `${rows.length} protection polic${rows.length === 1 ? "y" : "ies"} loaded.`, facts: rows.map((row) => ({
        label: `${firstString([row.policy_name, row.policy_id], "-")}${firstString([row.feature_name], "") ? ` · ${firstString([row.feature_name], "")}` : ""}`,
        value: `${policyLabels[firstString([row.policy_status], "")] ?? firstString([row.policy_status], "Status unknown")} · group ${firstString([row.group_id], "-")} · ${firstString([row.policy_id], "-")}`,
      })) };
    }
    throw new ManagementInputError("Unsupported HSS operation.");
  },
};
