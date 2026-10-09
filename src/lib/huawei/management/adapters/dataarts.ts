import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { asRecord, asString, timestampMillis } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import {
  dataArtsFetch,
  dataArtsList,
  listDataArtsInstancesForProject,
  type DataArtsInstance,
} from "@/lib/huawei/services/dataarts";
import { HuaweiApiError, huaweiFetch } from "@/lib/huawei/http";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

// Verified native DataArts Studio contracts (official huaweicloudsdkdataartsstudio v1):
//   GET  /v1/{project_id}/instances                                 ListDataArtsStudioInstances:
//       { billing_check, count, commodity_orders: ApigCommodityOrder[] }, limit/offset paging.
//       Primary: https://support.huaweicloud.com/intl/en-us/api-dataartsstudio/ListDataArtsStudioInstances.html
//   GET  /v1/{project_id}/workspaces/{instance_id}                  ListManagerWorkSpaces:
//       { count, total_page, data: Workspacebody[] }, limit/offset paging.
//   POST /v1/{project_id}/workspaces/{instance_id}                  CreateManagerWorkSpace; the
//       successful native response has is_success and a message, without a typed workspace ID, so creation is accepted
//       for manual verification instead of borrowing an ID by name.
//   POST /v1/{project_id}/{instance_id}/workspaces/batch-delete     { workspace_ids } -> { message, is_success }
//   GET  /v2/{project_id}/factory/jobs                              `workspace` header; { total, jobs: JobResultV2[] }
//   GET  /v2/{project_id}/factory/jobs/{job_name}/instances/detail  `workspace` header; { total, instances: JobInstance[] }
//   POST /v2/{project_id}/factory/jobs/{job_name}/instances/retry   `workspace` header; empty response
// The distinct business-model /v2/{project_id}/design/workspaces CreateWorkspace contract is NOT
// used here. Instance provisioning, paid orders, free grants and auto payment have no typed full
// native contract here and are explicit gaps, as are data connections, models, quality, security,
// API publishing, real-time job control and every other DataArts Studio plane. Native error
// payloads and messages never reach outcomes, and undocumented native statuses display as UNKNOWN.

const spaceKinds: Record<number, string> = { 0: "Private", 1: "Default", 2: "Public" };
// Exact native JobResultV2.status values documented for batch and real-time development jobs.
const jobStatuses = ["SCHEDULING", "STOPPED", "PAUSED", "STARTING", "NORMAL", "EXCEPTION", "STOPPING", "PAUSE", "ABNORMAL"];
// Exact native JobInstance.status values documented for job run instances.
const runStatuses = ["waiting", "running", "success", "fail", "running-exception", "pause", "manual-stop", "skip-by-depend", "freeze"];
const instanceChoice: ManagementField = { key: "instance", label: "DataArts Studio instance", type: "select", source: "instances", required: true, help: "Workspaces are created inside one current instance of this project." };
const workspaceName: ManagementField = { key: "name", label: "Workspace name", required: true, min: 1, max: 128, help: "The name must be unique within the instance." };
const workspaceDescription: ManagementField = { key: "description", label: "Description", type: "textarea", max: 512, allowEmpty: true };
const epsId: ManagementField = { key: "epsId", label: "Enterprise project", type: "select", source: "enterpriseProjects", required: true, help: "Native workspace creation requires an enterprise project. Choices list the account's active enterprise projects; without an account token, only enterprise projects already used by this project's DataArts Studio workspaces are offered. The default enterprise project appears only when the account actually has it." };
const failedInstance: ManagementField = { key: "instance", label: "Failed job instance", type: "select", source: "failedInstances", required: true };
const retryLocation: ManagementField = { key: "retryLocation", label: "Retry from", type: "select", required: true, choices: [{ value: "errorNode", label: "The failed node" }, { value: "firstNode", label: "The first node" }] };
const retryTaskVersion: ManagementField = { key: "retryTaskVersion", label: "Job version to rerun", type: "select", required: true, choices: [{ value: "original_version", label: "Original version" }, { value: "current_version", label: "Current version" }] };

