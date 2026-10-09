import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { codeartsBuildManagement } from "@/lib/huawei/management/adapters/codearts-build";
import { session } from "./fixtures/session";

const workspace = "a".repeat(32), jobId = "f".repeat(32), createdId = "d".repeat(32);
const job = { id: jobId, job_name: "Orders", disabled: false, is_finished: true, build_project_id: "internal-build-project", last_build_status: "blue" };
const repo = { id: 123, name: "orders", archived: false, project_id: workspace, http_url_to_repo: "https://codehub.example/orders.git" };
const scm = { branch: "main", url: repo.http_url_to_repo, repo_id: "123", scm_type: "repo", is_auto_build: false, enable_git_lfs: true, build_type: "branch", group_name: "team", repo_name: "orders" };
const config = { project_id: workspace, job_id: jobId, job_name: job.job_name, scms: [scm], steps: [{ name: "build", module_id: "native-module", version: "1", properties: { script: "PRIVATE_SCRIPT" } }], parameters: [{ name: "token", params: [{ name: "value", value: "PRIVATE_PARAMETER" }] }], triggers: [{ name: "native-trigger", parameters: [] }], timeout: { limit: "2", unit: "hour" }, agency_urn: "agency-reference", description: "Description", source_code: "codeci", group_id: "group-1", resource_limit: { cpu: "2" }, code_checkout_config: { type: "native-preserved" } };
const template = { uuid: "template-1", name: "Official", language: "Java", template: { steps: config.steps }, parameters: [] };
const record = { codeci_job_id: jobId, devcloud_project_id: workspace, build_project_id: "internal-build-project", build_no: 42, status: "RUNNING", start_time: "2026-01-01T00:00:00Z" };
const resource = { id: `job:${workspace}:${jobId}`, name: job.job_name };
const source = JSON.stringify({ workspace, repository: "123", branch: "main" });
const createValues = { name: "NewBuild", source, template: template.uuid };
type Write = { path: string; method: string; query: string; body?: unknown };
type Fixture = { job: Record<string, unknown>; config: Record<string, unknown>; repositories: Record<string, unknown>[]; repository: Record<string, unknown>; branches: Record<string, unknown>[]; templates: Record<string, unknown>[]; records: Record<string, unknown>[]; record: Record<string, unknown>; workspaces: Record<string, unknown>[] };
function cloud(t: TestContext, changes: Partial<Fixture> = {}, response?: (url: URL, init: RequestInit) => Record<string, unknown>) {
  const fixture: Fixture = { job: { ...job }, config: { ...config }, repositories: [repo], repository: { ...repo }, branches: [{ name: "main" }, { name: "release" }], templates: [template], records: [{ number: 42, state: "SUCCESS", job_running_status: "Finished", start_time: Date.parse("2026-01-01T00:00:00Z") }], record: { ...record }, workspaces: [{ project_id: workspace, project_name: "Workspace" }], ...changes };
  const writes: Write[] = [], reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input), path = url.pathname;
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    if (init.method) {
      writes.push({ path, method: init.method, query: url.search, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return Response.json(response?.(url, init) ?? (path === "/v1/job/execute" ? { actual_build_number: "42" } : path === "/v1/job/create" ? { status: "success", result: { job_id: createdId } } : path.endsWith("/delete") || path === "/v1/job/update" ? { status: "success", result: { job_id: jobId, project_id: workspace } } : { status: "success" }));
    }
    reads.push(`${path}${url.search}`);
    if (path === "/v4/projects") return Response.json({ projects: fixture.workspaces, total: fixture.workspaces.length });
    if (path === `/v1/job/${workspace}/list`) return Response.json({ jobs: [fixture.job], total: 1 });
    if (path === `/v1/job/${jobId}/config`) return Response.json({ status: "success", result: fixture.config });
    if (path === `/v4/projects/${workspace}/repositories`) return Response.json(fixture.repositories);
    if (path === "/v4/repositories/123") return Response.json(fixture.repository);
    if (path === "/v4/repositories/123/repository/branches") return Response.json(fixture.branches);
    if (path === "/v1/template/officialtemplates") return Response.json({ status: "success", result: { items: fixture.templates, total_size: fixture.templates.length } });
    if (path === `/v1/record/${jobId}/list`) return Response.json({ status: "success", result: { job_build_states: fixture.records } });
    if (path === `/v1/record/${jobId}/42/record-info`) return Response.json({ status: "success", result: fixture.record });
    throw new Error(`Unexpected native read ${url}`);
  });
  return { fixture, writes, reads };
}
test("Build inventory uses current v1 workspace routes and keeps internal build IDs separate", async t => {
  const { reads } = cloud(t);
  const resources = await codeartsBuildManagement.inventory(session);
  assert.equal(resources[0].id, resource.id); assert.equal(resources[0].status, "Available");
  assert.ok(reads.some(path => path.startsWith(`/v1/job/${workspace}/list`))); assert.ok(reads.every(path => !path.includes(session.projectId)));
});
test("Build creation offers current workspace/repository/ref combinations and native templates", async t => {
  cloud(t);
  const choices = await codeartsBuildManagement.options!(session, "create-job");
  assert.deepEqual(choices.sources.map(c => JSON.parse(c.value)), [{ workspace, repository: "123", branch: "main" }, { workspace, repository: "123", branch: "release" }]);
  assert.deepEqual(choices.templates, [{ value: template.uuid, label: "Official · Java" }]);
});
test("Build creation posts current native actions with all automatic triggers disabled, then verifies disabling", async t => {
  const { writes } = cloud(t);
  const result = await codeartsBuildManagement.execute(session, "create-job", createValues);
  assert.deepEqual(writes[0], { path: "/v1/job/create", method: "POST", query: "", body: { project_id: workspace, job_name: "NewBuild", scms: [{ branch: "main", url: repo.http_url_to_repo, repo_id: "123", scm_type: "repo", is_auto_build: false, enable_git_lfs: false, build_type: "branch" }], steps: config.steps, build_config_type: "ACTION", triggers: [], build_if_code_updated: false } });
  assert.deepEqual(writes[1].body, { disabled: true, reason: "Created through BetterUI; manual recovery required before execution." }); assert.equal(writes[1].path, `/v1/job/${createdId}/disable`);
  assert.equal(result.resourceId, `job:${workspace}:${createdId}`); assert.match(result.message, /disabling was confirmed/);
});
test("Build creation never claims disabled status when the second native write fails", async t => {
  const { writes } = cloud(t, {}, url => url.pathname.endsWith("/disable") ? { status: "fail" } : { status: "success", result: { job_id: createdId } });
  const result = await codeartsBuildManagement.execute(session, "create-job", createValues);
  assert.match(result.message, /did not confirm the disable request/); assert.ok(!result.message.includes("created disabled")); assert.equal(writes.length, 2);
});
test("Build creation rejects stale workspaces, repositories, branches, templates, and archive states", async t => {
  const { fixture, writes } = cloud(t);
  fixture.workspaces = []; await assert.rejects(codeartsBuildManagement.execute(session, "create-job", createValues), /workspace is no longer/);
  fixture.workspaces = [{ project_id: workspace, project_name: "Workspace" }]; fixture.repositories = [];
  await assert.rejects(codeartsBuildManagement.execute(session, "create-job", createValues), /repository is no longer/);
  fixture.repositories = [repo]; fixture.branches = []; await assert.rejects(codeartsBuildManagement.execute(session, "create-job", createValues), /branch no longer exists/);
  fixture.branches = [{ name: "main" }]; fixture.templates = []; await assert.rejects(codeartsBuildManagement.execute(session, "create-job", createValues), /template is no longer/);
  fixture.templates = [template]; fixture.repository.archived = true; await assert.rejects(codeartsBuildManagement.execute(session, "create-job", createValues), /writable state/); assert.equal(writes.length, 0);
});
test("Build mutation verifies developer-workspace membership and native configuration ownership", async t => {
  const { fixture, writes } = cloud(t);
  fixture.config.project_id = "foreign"; await assert.rejects(codeartsBuildManagement.execute(session, "delete", {}, resource), /verified configuration/);
  fixture.config.project_id = workspace; fixture.workspaces = []; await assert.rejects(codeartsBuildManagement.execute(session, "delete", {}, resource), /workspace is no longer accessible/); assert.equal(writes.length, 0);
});
test("Build inspection reveals names and topology while preserving secret values and scripts", async t => {
  cloud(t); const result = await codeartsBuildManagement.execute(session, "inspect", {}, resource);
  const text = JSON.stringify(result); assert.ok(!text.includes("PRIVATE_SCRIPT")); assert.ok(!text.includes("PRIVATE_PARAMETER")); assert.ok(text.includes("token"));
});
test("Build rename preserves current native SCM, LFS, triggers, timeout, agency, checkout, and parameter settings", async t => {
  const { writes } = cloud(t); await codeartsBuildManagement.execute(session, "rename", { name: "NewName" }, resource);
  const body = writes[0].body as Record<string, unknown>;
  assert.equal(writes[0].path, "/v1/job/update"); assert.equal(body.job_name, "NewName");
  for (const key of ["scms", "steps", "parameters", "timeout", "triggers", "agency_urn", "description", "group_id", "resource_limit", "code_checkout_config"]) assert.deepEqual(body[key], config[key as keyof typeof config], key);
});
test("Build branch editing offers live refs and changes only the primary source branch", async t => {
  const { writes } = cloud(t); const choices = await codeartsBuildManagement.options!(session, "update-branch", resource);
  assert.deepEqual(choices.branches.map(c => c.value), ["main", "release"]);
  await codeartsBuildManagement.execute(session, "update-branch", { branch: "release" }, resource);
  const body = writes[0].body as Record<string, unknown>; assert.deepEqual(body.scms, [{ ...scm, branch: "release" }]); assert.deepEqual(body.steps, config.steps);
  await assert.rejects(codeartsBuildManagement.execute(session, "update-branch", { branch: "stale" }, resource), /branch no longer exists/);
});
test("Build configuration edits reject active builds and unknown running state", async t => {
  const { fixture, writes } = cloud(t); fixture.job.is_finished = false;
  await assert.rejects(codeartsBuildManagement.execute(session, "rename", { name: "New" }, resource), /current build to finish/);
  delete fixture.job.is_finished; await assert.rejects(codeartsBuildManagement.execute(session, "rename", { name: "New" }, resource), /idle\/running state/); assert.equal(writes.length, 0);
});
test("Build execution rechecks enabled/idle state and current repository refs, then records the native run number", async t => {
  const { fixture, writes } = cloud(t); fixture.job.disabled = true;
  await assert.rejects(codeartsBuildManagement.execute(session, "run", {}, resource), /Recover this disabled/);
  fixture.job.disabled = false; fixture.job.is_finished = false; await assert.rejects(codeartsBuildManagement.execute(session, "run", {}, resource), /already running/);
  fixture.job.is_finished = true; fixture.branches = []; await assert.rejects(codeartsBuildManagement.execute(session, "run", {}, resource), /branch no longer exists/);
  fixture.branches = [{ name: "main" }]; const result = await codeartsBuildManagement.execute(session, "run", {}, resource);
  assert.deepEqual(writes[0], { path: "/v1/job/execute", method: "POST", query: "", body: { job_id: jobId } }); assert.equal(result.jobId, `${workspace}:${jobId}:42`); assert.equal(result.asynchronous, true);
});
test("Build execution never fabricates run identity from an empty or invalid native number", async t => {
  cloud(t, {}, () => ({ actual_build_number: "-1" })); await assert.rejects(codeartsBuildManagement.execute(session, "run", {}, resource), /verifiable build number/);
});
test("Build stop verifies the latest run details and uses current native query/response contracts", async t => {
  const { fixture, writes } = cloud(t, { job: { ...job, is_finished: false } });
  const result = await codeartsBuildManagement.execute(session, "stop", {}, resource);
  assert.deepEqual(writes[0], { path: `/v1/job/${jobId}/stop`, query: "?build_no=42", method: "POST" }); assert.equal(result.asynchronous, true); assert.equal(result.jobId, `${workspace}:${jobId}:42`);
  fixture.record.status = "SUCCESS"; await assert.rejects(codeartsBuildManagement.execute(session, "stop", {}, resource), /already finished/); assert.equal(writes.length, 1);
});
test("Build stop rejects a foreign native run parent and never guesses when history is empty", async t => {
  const { fixture, writes } = cloud(t, { job: { ...job, is_finished: false } }); fixture.record.devcloud_project_id = "foreign";
  await assert.rejects(codeartsBuildManagement.execute(session, "stop", {}, resource), /run number could not be verified/);
  fixture.records = []; await assert.rejects(codeartsBuildManagement.execute(session, "stop", {}, resource), /current build number/); assert.equal(writes.length, 0);
});
test("Build disable/recover uses the same native endpoint with explicit boolean state", async t => {
  const { fixture, writes } = cloud(t); await codeartsBuildManagement.execute(session, "disable", {}, resource);
  fixture.job.disabled = true; await codeartsBuildManagement.execute(session, "recover", {}, resource);
  assert.deepEqual(writes.map(w => w.body), [{ disabled: true, reason: "Disabled through BetterUI." }, { disabled: false, reason: "Recovered through BetterUI." }]); assert.ok(writes.every(w => w.path === `/v1/job/${jobId}/disable`));
});
test("Build native HTTP 200 failures and missing acknowledgements do not become successful operations", async t => {
  cloud(t, {}, () => ({ status: "fail", error: "native rejection" })); await assert.rejects(codeartsBuildManagement.execute(session, "disable", {}, resource), /Huawei rejected/);
  cloud(t, {}, () => ({})); await assert.rejects(codeartsBuildManagement.execute(session, "disable", {}, resource), /no confirmation status/);
});
test("Build deletion rejects unfinished jobs and uses the current native DELETE with verified result identity", async t => {
  const { fixture, writes } = cloud(t, { job: { ...job, is_finished: false } }); await assert.rejects(codeartsBuildManagement.execute(session, "delete", {}, resource), /Stop the current build/);
  fixture.job.is_finished = true; await codeartsBuildManagement.execute(session, "delete", {}, resource);
  assert.deepEqual(writes[0], { path: `/v1/job/${jobId}/delete`, query: "", method: "DELETE" });
  cloud(t, {}, () => ({ status: "success", result: { job_id: "foreign", project_id: workspace } })); await assert.rejects(codeartsBuildManagement.execute(session, "delete", {}, resource), /different build job/);
});
test("Build history uses native record envelopes, numeric milliseconds, and native state names", async t => {
  const { reads } = cloud(t); const result = await codeartsBuildManagement.execute(session, "history", {}, resource);
  assert.ok(result.facts!.some(f => f.label === "Run #42" && f.value.includes("SUCCESS") && f.value.includes("2026-01-01T00:00:00.000Z"))); assert.ok(reads.some(r => r.startsWith(`/v1/record/${jobId}/list`)));
});
test("Build polling follows the saved run directly, even when a newer run is active", async t => {
  const { fixture, reads } = cloud(t, { job: { ...job, is_finished: false }, record: { ...record, status: "SUCCESS" } });
  const entry = { id: "request", service: "codearts-build", operation: "run", resourceId: resource.id, jobId: `${workspace}:${jobId}:42`, startedAt: new Date().toISOString(), state: "submitted" as const };
  assert.equal((await codeartsBuildManagement.poll!(session, entry)).state, "succeeded"); assert.ok(reads.every(r => !r.endsWith("/status") && !r.includes("/list?")));
  fixture.record.status = "FAILURE"; assert.equal((await codeartsBuildManagement.poll!(session, entry)).state, "failed"); fixture.record.status = "RUNNING"; assert.equal((await codeartsBuildManagement.poll!(session, entry)).state, "submitted");
  fixture.record.codeci_job_id = "foreign"; await assert.rejects(codeartsBuildManagement.poll!(session, entry), /run number could not be verified/);
  await assert.rejects(codeartsBuildManagement.poll!(session, { ...entry, jobId: `wrong:${jobId}:42` }), /verified build run/);
});

