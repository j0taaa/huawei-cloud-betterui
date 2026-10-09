import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { codeartsDeployManagement } from "@/lib/huawei/management/adapters/codearts-deploy";
import { session } from "./fixtures/session";

const workspace = "a".repeat(32), appId = "b".repeat(32), taskId = "c".repeat(32), recordId = "d".repeat(32), startedRecordId = "e".repeat(32), createdAppId = "f".repeat(32), createdTaskId = "9".repeat(32);
const templateId = "0123456789abcdef0123456789abcdef";
const appRow = { id: appId, name: "Orders-deploy", is_disable: false, execution_state: "succeeded", duration: "00:01:00", project_id: workspace, project_name: "Workspace", create_user_id: "creator-1", executor_nick_name: "Ops", deploy_system: "deployTemplate" };
const task = { id: taskId, name: "Orders-deploy", state: "Available", deploy_system: "deployTemplate", template_id: templateId, steps: { deploy: { id: "step-1", name: "Deploy to hosts", params: { host_group: "PRIVATE_HOST", credential: "PRIVATE_SECRET" }, enable: true } } };
const detail = { id: appId, name: "Orders-deploy", description: "Orders service", region: "cn-north-7", is_disable: false, create_type: "template", project_id: workspace, project_name: "Workspace", slave_cluster_id: "", permission_level: "project", create_user_id: "creator-1", create_time: "2026-01-01 10:00:00", update_time: "2026-01-02 10:00:00", arrange_infos: [task] };
const historyRow = { duration: "00:01:00", state: "succeeded", operator: "ops-user", execution_id: recordId, start_time: "2026-01-05 10:00:00", nickname: "Ops", end_time: "2026-01-05 10:01:00", release_id: 7, type: "deploy" };
const stateResult = { status: "running", record_id: recordId, task_id: taskId, task_name: "Orders-deploy", executor: "Ops", start_time: "2026-01-05 10:00:00", end_time: "", step: "running" };
const resource = { id: `application:${workspace}:${appId}`, name: "Orders-deploy" };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Write = { path: string; method: string; query: string; body?: unknown };
type Fixture = { workspaces: Record<string, unknown>[]; apps: Record<string, unknown>[]; detail: Record<string, unknown>; history: Record<string, unknown>[]; historyByTask?: Record<string, Record<string, unknown>[]>; state: Record<string, unknown>; exist: Record<string, unknown>; trigger: Record<string, unknown>; start: Record<string, unknown>; stop: Record<string, unknown>; params: unknown[] };
function cloud(t: TestContext, changes: Partial<Fixture> = {}, response?: (url: URL, init: RequestInit) => Record<string, unknown>) {
  const fixture: Fixture = {
    workspaces: [{ project_id: workspace, project_name: "Workspace" }],
    apps: [clone(appRow)],
    detail: clone(detail),
    history: [clone(historyRow)],
    state: clone(stateResult),
    exist: { status: "success", result: false },
    trigger: { trigger_source: "0", artifact_source_system: "", artifact_type: "" },
    start: { id: startedRecordId, task_id: taskId, job_name: "job" },
    stop: { status: "success", result: { id: recordId, task_id: taskId } },
    params: [{ name: "host_group", type: "host_group", value: "PRIVATE_HOST" }, { name: "password", type: "encrypt", value: "PRIVATE_SECRET" }],
    ...changes,
  };
  const writes: Write[] = [], reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input), path = url.pathname;
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    if (method !== "GET" && path !== "/v1/applications/list") {
      writes.push({ path, method, query: url.search, ...(body !== undefined ? { body } : {}) });
      const override = response?.(url, init);
      if (override) return Response.json(override);
      if (method === "POST" && path === "/v1/applications") return Response.json({ status: "success", result: { id: createdAppId, name: body?.name, region: "cn-north-7", is_disable: false, arrange_infos: [{ id: createdTaskId }] } });
      if (method === "PUT" && path === "/v1/applications") return Response.json({ status: "success", result: { id: appId, name: body?.name, region: "cn-north-7", is_disable: false, arrange_infos: [{ id: taskId }] } });
      if (method === "PUT" && path === `/v1/applications/${appId}/disable`) return Response.json({ status: "success" });
      if (method === "DELETE" && path === `/v1/applications/${appId}`) return Response.json({ status: "success", result: { id: appId, name: appRow.name, region: "cn-north-7", is_disable: false, arrange_infos: [{ id: taskId }] } });
      if (method === "POST" && path === `/v2/tasks/${taskId}/start`) return Response.json(fixture.start);
      if (method === "POST" && path === `/v2/tasks/${taskId}/records/${recordId}/rollback`) return Response.json(fixture.start);
      if (method === "PUT" && path === `/v2/tasks/${taskId}/records/${recordId}/stop`) return Response.json(fixture.stop);
      throw new Error(`Unexpected native write ${method} ${url}`);
    }
    reads.push(`${path}${url.search}`);
    if (path === "/v4/projects") return Response.json({ projects: fixture.workspaces, total: fixture.workspaces.length });
    if (path === "/v1/applications/list") return Response.json({ total_num: fixture.apps.length, result: fixture.apps });
    if (path === `/v1/applications/${appId}/info`) return Response.json({ status: "success", result: fixture.detail });
    if (path === "/v1/applications/exist") return Response.json(fixture.exist);
    if (path === "/v2/task/trigger/detail") return Response.json(fixture.trigger);
    if (path.startsWith(`/v2/${workspace}/task/`) && path.endsWith("/history")) {
      const rows = fixture.historyByTask?.[path.split("/")[4]] ?? fixture.history;
      const offset = (Number(url.searchParams.get("page")) - 1) * 100;
      return Response.json({ result: rows.slice(offset, offset + 100), total_num: rows.length });
    }
    if (path === `/v2/tasks/${taskId}/state`) return Response.json({ status: "success", result: fixture.state });
    if (path === `/v2/history/tasks/${taskId}/params`) return Response.json(fixture.params);
    throw new Error(`Unexpected native read ${url}`);
  });
  return { fixture, writes, reads };
}

