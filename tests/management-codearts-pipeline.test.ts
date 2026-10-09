import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { CloudLoadError } from "@/lib/huawei/errors";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementHistoryEntry } from "@/lib/management-contract";
import { codeartsPipelineManagement } from "@/lib/huawei/management/adapters/codearts-pipeline";
import { session as fixtureSession } from "./fixtures/session";

const session = { ...fixtureSession, accountToken: "test-account-token" };

const workspaceId = "11112222333344445555666677778888";
const pipelineId = "9999aaaabbbbccccdddd0000eeee1111";
const newPipelineId = "8888bbbbccccddddeeee0000ffff2222";
const runId = "7777abcdef0123456789abcdef012345";
const finishedRunId = "6666abcdef0123456789abcdef012345";
const foreignRunId = "1212abcdef0123456789abcdef012345";
const tenantId = "5555aaaa5555aaaa5555aaaa5555aaaa";
const templateId = "f".repeat(32);
const source = JSON.stringify({ workspace: workspaceId, repository: "123", branch: "master" });
const repo = { id: 123, name: "orders", project_id: workspaceId, archived: false, http_url_to_repo: "https://codehub.example/orders.git" };
const resource = { id: `${workspaceId}/${pipelineId}`, name: "Deploy service", status: "COMPLETED" };

const detail = () => ({
  id: pipelineId,
  project_id: workspaceId,
  name: "Deploy service",
  description: "Old description",
  manifest_version: "3.0",
  is_publish: false,
  banned: false,
  deleted: false,
  creator_name: "dev",
  create_time: 1700000000000,
  update_time: 1700000001000,
  group_name: "Default group",
  region: session.region,
  definition: JSON.stringify({ stages: [{ name: "Build", jobs: [{ name: "Build job", steps: [{ name: "Build step", task: "cloudbuild", inputs: [{ name: "password", value: "MUST-NOT-EXPOSE" }] }] }] }] }),
  sources: [{ type: "code", params: { alias: "repo", git_type: "codehub", default_branch: "master", web_url: "https://example.invalid/repo", codehub_id: "123" } }],
  variables: [{ name: "token", type: "string", value: "MUST-NOT-EXPOSE", latest_value: "MUST-NOT-EXPOSE", is_secret: false, is_runtime: false }],
  schedules: [{ name: "nightly", enable: true, type: "fixed", days_of_week: [1], time_zone: "UTC" }],
  triggers: [{ git_type: "codehub", git_url: "https://example.invalid/repo", events: [{ type: "Push", enable: true }], security_token: "MUST-NOT-EXPOSE", hook_id: "hook-1" }],
  concurrency_control: { enable: false, concurrency_number: 1, exceed_action: "QUEUE" },
});

const pipelineRow = () => ({ pipeline_id: pipelineId, name: "Deploy service", project_id: workspaceId, manifest_version: "3.0", create_time: 1700000000000, latest_run: { pipeline_run_id: finishedRunId, status: "COMPLETED", start_time: 1700000000000, end_time: 1700000050000 } });

const runRows = () => [
  { pipeline_id: pipelineId, pipeline_run_id: runId, status: "RUNNING", run_number: 12, trigger_type: "Manual", executor_name: "dev", start_time: 1700000100000, end_time: 0, build_params: { params: [{ name: "password", value: "MUST-NOT-EXPOSE" }] } },
  { pipeline_id: pipelineId, pipeline_run_id: finishedRunId, status: "COMPLETED", run_number: 11, trigger_type: "Manual", executor_name: "dev", start_time: 1700000000000, end_time: 1700000050000 },
];

const runDetailRow = () => ({
  id: runId,
  pipeline_id: pipelineId,
  status: "RUNNING",
  run_number: 12,
  trigger_type: "Manual",
  executor_name: "dev",
  start_time: 1700000100000,
  end_time: 0,
  stages: [{ name: "Build", status: "RUNNING", jobs: [{ name: "Build job", status: "RUNNING", steps: [{ name: "Build step", task: "cloudbuild", status: "COMPLETED", inputs: [{ name: "password", value: "MUST-NOT-EXPOSE" }], message: "MUST-NOT-EXPOSE" }] }] }],
});