type Row = Record<string, unknown>;
const fact = (label: string, value: unknown) => ({ label, value: typeof value === "string" || typeof value === "number" ? String(value) : "-" });

async function instances(s: BetterUiSession): Promise<DataArtsInstance[]> {
  return listDataArtsInstancesForProject(s);
}

// A native scope echo must be a non-empty string and match exactly; a missing, null, empty,
// malformed or foreign echo blocks the read instead of being tolerated.
function requireEcho(row: Row, key: string, expected: string, dimension: string) {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`Huawei returned a DataArts workspace without a valid native ${dimension} echo.`);
  if (value !== expected) throw new Error(`Huawei returned a DataArts workspace scoped to a different ${dimension}.`);
}

async function workspaces(s: BetterUiSession, instanceId: string): Promise<Row[]> {
  const parent = await currentInstance(s, instanceId);
  const rows = await dataArtsList(s, `/v1/${s.projectId}/workspaces/${encodeURIComponent(instanceId)}`, "data", "count", "DataArts workspace list");
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) throw new Error("Huawei returned a DataArts workspace without a valid native ID.");
    if (seen.has(row.id)) throw new Error("Huawei returned duplicate native IDs for DataArts workspaces.");
    seen.add(row.id);
    if (typeof row.name !== "string" || !row.name) throw new Error("Huawei returned a DataArts workspace without a valid name.");
    requireEcho(row, "project_id", s.projectId, "project");
    requireEcho(row, "instance_id", instanceId, "instance");
    // The domain echo cannot be cross-checked against the session, but a provided null, empty
    // or malformed value still blocks the read.
    if ("domain_id" in row && (typeof row.domain_id !== "string" || !row.domain_id || (parent.domainId !== "-" && row.domain_id !== parent.domainId))) throw new Error("Huawei returned a DataArts workspace without a matching native domain echo.");
  }
  return rows;
}

async function jobs(s: BetterUiSession, workspaceId: string): Promise<Row[]> {
  const rows = await dataArtsList(s, `/v2/${s.projectId}/factory/jobs`, "jobs", "total", "DataArts job list", { headers: { workspace: workspaceId } });
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row.name !== "string" || !row.name) throw new Error("Huawei returned a DataArts job without a valid native name.");
    if (seen.has(row.name)) throw new Error("Huawei returned duplicate native names for DataArts jobs.");
    seen.add(row.name);
  }
  return rows;
}

async function jobInstances(s: BetterUiSession, workspaceId: string, jobName: string): Promise<Row[]> {
  const rows = await dataArtsList(s, `/v2/${s.projectId}/factory/jobs/${encodeURIComponent(jobName)}/instances/detail`, "instances", "total", "DataArts job instance list", { headers: { workspace: workspaceId } });
  const seen = new Set<number>();
  for (const row of rows) {
    if (typeof row.instance_id !== "number" || !Number.isSafeInteger(row.instance_id)) throw new Error("Huawei returned a DataArts job instance without a valid native ID.");
    if ("job_name" in row && row.job_name !== jobName) throw new Error("Huawei returned a DataArts run from a different job.");
    if (seen.has(row.instance_id)) throw new Error("Huawei returned duplicate native IDs for DataArts job instances.");
    seen.add(row.instance_id);
  }
  return rows;
}

function instanceIdOf(resource: ManagementResource | undefined) {
  const id = resource?.id ?? "";
  const instanceId = id.startsWith("instance:") ? id.slice("instance:".length) : "";
  if (!instanceId || instanceId.includes(":")) throw new ManagementInputError("Select a DataArts Studio instance.");
  return instanceId;
}

