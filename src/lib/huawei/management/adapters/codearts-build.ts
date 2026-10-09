import "server-only";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiArrayList, huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listCodeArtsProjects, loadAcrossCodeArtsProjects } from "@/lib/huawei/codearts-projects";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

// Native current v1 task and record APIs; the old v3 task APIs are deprecated.
// UpdateNewJob documentation includes fields missing from older generated SDK models:
// https://support.huaweicloud.com/intl/en-us/api-codeci/UpdateNewJob.html
// CodeArts workspace IDs are developer project IDs; IAM regional project IDs are never used as them.

const jobName: ManagementField = { key: "name", label: "Job name", required: true, min: 1, max: 115, pattern: "^[A-Za-z0-9_-]+$" };
const newJobName: ManagementField = { ...jobName, label: "New job name" };
const branch: ManagementField = { key: "branch", label: "Branch", type: "select", source: "branches", required: true };
const sourceField: ManagementField = { key: "source", label: "Workspace / repository / branch", type: "select", source: "sources", required: true, max: 1024 };
const templateField: ManagementField = { key: "template", label: "Official build template", type: "select", source: "templates", required: true, help: "The job's build steps are copied verbatim from this verified native template." };
const runImpact = "Running this build executes the repository's code on Huawei's build infrastructure using the job's configured credentials and can incur build charges. Results and artifacts are produced by the fetched code.";

/** List build jobs of one CodeArts workspace through the native v1 job list. */
async function listJobsForWorkspace(scope: HuaweiProjectSession) {
  const body = await huaweiList<Record<string, unknown>>(scope, "codeartsbuild", `/v1/job/${encodeURIComponent(scope.projectId)}/list?page_size=100`, { items: ["jobs"], kind: "page", parameter: "page_index", size: 100, first: 0, total: ["total"] });
  return asArray(body.jobs).map(asRecord).filter(job => typeof job.id === "string" && !!job.id);
}

/** List the repositories owned by one CodeArts workspace through the native v4 project list. */
async function listRepositoriesForWorkspace(scope: HuaweiProjectSession) {
  return huaweiArrayList<Record<string, unknown>>(scope, "codeartsrepo", `/v4/projects/${encodeURIComponent(scope.projectId)}/repositories?limit=100&order_by=updated_at&sort=desc`, { kind: "offset", parameter: "offset", size: 100 });
}
async function repositoryBranches(scope: HuaweiProjectSession, repoId: string) {
  if (!(await listRepositoriesForWorkspace(scope)).some(repo => String(repo.id) === repoId)) throw new ManagementInputError("The configured repository no longer belongs to this developer workspace.", 409);
  const repo = await huaweiFetch<Record<string, unknown>>(scope, "codeartsrepo", `/v4/repositories/${encodeURIComponent(repoId)}`);
  if (String(repo.id) !== repoId || repo.project_id !== scope.projectId || repo.archived !== false) throw new ManagementInputError("The repository's current workspace and writable state could not be verified.", 409);
  return huaweiArrayList<Record<string, unknown>>(scope, "codeartsrepo", `/v4/repositories/${encodeURIComponent(repoId)}/repository/branches?limit=100&offset=0`, { kind: "offset", parameter: "offset", size: 100 });
}

/** Official templates carry the verified native steps and parameters used to create deployable jobs. */
async function officialTemplates(s: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(s, "codeartsbuild", "/v1/template/officialtemplates?page_size=100", { items: ["result.items"], kind: "page", parameter: "page", size: 100, first: 1, total: ["result.total_size"] });
  confirmed(body, "loading official templates");
  return asArray(asRecord(body.result).items).map(asRecord).filter(template => typeof template.uuid === "string" && !!template.uuid);
}

function selectedJob(resource?: ManagementResource) {
  const parts = (resource?.id ?? "").split(":");
  const jobId = parts.slice(2).join(":");
  if (parts[0] !== "job" || parts.length !== 3 || !/^[a-f0-9]{32}$/i.test(parts[1] ?? "") || !/^[A-Za-z0-9]{32}$/.test(jobId)) throw new ManagementInputError("Select a CodeArts build job.");
  return { workspaceId: parts[1], jobId };
}

