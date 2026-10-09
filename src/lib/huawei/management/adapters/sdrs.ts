import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { listEcsInstancesForProject } from "@/lib/huawei/services/ecs";
import { listEvsDisksForProject } from "@/lib/huawei/services/evs";
import { listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

// Current BRS/SDRS synchronous-replication v1 API (2026-04-23 API reference).
// Child IDs contain their protection group, which is verified from fresh native records.
type Kind = "group" | "instance" | "pair" | "drill";
type RecordRow = Record<string, unknown>;
const paths: Record<Kind, { path: string; list: string; detail: string }> = {
  group: { path: "server-groups", list: "server_groups", detail: "server_group" },
  instance: { path: "protected-instances", list: "protected_instances", detail: "protected_instance" },
  pair: { path: "replications", list: "replications", detail: "replication" },
  drill: { path: "disaster-recovery-drills", list: "disaster_recovery_drills", detail: "disaster_recovery_drill" },
};
const root = (s: BetterUiSession) => `/v1/${s.projectId}`;
const name: ManagementField = { key: "name", label: "Name", required: true, max: 64, maxBytes: 64, pattern: "^[\\p{L}\\p{N}_.-]+$" };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 64, maxBytes: 64, allowEmpty: true, pattern: "^[^<>]*$" };
const tagPattern = "^[^\\u0000-\\u001f*<>\\\\=,|/]*$";
const groupPrefix = ["group:"];
const stable = ["available", "protected", "failed-over"];
const failedStable = [...stable, "error", "error-starting", "error-stopping", "error-reversing", "error-failing-over", "error-deleting", "error-reprotecting", "error-resizing", "invalid", "fault"];

