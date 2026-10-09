import "server-only";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { listOmsMigrationTasksForProject } from "@/lib/huawei/services/oms";
import { listObsBuckets } from "@/lib/huawei/services/obs";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";
const base = (s: BetterUiSession) => `/v2/${s.projectId}/tasks`;
const credentials: ManagementField[] = [
  { key: "sourceAk", label: "Source access key", type: "password", required: true, max: 100 },
  { key: "sourceSk", label: "Source secret key", type: "password", required: true, max: 100 },
  { key: "sourceToken", label: "Source temporary security token", type: "password", max: 16384 },
  { key: "destinationAk", label: "Destination OBS access key", type: "password", required: true, max: 100 },
  { key: "destinationSk", label: "Destination OBS secret key", type: "password", required: true, max: 100 },
  { key: "destinationToken", label: "Destination temporary security token", type: "password", max: 16384 },
];
const cost = "Migration starts immediately and reads source objects, writes destination objects, and can incur source transfer/request charges, OMS charges, and OBS storage/request charges. Existing destination objects follow the selected overwrite policy. Credentials are sent to Huawei to perform the migration and are omitted from BetterUI history.";
const bandwidth: ManagementField = { key: "bandwidth", label: "Migration bandwidth (MiB/s)", type: "number", required: true, min: 1, max: 200, defaultValue: 50 };
async function task(s: BetterUiSession, resource: ManagementResource) {
  if (!/^(?:0|[1-9]\d{0,14})$/.test(resource.id)) throw new ManagementInputError("Select a valid migration task.");
  if (!(await listOmsMigrationTasksForProject(s)).some(task => task.id === resource.id)) throw new ManagementInputError("The migration task no longer belongs to this project.", 404);
  const current = await huaweiFetch<Record<string, unknown>>(s, "oms", `${base(s)}/${encodeURIComponent(resource.id)}`);
  if (String(current.id) !== resource.id || (current.project_id && current.project_id !== s.projectId)) throw new ManagementInputError("Huawei returned an unverified migration task.", 404);
  return current;
}
async function buckets(s: BetterUiSession) { return (await listObsBuckets(s)).filter(bucket => bucket.location === s.region); }
function policy(mib: unknown) { return [{ start: "00:00", end: "23:59", max_bandwidth: Number(mib) * 1048576 }]; }
function supported(current: Record<string, unknown>) {
  if (!["AWS", "HuaweiCloud", "Aliyun"].includes(String(asRecord(current.src_node).cloud_type)) || !["object", "prefix"].includes(String(current.task_type)) || current.group_type === "SYNC_TASK") throw new ManagementInputError("This workflow supports standalone AWS, OBS, and Aliyun object or prefix migrations. Use the matching credential/connector workflow for other sources.");
}
export const omsManagement: ManagementAdapter = {
  title: "Object Storage Migration Tasks",
  operations: [
    { id: "create", label: "Create and start migration", kind: "create", description: "Start a bucket or prefix migration from AWS S3, Huawei OBS, or Aliyun OSS into a current OBS bucket in this region. Huawei starts the task immediately.", fields: [
      { key: "sourceCloud", label: "Source cloud", type: "select", required: true, defaultValue: "AWS", choices: [{ value: "AWS", label: "Amazon S3" }, { value: "HuaweiCloud", label: "Huawei OBS" }, { value: "Aliyun", label: "Aliyun OSS" }] },
      { key: "sourceRegion", label: "Source region", required: true, max: 100 }, { key: "sourceBucket", label: "Source bucket", required: true, max: 1024 },
      { key: "sourcePrefix", label: "Source object prefix", maxBytes: 1024, allowEmpty: true, help: "Leave blank to migrate the entire bucket. Prefixes match every object key starting with this text." },
      { key: "destinationBucket", label: "Destination OBS bucket", type: "select", source: "buckets", required: true },
      { key: "destinationPrefix", label: "Destination prefix", maxBytes: 1024, allowEmpty: true, help: "Prepended to each migrated object key. Include a trailing slash if required." },
      ...credentials, bandwidth,
      { key: "overwrite", label: "Existing destination objects", type: "select", required: true, defaultValue: "NO_OVERWRITE", choices: [{ value: "NO_OVERWRITE", label: "Skip existing object keys" }, { value: "SIZE_LAST_MODIFIED_COMPARISON_OVERWRITE", label: "Compare size and last-modified time" }, { value: "FULL_OVERWRITE", label: "Overwrite every matching object key" }] },
      { key: "description", label: "Description", max: 255, pattern: "^[^\\^<>\"'&]*$", allowEmpty: true },
    ], impact: cost },
    { id: "inspect", label: "View task configuration and progress", kind: "inspect", description: "Inspect endpoints, prefixes, overwrite mode, migration progress, and object counts without exposing credentials.", fields: [] },
    { id: "pause", label: "Pause migration", kind: "action", description: "Request a pause for a waiting, running, or retrying task. Wait for its native stopped state before deleting it.", fields: [], confirmation: true, allowedStatuses: ["1", "2", "6"], impact: "The migration stops copying new objects after Huawei processes the pause. Objects already copied remain in the destination bucket." },
    { id: "resume", label: "Resume or retry migration", kind: "action", description: "Resume a stopped or failed standalone migration with fresh source and destination credentials.", fields: [...credentials, { key: "failedOnly", label: "Retry failed objects only", type: "boolean", defaultValue: false }], allowedStatuses: ["3", "4"], confirmation: true, impact: cost },
    { id: "bandwidth", label: "Change transfer bandwidth", kind: "update", description: "Replace this task's bandwidth schedule with one all-day limit.", fields: [bandwidth], impact: "Replacing the schedule changes the task's source and destination request/transfer rate and may change charges and completion time." },
    { id: "priority", label: "Change queued task priority", kind: "update", description: "Set the scheduling priority of a waiting, stopped, or failed migration.", fields: [{ key: "priority", label: "Priority", type: "select", required: true, choices: ["LOW", "MEDIUM", "HIGH"].map(value => ({ value, label: value })) }], allowedStatuses: ["1", "3", "4"] },
    { id: "delete", label: "Delete inactive task record", kind: "delete", description: "Remove the selected stopped, failed, or completed migration task record.", fields: [], allowedStatuses: ["3", "4", "5"], confirmation: true, impact: "The task record and its configuration are permanently removed. Previously copied destination objects remain stored." },
  ],
  inventory: async s => (await listOmsMigrationTasksForProject(s)).map(task => ({ id: task.id, name: task.name, status: task.status })),
  options: async (s, operation): Promise<Record<string, ManagementChoice[]>> => operation === "create" ? { buckets: (await buckets(s)).map(bucket => ({ value: bucket.name, label: `${bucket.name} · ${bucket.location}` })) } : {},
  execute: async (s, operation, v, resource) => {
    const write = (target: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "oms", target, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (operation === "create") {
      if (!(await buckets(s)).some(bucket => bucket.name === v.destinationBucket)) throw new ManagementInputError("Select a current OBS bucket in this region.");
      if (v.sourceCloud === "HuaweiCloud" && v.sourceRegion === s.region && v.sourceBucket === v.destinationBucket) throw new ManagementInputError("Source and destination cannot be the same OBS bucket.");
      const result = await write(base(s), "POST", { task_type: "prefix", src_node: { cloud_type: v.sourceCloud, region: v.sourceRegion, bucket: v.sourceBucket, ak: v.sourceAk, sk: v.sourceSk, ...(v.sourceToken ? { security_token: v.sourceToken } : {}), object_key: [v.sourcePrefix ?? ""] }, dst_node: { bucket: v.destinationBucket, region: s.region, ak: v.destinationAk, sk: v.destinationSk, ...(v.destinationToken ? { security_token: v.destinationToken } : {}), ...(v.destinationPrefix ? { save_prefix: v.destinationPrefix } : {}) }, description: v.description ?? "", bandwidth_policy: policy(v.bandwidth), object_overwrite_mode: v.overwrite, enable_metadata_migration: false, enable_restore: false, enable_failed_object_recording: true, enable_requester_pays: false, dst_storage_policy: "STANDARD", consistency_check: "size_last_modified" });
      if (!Number.isSafeInteger(result.id) || Number(result.id) < 0) throw new Error("Huawei returned no migration task ID. Check tasks before creating another migration.");
      return { message: "Migration task accepted and automatically started. Check progress and failed-object counts.", resourceId: String(result.id), jobId: String(result.id), asynchronous: true };
    }
    if (!resource) throw new ManagementInputError("Select a current migration task."); const current = await task(s, resource); const target = `${base(s)}/${resource.id}`;
    if (operation === "inspect") {
      const src = asRecord(current.src_node); const dst = asRecord(current.dst_node);
      return { message: "Current migration configuration and progress.", facts: [{ label: "Source", value: `${src.cloud_type} · ${src.region} · ${src.bucket} · ${asArray(src.object_key).join(", ")}` }, { label: "Destination", value: `${dst.region} · ${dst.bucket} · ${asString(dst.save_prefix, "")}` }, ...["status", "progress", "total_num", "successful_num", "failed_num", "skipped_num", "total_size", "complete_size", "object_overwrite_mode", "consistency_check", "task_priority"].map(key => ({ label: key.replaceAll("_", " "), value: typeof current[key] === "string" || typeof current[key] === "number" ? String(current[key]) : "-" }))] };
    }
    if (operation === "pause") {
      if (![1, 2, 6].includes(Number(current.status))) throw new ManagementInputError("Only waiting, running, or retrying tasks can be paused.");
      await write(`${target}/stop`, "POST"); return { message: "Migration pause requested. Check task state before further actions.", jobId: resource.id, asynchronous: true };
    }
    if (operation === "resume") {
      supported(current); if (![3, 4].includes(Number(current.status))) throw new ManagementInputError("Only stopped or failed tasks can be resumed.");
      if (v.failedOnly === true && !(Number(current.failed_num) > 0)) throw new ManagementInputError("This task has no verified failed objects to retry. Resume the full migration instead.");
      await write(`${target}/start`, "POST", { src_ak: v.sourceAk, src_sk: v.sourceSk, ...(v.sourceToken ? { src_security_token: v.sourceToken } : {}), dst_ak: v.destinationAk, dst_sk: v.destinationSk, ...(v.destinationToken ? { dst_security_token: v.destinationToken } : {}), migrate_failed_object: v.failedOnly === true });
      return { message: "Migration restart accepted. Check progress and failed-object counts.", jobId: resource.id, asynchronous: true };
    }
    if (operation === "delete") {
      if (![3, 4, 5].includes(Number(current.status))) throw new ManagementInputError("Wait for a stopped, failed, or completed state before deleting this task.");
      await write(target, "DELETE"); return { message: "Migration task record deleted. Previously migrated objects remain in OBS." };
    }
    if (operation === "bandwidth" || operation === "priority") {
      if (operation === "priority" && ![1, 3, 4].includes(Number(current.status))) throw new ManagementInputError("Priority can be changed only for waiting, stopped, or failed tasks.");
      await write(`${base(s)}/batch-update`, "POST", { ids: [Number(resource.id)], ...(operation === "bandwidth" ? { bandwidth_policy: policy(v.bandwidth) } : { task_priority: v.priority }) }); return { message: operation === "bandwidth" ? "Migration bandwidth schedule updated." : "Migration priority updated." };
    }
    throw new ManagementInputError("Unsupported OMS operation.");
  },
  poll: async (s, entry) => {
    if (!entry.resourceId || entry.jobId !== entry.resourceId) throw new ManagementInputError("This request has no verified migration task to check.");
    const current = await task(s, { id: entry.resourceId, name: entry.resourceName ?? entry.resourceId });
    if (entry.operation === "Pause migration" && Number(current.status) === 3) return { state: "succeeded", message: "Migration paused. Objects already copied remain in the destination bucket." };
    if (Number(current.status) === 5) return { state: "succeeded", message: `Migration completed: ${current.successful_num ?? "-"} copied, ${current.skipped_num ?? "-"} skipped, ${current.failed_num ?? "-"} failed objects.` };
    if ([3, 4].includes(Number(current.status))) return { state: "failed", message: Number(current.status) === 3 ? "Migration stopped before completion." : "Migration failed. Inspect its task state and failed-object counts before retrying." };
    return { state: "submitted", message: `Migration status ${current.status}; progress ${current.progress ?? "-"}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listOmsMigrationTasks, cloudCacheKeys.listObsBuckets],
};
