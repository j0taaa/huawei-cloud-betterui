import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mgcManagement } from "@/lib/huawei/management/adapters/mgc";
import { smsManagement } from "@/lib/huawei/management/adapters/sms";
import { omsManagement } from "@/lib/huawei/management/adapters/oms";
import { cdmManagement } from "@/lib/huawei/management/adapters/cdm";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { CloudLoadError } from "@/lib/huawei/errors";
import type { ManagementAdapter } from "@/lib/huawei/management/types";
import { session } from "./fixtures/session";

function inventory(t: TestContext) {
  t.mock.method(smsManagement, "inventory", async () => [{ id: "same-native-id", name: "Server move", status: "READY" }]);
  t.mock.method(omsManagement, "inventory", async () => [{ id: "same-native-id", name: "Object move", status: "1" }]);
  t.mock.method(cdmManagement, "inventory", async () => [{ id: "same-native-id", name: "Data move", status: "200" }]);
}

test("Migration rollup keeps same-ID native resources and their workflows separate", async t => {
  inventory(t);
  const resources = await mgcManagement.inventory(session);
  assert.deepEqual(resources.map(resource => resource.id), ["sms:same-native-id", "oms:same-native-id", "cdm:same-native-id"]);
  assert.deepEqual(resources.map(resource => resource.values?.migrationService), ["SMS", "OMS", "CDM"]);
  assert.ok(mgcManagement.operations.every(operation => operation.kind === "create" || operation.resourcePrefixes?.every(prefix => prefix.startsWith(operation.id.split(":")[0] + ":"))));
  assert.ok(mgcManagement.operations.some(operation => operation.id === "sms:create"));
  assert.ok(mgcManagement.operations.some(operation => operation.id === "oms:create"));
  assert.ok(mgcManagement.operations.some(operation => operation.id === "cdm:create"));
});

test("Rollup routes form options to the selected service and preserves native choice IDs", async t => {
  t.mock.method(smsManagement as Required<ManagementAdapter>, "options", async (...[_session, operation, resource]: Parameters<NonNullable<ManagementAdapter["options"]>>) => {
    assert.equal(_session.projectId, session.projectId);
    assert.equal(operation, "speed");
    assert.equal(resource?.id, "same-native-id");
    return { sources: [{ value: "native-source", label: "Source" }] };
  });
  assert.deepEqual(await mgcManagement.options!(session, "sms:speed", { id: "sms:same-native-id", name: "Server move" }), { sources: [{ value: "native-source", label: "Source" }] });
  await assert.rejects(mgcManagement.options!(session, "sms:unimplemented"), /Unsupported/);
  await assert.rejects(mgcManagement.options!(session, "sms:speed", { id: "oms:same-native-id", name: "Object move" }), /different migration service/);
});

test("Fresh native state overrides stale rollup resources before a delegated write", async t => {
  inventory(t);
  let calls = 0;
  t.mock.method(smsManagement, "execute", async (...[_session, operation, values, resource]: Parameters<ManagementAdapter["execute"]>) => {
    assert.equal(_session.projectId, session.projectId);
    calls++;
    assert.equal(operation, "rename");
    assert.equal(values.name, "Renamed");
    assert.equal(resource?.id, "same-native-id");
    assert.equal(resource?.status, "READY");
    assert.equal(resource?.name, "Server move");
    return { message: "Renamed", resourceId: "same-native-id" };
  });
  const result = await mgcManagement.execute(session, "sms:rename", { name: "Renamed" }, { id: "sms:same-native-id", name: "Stale name", status: "FAIL" });
  assert.equal(result.resourceId, "sms:same-native-id");
  assert.equal(calls, 1);
  t.mock.method(smsManagement, "inventory", async () => [{ id: "same-native-id", name: "Server move", status: "UNKNOWN" }]);
  await assert.rejects(mgcManagement.execute(session, "sms:rename", { name: "Renamed" }, { id: "sms:same-native-id", name: "Server move" }), /current state/);
  await assert.rejects(mgcManagement.execute(session, "sms:rename", { name: "Renamed" }, { id: "sms:missing", name: "Missing" }), /no longer exists/);
  await assert.rejects(mgcManagement.execute(session, "sms:rename", { name: "Renamed" }, { id: "oms:same-native-id", name: "Object move" }), /different migration service/);
  assert.equal(calls, 1);
});

