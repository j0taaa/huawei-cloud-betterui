import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { ManagementInputError, validateManagementValues, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { dcsManagement } from "@/lib/huawei/management/adapters/dcs";
import { kafkaManagement } from "@/lib/huawei/management/adapters/kafka";
import type { ManagementAdapter } from "@/lib/huawei/management/types";
import { session } from "./fixtures/session";

const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-cache-kafka-management-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));

/** Mirrors the management framework: fresh inventory, ownership, status gate, dynamic choices, then execute. */
async function run(adapter: ManagementAdapter, operation: string, values: Record<string, unknown> = {}, resourceId = "instance-1") {
  const definition: ManagementOperation | undefined = adapter.operations.find((item) => item.id === operation);
  if (!definition) throw new ManagementInputError("Unsupported operation.");
  const resource: ManagementResource | undefined = (await adapter.inventory(session)).find((item) => item.id === resourceId);
  if (definition.kind !== "create" && !resource) throw new ManagementInputError("The resource was not found in the selected project.", 404);
  if (resource && definition.allowedStatuses && !definition.allowedStatuses.includes(resource.status ?? "UNKNOWN")) throw new ManagementInputError(`This operation is unavailable while the resource status is ${resource.status ?? "UNKNOWN"}.`, 409);
  const options = adapter.options ? await adapter.options(session, operation, resource) : {};
  return adapter.execute(session, operation, validateManagementValues(definition, values, options), resource);
}
async function owned(adapter: ManagementAdapter) {
  return (await adapter.inventory(session)).find((item) => item.id === "instance-1")!;
}

type Write = { path: string; method: string; body: Record<string, unknown> };
function read(url: URL) {
  if (url.host.startsWith("vpc.")) {
    if (url.pathname.endsWith("/subnets")) return { subnets: [{ id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet", cidr: "10.0.0.0/24" }] };
    if (url.pathname.endsWith("security-groups")) return { security_groups: [{ id: "sg-1", name: "Security" }] };
  }
  if (url.host.startsWith("dcs.")) {
    if (url.pathname === `/v2/${session.projectId}/instances`) return { total_count: 1, instances: [{ instance_id: "instance-1", name: "Cache One", status: "RUNNING", capacity: 16, spec_code: "redis.ha.large.4", charging_mode: 0 }] };
    if (url.pathname.endsWith("/flavors")) return { flavors: [{ spec_code: "redis.ha.large.4", engine: "Redis", engine_version: "4.0", cache_mode: "ha", capacity: ["16", "32"], billing_mode: ["Hourly"], flavors_available_zones: [{ capacity: "16", az_codes: ["az-a"] }, { capacity: "32", az_codes: ["az-a"] }] }] };
    if (url.pathname.endsWith("available-zones")) return { available_zones: [{ code: "az-a", name: "Zone A", resource_availability: "true" }, { code: "az-sold-out", name: "Zone B", resource_availability: "false" }] };
    if (url.pathname.endsWith("/backups")) return { total_num: 2, backup_record_response: [{ backup_id: "backup-1", backup_name: "Manual backup", status: "succeed", size: 2048, created_at: "2026-01-01T00:00:00Z", is_support_restore: true }, { backup_id: "backup-2", backup_name: "Auto backup", status: "succeed", size: 1024, is_support_restore: false }] };
  }
  if (url.host.startsWith("dms.")) {
    if (url.pathname === `/v2/${session.projectId}/instances`) return { total_count: 1, instances: [{ instance_id: "instance-1", name: "Kafka One", status: "RUNNING", storage_space: 300, broker_num: 3, charging_mode: 0 }] };
    if (url.pathname === `/v2/${session.projectId}/instances/instance-1`) return { instance_id: "instance-1", name: "Kafka One", status: "RUNNING", broker_num: 3, total_storage_space: 300, storage_space: 100, ssl_enable: true };
    if (url.pathname.endsWith("/kafka/products")) return { engine: "kafka", versions: ["2.7"], products: [{ product_id: "kafka.cluster.s1", type: "cluster", charging_mode: ["hourly"], arch_types: ["X86"], properties: { min_broker: 3, max_broker: 30, min_storage_per_node: 100, max_storage_per_node: 30000, engine_versions: "2.7" }, ios: [{ io_spec: "dms.physical.storage.high.v2", available_zones: ["az-1", "az-2", "az-3"] }] }] };
    if (url.pathname.endsWith("available-zones")) return { available_zones: [{ id: "az-1", name: "Zone 1" }, { id: "az-2", name: "Zone 2" }, { id: "az-9", name: "Zone 9" }, { id: "az-sold-out", name: "Zone 3", sold_out: true }] };
    if (url.pathname.endsWith("/topics")) return { total: 1, remain_partitions: 197, max_partitions: 300, topics: [{ name: "events", partition: 3, replication: 3, retention_time: 72 }] };
    if (url.pathname.endsWith("/users")) return { users: [{ user_name: "producer", role: "admin", user_desc: "ingest app", user_passwd: "must-not-expose" }] };
  }
  throw new Error(`Unexpected mocked GET ${url.host}${url.pathname}`);
}
function mockCloud(t: { mock: { method: (object: object, key: "fetch", implementation: (input: string, init: RequestInit) => Promise<Response>) => unknown } }, writes: Write[], respond: (url: URL) => Response = () => Response.json({})) {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) {
      writes.push({ path: url.pathname, method: init.method, body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown> });
      return respond(url);
    }
    return Response.json(read(url));
  });
}