function route(url: URL, method: string): unknown {
  const path = url.pathname;
  if (path === "/v4/projects") return { projects: [{ project_id: workspaceId, project_name: "Workspace One" }], total: 1 };
  if (path === `/v4/projects/${workspaceId}/repositories`) return [repo];
  if (path === "/v4/repositories/123") return repo;
  if (path === "/v4/repositories/123/repository/branches") return [{ name: "master" }];
  if (path === "/v3/auth/tokens") return { token: { user: { id: "user-1", domain: { id: tenantId } }, domain: { id: tenantId } } };
  if (path === `/v5/${workspaceId}/api/pipelines/list`) return { pipelines: [pipelineRow()], total: 1 };
  if (path === `/v5/${workspaceId}/api/pipelines/${pipelineId}`) return method === "PUT" || method === "DELETE" ? { pipeline_id: pipelineId } : detail();
  if (path === `/v5/${workspaceId}/api/pipelines/${newPipelineId}`) return { id: newPipelineId, project_id: workspaceId, name: "Fresh pipeline" };
  if (path === `/v5/${workspaceId}/api/pipelines`) return { pipeline_id: newPipelineId };
  if (path === `/v5/${tenantId}/api/pipeline-templates/${templateId}`) return { id: templateId, is_system: true, definition: detail().definition, manifest_version: "3.0", variables: [] };
  if (path === `/v5/${tenantId}/api/pipeline-templates/list`) return { templates: [{ id: templateId, name: "Blank pipeline", is_system: true, language: "shell" }], total: 1 };
  if (path === `/v5/${workspaceId}/api/pipelines/${pipelineId}/pipeline-runs/list`) return { pipeline_runs: runRows(), total: 2 };
  if (path === `/v5/${workspaceId}/api/pipelines/${pipelineId}/pipeline-runs/detail`) return runDetailRow();
  if (path === `/v5/${workspaceId}/api/pipelines/${pipelineId}/pipeline-runs/${runId}/stop`) return { success: true };
  if (path === `/v5/${workspaceId}/api/pipelines/${pipelineId}/run`) return { pipeline_run_id: runId };
  if (path === `/v5/${workspaceId}/api/pipelines/status`) return [{ pipeline_id: pipelineId, status: "COMPLETED", pipeline_run_id: finishedRunId }];
  throw new Error(`Unexpected ${method} ${path}`);
}

type Call = { path: string; method: string; body?: unknown };
const mutations = (calls: Call[]) => calls.filter(call => call.method === "PUT" || call.method === "DELETE" || call.path.endsWith("/run") || call.path.endsWith("/stop") || call.path === `/v5/${workspaceId}/api/pipelines`);
function cloud(t: TestContext, customize?: (url: URL, method: string) => unknown) {
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.pathname === "/v3/auth/tokens") {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("X-Auth-Token"), session.accountToken);
      assert.equal(headers.get("X-Subject-Token"), session.accountToken);
    }
    if (method !== "GET") calls.push({ path: url.pathname, method, body: init.body !== undefined ? JSON.parse(String(init.body)) : undefined });
    const custom = customize?.(url, method);
    if (custom instanceof Response) return custom;
    if (custom !== undefined) return Response.json(custom);
    return Response.json(route(url, method));
  });
  return calls;
}

test("template discovery requires the signed-in account token and verifies its owner", async t => {
  cloud(t, url => url.pathname === "/v3/auth/tokens" ? { token: { domain: { id: tenantId }, user: { id: "another-user", domain: { id: tenantId } } } } : undefined);
  await assert.rejects(codeartsPipelineManagement.options!(fixtureSession, "create"), /obtain an account token/);
  await assert.rejects(codeartsPipelineManagement.options!(session, "create"), /tenant ID could not be verified/);
});

test("inventory lists workspace pipelines with composite IDs", async t => {
  cloud(t);
  const resources = await codeartsPipelineManagement.inventory(session);
  assert.deepEqual(resources.map(item => [item.id, item.name, item.status]), [[`${workspaceId}/${pipelineId}`, "Deploy service", "COMPLETED"]]);
  assert.equal(resources[0].values?.workspace, "Workspace One");
});