/** Re-verify current workspace ownership immediately before any mutation. */
async function currentJob(s: BetterUiSession, resource: ManagementResource) {
  const { workspaceId, jobId } = selectedJob(resource);
  if (!(await listCodeArtsProjects(s)).some(w => w.id === workspaceId)) throw new ManagementInputError("The build job's developer workspace is no longer accessible.", 404);
  const job = (await listJobsForWorkspace({ ...s, projectId: workspaceId })).find(job => job.id === jobId);
  if (!job) throw new ManagementInputError("The selected build job no longer exists in its CodeArts workspace.", 404);
  await jobConfig(s, workspaceId, jobId);
  return { workspaceId, jobId, job };
}

async function write(s: BetterUiSession, path: string, method: string, body?: unknown) {
  return huaweiFetch<Record<string, unknown>>(s, "codeartsbuild", path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

/** Native 200 responses still report rejection through their status and error fields. */
function confirmed(body: Record<string, unknown>, action: string) {
  if (body.status === undefined) throw new Error(`Huawei returned no confirmation status for ${action}.`);
  const status = String(body.status).toLowerCase();
  // Native error objects may contain private configuration; never echo their contents.
  const hasError = body.error !== undefined && body.error !== null && body.error !== "";
  if (status !== "success" || hasError) throw new ManagementInputError(`Huawei rejected ${action}.`, 409);
}

async function jobConfig(s: BetterUiSession, workspaceId: string, jobId: string) {
  const body = await huaweiFetch<Record<string, unknown>>(s, "codeartsbuild", `/v1/job/${encodeURIComponent(jobId)}/config?get_all_params=true`);
  confirmed(body, "loading this job's configuration");
  const config = asRecord(body.result);
  if (!Object.keys(config).length) throw new Error("Huawei returned no build job configuration.");
  if (config.project_id !== workspaceId || config.job_id !== jobId) throw new ManagementInputError("Huawei returned no verified configuration for this CodeArts workspace and job.", 404);
  return config;
}

function running(job: Record<string, unknown>) {
  if (typeof job.is_finished !== "boolean") throw new ManagementInputError("The job's current idle/running state could not be verified.", 409);
  return !job.is_finished;
}

async function historyRecords(s: BetterUiSession, jobId: string, limit: number) {
  const body = await huaweiFetch<Record<string, unknown>>(s, "codeartsbuild", `/v1/record/${encodeURIComponent(jobId)}/list?page_index=0&page_size=${limit}`);
  confirmed(body, "loading build history");
  if (!Array.isArray(asRecord(body.result).job_build_states)) throw new Error("Huawei returned no verifiable build history.");
  return asArray(asRecord(body.result).job_build_states).map(asRecord);
}
async function record(s: BetterUiSession, workspaceId: string, jobId: string, number: string) {
  if (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number))) throw new ManagementInputError("This request has no verified build run number.", 409);
  const body = await huaweiFetch<Record<string, unknown>>(s, "codeartsbuild", `/v1/record/${encodeURIComponent(jobId)}/${encodeURIComponent(number)}/record-info`);
  confirmed(body, "loading this build record");
  const result = asRecord(body.result);
  if (result.codeci_job_id !== jobId || result.devcloud_project_id !== workspaceId || String(result.build_no) !== number) throw new ManagementInputError("The native build record's job, workspace, and run number could not be verified.", 409);
  return result;
}
async function verifySources(scope: HuaweiProjectSession, config: Record<string, unknown>, editedBranch?: string) {
  const scms = asArray(config.scms).map(asRecord);
  if (!scms.length) throw new ManagementInputError("This build has no verified branch-based repository source.", 409);
  for (const [index, scm] of scms.entries()) {
    if (!/^(repo|codehub)$/i.test(String(scm.scm_type)) || (scm.build_type !== undefined && scm.build_type !== "branch")) throw new ManagementInputError("This workflow supports current CodeArts repository branches; other source types require their native configuration workflow.", 409);
    const branch = index === 0 && editedBranch !== undefined ? editedBranch : scm.branch;
    if (!(await repositoryBranches(scope, String(scm.repo_id))).some(r => r.name === branch)) throw new ManagementInputError("The configured repository branch no longer exists in this developer workspace.", 409);
  }
}

