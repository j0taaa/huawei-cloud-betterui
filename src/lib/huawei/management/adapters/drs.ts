import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { HuaweiApiError, huaweiFetch as nativeFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import type { ManagementAdapter } from "../types";

// Verified against the cached official DRS v5 SDK: job list/detail/actions, single-job action (start, stop/pause,
// restart/retry, precheck), end-task stop, delete, and name/description/expired-days updates. Deliberate gaps that
// still require live per-engine verification: job and batch-async creation (per-engine source/target schemas,
// passwords, flavors/offerings), backup migrations, replication (dual-active) jobs, compare and health-check tasks,
// data processing rules, column mapping, speed limits, user migration settings, parameter and driver management,
// tags, templates, EIP binding, and period-billing conversion (a purchase; never auto-billed here). Child tasks of
// multi-task jobs are read-only in this draft.

async function huaweiFetch<T>(session: BetterUiSession, service: "drs", path: string, init?: RequestInit): Promise<T> {
  try {
    const body = await nativeFetch<T>(session, service, path, init), row = asRecord(body);
    if (row.error_code !== undefined && String(row.error_code) !== "0") throw new HuaweiApiError("Huawei rejected this DRS request.", 502);
    return body;
  } catch (error) { if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected this DRS request.", error.status); throw new Error("Huawei returned an unverifiable DRS response. Check native state before retrying."); }
}
async function huaweiList<T>(session: BetterUiSession, service: "drs", path: string, pagination: Pagination): Promise<T> {
  return collectList(cursor => { const url = new URL(path, "https://local.invalid"); if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor)); return huaweiFetch<T>(session, service, url.pathname + url.search); }, pagination);
}
function assertOwner(job: Record<string, unknown>, session: BetterUiSession) {
  if (job.project_id !== undefined && job.project_id !== session.projectId) throw new ManagementInputError("The native DRS job belongs to a different project.", 409);
}

const failedStatuses = ["CREATE_FAILED", "START_JOB_FAILED", "FULL_TRANSFER_FAILED", "INCRE_TRANSFER_FAILED", "RELEASE_RESOURCE_FAILED", "CHANGE_JOB_FAILED", "CHILD_TRANSFER_FAILED"];
const runningStatuses = ["FULL_TRANSFER_STARTED", "FULL_TRANSFER_COMPLETE", "INCRE_TRANSFER_STARTED"];
const jobName: ManagementField = { key: "name", label: "Job name", required: true, min: 4, max: 50, pattern: "^[A-Za-z0-9_-]{4,50}$", help: "4-50 letters, digits, underscores, or hyphens." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 256, allowEmpty: true };

const operations: ManagementOperation[] = [
  { id: "inspect", label: "Inspect job", kind: "inspect", description: "Show the job's current configuration, endpoint identities, and status.", fields: [] },
  { id: "precheck", label: "Run pre-check", kind: "action", description: "Run the native pre-check that validates connectivity, account permissions, and objects on both databases.", fields: [{ key: "precheckMode", label: "Pre-check purpose", type: "select", required: true, defaultValue: "forStartJob", choices: [{ value: "forStartJob", label: "Before starting" }, { value: "forRetryJob", label: "Before retrying" }, { value: "forResetJob", label: "Before resetting" }] }] },
  { id: "start", label: "Start job", kind: "action", description: "Start the configured migration or synchronization job.", fields: [], confirmation: true, impact: "Starting begins the full and incremental data transfer. The task becomes billed while it runs, and the source database serves the read load of the initial copy." },
  { id: "pause", label: "Pause job", kind: "action", description: "Pause a running job without ending it.", fields: [], confirmation: true, impact: "Data transfer stops and the target database stays at its current, possibly partial state. The task keeps its configuration and resources; billing can continue until the task is ended." },
  { id: "retry", label: "Retry failed job", kind: "action", description: "Retry the failed phase of a job from its last consistent position.", fields: [], confirmation: true, impact: "DRS retries the failed phase according to the task configuration. Source read load and target writes resume; inspect progress and consistency before relying on the target." },
  { id: "terminate", label: "End task", kind: "action", description: "End the task and release its migration resources.", fields: [{ key: "force", label: "Force end immediately", type: "boolean", defaultValue: false, help: "Forced ending interrupts the task immediately and can leave the target database at a partial state." }], confirmation: true, impact: "Replication stops and the task's resources are released; billing stops once the release completes. Incremental changes not yet applied to the target are discarded." },
  { id: "delete", label: "Delete job", kind: "delete", description: "Permanently remove the task record and its configuration.", fields: [], impact: "The task record, configuration, and monitoring history are permanently removed. The source and target databases themselves are not deleted." },
  { id: "rename", label: "Rename job", kind: "update", description: "Change the task name.", fields: [jobName] },
  { id: "describe", label: "Update description", kind: "update", description: "Replace the task description.", fields: [descriptionField] },
  { id: "auto-finish", label: "Set abnormal auto-end window", kind: "update", description: "Set how many days an abnormal task may remain failed before DRS ends it automatically.", fields: [{ key: "days", label: "Auto-end window (days)", type: "number", required: true, min: 1, max: 9999, defaultValue: 14 }] },
];