const dcsOffering = JSON.stringify(["redis.ha.large.4", "4.0", "32"]);
const dcsCreate = { name: "CacheApp", offering: dcsOffering, subnet: "subnet-1", securityGroup: "sg-1", zone: "az-a", noPasswordAccess: false, password: "SecretPass1!", enterpriseProjectId: "0" };
const kafkaOffering = JSON.stringify(["kafka.cluster.s1", "2.7", "dms.physical.storage.high.v2"]);
const kafkaCreate = { name: "StreamApp", offering: kafkaOffering, subnet: "subnet-1", securityGroup: "sg-1", zones: ["az-1"], brokers: 3, storage: 300, ssl: true, accessUser: "owner", password: "SecretPass1!", enterpriseProjectId: "0" };

test("DCS create sends the documented pay-per-use payload from live flavor and zone choices", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ instances: [{ instance_id: "created-redis", instance_name: "CacheApp" }] }));
  const result = await run(dcsManagement, "create", dcsCreate);
  assert.equal(result.resourceId, "created-redis");
  assert.equal(result.asynchronous, true);
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/instances`, method: "POST", body: { name: "CacheApp", engine: "Redis", engine_version: "4.0", capacity: 32, spec_code: "redis.ha.large.4", az_codes: ["az-a"], vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", description: "", instance_num: 1, enable_publicip: false, no_password_access: false, password: "SecretPass1!", enterprise_project_id: "0", bss_param: { charging_mode: "postPaid" } } }]);
});

test("DCS create rejects forged choices, unavailable zones, and missing or weak passwords before any mutation", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes);
  await assert.rejects(run(dcsManagement, "create", { ...dcsCreate, offering: JSON.stringify(["forged", "4.0", "32"]) }), /not available/);
  await assert.rejects(run(dcsManagement, "create", { ...dcsCreate, zone: "az-sold-out" }), /not available/);
  await assert.rejects(run(dcsManagement, "create", { ...dcsCreate, password: undefined }), /Password is required/);
  await assert.rejects(run(dcsManagement, "create", { ...dcsCreate, password: "weakpass" }), /three character groups/);
  assert.equal(writes.length, 0);
  const open = await run(dcsManagement, "create", { ...dcsCreate, noPasswordAccess: true, password: undefined });
  assert.equal(open.asynchronous, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.no_password_access, true);
  assert.equal("password" in writes[0].body, false);
});

test("DCS restart and delete protect ownership and use the native status contract", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ results: [{ instance: "instance-1", result: "success" }] }));
  await assert.rejects(run(dcsManagement, "restart", {}, "other-instance"), /not found/);
  assert.equal(writes.length, 0);
  const restart = await run(dcsManagement, "restart");
  assert.equal(restart.asynchronous, true);
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/instances/status`, method: "PUT", body: { action: "restart", instances: ["instance-1"] } }]);
  await run(dcsManagement, "delete");
  assert.deepEqual(writes.at(-1), { path: `/v2/${session.projectId}/instances/instance-1`, method: "DELETE", body: {} });
});