test("Deploy inventory uses the native v1 application list across live workspaces with composite IDs", async t => {
  const { reads } = cloud(t);
  const resources = await codeartsDeployManagement.inventory(session);
  assert.equal(resources[0].id, resource.id);
  assert.equal(resources[0].name, "Orders-deploy");
  assert.equal(resources[0].status, "Available");
  assert.equal(resources[0].values?.workspace, "Workspace");
  assert.ok(reads.some(path => path.startsWith("/v1/applications/list")));
  assert.ok(reads.every(path => !path.includes(session.projectId)));
});

test("Deploy inventory maps native disable and execution states to whitelisted statuses", async t => {
  const { fixture } = cloud(t);
  fixture.apps[0].is_disable = true;
  assert.equal((await codeartsDeployManagement.inventory(session))[0].status, "Disabled");
  fixture.apps[0].is_disable = false;
  for (const [state, expected] of [["running", "Deploying"], ["pending", "Deploying"], ["not_executed", "Available"], ["failed", "Available"]] as const) {
    fixture.apps[0].execution_state = state;
    assert.equal((await codeartsDeployManagement.inventory(session))[0].status, expected, state);
  }
  delete fixture.apps[0].is_disable;
  assert.equal((await codeartsDeployManagement.inventory(session))[0].status, "Unverified");
});

test("Application creation offers live workspaces and posts the documented draft template body", async t => {
  const { writes, reads } = cloud(t);
  const choices = await codeartsDeployManagement.options!(session, "create-application");
  assert.deepEqual(choices.workspaces, [{ value: workspace, label: "Workspace" }]);
  const result = await codeartsDeployManagement.execute(session, "create-application", { workspace, name: "Billing-deploy", description: "Billing service", template: templateId });
  assert.deepEqual(writes[0], { path: "/v1/applications", method: "POST", query: "", body: { project_id: workspace, name: "Billing-deploy", is_draft: true, create_type: "template", arrange_infos: [{ template_id: templateId }], description: "Billing service" } });
  assert.ok(reads.some(path => path.startsWith(`/v1/applications/exist?name=Billing-deploy&project_id=${workspace}`)));
  assert.equal(result.resourceId, `application:${workspace}:${createdAppId}`);
  assert.match(result.message, /draft state/);
  assert.ok(!result.message.includes("trigger"));
  assert.ok(result.facts!.some(fact => fact.label === "deployment task id" && fact.value === createdTaskId));
});