async function rows(s: BetterUiSession, kind: Kind): Promise<RecordRow[]> {
  const p = paths[kind];
  // `count` is documented as the number in the list, not an authoritative total.
  const body = await huaweiList<RecordRow>(s, "sdrs", `${root(s)}/${p.path}?limit=100&offset=0`, { items: [p.list], kind: "offset", parameter: "offset", size: 100 });
  return asArray(body[p.list]).map(raw => {
    const item = asRecord(raw);
    if (typeof item.id !== "string" || !item.id || (kind !== "group" && (typeof item.server_group_id !== "string" || !item.server_group_id))) throw new Error("Huawei returned a recovery resource without a verified ID and protection group.");
    return item;
  });
}
function tagged(kind: Kind, row: RecordRow) { return kind === "group" ? `group:${row.id}` : `${kind}:${row.server_group_id}/${row.id}`; }
async function current(s: BetterUiSession, resource: ManagementResource | undefined, kind: Kind) {
  const match = resource?.id.match(/^(group|instance|pair|drill):([^/]+)(?:\/([^/]+))?$/);
  if (!match || match[1] !== kind || (kind !== "group" && !match[3]) || (kind === "group" && match[3])) throw new ManagementInputError(`Select a recovery ${kind}.`);
  const groupId = match[2], id = match[3] ?? groupId, p = paths[kind];
  if (!(await rows(s, kind)).some(row => row.id === id && (kind === "group" || row.server_group_id === groupId))) throw new ManagementInputError("The recovery resource no longer belongs to this project and protection group.", 404);
  const item = asRecord((await huaweiFetch<RecordRow>(s, "sdrs", `${root(s)}/${p.path}/${encodeURIComponent(id)}`))[p.detail]);
  if (item.id !== id || (kind !== "group" && item.server_group_id !== groupId)) throw new ManagementInputError("The recovery resource's current identity and parent could not be verified.", 409);
  return { item, id, groupId };
}
function state(item: RecordRow, allowed: string[]) {
  if (!allowed.includes(String(item.status))) throw new ManagementInputError(`The resource is ${String(item.status ?? "unverified")}; this operation is unavailable in its current state.`, 409);
}
async function domains(s: BetterUiSession) {
  const body = await huaweiFetch<RecordRow>(s, "sdrs", `${root(s)}/active-domains`);
  if (!Array.isArray(body.domains)) throw new Error("Huawei did not return the active-active domain catalog.");
  return asArray(body.domains).map(asRecord).filter(d => typeof d.id === "string" && d.sold_out === false && typeof asRecord(d.local_replication_cluster).availability_zone === "string" && typeof asRecord(d.remote_replication_cluster).availability_zone === "string" && asRecord(d.local_replication_cluster).availability_zone !== asRecord(d.remote_replication_cluster).availability_zone);
}
async function quotas(s: BetterUiSession) {
  const body = await huaweiFetch<RecordRow>(s, "sdrs", `${root(s)}/sdrs/quotas`);
  const resources = asRecord(body.quotas).resources;
  if (!Array.isArray(resources)) throw new Error("Huawei did not return recovery quotas.");
  return resources.map(asRecord);
}
async function requireQuota(s: BetterUiSession, type: string, amount = 1) {
  const quota = (await quotas(s)).find(q => q.type === type);
  if (!quota || !Number.isSafeInteger(quota.used) || !Number.isSafeInteger(quota.quota) || Number(quota.used) < 0 || Number(quota.quota) < -1) throw new ManagementInputError("The current recovery quota could not be verified.", 409);
  if (Number(quota.quota) !== -1 && Number(quota.used) + amount > Number(quota.quota)) throw new ManagementInputError("The recovery quota is exhausted.", 409);
}
async function children(s: BetterUiSession, groupId: string) {
  const [instances, pairs, drills] = await Promise.all([rows(s, "instance"), rows(s, "pair"), rows(s, "drill")]);
  return { instances: instances.filter(r => r.server_group_id === groupId), pairs: pairs.filter(r => r.server_group_id === groupId), drills: drills.filter(r => r.server_group_id === groupId) };
}
async function tags(s: BetterUiSession, instanceId: string) {
  const body = await huaweiFetch<RecordRow>(s, "sdrs", `${root(s)}/protected-instances/${encodeURIComponent(instanceId)}/tags`);
  if (!Array.isArray(body.tags)) throw new Error("The current protected-instance tags could not be verified.");
  return body.tags.map(row => {
    const tag = asRecord(row);
    if (typeof tag.key !== "string" || !tag.key || typeof tag.value !== "string") throw new Error("Huawei returned an invalid recovery tag.");
    return { key: tag.key, value: tag.value };
  });
}
async function servers(s: BetterUiSession, instances: RecordRow[], bothSites: boolean, priority: unknown) {
  if (priority !== "source" && priority !== "target") throw new ManagementInputError("The current production site could not be verified.", 409);
  const live = await listEcsInstancesForProject(s);
  for (const instance of instances) {
    const ids = bothSites ? [instance.source_server, instance.target_server] : [priority === "source" ? instance.source_server : instance.target_server];
    for (const id of ids) {
      const server = live.find(v => v.id === id && v.projectId === s.projectId);
      if (!server || server.status !== "SHUTOFF" || !["", "-"].includes(server.taskState)) throw new ManagementInputError("Shut down the required production and recovery servers and wait for current tasks to finish before switching or reprotecting.", 409);
    }
  }
}
const facts = (item: RecordRow, keys: string[]) => keys.map(key => ({ label: key.replaceAll("_", " "), value: ["string", "number", "boolean"].includes(typeof item[key]) ? String(item[key]) : "-" }));