test("DCS restart propagates a per-instance cloud failure", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ results: [{ instance: "instance-1", result: "failed", error_msg: "Restart not allowed" }] }));
  await assert.rejects(run(dcsManagement, "restart"), /Restart not allowed/);
});

test("DCS capacity expansion uses the instance resize catalog and refuses shrinking", async (t) => {
  const gets: URL[] = [];
  const writes: Write[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) { writes.push({ path: url.pathname, method: init.method, body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown> }); return new Response(null, { status: 204 }); }
    gets.push(url);
    return Response.json(read(url));
  });
  await assert.rejects(run(dcsManagement, "expand-capacity", { offering: JSON.stringify(["redis.ha.large.4", "4.0", "16"]) }), /larger/);
  assert.equal(writes.length, 0);
  const result = await run(dcsManagement, "expand-capacity", { offering: dcsOffering });
  assert.equal(result.asynchronous, true);
  assert.ok(gets.some((url) => url.pathname.endsWith("/flavors") && url.searchParams.get("instance_id") === "instance-1"));
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/instances/instance-1/resize`, method: "POST", body: { spec_code: "redis.ha.large.4", new_capacity: 32, execute_immediately: true, bss_param: { charging_mode: "postPaid" } } }]);
});

test("DCS backup lifecycle revalidates child ownership and restore support", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ backup_id: "backup-new", restore_id: "restore-9" }));
  const list = await run(dcsManagement, "backups");
  assert.equal(list.message, "2 backups loaded.");
  assert.ok(JSON.stringify(list.facts).includes("Manual backup"));
  await assert.rejects(run(dcsManagement, "delete-backup", { backup: "missing" }), /not available/);
  await assert.rejects(run(dcsManagement, "restore-backup", { backup: "backup-2" }), /not available/);
  await assert.rejects(dcsManagement.execute(session, "delete-backup", { backup: "missing" }, await owned(dcsManagement)), /not in this instance/);
  assert.equal(writes.length, 0);
  const created = await run(dcsManagement, "create-backup", { remark: "before migration" });
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/instances/instance-1/backups`, method: "POST", body: { remark: "before migration" } }]);
  assert.equal(created.resourceId, "backup-new");
  assert.equal(created.asynchronous, true);
  await run(dcsManagement, "delete-backup", { backup: "backup-1" });
  assert.deepEqual(writes.at(-1), { path: `/v2/${session.projectId}/instances/instance-1/backups/backup-1`, method: "DELETE", body: {} });
  const restored = await run(dcsManagement, "restore-backup", { backup: "backup-1", remark: "recover" });
  assert.deepEqual(writes.at(-1), { path: `/v2/${session.projectId}/instances/instance-1/restores`, method: "POST", body: { backup_id: "backup-1", remark: "recover" } });
  assert.equal(restored.asynchronous, true);
  assert.ok(JSON.stringify(restored.facts).includes("restore-9"));
});