/** Preserve the current documented v1 configuration, including settings absent in older SDKs. */
function updateBody(config: Record<string, unknown>, workspaceId: string, jobId: string, changes: { jobName?: string; branch?: string }) {
  for (const parameter of asArray(config.parameters).map(asRecord)) {
    const params = asArray(parameter.params).map(asRecord);
    if (params.some(param => param.name === "sensitiveVar" && String(param.value) === "true")) throw new ManagementInputError("This job contains sensitive parameters whose values cannot be safely round-tripped. Edit its configuration in CodeArts Build.", 409);
  }
  const scmKeys = ["branch", "url", "repo_id", "web_url", "scm_type", "is_auto_build", "enable_git_lfs", "build_type", "depth", "end_point_id", "source", "group_name", "repo_name"];
  let scms = asArray(config.scms).map(asRecord).map(scm => Object.fromEntries(scmKeys.filter(key => scm[key] !== undefined && scm[key] !== null).map(key => [key, scm[key]])));
  if (changes.branch !== undefined) {
    if (!scms.length || typeof scms[0].branch !== "string" || !scms[0].branch) throw new ManagementInputError("This job's primary code source is not branch-based.", 409);
    scms = [{ ...scms[0], branch: changes.branch }, ...scms.slice(1)];
  }
  const steps = asArray(config.steps);
  if (!steps.length) throw new Error("Huawei returned no build steps to preserve.");
  const name = changes.jobName ?? config.job_name;
  if (typeof name !== "string" || !name) throw new Error("Huawei returned no job name to preserve.");
  const body: Record<string, unknown> = { project_id: workspaceId, job_id: jobId, job_name: name, steps };
  for (const key of ["arch", "auto_update_sub_module", "flavor", "host_type", "build_config_type", "source_code", "description", "agency_urn", "group_id", "timeout", "triggers", "resource_limit", "code_checkout_config"]) if (config[key] !== undefined) body[key] = config[key];
  const parameters = asArray(config.parameters);
  if (parameters.length) body.parameters = parameters;
  if (scms.length) body.scms = scms;
  return body;
}

const fact = (label: string, value: unknown) => ({ label, value: typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "-" });
const list = (values: unknown[]) => (values.length ? values.join(", ") : "-");