test("Native creation resource and original task identity retain their service namespace", async t => {
  t.mock.method(cdmManagement, "execute", async (...[_session, operation, values, resource]: Parameters<ManagementAdapter["execute"]>) => {
    assert.equal(_session.projectId, session.projectId);
    assert.equal(operation, "create");
    assert.equal(values.name, "PrivateMigration");
    assert.equal(resource, undefined);
    return { message: "Accepted", resourceId: "cluster-native", jobId: "original:job:record", asynchronous: true };
  });
  const result = await mgcManagement.execute(session, "cdm:create", { name: "PrivateMigration" });
  assert.equal(result.resourceId, "cdm:cluster-native");
  assert.equal(result.jobId, "cdm:original:job:record");
  assert.equal(result.asynchronous, true);
});

test("Native polling receives the exact saved job, resource, and original operation label", async t => {
  t.mock.method(cdmManagement as Required<ManagementAdapter>, "poll", async (...[_session, entry]: Parameters<NonNullable<ManagementAdapter["poll"]>>) => {
    assert.equal(_session.projectId, session.projectId);
    assert.equal(entry.service, "cdm");
    assert.equal(entry.operation, "Start job");
    assert.equal(entry.resourceId, "cluster-native");
    assert.equal(entry.jobId, "original:job:record");
    return { state: "submitted" as const, message: "Running", resourceId: "cluster-native" };
  });
  const entry = { id: "request", service: "mgc", operation: "CDM · Start job", resourceId: "cdm:cluster-native", jobId: "cdm:original:job:record", startedAt: new Date().toISOString(), state: "submitted" as const };
  assert.deepEqual(await mgcManagement.poll!(session, entry), { state: "submitted", message: "Running", resourceId: "cdm:cluster-native" });
  await assert.rejects(mgcManagement.poll!(session, { ...entry, resourceId: "sms:cluster-native" }), /different migration service/);
  await assert.rejects(mgcManagement.poll!(session, { ...entry, operation: "SMS · Start job" }), /no verified native progress/);
  await assert.rejects(mgcManagement.poll!(session, { ...entry, jobId: "missing:job" }), /supported SMS/);
});

test("Native SMS deletion polling recognizes its original label and verified 404", async t => {
  const id = "a".repeat(32);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    assert.equal(new URL(input).pathname, `/v3/tasks/${id}`);
    return Response.json({ error_code: "SMS.404", error_msg: "Task not found" }, { status: 404 });
  });
  const result = await mgcManagement.poll!(session, { id: "request", service: "mgc", operation: "SMS · Delete inactive migration task", resourceId: `sms:${id}`, jobId: `sms:${id}`, startedAt: new Date().toISOString(), state: "submitted" });
  assert.equal(result.state, "succeeded");
});

test("Partial migration inventories retain scoped resources while marking the complete inventory unavailable", async t => {
  inventory(t);
  t.mock.method(omsManagement, "inventory", async () => { throw new CloudLoadError("Permission denied", [{ id: "partial-object", name: "Partial", status: "1" }]); });
  await assert.rejects(mgcManagement.inventory(session), error => {
    assert.ok(error instanceof CloudLoadError);
    assert.match(error.message, /OMS/);
    assert.deepEqual((error.partialData as { id: string }[]).map(resource => resource.id), ["sms:same-native-id", "oms:partial-object", "cdm:same-native-id"]);
    return true;
  });
});

test("Rollup invalidation covers the aggregate and correct native inventories", () => {
  const scoped = mgcManagement.invalidationKeys({ id: "sms:same-native-id", name: "Server move" });
  assert.ok(scoped.includes(cloudCacheKeys.listMgcMigrationItems));
  assert.ok(scoped.includes(cloudCacheKeys.listSmsTasks));
  assert.ok(!scoped.includes(cloudCacheKeys.listCdmClusters));
  const all = mgcManagement.invalidationKeys();
  assert.ok(all.includes(cloudCacheKeys.listCdmClusters));
  assert.ok(all.includes(cloudCacheKeys.listOmsMigrationTasks));
});