test("DCS edit and backup retention use the documented update payloads", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => new Response(null, { status: 204 }));
  const edited = await run(dcsManagement, "update", { name: "CacheApp", description: "primary cache" });
  assert.equal(edited.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/instances/instance-1`, method: "PUT", body: { name: "CacheApp", description: "primary cache" } }]);
  const policy = await run(dcsManagement, "configure-backup-policy", { saveDays: 7, backupAt: ["1", "4"], beginAt: "02:00-03:00", timezoneOffset: "-0300" });
  assert.equal(policy.asynchronous, undefined);
  assert.deepEqual(writes.at(-1), { path: `/v2/${session.projectId}/instances/instance-1`, method: "PUT", body: { instance_backup_policy: { backup_type: "auto", save_days: 7, periodical_backup_plan: { timezone_offset: "-0300", backup_at: [1, 4], period_type: "weekly", begin_at: "02:00-03:00" } } } });
  await assert.rejects(run(dcsManagement, "configure-backup-policy", { saveDays: 7, backupAt: ["1"], beginAt: "02:00-03:00", timezoneOffset: "9999" }), /-1200/);
});

test("Kafka create sends the documented pay-per-use payload with SASL credentials", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ instance_id: "created-kafka" }));
  const result = await run(kafkaManagement, "create", kafkaCreate);
  assert.equal(result.resourceId, "created-kafka");
  assert.equal(result.asynchronous, true);
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/kafka/instances`, method: "POST", body: { name: "StreamApp", description: "", engine: "kafka", engine_version: "2.7", broker_num: 3, storage_space: 300, vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", available_zones: ["az-1"], product_id: "kafka.cluster.s1", storage_spec_code: "dms.physical.storage.high.v2", enable_publicip: false, ssl_enable: true, access_user: "owner", password: "SecretPass1!", kafka_security_protocol: "SASL_SSL", sasl_enabled_mechanisms: ["PLAIN"], arch_type: "X86", enterprise_project_id: "0", bss_param: { charging_mode: "postPaid" } } }]);
});

test("Kafka create validates zones, broker bounds, storage, and SASL cross-fields", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ instance_id: "created-kafka" }));
  await assert.rejects(run(kafkaManagement, "create", { ...kafkaCreate, zones: ["az-1", "az-2"] }), /one or at least three/);
  await assert.rejects(run(kafkaManagement, "create", { ...kafkaCreate, zones: ["az-sold-out"] }), /unavailable/);
  await assert.rejects(run(kafkaManagement, "create", { ...kafkaCreate, brokers: 2 }), /broker count/);
  await assert.rejects(run(kafkaManagement, "create", { ...kafkaCreate, storage: 250 }), /multiple of 100/);
  await assert.rejects(run(kafkaManagement, "create", { ...kafkaCreate, zones: ["az-9"] }), /storage flavor is unavailable/);
  await assert.rejects(run(kafkaManagement, "create", { ...kafkaCreate, accessUser: undefined, password: undefined }), /SASL username and password are required/);
  assert.equal(writes.length, 0);
  const plain = await run(kafkaManagement, "create", { ...kafkaCreate, ssl: false, accessUser: undefined, password: undefined });
  assert.equal(plain.asynchronous, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.ssl_enable, false);
  assert.equal("access_user" in writes[0].body, false);
  assert.equal("password" in writes[0].body, false);
});

test("Kafka restart and delete protect ownership and use the batch action contract", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ results: [{ instance: "instance-1", result: "success" }] }));
  await assert.rejects(run(kafkaManagement, "restart", {}, "other-instance"), /not found/);
  assert.equal(writes.length, 0);
  const restart = await run(kafkaManagement, "restart");
  assert.equal(restart.asynchronous, true);
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/instances/action`, method: "POST", body: { action: "restart", instances: ["instance-1"] } }]);
  await run(kafkaManagement, "delete");
  assert.deepEqual(writes.at(-1), { path: `/v2/${session.projectId}/instances/instance-1`, method: "DELETE", body: {} });
});

test("Kafka restart propagates a per-instance cloud failure", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ results: [{ instance: "instance-1", result: "failed", error_msg: "Restart not allowed" }] }));
  await assert.rejects(run(kafkaManagement, "restart"), /Restart not allowed/);
});

test("Kafka storage expansion refuses shrinking and returns the cloud job", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ job_id: "extend-job" }));
  await assert.rejects(run(kafkaManagement, "expand-storage", { storage: 200 }), /must exceed/);
  assert.equal(writes.length, 0);
  const result = await run(kafkaManagement, "expand-storage", { storage: 600 });
  assert.equal(result.jobId, "extend-job");
  assert.equal(result.asynchronous, true);
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/kafka/instances/instance-1/extend`, method: "POST", body: { oper_type: "storage", new_storage_space: 600 } }]);
});

