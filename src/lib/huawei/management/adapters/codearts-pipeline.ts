import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiAccountFetch, huaweiArrayList, huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString, timestampMillis } from "@/lib/huawei/parsers";
import { listCodeArtsProjects } from "@/lib/huawei/codearts-projects";
import { finishCloudLoad, settledValue } from "@/lib/huawei/errors";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

// Verified against the cached CodeArts Pipeline SDK v2 models; writes use the native v5 routes only.
// CodeArts developer workspaces are not IAM projects, so resources use composite workspace/pipeline IDs.
const compositeId = /^([a-f0-9]{32})\/([a-z0-9]{32})$/i;
const nativeId = /^[a-z0-9]{32}$/i;
const tenantIdPattern = /^[a-z0-9-]{8,64}$/i;
const templateIdPattern = /^[a-z0-9]{32}$/i;
const activeStatuses = ["INIT", "QUEUED", "RUNNING", "PAUSED", "SUSPEND", "ASYNC_RUNNING", "REDISPATCH"];
const inactiveStatuses = ["COMPLETED", "FAILED", "CANCELED", "IGNORED", "SKIPPED", "ASYNC_FAILED"];
const failedStatuses = ["FAILED", "CANCELED", "IGNORED", "ASYNC_FAILED"];
const stopRunLabel = "Stop current run";
const nameField: ManagementField = { key: "name", label: "Pipeline name", required: true, max: 128, pattern: "^[\u4e00-\u9fa5A-Za-z0-9_-]{1,128}$", help: "1-128 letters, digits, underscores, hyphens, or Chinese characters." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 1024, maxBytes: 3072 };
const pipelineDtoKeys = ["name", "description", "is_publish", "sources", "variables", "schedules", "triggers", "manifest_version", "definition", "project_name", "group_id", "id", "concurrency_control", "security_level", "disable_release_branch_management", "execution_plans", "project_id", "cancel_strategy", "agency_name", "variable_group_ids", "confidentiality_code"];

function parseRef(resource?: ManagementResource) {
  if (!resource) throw new ManagementInputError("Select a current pipeline.", 400);
  const match = compositeId.exec(resource.id);
  if (!match) throw new ManagementInputError("Select a current pipeline.", 400);
  return { workspaceId: match[1].toLowerCase(), pipelineId: match[2].toLowerCase() };
}

async function liveWorkspace(s: BetterUiSession, workspaceId: string) {
  const workspace = (await listCodeArtsProjects(s)).find(project => project.id === workspaceId);
  if (!workspace) throw new ManagementInputError("The pipeline's developer workspace is no longer available to this session.", 404);
  return workspace;
}

