import "server-only";
import { isIP } from "node:net";
import type { BetterUiSession } from "@/lib/auth-session";
import { HuaweiApiError, huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, timestampMillis } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { listEcsInstancesForProject } from "@/lib/huawei/services/ecs";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

type Row = Record<string, unknown>;
const idPattern = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
const idle = ["READY", "MIGRATE_SUCCESS", "SYNC_SUCCESS", "MIGRATE_FAIL", "SYNC_FAIL", "ABORT"];
const resumable = ["READY", "MIGRATE_FAIL", "SYNC_FAIL", "ABORT"];
const running = ["RUNNING", "SYNCING"];
const name: ManagementField = { key: "name", label: "Migration task name", required: true, max: 64, pattern: "^[\u4e00-\u9fa5A-Za-z0-9_-]{1,64}$" };
const speed: ManagementField = { key: "speed", label: "Speed limit (Mbit/s)", type: "number", min: 0, max: 1000, required: true, defaultValue: 100, help: "0 removes the fixed limit. Scheduled limits remain separately configured." };
const id = (value: unknown) => {
  const result = asString(value, "");
  if (!idPattern.test(result)) throw new ManagementInputError("Select a current SMS resource with a verified native ID.", 409);
  return result;
};
const requireState = (row: Row, states: string[]) => {
  if (!states.includes(asString(row.state, ""))) throw new ManagementInputError("This operation is unavailable in the task's current or unknown state.", 409);
};
async function tasks(s: BetterUiSession) {
  const body = await huaweiList<Row>(s, "sms", "/v3/tasks?limit=100&offset=0", { items: ["tasks"], kind: "offset", parameter: "offset", size: 100, total: ["count"] });
  return asArray(body.tasks).map(asRecord);
}
async function sources(s: BetterUiSession) {
  const body = await huaweiList<Row>(s, "sms", "/v3/sources?limit=100&offset=0", { items: ["source_servers"], kind: "offset", parameter: "offset", size: 100, total: ["count"] });
  return asArray(body.source_servers).map(asRecord);
}
async function source(s: BetterUiSession, sourceId: string) {
  if (!(await sources(s)).some(row => row.id === sourceId)) throw new ManagementInputError("The registered source is no longer available to this project.", 404);
  const row = asRecord(await huaweiFetch(s, "sms", `/v3/sources/${id(sourceId)}`));
  if (row.id !== sourceId) throw new ManagementInputError("The source identity could not be verified.", 409);
  return row;
}
async function task(s: BetterUiSession, taskId: string) {
  const row = asRecord(await huaweiFetch(s, "sms", `/v3/tasks/${id(taskId)}`));
  if (row.id !== taskId || row.project_id !== s.projectId || row.region_id !== s.region) throw new ManagementInputError("The migration task's target project and region could not be verified.", 409);
  return row;
}
async function server(s: BetterUiSession, serverId: string) {
  const body = asRecord(await huaweiFetch(s, "ecs", `/v1/${s.projectId}/cloudservers/${id(serverId)}`));
  const row = asRecord(body.server);
  if (row.id !== serverId || row.tenant_id !== s.projectId || row.status !== "SHUTOFF") throw new ManagementInputError("Select a stopped ECS target in this project. Its disks will be overwritten when migration runs.", 409);
  return row;
}
async function acknowledge(s: BetterUiSession, path: string, method: string, body?: Row) {
  const response = asRecord(await huaweiFetch(s, "sms", path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }));
  if (response.error_code || response.error_msg || response.error) throw new ManagementInputError("SMS rejected this request. Inspect the task before retrying.", 409);
  return response;
}
function sourceLayout(row: Row) {
  if (row.os_type !== "LINUX" || row.connected !== true || row.state !== "waiting" || !Object.hasOwn(row, "current_task") || asRecord(row.current_task).id || !Array.isArray(row.volume_groups) || row.volume_groups.length || !Array.isArray(row.btrfs_list) || row.btrfs_list.length || !Array.isArray(row.disks) || row.disks.length !== 1) throw new ManagementInputError("Creation currently requires a connected, waiting Linux source with one disk, no existing task, LVM, or Btrfs.", 409);
  const disk = asRecord(row.disks[0]);
  if (disk.os_disk !== true || !["MBR", "GPT"].includes(String(disk.partition_style)) || typeof disk.name !== "string" || !Number.isSafeInteger(disk.size) || Number(disk.size) <= 0 || !Number.isSafeInteger(disk.used_size) || Number(disk.used_size) < 0 || Number(disk.used_size) > Number(disk.size) || !Array.isArray(disk.physical_volumes) || !disk.physical_volumes.length) throw new ManagementInputError("The source disk's layout and sizes could not be verified.", 409);
  const physicalVolumes = disk.physical_volumes.map(asRecord);
  if (physicalVolumes.some(part => !Number.isSafeInteger(part.index) || Number(part.index) < 0 || !Number.isSafeInteger(part.size) || Number(part.size) <= 0 || Number(part.size) > Number(disk.size) || !Number.isSafeInteger(part.used_size) || Number(part.used_size) < 0 || Number(part.used_size) > Number(part.size) || typeof part.name !== "string" || typeof part.mount_point !== "string" || !["ext2", "ext3", "ext4", "xfs", "swap", "vfat", "fat32"].includes(String(part.file_system).toLowerCase()))) throw new ManagementInputError("This source uses an unsupported or unverified partition layout.", 409);
  if (!physicalVolumes.some(part => part.mount_point === "/")) throw new ManagementInputError("The Linux root partition could not be verified.", 409);
  const keys = ["device_use", "file_system", "index", "mount_point", "name", "size", "used_size", "inode_size", "uuid"];
  return { disk, physicalVolumes: physicalVolumes.map(part => Object.fromEntries(keys.filter(key => part[key] !== undefined).map(key => [key, part[key]]))) };
}
function facts(row: Row) {
  return [
    { label: "Task", value: `${asString(row.name)} · ${asString(row.id)}` },
    { label: "State", value: asString(row.state, "UNKNOWN") },
    { label: "Migration type", value: asString(row.type) },
    { label: "Source", value: `${asString(asRecord(row.source_server).name)} · ${asString(asRecord(row.source_server).id)}` },
    { label: "Target", value: `${asString(asRecord(row.target_server).name)} · ${asString(asRecord(row.target_server).vm_id)}` },
    { label: "Project / region", value: `${asString(row.project_id)} · ${asString(row.region_id)}` },
    { label: "Speed", value: `${Number(row.migrate_speed) || 0} Mbit/s · fixed limit ${Number(row.speed_limit) || 0} Mbit/s` },
    { label: "Created / started / finished", value: [row.create_date, row.start_date, row.finish_date].map(timestampMillis).join(" · ") },
    ...asArray(row.sub_tasks).map(asRecord).map(subtask => ({ label: asString(subtask.name), value: `${Number(subtask.progress) || 0}% · ${timestampMillis(subtask.start_date)} · ${timestampMillis(subtask.end_date)}` })),
  ];
}

