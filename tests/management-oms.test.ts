import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { omsManagement } from "@/lib/huawei/management/adapters/oms";
import { session } from "./fixtures/session";
const current = { id: 123, name: "Migration", status: 2, task_type: "prefix", group_type: "NORMAL_TASK", src_node: { cloud_type: "AWS", region: "us-east-1", bucket: "source-bucket", object_key: ["orders/"] }, dst_node: { region: session.region, bucket: "destination", save_prefix: "import/" }, progress: 50, failed_num: 0 };
const resource = { id: "123", name: current.name };
const credentials = { sourceAk: "source-access", sourceSk: "source-secret", destinationAk: "destination-access", destinationSk: "destination-secret" };
function mock(t: TestContext, change: (url: URL) => Record<string, unknown> | undefined = () => undefined) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith("securitytokens")) return Response.json({ credential: { access: "access", secret: "secret", securitytoken: "token" } });
    if (url.hostname.startsWith("obs.")) return new Response(`<ListAllMyBucketsResult><Buckets><Bucket><Name>destination</Name><Location>${session.region}</Location></Bucket><Bucket><Name>foreign</Name><Location>eu-west-101</Location></Bucket></Buckets></ListAllMyBucketsResult>`);
    if (init.method) { writes.push({ path: url.pathname, method: init.method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) }); return Response.json({ id: 456 }); }
    return Response.json(change(url) ?? (url.pathname.endsWith("/tasks") ? { tasks: [current], count: 1 } : current));
  }); return writes;
}
test("OMS destination choices include only current regional OBS buckets", async t => {
  mock(t); const choices = await omsManagement.options!(session, "create"); assert.deepEqual(choices.buckets.map(bucket => bucket.value), ["destination"]);
});
test("OMS creation starts immediately with native prefixes, bandwidth, and explicit overwrite mode", async t => {
  const writes = mock(t);
  const result = await omsManagement.execute(session, "create", { ...credentials, sourceCloud: "AWS", sourceRegion: "us-east-1", sourceBucket: "source-bucket", sourcePrefix: "orders/", destinationBucket: "destination", destinationPrefix: "import/", overwrite: "NO_OVERWRITE", bandwidth: 50 });
  assert.deepEqual(writes[0].body, { task_type: "prefix", src_node: { cloud_type: "AWS", region: "us-east-1", bucket: "source-bucket", ak: credentials.sourceAk, sk: credentials.sourceSk, object_key: ["orders/"] }, dst_node: { bucket: "destination", region: session.region, ak: credentials.destinationAk, sk: credentials.destinationSk, save_prefix: "import/" }, description: "", bandwidth_policy: [{ start: "00:00", end: "23:59", max_bandwidth: 52428800 }], object_overwrite_mode: "NO_OVERWRITE", enable_metadata_migration: false, enable_restore: false, enable_failed_object_recording: true, enable_requester_pays: false, dst_storage_policy: "STANDARD", consistency_check: "size_last_modified" });
  assert.equal(result.resourceId, "456"); assert.equal(result.jobId, "456"); assert.equal(result.asynchronous, true); assert.ok(!JSON.stringify(result).includes(credentials.sourceSk));
});
test("OMS refuses foreign destinations and migrations back into the same OBS bucket", async t => {
  const writes = mock(t); const values = { ...credentials, sourceCloud: "HuaweiCloud", sourceRegion: session.region, sourceBucket: "destination", destinationBucket: "destination", overwrite: "NO_OVERWRITE", bandwidth: 50 };
  await assert.rejects(omsManagement.execute(session, "create", { ...values, destinationBucket: "foreign" }), /current OBS/);
  await assert.rejects(omsManagement.execute(session, "create", values), /same OBS bucket/); assert.equal(writes.length, 0);
});
test("OMS mutations revalidate native task scope and refuse running deletion", async t => {
  let foreign = false; const writes = mock(t, url => foreign && url.pathname.endsWith("/123") ? { ...current, id: 999 } : undefined);
  await assert.rejects(omsManagement.execute(session, "delete", {}, resource), /stopped, failed, or completed/);
  foreign = true; await assert.rejects(omsManagement.execute(session, "pause", {}, resource), /unverified/);
  await assert.rejects(omsManagement.execute(session, "pause", {}, { id: "999", name: "Foreign" }), /no longer belongs/); assert.equal(writes.length, 0);
});
test("OMS paused-task retry uses fresh credentials and refuses empty failed-only retry", async t => {
  const writes = mock(t, url => url.pathname.endsWith("/123") ? { ...current, status: 3 } : undefined);
  await assert.rejects(omsManagement.execute(session, "resume", { ...credentials, failedOnly: true }, resource), /no verified failed objects/);
  await omsManagement.execute(session, "resume", { ...credentials, failedOnly: false }, resource);
  assert.deepEqual(writes[0], { path: "/v2/project-1/tasks/123/start", method: "POST", body: { src_ak: credentials.sourceAk, src_sk: credentials.sourceSk, dst_ak: credentials.destinationAk, dst_sk: credentials.destinationSk, migrate_failed_object: false } });
});
test("OMS bandwidth and priority updates affect only the selected native task", async t => {
  let status = 2; const writes = mock(t, url => url.pathname.endsWith("/123") ? { ...current, status } : undefined);
  await assert.rejects(omsManagement.execute(session, "priority", { priority: "HIGH" }, resource), /only for waiting/); status = 1;
  await omsManagement.execute(session, "priority", { priority: "HIGH" }, resource); await omsManagement.execute(session, "bandwidth", { bandwidth: 1 }, resource);
  assert.deepEqual(writes.map(write => write.body), [{ ids: [123], task_priority: "HIGH" }, { ids: [123], bandwidth_policy: [{ start: "00:00", end: "23:59", max_bandwidth: 1048576 }] }]);
});
test("OMS polling distinguishes paused requests, migration failure, and completion", async t => {
  let status = 2; mock(t, url => url.pathname.endsWith("/123") ? { ...current, status } : undefined);
  const entry = { id: "request", service: "oms", operation: "Create and start migration", resourceId: resource.id, jobId: resource.id, projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted" as const };
  assert.equal((await omsManagement.poll!(session, entry)).state, "submitted"); status = 5; assert.equal((await omsManagement.poll!(session, entry)).state, "succeeded"); status = 4; assert.equal((await omsManagement.poll!(session, entry)).state, "failed"); status = 3;
  assert.equal((await omsManagement.poll!(session, { ...entry, operation: "Pause migration" })).state, "succeeded"); assert.equal((await omsManagement.poll!(session, entry)).state, "failed");
});