test("Kafka topic operations revalidate ownership, replica bounds, and partition budgets", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ name: "orders", topics: [{ id: "events", success: true }] }));
  const list = await run(kafkaManagement, "topics");
  assert.ok(JSON.stringify(list.facts).includes("events"));
  await assert.rejects(run(kafkaManagement, "create-topic", { topicName: "orders", partitions: 3, replication: 5, retention: 72 }), /exceed the broker count/);
  await assert.rejects(run(kafkaManagement, "create-topic", { topicName: "orders", partitions: 300, replication: 3, retention: 72 }), /no more than/);
  await assert.rejects(run(kafkaManagement, "create-topic", { topicName: "events", partitions: 3, replication: 3, retention: 72 }), /already exists/);
  await assert.rejects(run(kafkaManagement, "create-topic", { topicName: "orders", partitions: 198, replication: 3, retention: 72 }), /partitions remain/);
  await assert.rejects(run(kafkaManagement, "delete-topic", { topic: "missing" }), /not available/);
  await assert.rejects(kafkaManagement.execute(session, "delete-topic", { topic: "missing" }, await owned(kafkaManagement)), /not in this instance/);
  assert.equal(writes.length, 0);
  const created = await run(kafkaManagement, "create-topic", { topicName: "orders", partitions: 3, replication: 3, retention: 72, syncReplication: false, syncFlush: false, topicDescription: "order events" });
  assert.equal(created.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/instances/instance-1/topics`, method: "POST", body: { id: "orders", partition: 3, replication: 3, retention_time: 72, sync_replication: false, sync_message_flush: false, topic_desc: "order events" } }]);
  await run(kafkaManagement, "delete-topic", { topic: "events" });
  assert.deepEqual(writes.at(-1), { path: `/v2/${session.projectId}/instances/instance-1/topics/delete`, method: "POST", body: { topics: ["events"] } });
});

test("Kafka topic deletion propagates a per-topic cloud failure", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => Response.json({ topics: [{ id: "events", success: false }] }));
  await assert.rejects(run(kafkaManagement, "delete-topic", { topic: "events" }), /rejected the topic deletion/);
});

test("Kafka user management hides secrets, revalidates users, and uses native user contracts", async (t) => {
  const writes: Write[] = [];
  mockCloud(t, writes, () => new Response(null, { status: 204 }));
  const list = await run(kafkaManagement, "users");
  assert.ok(!JSON.stringify(list).includes("must-not-expose"));
  assert.ok(JSON.stringify(list).includes("producer"));
  await assert.rejects(run(kafkaManagement, "create-user", { userName: "producer", userPassword: "SecretPass1!" }), /already exists/);
  await assert.rejects(run(kafkaManagement, "create-user", { userName: "Consumer1", userPassword: "Consumer1" }), /cannot match the username/);
  await assert.rejects(run(kafkaManagement, "delete-user", { user: "missing" }), /not available/);
  await assert.rejects(run(kafkaManagement, "reset-user-password", { user: "missing", password: "SecretPass1!" }), /not available/);
  await assert.rejects(kafkaManagement.execute(session, "delete-user", { user: "missing" }, await owned(kafkaManagement)), /not in this instance/);
  assert.equal(writes.length, 0);
  const created = await run(kafkaManagement, "create-user", { userName: "consumer", userPassword: "SecretPass1!", userDescription: "analytics" });
  assert.equal(created.asynchronous, undefined);
  assert.ok(!JSON.stringify(created).includes("SecretPass1!"));
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/instances/instance-1/users`, method: "POST", body: { user_name: "consumer", user_passwd: "SecretPass1!", user_desc: "analytics" } }]);
  await run(kafkaManagement, "delete-user", { user: "producer" });
  assert.deepEqual(writes.at(-1), { path: `/v2/${session.projectId}/instances/instance-1/users`, method: "PUT", body: { action: "delete", users: ["producer"] } });
  await run(kafkaManagement, "reset-user-password", { user: "producer", password: "NewSecret2#" });
  assert.deepEqual(writes.at(-1), { path: `/v2/${session.projectId}/instances/instance-1/users/producer`, method: "PUT", body: { new_password: "NewSecret2#" } });
});

