import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { listDliQueuesForProject } from "@/lib/huawei/services/dli";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

// Verified against DLI SDK v1 and current Queue/SQL APIs. Queue names are case-insensitive.
const base = (s: BetterUiSession) => `/v1.0/${s.projectId}`;
const queuePath = (s: BetterUiSession, r: ManagementResource) => `${base(s)}/queues/${encodeURIComponent(r.id)}`;
const namePattern = "^(?!_)(?![0-9]+$)[A-Za-z0-9_]{1,128}$";
const jobField: ManagementField = { key: "job", label: "SQL job", type: "select", required: true, source: "jobs" };
const protectedQueue = ["default"];
const choice = (value: string, label = value): ManagementChoice => ({ value, label });
function accepted(body: Record<string, unknown>) {
  if (body.is_success === false || body.result === false) throw new ManagementInputError("Huawei rejected this DLI operation. Check the queue state and permissions before retrying.", 409);
  if (body.is_success !== true && body.result !== true) throw new Error("Huawei returned no DLI operation confirmation. Check cloud state before retrying.");
  return body;
}
async function detail(s: BetterUiSession, resource: ManagementResource) {
  const body = accepted(await huaweiFetch<Record<string, unknown>>(s, "dli", queuePath(s, resource)));
  if (asString(body.queueName, "").toLowerCase() !== resource.id.toLowerCase()) throw new ManagementInputError("The queue could not be verified in this project.", 404);
  return body;
}
async function jobs(s: BetterUiSession, resource: ManagementResource) {
  const query = new URLSearchParams({ queue_name: resource.id, "page-size": "100", "current-page": "1", "job-type": "ALL" });
  const body = await huaweiList<Record<string, unknown>>(s, "dli", `${base(s)}/jobs?${query}`, { items: ["jobs"], kind: "page", parameter: "current-page", first: 1, size: 100, total: ["job_count"] });
  accepted(body);
  return asArray(body.jobs).map(asRecord).filter(j => j.queue_name === resource.id && asString(j.job_id, ""));
}
async function jobStatus(s: BetterUiSession, resource: ManagementResource, id: string) {
  const job = accepted(await huaweiFetch<Record<string, unknown>>(s, "dli", `${base(s)}/jobs/${encodeURIComponent(id)}/status`));
  if (job.job_id !== id || job.queue_name !== resource.id) throw new ManagementInputError("The SQL job no longer belongs to this queue.", 404);
  return job;
}
async function selectedJob(s: BetterUiSession, resource: ManagementResource, id: string) {
  if (!(await jobs(s, resource)).some(j => j.job_id === id)) throw new ManagementInputError("Select a current SQL job in this queue.", 404);
  return jobStatus(s, resource, id);
}
const activeJob = (j: Record<string, unknown>) => ["LAUNCHING", "RUNNING"].includes(String(j.status).toUpperCase());
const readOnlyFacts = (data: Record<string, unknown>, keys: string[]) => keys.map(key => ({ label: key.replaceAll("_", " "), value: typeof data[key] === "number" || typeof data[key] === "boolean" ? String(data[key]) : asString(data[key], "-") }));