test("inventory reports failed workspaces instead of silently truncating them", async t => {
  const other = "22223333444455556666777788889999";
  cloud(t, url => {
    if (url.pathname === "/v4/projects") return { projects: [{ project_id: workspaceId, project_name: "Workspace One" }, { project_id: other, project_name: "Workspace Two" }], total: 2 };
    if (url.pathname === `/v5/${other}/api/pipelines/list`) return new Response("unreachable", { status: 502 });
    return undefined;
  });
  const failure = await codeartsPipelineManagement.inventory(session).then(() => null, error => error);
  assert.ok(failure instanceof CloudLoadError);
  assert.equal(failure.partialData.length, 1);
  assert.equal(failure.partialData[0].id, `${workspaceId}/${pipelineId}`);
});

test("writes require live workspace membership and a fresh native pipeline scope", async t => {
  const missing = cloud(t, url => url.pathname === "/v4/projects" ? { projects: [], total: 0 } : undefined);
  await assert.rejects(codeartsPipelineManagement.execute(session, "rename", { name: "New name" }, resource), /no longer available/);
  assert.equal(missing.length, 0);
  const foreign = cloud(t, url => (url.pathname === `/v5/${workspaceId}/api/pipelines/${pipelineId}` ? { ...detail(), id: "0000aaaabbbbccccddddeeeeffff8888" } : undefined));
  await assert.rejects(codeartsPipelineManagement.execute(session, "rename", { name: "New name" }, resource), /could not be verified/);
  assert.equal(foreign.length, 0);
});

test("inspection shows whitelisted configuration and never secrets or raw definitions", async t => {
  cloud(t, url => url.pathname === `/v5/${workspaceId}/api/pipelines/${pipelineId}` ? { ...detail(), variables: [{ ...detail().variables[0], is_secret: true }] } : undefined);
  const outcome = await codeartsPipelineManagement.execute(session, "inspect", {}, resource);
  const text = JSON.stringify(outcome);
  assert.ok(!text.includes("MUST-NOT-EXPOSE"));
  assert.ok(text.includes("token (secret)"));
  assert.ok(text.includes("Push on"));
  assert.ok(text.includes("nightly enabled"));
  assert.ok(text.includes("Build step [cloudbuild]"));
  assert.ok(text.includes("codehub"));
});

test("rename preserves documented native settings and verifies the update envelope", async t => {
  const calls = cloud(t);
  await codeartsPipelineManagement.execute(session, "rename", { name: "New name", description: "New description" }, resource);
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].path, `/v5/${workspaceId}/api/pipelines/${pipelineId}`);
  const body = calls[0].body as Record<string, unknown>;
  assert.equal(body.name, "New name");
  assert.equal(body.description, "New description");
  assert.equal(body.definition, detail().definition);
  assert.deepEqual(body.triggers, detail().triggers);
  assert.deepEqual(body.variables, detail().variables);
  assert.deepEqual(body.schedules, detail().schedules);
  assert.equal(body.manifest_version, "3.0");
  const preserved = cloud(t);
  await codeartsPipelineManagement.execute(session, "rename", { name: "New name" }, resource);
  assert.equal((preserved[0].body as Record<string, unknown>).description, "Old description");
  cloud(t, (url, method) => (method === "PUT" ? { pipeline_id: "0000aaaabbbbccccddddeeeeffff7777" } : undefined));
  await assert.rejects(codeartsPipelineManagement.execute(session, "rename", { name: "New name" }, resource), /no verified pipeline update confirmation/);
});

test("trigger enable and disable are separate writes with an honest gap", async t => {
  const calls = cloud(t);
  await codeartsPipelineManagement.execute(session, "disable-triggers", {}, resource);
  const disabled = calls[0].body as { name: string; schedules: { enable: boolean }[]; triggers: { events: { enable: boolean }[] }[] };
  assert.equal(disabled.triggers[0].events[0].enable, false);
  assert.equal(disabled.schedules[0].enable, false);
  assert.equal(disabled.name, "Deploy service");
  const none = cloud(t, url => (url.pathname === `/v5/${workspaceId}/api/pipelines/${pipelineId}` ? { ...detail(), triggers: [], schedules: [] } : undefined));
  await assert.rejects(codeartsPipelineManagement.execute(session, "enable-triggers", {}, resource), /no automatic triggers to enable/);
  await assert.rejects(codeartsPipelineManagement.execute(session, "disable-triggers", {}, resource), /no automatic triggers to disable/);
  assert.equal(none.length, 0);
});