export const sdrsManagement: ManagementAdapter = {
  title: "Storage Disaster Recovery",
  operations: [
    { id: "create", label: "Create protection group", kind: "create", description: "Create a synchronous recovery group using a live active-active domain and an existing VPC.", fields: [name, description, { key: "domain", label: "Production → recovery AZ pair", type: "select", source: "domains", required: true }, { key: "vpc", label: "Production VPC", type: "select", source: "vpcs", required: true }], impact: "Subsequent protected resources incur replication, disk, and recovery-server charges. This group uses migration within one VPC." },
    { id: "quotas", label: "View recovery quotas", kind: "create", description: "Read the current regional protection-group and replication-pair quotas.", fields: [] },
    { id: "inspect-group", label: "View group topology and synchronization", kind: "inspect", resourcePrefixes: groupPrefix, description: "Inspect current production/recovery sites, synchronization, protected servers, disk pairs, and drills.", fields: [] },
    { id: "rename-group", label: "Rename protection group", kind: "update", resourcePrefixes: groupPrefix, description: "Rename this group while preserving its recovery topology.", fields: [name] },
    { id: "delete-group", label: "Delete empty protection group", kind: "delete", resourcePrefixes: groupPrefix, allowedStatuses: ["available", "error"], description: "Delete a group only after every protected instance, disk pair, and drill has been removed.", fields: [], confirmation: true, impact: "The recovery configuration is permanently removed." },
    { id: "create-instance", label: "Protect a cloud server", kind: "action", resourcePrefixes: groupPrefix, allowedStatuses: ["available", "protected"], description: "Create a recovery server with the production server's default flavor and network settings. Shared disks are excluded.", fields: [name, description, { key: "server", label: "Production server", type: "select", source: "servers", required: true }], impact: "Creates a recovery server and recovery disks, which incur charges. Changes to names, security groups, agencies, tags, and auto-recovery are not automatically synchronized after protection is enabled." },
    { id: "create-pair", label: "Create replication pair", kind: "action", resourcePrefixes: groupPrefix, allowedStatuses: ["available", "protected"], description: "Replicate an available, non-shared production disk in the group's production AZ.", fields: [name, description, { key: "disk", label: "Production disk", type: "select", source: "disks", required: true }], impact: "Creates a billed recovery disk and replication relationship." },
    { id: "start", label: "Enable protection", kind: "action", resourcePrefixes: groupPrefix, allowedStatuses: ["available", "error-starting"], description: "Start synchronous replication for an existing group containing disk pairs.", fields: [], impact: "Enables billed replication. Recovery-site data is replaced by production-site data." },
    { id: "stop", label: "Disable protection", kind: "action", resourcePrefixes: groupPrefix, allowedStatuses: ["protected", "error-stopping"], description: "Stop synchronizing data between the production and recovery sites.", fields: [], confirmation: true, impact: "Recovery copies stop receiving new writes; recovery readiness decreases while resources may continue to incur charges." },
    { id: "reverse", label: "Planned switchover", kind: "action", resourcePrefixes: groupPrefix, allowedStatuses: ["protected", "error-reversing"], description: "Switch the production site to the other AZ after shutting down both sites' servers.", fields: [], confirmation: true, impact: "Interrupts applications and reverses replication direction. Keep both sites' servers shut down during the cloud job; Windows credentials may need resetting after the first switch." },
    { id: "failover", label: "Emergency failover", kind: "action", resourcePrefixes: groupPrefix, allowedStatuses: ["protected", "error-failing-over", "error-reversing"], description: "Promote the recovery site during an outage. Replication stops until reprotection succeeds.", fields: [], confirmation: true, impact: "Unsynchronized writes may be lost. The recovery site becomes production and protection stops. Isolate the failed production site to prevent conflicting writes; application/network recovery remains necessary." },
    { id: "reprotect", label: "Reprotect after failover", kind: "action", resourcePrefixes: groupPrefix, allowedStatuses: ["failed-over", "error-reprotecting"], description: "Restart replication from the current production site after both sites' servers have been shut down.", fields: [], confirmation: true, impact: "The new recovery site's data is overwritten by current production data. Keep servers shut down while the job runs." },
    { id: "create-drill", label: "Create recovery drill", kind: "action", resourcePrefixes: groupPrefix, allowedStatuses: stable, description: "Create test servers in an automatically created isolated drill VPC after initial synchronization completes.", fields: [name], impact: "Creates billed test servers and disks. Enterprise-project membership, custom routes, and network ACLs are not automatically copied; verify them before running applications. The drill VPC remains after drill deletion." },
    { id: "tags", label: "View protected-server tags", kind: "inspect", resourcePrefixes: ["instance:"], description: "List tags attached to this protected instance.", fields: [] },
    { id: "set-tag", label: "Set protected-server tag", kind: "action", resourcePrefixes: ["instance:"], description: "Add a tag or replace the value of one existing key, preserving other tags.", fields: [{ key: "key", label: "Tag key", required: true, max: 36, pattern: tagPattern }, { key: "value", label: "Tag value", required: true, allowEmpty: true, max: 43, pattern: tagPattern }], impact: "A matching tag key's value is replaced. Cost allocation or automation that reads this tag may change." },
    { id: "delete-tag", label: "Delete protected-server tag", kind: "action", resourcePrefixes: ["instance:"], description: "Remove one current tag key from this protected instance.", fields: [{ key: "key", label: "Tag key", type: "select", source: "tags", required: true }], confirmation: true, impact: "The selected tag is removed; tag-based allocation and automation may change." },
    ...(["instance", "pair", "drill"] as const).flatMap(kind => [
      { id: `inspect-${kind}`, label: `View ${kind === "instance" ? "protected server" : kind === "pair" ? "replication pair" : "recovery drill"}`, kind: "inspect" as const, resourcePrefixes: [`${kind}:`], description: "Read the current native identity, parent, state, and topology.", fields: [] },
      { id: `rename-${kind}`, label: `Rename ${kind}`, kind: "update" as const, resourcePrefixes: [`${kind}:`], description: "Rename this resource without changing its configuration.", fields: [name] },
      { id: `delete-${kind}`, label: `Delete ${kind === "instance" ? "protection (retain recovery server)" : kind === "pair" ? "detached pair (retain recovery disk)" : "recovery drill and test resources"}`, kind: "delete" as const, resourcePrefixes: [`${kind}:`], allowedStatuses: kind === "drill" ? ["available", "error", "error-deleting"] : failedStable, description: kind === "drill" ? "Delete the test servers, disks, and NICs; retain the drill VPC and subnets." : "Remove protection while retaining recovery resources; retained resources continue to incur charges.", fields: [], confirmation: true, impact: kind === "drill" ? "All drill servers, attached disks, and NICs are permanently destroyed. Drill data is lost; the drill VPC and subnets remain." : "This resource loses disaster-recovery protection. Recovery resources are retained and may continue to incur charges." },
    ]),
  ],
  inventory: async s => {
    const kinds: Kind[] = ["group", "instance", "pair", "drill"];
    const collections = await Promise.all(kinds.map(kind => rows(s, kind)));
    return kinds.flatMap((kind, index) => collections[index].map(item => ({ id: tagged(kind, item), name: asString(item.name, String(item.id)), status: asString(item.status, "UNKNOWN"), values: { name: asString(item.name), description: asString(item.description), groupId: kind === "group" ? String(item.id) : String(item.server_group_id) } })));
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [catalog, vpcs] = await Promise.all([domains(s), listVpcsForProject(s)]);
      return { domains: catalog.map(d => ({ value: String(d.id), label: `${String(d.name)} · ${String(asRecord(d.local_replication_cluster).availability_zone)} → ${String(asRecord(d.remote_replication_cluster).availability_zone)}` })), vpcs: vpcs.map(v => ({ value: v.id, label: `${v.name} · ${v.cidr}` })) };
    }
    if (operation === "create-instance" || operation === "create-pair") {
      const { item: group } = await current(s, resource, "group");
      if (group.priority_station !== "source") return { servers: [], disks: [] };
      if (operation === "create-pair") return { disks: (await listEvsDisksForProject(s)).filter(d => d.availabilityZone === group.source_availability_zone && d.status === "available" && d.isShareable === "false").map(d => ({ value: d.id, label: `${d.name} · ${d.size}` })) };
      const protectedIds = new Set((await rows(s, "instance")).flatMap(i => [i.source_server, i.target_server]));
      return { servers: (await listEcsInstancesForProject(s)).filter(server => server.availabilityZone === group.source_availability_zone && server.metadata.some(m => m.key === "vpc_id" && m.value === group.source_vpc_id) && ["ACTIVE", "SHUTOFF"].includes(server.status) && ["", "-"].includes(server.taskState) && !protectedIds.has(server.id)).map(server => ({ value: server.id, label: `${server.name} · ${server.status} · ${server.flavor}` })) };
    }
    if (operation === "delete-tag") {
      const { id } = await current(s, resource, "instance");
      return { tags: (await tags(s, id)).map(t => ({ value: t.key, label: `${t.key}: ${t.value}` })) };
    }
    return {};
  },
  execute: async (s, operation, v, resource) => {
    const send = (path: string, method: string, body?: unknown) => huaweiFetch<RecordRow>(s, "sdrs", `${root(s)}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const submitted = (body: RecordRow, message: string, resourceId?: string) => {
      if (typeof body.job_id !== "string" || !body.job_id) throw new Error("Huawei did not return a recovery job ID. Check native recovery tasks before submitting another request.");
      return { message, resourceId, jobId: body.job_id, asynchronous: true };
    };
    if (operation === "quotas") return { message: "Current recovery quotas loaded.", facts: (await quotas(s)).map(q => ({ label: String(q.type), value: `${String(q.used)} used / ${q.quota === -1 ? "unlimited" : String(q.quota)}` })) };
    if (operation === "create") {
      const [catalog, vpcs] = await Promise.all([domains(s), listVpcsForProject(s)]);
      const domain = catalog.find(d => d.id === v.domain);
      if (!domain || !vpcs.some(p => p.id === v.vpc && p.projectId === s.projectId)) throw new ManagementInputError("Choose a current available AZ pair and owned VPC.", 409);
      await requireQuota(s, "server_groups");
      return submitted(await send("/server-groups", "POST", { server_group: { name: v.name, description: v.description ?? "", domain_id: domain.id, source_availability_zone: asRecord(domain.local_replication_cluster).availability_zone, target_availability_zone: asRecord(domain.remote_replication_cluster).availability_zone, source_vpc_id: v.vpc, dr_type: "migration" } }), "Protection-group creation submitted.");
    }
    const definition = sdrsManagement.operations.find(o => o.id === operation);
    if (!definition) throw new ManagementInputError("Unsupported recovery operation.");
    const kind = definition.resourcePrefixes?.[0]?.slice(0, -1) as Kind;
    const selected = await current(s, resource, kind);
    if (definition.allowedStatuses) state(selected.item, definition.allowedStatuses);
    const group = kind === "group" ? selected.item : (await current(s, { id: `group:${selected.groupId}`, name: selected.groupId }, "group")).item;
    const nativePath = `/${paths[kind].path}/${encodeURIComponent(selected.id)}`;
    if (operation === "tags" || operation === "set-tag" || operation === "delete-tag") {
      const live = await tags(s, selected.id);
      if (operation === "tags") return { message: `${live.length} protected-server tags loaded.`, facts: live.map(t => ({ label: t.key, value: t.value })) };
      state(selected.item, stable);
      if (operation === "set-tag") {
        if (!live.some(t => t.key === v.key) && live.length >= 10) throw new ManagementInputError("The protected instance already has the maximum of 10 tags.", 409);
        await send(`${nativePath}/tags`, "POST", { tag: { key: v.key, value: v.value } });
        return { message: "Protected-server tag saved.", resourceId: resource!.id };
      }
      if (!live.some(t => t.key === v.key)) throw new ManagementInputError("This tag key no longer exists on the protected instance.", 404);
      await send(`${nativePath}/tags/${encodeURIComponent(String(v.key))}`, "DELETE");
      return { message: "Protected-server tag removed.", resourceId: resource!.id };
    }
    if (operation.startsWith("inspect-")) {
      const keys = kind === "group" ? ["id", "status", "priority_station", "source_availability_zone", "target_availability_zone", "source_vpc_id", "target_vpc_id", "progress", "protection_type"] : ["id", "server_group_id", "status", "progress", "source_server", "target_server", "drill_vpc_id", "replication_status", "fault_level"];
      const output = facts(selected.item, keys);
      if (kind === "group") { const live = await children(s, selected.id); for (const [label, list] of Object.entries(live)) for (const child of list) output.push({ label: `${label}: ${String(child.name)}`, value: `${String(child.id)} · ${String(child.status)} · ${String(child.progress ?? "-")}%` }); }
      return { message: "Current recovery topology loaded.", facts: output };
    }
    if (operation.startsWith("rename-")) {
      state(selected.item, kind === "drill" ? ["available", "error"] : stable);
      const body = await send(nativePath, "PUT", { [paths[kind].detail]: { name: v.name } });
      const renamed = asRecord(body[paths[kind].detail]);
      if (renamed.id !== selected.id || renamed.name !== v.name) throw new Error("Huawei did not confirm the resource rename. Refresh its details before retrying.");
      return { message: "Recovery resource renamed.", resourceId: resource!.id };
    }
    if (operation === "delete-group") {
      const live = await children(s, selected.id);
      if (Object.values(live).some(list => list.length) || ["protected_instance_num", "replication_num", "disaster_recovery_drill_num"].some(key => selected.item[key] !== 0)) throw new ManagementInputError("Remove every protected instance, replication pair, and drill before deleting the group.", 409);
      return submitted(await send(nativePath, "DELETE"), "Protection-group deletion submitted.", resource!.id);
    }
    if (operation.startsWith("delete-")) {
      state(group, [...stable, "error-starting", "error-stopping", "error-reversing", "error-failing-over", "error-deleting", "error-reprotecting"]);
      if (kind === "pair" && (!Array.isArray(selected.item.attachment) || selected.item.attachment.length)) throw new ManagementInputError("Detach the replication pair and verify its attachment list before deletion.", 409);
      const body = kind === "instance" ? { delete_target_server: false, delete_target_eip: false } : kind === "pair" ? { replication: { server_group_id: selected.groupId, delete_target_volume: false } } : undefined;
      return submitted(await send(nativePath, "DELETE", body), "Recovery-resource deletion submitted.", resource!.id);
    }
    if (operation === "create-instance" || operation === "create-pair") {
      if (group.priority_station !== "source") throw new ManagementInputError("Adding protected resources currently requires the original production site to be active.", 409);
      if (operation === "create-pair") {
        const disk = (await listEvsDisksForProject(s)).find(d => d.id === v.disk && d.projectId === s.projectId);
        if (!disk || disk.availabilityZone !== group.source_availability_zone || disk.status !== "available" || disk.isShareable !== "false" || disk.attachedServerId) throw new ManagementInputError("Choose an available non-shared, detached disk in the production AZ.", 409);
        await requireQuota(s, "replications");
        return submitted(await send("/replications", "POST", { replication: { server_group_id: selected.id, volume_id: disk.id, name: v.name, description: v.description ?? "" } }), "Replication-pair creation submitted.", resource!.id);
      }
      const [ecs, evs, instances] = await Promise.all([listEcsInstancesForProject(s), listEvsDisksForProject(s), rows(s, "instance")]);
      const server = ecs.find(e => e.id === v.server && e.projectId === s.projectId);
      if (!server || !["ACTIVE", "SHUTOFF"].includes(server.status) || !["", "-"].includes(server.taskState) || server.availabilityZone !== group.source_availability_zone || !server.metadata.some(m => m.key === "vpc_id" && m.value === group.source_vpc_id) || instances.some(i => i.source_server === server.id || i.target_server === server.id)) throw new ManagementInputError("Choose an unprotected, idle server in this group's production AZ and VPC.", 409);
      if (!server.attachedDiskIds.length || server.attachedDiskIds.some(id => !evs.some(d => d.id === id && d.isShareable === "false" && d.attachedServerId === server.id))) throw new ManagementInputError("All production-server disks must be verified, attached, and non-shared.", 409);
      await requireQuota(s, "replications", server.attachedDiskIds.length);
      return submitted(await send("/protected-instances", "POST", { protected_instance: { server_group_id: selected.id, server_id: server.id, name: v.name, description: v.description ?? "", tenancy: "shared" } }), "Protected-instance creation submitted.", resource!.id);
    }
    const live = await children(s, selected.id);
    if (!live.pairs.length) throw new ManagementInputError("This recovery operation requires replication pairs.", 409);
    if (operation === "create-drill") {
      if (live.pairs.some(pair => pair.progress !== 100 || !["active", "active-stopped"].includes(String(pair.replication_status)))) throw new ManagementInputError("Wait until initial synchronization completes for every replication pair before creating a drill.", 409);
      return submitted(await send("/disaster-recovery-drills", "POST", { disaster_recovery_drill: { name: v.name, server_group_id: selected.id } }), "Recovery-drill creation submitted; test resources will incur charges.", resource!.id);
    }
    if (operation === "reverse" || operation === "reprotect") await servers(s, live.instances, true, group.priority_station);
    if (operation === "failover" && live.pairs.some(p => p.fault_level === 5)) throw new ManagementInputError("The replication link is broken; contact native recovery support before attempting failover.", 409);
    const action = operation === "start" || operation === "reprotect" ? "start-server-group" : operation === "stop" ? "stop-server-group" : operation === "failover" ? "failover-server-group" : operation === "reverse" ? "reverse-server-group" : "";
    if (!action) throw new ManagementInputError("Unsupported recovery operation.");
    if (operation === "reverse" && group.priority_station !== "source" && group.priority_station !== "target") throw new ManagementInputError("The current production site is unverified.", 409);
    return submitted(await send(`${nativePath}/action`, "POST", { [action]: operation === "reverse" ? { priority_station: group.priority_station === "source" ? "target" : "source" } : {} }), "Recovery action submitted; check the cloud job before operating on servers.", resource!.id);
  },
  poll: async (s, entry) => {
    if (!entry.jobId) return { state: "submitted", message: "No native recovery job is recorded." };
    const job = await huaweiFetch<RecordRow>(s, "sdrs", `${root(s)}/jobs/${encodeURIComponent(entry.jobId)}`);
    if (job.job_id !== entry.jobId) throw new ManagementInputError("The native recovery job identity could not be verified.", 409);
    const entities = asRecord(job.entities);
    const match = entry.resourceId?.match(/^(group|instance|pair|drill):([^/]+)(?:\/([^/]+))?$/);
    if (match && typeof entities.server_group_id === "string" && entities.server_group_id !== match[2]) throw new ManagementInputError("The recovery job belongs to another protection group.", 409);
    const childKey = match?.[1] === "instance" ? "protected_instance_id" : match?.[1] === "pair" ? "replication_pair_id" : "";
    if (childKey && typeof entities[childKey] === "string" && entities[childKey] !== match?.[3]) throw new ManagementInputError("The recovery job belongs to another child resource.", 409);
    const resourceId = entry.resourceId ?? (typeof entities.server_group_id === "string" ? `group:${entities.server_group_id}` : undefined);
    if (job.status === "SUCCESS") return { state: "succeeded", resourceId, message: "The native recovery job succeeded. Verify application, network, and protection readiness separately." };
    if (job.status === "FAIL") return { state: "failed", resourceId, message: `The recovery job failed (${asString(job.error_code, "provider error")}). Inspect native tasks before retrying.` };
    return { state: "submitted", resourceId, message: `Recovery job is ${asString(job.status, "unverified")}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listSdrsProtectedInstances, cloudCacheKeys.listEcsInstances, cloudCacheKeys.listEvsDisks, cloudCacheKeys.listVpcs, cloudCacheKeys.summary],
};