test("destructive and status-gated operations declare confirmation, impact, and status gates", () => {
  for (const adapter of [dcsManagement, kafkaManagement]) {
    for (const operation of adapter.operations.filter((item) => ["delete", "delete-backup", "restore-backup", "restart", "delete-topic", "delete-user", "reset-user-password"].includes(item.id))) {
      assert.equal(operation.confirmation, true, `${adapter.title}:${operation.id} requires confirmation`);
      assert.ok(operation.impact, `${adapter.title}:${operation.id} documents impact`);
    }
    for (const operation of adapter.operations.filter((item) => ["create", "expand-capacity", "expand-storage"].includes(item.id))) assert.ok(operation.impact, `${adapter.title}:${operation.id} documents impact`);
    for (const operation of adapter.operations.filter((item) => item.allowedStatuses)) assert.deepEqual(operation.allowedStatuses, ["RUNNING"], `${adapter.title}:${operation.id} gates on RUNNING`);
    assert.ok(["listDcsRedisInstances", "listDmsKafkaInstances"].some((key) => adapter.invalidationKeys().includes(key)));
  }
});

test("Kafka refuses exhausted partition budgets and unconfirmed topic deletion responses", async t => {
  const writes: Write[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) { writes.push({ path: url.pathname, method: init.method, body: JSON.parse(String(init.body ?? "{}")) }); return Response.json({ topics: [] }); }
    const response = read(url);
    if (url.pathname.endsWith("/topics")) return Response.json({ ...response, remain_partitions: 0 });
    return Response.json(response);
  });
  await assert.rejects(run(kafkaManagement, "create-topic", { topicName: "orders", partitions: 1, replication: 3, retention: 72 }), /Only 0 partitions/);
  assert.equal(writes.length, 0);
  await assert.rejects(run(kafkaManagement, "delete-topic", { topic: "events" }), /returned no confirmation/);
});
test("Cache and Kafka reject prepaid deletion and pay-per-use resizing before a write", async t => {
  const writes: Write[] = []; mockCloud(t, writes);
  for (const adapter of [dcsManagement, kafkaManagement]) {
    const resource = await owned(adapter); resource.values = { ...resource.values, chargingMode: "Yearly/monthly" };
    await assert.rejects(adapter.execute(session, "delete", {}, resource), /prepaid|subscription/);
    await assert.rejects(adapter.execute(session, adapter === dcsManagement ? "expand-capacity" : "expand-storage", { offering: dcsOffering, storage: 600 }, resource), /pay-per-use/);
  }
  assert.equal(writes.length, 0);
});
test("DCS filters foreign backup records and rejects impossible timezone minutes", async t => {
  const writes: Write[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) { writes.push({ path: url.pathname, method: init.method, body: JSON.parse(String(init.body ?? "{}")) }); return Response.json({}); }
    if (url.pathname.endsWith("/backups")) return Response.json({ total_num: 2, backup_record_response: [{ backup_id: "foreign", instance_id: "another-instance", is_support_restore: "TRUE" }, { backup_id: "owned", instance_id: "instance-1", is_support_restore: "TRUE" }] });
    return Response.json(read(url));
  });
  const options = await dcsManagement.options!(session, "restore-backup", await owned(dcsManagement));
  assert.deepEqual(options.restorableBackups.map(p => p.value), ["owned"]);
  await assert.rejects(run(dcsManagement, "configure-backup-policy", { saveDays: 7, backupAt: ["1"], beginAt: "02:00-03:00", timezoneOffset: "+1167" }), /-1200/);
  assert.equal(writes.length, 0);
});