test("Application creation rejects duplicate names, stale workspaces, and native rejections", async t => {
  const { fixture, writes } = cloud(t);
  fixture.exist = { status: "success", result: true };
  await assert.rejects(codeartsDeployManagement.execute(session, "create-application", { workspace, name: "Orders-deploy", template: templateId }), /already exists|could not be verified as unique/);
  fixture.exist = { status: "success", result: false };
  fixture.workspaces = [];
  await assert.rejects(codeartsDeployManagement.execute(session, "create-application", { workspace, name: "Orders-deploy", template: templateId }), /workspace is no longer available/);
  cloud(t, {}, () => ({ status: "error", error: { private: "PRIVATE_DETAIL" } }));
  await assert.rejects(codeartsDeployManagement.execute(session, "create-application", { workspace, name: "Orders-deploy", template: templateId }), error => error instanceof Error && /Huawei rejected/.test(error.message) && !error.message.includes("PRIVATE_DETAIL"));
  assert.equal(writes.length, 0);
});

test("Application creation without verified native identities is never reported as created", async t => {
  cloud(t, {}, (url, init) => init.method === "POST" && url.pathname === "/v1/applications" ? { status: "success", result: { id: "short", name: (JSON.parse(String(init.body)) as Record<string, unknown>).name } } : {});
  await assert.rejects(codeartsDeployManagement.execute(session, "create-application", { workspace, name: "Billing-deploy", template: templateId }), /no verified application ID/);
  cloud(t, {}, () => ({ status: "success", result: { id: createdAppId, name: "Billing-deploy" } }));
  await assert.rejects(codeartsDeployManagement.execute(session, "create-application", { workspace, name: "Billing-deploy", template: templateId }), /no verified deployment task/);
});

test("Deploy inspection reveals names and topology while preserving step and parameter secrets", async t => {
  cloud(t);
  const result = await codeartsDeployManagement.execute(session, "inspect", {}, resource);
  const text = JSON.stringify(result);
  assert.ok(!text.includes("PRIVATE_SECRET"));
  assert.ok(!text.includes("PRIVATE_HOST"));
  assert.ok(text.includes("Deploy to hosts"));
  assert.ok(text.includes("Available"));
  assert.ok(text.includes("0 (any source)"));
  assert.ok(result.facts!.some(fact => fact.label === "CodeArts workspace" && fact.value === workspace));
});

test("Record parameter inspection shows names and types only, never values", async t => {
  cloud(t);
  const result = await codeartsDeployManagement.execute(session, "params", { record: `${taskId}:${recordId}` }, resource);
  const text = JSON.stringify(result);
  assert.ok(!text.includes("PRIVATE_SECRET"));
  assert.ok(!text.includes("PRIVATE_HOST"));
  assert.ok(text.includes("host_group"));
  assert.ok(text.includes("encrypt"));
  assert.match(result.message, /values are never displayed/);
});

test("Deployment records use the native history envelope with whitelisted state names", async t => {
  const { reads } = cloud(t);
  const result = await codeartsDeployManagement.execute(session, "records", {}, resource);
  assert.ok(result.facts!.some(fact => fact.label === "Record 7" && fact.value.includes("succeeded") && fact.value.includes("Ops")));
  assert.ok(reads.some(path => path.startsWith(`/v2/${workspace}/task/${taskId}/history`)));
});

test("Manual deployment verifies state, trigger, and idle records before starting the native run", async t => {
  const { fixture, writes } = cloud(t);
  const result = await codeartsDeployManagement.execute(session, "deploy", {}, resource);
  assert.deepEqual(writes[0], { path: `/v2/tasks/${taskId}/start`, method: "POST", query: "", body: {} });
  assert.equal(result.jobId, `${workspace}:${appId}:${taskId}:${startedRecordId}`);
  assert.equal(result.asynchronous, true);
  fixture.detail.is_disable = true;
  await assert.rejects(codeartsDeployManagement.execute(session, "deploy", {}, resource), /Re-enable this disabled/);
  fixture.detail.is_disable = false;
  (fixture.detail.arrange_infos as Record<string, unknown>[])[0].state = "Draft";
  await assert.rejects(codeartsDeployManagement.execute(session, "deploy", {}, resource), /still a draft/);
  (fixture.detail.arrange_infos as Record<string, unknown>[])[0].state = "Available";
  fixture.trigger = { trigger_source: "1", artifact_source_system: "Artifact", artifact_type: "generic" };
  await assert.rejects(codeartsDeployManagement.execute(session, "deploy", {}, resource), /pipeline-triggered/);
  fixture.trigger = { trigger_source: "0" };
  fixture.history = [{ ...historyRow, state: "running" }];
  await assert.rejects(codeartsDeployManagement.execute(session, "deploy", {}, resource), /active or unverified execution/);
  assert.equal(writes.length, 1);
});