async function livePipeline(s: BetterUiSession, resource?: ManagementResource) {
  const ref = parseRef(resource);
  const workspace = await liveWorkspace(s, ref.workspaceId);
  const detail = asRecord(await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${ref.workspaceId}/api/pipelines/${ref.pipelineId}`));
  if (asString(detail.id, "").toLowerCase() !== ref.pipelineId || asString(detail.project_id, "").toLowerCase() !== ref.workspaceId) throw new ManagementInputError("The pipeline could not be verified in this developer workspace.", 404);
  return { workspaceId: ref.workspaceId, pipelineId: ref.pipelineId, workspaceName: workspace.name, detail, resourceId: `${ref.workspaceId}/${ref.pipelineId}` };
}

async function pipelines(s: BetterUiSession, workspaceId: string, workspaceName: string): Promise<ManagementResource[]> {
  const body = await huaweiList<Record<string, unknown>>(s, "codeartspipeline", `/v5/${workspaceId}/api/pipelines/list`, {
    items: ["pipelines"], kind: "offset", parameter: "offset", size: 100, total: ["total"], inBody: true,
  }, { method: "POST", body: JSON.stringify({ limit: 100, offset: 0, project_id: workspaceId }) });
  return asArray(body.pipelines).map(asRecord).map((row): ManagementResource => {
    const id = asString(row.pipeline_id, "").toLowerCase();
    const name = asString(row.name, "");
    if (!nativeId.test(id) || !name) throw new Error("Huawei returned a pipeline without a verified 32-character ID and name.");
    return { id: `${workspaceId}/${id}`, name, status: asString(asRecord(row.latest_run).status, "NOT_RUN").toUpperCase(), values: { workspace: workspaceName, manifest: asString(row.manifest_version, "-"), created: timestampMillis(row.create_time) } };
  });
}

async function runs(s: BetterUiSession, workspaceId: string, pipelineId: string) {
  const body = await huaweiList<Record<string, unknown>>(s, "codeartspipeline", `/v5/${workspaceId}/api/pipelines/${pipelineId}/pipeline-runs/list`, {
    items: ["pipeline_runs"], kind: "offset", parameter: "offset", size: 100, total: ["total"], inBody: true,
  }, { method: "POST", body: JSON.stringify({ offset: 0, limit: 100 }) });
  const rows = asArray(body.pipeline_runs).map(asRecord);
  if (rows.some(row => asString(row.pipeline_id, "").toLowerCase() !== pipelineId || !nativeId.test(asString(row.pipeline_run_id, "").toLowerCase()))) throw new ManagementInputError("Huawei returned a run without verified pipeline membership.", 409);
  return rows;
}

async function runDetail(s: BetterUiSession, workspaceId: string, pipelineId: string, runId: string) {
  const detail = asRecord(await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${workspaceId}/api/pipelines/${pipelineId}/pipeline-runs/detail?${new URLSearchParams({ pipeline_run_id: runId })}`));
  if (asString(detail.pipeline_id, "").toLowerCase() !== pipelineId || asString(detail.id, "").toLowerCase() !== runId) throw new ManagementInputError("The run could not be verified for this pipeline.", 404);
  return detail;
}

