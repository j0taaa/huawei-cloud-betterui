import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { drsManagement } from "@/lib/huawei/management/adapters/drs";
import type { ManagementHistoryEntry } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const jobId = "11111111-2222-3333-4444-555555555555";
const resource = { id: jobId, name: "migrate-orders", status: "WAITING_FOR_START" };
const commands = ["PRE_CHECK", "START", "PAUSE", "RETRY", "FREE_RESOURCE", "DELETE"];

const listJob = (overrides: Record<string, unknown> = {}) => ({ id: jobId, name: "migrate-orders", status: "WAITING_FOR_START", engine_type: "mysql", job_type: "migration", task_type: "FULL_INCR_SYNC", job_direction: "up", net_type: "vpc", charging_mode: "postPaid", billing_tag: true, create_time: "2026-01-02T03:04:05Z", description: "orders", enterprise_project_id: "0", job_action: { available_actions: commands, unavailable_actions: [], current_action: "" }, children: [], ...overrides });

const detailJob = (overrides: Record<string, unknown> = {}) => ({ id: jobId, status: "WAITING_FOR_START", create_time: "2026-01-02T03:04:05Z", master_job_id: "", task_version: "1.22.0", base_info: { name: "migrate-orders", engine_type: "mysql", task_type: "FULL_INCR_SYNC", job_direction: "up", net_type: "vpc", charging_mode: "postPaid", description: "orders migration", enterprise_project_id: "0", expired_days: "14" }, source_endpoint: [{ db_type: "mysql", endpoint_type: "cloud", endpoint_role: "so", endpoint: { id: "endpoint-1", ip: "192.168.1.10", db_port: "3306", db_user: "root", db_password: "PRIVATE_SOURCE_PASSWORD", instance_id: "rds-source", instance_name: "source-rds" } }], target_endpoint: [{ db_type: "mysql", endpoint_type: "cloud", endpoint_role: "ta", endpoint: { id: "endpoint-2", ip: "192.168.1.20", db_port: "3306", db_user: "root", db_password: "PRIVATE_TARGET_PASSWORD", instance_id: "rds-target", instance_name: "target-rds" } }], progress_info: { progress: "0", transfer_status: "INITIALIZING", task_mode: "FULL_INCR_SYNC", incr_trans_delay: "0", remaining_time: "-" }, precheck_result: { result: true, process: "100%", total_passed_rate: "100%" }, network_results: [{ ip: "192.168.1.10", success: true, status: "success", error_code: "0", error_msg: "PRIVATE_SOURCE_ERROR" }, { ip: "192.168.1.20", success: false, status: "failed", error_code: "DRS.4001", error_msg: "PRIVATE_TARGET_ERROR" }], ...overrides });