const actionNames = { precheck: "precheck", start: "start", pause: "stop", retry: "restart" } as const;
const actionCommands = { precheck: "PRE_CHECK", start: "START", pause: "PAUSE", retry: "RETRY" } as const;
const updateTypes = { rename: "name", describe: "description", "auto-finish": "expired_days" } as const;

function base(session: BetterUiSession) {
  return `/v5/${session.projectId}`;
}

async function findJob(session: BetterUiSession, jobId: string) {
  let body: Record<string, unknown>;
  try {
    body = await huaweiFetch<Record<string, unknown>>(session, "drs", `${base(session)}/jobs/${encodeURIComponent(jobId)}?type=detail`);
  } catch (error) {
    if (error instanceof HuaweiApiError && error.status === 404) return null;
    throw error;
  }
  const job = asRecord(body.job);
  if (firstString([job.id], "") !== jobId) throw new ManagementInputError("The job's cloud identity could not be verified for this operation.", 409);
  assertOwner(job, session);
  return job;
}

async function requireJob(session: BetterUiSession, jobId: string) {
  const job = await findJob(session, jobId);
  if (!job) throw new ManagementInputError("The job no longer exists in the selected project.", 404);
  if (firstString([job.id], "") !== jobId) throw new ManagementInputError("The job's cloud identity could not be verified for this operation.", 409);
  return job;
}

function assertIndependent(job: Record<string, unknown>) {
  const master = firstString([job.master_job_id], "");
  if (master && master !== firstString([job.id], "")) throw new ManagementInputError("This task is a child of a multi-task job; perform this operation on its parent task instead.", 409);
}

async function availableActions(session: BetterUiSession, jobId: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "drs", `${base(session)}/jobs/${encodeURIComponent(jobId)}/actions`);
  const action = asRecord(body.job_action);
  if (!Array.isArray(action.available_actions) || action.available_actions.some(item => typeof item !== "string")) throw new ManagementInputError("Huawei returned an unverified DRS action catalog.", 409);
  if (action.current_action !== "") throw new ManagementInputError("The job has an active or unverified native command; wait before another change.", 409);
  return action.available_actions as string[];
}

// DRS answers 200 with an embedded error body; success is only the explicit native status, and native error text is
// never surfaced or persisted.
function requireNativeSuccess(response: unknown, label: string, jobId: string) {
  const record = asRecord(response);
  const status = record.status;
  if (status === undefined || status === null || !String(status).trim()) throw new Error(`The cloud returned an unreadable ${label} response; the request may have been accepted. Check the job's state before retrying.`);
  const errorCode = firstString([record.error_code], "");
  if (String(status) !== "success" || (errorCode && errorCode !== "0")) throw new ManagementInputError(`The cloud rejected the ${label} request. Review the job's current state and retry.`, 502);
  const id = firstString([record.id], "");
  if (id && id !== jobId) throw new Error(`The cloud's ${label} response identified a different job; the request may have been applied elsewhere. Check both jobs before retrying.`);
}

function endpointFact(label: string, endpoints: unknown) {
  const rows = asArray(endpoints).map(asRecord);
  const endpoint = rows[0] ?? {};
  const info = asRecord(endpoint.endpoint);
  const address = [firstString([endpoint.db_type], ""), [firstString([info.ip], ""), firstString([info.db_port], "")].filter(Boolean).join(":")].filter(Boolean).join(" · ");
  const instance = firstString([info.instance_name, info.instance_id], "");
  const user = firstString([info.db_user], "");
  const value = [address, instance ? `instance ${instance}` : "", user ? `user ${user}` : ""].filter(Boolean).join(" · ");
  return { label: rows.length > 1 ? `${label} (${rows.length} endpoints, first shown)` : label, value: value || "No endpoint details reported" };
}