async function latestRunStatus(s: BetterUiSession, workspaceId: string, pipelineId: string) {
  const payload = await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${workspaceId}/api/pipelines/status`, { method: "POST", body: JSON.stringify([pipelineId]) });
  const rows = Array.isArray(payload) ? payload : asArray(asRecord(payload).body);
  const current = rows.map(asRecord).filter(row => asString(row.pipeline_id, "").toLowerCase() === pipelineId);
  if (!current.length && !rows.length) return undefined;
  if (current.length !== 1 || typeof current[0].status !== "string") throw new ManagementInputError("The pipeline's latest run state could not be verified.", 409);
  return current[0];
}

async function tenantId(s: BetterUiSession) {
  if (!s.accountToken) throw new ManagementInputError("Sign out and sign in again to obtain an account token for pipeline templates.", 409);
  const response = asRecord(await huaweiAccountFetch<unknown>({ ...s, token: s.accountToken }, "/v3/auth/tokens", { headers: { "X-Subject-Token": s.accountToken } }));
  const token = asRecord(response.token);
  const user = asRecord(token.user);
  const id = asString(asRecord(token.domain).id, "");
  if (!tenantIdPattern.test(id) || asRecord(user.domain).id !== id || (s.userId && user.id !== s.userId)) throw new ManagementInputError("The account's tenant ID could not be verified. Sign in again and retry.", 409);
  return id;
}

async function templates(s: BetterUiSession) {
  const tenant = await tenantId(s);
  const body = await huaweiList<Record<string, unknown>>(s, "codeartspipeline", `/v5/${tenant}/api/pipeline-templates/list`, {
    items: ["templates"], kind: "offset", parameter: "offset", size: 100, total: ["total"], inBody: true,
  }, { method: "POST", body: JSON.stringify({ offset: 0, limit: 100 }) });
  return asArray(body.templates).map(asRecord).filter(row => templateIdPattern.test(asString(row.id, "").toLowerCase()) && asString(row.name, "") && row.is_system === true);
}

async function ownedRepositories(s: BetterUiSession) {
  return huaweiArrayList<Record<string, unknown>>(s, "codeartsrepo", `/v4/projects/${s.projectId}/repositories?limit=100&order_by=updated_at&sort=desc`, { kind: "offset", parameter: "offset", size: 100 });
}
async function ownedBranches(s: BetterUiSession, repository: string) {
  if (!/^[1-9]\d*$/.test(repository) || !Number.isSafeInteger(Number(repository)) || Number(repository) > 2147483647 || !(await ownedRepositories(s)).some(repo => String(repo.id) === repository)) throw new ManagementInputError("The repository is no longer available in this developer workspace.", 409);
  const repo = await huaweiFetch<Record<string, unknown>>(s, "codeartsrepo", `/v4/repositories/${repository}`);
  if (String(repo.id) !== repository || repo.project_id !== s.projectId || repo.archived !== false) throw new ManagementInputError("The repository's workspace and writable state could not be verified.", 409);
  return huaweiArrayList<Record<string, unknown>>(s, "codeartsrepo", `/v4/repositories/${repository}/repository/branches?limit=100`, { kind: "offset", parameter: "offset", size: 100 });
}
async function verifiedSource(s: BetterUiSession, value: string) {
  let selected: Record<string, unknown>;
  try { selected = asRecord(JSON.parse(value)); } catch { throw new ManagementInputError("Select a current repository branch."); }
  const workspaceId = selected.workspace, repository = selected.repository, branch = selected.branch;
  if (typeof workspaceId !== "string" || typeof repository !== "string" || typeof branch !== "string") throw new ManagementInputError("Select a current repository branch.");
  await liveWorkspace(s, workspaceId);
  const scope = { ...s, projectId: workspaceId };
  if (!(await ownedBranches(scope, repository)).some(row => row.name === branch)) throw new ManagementInputError("The selected repository branch no longer exists.", 409);
  const repo = await huaweiFetch<Record<string, unknown>>(scope, "codeartsrepo", `/v4/repositories/${repository}`);
  if (String(repo.id) !== repository || repo.project_id !== workspaceId || repo.archived !== false || typeof repo.http_url_to_repo !== "string" || !repo.http_url_to_repo) throw new ManagementInputError("The current repository source could not be verified.", 409);
  return { workspaceId, source: { type: "code", params: { git_type: "codehub", codehub_id: repository, default_branch: branch, git_url: repo.http_url_to_repo, ...(typeof repo.ssh_url_to_repo === "string" ? { ssh_git_url: repo.ssh_url_to_repo } : {}), repo_name: String(repo.name), alias: "codehub" } } };
}

function pipelineDto(detail: Record<string, unknown>, changes: Record<string, unknown>) {
  if (typeof detail.name !== "string" || typeof detail.is_publish !== "boolean" || typeof detail.definition !== "string" || !detail.definition || detail.from_git_code === true || detail.yaml_definition || detail.yaml_content) throw new ManagementInputError("The complete editable configuration could not be verified. YAML/PAC pipelines require their native configuration workflow.", 409);
  if (asArray(detail.variables).some(value => asRecord(value).is_secret === true)) throw new ManagementInputError("This pipeline contains secret variables whose values cannot be safely round-tripped. Edit it in CodeArts Pipeline.", 409);
  if (asArray(detail.triggers).some(value => { const token = asRecord(value).security_token; return typeof token === "string" && /^(\*+|<redacted>|REDACTED)$/i.test(token); })) throw new ManagementInputError("This pipeline has a masked webhook token that cannot be safely preserved.", 409);
  const dto: Record<string, unknown> = {};
  for (const key of pipelineDtoKeys) if (detail[key] !== undefined) dto[key] = detail[key];
  if (dto.confidentiality_code === undefined && detail.security_level_code !== undefined) dto.confidentiality_code = detail.security_level_code;
  return { ...dto, ...changes };
}

async function savePipeline(s: BetterUiSession, workspaceId: string, pipelineId: string, detail: Record<string, unknown>, changes: Record<string, unknown>) {
  const response = asRecord(await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${workspaceId}/api/pipelines/${pipelineId}`, { method: "PUT", body: JSON.stringify(pipelineDto(detail, changes)) }));
  if (asString(response.pipeline_id, "").toLowerCase() !== pipelineId) throw new Error("Huawei returned no verified pipeline update confirmation. Check the pipeline before retrying.");
}

function triggerChanges(detail: Record<string, unknown>, enable: boolean) {
  return {
    schedules: asArray(detail.schedules).map(asRecord).map(schedule => ({ ...schedule, enable })),
    triggers: asArray(detail.triggers).map(asRecord).map(trigger => ({ ...trigger, events: asArray(trigger.events).map(asRecord).map(event => ({ ...event, enable })) })),
  };
}