test("Deployment never fabricates run identity from invalid native start responses", async t => {
  cloud(t, {}, () => ({ id: "short", task_id: taskId }));
  await assert.rejects(codeartsDeployManagement.execute(session, "deploy", {}, resource), /no verifiable deployment record/);
  cloud(t, {}, () => ({ id: startedRecordId, task_id: "foreign" }));
  await assert.rejects(codeartsDeployManagement.execute(session, "deploy", {}, resource), /no verifiable deployment record/);
});

test("Stopping verifies the latest running record and its native state before the native stop", async t => {
  const { fixture, writes } = cloud(t, { history: [{ ...historyRow, state: "running" }] });
  const result = await codeartsDeployManagement.execute(session, "stop", {}, resource);
  assert.deepEqual(writes[0], { path: `/v2/tasks/${taskId}/records/${recordId}/stop`, method: "PUT", query: "" });
  assert.equal(result.jobId, `${workspace}:${appId}:${taskId}:${recordId}`);
  assert.equal(result.asynchronous, true);
  fixture.state = { ...stateResult, status: "succeeded" };
  await assert.rejects(codeartsDeployManagement.execute(session, "stop", {}, resource), /not currently running/);
  fixture.state = { ...stateResult, task_id: "foreign" };
  await assert.rejects(codeartsDeployManagement.execute(session, "stop", {}, resource), /could not be verified/);
  assert.equal(writes.length, 1);
});

test("Stopping rejects finished records and never guesses without current history", async t => {
  const { writes } = cloud(t);
  await assert.rejects(codeartsDeployManagement.execute(session, "stop", {}, resource), /already finished/);
  cloud(t, { history: [] });
  await assert.rejects(codeartsDeployManagement.execute(session, "stop", {}, resource), /no current deployment record/);
  assert.equal(writes.length, 0);
});

test("Record re-runs offer only finished records and re-verify the chosen record", async t => {
  const { fixture, writes } = cloud(t);
  const choices = await codeartsDeployManagement.options!(session, "rollback", resource);
  assert.deepEqual(choices.records.map(choice => choice.value), [`${taskId}:${recordId}`]);
  const result = await codeartsDeployManagement.execute(session, "rollback", { record: `${taskId}:${recordId}` }, resource);
  assert.deepEqual(writes[0], { path: `/v2/tasks/${taskId}/records/${recordId}/rollback`, method: "POST", query: "" });
  assert.equal(result.jobId, `${workspace}:${appId}:${taskId}:${startedRecordId}`);
  fixture.history = [{ ...historyRow, state: "running" }];
  assert.deepEqual((await codeartsDeployManagement.options!(session, "rollback", resource)).records, []);
  await assert.rejects(codeartsDeployManagement.execute(session, "rollback", { record: `${taskId}:${recordId}` }, resource), /active or unverified execution/);
  fixture.history = [];
  await assert.rejects(codeartsDeployManagement.execute(session, "rollback", { record: `${taskId}:${recordId}` }, resource), /no longer listed/);
  assert.equal(writes.length, 1);
});

test("Disable and enable use the native endpoint with explicit boolean state", async t => {
  const { fixture, writes } = cloud(t);
  await codeartsDeployManagement.execute(session, "disable", {}, resource);
  fixture.detail.is_disable = true;
  await codeartsDeployManagement.execute(session, "enable", {}, resource);
  assert.deepEqual(writes, [
    { path: `/v1/applications/${appId}/disable`, method: "PUT", query: "", body: { is_disable: true } },
    { path: `/v1/applications/${appId}/disable`, method: "PUT", query: "", body: { is_disable: false } },
  ]);
  await assert.rejects(codeartsDeployManagement.execute(session, "disable", {}, resource), /already disabled/);
  fixture.detail.is_disable = false;
  await assert.rejects(codeartsDeployManagement.execute(session, "enable", {}, resource), /not disabled/);
});

