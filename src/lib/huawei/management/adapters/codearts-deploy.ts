import "server-only";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listCodeArtsProjects, loadAcrossCodeArtsProjects } from "@/lib/huawei/codearts-projects";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

// Native current surface verified against the primary CodeArts Deploy API docs; the generated SDK lags
// behind several routes used here (ShowDeployStatus, StopDeployTaskRecordV2, RollbackRecords,
// ShowTaskTrigger) and omits documented response fields (AppBaseResponse.is_disable):
// https://support.huaweicloud.com/intl/en-us/api-deployman/ApplicationManagement.html
// CodeArts workspace IDs are developer project IDs; IAM regional project IDs are never used as them.
// Deployment records are only ever shown as names, states, and times; step inputs, execution
// parameter values, and credentials are never displayed.

const workspaceIdPattern = /^[a-f0-9]{32}$/i;
const nativeIdPattern = /^[A-Za-z0-9]{32}$/;
const activeStates = ["running", "pending"];
const inactiveStates = ["abort", "failed", "not_started", "succeeded", "timeout", "not_executed"];

const workspaceField: ManagementField = { key: "workspace", label: "Developer workspace", type: "select", source: "workspaces", required: true, help: "CodeArts developer workspaces are separate from the IAM projects of this session." };
const appNameField: ManagementField = { key: "name", label: "Application name", required: true, min: 3, max: 128, pattern: "^[\\u4e00-\\u9fa5A-Za-z0-9_-]{3,128}$", help: "3 to 128 characters; letters, digits, underscores, hyphens, or Chinese characters." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 1024, allowEmpty: true };
const templateField: ManagementField = { key: "template", label: "Native deployment template ID", required: true, min: 32, max: 32, pattern: "^[A-Za-z0-9]{32}$", help: "32-character template ID from the CodeArts Deploy console template gallery. The application's deployment steps are copied from this native template." };
const taskField: ManagementField = { key: "task", label: "Deployment task", type: "select", source: "tasks", help: "Defaults to the application's only deployment task." };
const recordField: ManagementField = { key: "record", label: "Deployment record", type: "select", source: "records", required: true, help: "Recent deployment records from the last 30 days." };

const deployImpact = "Deploying executes the application's current steps on its configured hosts or clusters using its saved credentials, can change existing cloud infrastructure and service states, and can incur charges.";

/** List the deploy applications of one CodeArts workspace through the native v1 application list. */
async function listApplicationsForWorkspace(scope: HuaweiProjectSession) {
  const body = await huaweiList<Record<string, unknown>>(scope, "codeartsdeploy", "/v1/applications/list", { items: ["result"], kind: "page", parameter: "page", size: 100, first: 1, inBody: true, total: ["total_num"] }, { method: "POST", body: JSON.stringify({ project_id: scope.projectId, page: 1, size: 100 }) });
  const rows = asArray(body.result).map(asRecord);
  if (rows.some(app => typeof app.id !== "string" || !nativeIdPattern.test(app.id))) throw new Error("Huawei returned an application without verified native identity.");
  return rows;
}

