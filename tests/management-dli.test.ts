import assert from "node:assert/strict";
import { test } from "node:test";
import { dliManagement } from "@/lib/huawei/management/adapters/dli";
import { listDliQueuesForProject } from "@/lib/huawei/services/dli";
import { validateManagementValues, type ManagementResource } from "@/lib/management-contract";
import { session } from "./fixtures/session";
const resource: ManagementResource = { id: "analytics", name: "analytics", values: { engine: "spark", queueType: "sql" } };
const queue = { is_success: true, queueName: "analytics", queueType: "sql", cuCount: 64, chargingMode: 1, resource_mode: 1, resource_type: "vm" };
const job = { job_id: "job-1", queue_name: "analytics", job_type: "QUERY", status: "FINISH", duration: 20 };
function read(url: URL) {
  if (url.pathname.endsWith("/queues")) return { is_success: true, queues: [{ queue_name: "analytics", queue_type: "sql", cu_count: 64, charging_mode: 1, engine: "spark" }] };
  if (url.pathname.endsWith("/queues/analytics")) return queue;
  if (url.pathname.endsWith("/jobs")) return { is_success: true, job_count: 1, jobs: [job] };
  if (url.pathname.endsWith("/job-1/status")) return { ...job, is_success: true };
  if (url.pathname.endsWith("/properties")) return { is_success: true, properties: [{ key: "computeEngine.maxInstances", value: "4" }, { key: "job.maxConcurrent", value: "2" }, { key: "computeEngine.maxPrefetchInstance", value: "1" }] };
  throw Error(`Unexpected DLI read ${url}`);
}
test("DLI creates case-normalized CU-hour queues and rejects duplicates or invalid names", async t => {
  let sent: unknown; let target = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); target = new URL(input).pathname; sent = JSON.parse(String(init.body)); return Response.json({ is_success: true, queue_name: "new_queue" }); });
  const op = dliManagement.operations.find(op => op.id === "create")!;
  assert.throws(() => validateManagementValues(op, { name: "123", type: "sql", cu: "16" }), /format/);
  await assert.rejects(dliManagement.execute(session, "create", { name: "ANALYTICS" }), /already exists/);
  assert.equal(sent, undefined);
  const values = validateManagementValues(op, { name: "NEW_QUEUE", type: "sql", cu: "16", dedicated: true, enterpriseProjectId: "0" });
  const result = await dliManagement.execute(session, "create", values);
  assert.equal(target, "/v1.0/project-1/queues");
  assert.deepEqual(sent, { queue_name: "new_queue", queue_type: "sql", description: "", cu_count: 16, charging_mode: 1, resource_mode: 1, platform: "x86_64", feature: "basic", enterprise_project_id: "0" });
  assert.equal(result.asynchronous, true); assert.equal(result.resourceId, "new_queue");
});
test("DLI preserves numeric billing modes and surfaces successful-HTTP provider failures", async t => {
  let failed = false;
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(failed ? { is_success: false, queues: [], message: "Permission denied" } : read(new URL(input))));
  assert.equal((await listDliQueuesForProject(session))[0].chargingMode, "1");
  failed = true; await assert.rejects(listDliQueuesForProject(session), /Permission denied/);
  await assert.rejects(dliManagement.execute(session, "inspect", {}, resource), /Huawei rejected/);
});
test("DLI SQL submission uses the native queue engine and avoids retaining SQL in its outcome", async t => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({ is_success: true, job_id: "submitted-1" }); });
  const result = await dliManagement.execute(session, "submit-sql", { sql: "SELECT 1", database: "events", catalog: "dli" }, resource);
  assert.deepEqual(sent, { queue_name: "analytics", sql: "SELECT 1", engine_type: "spark", currentdb: "events", current_catalog: "dli" });
  assert.equal(result.jobId, "submitted-1"); assert.equal(result.asynchronous, true); assert.ok(!JSON.stringify(result).includes("SELECT 1"));
  await assert.rejects(dliManagement.execute(session, "submit-sql", { sql: "SELECT 1" }, { ...resource, values: { engine: "unknown" } }), /engine could not be verified/);
});
test("DLI job selectors paginate and exclude jobs from foreign queues", async t => {
  const pages: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input); const page = url.searchParams.get("current-page")!; pages.push(page);
    if (page === "1") return Response.json({ is_success: true, job_count: 101, jobs: Array.from({ length: 100 }, (_, i) => ({ ...job, job_id: `job-${i}` })) });
    return Response.json({ is_success: true, job_count: 101, jobs: [{ ...job, queue_name: "foreign", job_id: "foreign-job" }] });
  });
  const choices = await dliManagement.options!(session, "job-status", resource);
  assert.deepEqual(pages, ["1", "2"]); assert.equal(choices.jobs.length, 100); assert.ok(!choices.jobs.some(j => j.value === "foreign-job"));
});
test("DLI blocks stale and foreign job IDs before cancellation", async t => {
  let writes = 0; let foreign = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (init.method) { writes++; return Response.json({ is_success: true }); } const url = new URL(input); return Response.json(foreign && url.pathname.endsWith("/status") ? { ...job, is_success: true, queue_name: "foreign" } : read(url)); });
  await assert.rejects(dliManagement.execute(session, "cancel-job", { job: "missing" }, resource), /current SQL job/);
  foreign = true; await assert.rejects(dliManagement.execute(session, "cancel-job", { job: "job-1" }, resource), /no longer belongs/);
  assert.equal(writes, 0);
});
test("DLI protects default, pooled, general, and actively used queues from deletion", async t => {
  let writes = 0; let current = { ...queue }; let running = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return Response.json({ is_success: true }); }
    const url = new URL(input);
    if (url.pathname.endsWith("/queues/analytics")) return Response.json(current);
    if (url.pathname.endsWith("/queues/default")) return Response.json({ ...queue, queueName: "default", chargingMode: 0 });
    if (running && url.pathname.endsWith("/jobs")) return Response.json({ is_success: true, job_count: 1, jobs: [{ ...job, status: "RUNNING" }] });
    return Response.json(read(url));
  });
  await assert.rejects(dliManagement.execute(session, "delete", {}, { id: "default", name: "default" }), /non-default/);
  current = { ...queue, elastic_resource_pool_name: "pool" } as typeof queue; await assert.rejects(dliManagement.execute(session, "delete", {}, resource), /elastic resource pool/);
  current = { ...queue, queueType: "general" }; await assert.rejects(dliManagement.execute(session, "delete", {}, resource), /SQL queues only/);
  current = { ...queue }; running = true; await assert.rejects(dliManagement.execute(session, "delete", {}, resource), /active SQL/);
  assert.equal(writes, 0);
});
test("DLI scaling validates total CU direction and uses PUT action with result-only success", async t => {
  let sent: unknown; let target = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); assert.equal(init.method, "PUT"); target = new URL(input).pathname; sent = JSON.parse(String(init.body)); return Response.json({ queue_name: "analytics", result: true }); });
  await assert.rejects(dliManagement.execute(session, "scale-out", { cu: 32 }, resource), /direction/);
  await assert.rejects(dliManagement.execute(session, "scale-out", { cu: 65 }, resource), /multiple of 16/);
  await dliManagement.execute(session, "scale-out", { cu: 128 }, resource);
  assert.equal(target, "/v1.0/project-1/queues/analytics/action"); assert.deepEqual(sent, { action: "scale_out", cu_count: 128 });
});
test("DLI concurrency prefill accepts native plural alias and sends only chosen settings", async t => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({ is_success: true }); });
  const current = { ...resource }; await dliManagement.options!(session, "configure-concurrency", current);
  assert.equal(current.values?.drivers, 4);
  await assert.rejects(dliManagement.execute(session, "configure-concurrency", { drivers: 4, jobsPerDriver: 2, prefetch: 5 }, resource), /cannot exceed/);
  assert.equal(sent, undefined);
  await dliManagement.execute(session, "configure-concurrency", { drivers: 4, jobsPerDriver: 2, prefetch: 1 }, resource);
  assert.deepEqual(sent, { properties: { "computeEngine.maxInstance": 4, "job.maxConcurrent": 2, "computeEngine.maxPrefetchInstance": 1 } });
});
test("DLI polling distinguishes completion, failure, cancellation, and active work", async t => {
  let status = "FINISH";
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...job, is_success: true, status }));
  const entry = { id: "request", service: "dli", operation: "Submit SQL job", resourceId: "analytics", jobId: "job-1", projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted" as const };
  assert.equal((await dliManagement.poll!(session, entry)).state, "succeeded");
  for (const state of ["FAILED", "CANCELLED"]) { status = state; assert.equal((await dliManagement.poll!(session, entry)).state, "failed"); }
  status = "RUNNING"; assert.equal((await dliManagement.poll!(session, entry)).state, "submitted");
});
test("DLI refuses HTTP-200 mutation failure or a missing confirmation", async t => {
  let response: Record<string, unknown> = { is_success: false };
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => Response.json(init.method ? response : read(new URL(input))));
  await assert.rejects(dliManagement.execute(session, "submit-sql", { sql: "SELECT 1" }, resource), /Huawei rejected/);
  response = {}; await assert.rejects(dliManagement.execute(session, "submit-sql", { sql: "SELECT 1" }, resource), /no DLI operation confirmation/);
});