type Call = { path: string; method: string; body?: Record<string, unknown> };
function cloud(t: TestContext, change?: (url: URL, method: string) => unknown) {
  const writes: Call[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (method !== "GET") writes.push({ path: url.pathname, method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const replacement = change?.(url, method);
    if (replacement instanceof Response) return replacement;
    if (replacement !== undefined) return Response.json(replacement);
    if (method === "DELETE") return Response.json({});
    if (method === "POST" && url.pathname.endsWith("/stop")) return Response.json({ error_code: "0", id: jobId, name: "migrate-orders", status: "success" });
    if (method === "PUT") return Response.json({ error_code: "0", id: jobId, name: "migrate-orders", status: "success" });
    if (method === "POST") return Response.json({ query_id: "query-123" });
    if (url.pathname === `/v5/${session.projectId}/jobs`) return Response.json({ total_count: 1, jobs: [listJob()] });
    if (url.pathname === `/v5/${session.projectId}/jobs/${jobId}`) return Response.json({ job: detailJob() });
    if (url.pathname === `/v5/${session.projectId}/jobs/${jobId}/actions`) return Response.json({ job_action: { available_actions: commands, unavailable_actions: [], current_action: "" } });
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });
  return writes;
}

const entry = (operation: string): ManagementHistoryEntry => ({ id: "0c1f2a33-0b4a-4c2e-8d1f-2a3b4c5d6e7f", service: "drs", operation, resourceId: jobId, jobId, startedAt: "2026-01-02T03:04:05Z", state: "submitted" });

test("DRS inventory completes native offset pagination and exposes typed job values", async t => {
  const offsets: string[] = [];
  cloud(t, url => {
    if (url.pathname !== `/v5/${session.projectId}/jobs`) return undefined;
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(String(offset));
    return { total_count: 3, jobs: Array.from({ length: offset === 0 ? 2 : 1 }, (_, index) => listJob({ id: `job-${offset + index}`, name: `migrate-${offset + index}` })) };
  });
  const rows = await drsManagement.inventory(session);
  assert.deepEqual(offsets, ["0", "2"]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "migrate-0");
  assert.equal(rows[0].status, "WAITING_FOR_START");
  assert.equal(rows[0].values?.engine, "mysql");
  assert.equal(rows[0].values?.jobType, "migration");
  assert.equal(rows[0].values?.billingTag, true);
  assert.ok(String(rows[0].values?.availableActions).includes("START"));
  assert.equal(rows[0].values?.childCount, 0);
});

test("DRS inventory fails closed on duplicate or missing job identities", async t => {
  cloud(t, url => url.pathname === `/v5/${session.projectId}/jobs` ? { total_count: 2, jobs: [listJob(), listJob({ name: "duplicate" })] } : undefined);
  await assert.rejects(drsManagement.inventory(session), /twice/);
  cloud(t, url => url.pathname === `/v5/${session.projectId}/jobs` ? { total_count: 1, jobs: [listJob({ id: "" })] } : undefined);
  await assert.rejects(drsManagement.inventory(session), /untrustworthy/);
});

test("DRS inspection reports status, endpoints, progress, and checks without credentials or native errors", async t => {
  cloud(t);
  const outcome = await drsManagement.execute(session, "inspect", {}, resource);
  const text = JSON.stringify(outcome);
  assert.ok(text.includes("192.168.1.10"));
  assert.ok(text.includes("INITIALIZING"));
  assert.ok(text.includes("100%"));
  assert.ok(!text.includes("PRIVATE_SOURCE_PASSWORD"));
  assert.ok(!text.includes("PRIVATE_TARGET_PASSWORD"));
  assert.ok(!text.includes("PRIVATE_SOURCE_ERROR"));
  assert.ok(!text.includes("PRIVATE_TARGET_ERROR"));
});

test("DRS operations reject stale, foreign, missing, and child-job identities before writing", async t => {
  const writes = cloud(t, url => url.pathname === `/v5/${session.projectId}/jobs/${jobId}` ? { job: detailJob({ id: "foreign-job" }) } : undefined);
  await assert.rejects(drsManagement.execute(session, "start", {}, resource), /identity/);
  await assert.rejects(drsManagement.execute(session, "rename", { name: "fresh-orders" }, resource), /identity/);
  assert.equal(writes.length, 0);

  cloud(t, () => new Response("gone", { status: 404 }));
  await assert.rejects(drsManagement.execute(session, "start", {}, resource), /no longer exists/);
  await assert.rejects(drsManagement.execute(session, "delete", {}, resource), /no longer exists/);

  const childWrites = cloud(t, url => url.pathname === `/v5/${session.projectId}/jobs/${jobId}` ? { job: detailJob({ master_job_id: "parent-job" }) } : undefined);
  await assert.rejects(drsManagement.execute(session, "start", {}, resource), /parent task/);
  await assert.rejects(drsManagement.execute(session, "delete", {}, resource), /parent task/);
  await assert.rejects(drsManagement.execute(session, "rename", { name: "fresh-orders" }, resource), /parent task/);
  assert.equal(childWrites.length, 0);
});

test("DRS lifecycle actions require live native availability and send exact wire bodies", async t => {
  const writes = cloud(t, url => url.pathname.endsWith("/actions") ? { job_action: { available_actions: [], unavailable_actions: commands, current_action: "" } } : undefined);
  for (const operation of ["precheck", "start", "pause", "retry"]) await assert.rejects(drsManagement.execute(session, operation, {}, resource), /does not currently offer/);
  await assert.rejects(drsManagement.execute(session, "terminate", {}, resource), /does not currently allow ending/);
  await assert.rejects(drsManagement.execute(session, "delete", {}, resource), /does not currently allow deleting/);
  assert.equal(writes.length, 0);

  const sent = cloud(t);
  const accepted = await drsManagement.execute(session, "start", {}, resource);
  assert.deepEqual(sent[0], { path: `/v5/${session.projectId}/jobs/${jobId}/action`, method: "POST", body: { job: { job_id: jobId, action_name: "start" } } });
  assert.equal(accepted.asynchronous, true);
  assert.equal(accepted.jobId, jobId);
  assert.match(accepted.message, /accepted/);
  assert.ok(!/succeeded|completed/i.test(accepted.message));
  for (const [operation, action] of [["pause", "stop"], ["retry", "restart"], ["precheck", "precheck"]] as const) {
    await drsManagement.execute(session, operation, operation === "precheck" ? { precheckMode: "forStartJob" } : {}, resource);
    assert.deepEqual(sent.at(-1)!.body, { job: { job_id: jobId, action_name: action, ...(operation === "precheck" ? { action_params: { precheck_mode: "forStartJob" } } : {}) } });
  }
});

test("DRS actions fail closed when the cloud omits the action query identity", async t => {
  cloud(t, (url, method) => method === "POST" && url.pathname.endsWith("/action") ? {} : undefined);
  await assert.rejects(drsManagement.execute(session, "start", {}, resource), /query ID/);
});

test("DRS end-task posts the native stop body and fails closed on embedded native failures", async t => {
  const writes = cloud(t);
  const ended = await drsManagement.execute(session, "terminate", {}, resource);
  assert.deepEqual(writes[0], { path: `/v5/${session.projectId}/jobs/${jobId}/stop`, method: "POST", body: { is_force_stop: false } });
  assert.equal(ended.asynchronous, true);
  await drsManagement.execute(session, "terminate", { force: true }, resource);
  assert.deepEqual(writes[1]!.body, { is_force_stop: true });

  cloud(t, (url, method) => method === "POST" && url.pathname.endsWith("/stop") ? { error_code: "DRS.4102", error_msg: "PRIVATE_STOP_ERROR", id: jobId, name: "migrate-orders", status: "failed" } : undefined);
  const rejected = await drsManagement.execute(session, "terminate", {}, resource).then(() => null, (error: unknown) => error);
  assert.ok(rejected instanceof Error);
  assert.match(rejected.message, /rejected/);
  assert.ok(!rejected.message.includes("PRIVATE_STOP_ERROR"));

  cloud(t, (url, method) => method === "POST" && url.pathname.endsWith("/stop") ? { id: jobId } : undefined);
  await assert.rejects(drsManagement.execute(session, "terminate", {}, resource), /unreadable/);
});

test("DRS delete observes the job afterwards and only claims removal once the job is gone", async t => {
  let deleteCount = 0;
  let goneAfterDelete = true;
  const writes = cloud(t, (url, method) => {
    if (method === "DELETE") { deleteCount++; return undefined; }
    if (goneAfterDelete && deleteCount > 0 && url.pathname === `/v5/${session.projectId}/jobs/${jobId}`) return new Response("gone", { status: 404 });
    return undefined;
  });
  const done = await drsManagement.execute(session, "delete", {}, resource);
  assert.deepEqual(writes[0], { path: `/v5/${session.projectId}/jobs/${jobId}`, method: "DELETE" });
  assert.match(done.message, /deleted/);
  assert.equal(done.asynchronous, undefined);

  goneAfterDelete = false;
  const pending = await drsManagement.execute(session, "delete", {}, resource);
  assert.equal(pending.asynchronous, true);
  assert.match(pending.message, /still exists/);
});

test("DRS updates send typed partial bodies and verify the native response identity", async t => {
  const writes = cloud(t);
  await drsManagement.execute(session, "rename", { name: "fresh-orders" }, resource);
  await drsManagement.execute(session, "describe", { description: "nightly run" }, resource);
  await drsManagement.execute(session, "auto-finish", { days: 21 }, resource);
  assert.deepEqual(writes.map(write => [write.method, write.body]), [
    ["PUT", { type: "name", params: { job_id: jobId, base_info: { name: "fresh-orders" } } }],
    ["PUT", { type: "description", params: { job_id: jobId, base_info: { description: "nightly run" } } }],
    ["PUT", { type: "expired_days", params: { job_id: jobId, base_info: { expired_days: "21" } } }],
  ]);

  cloud(t, (url, method) => method === "PUT" ? { error_code: "DRS.4001", error_msg: "PRIVATE_UPDATE_ERROR", id: jobId, name: "migrate-orders", status: "failed" } : undefined);
  const rejected = await drsManagement.execute(session, "rename", { name: "fresh-orders" }, resource).then(() => null, (error: unknown) => error);
  assert.ok(rejected instanceof Error);
  assert.match(rejected.message, /rejected/);
  assert.ok(!rejected.message.includes("PRIVATE_UPDATE_ERROR"));

  cloud(t, (url, method) => method === "PUT" ? { error_code: "0", id: "other-job", name: "other", status: "success" } : undefined);
  await assert.rejects(drsManagement.execute(session, "rename", { name: "fresh-orders" }, resource), /different job/);
});

test("DRS poll resolves each lifecycle operation from observed job state only", async t => {
  let status = "STARTJOBING";
  cloud(t, url => url.pathname === `/v5/${session.projectId}/jobs/${jobId}` ? { job: detailJob({ status }) } : undefined);
  assert.equal((await drsManagement.poll!(session, entry("Start job"))).state, "submitted");
  status = "FULL_TRANSFER_STARTED";
  assert.equal((await drsManagement.poll!(session, entry("Start job"))).state, "succeeded");
  status = "START_JOB_FAILED";
  assert.equal((await drsManagement.poll!(session, entry("Start job"))).state, "failed");
  status = "WAITING_FOR_START";
  assert.equal((await drsManagement.poll!(session, entry("Pause job"))).state, "submitted");
  status = "PAUSING";
  assert.equal((await drsManagement.poll!(session, entry("Pause job"))).state, "succeeded");
  status = "RELEASE_RESOURCE_STARTED";
  assert.equal((await drsManagement.poll!(session, entry("End task"))).state, "submitted");
  status = "RELEASE_RESOURCE_COMPLETE";
  assert.equal((await drsManagement.poll!(session, entry("End task"))).state, "succeeded");
  status = "RELEASE_RESOURCE_FAILED";
  assert.equal((await drsManagement.poll!(session, entry("End task"))).state, "failed");
  status = "FULL_TRANSFER_FAILED";
  assert.equal((await drsManagement.poll!(session, entry("Retry failed job"))).state, "submitted");
  status = "INCRE_TRANSFER_STARTED";
  assert.equal((await drsManagement.poll!(session, entry("Retry failed job"))).state, "succeeded");
  status = "STARTJOBING";
  const observed = await drsManagement.poll!(session, entry("Start job"));
  assert.ok(!JSON.stringify(observed).includes("PRIVATE"));
});

test("DRS poll tracks pre-check progress and never reports an unfinished check as done", async t => {
  let process = "56%";
  cloud(t, url => url.pathname === `/v5/${session.projectId}/jobs/${jobId}` ? { job: detailJob({ precheck_result: { result: false, process, total_passed_rate: "56%" } }) } : undefined);
  assert.equal((await drsManagement.poll!(session, { ...entry("Run pre-check"), jobId: "original-query" })).state, "submitted");
  process = "100%";
  const done = await drsManagement.poll!(session, { ...entry("Run pre-check"), jobId: "original-query" });
  assert.equal(done.state, "failed");
  assert.match(done.message!, /passed rate/);
});

test("DRS poll treats a missing job as deleted only for the delete operation", async t => {
  cloud(t, () => new Response("gone", { status: 404 }));
  assert.equal((await drsManagement.poll!(session, entry("Delete job"))).state, "succeeded");
  assert.equal((await drsManagement.poll!(session, entry("Start job"))).state, "failed");
});

test("DRS poll rejects a job whose cloud identity no longer matches", async t => {
  cloud(t, url => url.pathname === `/v5/${session.projectId}/jobs/${jobId}` ? { job: detailJob({ id: "foreign-job" }) } : undefined);
  await assert.rejects(drsManagement.poll!(session, entry("Start job")), /identity/);
});

test("DRS detail explicitly selects native detail and pre-check observes only its original query", async t => {
  const queries: string[] = [];
  cloud(t, url => {
    if (url.pathname !== `/v5/${session.projectId}/jobs/${jobId}`) return undefined;
    queries.push(url.search);
    if (url.searchParams.get("type") === "precheck") return { job: { id: jobId, precheck_result: { process: "100%", result: true, total_passed_rate: "100%" } } };
    return { job: detailJob({ precheck_result: { process: "100%", result: false } }) };
  });
  await drsManagement.execute(session, "inspect", {}, resource);
  const outcome = await drsManagement.poll!(session, { ...entry("Run pre-check"), jobId: "original-query" });
  assert.equal(outcome.state, "succeeded");
  assert.ok(queries.includes("?type=detail"));
  assert.ok(queries.includes("?type=precheck&query_id=original-query"));
  await assert.rejects(drsManagement.poll!(session, entry("Run pre-check")), /original native query ID/);
});

test("DRS pre-check sends required purpose and saves actual query ID", async t => {
  const writes = cloud(t);
  await assert.rejects(drsManagement.execute(session, "precheck", {}, resource), /pre-check purpose/);
  assert.equal(writes.length, 0);
  const outcome = await drsManagement.execute(session, "precheck", { precheckMode: "forRetryJob" }, resource);
  assert.deepEqual(writes[0].body, { job: { job_id: jobId, action_name: "precheck", action_params: { precheck_mode: "forRetryJob" } } });
  assert.equal(outcome.jobId, "query-123");
});

test("DRS mutations refuse hidden actions, active commands, foreign ownership, and changed deletion names", async t => {
  for (const action of [{}, { available_actions: commands, current_action: "START" }]) {
    const writes = cloud(t, url => url.pathname.endsWith("/actions") ? { job_action: action } : undefined);
    await assert.rejects(drsManagement.execute(session, "rename", { name: "updated-job" }, resource), /unverified|active/);
    assert.equal(writes.length, 0);
  }
  const foreignWrites = cloud(t, url => url.pathname.endsWith(jobId) ? { job: detailJob({ project_id: "foreign" }) } : undefined);
  await assert.rejects(drsManagement.execute(session, "start", {}, resource), /different project/);
  assert.equal(foreignWrites.length, 0);
  const changed = cloud(t, url => url.pathname.endsWith(jobId) ? { job: detailJob({ base_info: { name: "changed" } }) } : undefined);
  await assert.rejects(drsManagement.execute(session, "delete", {}, resource), /name changed/);
  assert.equal(changed.length, 0);
});

test("DRS private HTTP, native business, and malformed JSON errors are redacted", async t => {
  for (const response of [new Response("PRIVATE_PASSWORD", { status: 403 }), Response.json({ error_code: "DRS.1", error_msg: "PRIVATE_PASSWORD" }), new Response("PRIVATE_PASSWORD", { status: 200 })]) {
    t.mock.method(globalThis, "fetch", async () => response.clone());
    await assert.rejects(drsManagement.inventory(session), error => error instanceof Error && !error.message.includes("PRIVATE_PASSWORD"));
  }
});

test("DRS lifecycle history rejects another original task identity and unknown operation", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { calls.push(input); return Response.json({}); });
  await assert.rejects(drsManagement.poll!(session, { ...entry("Start job"), jobId: "foreign" }), /different DRS job identity/);
  await assert.rejects(drsManagement.poll!(session, entry("Forged action")), /no lifecycle observation/);
  assert.deepEqual(calls, []);
});

test("DRS acknowledges synchronous native actions while retaining state observation", async t => {
  cloud(t, (url, method) => method === "POST" && url.pathname.endsWith("/action") ? { status: "success" } : undefined);
  const outcome = await drsManagement.execute(session, "start", {}, resource);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, jobId);
});