function workspaceIdsOf(id: string | undefined) {
  const parts = typeof id === "string" && id.startsWith("workspace:") ? id.slice("workspace:".length).split(":") : [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ManagementInputError("Select a DataArts Studio workspace.");
  return { instanceId: parts[0], workspaceId: parts[1] };
}

function workspaceIdOf(resource: ManagementResource | undefined) {
  return workspaceIdsOf(resource?.id);
}

function jobIdOf(resource: ManagementResource | undefined) {
  const id = resource?.id ?? "";
  const parts = id.startsWith("job:") ? id.slice("job:".length).split(":") : [];
  const jobName = parts.slice(2).join(":");
  if (parts.length < 3 || !parts[0] || !parts[1] || !jobName) throw new ManagementInputError("Select a DataArts Studio job.");
  return { instanceId: parts[0], workspaceId: parts[1], jobName };
}

async function currentInstance(s: BetterUiSession, instanceId: string) {
  const current = (await instances(s)).find(item => item.id === instanceId);
  if (!current) throw new ManagementInputError("The DataArts Studio instance no longer exists in this project.", 404);
  return current;
}

async function currentWorkspace(s: BetterUiSession, resource: ManagementResource | undefined) {
  const { instanceId, workspaceId } = workspaceIdOf(resource);
  await currentInstance(s, instanceId);
  const row = (await workspaces(s, instanceId)).find(item => item.id === workspaceId);
  if (!row) throw new ManagementInputError("The DataArts Studio workspace no longer exists in this instance.", 404);
  return { instanceId, workspaceId, row };
}

async function currentJob(s: BetterUiSession, resource: ManagementResource | undefined) {
  const { instanceId, workspaceId, jobName } = jobIdOf(resource);
  await currentInstance(s, instanceId);
  if (!(await workspaces(s, instanceId)).some(item => item.id === workspaceId)) throw new ManagementInputError("The DataArts Studio workspace no longer exists in this instance.", 404);
  if (!(await jobs(s, workspaceId)).some(item => item.name === jobName)) throw new ManagementInputError("The DataArts Studio job no longer exists in this workspace.", 404);
  return { workspaceId, jobName };
}

// is_default must be a native integer 0/1/2; coerced, boolean, null or string values stay unknown.
function spaceKind(row: Row) {
  return typeof row.is_default === "number" && Number.isSafeInteger(row.is_default) && row.is_default in spaceKinds ? row.is_default : undefined;
}

// An undocumented native status is reported as UNKNOWN instead of being passed off as known.
function knownStatus(value: unknown, known: string[]) {
  return typeof value === "string" && known.includes(value) ? value : "UNKNOWN";
}
const jobStatusOf = (row: Row) => knownStatus(row.status, jobStatuses);
const lastRunOf = (row: Row) => knownStatus(row.last_instance_status, runStatuses);
const runStatusOf = (row: Row) => knownStatus(row.status, runStatuses);

// A native HTTP 200 can still carry a business error; it is reported without echoing native details.
function verifyWriteResult(result: Row, label: string) {
  if ((typeof result.error_code === "string" && result.error_code) || (typeof result.error_msg === "string" && result.error_msg) || Object.keys(asRecord(result.error)).length) throw new Error(`Huawei reported a business error for this ${label}. Verify the resource in DataArts Studio before retrying.`);
}

// Native workspace creation requires eps_id. Primary source: the account's fresh active owned
// enterprise projects from the native EPS service. Without an account token, the only offered
// choices are enterprise projects verified by fresh native workspaces of this project's current
// instances. The default enterprise project appears only when it is actually returned.
async function epsChoices(s: BetterUiSession, instanceRows?: DataArtsInstance[]): Promise<ManagementChoice[]> {
  if (s.accountToken) {
    const choices: ManagementChoice[] = [], seen = new Set<string>();
    let total: number | undefined;
    for (let page = 0; page < 1000; page++) {
      let body: Record<string, unknown>;
      try { body = await huaweiFetch<Record<string, unknown>>({ ...s, token: s.accountToken }, "eps", `/v1.0/enterprise-projects?offset=${seen.size}&limit=100`); }
      catch (error) {
        if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected DataArts enterprise-project discovery. Check account permissions.", error.status);
        throw new Error("Huawei returned an unverifiable enterprise-project response.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body) || (("error_code" in body) && body.error_code !== 0 && body.error_code !== "0") || "error_msg" in body || "error" in body) throw new Error("Huawei reported an unverifiable enterprise-project response.");
      if (!Array.isArray(body.enterprise_projects) || typeof body.total_count !== "number" || !Number.isSafeInteger(body.total_count) || body.total_count < 0) throw new Error("Huawei returned an incomplete enterprise-project page.");
      if (total !== undefined && total !== body.total_count) throw new Error("Enterprise-project discovery changed during pagination.");
      total = body.total_count;
      for (const item of body.enterprise_projects) {
        const row = asRecord(item);
        if (typeof row.id !== "string" || !row.id.trim() || seen.has(row.id)) throw new Error("Huawei returned missing or duplicate enterprise-project identities.");
        seen.add(row.id);
        if (row.status === 1) choices.push({ value: row.id, label: `${typeof row.name === "string" && row.name.trim() ? row.name : row.id} · ${row.id}` });
      }
      if (seen.size > total || (!body.enterprise_projects.length && seen.size < total)) throw new Error("Huawei returned incomplete enterprise-project inventory.");
      if (seen.size === total) return choices;
    }
    throw new Error("Enterprise-project discovery exceeded its page limit.");
  } else {
    const rows = (await Promise.all((instanceRows ?? await instances(s)).map(item => workspaces(s, item.id)))).flat();
    return [...new Set(rows.map(row => row.eps_id).filter((value): value is string => typeof value === "string" && !!value))].map(id => ({ value: id, label: id === "0" ? "0 (default enterprise project, verified in use)" : `${id} (verified in use)` }));
  }
}

const operations: ManagementOperation[] = [
  { id: "inspect-instance", label: "Inspect instance", kind: "inspect", resourcePrefixes: ["instance:"], description: "Inspect one instance's edition, status, charging mode, native scope and live workspace count.", fields: [] },
  { id: "create-workspace", label: "Create workspace", kind: "create", description: "Create one workspace inside a current instance of this project. The native creation call requires an enterprise project and returns no typed workspace ID, so the result is accepted for manual verification in the inventory.", fields: [instanceChoice, workspaceName, workspaceDescription, epsId], impact: "A workspace organizes DataArts Studio development resources inside the existing instance. The instance subscription and its charges are unchanged; jobs and connections created in this workspace can consume compute and storage." },
  { id: "inspect-workspace", label: "Inspect workspace", kind: "inspect", resourcePrefixes: ["workspace:"], description: "Inspect one workspace's space type, owner, members, and OBS locations.", fields: [] },
  { id: "delete-workspace", label: "Delete private workspace", kind: "delete", resourcePrefixes: ["workspace:"], description: "Permanently delete one private workspace after exact-name confirmation. Default and public workspaces are protected.", fields: [], confirmation: true, impact: "The workspace and its contents are permanently removed across every DataArts Studio plane, including development jobs, models, data connections, quality rules and security configuration. Member access stops immediately. The instance and its subscription are not deleted." },
  { id: "jobs", label: "View development jobs", kind: "inspect", resourcePrefixes: ["workspace:"], description: "List the development jobs of one workspace with their native statuses.", fields: [] },
  { id: "job-instances", label: "View job run instances", kind: "inspect", resourcePrefixes: ["job:"], description: "List the recent run instances of one development job.", fields: [] },
  { id: "retry-job", label: "Retry failed job instance", kind: "action", resourcePrefixes: ["job:"], description: "Rerun one failed instance of this job from its failed node or the first node, using the original or current job version.", fields: [failedInstance, retryLocation, retryTaskVersion], confirmation: true, impact: "The failed job instance runs again and reprocesses its source data, consuming DataArts Studio compute resources. Downstream systems can receive duplicate data from the rerun." },
];

export const dataartsManagement: ManagementAdapter = {
  title: "DataArts Studio",
  operations,
  inventory: async s => {
    const instanceRows = await instances(s);
    const workspaceRows = await Promise.all(instanceRows.map(item => workspaces(s, item.id)));
    const scoped = instanceRows.flatMap((item, index) => workspaceRows[index].map(row => ({ instanceId: item.id, workspaceId: String(row.id), row })));
    const jobRows = await Promise.all(scoped.map(pair => jobs(s, pair.workspaceId)));
    return [
      ...instanceRows.map(item => ({ id: `instance:${item.id}`, name: item.name, status: item.status, values: { edition: item.edition, version: item.version, chargingMode: item.chargingMode } })),
      ...scoped.map(pair => {
        const kind = spaceKind(pair.row);
        return { id: `workspace:${pair.instanceId}:${pair.workspaceId}`, name: asString(pair.row.name), values: { description: asString(pair.row.description, ""), ...(kind !== undefined ? { spaceKind: kind } : {}), ...(typeof pair.row.eps_id === "string" && pair.row.eps_id ? { epsId: pair.row.eps_id } : {}), ...(typeof pair.row.member_num === "number" && Number.isSafeInteger(pair.row.member_num) && pair.row.member_num >= 0 ? { memberCount: pair.row.member_num } : {}) } };
      }),
      ...scoped.flatMap((pair, index) => jobRows[index].map(job => ({ id: `job:${pair.instanceId}:${pair.workspaceId}:${job.name}`, name: asString(job.name), status: jobStatusOf(job), values: { jobType: (["BATCH", "REAL_TIME", "STREAM"].includes(String(job.job_type)) ? String(job.job_type) : "Unknown"), owner: asString(job.owner, ""), lastInstanceStatus: lastRunOf(job) } }))),
    ];
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-workspace") {
      const instanceRows = await instances(s);
      return {
        instances: instanceRows.map(item => ({ value: item.id, label: `${item.name} · ${item.edition} · ${item.status}` })),
        enterpriseProjects: await epsChoices(s, instanceRows),
      };
    }
    if (operation === "retry-job" && resource) {
      const { workspaceId, jobName } = jobIdOf(resource);
      const rows = await jobInstances(s, workspaceId, jobName);
      return { failedInstances: rows.filter(row => row.status === "fail" && row.job_name === jobName).map(row => ({ value: String(row.instance_id), label: `Instance ${String(row.instance_id)} · failed run planned ${timestampMillis(row.plan_time)}` })) };
    }
    return {};
  },
  invalidationKeys: () => [cloudCacheKeys.listDataArtsInstances, cloudCacheKeys.summary],
  execute: async (s, operation, v, resource) => {
    const write = (path: string, method: string, body?: unknown, headers?: Record<string, string>) => dataArtsFetch<Record<string, unknown>>(s, path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(headers ? { headers } : {}) });

    if (operation === "create-workspace") {
      const freshInstances = await instances(s);
      const instance = freshInstances.find(item => item.id === v.instance);
      if (!instance) throw new ManagementInputError("The selected DataArts Studio instance is no longer available in this project.", 404);
      if (instance.status !== "in effect") throw new ManagementInputError("Only an effective DataArts Studio instance can receive a workspace.", 409);
      if (typeof v.name !== "string" || !v.name.trim()) throw new ManagementInputError("Enter a workspace name.");
      const name = v.name;
      if ((await workspaces(s, instance.id)).some(row => row.name === name)) throw new ManagementInputError("A workspace with this name already exists in this instance.", 409);
      const eps = String(v.epsId ?? "");
      if (!(await epsChoices(s, [instance])).some(choice => choice.value === eps)) throw new ManagementInputError("The selected enterprise project is no longer available for this account.", 409);
      const result = await write(`/v1/${s.projectId}/workspaces/${encodeURIComponent(instance.id)}`, "POST", { name, eps_id: eps, description: typeof v.description === "string" ? v.description : "" });
      verifyWriteResult(result, "workspace creation");
      if (result.is_success === false) throw new ManagementInputError("Huawei rejected the workspace creation.", 409);
      if (result.is_success !== true) throw new Error("Huawei returned no verifiable acceptance for workspace creation. Verify the workspace before retrying.");
      // Native message is not a typed workspace ID: only acceptance is proven, so the original parent
      // instance is referenced and the workspace must be verified manually in the inventory.
      return { message: "Workspace creation accepted. The native response carries no typed workspace ID; reload the inventory and verify the workspace in DataArts Studio before using it.", resourceId: `instance:${instance.id}`, asynchronous: true };
    }

    if (operation === "inspect-instance") {
      const current = await currentInstance(s, instanceIdOf(resource));
      const workspaceRows = await workspaces(s, current.id);
      return { message: "Current DataArts Studio instance configuration.", facts: [fact("Instance", current.name), fact("Edition", current.edition), fact("Version", current.version), fact("Status", current.status), fact("Charging mode", current.chargingMode), fact("Workspaces", workspaceRows.length), fact("Created", current.createdAt), fact("Enterprise project", current.epsId), fact("Order", current.orderId)] };
    }

    if (operation === "inspect-workspace") {
      const { row } = await currentWorkspace(s, resource);
      const kind = spaceKind(row);
      return { message: "Current DataArts Studio workspace configuration.", facts: [fact("Workspace", row.name), fact("Space type", kind === undefined ? "-" : spaceKinds[kind]), fact("Description", asString(row.description, "") || "-"), fact("Owner", row.owner_name), fact("Members", typeof row.member_num === "number" && Number.isSafeInteger(row.member_num) && row.member_num >= 0 ? row.member_num : "Unknown"), fact("Enterprise project", row.eps_id), fact("Bad-data OBS location", row.bad_record_location_name), fact("Job log OBS location", row.job_log_location_name), fact("Created", timestampMillis(row.create_time)), fact("Updated", timestampMillis(row.update_time))] };
    }

    if (operation === "delete-workspace") {
      const { instanceId, workspaceId, row } = await currentWorkspace(s, resource);
      const freshName = asString(row.name);
      if (!resource?.name || freshName !== resource.name) throw new ManagementInputError("The workspace was renamed or replaced since it was selected. Refresh the inventory and confirm the exact name before deleting.", 409);
      const kind = spaceKind(row);
      if (kind === undefined) throw new ManagementInputError("The workspace's native space type could not be verified; only private workspaces can be deleted here.", 409);
      if (kind !== 0) throw new ManagementInputError("Default and public workspaces are protected and cannot be deleted here.", 409);
      const result = await write(`/v1/${s.projectId}/${encodeURIComponent(instanceId)}/workspaces/batch-delete`, "POST", { workspace_ids: [workspaceId] });
      verifyWriteResult(result, "workspace deletion");
      if (result.is_success === false) throw new ManagementInputError("Huawei rejected this workspace deletion. Check the workspace in DataArts Studio before retrying.", 409);
      if (result.is_success !== true) throw new Error("Huawei returned no verifiable confirmation for this workspace deletion. Verify the workspace list in DataArts Studio before retrying.");
      if ((await workspaces(s, instanceId)).some(item => item.id === workspaceId)) return { message: "Huawei accepted the deletion, but the workspace is still listed. The pending deletion will be re-checked from operation history; verify the workspace in DataArts Studio before retrying.", resourceId: `workspace:${instanceId}:${workspaceId}`, jobId: `workspace-observer:${workspaceId}`, asynchronous: true };
      return { message: "Private workspace deleted.", resourceId: `workspace:${instanceId}:${workspaceId}` };
    }

    if (operation === "jobs") {
      const { workspaceId } = await currentWorkspace(s, resource);
      const rows = await jobs(s, workspaceId);
      return { message: `${rows.length} development job${rows.length === 1 ? "" : "s"} in this workspace.`, facts: rows.map(row => ({ label: `${asString(row.name)} · ${(["BATCH", "REAL_TIME", "STREAM"].includes(String(row.job_type)) ? String(row.job_type) : "Unknown")}`, value: `Status ${jobStatusOf(row)} · last run ${lastRunOf(row)}` })) };
    }

    if (operation === "job-instances") {
      const { workspaceId, jobName } = await currentJob(s, resource);
      const rows = await jobInstances(s, workspaceId, jobName);
      return { message: `${rows.length} recent run instance${rows.length === 1 ? "" : "s"} of this job.`, facts: rows.map(row => ({ label: `${asString(row.job_instance_name, "-")} · ${runStatusOf(row)}`, value: `Instance ${String(row.instance_id)} · planned ${timestampMillis(row.plan_time)} · submitted ${timestampMillis(row.submit_time)}${typeof row.execute_time === "number" && Number.isSafeInteger(row.execute_time) ? ` · took ${String(row.execute_time)} ms` : ""}` })) };
    }

    if (operation === "retry-job") {
      if (!["firstNode", "errorNode"].includes(String(v.retryLocation)) || !["original_version", "current_version"].includes(String(v.retryTaskVersion))) throw new ManagementInputError("Select a retry start point and job version.");
      const { workspaceId, jobName } = await currentJob(s, resource);
      const row = (await jobInstances(s, workspaceId, jobName)).find(item => String(item.instance_id) === String(v.instance));
      if (!row) throw new ManagementInputError("The selected job instance no longer exists for this job.", 404);
      if (row.status !== "fail") throw new ManagementInputError("Only failed job instances can be retried. Refresh the form.", 409);
      if (row.job_name !== jobName) throw new ManagementInputError("The selected instance belongs to a different job.", 409);
      const coordinates = { job_id: row.job_id, plan_time: row.plan_time, submit_time: row.submit_time };
      for (const value of Object.values(coordinates)) if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new ManagementInputError("Huawei did not report the native retry coordinates for this job instance.", 409);
      const result = await write(`/v2/${s.projectId}/factory/jobs/${encodeURIComponent(jobName)}/instances/retry`, "POST", { retry_location: String(v.retryLocation), retry_task_version: String(v.retryTaskVersion), task_retrys: coordinates }, { workspace: workspaceId });
      verifyWriteResult(result, "job instance retry");
      // The native response is empty and no job observer exists, so the rerun is accepted for
      // manual verification without claiming any fresh run status.
      return { message: "Retry request accepted without a native outcome. Check this job's run instances in DataArts Studio before relying on the rerun.", resourceId: resource!.id, asynchronous: true };
    }

    throw new ManagementInputError("Unsupported DataArts Studio operation.");
  },
  poll: async (s, entry) => {
    // Whitelisted native observer: only a pending private-workspace deletion that carries the
    // original workspace identifier can be refreshed here.
    if (entry.operation !== "Delete private workspace" || !entry.resourceId || !entry.jobId) throw new ManagementInputError("Only a pending private-workspace deletion can be refreshed here.", 409);
    const { instanceId, workspaceId } = workspaceIdsOf(entry.resourceId);
    if (`workspace-observer:${workspaceId}` !== entry.jobId) throw new ManagementInputError("The pending deletion no longer matches its original workspace.", 409);
    if (!(await instances(s)).some(item => item.id === instanceId)) return { state: "succeeded", message: "The workspace's instance no longer exists, so the workspace is gone as well." };
    if ((await workspaces(s, instanceId)).some(item => item.id === workspaceId)) return { state: "submitted", message: "The workspace is still listed; the deletion has not completed yet." };
    return { state: "succeeded", message: "Private workspace deleted.", resourceId: entry.resourceId };
  },
};