export const dliManagement: ManagementAdapter = {
  title: "DLI Queues and SQL Jobs",
  operations: [
    { id: "create", label: "Create queue", description: "Create a standalone queue billed by compute-unit hours. Dedicated and shared resources support SQL or general Flink/Spark workloads. Regional support and quotas are checked by Huawei.", kind: "create", fields: [
      { key: "name", label: "Queue name", required: true, max: 128, pattern: namePattern, help: "Letters, digits, and underscores; not entirely numeric or starting with an underscore. Stored in lowercase." },
      { key: "description", label: "Description", type: "textarea", max: 1024 },
      { key: "type", label: "Queue type", type: "select", required: true, choices: [choice("sql", "SQL"), choice("general", "General (Flink and Spark)")], defaultValue: "sql" },
      { key: "cu", label: "Compute units", type: "select", required: true, choices: [16, 64, 256].map(v => choice(String(v))), defaultValue: "16" },
      { key: "dedicated", label: "Dedicated resources", type: "boolean", defaultValue: true },
      { key: "enterpriseProjectId", label: "Enterprise project ID", defaultValue: "0", max: 64 },
    ], impact: "This queue incurs compute-unit-hour charges while resources are allocated. Confirm its size, resource mode, and region." },
    { id: "inspect", label: "View queue configuration", description: "Inspect current compute capacity, billing, resource-pool association, supported engines, and versions.", kind: "inspect", fields: [] },
    { id: "restart", label: "Restart SQL queue", description: "Restart an available SQL queue without forcibly terminating active work.", kind: "action", fields: [], excludedResourceIds: protectedQueue, confirmation: true, impact: "The queue is temporarily unavailable. Active SQL jobs must finish or be cancelled first." },
    { id: "scale-out", label: "Expand queue", description: "Set a larger total CU capacity for a standalone pay-per-use queue. Queues within elastic resource pools use scaling policies instead.", kind: "action", excludedResourceIds: protectedQueue, fields: [{ key: "cu", label: "New total compute units", type: "number", required: true, min: 16, max: 4096, help: "A multiple of 16, larger than the current capacity. Region-specific quotas are enforced by Huawei." }], impact: "The new compute capacity increases queue charges." },
    { id: "scale-in", label: "Reduce queue capacity", description: "Set a smaller total CU capacity after active SQL jobs finish. Queues within elastic resource pools use scaling policies instead.", kind: "action", excludedResourceIds: protectedQueue, fields: [{ key: "cu", label: "New total compute units", type: "number", required: true, min: 16, max: 4096 }], confirmation: true, impact: "Reducing capacity can decrease throughput. Active SQL jobs must finish or be cancelled first." },
    { id: "delete", label: "Delete unused SQL queue", description: "Delete a standalone SQL queue only after active SQL jobs finish. Default queues and elastic-resource-pool queues are protected.", kind: "delete", fields: [], excludedResourceIds: protectedQueue, confirmation: true, impact: "This queue's compute resources are released. Subsequent jobs cannot use the queue. Stored data in OBS remains." },
    { id: "properties", label: "View queue properties", description: "Inspect the current engine and concurrency settings.", kind: "inspect", fields: [] },
    { id: "configure-concurrency", label: "Configure SQL concurrency", description: "Set maximum Spark drivers, jobs per driver, and prefetched drivers, preserving other queue properties.", kind: "update", excludedResourceIds: protectedQueue, fields: [
      { key: "drivers", label: "Maximum Spark drivers", type: "number", required: true, min: 1, max: 1000 },
      { key: "jobsPerDriver", label: "Maximum jobs per driver", type: "number", required: true, min: 1, max: 1000 },
      { key: "prefetch", label: "Prefetched Spark drivers", type: "number", required: true, min: 0, max: 1000 },
    ], impact: "Concurrency changes can alter resource usage, job throughput, and costs. Huawei enforces the queue's supported limits." },
    { id: "jobs", label: "View SQL jobs", description: "List current and historical SQL jobs belonging to this queue.", kind: "inspect", fields: [] },
    { id: "submit-sql", label: "Submit SQL job", description: "Run SQL in the selected SQL queue using its current engine. SQL can query data, create schemas, or modify data according to your permissions.", kind: "action", fields: [
      { key: "sql", label: "SQL statement", type: "textarea", required: true, max: 65536, maxBytes: 65536 },
      { key: "database", label: "Database", max: 128, pattern: namePattern, help: "Optional default database; omit when creating a database." },
      { key: "catalog", label: "Catalog", max: 128, pattern: namePattern },
    ], confirmation: true, impact: "Executing SQL incurs compute/data-scan charges and may modify or permanently delete data. Review the statement before submitting." },
    { id: "job-status", label: "View SQL job status", description: "Inspect this queue's selected job and its execution statistics.", kind: "inspect", fields: [jobField] },
    { id: "cancel-job", label: "Cancel SQL job", description: "Cancel a launching or running SQL job owned by this queue.", kind: "action", fields: [jobField], confirmation: true, impact: "The selected SQL job stops. Work already performed may still be billed or committed." },
    { id: "preview-results", label: "Preview SQL query results", description: "Read the first 100 result rows of a completed QUERY job. Previewing results can incur additional compute charges.", kind: "inspect", fields: [jobField], impact: "Reading result previews can incur additional compute or data-scan charges." },
  ],
  inventory: async s => (await listDliQueuesForProject(s)).map(q => ({ id: q.name.toLowerCase(), name: q.name, status: q.status, values: { description: q.description, cu: q.cuCount, queueType: q.type, engine: q.engine } })),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (!resource) return {};
    if (["job-status", "cancel-job", "preview-results"].includes(operation)) return { jobs: (await jobs(s, resource)).filter(j => operation === "cancel-job" ? activeJob(j) : operation === "preview-results" ? j.status === "FINISH" && j.job_type === "QUERY" : true).map(j => choice(asString(j.job_id), `${j.job_type} · ${j.status} · ${j.job_id}`)) };
    if (operation === "configure-concurrency") {
      const body = accepted(await huaweiFetch<Record<string, unknown>>(s, "dli", `/v3/${s.projectId}/queues/${encodeURIComponent(resource.id)}/properties`));
      const entries = asArray(body.properties).map(asRecord);
      const get = (key: string) => { const raw = entries.find(p => p.key === key || key === "computeEngine.maxInstance" && p.key === "computeEngine.maxInstances")?.value; return raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : ""; };
      resource.values = { ...resource.values, drivers: get("computeEngine.maxInstance"), jobsPerDriver: get("job.maxConcurrent"), prefetch: get("computeEngine.maxPrefetchInstance") };
    }
    return {};
  },
  poll: async (s, entry) => {
    if (!entry.resourceId || !entry.jobId) throw new ManagementInputError("This operation has no DLI job to track.");
    const status = await jobStatus(s, { id: entry.resourceId, name: entry.resourceName ?? entry.resourceId }, entry.jobId);
    const state = String(status.status).toUpperCase();
    return state === "FINISH" ? { state: "succeeded", message: "The DLI cloud job completed." } : ["FAILED", "CANCELLED"].includes(state) ? { state: "failed", message: `The DLI cloud job ${state.toLowerCase()}. Inspect the job for details before retrying.` } : { state: "submitted", message: `The DLI cloud job is ${state.toLowerCase()}.` };
  },
  execute: async (s, operation, v, resource) => {
    const write = async (path: string, method: string, body?: unknown) => accepted(await huaweiFetch<Record<string, unknown>>(s, "dli", path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    if (operation === "create") {
      const name = String(v.name).toLowerCase();
      if ((await listDliQueuesForProject(s)).some(q => q.name.toLowerCase() === name)) throw new ManagementInputError("A queue with this name already exists.", 409);
      const r = await write(`${base(s)}/queues`, "POST", { queue_name: name, queue_type: v.type, description: v.description ?? "", cu_count: Number(v.cu), charging_mode: 1, resource_mode: v.dedicated === true ? 1 : 0, platform: "x86_64", feature: "basic", enterprise_project_id: v.enterpriseProjectId ?? "0" });
      return { message: "Queue creation accepted. Check its status before submitting jobs.", resourceId: asString(r.queue_name, name), asynchronous: true };
    }
    if (!resource) throw new ManagementInputError("Select a current queue.");
    const queue = await detail(s, resource); const path = queuePath(s, resource);
    if (operation === "inspect") return { message: "Current queue configuration.", facts: readOnlyFacts(queue, ["queueName", "queueType", "cuCount", "chargingMode", "resource_mode", "resource_type", "elastic_resource_pool_name", "default_spark_version", "default_hetu_engine_version", "default_flink_sql_version", "default_flink_jar_version"]) };
    if (["restart", "delete", "scale-in", "scale-out", "configure-concurrency"].includes(operation)) {
      if (resource.id === "default" || queue.chargingMode !== 1) throw new ManagementInputError("Only non-default pay-per-use queues support this workflow.");
      if (queue.elastic_resource_pool_name) throw new ManagementInputError("This queue belongs to an elastic resource pool. Manage the pool's scaling policies and association separately.");
      if (["restart", "delete", "scale-in", "configure-concurrency"].includes(operation) && queue.queueType !== "sql") throw new ManagementInputError("This workflow supports SQL queues only. General queues require Flink/Spark lifecycle checks.");
      if (["restart", "delete", "scale-in"].includes(operation) && (await jobs(s, resource)).some(activeJob)) throw new ManagementInputError("Wait for active SQL jobs to finish or cancel them first.");
    }
    if (operation === "delete") { await write(path, "DELETE"); return { message: "Unused SQL queue deleted." }; }
    if (operation === "restart") { const r = await write(`${path}/action`, "PUT", { action: "restart", force: false }); return { message: r.job_id ? "SQL queue restart submitted." : "SQL queue restarted.", jobId: asString(r.job_id, "") || undefined, asynchronous: !!r.job_id }; }
    if (["scale-out", "scale-in"].includes(operation)) {
      const cu = Number(v.cu); const current = Number(queue.cuCount);
      if (!Number.isSafeInteger(current) || current <= 0 || cu % 16 || operation === "scale-out" && cu <= current || operation === "scale-in" && cu >= current) throw new ManagementInputError("Choose a multiple of 16 with capacity in the selected scaling direction.");
      const r = await write(`${path}/action`, "PUT", { action: operation.replace("-", "_"), cu_count: cu });
      return { message: "Queue capacity updated.", jobId: asString(r.job_id, "") || undefined, asynchronous: !!r.job_id };
    }
    if (operation === "properties") { const r = accepted(await huaweiFetch<Record<string, unknown>>(s, "dli", `/v3/${s.projectId}/queues/${encodeURIComponent(resource.id)}/properties`)); return { message: "Current queue properties.", facts: asArray(r.properties).map(asRecord).map(p => ({ label: asString(p.key), value: String(p.value ?? "-") })) }; }
    if (operation === "configure-concurrency") {
      if (Number(v.prefetch) > Number(v.drivers)) throw new ManagementInputError("Prefetched drivers cannot exceed the maximum driver count.");
      await write(`/v3/${s.projectId}/queues/${encodeURIComponent(resource.id)}/properties`, "PUT", { properties: { "computeEngine.maxInstance": v.drivers, "job.maxConcurrent": v.jobsPerDriver, "computeEngine.maxPrefetchInstance": v.prefetch } }); return { message: "SQL queue concurrency updated." };
    }
    if (operation === "jobs") return { message: "SQL jobs in this queue.", facts: (await jobs(s, resource)).map(j => ({ label: `${j.job_type} · ${j.job_id}`, value: `${j.status} · ${j.duration ?? 0} ms` })) };
    if (operation === "submit-sql") {
      if (queue.queueType !== "sql") throw new ManagementInputError("Submit SQL jobs to a SQL queue.");
      const engine = String(resource.values?.engine ?? "");
      if (!["hetuEngine", "spark"].includes(engine)) throw new ManagementInputError("The queue engine could not be verified. Refresh the queue inventory before submitting SQL.");
      const r = await write(`${base(s)}/jobs/submit-job`, "POST", { queue_name: resource.id, sql: v.sql, engine_type: engine, ...(v.database ? { currentdb: v.database } : {}), ...(v.catalog ? { current_catalog: v.catalog } : {}) });
      return { message: "SQL job submitted. Track its status before relying on the result.", jobId: asString(r.job_id, "") || undefined, asynchronous: true };
    }
    if (["job-status", "cancel-job", "preview-results"].includes(operation)) {
      const job = await selectedJob(s, resource, String(v.job));
      if (operation === "job-status") return { message: "Current SQL job status.", facts: readOnlyFacts(job, ["job_id", "job_type", "status", "owner", "start_time", "duration", "input_row_count", "input_size", "result_count", "result_path"]) };
      if (operation === "cancel-job") { if (!activeJob(job)) throw new ManagementInputError("Only launching or running jobs can be cancelled."); await write(`${base(s)}/jobs/${encodeURIComponent(String(v.job))}`, "DELETE"); return { message: "SQL job cancellation submitted.", asynchronous: true, jobId: String(v.job) }; }
      if (job.status !== "FINISH" || job.job_type !== "QUERY") throw new ManagementInputError("Only completed QUERY jobs have previewable results.");
      const r = accepted(await huaweiFetch<Record<string, unknown>>(s, "dli", `${base(s)}/jobs/${encodeURIComponent(String(v.job))}/preview?${new URLSearchParams({ "queue-name": resource.id })}`));
      if (r.job_id !== v.job) throw new ManagementInputError("The preview response did not match this job.");
      return { message: `Query result preview (up to 100 rows; ${r.row_count ?? "unknown"} total rows).`, facts: [{ label: "Columns", value: JSON.stringify(r.schema ?? []) }, ...asArray(r.rows).slice(0, 100).map((row, index) => ({ label: `Row ${index + 1}`, value: JSON.stringify(row) }))] };
    }
    throw new ManagementInputError("Unsupported DLI operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listDliQueues],
};