test("Deletion guards active deployments and verifies the native deletion identity", async t => {
  const { fixture, writes } = cloud(t);
  await codeartsDeployManagement.execute(session, "delete", {}, resource);
  assert.deepEqual(writes[0], { path: `/v1/applications/${appId}`, method: "DELETE", query: "" });
  fixture.apps[0].execution_state = "pending";
  await assert.rejects(codeartsDeployManagement.execute(session, "delete", {}, resource), /Wait for the current deployment/);
  fixture.apps[0].execution_state = "succeeded";
  cloud(t, {}, () => ({ status: "success", result: { id: createdAppId, name: "Orders-deploy" } }));
  await assert.rejects(codeartsDeployManagement.execute(session, "delete", {}, resource), /different application/);
  cloud(t, {}, () => ({ status: "success" }));
  await assert.rejects(codeartsDeployManagement.execute(session, "delete", {}, resource), /no verifiable deletion confirmation/);
});

test("Native HTTP 200 failures and missing acknowledgements never become successful operations", async t => {
  cloud(t, {}, () => ({ status: "error" }));
  await assert.rejects(codeartsDeployManagement.execute(session, "disable", {}, resource), /Huawei rejected/);
  cloud(t, {}, () => ({}));
  await assert.rejects(codeartsDeployManagement.execute(session, "disable", {}, resource), /no confirmation status/);
});

test("Deploy mutations verify live workspace and application ownership", async t => {
  const { fixture, writes } = cloud(t);
  fixture.workspaces = [];
  await assert.rejects(codeartsDeployManagement.execute(session, "inspect", {}, resource), /workspace is no longer accessible/);
  fixture.workspaces = [{ project_id: workspace, project_name: "Workspace" }];
  fixture.apps = [];
  await assert.rejects(codeartsDeployManagement.execute(session, "deploy", {}, resource), /no longer exists in its CodeArts workspace/);
  assert.equal(writes.length, 0);
});

test("Stale task and record choices are rejected against current native state", async t => {
  const { fixture, writes } = cloud(t);
  await assert.rejects(codeartsDeployManagement.execute(session, "deploy", { task: "7".repeat(32) }, resource), /no longer exists in this application/);
  (fixture.detail.arrange_infos as Record<string, unknown>[]).push({ ...task, id: "8".repeat(32) });
  await assert.rejects(codeartsDeployManagement.execute(session, "deploy", {}, resource), /Select which deployment task/);
  (fixture.detail.arrange_infos as Record<string, unknown>[]).pop();
  await assert.rejects(codeartsDeployManagement.execute(session, "params", { record: `${"7".repeat(32)}:${recordId}` }, resource), /no longer exists in this application/);
  await assert.rejects(codeartsDeployManagement.execute(session, "params", { record: "bogus" }, resource), /Select a deployment record/);
  assert.equal(writes.length, 0);
});

test("Deploy polling follows the saved record directly and verifies its native identity", async t => {
  const { fixture, reads } = cloud(t);
  const entry = { id: "request", service: "codearts-deploy", operation: "deploy", resourceId: resource.id, jobId: `${workspace}:${appId}:${taskId}:${recordId}`, startedAt: new Date().toISOString(), state: "submitted" as const };
  fixture.state = { ...stateResult, status: "succeeded" };
  assert.equal((await codeartsDeployManagement.poll!(session, entry)).state, "succeeded");
  fixture.state = { ...stateResult, status: "failed" };
  assert.equal((await codeartsDeployManagement.poll!(session, entry)).state, "failed");
  fixture.state = { ...stateResult, status: "running" };
  assert.equal((await codeartsDeployManagement.poll!(session, entry)).state, "submitted");
  fixture.state = { ...stateResult, status: "unmapped" };
  assert.match((await codeartsDeployManagement.poll!(session, entry)).message!, /unverified state unmapped/);
  assert.ok(reads.every(path => path === `/v2/tasks/${taskId}/state?record_id=${recordId}` || !path.includes("/state")));
  assert.ok(reads.every(path => !path.includes("/history")));
  fixture.state = { ...stateResult, record_id: startedRecordId };
  await assert.rejects(codeartsDeployManagement.poll!(session, entry), /could not be verified/);
});