test("manual run posts an empty body and handles the native 200 error envelope", async t => {
  const calls = cloud(t);
  const outcome = await codeartsPipelineManagement.execute(session, "run", {}, resource);
  assert.deepEqual(calls[0], { path: `/v5/${workspaceId}/api/pipelines/${pipelineId}/run`, method: "POST", body: {} });
  assert.equal(outcome.jobId, runId);
  assert.equal(outcome.asynchronous, true);
  const rejected = cloud(t, (url, method) => (method === "POST" && url.pathname.endsWith("/run") ? { pipeline_run_id: "", error_msg: "Pipeline configuration is invalid" } : undefined));
  await assert.rejects(codeartsPipelineManagement.execute(session, "run", {}, resource), /rejected this pipeline run/);
  assert.equal(rejected.length, 1);
});

test("poll verifies the saved run identity and maps native statuses", async t => {
  let status = "RUNNING";
  cloud(t, url => (url.pathname.endsWith("/pipeline-runs/detail") ? { ...runDetailRow(), status } : undefined));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "codearts-pipeline", operation: "Run pipeline now", resourceId: resource.id, resourceName: resource.name, startedAt: new Date().toISOString(), state: "submitted", jobId: runId };
  assert.equal((await codeartsPipelineManagement.poll!(session, entry)).state, "submitted");
  status = "COMPLETED";
  assert.equal((await codeartsPipelineManagement.poll!(session, entry)).state, "succeeded");
  status = "FAILED";
  assert.equal((await codeartsPipelineManagement.poll!(session, entry)).state, "failed");
  status = "CANCELED";
  assert.equal((await codeartsPipelineManagement.poll!(session, { ...entry, operation: "Stop current run" })).state, "succeeded");
  cloud(t, url => (url.pathname.endsWith("/pipeline-runs/detail") ? { ...runDetailRow(), id: finishedRunId } : undefined));
  await assert.rejects(codeartsPipelineManagement.poll!(session, entry), /no longer matches/);
  cloud(t, url => (url.pathname === "/v4/projects" ? { projects: [], total: 0 } : undefined));
  await assert.rejects(codeartsPipelineManagement.poll!(session, entry), /no longer available/);
});

test("stop only accepts fresh active runs of this pipeline", async t => {
  cloud(t);
  const choices = await codeartsPipelineManagement.options!(session, "stop", resource);
  assert.deepEqual(choices.activeRuns?.map(choice => choice.value), [runId]);
  const stale = cloud(t);
  await assert.rejects(codeartsPipelineManagement.execute(session, "stop", { run: finishedRunId }, resource), /Select a current/);
  assert.equal(mutations(stale).length, 0);
  const stopped = cloud(t);
  const outcome = await codeartsPipelineManagement.execute(session, "stop", { run: runId }, resource);
  assert.deepEqual(mutations(stopped), [{ path: `/v5/${workspaceId}/api/pipelines/${pipelineId}/pipeline-runs/${runId}/stop`, method: "POST", body: undefined }]);
  assert.equal(outcome.jobId, runId);
  cloud(t, (url, method) => (method === "POST" && url.pathname.endsWith("/stop") ? { success: false } : undefined));
  await assert.rejects(codeartsPipelineManagement.execute(session, "stop", { run: runId }, resource), /did not confirm/);
});