export const codeartsBuildManagement: ManagementAdapter = {
  title: "CodeArts Build Jobs",
  operations: [
    { id: "create-job", label: "Create build job", kind: "create", description: "Create a job from a current repository branch and official template with automatic triggers disabled, then request job disabling. Check the returned disabling result before use.", fields: [newJobName, sourceField, templateField] },
    { id: "inspect", label: "View job configuration", kind: "inspect", description: "Inspect whitelisted job metadata and configuration. Parameter values, step commands, and credentials are never displayed.", fields: [] },
    { id: "history", label: "View latest run history", kind: "inspect", description: "List the job's most recent native build records with their completion results.", fields: [] },
    { id: "rename", label: "Rename build job", kind: "update", description: "Change only the job name, preserving the code source, parameters, and every build step.", fields: [newJobName] },
    { id: "update-branch", label: "Edit build branch", kind: "update", description: "Change only the branch of the job's primary code source, preserving the repository, parameters, and every build step.", fields: [branch] },
    { id: "run", label: "Run build job", kind: "action", description: "Execute the job's current configuration once. Follow progress in the run history.", fields: [], allowedStatuses: ["Available"], impact: runImpact },
    { id: "stop", label: "Stop current run", kind: "action", description: "Stop only the job's currently running build. Finished runs are never touched.", fields: [], impact: "The current build run is cancelled; its in-progress work is discarded and partial artifacts may remain." },
    { id: "disable", label: "Disable build job", kind: "action", description: "Disable the job so it cannot be executed or triggered.", fields: [], allowedStatuses: ["Available"], confirmation: true, impact: "A disabled job cannot run until it is recovered. Pipelines or triggers depending on it stop working." },
    { id: "recover", label: "Recover build job", kind: "action", description: "Recover a disabled job so it can be executed again.", fields: [], allowedStatuses: ["Disabled"], impact: "The job can be executed again and any configured automatic triggers can fire." },
    { id: "delete", label: "Delete inactive build job", kind: "delete", description: "Permanently delete a job that is not currently running.", fields: [], confirmation: true, impact: "The build job and its configuration are permanently removed. Dependent pipelines stop working and its build records are no longer reachable through this job." },
  ],
  inventory: async s => loadAcrossCodeArtsProjects(s, async scope => {
    const jobs = await listJobsForWorkspace(scope);
    return jobs.map(job => ({
      id: `job:${scope.projectId}:${String(job.id)}`,
      name: asString(job.job_name, String(job.id)),
      status: job.disabled === true ? "Disabled" : job.disabled === false ? "Available" : "Unverified",
      values: {
        name: asString(job.job_name, String(job.id)),
        workspace: scope.projectName,
        repository: firstString([job.scm_web_url, job.repo_id]),
        lastBuildStatus: firstString([job.last_build_status, job.last_job_running_status]),
        triggerType: asString(job.trigger_type, "-"),
        creator: firstString([job.job_creator, job.user_name]),
      },
    }));
  }),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "update-branch" && resource) {
      const { workspaceId, jobId } = await currentJob(s, resource);
      const config = await jobConfig(s, workspaceId, jobId), scm = asRecord(asArray(config.scms)[0]);
      if (!/^(repo|codehub)$/i.test(String(scm.scm_type)) || (scm.build_type !== undefined && scm.build_type !== "branch")) return { branches: [] };
      return { branches: (await repositoryBranches({ ...s, projectId: workspaceId }, String(scm.repo_id))).map(row => ({ value: String(row.name), label: String(row.name) })) };
    }
    if (operation !== "create-job") return {};
    const workspaces = await listCodeArtsProjects(s);
    const [sources, templates] = await Promise.all([
      Promise.all(workspaces.map(async workspace => {
        const scope = { ...s, projectId: workspace.id };
        const repositories = await listRepositoriesForWorkspace(scope);
        return (await Promise.all(repositories.filter(repo => repo.archived === false && Number.isSafeInteger(repo.id) && Number(repo.id) > 0).map(async repo => (await repositoryBranches(scope, String(repo.id))).filter(row => typeof row.name === "string" && row.name).map(row => ({ value: JSON.stringify({ workspace: workspace.id, repository: String(repo.id), branch: row.name }), label: `${workspace.name} · ${String(repo.name)} · ${String(row.name)}` }))))).flat();
      })),
      officialTemplates(s).then(rows => rows.filter(template => asArray(asRecord(template.template).steps).length).map(template => ({ value: String(template.uuid), label: `${asString(template.name)} · ${asString(template.language, "general")}` }))),
    ]);
    return {
      sources: sources.flat(),
      templates,
    };
  },
  execute: async (s, operation, v, resource) => {
    if (operation === "create-job") {
      let source: Record<string, unknown>;
      try { source = asRecord(JSON.parse(String(v.source))); } catch { throw new ManagementInputError("Choose a current workspace, repository, and branch."); }
      if (typeof source.workspace !== "string" || typeof source.repository !== "string" || typeof source.branch !== "string") throw new ManagementInputError("Choose a current workspace, repository, and branch.");
      const workspaceId = source.workspace;
      if (!(await listCodeArtsProjects(s)).some(workspace => workspace.id === workspaceId)) throw new ManagementInputError("The selected CodeArts workspace is no longer available.", 404);
      const repositoryId = source.repository;
      const repository = (await listRepositoriesForWorkspace({ ...s, projectId: workspaceId })).find(repository => String(repository.id) === repositoryId);
      if (!repository) throw new ManagementInputError("The selected repository is no longer available in this workspace.", 404);
      if (!(await repositoryBranches({ ...s, projectId: workspaceId }, repositoryId)).some(row => row.name === source.branch)) throw new ManagementInputError("The selected repository branch no longer exists.", 409);
      const template = (await officialTemplates(s)).find(template => template.uuid === v.template);
      if (!template) throw new ManagementInputError("The selected build template is no longer available.", 404);
      const steps = asArray(asRecord(template.template).steps);
      if (!steps.length) throw new ManagementInputError("The selected template has no verified native build steps.", 409);
      const url = firstString([repository.https_url, repository.http_url_to_repo, repository.web_url, repository.url], "");
      if (!url) throw new ManagementInputError("Huawei returned no repository URL for this build source.", 409);
      const parameters = asArray(template.parameters);
      const created = await write(s, "/v1/job/create", "POST", {
        project_id: workspaceId,
        job_name: v.name,
        scms: [{ branch: source.branch, url, repo_id: String(repository.id), scm_type: "repo", is_auto_build: false, enable_git_lfs: false, build_type: "branch" }],
        steps,
        build_config_type: "ACTION",
        triggers: [],
        build_if_code_updated: false,
        ...(parameters.length ? { parameters } : {}),
      });
      confirmed(created, "creating this build job");
      const jobId = asRecord(created.result).job_id;
      if (typeof jobId !== "string" || !/^[A-Za-z0-9]{32}$/.test(jobId)) throw new Error("Huawei returned no verifiable build job ID.");
      let warning = "";
      try {
        const disabled = await write(s, `/v1/job/${encodeURIComponent(jobId)}/disable`, "POST", { disabled: true, reason: "Created through BetterUI; manual recovery required before execution." });
        confirmed(disabled, "disabling the newly created build job");
      } catch { warning = " Huawei did not confirm the disable request; the job still has no automatic triggers, but verify its state before running it."; }
      return { message: `Build job created with no automatic triggers, building branch ${source.branch} of ${asString(repository.name)}.${warning || " Job disabling was confirmed; recover it before execution."}`, resourceId: `job:${workspaceId}:${jobId}` };
    }
    const { workspaceId, jobId, job } = await currentJob(s, resource!);
    const scope = { ...s, projectId: workspaceId };
    if (operation === "inspect") {
      const config = await jobConfig(scope, workspaceId, jobId);
      const scm = asRecord(asArray(config.scms).map(asRecord)[0]);
      const timeout = asRecord(config.timeout);
      const facts = [
        fact("CodeArts workspace", workspaceId),
        fact("job name", config.job_name ?? job.job_name),
        fact("disabled", job.disabled),
        fact("last build status", firstString([job.last_build_status, job.last_job_running_status])),
        fact("trigger type", job.trigger_type),
        fact("creator", firstString([job.job_creator, job.user_name])),
        fact("repository", firstString([job.scm_web_url, scm.url, job.repo_id])),
        fact("source type", scm.scm_type),
        fact("source branch", scm.branch),
        fact("arch", config.arch),
        fact("flavor", config.flavor),
        fact("host type", config.host_type),
        fact("build config type", config.build_config_type),
        fact("auto update submodules", config.auto_update_sub_module),
        fact("timeout", timeout.limit === undefined ? undefined : `${asString(timeout.limit)} ${asString(timeout.unit, "")}`.trim()),
        fact("parameters", list(asArray(config.parameters).map(parameter => asRecord(parameter).name).filter(name => typeof name === "string" && !!name))),
        fact("build steps", list(asArray(config.steps).map(step => asRecord(step).name).filter(name => typeof name === "string" && !!name))),
        fact("triggers", list(asArray(config.triggers).map(trigger => asRecord(trigger).name).filter(name => typeof name === "string" && !!name))),
      ];
      return { message: "Current CodeArts build job configuration. Parameter values, step commands, and credentials are not displayed.", facts };
    }
    if (operation === "history") {
      const records = await historyRecords(scope, jobId, 10);
      return {
        message: `Latest ${records.length} native build record${records.length === 1 ? "" : "s"}.`,
        facts: records.map(record => {
          const date = new Date(Number(record.start_time));
          const time = record.start_time !== undefined && record.start_time !== null && Number.isFinite(date.getTime()) ? date.toISOString() : "-";
          return fact(`Run #${record.number ?? "-"}`, `${asString(record.state, "unknown")} · ${asString(record.job_running_status, "unknown")} · ${time}`);
        }),
      };
    }
    if (operation === "rename") {
      if (running(job)) throw new ManagementInputError("Wait for the current build to finish before editing its configuration.", 409);
      const config = await jobConfig(scope, workspaceId, jobId);
      const result = await write(scope, "/v1/job/update", "POST", updateBody(config, workspaceId, jobId, { jobName: String(v.name) }));
      confirmed(result, "renaming this build job");
      if (asRecord(result.result).job_id !== jobId) throw new Error("Huawei did not confirm updating the selected build job.");
      return { message: "Build job renamed without changing its build configuration." };
    }
    if (operation === "update-branch") {
      if (running(job)) throw new ManagementInputError("Wait for the current build to finish before editing its configuration.", 409);
      const config = await jobConfig(scope, workspaceId, jobId);
      await verifySources(scope, config, String(v.branch));
      const result = await write(scope, "/v1/job/update", "POST", updateBody(config, workspaceId, jobId, { branch: String(v.branch) }));
      confirmed(result, "changing this job's build branch");
      if (asRecord(result.result).job_id !== jobId) throw new Error("Huawei did not confirm updating the selected build job.");
      return { message: "Build branch updated; the repository, parameters, and build steps were preserved." };
    }
    if (operation === "run") {
      if (job.disabled !== false) throw new ManagementInputError("Recover this disabled build job and verify its enabled state before running it.", 409);
      if (running(job)) throw new ManagementInputError("This build job is already running. Stop the current run before starting another.", 409);
      await verifySources(scope, await jobConfig(scope, workspaceId, jobId));
      const result = await write(scope, "/v1/job/execute", "POST", { job_id: jobId });
      const buildNumber = result.actual_build_number;
      if (!/^[1-9]\d*$/.test(String(buildNumber)) || !Number.isSafeInteger(Number(buildNumber))) throw new Error("Huawei returned no verifiable build number for this run.");
      return { message: `Build run #${buildNumber} started. Execution uses the job's configured credentials and can incur build charges.`, resourceId: resource!.id, jobId: `${workspaceId}:${jobId}:${buildNumber}`, asynchronous: true };
    }
    if (operation === "stop") {
      if (!running(job)) throw new ManagementInputError("This build job is not currently running.", 409);
      const current = (await historyRecords(scope, jobId, 1))[0];
      const buildNumber = current?.number;
      if (buildNumber === undefined || buildNumber === null || String(buildNumber) === "") throw new ManagementInputError("Huawei reported a running job without a current build number.", 409);
      const detail = await record(scope, workspaceId, jobId, String(buildNumber));
      if (!["RUNNING", "STARTING", "QUEUED", "WAITING"].includes(String(detail.status).toUpperCase())) throw new ManagementInputError("The latest build is already finished or its running state is unverified.", 409);
      confirmed(await write(scope, `/v1/job/${encodeURIComponent(jobId)}/stop?build_no=${encodeURIComponent(String(buildNumber))}`, "POST"), `stopping run #${buildNumber}`);
      return { message: `Stop request accepted for the current run #${buildNumber}.`, resourceId: resource!.id, jobId: `${workspaceId}:${jobId}:${buildNumber}`, asynchronous: true };
    }
    if (operation === "disable") {
      if (job.disabled !== false) throw new ManagementInputError("This build job is already disabled or its enabled state could not be verified.", 409);
      confirmed(await write(scope, `/v1/job/${encodeURIComponent(jobId)}/disable`, "POST", { disabled: true, reason: "Disabled through BetterUI." }), "disabling this build job");
      return { message: "Build job disabled. It cannot be executed or triggered until it is recovered." };
    }
    if (operation === "recover") {
      if (job.disabled !== true) throw new ManagementInputError("This build job is not disabled.", 409);
      confirmed(await write(scope, `/v1/job/${encodeURIComponent(jobId)}/disable`, "POST", { disabled: false, reason: "Recovered through BetterUI." }), "recovering this build job");
      return { message: "Build job recovered. It can be executed again." };
    }
    if (operation === "delete") {
      if (running(job)) throw new ManagementInputError("Stop the current build run before deleting this job.", 409);
      const result = await write(scope, `/v1/job/${encodeURIComponent(jobId)}/delete`, "DELETE");
      confirmed(result, "deleting this build job");
      const deleted = asRecord(result.result);
      if (typeof deleted.job_id !== "string" || !deleted.job_id) throw new Error("Huawei returned no verifiable deletion confirmation for this build job.");
      if (deleted.job_id !== jobId || (deleted.project_id !== undefined && deleted.project_id !== workspaceId)) throw new ManagementInputError("Huawei deleted a different build job or workspace than the selected one.", 409);
      return { message: "Build job deleted." };
    }
    throw new ManagementInputError("Unsupported CodeArts Build operation.");
  },
  poll: async (s, entry) => {
    if (!entry.resourceId) throw new ManagementInputError("This request has no verified build job to check.");
    const { workspaceId, jobId } = selectedJob({ id: entry.resourceId, name: entry.resourceName ?? entry.resourceId });
    const parts = String(entry.jobId ?? "").split(":");
    const buildNumber = parts.slice(2).join(":");
    if (parts[0] !== workspaceId || parts[1] !== jobId || !buildNumber) throw new ManagementInputError("This request has no verified build run to check.");
    if (!(await listCodeArtsProjects(s)).some(w => w.id === workspaceId)) throw new ManagementInputError("The build run's developer workspace is no longer accessible.", 404);
    const detail = await record(s, workspaceId, jobId, buildNumber);
    const status = String(detail.status).toUpperCase();
    if (status === "SUCCESS") return { state: "succeeded", message: `Build run #${buildNumber} completed successfully.` };
    if (["FAILURE", "FAILED", "ABORTED", "TIMEOUT"].includes(status)) return { state: "failed", message: `Build run #${buildNumber} finished with result ${status}.` };
    return { state: "submitted", message: `Build run #${buildNumber} is ${status || "unverified"}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listCodeArtsBuildJobs],
};