function definitionOutline(definition: unknown) {
  if (typeof definition !== "string" || !definition.trim()) return [{ label: "Definition outline", value: "Not available for this pipeline format." }];
  let parsed: unknown;
  try { parsed = JSON.parse(definition); } catch { return [{ label: "Definition outline", value: "The definition could not be summarized." }]; }
  const stages = asArray(asRecord(parsed).stages).map(asRecord);
  if (!stages.length) return [{ label: "Definition outline", value: "Not available for this pipeline format." }];
  return stages.slice(0, 20).map((stage, index) => {
    const jobs = asArray(stage.jobs ?? stage.tasks).map(asRecord);
    const outline = jobs.map(job => {
      const steps = asArray(job.steps ?? job.tasks).map(asRecord);
      const stepText = steps.map(step => `${asString(step.name, "step")}${asString(step.task, "") ? ` [${asString(step.task)}]` : ""}`).join(", ");
      return `${asString(job.name, `job ${index + 1}`)}${stepText ? `: ${stepText}` : ""}`;
    }).join("; ");
    return { label: `Stage ${index + 1}: ${asString(stage.name, "-")}`, value: outline || "No jobs" };
  });
}

function inspectFacts(detail: Record<string, unknown>) {
  const facts = [
    { label: "Name", value: asString(detail.name) },
    { label: "Description", value: asString(detail.description, "None") },
    { label: "Manifest version", value: asString(detail.manifest_version) },
    { label: "Change pipeline", value: detail.is_publish === true ? "Yes" : "No" },
    { label: "Creator", value: asString(detail.creator_name) },
    { label: "Created", value: timestampMillis(detail.create_time) },
    { label: "Updated", value: timestampMillis(detail.update_time) },
    { label: "Group", value: asString(detail.group_name, "None") },
    { label: "Region", value: asString(detail.region) },
    { label: "Banned", value: detail.banned === true ? "Yes" : "No" },
  ];
  const sources = asArray(detail.sources).map(asRecord);
  facts.push(...(sources.length ? sources.map(source => {
    const params = asRecord(source.params);
    const parts = [asString(source.type), asString(params.git_type), asString(params.default_branch), asString(params.codehub_id)].filter(part => part !== "-");
    return { label: `Source ${firstString([params.alias, params.repo_name], asString(source.type))}`, value: parts.join(" · ") || "-" };
  }) : [{ label: "Sources", value: "None configured" }]));
  const variables = asArray(detail.variables).map(asRecord);
  facts.push({ label: "Variables", value: variables.length ? variables.map(variable => `${asString(variable.name)}${variable.is_secret === true ? " (secret)" : ""}${variable.is_runtime === true ? " (runtime)" : ""}`).join(", ") : "None" });
  const triggers = asArray(detail.triggers).map(asRecord);
  facts.push({ label: "Code triggers", value: triggers.length ? triggers.map(trigger => `${asString(trigger.git_type, "code")}: ${asArray(trigger.events).map(asRecord).map(event => `${asString(event.type, "event")} ${event.enable === true ? "on" : "off"}`).join(", ") || "no events"}`).join("; ") : "None" });
  const schedules = asArray(detail.schedules).map(asRecord);
  facts.push({ label: "Schedules", value: schedules.length ? schedules.map(schedule => `${asString(schedule.name, "schedule")} ${schedule.enable === true ? "enabled" : "disabled"}`).join("; ") : "None" });
  const concurrency = asRecord(detail.concurrency_control);
  if (Object.keys(concurrency).length) facts.push({ label: "Concurrency control", value: `${concurrency.enable === true ? "enabled" : "disabled"} · limit ${asString(concurrency.concurrency_number)} · on exceed ${asString(concurrency.exceed_action)}` });
  facts.push(...definitionOutline(detail.definition));
  return facts;
}

function runNumber(run: Record<string, unknown>) {
  return run.run_number === undefined || run.run_number === null ? "-" : String(run.run_number);
}