test("delete refuses active or unverifiable pipelines and verifies the envelope", async t => {
  const active = cloud(t, (url, method) => (method === "POST" && url.pathname.endsWith("/api/pipelines/status") ? [{ pipeline_id: pipelineId, status: "RUNNING", pipeline_run_id: runId }] : undefined));
  await assert.rejects(codeartsPipelineManagement.execute(session, "delete", {}, resource), /latest run status is RUNNING/);
  assert.equal(mutations(active).length, 0);
  const unknown = cloud(t, (url, method) => (method === "POST" && url.pathname.endsWith("/api/pipelines/status") ? [{ pipeline_id: pipelineId, status: "WEIRD" }] : undefined));
  await assert.rejects(codeartsPipelineManagement.execute(session, "delete", {}, resource), /latest run status is WEIRD/);
  assert.equal(mutations(unknown).length, 0);
  const concurrent = cloud(t);
  await assert.rejects(codeartsPipelineManagement.execute(session, "delete", {}, resource), /still has 1 initializing/);
  assert.equal(mutations(concurrent).length, 0);
  const quiet = (url: URL, method: string) => (method === "POST" && url.pathname.endsWith("/pipeline-runs/list") ? { pipeline_runs: [runRows()[1]], total: 1 } : undefined);
  const calls = cloud(t, quiet);
  await codeartsPipelineManagement.execute(session, "delete", {}, resource);
  assert.deepEqual(mutations(calls), [{ path: `/v5/${workspaceId}/api/pipelines/${pipelineId}`, method: "DELETE", body: undefined }]);
  cloud(t, (url, method) => {
    if (method === "DELETE") return { pipeline_id: "0000aaaabbbbccccddddeeeeffff6666" };
    return quiet(url, method);
  });
  await assert.rejects(codeartsPipelineManagement.execute(session, "delete", {}, resource), /no verified pipeline deletion confirmation/);
});

test("pipeline creation uses verified native template definition and live code source with explicit disabled automation", async t => {
  cloud(t);
  const choices = await codeartsPipelineManagement.options!(session, "create");
  assert.deepEqual(choices.sources, [{ value: source, label: "Workspace One · orders · master" }]);
  assert.deepEqual(choices.templates, [{ value: templateId, label: "Blank pipeline · system template" }]);
  const calls = cloud(t);
  const result = await codeartsPipelineManagement.execute(session, "create", { workspace: workspaceId, source, template: templateId, name: "Fresh", description: "Created" });
  assert.deepEqual(mutations(calls), [{ path: `/v5/${workspaceId}/api/pipelines`, method: "POST", body: { name: "Fresh", description: "Created", is_publish: false, sources: [{ type: "code", params: { git_type: "codehub", codehub_id: "123", default_branch: "master", git_url: repo.http_url_to_repo, repo_name: repo.name, alias: "codehub" } }], definition: detail().definition, manifest_version: "3.0", variables: [], schedules: [], triggers: [] } }]);
  assert.equal(result.resourceId, `${workspaceId}/${newPipelineId}`); assert.match(result.message, /automatic triggers disabled/);
});
test("pipeline creation rejects stale templates, source branches, and unverified template input defaults", async t => {
  const calls = cloud(t);
  const values = { workspace: workspaceId, source, template: templateId, name: "Fresh" };
  await assert.rejects(codeartsPipelineManagement.execute(session, "create", { ...values, template: "forged-template" }), /Select a current pipeline template/);
  assert.equal(mutations(calls).length, 0);
  const stale = cloud(t, url => url.pathname.endsWith("/repository/branches") ? [] : undefined);
  await assert.rejects(codeartsPipelineManagement.execute(session, "create", values), /branch no longer exists/); assert.equal(mutations(stale).length, 0);
  const secret = cloud(t, url => url.pathname.endsWith(`/pipeline-templates/${templateId}`) ? { id: templateId, is_system: true, definition: detail().definition, variables: [{ name: "token", value: "********", is_secret: true }] } : undefined);
  await assert.rejects(codeartsPipelineManagement.execute(session, "create", values), /secret or runtime inputs/); assert.equal(mutations(secret).length, 0);
});

test("run history uses verified native rows and hides build parameters", async t => {
  cloud(t);
  const outcome = await codeartsPipelineManagement.execute(session, "runs", {}, resource);
  const text = JSON.stringify(outcome);
  assert.ok(!text.includes("MUST-NOT-EXPOSE"));
  assert.ok(!text.includes("Run #99"));
  assert.ok(text.includes("Run #12"));
  assert.ok(text.includes("Run #11"));
  assert.ok(outcome.message?.includes("2 runs"));
});