export const smsManagement: ManagementAdapter = {
  title: "Server Migration Service",
  operations: [
    { id: "create", label: "Create migration task", kind: "create", description: "Prepare a private migration from a registered Linux source with one disk to an existing stopped ECS with one boot disk. Source registration and Agent installation happen on the source host. Migration and target boot are disabled initially.", fields: [name, { key: "source", label: "Registered source", type: "select", source: "sources", required: true }, { key: "target", label: "Stopped ECS target", type: "select", source: "targets", required: true }, speed], impact: "When started, migration overwrites the selected target's boot disk. Back up the target first. Network traffic, snapshots, and temporary migration resources may incur charges." },
    { id: "inspect", label: "View migration progress", kind: "inspect", description: "Inspect native task state, source/target identity, speed, times, and subtask progress. Credentials, transfer certificates, error payloads, and process traces are omitted.", fields: [] },
    { id: "rename", label: "Rename migration task", kind: "update", description: "Change the task name without changing disks, network, or other migration settings.", fields: [name], allowedStatuses: idle },
    { id: "speed", label: "Change fixed speed limit", kind: "update", description: "Change the fixed transfer limit while keeping separate scheduled limits intact.", fields: [speed], allowedStatuses: [...idle, ...running], impact: "A larger limit can increase network load and billed traffic. 0 removes the fixed limit." },
    { id: "speed-rules", label: "View scheduled speed limits", kind: "inspect", description: "Read this task's native scheduled transfer limits.", fields: [] },
    { id: "start", label: "Start or resume migration", kind: "action", description: "Start a prepared, paused, or failed task after rechecking its registered source and stopped ECS target.", fields: [], allowedStatuses: resumable, confirmation: true, impact: "Source data overwrites the target disks. The task can allocate temporary billed resources and consume network bandwidth. Keep the target stopped and back up its data first." },
    { id: "stop", label: "Pause migration", kind: "action", description: "Ask SMS to pause an active migration or synchronization task.", fields: [], allowedStatuses: running, confirmation: true, impact: "Data transfer pauses asynchronously. Already copied data and billed resources are retained." },
    { id: "network-check", label: "Check migration network", kind: "action", description: "Run SMS's network-quality check using the task's existing endpoints.", fields: [], allowedStatuses: idle, confirmation: true, impact: "The registered Agent sends network-check traffic to the saved migration endpoint." },
    { id: "delete", label: "Delete inactive migration task", kind: "delete", description: "Delete an inactive migration task. Source registration, target servers, snapshots, and other cloud resources have separate lifecycles.", fields: [], allowedStatuses: idle, confirmation: true, impact: "The migration configuration and task history are permanently removed. Existing cloud resources may continue to incur charges." },
  ],
  inventory: async s => (await tasks(s)).map(row => ({ id: id(row.id), name: asString(row.name), status: asString(row.state, "UNKNOWN"), values: { name: asString(row.name), speed: Number(row.speed_limit) || 0, source: asString(asRecord(row.source_server).id), target: asString(asRecord(row.target_server).vm_id) } })),
  options: async (s, operation): Promise<Record<string, ManagementChoice[]>> => {
    if (operation !== "create") return {};
    const [registered, targets] = await Promise.all([sources(s), listEcsInstancesForProject(s)]);
    return { sources: registered.filter(row => row.os_type === "LINUX" && row.connected === true && row.state === "waiting" && !asRecord(row.current_task).id).map(row => ({ value: id(row.id), label: `${asString(row.name)} · ${asString(row.id)}` })), targets: targets.filter(row => row.status === "SHUTOFF" && row.attachedDiskIds.length === 1).map(row => ({ value: id(row.id), label: `${row.name} · ${row.id} · boot disk will be overwritten` })) };
  },
  invalidationKeys: () => [cloudCacheKeys.listSmsTasks, cloudCacheKeys.listEcsInstances, cloudCacheKeys.listEvsDisks, cloudCacheKeys.summary],
  execute: async (s, operation, values, resource?: ManagementResource) => {
    if (["speed", "create"].includes(operation) && (!Number.isSafeInteger(values.speed) || Number(values.speed) < 0 || Number(values.speed) > 1000)) throw new ManagementInputError("Use an integer speed limit between 0 and 1000 Mbit/s.");
    if (operation === "create") {
      const sourceId = id(values.source);
      const registered = await source(s, sourceId);
      const layout = sourceLayout(registered);
      const targetId = id(values.target);
      const target = await server(s, targetId);
      const attached = asArray(target["os-extended-volumes:volumes_attached"]).map(asRecord);
      if (attached.length !== 1) throw new ManagementInputError("The target must have exactly one verified boot disk.", 409);
      const diskId = id(attached[0].id);
      const volume = asRecord(asRecord(await huaweiFetch(s, "evs", `/v2/${s.projectId}/cloudvolumes/${diskId}`)).volume);
      const attachments = asArray(volume.attachments).map(asRecord);
      if (volume.id !== diskId || volume.status !== "in-use" || volume.bootable !== "true" || volume.multiattach !== false || asRecord(volume.metadata).__system__encrypted !== "0" || !Number.isSafeInteger(volume.size) || Number(volume.size) * 1024 ** 3 < Number(layout.disk.size) || attachments.length !== 1 || attachments[0].server_id !== targetId) throw new ManagementInputError("The target boot disk's capacity, attachment, and unencrypted nonshared state could not be verified.", 409);
      const addresses = Object.values(asRecord(target.addresses)).flatMap(asArray).map(asRecord).filter(address => address["OS-EXT-IPS:type"] === "fixed" && isIP(String(address.addr)) === 4);
      if (addresses.length !== 1) throw new ManagementInputError("The target must have exactly one verified private IPv4 migration address.", 409);
      const response = await acknowledge(s, "/v3/tasks", "POST", { name: String(values.name), type: "MIGRATE_BLOCK", os_type: "LINUX", source_server: { id: sourceId }, target_server: { vm_id: targetId, name: String(target.name), disks: [{ name: layout.disk.name, disk_id: diskId, device_use: layout.disk.device_use, size: layout.disk.size, used_size: layout.disk.used_size, physical_volumes: layout.physicalVolumes }], volume_groups: [], btrfs_list: [] }, migration_ip: String(addresses[0].addr), region_name: s.region, region_id: s.region, project_name: s.projectName, project_id: s.projectId, exist_server: true, auto_start: false, start_target_server: false, use_public_ip: false, use_ipv6: false, syncing: false, speed_limit: Number(values.speed), is_need_consistency_check: true });
      const created = asString(response.id, "");
      if (!idPattern.test(created)) throw new Error("SMS returned no verified task ID. Inspect the source's task before retrying.");
      return { message: "Migration task created with automatic transfer and target boot disabled. Review network reachability and target backups before starting.", resourceId: created };
    }
    if (!resource) throw new ManagementInputError("Select a current migration task.");
    const current = await task(s, resource.id);
    if (operation === "inspect") return { message: "Native task progress. Private traces and credentials are omitted.", facts: facts(current), resourceId: resource.id };
    if (operation === "speed-rules") {
      const body = asRecord(await huaweiFetch(s, "sms", `/v3/tasks/${resource.id}/speed-limit`));
      if (!Array.isArray(body.speed_limit)) throw new Error("SMS returned no verified scheduled speed limits.");
      return { message: "Scheduled transfer limits loaded.", facts: body.speed_limit.map(asRecord).map(row => ({ label: `${asString(row.start)} - ${asString(row.end)}`, value: `${Number(row.speed) || 0} Mbit/s` })) };
    }
    const path = `/v3/tasks/${resource.id}`;
    if (operation === "rename" || operation === "speed") {
      requireState(current, operation === "rename" ? idle : [...idle, ...running]);
      await acknowledge(s, path, "PUT", operation === "rename" ? { name: String(values.name) } : { speed_limit: Number(values.speed) });
      return { message: operation === "rename" ? "Migration task renamed." : "Fixed transfer limit updated; scheduled rules are unchanged.", resourceId: resource.id };
    }
    if (operation === "delete") {
      requireState(current, idle);
      await acknowledge(s, path, "DELETE");
      return { message: "Migration task deletion accepted. Check inventory; source registration and cloud resources remain separate.", resourceId: resource.id, jobId: resource.id, asynchronous: true };
    }
    if (!["start", "stop", "network-check"].includes(operation)) throw new ManagementInputError("Unsupported migration operation.");
    requireState(current, operation === "start" ? resumable : operation === "stop" ? running : idle);
    const sourceId = id(asRecord(current.source_server).id);
    const registered = await source(s, sourceId);
    if (asRecord(registered.current_task).id !== current.id || (operation !== "stop" && registered.connected !== true)) throw new ManagementInputError("This task's current registered Agent and task association could not be verified.", 409);
    if (operation === "start") await server(s, id(asRecord(current.target_server).vm_id));
    await acknowledge(s, `${path}/action`, "POST", { operation: operation === "network-check" ? "network_check" : operation });
    return { message: "Migration action accepted. Inspect task progress for its current state; SMS provides no separate execution ID for this request.", resourceId: resource.id, jobId: resource.id, asynchronous: true };
  },
  poll: async (s, entry) => {
    if (!entry.resourceId || entry.jobId !== entry.resourceId) throw new ManagementInputError("This operation has no verified migration task to inspect.");
    if (entry.operation === "Delete inactive migration task") {
      try { await task(s, entry.resourceId); }
      catch (error) { if (error instanceof HuaweiApiError && error.status === 404) return { state: "succeeded", message: "The migration task is no longer present." }; throw error; }
    }
    const current = await task(s, entry.resourceId);
    return { state: "submitted", message: `Current task state: ${asString(current.state, "UNKNOWN")}. SMS exposes no separate execution identity for this request; inspect progress before another action.` };
  },
};