function inspectFacts(job: Record<string, unknown>) {
  const baseInfo = asRecord(job.base_info);
  const progress = asRecord(job.progress_info);
  const precheck = asRecord(job.precheck_result);
  const facts = [
    { label: "Status", value: firstString([job.status]) },
    { label: "Engine · task type · direction", value: [firstString([baseInfo.engine_type]), firstString([baseInfo.task_type]), firstString([baseInfo.job_direction])].filter((part) => part !== "-").join(" · ") || "-" },
    { label: "Network · charging mode", value: [firstString([baseInfo.net_type]), firstString([baseInfo.charging_mode])].filter((part) => part !== "-").join(" · ") || "-" },
    { label: "Created", value: firstString([job.create_time]) },
    { label: "Description", value: firstString([baseInfo.description], "No description set") },
    endpointFact("Source database", job.source_endpoint),
    endpointFact("Target database", job.target_endpoint),
  ];
  const transfer = [firstString([progress.transfer_status], ""), firstString([progress.progress], "") ? `${firstString([progress.progress], "")} complete` : "", firstString([progress.incr_trans_delay], "") ? `${firstString([progress.incr_trans_delay], "")} incremental delay` : "", firstString([progress.remaining_time], "")].filter(Boolean).join(" · ");
  if (transfer) facts.push({ label: "Transfer progress", value: transfer });
  const check = [firstString([precheck.process], "") ? `process ${firstString([precheck.process], "")}` : "", firstString([precheck.total_passed_rate], "") ? `${firstString([precheck.total_passed_rate], "")} passed rate` : "", precheck.result === true ? "all checks passed" : precheck.result === false ? "checks did not pass" : ""].filter(Boolean).join(" · ");
  if (check) facts.push({ label: "Pre-check", value: check });
  for (const row of asArray(job.network_results).map(asRecord).slice(0, 10)) facts.push({ label: `Connectivity ${firstString([row.ip])}`, value: `${firstString([row.status])} · ${row.success === true ? "reachable" : row.success === false ? "unreachable" : "unknown"}` });
  return facts;
}