test("Deploy polling rejects invalid saved identities and foreign workspaces", async t => {
  cloud(t);
  const entry = { id: "request", service: "codearts-deploy", operation: "deploy", resourceId: resource.id, jobId: `${workspace}:${appId}:${taskId}:${recordId}`, startedAt: new Date().toISOString(), state: "submitted" as const };
  for (const jobId of [`${workspace}:${appId}:${taskId}`, `${workspace}:${appId}:${taskId}:short`, `${"f".repeat(32)}:${appId}:${taskId}:${recordId}`, `${workspace}:${appId}:${taskId}:${recordId}:extra`]) {
    await assert.rejects(codeartsDeployManagement.poll!(session, { ...entry, jobId }), /no verified deployment record/);
  }
  await assert.rejects(codeartsDeployManagement.poll!(session, { ...entry, resourceId: undefined }), /no verified application/);
  const { fixture } = cloud(t);
  fixture.workspaces = [];
  await assert.rejects(codeartsDeployManagement.poll!(session, entry), /workspace is no longer accessible/);
});


test("Unknown application states block every idle-only mutation without a native write", async t => {
  const { fixture, writes } = cloud(t);
  for (const state of [undefined, "", "rolling_back", "future_native_state"]) {
    fixture.apps[0].execution_state = state;
    assert.equal((await codeartsDeployManagement.inventory(session))[0].status, "Unverified");
    for (const operation of ["deploy", "rollback", "disable", "enable", "delete"]) {
      await assert.rejects(codeartsDeployManagement.execute(session, operation, { record: `${taskId}:${recordId}` }, resource), /state could not be verified/);
    }
  }
  assert.equal(writes.length, 0);
});

test("Hidden active executions on another task block changes to the whole application", async t => {
  const { fixture, writes } = cloud(t);
  (fixture.detail.arrange_infos as Record<string, unknown>[]).push({ ...task, id: "8".repeat(32) });
  fixture.historyByTask = { ["8".repeat(32)]: [{ ...historyRow, state: "running" }] };
  for (const operation of ["deploy", "rollback", "disable", "delete"]) {
    await assert.rejects(codeartsDeployManagement.execute(session, operation, { task: taskId, record: `${taskId}:${recordId}` }, resource), /active or unverified execution/);
  }
  assert.equal(writes.length, 0);
});

test("Malformed or foreign execution rows cannot be silently discarded before a write", async t => {
  const { fixture, writes } = cloud(t);
  for (const record of [{ ...historyRow, execution_id: "invalid" }, { ...historyRow, task_id: "foreign" }, { ...historyRow, state: "unmapped" }]) {
    fixture.history = [record];
    await assert.rejects(codeartsDeployManagement.execute(session, "delete", {}, resource), /verified native task identity|active or unverified execution/);
  }
  assert.equal(writes.length, 0);
});

test("Unknown, duplicate, or malformed native task identities block mutations", async t => {
  const { fixture, writes } = cloud(t);
  for (const tasks of [[{ ...task, state: "Publishing" }], [{ ...task, id: "invalid" }], [task, task], []]) {
    fixture.detail.arrange_infos = tasks;
    await assert.rejects(codeartsDeployManagement.execute(session, "disable", {}, resource), /could not be verified|no verified native identity/);
  }
  assert.equal(writes.length, 0);
});

test("Draft tasks cannot re-run historical deployments", async t => {
  const { fixture, writes } = cloud(t);
  (fixture.detail.arrange_infos as Record<string, unknown>[])[0].state = "Draft";
  await assert.rejects(codeartsDeployManagement.execute(session, "rollback", { record: `${taskId}:${recordId}` }, resource), /Publish this deployment task/);
  assert.equal(writes.length, 0);
});

test("Every native history page is checked before deleting an idle-looking application", async t => {
  const { writes, reads } = cloud(t, { history: Array.from({ length: 101 }, (_, i) => ({ ...historyRow, execution_id: i.toString(16).padStart(32, "0"), state: i === 100 ? "running" : "succeeded" })) });
  await assert.rejects(codeartsDeployManagement.execute(session, "delete", {}, resource), /active or unverified execution/);
  assert.ok(reads.some(path => path.includes("page=2")));
  assert.equal(writes.length, 0);
});