test("run detail verifies identity and omits step inputs and messages", async t => {
  cloud(t);
  const choices = await codeartsPipelineManagement.options!(session, "run-status", resource);
  assert.deepEqual(choices.runs?.map(choice => choice.value), [runId, finishedRunId]);
  const outcome = await codeartsPipelineManagement.execute(session, "run-status", { run: runId }, resource);
  const text = JSON.stringify(outcome);
  assert.ok(!text.includes("MUST-NOT-EXPOSE"));
  assert.ok(text.includes("Build step [cloudbuild] (COMPLETED)"));
  await assert.rejects(codeartsPipelineManagement.execute(session, "run-status", { run: foreignRunId }, resource), /Select a current run/);
  cloud(t, url => (url.pathname.endsWith("/pipeline-runs/detail") ? { ...runDetailRow(), id: finishedRunId } : undefined));
  await assert.rejects(codeartsPipelineManagement.execute(session, "run-status", { run: runId }, resource), /could not be verified for this pipeline/);
});

test("adapter contract uses the shared pipeline cache key", () => {
  assert.deepEqual(codeartsPipelineManagement.invalidationKeys(), [cloudCacheKeys.listCodeArtsPipelines]);
  assert.ok(codeartsPipelineManagement.operations.some(operation => operation.id === "enable-triggers"));
  assert.ok(codeartsPipelineManagement.operations.some(operation => operation.id === "disable-triggers"));
});

test("pipeline deletion rejects missing latest-state acknowledgements, foreign parents, and unknown historical states", async t => {
  const missing = cloud(t, url => url.pathname.endsWith("/api/pipelines/status") ? [] : undefined);
  await assert.rejects(codeartsPipelineManagement.execute(session, "delete", {}, resource), /latest run state could not be verified/); assert.equal(mutations(missing).length, 0);
  const foreign = cloud(t, url => url.pathname.endsWith("/pipeline-runs/list") ? { pipeline_runs: [{ ...runRows()[0], pipeline_id: "0".repeat(32) }], total: 1 } : undefined);
  await assert.rejects(codeartsPipelineManagement.execute(session, "delete", {}, resource), /verified pipeline membership/); assert.equal(mutations(foreign).length, 0);
  const unknown = cloud(t, url => url.pathname.endsWith("/pipeline-runs/list") ? { pipeline_runs: [{ ...runRows()[0], status: "UNKNOWN" }], total: 1 } : undefined);
  await assert.rejects(codeartsPipelineManagement.execute(session, "delete", {}, resource), /still has 1/); assert.equal(mutations(unknown).length, 0);
});
test("pipeline configuration edits refuse sensitive variables, masked tokens, YAML pipelines, and missing workspace identity", async t => {
  for (const changes of [{ variables: [{ ...detail().variables[0], is_secret: true }] }, { triggers: [{ ...detail().triggers[0], security_token: "********" }] }, { from_git_code: true }, { project_id: undefined }]) {
    const calls = cloud(t, url => url.pathname === `/v5/${workspaceId}/api/pipelines/${pipelineId}` ? { ...detail(), ...changes } : undefined);
    await assert.rejects(codeartsPipelineManagement.execute(session, "rename", { name: "Fresh" }, resource), /secret variables|masked webhook token|YAML\/PAC|developer workspace/);
    assert.equal(mutations(calls).length, 0);
  }
});
test("pipeline manual execution rechecks enabled state and owned repository refs", async t => {
  const disabled = cloud(t, url => url.pathname === `/v5/${workspaceId}/api/pipelines/${pipelineId}` ? { ...detail(), banned: true } : undefined);
  await assert.rejects(codeartsPipelineManagement.execute(session, "run", {}, resource), /enabled state/); assert.equal(mutations(disabled).length, 0);
  const stale = cloud(t, url => url.pathname.endsWith("/repository/branches") ? [] : undefined);
  await assert.rejects(codeartsPipelineManagement.execute(session, "run", {}, resource), /configured CodeArts branch no longer/); assert.equal(mutations(stale).length, 0);
});

test("a verified never-run pipeline can be deleted when both native run inventories are empty", async t => {
  const calls = cloud(t, url => url.pathname.endsWith("/api/pipelines/status") ? [] : url.pathname.endsWith("/pipeline-runs/list") ? { pipeline_runs: [], total: 0 } : undefined);
  await codeartsPipelineManagement.execute(session, "delete", {}, resource);
  assert.equal(mutations(calls).length, 1); assert.equal(mutations(calls)[0].method, "DELETE");
});