export const drsManagement: ManagementAdapter = {
  title: "Data Replication Service",
  operations,
  inventory: async (session) => {
    const body = await huaweiList<Record<string, unknown>>(session, "drs", `/v5/${session.projectId}/jobs?limit=100`, { items: ["jobs"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
    if (!Array.isArray(body.jobs)) throw new ManagementInputError("Huawei returned an incomplete DRS job inventory.", 409);
    const rows = body.jobs.map(asRecord);
    const seen = new Set<string>();
    return rows.flatMap((row) => {
      const id = firstString([row.id], "");
      if (!id) throw new Error("The DRS job inventory returned a row without a usable identity; refusing to list an untrustworthy inventory.");
      if (seen.has(id)) throw new Error(`The DRS job inventory returned the job ${id} twice; refusing to list an untrustworthy inventory.`);
      seen.add(id);
      assertOwner(row, session);
      const name = firstString([row.name, row.id], "");
      const actions = asArray(asRecord(row.job_action).available_actions).map(String);
      return [{
        id, name, status: firstString([row.status], "UNKNOWN"),
        values: {
          name, engine: firstString([row.engine_type]), jobType: firstString([row.job_type]), taskType: firstString([row.task_type]),
          direction: firstString([row.job_direction]), netType: firstString([row.net_type]), chargingMode: firstString([row.charging_mode]),
          billingTag: row.billing_tag === true, createTime: firstString([row.create_time]), description: firstString([row.description], ""),
          enterpriseProjectId: firstString([row.enterprise_project_id], ""), availableActions: actions.join(","), childCount: asArray(row.children).length,
        },
      }];
    });
  },
  poll: async (session, entry) => {
    const jobId = firstString([entry.resultResourceId, entry.resourceId], "");
    if (!["Delete job", "End task", "Start job", "Pause job", "Retry failed job", "Run pre-check"].includes(entry.operation)) throw new ManagementInputError("This DRS operation has no lifecycle observation.");
    if (entry.operation !== "Run pre-check" && entry.jobId !== jobId) throw new ManagementInputError("The history entry has a different DRS job identity.");
    if (!jobId) return { state: "failed", message: "The operation no longer references a job ID." };
    let job: Record<string, unknown> | null = null;
    try {
      job = await findJob(session, jobId);
    } catch (error) {
      if (!(error instanceof HuaweiApiError) || error.status !== 404) throw error;
    }
    if (job && firstString([job.id], "") !== jobId) throw new ManagementInputError("The job's cloud identity no longer matches this operation.", 409);
    const observedStatus = job ? firstString([job.status], "UNKNOWN") : "";
    const status = [...failedStatuses, ...runningStatuses, "CREATING", "CONFIGURATION", "STARTJOBING", "WAITING_FOR_START", "PAUSING", "RELEASE_RESOURCE_STARTED", "RELEASE_RESOURCE_COMPLETE", "REBUILD_NODE_STARTED", "CHANGE_JOB_STARTED", "DELETED"].includes(observedStatus) ? observedStatus : "an unverified state";
    if (entry.operation === "Delete job") return job ? { state: "submitted", message: `The deletion is still being processed; the job is currently ${status}.` } : { state: "succeeded", message: "The job was deleted.", resourceId: entry.resourceId };
    if (!job) return { state: "failed", message: "The job no longer exists in the selected project." };
    if (entry.operation === "End task") {
      if (status === "RELEASE_RESOURCE_COMPLETE") return { state: "succeeded", message: "The task ended and its resources were released." };
      if (status === "RELEASE_RESOURCE_FAILED") return { state: "failed", message: "The cloud failed to release the task's resources. Review the job and retry." };
      return { state: "submitted", message: `The task is still releasing its resources; the job is currently ${status}.` };
    }
    if (entry.operation === "Start job") {
      if (runningStatuses.includes(status)) return { state: "succeeded", message: `The job started; it is currently ${status}.` };
      if (failedStatuses.includes(status)) return { state: "failed", message: `The start request failed; the job is ${status}.` };
      return { state: "submitted", message: `The start request is still being processed; the job is currently ${status}.` };
    }
    if (entry.operation === "Pause job") {
      if (status === "PAUSING") return { state: "succeeded", message: "The original job is in the native paused state." };
      if (failedStatuses.includes(status)) return { state: "failed", message: `The pause request failed; the job is ${status}.` };
      return { state: "submitted", message: `The pause request is still being processed; the job is currently ${status}.` };
    }
    if (entry.operation === "Retry failed job") {
      if (runningStatuses.includes(status)) return { state: "succeeded", message: `The job resumed; it is currently ${status}.` };
      return { state: "submitted", message: `The retry request is still being processed; the job is currently ${status}.` };
    }
    if (entry.operation === "Run pre-check") {
      if (!entry.jobId || entry.jobId === jobId) throw new ManagementInputError("This pre-check has no original native query ID.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "drs", `${base(session)}/jobs/${encodeURIComponent(jobId)}?${new URLSearchParams({ type: "precheck", query_id: entry.jobId })}`);
      const observed = asRecord(response.job);
      if (observed.id !== undefined && observed.id !== jobId) throw new ManagementInputError("The pre-check response has a different job identity.");
      assertOwner(observed, session);
      const precheck = asRecord(observed.precheck_result);
      const process = firstString([precheck.process], "");
      if (process === "100%") {
        const rate = firstString([precheck.total_passed_rate], "-");
        const verdict = precheck.result === true ? "all checks passed" : precheck.result === false ? "the check set did not pass" : "no verdict reported";
        if (typeof precheck.result !== "boolean") return { state: "submitted", message: "The original pre-check has no verified verdict yet." };
        return { state: precheck.result ? "succeeded" : "failed", message: `The original pre-check finished: ${rate} passed rate, ${verdict}.` };
      }
      return { state: "submitted", message: `The pre-check is still running (${process || "no progress reported yet"}); the job is currently ${status}.` };
    }
    return { state: "submitted", message: `The operation is still being processed; the job is currently ${status}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listDrsJobs, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    if (operation === "inspect") {
      const job = await requireJob(session, resource!.id);
      return { message: `Job ${firstString([asRecord(job.base_info).name], resource!.name)} loaded.`, facts: inspectFacts(job) };
    }
    if (operation in actionNames) {
      const name = operation as keyof typeof actionNames;
      const job = await requireJob(session, resource!.id);
      assertIndependent(job);
      const actions = await availableActions(session, resource!.id);
      if (!actions.includes(actionCommands[name])) throw new ManagementInputError(`The cloud does not currently offer this action for this job (native command ${actionCommands[name]} is unavailable).`, 409);
      const actionParams: Record<string, unknown> = {};
      if (name === "precheck") {
        if (!["forStartJob", "forRetryJob", "forResetJob"].includes(String(values.precheckMode))) throw new ManagementInputError("Select the pre-check purpose.");
        actionParams.precheck_mode = values.precheckMode;
      }
      const response = await huaweiFetch<Record<string, unknown>>(session, "drs", `${base(session)}/jobs/${encodeURIComponent(resource!.id)}/action`, { method: "POST", body: JSON.stringify({ job: { job_id: resource!.id, action_name: actionNames[name], ...(Object.keys(actionParams).length ? { action_params: actionParams } : {}) } }) });
      if (response.status !== undefined) requireNativeSuccess(response, "action", resource!.id);
      if (response.id !== undefined && response.id !== resource!.id) throw new Error("Huawei returned an acknowledgement for a different DRS job. Check native state before retrying.");
      const queryId = firstString([response.query_id], "");
      if (name !== "precheck" && response.status === "success") return { message: "Huawei accepted the lifecycle request; observe the original job state to verify its transition.", resourceId: resource!.id, jobId: resource!.id, asynchronous: true };
      if (!queryId) throw new Error("The cloud accepted the request without an action query ID, so it could not be confirmed. Check the job's state before retrying.");
      return { message: "Huawei accepted the request. The original job or pre-check query is being observed until its result is verified.", resourceId: resource!.id, jobId: name === "precheck" ? queryId : resource!.id, asynchronous: true };
    }
    if (operation === "terminate") {
      const job = await requireJob(session, resource!.id);
      assertIndependent(job);
      const actions = await availableActions(session, resource!.id);
      if (!actions.includes("FREE_RESOURCE")) throw new ManagementInputError("The cloud does not currently allow ending this task.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "drs", `${base(session)}/jobs/${encodeURIComponent(resource!.id)}/stop`, { method: "POST", body: JSON.stringify({ is_force_stop: values.force === true }) });
      requireNativeSuccess(response, "end-task", resource!.id);
      return { message: "The end-task request succeeded. The task is releasing its resources; billing stops once the release completes.", resourceId: resource!.id, jobId: resource!.id, asynchronous: true };
    }
    if (operation === "delete") {
      const job = await requireJob(session, resource!.id);
      assertIndependent(job);
      if (firstString([asRecord(job.base_info).name], "") !== resource!.name) throw new ManagementInputError("The job name changed. Refresh before confirming deletion.", 409);
      const actions = await availableActions(session, resource!.id);
      if (!actions.includes("DELETE")) throw new ManagementInputError("The cloud does not currently allow deleting this job. End the task first if it is still running.", 409);
      await huaweiFetch<Record<string, unknown>>(session, "drs", `${base(session)}/jobs/${encodeURIComponent(resource!.id)}`, { method: "DELETE" });
      const after = await findJob(session, resource!.id);
      if (!after) return { message: "The job was deleted.", resourceId: resource!.id };
      return { message: "The deletion request was accepted. The original job still exists and is being observed until it is removed.", resourceId: resource!.id, jobId: resource!.id, asynchronous: true };
    }
    if (operation in updateTypes) {
      const name = operation as keyof typeof updateTypes;
      const job = await requireJob(session, resource!.id);
      assertIndependent(job);
      await availableActions(session, resource!.id);
      if (name === "auto-finish" && (!Number.isSafeInteger(values.days) || Number(values.days) < 1 || Number(values.days) > 9999)) throw new ManagementInputError("Select an auto-end window from 1 to 9999 days.");
      const baseInfo = name === "rename" ? { name: String(values.name) } : name === "describe" ? { description: String(values.description ?? "") } : { expired_days: String(values.days) };
      const response = await huaweiFetch<Record<string, unknown>>(session, "drs", `${base(session)}/jobs/${encodeURIComponent(resource!.id)}`, { method: "PUT", body: JSON.stringify({ type: updateTypes[name], params: { job_id: resource!.id, base_info: baseInfo } }) });
      requireNativeSuccess(response, "update", resource!.id);
      return { message: name === "rename" ? "Job rename accepted; inspect its configuration to verify." : name === "describe" ? "Description update accepted; inspect its configuration to verify." : "Auto-end window update accepted; inspect its configuration to verify.", resourceId: resource!.id };
    }
    throw new ManagementInputError("Unsupported DRS operation.");
  },
};