async function write(scope: HuaweiProjectSession, path: string, method: string, body?: unknown) {
  return huaweiFetch<Record<string, unknown>>(scope, "codeartsdeploy", path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

/** Native 200 responses still report rejection through their status and error fields. */
function confirmed(body: Record<string, unknown>, action: string) {
  if (body.status === undefined) throw new Error(`Huawei returned no confirmation status for ${action}.`);
  const status = String(body.status).toLowerCase();
  // Native error objects may contain private configuration; never echo their contents.
  const hasError = body.error !== undefined && body.error !== null && body.error !== "";
  if (status !== "success" || hasError) throw new ManagementInputError(`Huawei rejected ${action}.`, 409);
}

function selectedApplication(resource?: ManagementResource) {
  const parts = (resource?.id ?? "").split(":");
  if (parts[0] !== "application" || parts.length !== 3 || !workspaceIdPattern.test(parts[1] ?? "") || !nativeIdPattern.test(parts[2] ?? "")) throw new ManagementInputError("Select a CodeArts deploy application.");
  return { workspaceId: parts[1].toLowerCase(), appId: parts[2] };
}

/** Application detail through the native recommended v1 route, verified against workspace and ID. */
async function appDetail(scope: HuaweiProjectSession, workspaceId: string, appId: string) {
  const body = await huaweiFetch<Record<string, unknown>>(scope, "codeartsdeploy", `/v1/applications/${encodeURIComponent(appId)}/info`);
  confirmed(body, "loading this application's details");
  const result = asRecord(body.result);
  if (result.id !== appId || String(result.project_id ?? "").toLowerCase() !== workspaceId) throw new ManagementInputError("Huawei returned no verified details for this CodeArts workspace and application.", 404);
  return result;
}

/** Re-verify current workspace ownership and application membership immediately before any access. */
async function currentApp(s: BetterUiSession, resource: ManagementResource) {
  const { workspaceId, appId } = selectedApplication(resource);
  const workspace = (await listCodeArtsProjects(s)).find(item => item.id.toLowerCase() === workspaceId);
  if (!workspace) throw new ManagementInputError("The application's developer workspace is no longer accessible.", 404);
  const scope: HuaweiProjectSession = { ...s, projectId: workspace.id, projectName: workspace.name };
  const row = (await listApplicationsForWorkspace(scope)).find(app => app.id === appId);
  if (!row) throw new ManagementInputError("The selected application no longer exists in its CodeArts workspace.", 404);
  const detail = await appDetail(scope, workspaceId, appId);
  return { scope, workspaceId: workspace.id, workspaceName: workspace.name, appId, row, detail };
}

function tasksOf(detail: Record<string, unknown>) {
  if (!Array.isArray(detail.arrange_infos)) throw new ManagementInputError("The application's deployment-task inventory could not be verified.", 409);
  const rows = detail.arrange_infos.map(asRecord);
  if (new Set(rows.map(task => task.id)).size !== rows.length) throw new ManagementInputError("Duplicate deployment task identities could not be verified.", 409);
  if (rows.some(task => typeof task.id !== "string" || !nativeIdPattern.test(task.id))) throw new ManagementInputError("A deployment task has no verified native identity.", 409);
  return rows;
}

function resolveTask(detail: Record<string, unknown>, values: { task?: unknown }) {
  const tasks = tasksOf(detail);
  if (!tasks.length) throw new ManagementInputError("This application has no verified deployment tasks.", 409);
  if (typeof values.task === "string" && values.task) {
    const task = tasks.find(item => String(item.id) === values.task);
    if (!task) throw new ManagementInputError("The selected deployment task no longer exists in this application.", 404);
    return task;
  }
  if (tasks.length === 1) return tasks[0];
  throw new ManagementInputError("Select which deployment task of this application to use.", 409);
}

/** Historical records of one task within the documented 30-day window, latest first. */
async function taskHistory(scope: HuaweiProjectSession, taskId: string, limit: number) {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86400000);
  const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const body = await huaweiList<Record<string, unknown>>(scope, "codeartsdeploy", `/v2/${encodeURIComponent(scope.projectId)}/task/${encodeURIComponent(taskId)}/history?size=100&start_date=${day(start)}&end_date=${day(end)}`, { items: ["result"], kind: "page", parameter: "page", size: 100, first: 1, total: ["total_num"] });
  if (!Array.isArray(body.result)) throw new Error("Huawei returned no verifiable deployment history.");
  const rows = asArray(body.result).map(asRecord);
  if (rows.some(record => typeof record.execution_id !== "string" || !nativeIdPattern.test(record.execution_id) || (record.task_id !== undefined && record.task_id !== taskId))) throw new ManagementInputError("A deployment record has no verified native task identity.", 409);
  return rows.sort((a, b) => String(b.start_time ?? "").localeCompare(String(a.start_time ?? ""))).slice(0, limit);
}

/** Current execution state of one deployment record through the native v2 state route. */
async function deployState(scope: HuaweiProjectSession, taskId: string, recordId: string) {
  const body = await huaweiFetch<Record<string, unknown>>(scope, "codeartsdeploy", `/v2/tasks/${encodeURIComponent(taskId)}/state?record_id=${encodeURIComponent(recordId)}`);
  confirmed(body, "loading this deployment's state");
  return asRecord(body.result);
}

/** Trigger rules of one task; only the documented sources are accepted, anything else fails closed. */
async function taskTrigger(scope: HuaweiProjectSession, taskId: string) {
  const trigger = asRecord(await huaweiFetch<unknown>(scope, "codeartsdeploy", `/v2/task/trigger/detail?task_id=${encodeURIComponent(taskId)}`));
  const source = String(trigger.trigger_source ?? "");
  if (source !== "0" && source !== "1") throw new ManagementInputError("The deployment task's trigger settings could not be verified.", 409);
  const preserved: Record<string, unknown> = { trigger_source: source };
  if (typeof trigger.artifact_source_system === "string" && trigger.artifact_source_system) preserved.artifact_source_system = trigger.artifact_source_system;
  if (typeof trigger.artifact_type === "string" && trigger.artifact_type) preserved.artifact_type = trigger.artifact_type;
  return { source, preserved };
}

function recordChoice(value: unknown) {
  const parts = String(value ?? "").split(":");
  if (parts.length !== 2 || !nativeIdPattern.test(parts[0] ?? "") || !nativeIdPattern.test(parts[1] ?? "")) throw new ManagementInputError("Select a deployment record of this application.");
  return { taskId: parts[0], recordId: parts[1] };
}

/** Guard every mutation with the application's current deployment state. */
function assertIdle(row: Record<string, unknown>, action: string) {
  if (activeStates.includes(String(row.execution_state ?? ""))) throw new ManagementInputError(`Wait for the current deployment to finish before ${action}.`, 409);
  if (!inactiveStates.includes(String(row.execution_state ?? ""))) throw new ManagementInputError("The application's current deployment state could not be verified.", 409);
}

async function verifyIdleTasks(scope: HuaweiProjectSession, row: Record<string, unknown>, detail: Record<string, unknown>) {
  assertIdle(row, "changing this application");
  const tasks = tasksOf(detail);
  if (!tasks.length || tasks.some(task => !["Available", "Draft"].includes(String(task.state)))) throw new ManagementInputError("The application's current task states could not be verified.", 409);
  const histories = await Promise.all(tasks.map(task => taskHistory(scope, String(task.id), Number.MAX_SAFE_INTEGER)));
  if (histories.some(history => history.some(record => !inactiveStates.includes(String(record.state))))) throw new ManagementInputError("A deployment task has an active or unverified execution. Wait for every deployment to finish.", 409);
}

const fact = (label: string, value: unknown) => ({ label, value: typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "-" });
const list = (values: unknown[]) => (values.length ? values.join(", ") : "-");

export const codeartsDeployManagement: ManagementAdapter = {
  title: "CodeArts Deploy Applications",
  operations: [
    { id: "create-application", label: "Create deploy application", kind: "create", description: "Create a draft application from a native deployment template in a live CodeArts workspace. Draft applications cannot be deployed until they are published in CodeArts.", fields: [workspaceField, appNameField, descriptionField, templateField] },
    { id: "inspect", label: "View application configuration", kind: "inspect", resourcePrefixes: ["application:"], description: "Inspect whitelisted application metadata, task states, step names, and trigger rules. Step parameters, execution parameter values, and credentials are never displayed.", fields: [] },
    { id: "records", label: "View deployment records", kind: "inspect", resourcePrefixes: ["application:"], description: "List the task's most recent native deployment records from the last 30 days with their states.", fields: [taskField] },
    { id: "params", label: "View record parameters", kind: "inspect", resourcePrefixes: ["application:"], description: "Inspect the names and types of a deployment record's execution parameters. Parameter values are never displayed.", fields: [recordField] },
    { id: "deploy", label: "Deploy application", kind: "action", resourcePrefixes: ["application:"], allowedStatuses: ["Available"], description: "Start one manual deployment of the task's current steps. Follow progress in the operation history.", fields: [taskField], impact: deployImpact },
    { id: "stop", label: "Stop current deployment", kind: "action", resourcePrefixes: ["application:"], allowedStatuses: ["Deploying"], description: "Stop only the task's currently running deployment record. Finished records are never touched.", fields: [taskField], impact: "The current deployment is cancelled. In-progress changes stay partially applied and target services can be left in a mixed state." },
    { id: "rollback", label: "Re-run deployment record", kind: "action", resourcePrefixes: ["application:"], allowedStatuses: ["Available"], description: "Re-execute one verified finished deployment record through the native rollback route. Its saved parameters are reapplied to the targets.", fields: [recordField], impact: "The selected record's saved deployment is re-executed on its targets. This can overwrite newer changes, change service availability, and incur charges." },
    { id: "disable", label: "Disable application", kind: "action", resourcePrefixes: ["application:"], allowedStatuses: ["Available"], description: "Disable the application so it cannot be deployed.", fields: [], impact: "A disabled application cannot be deployed. Pipelines that deploy it fail until it is re-enabled." },
    { id: "enable", label: "Enable application", kind: "action", resourcePrefixes: ["application:"], allowedStatuses: ["Disabled"], description: "Re-enable a disabled application so it can be deployed again.", fields: [], impact: "The application can be deployed again, and pipelines that deploy it resume working." },
    { id: "delete", label: "Delete application", kind: "delete", resourcePrefixes: ["application:"], allowedStatuses: ["Available", "Disabled"], description: "Permanently delete an application that has no active deployment, after exact-name confirmation.", fields: [], confirmation: true, impact: "The application, its deployment tasks, and their records are permanently removed. Pipelines that deploy it fail immediately. Deleted applications cannot be restored." },
  ],
  inventory: async s => loadAcrossCodeArtsProjects(s, async scope => {
    const applications = await listApplicationsForWorkspace(scope);
    return applications.map(app => {
      const executionState = firstString([app.execution_state], "");
      const status = activeStates.includes(executionState) ? "Deploying" : inactiveStates.includes(executionState) ? (app.is_disable === true ? "Disabled" : app.is_disable === false ? "Available" : "Unverified") : "Unverified";
      const name = asString(app.name, String(app.id));
      return {
        id: `application:${scope.projectId}:${String(app.id)}`,
        name,
        status,
        values: { name, workspace: scope.projectName, executionState: executionState || "-", duration: asString(app.duration, "-"), creator: asString(app.create_user_id, "-"), lastExecutor: asString(app.executor_nick_name, "-") },
      };
    });
  }),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-application") return { workspaces: (await listCodeArtsProjects(s)).map(workspace => ({ value: workspace.id, label: workspace.name })) };
    if (!resource) return {};
    if (operation === "deploy" || operation === "stop" || operation === "records") {
      const verified = await currentApp(s, resource);
      return { tasks: tasksOf(verified.detail).map(task => ({ value: String(task.id), label: `${asString(task.name, String(task.id))} · ${asString(task.state, "unknown")}` })) };
    }
    if (operation === "rollback" || operation === "params") {
      const verified = await currentApp(s, resource);
      const tasks = tasksOf(verified.detail);
      const histories = await Promise.all(tasks.map(task => taskHistory(verified.scope, String(task.id), 100)));
      return {
        records: histories.flatMap((history, index) => history.filter(record => operation === "params" || inactiveStates.includes(String(record.state ?? ""))).map(record => ({ value: `${String(tasks[index].id)}:${String(record.execution_id)}`, label: `${asString(tasks[index].name, String(tasks[index].id))} · ${asString(record.state, "unknown")} · ${asString(record.start_time, "-")}` }))),
      };
    }
    return {};
  },
  execute: async (s, operation, v, resource) => {
    if (operation === "create-application") {
      const workspaceId = String(v.workspace);
      const workspace = (await listCodeArtsProjects(s)).find(item => item.id === workspaceId);
      if (!workspace) throw new ManagementInputError("The selected CodeArts workspace is no longer available.", 404);
      const scope: HuaweiProjectSession = { ...s, projectId: workspace.id, projectName: workspace.name };
      const name = String(v.name);
      const duplicate = await huaweiFetch<Record<string, unknown>>(scope, "codeartsdeploy", `/v1/applications/exist?name=${encodeURIComponent(name)}&project_id=${encodeURIComponent(workspace.id)}`);
      confirmed(duplicate, "checking the application name");
      if (duplicate.result !== false) throw new ManagementInputError("An application with this name already exists in the selected workspace, or its name could not be verified as unique.", 409);
      const templateId = String(v.template);
      if (!nativeIdPattern.test(templateId)) throw new ManagementInputError("Enter a 32-character native deployment template ID.", 400);
      const body: Record<string, unknown> = { project_id: workspace.id, name, is_draft: true, create_type: "template", arrange_infos: [{ template_id: templateId }] };
      if (typeof v.description === "string" && v.description) body.description = v.description;
      const created = await write(scope, "/v1/applications", "POST", body);
      confirmed(created, "creating this application");
      const result = asRecord(created.result);
      const appId = result.id;
      if (typeof appId !== "string" || !nativeIdPattern.test(appId) || result.name !== name) throw new Error("Huawei returned no verified application ID for the created application.");
      const taskIds = asArray(result.arrange_infos).map(asRecord).map(task => String(task.id)).filter(id => nativeIdPattern.test(id));
      if (!taskIds.length) throw new Error("Huawei returned no verified deployment task for the created application.");
      return { message: `Application ${name} created in draft state in workspace ${workspace.name} from the native template. Draft applications cannot be deployed until they are published in CodeArts.`, resourceId: `application:${workspace.id}:${appId}`, facts: [fact("application id", appId), fact("deployment task id", taskIds[0])] };
    }
    const verified = await currentApp(s, resource!);
    const { scope, workspaceId, appId } = verified;
    if (["deploy", "rollback", "disable", "enable", "delete"].includes(operation)) await verifyIdleTasks(scope, verified.row, verified.detail);
    if (operation === "inspect") {
      const detail = verified.detail;
      const tasks = tasksOf(detail);
      const triggers = await Promise.all(tasks.map(async task => {
        try { return (await taskTrigger(scope, String(task.id))).source; } catch { return "-"; }
      }));
      const facts = [
        fact("CodeArts workspace", workspaceId),
        fact("application id", appId),
        fact("application name", detail.name ?? verified.row.name),
        fact("description", detail.description),
        fact("region", detail.region),
        fact("disabled", detail.is_disable),
        fact("creation type", detail.create_type),
        fact("permission level", detail.permission_level),
        fact("creator", firstString([detail.create_user_id, verified.row.create_user_id])),
        fact("created", detail.create_time),
        fact("updated", detail.update_time),
        fact("slave cluster", detail.slave_cluster_id),
        fact("last deployment state", firstString([verified.row.execution_state])),
        fact("last deployment duration", verified.row.duration),
        fact("deployment tasks", list(tasks.map(task => asString(task.name, String(task.id))))),
        ...tasks.flatMap((task, index) => [
          fact(`task ${String(task.id)} state`, task.state),
          fact(`task ${String(task.id)} deploy system`, task.deploy_system),
          fact(`task ${String(task.id)} template`, task.template_id),
          fact(`task ${String(task.id)} trigger source`, triggers[index] === "1" ? "1 (pipeline only)" : triggers[index] === "0" ? "0 (any source)" : "-"),
          fact(`task ${String(task.id)} steps`, list(Object.values(asRecord(task.steps)).map(step => asRecord(step)).filter(step => typeof step.name === "string" && !!step.name).map(step => `${String(step.name)}${step.enable === false ? " (disabled)" : ""}`))),
        ]),
      ];
      return { message: "Current CodeArts deploy application configuration. Step parameters, execution parameter values, and credentials are not displayed.", facts };
    }
    if (operation === "records") {
      const task = resolveTask(verified.detail, v);
      const history = await taskHistory(scope, String(task.id), 20);
      return {
        message: `Latest ${history.length} native deployment record${history.length === 1 ? "" : "s"} of task ${asString(task.name, String(task.id))} from the last 30 days.`,
        facts: history.map(record => {
          const releaseId = typeof record.release_id === "number" && Number.isSafeInteger(record.release_id) ? String(record.release_id) : String(record.execution_id).slice(0, 8);
          return fact(`Record ${releaseId}`, `${asString(record.state, "unknown")} · ${firstString([record.nickname, record.operator])} · ${asString(record.start_time, "-")} · ${asString(record.duration, "-")}`);
        }),
      };
    }
    if (operation === "params") {
      const choice = recordChoice(v.record);
      const task = tasksOf(verified.detail).find(item => String(item.id) === choice.taskId);
      if (!task) throw new ManagementInputError("The selected deployment task no longer exists in this application.", 404);
      const record = (await taskHistory(scope, choice.taskId, 100)).find(item => String(item.execution_id) === choice.recordId);
      if (!record) throw new ManagementInputError("The selected deployment record is no longer listed for this task.", 404);
      const body = await huaweiFetch<unknown>(scope, "codeartsdeploy", `/v2/history/tasks/${encodeURIComponent(choice.taskId)}/params?record_id=${encodeURIComponent(choice.recordId)}`);
      if (!Array.isArray(body)) throw new Error("Huawei returned no verifiable execution parameters.");
      return { message: `Execution parameters of deployment record ${choice.recordId}. Names and types only; values are never displayed.`, facts: body.map(asRecord).map(parameter => fact(asString(parameter.name, "unnamed parameter"), `type ${asString(parameter.type, "unknown")}`)) };
    }
    if (operation === "deploy" || operation === "rollback") {
      if (verified.detail.is_disable !== false) throw new ManagementInputError("Re-enable this disabled application and verify its state before deploying it.", 409);
      let taskId: string;
      let recordId: string | undefined;
      if (operation === "deploy") {
        const task = resolveTask(verified.detail, v);
        if (task.state !== "Available") throw new ManagementInputError(task.state === "Draft" ? "This deployment task is still a draft; publish the application in CodeArts before deploying it." : "The deployment task's executable state could not be verified.", 409);
        taskId = String(task.id);
      } else {
        const choice = recordChoice(v.record);
        const task = tasksOf(verified.detail).find(item => String(item.id) === choice.taskId);
        if (!task) throw new ManagementInputError("The selected deployment task no longer exists in this application.", 404);
        if (task.state !== "Available") throw new ManagementInputError("Publish this deployment task before re-running a record.", 409);
        taskId = choice.taskId;
        recordId = choice.recordId;
      }
      const trigger = await taskTrigger(scope, taskId);
      if (trigger.source === "1") throw new ManagementInputError("This deployment task only allows pipeline-triggered executions.", 409);
      const history = await taskHistory(scope, taskId, 100);
      if (operation === "deploy") {
        const latest = history[0];
        if (latest && activeStates.includes(String(latest.state ?? ""))) throw new ManagementInputError("This deployment task is already running. Stop the current deployment before starting another.", 409);
        const started = await write(scope, `/v2/tasks/${encodeURIComponent(taskId)}/start`, "POST", {});
        const startedRecord = asRecord(started).id;
        if (typeof startedRecord !== "string" || !nativeIdPattern.test(startedRecord) || asRecord(started).task_id !== taskId) throw new Error("Huawei returned no verifiable deployment record for this task.");
        return { message: `Deployment started with record ${startedRecord}. It executes the task's current steps with its saved credentials and can change the target infrastructure.`, resourceId: resource!.id, jobId: `${workspaceId}:${appId}:${taskId}:${startedRecord}`, asynchronous: true };
      }
      const record = history.find(item => String(item.execution_id) === recordId);
      if (!record) throw new ManagementInputError("The selected deployment record is no longer listed for this task.", 404);
      if (activeStates.includes(String(record.state ?? ""))) throw new ManagementInputError("The selected deployment record is still active; wait for it to finish before re-running it.", 409);
      const latest = history[0];
      if (latest && activeStates.includes(String(latest.state ?? ""))) throw new ManagementInputError("This deployment task is already running. Stop the current deployment before re-running a record.", 409);
      const rolled = await write(scope, `/v2/tasks/${encodeURIComponent(taskId)}/records/${encodeURIComponent(String(recordId))}/rollback`, "POST");
      const rolledRecord = asRecord(rolled).id;
      if (typeof rolledRecord !== "string" || !nativeIdPattern.test(rolledRecord) || asRecord(rolled).task_id !== taskId) throw new Error("Huawei returned no verifiable deployment record for this rollback.");
      return { message: `Rollback of record ${String(recordId)} started with new record ${rolledRecord}. The saved parameters of that record are reapplied to the target infrastructure.`, resourceId: resource!.id, jobId: `${workspaceId}:${appId}:${taskId}:${rolledRecord}`, asynchronous: true };
    }
    if (operation === "stop") {
      const task = resolveTask(verified.detail, v);
      const taskId = String(task.id);
      const latest = (await taskHistory(scope, taskId, 100))[0];
      if (!latest) throw new ManagementInputError("Huawei reported no current deployment record for this task.", 409);
      const recordId = String(latest.execution_id);
      if (!activeStates.includes(String(latest.state ?? ""))) throw new ManagementInputError("The latest deployment record is already finished.", 409);
      const state = await deployState(scope, taskId, recordId);
      if (state.record_id !== recordId || state.task_id !== taskId) throw new ManagementInputError("The current deployment record's task and record identity could not be verified.", 409);
      if (String(state.status ?? "") !== "running") throw new ManagementInputError("The latest deployment is not currently running; its state could not be verified as stoppable.", 409);
      const stopped = await write(scope, `/v2/tasks/${encodeURIComponent(taskId)}/records/${encodeURIComponent(recordId)}/stop`, "PUT");
      confirmed(stopped, "stopping this deployment");
      const result = asRecord(stopped.result);
      if (result.id !== recordId || result.task_id !== taskId) throw new Error("Huawei did not confirm stopping the selected deployment record.");
      return { message: `Stop request accepted for deployment record ${recordId}. In-progress changes stay partially applied.`, resourceId: resource!.id, jobId: `${workspaceId}:${appId}:${taskId}:${recordId}`, asynchronous: true };
    }
    if (operation === "disable" || operation === "enable") {
      const disabling = operation === "disable";
      if (verified.detail.is_disable !== !disabling) throw new ManagementInputError(disabling ? "This application is already disabled or its enabled state could not be verified." : "This application is not disabled.", 409);
      assertIdle(verified.row, disabling ? "disabling it" : "enabling it");
      confirmed(await write(scope, `/v1/applications/${encodeURIComponent(appId)}/disable`, "PUT", { is_disable: disabling }), disabling ? "disabling this application" : "enabling this application");
      return { message: disabling ? "Application disabled. It cannot be deployed until it is re-enabled." : "Application re-enabled. It can be deployed again." };
    }
    if (operation === "delete") {
      assertIdle(verified.row, "deleting it");
      const result = await write(scope, `/v1/applications/${encodeURIComponent(appId)}`, "DELETE");
      confirmed(result, "deleting this application");
      const returned = asRecord(result.result);
      if (typeof returned.id !== "string" || !returned.id) throw new Error("Huawei returned no verifiable deletion confirmation for this application.");
      if (returned.id !== appId) throw new ManagementInputError("Huawei deleted a different application than the selected one.", 409);
      return { message: `Application ${resource?.name} deleted.` };
    }
    throw new ManagementInputError("Unsupported CodeArts Deploy operation.");
  },
  poll: async (s, entry) => {
    if (!entry.resourceId) throw new ManagementInputError("This request has no verified application to check.");
    const { workspaceId, appId } = selectedApplication({ id: entry.resourceId, name: entry.resourceName ?? entry.resourceId });
    const parts = String(entry.jobId ?? "").split(":");
    if (parts.length !== 4 || parts[0].toLowerCase() !== workspaceId || parts[1] !== appId || !nativeIdPattern.test(parts[2] ?? "") || !nativeIdPattern.test(parts[3] ?? "")) throw new ManagementInputError("This request has no verified deployment record to check.");
    const taskId = parts[2], recordId = parts[3];
    if (!(await listCodeArtsProjects(s)).some(item => item.id.toLowerCase() === workspaceId)) throw new ManagementInputError("The deployment's developer workspace is no longer accessible.", 404);
    const state = await deployState(s, taskId, recordId);
    if (state.task_id !== taskId || state.record_id !== recordId) throw new ManagementInputError("The deployment record's task and record identity could not be verified.", 409);
    const status = String(state.status ?? "").toLowerCase();
    if (status === "succeeded") return { state: "succeeded", message: `Deployment record ${recordId} completed successfully.` };
    if (status === "failed") return { state: "failed", message: `Deployment record ${recordId} finished with result failed.` };
    if (status === "running") return { state: "submitted", message: `Deployment record ${recordId} is running.` };
    return { state: "submitted", message: `Deployment record ${recordId} reported unverified state ${status || "unknown"}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listCodeArtsDeployApplications],
};