test("Build requests complete parameters and refuses edits with sensitive values", async t => {
  const { fixture, reads, writes } = cloud(t);
  fixture.config.parameters = [{ name: "hudson.model.StringParameterDefinition", params: [{ name: "sensitiveVar", value: "true" }, { name: "defaultValue", value: "********" }] }];
  await assert.rejects(codeartsBuildManagement.execute(session, "rename", { name: "Renamed" }, resource), /sensitive parameters/);
  assert.ok(reads.some(path => path.endsWith("config?get_all_params=true"))); assert.equal(writes.length, 0);
});
test("Build never confirms an update for another native job or leaks a native error object", async t => {
  cloud(t, {}, () => ({ status: "success", result: { job_id: createdId } }));
  await assert.rejects(codeartsBuildManagement.execute(session, "rename", { name: "Renamed" }, resource), /did not confirm updating/);
});
test("Build rejects native success containing a private error object", async t => {
  cloud(t, {}, () => ({ status: "success", error: { private: "PRIVATE_PARAMETER" } }));
  await assert.rejects(codeartsBuildManagement.execute(session, "disable", {}, resource), error => error instanceof Error && /Huawei rejected/.test(error.message) && !error.message.includes("PRIVATE_PARAMETER"));
});
test("Build rejects invalid saved run numbers and missing selections before fetching records", async t => {
  const { reads, writes } = cloud(t);
  await assert.rejects(codeartsBuildManagement.execute(session, "delete", {}), /Select a CodeArts/);
  for (const number of ["-1", "0", "Infinity", "9007199254740992", "42/other"]) {
    await assert.rejects(codeartsBuildManagement.poll!(session, { resourceId: resource.id, resourceName: resource.name, jobId: `${workspace}:${jobId}:${number}` } as Parameters<NonNullable<typeof codeartsBuildManagement.poll>>[1]), /verified build run/);
  }
  assert.ok(reads.every(path => !path.includes("record-info"))); assert.equal(writes.length, 0);
});