function runHistoryFacts(history: Record<string, unknown>[]) {
  return history.slice(0, 20).map(run => ({
    label: `Run #${runNumber(run)} · ${asString(run.pipeline_run_id).slice(0, 8)}`,
    value: [asString(run.status, "UNKNOWN"), asString(run.trigger_type), asString(run.executor_name), timestampMillis(run.start_time), run.end_time ? timestampMillis(run.end_time) : "in progress"].filter(part => part !== "-").join(" · "),
  }));
}

function runDetailFacts(detail: Record<string, unknown>) {
  const facts = [
    { label: "Status", value: asString(detail.status, "UNKNOWN") },
    { label: "Run number", value: runNumber(detail) },
    { label: "Trigger type", value: asString(detail.trigger_type) },
    { label: "Executor", value: asString(detail.executor_name) },
    { label: "Started", value: timestampMillis(detail.start_time) },
    { label: "Ended", value: detail.end_time ? timestampMillis(detail.end_time) : "In progress" },
  ];
  for (const [index, stage] of asArray(detail.stages).map(asRecord).slice(0, 20).entries()) {
    const outline = asArray(stage.jobs).map(asRecord).map(job => {
      const steps = asArray(job.steps).map(asRecord);
      const stepText = steps.map(step => `${asString(step.name, "step")} [${asString(step.task, "task")}] (${asString(step.status, "-")})`).join(", ");
      return `${asString(job.name, "job")} (${asString(job.status, "-")})${stepText ? `: ${stepText}` : ""}`;
    }).join("; ");
    facts.push({ label: `Stage ${index + 1}: ${asString(stage.name, "-")}`, value: `${asString(stage.status, "-")} · ${outline || "No jobs"}` });
  }
  return facts;
}

export const codeartsPipelineManagement: ManagementAdapter = {
  title: "CodeArts Pipelines",
  operations: [
    { id: "create", label: "Create pipeline from template", description: "Create a pipeline in a developer workspace from a live-verified official template. The new pipeline starts without automatic triggers and a current CodeArts repository branch.", kind: "create", fields: [
      { key: "workspace", label: "Developer workspace", type: "select", required: true, source: "workspaces" },
      { key: "template", label: "Pipeline template", type: "select", required: true, source: "templates" },
      { key: "source", label: "Workspace / repository / branch", type: "select", source: "sources", required: true, max: 1024 },
      nameField,
      descriptionField,
    ], impact: "Creating a pipeline does not run it. Later runs execute remote code, can deploy with saved credentials, and can incur charges." },
    { id: "inspect", label: "View pipeline configuration", description: "Inspect whitelisted non-secret configuration: sources, code triggers, schedules, variable names, concurrency, and the stage/job/task outline. Secret values, parameters, and raw definitions are never displayed.", kind: "inspect", fields: [] },
    { id: "rename", label: "Rename pipeline or change description", description: "Change the pipeline's name or description while preserving its definition, sources, variables, triggers, schedules, and run history.", kind: "update", fields: [nameField, descriptionField], impact: "The pipeline keeps its configuration and run history. Automation referencing the old name must be updated separately." },
    { id: "disable-triggers", label: "Disable automatic triggers", description: "Turn off every configured code-event trigger and schedule. Manual runs remain available.", kind: "update", fields: [], confirmation: true, impact: "Automatic code-event and scheduled runs stop until re-enabled. Manual runs remain available." },
    { id: "enable-triggers", label: "Enable automatic triggers", description: "Turn on the pipeline's existing code-event triggers and schedules. New triggers cannot be configured here.", kind: "update", fields: [], confirmation: true, impact: "The pipeline will run automatically on its configured code events and schedules. Automatic runs execute remote code, can deploy with saved credentials, and can incur charges." },
    { id: "run", label: "Run pipeline now", description: "Start a manual run with the pipeline's saved configuration and variables.", kind: "action", fields: [], confirmation: true, impact: "This run executes the pipeline's configured tasks remotely. It can deploy with saved credentials and incur charges. Work already performed is kept if the run is stopped." },
    { id: "stop", label: stopRunLabel, description: "Stop one initializing, queued, running, paused, or suspended run of this pipeline.", kind: "action", fields: [{ key: "run", label: "Run", type: "select", required: true, source: "activeRuns" }], confirmation: true, impact: "The selected run stops. Work already performed may be committed or billed." },
    { id: "runs", label: "View run history", description: "List this pipeline's native run records with status, trigger, executor, and times. Build parameters and artifacts are never displayed.", kind: "inspect", fields: [] },
    { id: "run-status", label: "View run detail", description: "Inspect one run's status and its stage, job, and step outline. Step inputs, messages, and log values are never displayed.", kind: "inspect", fields: [{ key: "run", label: "Run", type: "select", required: true, source: "runs" }] },
    { id: "delete", label: "Delete inactive pipeline", description: "Permanently delete a pipeline only after every run has finished. Deletion is blocked while any run is initializing, queued, running, paused, or suspended.", kind: "delete", fields: [], confirmation: true, impact: "The pipeline and its run history are permanently deleted. This is blocked while a run is initializing, queued, running, paused, or suspended." },
  ],
  inventory: async s => {
    const workspaces = await listCodeArtsProjects(s);
    const loads = await Promise.allSettled(workspaces.map(workspace => pipelines(s, workspace.id, workspace.name)));
    return finishCloudLoad(loads, loads.flatMap(load => settledValue(load, [])), workspaces.map(workspace => workspace.name));
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [workspaces, templateRows] = await Promise.all([listCodeArtsProjects(s), templates(s)]);
      const sources = (await Promise.all(workspaces.map(async workspace => {
        const scope = { ...s, projectId: workspace.id };
        return (await Promise.all((await ownedRepositories(scope)).filter(repo => repo.archived === false).map(async repo => (await ownedBranches(scope, String(repo.id))).map(branch => ({ value: JSON.stringify({ workspace: workspace.id, repository: String(repo.id), branch: String(branch.name) }), label: `${workspace.name} · ${String(repo.name)} · ${String(branch.name)}` }))))).flat();
      }))).flat();
      return {
        sources,
        workspaces: workspaces.map(workspace => ({ value: workspace.id, label: workspace.name })),
        templates: templateRows.map(template => ({ value: asString(template.id).toLowerCase(), label: `${asString(template.name)} · ${template.is_system === true ? "system" : "custom"} template` })),
      };
    }
    if (!resource) return {};
    const ref = parseRef(resource);
    await liveWorkspace(s, ref.workspaceId);
    if (operation === "stop" || operation === "run-status") {
      const history = await runs(s, ref.workspaceId, ref.pipelineId);
      const toChoice = (run: Record<string, unknown>): ManagementChoice => ({ value: asString(run.pipeline_run_id).toLowerCase(), label: `Run #${runNumber(run)} · ${asString(run.status, "UNKNOWN")}` });
      if (operation === "stop") return { activeRuns: history.filter(run => activeStatuses.includes(asString(run.status, "").toUpperCase())).map(toChoice) };
      return { runs: history.map(toChoice) };
    }
    return {};
  },
  poll: async (s, entry) => {
    if (!entry.resourceId || !entry.jobId || !nativeId.test(entry.jobId)) throw new ManagementInputError("This operation has no pipeline run to track.");
    const ref = parseRef({ id: entry.resourceId, name: entry.resourceName ?? entry.resourceId });
    await liveWorkspace(s, ref.workspaceId);
    const detail = asRecord(await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${ref.workspaceId}/api/pipelines/${ref.pipelineId}/pipeline-runs/detail?${new URLSearchParams({ pipeline_run_id: entry.jobId })}`));
    if (asString(detail.pipeline_id, "").toLowerCase() !== ref.pipelineId || asString(detail.id, "").toLowerCase() !== entry.jobId.toLowerCase()) throw new ManagementInputError("The tracked run no longer matches this pipeline.", 409);
    const status = asString(detail.status, "").toUpperCase();
    if (status === "COMPLETED") return { state: "succeeded", message: "The pipeline run completed.", resourceId: entry.resourceId };
    if (status === "CANCELED" && entry.operation === stopRunLabel) return { state: "succeeded", message: "The pipeline run was stopped.", resourceId: entry.resourceId };
    if (failedStatuses.includes(status)) return { state: "failed", message: `The pipeline run ended with status ${status}.`, resourceId: entry.resourceId };
    return { state: "submitted", message: `The pipeline run is ${status.toLowerCase() || "in progress"}.`, resourceId: entry.resourceId };
  },
  execute: async (s, operation, v, resource) => {
    if (operation === "create") {
      const workspaceId = String(v.workspace).toLowerCase();
      const workspace = (await listCodeArtsProjects(s)).find(project => project.id === workspaceId);
      if (!workspace) throw new ManagementInputError("Select a current developer workspace.", 404);
      const templateId = String(v.template).toLowerCase();
      const template = (await templates(s)).find(row => asString(row.id).toLowerCase() === templateId);
      if (!template) throw new ManagementInputError("Select a current pipeline template.", 404);
      const selected = await verifiedSource(s, String(v.source));
      if (selected.workspaceId !== workspaceId) throw new ManagementInputError("The selected code source belongs to another developer workspace.", 409);
      const tenant = await tenantId(s);
      const nativeTemplate = asRecord(await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${tenant}/api/pipeline-templates/${templateId}`));
      if (nativeTemplate.id !== templateId || nativeTemplate.is_system !== true || typeof nativeTemplate.definition !== "string") throw new ManagementInputError("The official template's current identity and definition could not be verified.", 409);
      let definition: Record<string, unknown>;
      try { definition = asRecord(JSON.parse(nativeTemplate.definition)); } catch { throw new ManagementInputError("The selected template has no verified native pipeline definition.", 409); }
      if (!asArray(definition.stages).length) throw new ManagementInputError("The selected template has no verified native stages.", 409);
      const variables = asArray(nativeTemplate.variables).map(asRecord);
      if (variables.some(variable => variable.is_secret === true || variable.is_runtime === true || typeof variable.value !== "string")) throw new ManagementInputError("This template requires secret or runtime inputs. Configure those through its native template workflow.", 409);
      const response = asRecord(await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${workspaceId}/api/pipelines`, { method: "POST", body: JSON.stringify({ name: String(v.name), ...(v.description !== undefined ? { description: String(v.description) } : {}), is_publish: false, sources: [selected.source], definition: nativeTemplate.definition, manifest_version: String(nativeTemplate.manifest_version ?? "3.0"), variables, schedules: [], triggers: [] }) }));
      const pipelineId = asString(response.pipeline_id, "").toLowerCase();
      if (!nativeId.test(pipelineId)) throw new Error("Huawei returned no verified pipeline ID after creation. Check the workspace before retrying.");
      return { message: `Pipeline created from official template "${asString(template.name)}" in workspace "${workspace.name}" with the selected repository branch and automatic triggers disabled. Review its task configuration before a manual run.`, resourceId: `${workspaceId}/${pipelineId}` };
    }
    const current = await livePipeline(s, resource);
    if (operation === "inspect") return { message: "Current pipeline configuration. Secret values, parameters, and raw definitions are omitted.", facts: inspectFacts(current.detail), resourceId: current.resourceId };
    if (operation === "rename") {
      await savePipeline(s, current.workspaceId, current.pipelineId, current.detail, { name: String(v.name), ...(v.description !== undefined ? { description: String(v.description) } : {}) });
      return { message: "Pipeline name and description updated. Supported native configuration and run history are preserved.", resourceId: current.resourceId };
    }
    if (operation === "disable-triggers" || operation === "enable-triggers") {
      const enable = operation === "enable-triggers";
      const hasTriggers = asArray(current.detail.triggers).some(trigger => asArray(asRecord(trigger).events).length) || asArray(current.detail.schedules).length > 0;
      if (!hasTriggers) throw new ManagementInputError(enable ? "This pipeline has no automatic triggers to enable. Configure code events or schedules in the CodeArts console first." : "This pipeline has no automatic triggers to disable.", 409);
      await savePipeline(s, current.workspaceId, current.pipelineId, current.detail, triggerChanges(current.detail, enable));
      return { message: enable ? "Automatic code-event and scheduled triggers enabled. The pipeline can now run automatically." : "Automatic code-event and scheduled triggers disabled. Manual runs remain available.", resourceId: current.resourceId };
    }
    if (operation === "run") {
      if (current.detail.banned !== false || current.detail.deleted === true) throw new ManagementInputError("The pipeline's enabled state could not be verified. Enable it in CodeArts Pipeline before running it.", 409);
      for (const source of asArray(current.detail.sources).map(asRecord)) {
        const params = asRecord(source.params);
        if (source.type === "code" && params.git_type === "codehub") {
          if (!(await ownedBranches({ ...s, projectId: current.workspaceId }, String(params.codehub_id))).some(branch => branch.name === params.default_branch)) throw new ManagementInputError("The pipeline's configured CodeArts branch no longer exists in this workspace.", 409);
        }
      }
      const response = asRecord(await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${current.workspaceId}/api/pipelines/${current.pipelineId}/run`, { method: "POST", body: JSON.stringify({}) }));
      if (response.error_msg || response.error_code) throw new ManagementInputError("Huawei rejected this pipeline run. Inspect its native configuration before retrying.", 409);
      const runId = asString(response.pipeline_run_id, "").toLowerCase();
      if (!nativeId.test(runId)) throw new Error("Huawei returned no pipeline run ID. Check the pipeline's run history before retrying.");
      return { message: "Pipeline run started. It executes configured tasks remotely and can deploy with saved credentials.", jobId: runId, asynchronous: true, resourceId: current.resourceId };
    }
    if (operation === "stop") {
      const runId = String(v.run).toLowerCase();
      const active = (await runs(s, current.workspaceId, current.pipelineId)).filter(run => activeStatuses.includes(asString(run.status, "").toUpperCase()));
      if (!active.some(run => asString(run.pipeline_run_id, "").toLowerCase() === runId)) throw new ManagementInputError("Select a current initializing, queued, running, paused, or suspended run.", 404);
      const response = asRecord(await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${current.workspaceId}/api/pipelines/${current.pipelineId}/pipeline-runs/${runId}/stop`, { method: "POST" }));
      if (response.success !== true) throw new Error("Huawei did not confirm the run stop. Check the run status before retrying.");
      return { message: "Pipeline run stop submitted.", jobId: runId, asynchronous: true, resourceId: current.resourceId };
    }
    if (operation === "runs") {
      const history = await runs(s, current.workspaceId, current.pipelineId);
      return { message: `Pipeline run history (${history.length} runs; first ${Math.min(history.length, 20)} shown). Build parameters and artifacts are omitted.`, facts: runHistoryFacts(history), resourceId: current.resourceId };
    }
    if (operation === "run-status") {
      const runId = String(v.run).toLowerCase();
      if (!(await runs(s, current.workspaceId, current.pipelineId)).some(run => asString(run.pipeline_run_id, "").toLowerCase() === runId)) throw new ManagementInputError("Select a current run of this pipeline.", 404);
      return { message: "Run detail. Step inputs, messages, and log values are omitted.", facts: runDetailFacts(await runDetail(s, current.workspaceId, current.pipelineId, runId)), resourceId: current.resourceId };
    }
    if (operation === "delete") {
      const latest = await latestRunStatus(s, current.workspaceId, current.pipelineId);
      const latestStatus = latest ? asString(latest.status, "").toUpperCase() : "";
      if (latestStatus && !inactiveStatuses.includes(latestStatus)) throw new ManagementInputError(`The pipeline's latest run status is ${latestStatus}. Deletion requires an inactive pipeline; stop its runs first.`, 409);
      const history = await runs(s, current.workspaceId, current.pipelineId);
      if (!latest && history.length) throw new ManagementInputError("The pipeline's latest run state could not be verified.", 409);
      const active = history.filter(run => !inactiveStatuses.includes(asString(run.status, "").toUpperCase()));
      if (active.length) throw new ManagementInputError(`The pipeline still has ${active.length} initializing, queued, running, paused, or suspended run(s). Stop them before deleting.`, 409);
      const response = asRecord(await huaweiFetch<unknown>(s, "codeartspipeline", `/v5/${current.workspaceId}/api/pipelines/${current.pipelineId}`, { method: "DELETE" }));
      if (asString(response.pipeline_id, "").toLowerCase() !== current.pipelineId) throw new Error("Huawei returned no verified pipeline deletion confirmation. Check the pipeline before retrying.");
      return { message: "Inactive pipeline deleted.", resourceId: current.resourceId };
    }
    throw new ManagementInputError("Unsupported CodeArts Pipeline operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listCodeArtsPipelines],
};
