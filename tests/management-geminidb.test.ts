import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { geminidbManagement } from "@/lib/huawei/management/adapters/geminidb";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const cassandraInstance = { id: "geminidb-1", name: "Cassandra One", status: "normal", mode: "Cluster", region: "sa-brazil-1", engine: "rocksDB", datastore: { type: "cassandra", version: "3.11" }, db_user_name: "rwuser", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", pay_mode: "0", maintenance_window: "02:00-06:00", groups: [{ id: "group-1", status: "normal", volume: { size: "100", used: "12.5" }, nodes: [{ id: "node-1", name: "cassandra_node_1", status: "normal", private_ip: "192.168.0.174", spec_code: "geminidb.cassandra.large.4", availability_zone: "az-1" }] }] };
const mongoInstance = { id: "geminidb-2", name: "Mongo One", status: "normal", mode: "ReplicaSet", region: "sa-brazil-1", engine: "rocksDB", datastore: { type: "mongodb", version: "4.0" }, db_user_name: "rwuser", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", pay_mode: "0", groups: [{ id: "group-2", status: "normal", volume: { size: "100" }, nodes: [{ id: "node-2", name: "mongo_node_1", status: "normal", role: "Primary", private_ip: "192.168.0.2", spec_code: "geminidb.mongodb.large.4", availability_zone: "az-1" }] }] };
const redisInstance = { id: "geminidb-redis", name: "Redis One", status: "normal", mode: "Cluster", region: "sa-brazil-1", engine: "rocksDB", datastore: { type: "redis", version: "5.0" }, db_user_name: "rwuser", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", pay_mode: "0", groups: [{ id: "group-3", status: "normal", volume: { size: "100" }, nodes: [{ id: "node-3", name: "redis_node_1", status: "normal", private_ip: "192.168.0.3", spec_code: "geminidb.redis.bigsize.4", availability_zone: "az-1" }] }] };
const prepaidInstance = { id: "geminidb-pre", name: "Prepaid One", status: "normal", mode: "Cluster", region: "sa-brazil-1", engine: "rocksDB", datastore: { type: "cassandra", version: "3.11" }, db_user_name: "rwuser", pay_mode: "1", groups: [{ id: "group-4", status: "normal", volume: { size: "100" }, nodes: [{ id: "node-4", name: "prepaid_node_1", status: "normal", spec_code: "geminidb.cassandra.large.4", availability_zone: "az-1" }] }] };
const instances = [cassandraInstance, mongoInstance, redisInstance, prepaidInstance];
const backups = [
  { id: "backup-manual", instance_id: "geminidb-1", name: "Manual Backup", type: "Manual", status: "COMPLETED", begin_time: "2026-01-02T00:00:21Z", size: 1024 },
  { id: "backup-auto", instance_id: "geminidb-1", name: "Auto Backup", type: "Auto", status: "COMPLETED", begin_time: "2026-01-01T00:00:21Z", size: 2048 },
  { id: "backup-building", instance_id: "geminidb-1", name: "Building Backup", type: "Manual", status: "BUILDING", begin_time: "2026-01-03T00:00:21Z", size: 0 },
  { id: "backup-foreign", instance_id: "other-instance", name: "Foreign Backup", type: "Manual", status: "COMPLETED", begin_time: "2026-01-04T00:00:21Z", size: 512 },
];
const dbUsers = [
  { name: "rwuser", type: "rwuser", privilege: "ReadWrite", databases: ["0"] },
  { name: "appuser", type: "acluser", privilege: "ReadOnly", databases: ["1", "2"] },
];
const cassandraFlavors = [
  { engine_name: "cassandra", engine_version: "3.11", vcpus: "4", ram: "16384", spec_code: "geminidb.cassandra.large.4", az_status: { "az-1": "normal", "az-2": "sellout" } },
  { engine_name: "cassandra", engine_version: "3.11", vcpus: "8", ram: "32768", spec_code: "geminidb.cassandra.xlarge.4", az_status: { "az-1": "normal" } },
];
const mongoFlavors = [
  { engine_name: "mongodb", engine_version: "4.0", vcpus: "4", ram: "16384", spec_code: "geminidb.mongodb.large.4", az_status: { "az-1": "normal" } },
];
const availableFlavors = {
  instance_id: "geminidb-1",
  instance_name: "Cassandra One",
  current_flavor: { vcpus: "4", ram: "16", spec_code: "geminidb.cassandra.large.4", az_status: { "az-1": "normal" }, region_status: "normal" },
  optional_flavors: { list: [{ vcpus: "8", ram: "32", spec_code: "geminidb.cassandra.xlarge.4", az_status: { "az-1": "normal" }, region_status: "normal" }], total_count: 1 },
};
const writeResponse = { job_id: "cloud-job", id: "geminidb-new", backup_id: "backup-new" };

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v3/project-1/instances") {
    if (url.searchParams.has("id")) {
      const match = instances.find((instance) => instance.id === url.searchParams.get("id"));
      return { instances: match ? [match] : [], total_count: match ? 1 : 0 };
    }
    return { instances, total_count: instances.length };
  }
  if (path === "/v3/project-1/datastores/cassandra/versions") return { versions: ["3.11"] };
  if (path === "/v3/project-1/datastores/mongodb/versions") return { versions: ["4.0"] };
  if (path === "/v3/project-1/flavors") {
    if (url.searchParams.get("engine_name") === "mongodb") return { flavors: mongoFlavors, total_count: mongoFlavors.length };
    return { flavors: cassandraFlavors, total_count: cassandraFlavors.length };
  }
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet", cidr: "192.168.0.0/24" },
    { id: "subnet-2", vpc_id: "vpc-1", name: "Legacy", cidr: "10.0.0.0/24" },
  ] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Security" }, { id: "sg-2", name: "Database" }] };
  if (path === "/v4/project-1/backups") return { backups, total_count: backups.length };
  if (path === "/v3/project-1/instances/geminidb-1/backups/policy") return { backup_policy: { keep_days: 7, start_time: "08:00-09:00", period: "1,2,3,4,5" } };
  if (path === "/v3/project-1/instances/geminidb-1/available-flavors") return availableFlavors;
  if (path === "/v3/project-1/redis/instances/geminidb-redis/db-users") return { users: dbUsers, total_count: dbUsers.length };
  if (path === "/v3/project-1/redis/instances/geminidb-redis/databases") return { databases: ["0", "1", "2"], total_count: 3 };
  if (path === "/v3/project-1/instances/geminidb-1/ops-window") return { maintenance_window: "02:00-06:00" };
  throw new Error(`Unexpected GET ${path}`);
}

function mockCloud(t: TestContext) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    writes.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(writeResponse);
  });
  return writes;
}

const cassandraResource: ManagementResource = { id: "geminidb-1", name: "Cassandra One", status: "normal", values: { engine: "cassandra", size: 100 } };
const mongoResource: ManagementResource = { id: "geminidb-2", name: "Mongo One", status: "normal", values: { engine: "mongodb", size: 100 } };
const redisResource: ManagementResource = { id: "geminidb-redis", name: "Redis One", status: "normal", values: { engine: "redis" } };
const prepaidResource: ManagementResource = { id: "geminidb-pre", name: "Prepaid One", status: "normal", values: { engine: "cassandra" } };
const cassandraOffering = JSON.stringify(["cassandra", "3.11", "geminidb.cassandra.large.4"]);
const createValues: ManagementValues = { name: "Example", offering: cassandraOffering, zone: "az-1", subnet: "subnet-1", securityGroup: "sg-1", nodes: 3, diskSize: 100, password: "Str0ngPass!1", enterpriseProjectId: "0" };

test("GeminiDB backup jobs retain the parent instance and display native KB units", async t => {
  mockCloud(t);
  const result = await geminidbManagement.execute(session, "create-backup", { name: "Backup_One" }, cassandraResource);
  assert.equal(result.resourceId, cassandraResource.id);
  const listed = await geminidbManagement.execute(session, "backups", {}, cassandraResource);
  assert.ok(listed.facts?.some(fact => fact.value.includes("1024 KB")));
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ jobs: [{ id: result.jobId, status: "Completed", instance: { id: cassandraResource.id } }] }));
  const completed = await geminidbManagement.poll!(session, { id: randomUUID(), service: "geminidb", operation: "Create manual backup", startedAt: new Date().toISOString(), state: "submitted", jobId: result.jobId, resourceId: result.resourceId });
  assert.equal(completed.state, "succeeded");
});

test("GeminiDB specification changes verify the native parent and every current node zone", async t => {
  let wrongParent = true;
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) { writes++; return Response.json(writeResponse); }
    if (url.pathname.endsWith("/available-flavors")) return Response.json({ ...availableFlavors, instance_id: wrongParent ? "other-instance" : cassandraResource.id, optional_flavors: { ...availableFlavors.optional_flavors, list: availableFlavors.optional_flavors.list.map(flavor => ({ ...flavor, az_status: { "az-1": "sellout" } })) } });
    return Response.json(read(url));
  });
  const values = { offering: "geminidb.cassandra.xlarge.4" };
  await assert.rejects(geminidbManagement.execute(session, "resize-flavor", values, cassandraResource), /different GeminiDB instance/);
  wrongParent = false;
  await assert.rejects(geminidbManagement.execute(session, "resize-flavor", values, cassandraResource), /every current node availability zone/);
  assert.equal(writes, 0);
});

test("GeminiDB short user pages advance by actual rows and repeated pages fail closed", async t => {
  const offsets: number[] = [];
  let repeated = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (!url.pathname.endsWith("/db-users")) return Response.json(read(url));
    const offset = Number(url.searchParams.get("offset")); offsets.push(offset);
    return Response.json({ users: [offset === 0 || repeated ? dbUsers[0] : dbUsers[1]], total_count: 2 });
  });
  const result = await geminidbManagement.execute(session, "db-users", {}, redisResource);
  assert.equal(result.facts?.length, 2);
  assert.deepEqual(offsets, [0, 1]);
  repeated = true;
  await assert.rejects(geminidbManagement.execute(session, "delete-db-user", { user: "appuser" }, redisResource), /repeated a database user/);
});

test("inventory maps the canonical instance list with engine, mode, version, and storage facts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname + new URL(input).search); return Response.json(read(new URL(input))); });
  const resources = await geminidbManagement.inventory(session);
  assert.ok(reads.some((path) => path.startsWith("/v3/project-1/instances?limit=100")));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status, item.values?.engine, item.values?.mode, item.values?.version, item.values?.size]), [
    ["geminidb-1", "Cassandra One", "normal", "cassandra", "Cluster", "3.11", 100],
    ["geminidb-2", "Mongo One", "normal", "mongodb", "ReplicaSet", "4.0", 100],
    ["geminidb-redis", "Redis One", "normal", "redis", "Cluster", "5.0", 100],
    ["geminidb-pre", "Prepaid One", "normal", "cassandra", "Cluster", "3.11", 100],
  ]);
});

test("create options whitelist live cassandra and mongo offerings, on-sale zones, and project networks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await geminidbManagement.options!(session, "create");
  assert.deepEqual(choices.offerings.map((choice) => choice.value), [
    cassandraOffering,
    JSON.stringify(["cassandra", "3.11", "geminidb.cassandra.xlarge.4"]),
    JSON.stringify(["mongodb", "4.0", "geminidb.mongodb.large.4"]),
  ]);
  assert.ok(choices.offerings.every((choice) => !choice.value.includes("redis")));
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1", "sg-2"]);
});

test("create sends the documented pay-per-use payload with the rocksDB engine and the subnet network ID", async (t) => {
  const writes = mockCloud(t);
  const outcome = await geminidbManagement.execute(session, "create", createValues);
  assert.equal(outcome.resourceId, "geminidb-new");
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  await geminidbManagement.execute(session, "create", { ...createValues, offering: JSON.stringify(["cassandra", "3.11", "geminidb.cassandra.xlarge.4"]), nodes: 6, diskSize: 1000, name: "Bigger" });
  await geminidbManagement.execute(session, "create", { ...createValues, offering: JSON.stringify(["mongodb", "4.0", "geminidb.mongodb.large.4"]), name: "MongoEx" });
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances", method: "POST", body: { name: "Example", datastore: { type: "cassandra", version: "3.11", storage_engine: "rocksDB" }, region: "sa-brazil-1", availability_zone: "az-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", mode: "Cluster", flavor: [{ num: "3", storage: "ULTRAHIGH", size: "100", spec_code: "geminidb.cassandra.large.4" }], ssl_option: "1", charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" } },
    { path: "/v3/project-1/instances", method: "POST", body: { name: "Bigger", datastore: { type: "cassandra", version: "3.11", storage_engine: "rocksDB" }, region: "sa-brazil-1", availability_zone: "az-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", mode: "Cluster", flavor: [{ num: "6", storage: "ULTRAHIGH", size: "1000", spec_code: "geminidb.cassandra.xlarge.4" }], ssl_option: "1", charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" } },
    { path: "/v3/project-1/instances", method: "POST", body: { name: "MongoEx", datastore: { type: "mongodb", version: "4.0", storage_engine: "rocksDB" }, region: "sa-brazil-1", availability_zone: "az-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", mode: "ReplicaSet", flavor: [{ num: "3", storage: "ULTRAHIGH", size: "100", spec_code: "geminidb.mongodb.large.4" }], ssl_option: "1", charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" } },
  ]);
});

test("create rejects forged or unavailable selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, offering: JSON.stringify(["redis", "5.0", "geminidb.redis.bigsize.4"]) }, /Select an available engine, version/],
    [{ ...createValues, offering: JSON.stringify(["cassandra", "3.11", "forged-spec"]) }, /no longer available/],
    [{ ...createValues, offering: JSON.stringify(["cassandra", "4.8", "geminidb.cassandra.large.4"]) }, /Select an available engine/],
    [{ ...createValues, zone: "az-2" }, /not on sale in this availability zone/],
    [{ ...createValues, diskSize: 50 }, /at least 100 GB/],
    [{ ...createValues, nodes: 2 }, /3 to 60 nodes/],
    [{ ...createValues, nodes: 61 }, /3 to 60 nodes/],
    [{ ...createValues, offering: JSON.stringify(["mongodb", "4.0", "geminidb.mongodb.large.4"]), nodes: 5 }, /exactly three nodes/],
    [{ ...createValues, password: "alllowercase9" }, /at least three/],
    [{ ...createValues, password: "Str0ngPass(1)" }, /outside the supported GeminiDB set/],
    [{ ...createValues, subnet: "forged-subnet" }, /subnet is no longer available/],
    [{ ...createValues, subnet: "subnet-2" }, /network ID/],
    [{ ...createValues, securityGroup: "forged-group" }, /security group is no longer available/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(geminidbManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live choices and enforces documented bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = geminidbManagement.operations.find((item) => item.id === "create")!;
  const choices = await geminidbManagement.options!(session, "create");
  const values = validateManagementValues(operation, { ...createValues, offering: choices.offerings[0].value }, choices);
  assert.equal(values.name, "Example");
  assert.throws(() => validateManagementValues(operation, { ...createValues, offering: JSON.stringify(["cassandra", "3.11", "forged-spec"]) }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, zone: "az-2" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, diskSize: 99 }, choices), /at least 100/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, nodes: 2 }, choices), /at least 3/);
});

test("rename, restart, and delete use their native instance contracts and delete refuses prepaid instances", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "delete", {}, prepaidResource), /pay-per-use instances only/);
  assert.equal(writes.length, 0);
  const rename = await geminidbManagement.execute(session, "rename", { name: "Renamed" }, cassandraResource);
  assert.equal(rename.asynchronous, undefined);
  const reboot = await geminidbManagement.execute(session, "restart", {}, cassandraResource);
  assert.equal(reboot.asynchronous, true);
  assert.equal(reboot.jobId, "cloud-job");
  const deletion = await geminidbManagement.execute(session, "delete", {}, cassandraResource);
  assert.equal(deletion.asynchronous, true);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/geminidb-1/name", method: "PUT", body: { name: "Renamed" } },
    { path: "/v3/project-1/instances/geminidb-1/restart", method: "POST", body: {} },
    { path: "/v3/project-1/instances/geminidb-1", method: "DELETE", body: undefined },
  ]);
  const deleteOperation = geminidbManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(deleteOperation.confirmation, true);
  assert.ok(deleteOperation.impact);
});

test("storage expansion never shrinks and sends the documented extend-volume body", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "resize-storage", { size: 100 }, cassandraResource), /exceed the current 100 GB/);
  await assert.rejects(geminidbManagement.execute(session, "resize-storage", { size: 50 }, cassandraResource), /exceed the current 100 GB/);
  await assert.rejects(geminidbManagement.execute(session, "resize-storage", { size: 20000 }, cassandraResource), /supported bounds/);
  await assert.rejects(geminidbManagement.execute(session, "resize-storage", { size: 200 }, prepaidResource), /pay-per-use instances only/);
  assert.equal(writes.length, 0);
  const outcome = await geminidbManagement.execute(session, "resize-storage", { size: 200 }, cassandraResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/geminidb-1/extend-volume", method: "POST", body: { size: 200 } }]);
});

test("specification changes use the native available-flavors catalog, refuse prepaid instances, and require a different spec", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "resize-flavor", { offering: "geminidb.cassandra.large.4" }, cassandraResource), /must differ/);
  await assert.rejects(geminidbManagement.execute(session, "resize-flavor", { offering: "forged-spec" }, cassandraResource), /no longer available/);
  await assert.rejects(geminidbManagement.execute(session, "resize-flavor", { offering: "geminidb.cassandra.xlarge.4" }, prepaidResource), /pay-per-use instances only/);
  assert.equal(writes.length, 0);
  const outcome = await geminidbManagement.execute(session, "resize-flavor", { offering: "geminidb.cassandra.xlarge.4" }, cassandraResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/geminidb-1/resize", method: "PUT", body: { resize: { target_spec_code: "geminidb.cassandra.xlarge.4" } } }]);
  const choices = await geminidbManagement.options!(session, "resize-flavor", cassandraResource);
  assert.deepEqual(choices.resizeOfferings.map((choice) => choice.value), ["geminidb.cassandra.xlarge.4"]);
});

test("backup listing shows only owned backups and creation targets the documented nested backup body", async (t) => {
  const writes = mockCloud(t);
  const list = await geminidbManagement.execute(session, "backups", {}, cassandraResource);
  assert.equal(list.message, "3 backups loaded.");
  assert.ok(list.facts!.some((fact) => fact.label.startsWith("Manual Backup · Manual · COMPLETED")));
  assert.ok(!list.facts!.some((fact) => fact.label.startsWith("Foreign Backup")));
  await assert.rejects(geminidbManagement.execute(session, "create-backup", { name: "Nightly", description: "bad < chars" }, cassandraResource), /cannot contain the characters/);
  assert.equal(writes.length, 0);
  const created = await geminidbManagement.execute(session, "create-backup", { name: "Nightly", description: "Before upgrade" }, cassandraResource);
  assert.equal(created.resourceId, cassandraResource.id);
  assert.equal(created.jobId, "cloud-job");
  assert.equal(created.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/geminidb-1/backups", method: "POST", body: { name: "Nightly", description: "Before upgrade" } }]);
});

test("backup deletion revalidates the child ID and only removes completed manual backups of this instance", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "delete-backup", { backup: "foreign" }, cassandraResource), /Select a manual backup/);
  await assert.rejects(geminidbManagement.execute(session, "delete-backup", { backup: "backup-auto" }, cassandraResource), /Only manual backups/);
  await assert.rejects(geminidbManagement.execute(session, "delete-backup", { backup: "backup-building" }, cassandraResource), /Only completed backups/);
  assert.equal(writes.length, 0);
  await geminidbManagement.execute(session, "delete-backup", { backup: "backup-manual" }, cassandraResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/backups/backup-manual", method: "DELETE", body: undefined }]);
  const choices = await geminidbManagement.options!(session, "delete-backup", cassandraResource);
  assert.deepEqual(choices.backups.map((choice) => choice.value), ["backup-manual"]);
  assert.deepEqual(await geminidbManagement.options!(session, "delete-backup"), {});
});

test("GeminiDB never deletes a backup belonging to another instance even if the provider ignores its filter", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => {
    assert.ok(!init.method);
    return Response.json({ backups: [{ id: "foreign", instance_id: "other", type: "Manual", status: "COMPLETED" }], total_count: 1 });
  });
  assert.deepEqual((await geminidbManagement.options!(session, "delete-backup", cassandraResource)).backups, []);
  await assert.rejects(geminidbManagement.execute(session, "delete-backup", { backup: "foreign" }, cassandraResource), /Select a manual backup/);
});

test("backup policy inspection reports retention, window, and weekdays", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const policy = await geminidbManagement.execute(session, "backup-policy", {}, cassandraResource);
  assert.equal(policy.message, "Backup policy loaded.");
  assert.deepEqual(policy.facts, [
    { label: "Retention", value: "7 days" },
    { label: "Backup window (UTC)", value: "08:00-09:00" },
    { label: "Backup weekdays", value: "Monday, Tuesday, Wednesday, Thursday, Friday" },
  ]);
});

test("retention uses the documented backup_policy body and enforces the daily-backup rule under seven days", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "retention", { keepDays: 40, backupWindow: "08:00-09:00", weekdays: ["1", "2"] }, cassandraResource), /1 to 35 days/);
  await assert.rejects(geminidbManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: [] }, cassandraResource), /at least one backup weekday/);
  await assert.rejects(geminidbManagement.execute(session, "retention", { keepDays: 5, backupWindow: "08:00-09:00", weekdays: ["1", "2"] }, cassandraResource), /daily backups/);
  assert.equal(writes.length, 0);
  await geminidbManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:30-09:30", weekdays: ["5", "1"] }, cassandraResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/geminidb-1/backups/policy", method: "PUT", body: { backup_policy: { keep_days: 30, start_time: "08:30-09:30", period: "1,5" } } }]);
  const choices = await geminidbManagement.options!(session, "retention", cassandraResource);
  assert.equal(choices.backupWindows.length, 48);
  assert.ok(choices.backupWindows.some((choice) => choice.value === "23:30-00:30"));
  assert.deepEqual(choices.weekdays.map((choice) => choice.value), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("topology lists node details and group storage", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const topology = await geminidbManagement.execute(session, "topology", {}, cassandraResource);
  assert.ok(topology.facts!.some((fact) => fact.label === "cassandra_node_1" && fact.value.includes("az-1") && fact.value.includes("geminidb.cassandra.large.4")));
  assert.ok(topology.facts!.some((fact) => fact.label === "Group group-1 storage" && fact.value === "100 GB · 12.5 GB used"));
  const mongoTopology = await geminidbManagement.execute(session, "topology", {}, mongoResource);
  assert.ok(mongoTopology.facts!.some((fact) => fact.label === "mongo_node_1 · Primary"));
});

test("database user management is reserved for GeminiDB Redis instances", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "db-users", {}, cassandraResource), /GeminiDB Redis instances only/);
  await assert.rejects(geminidbManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", privilege: "ReadOnly", databases: ["1"] }, cassandraResource), /GeminiDB Redis instances only/);
  await assert.rejects(geminidbManagement.execute(session, "delete-db-user", { user: "appuser" }, cassandraResource), /GeminiDB Redis instances only/);
  assert.equal(writes.length, 0);
  assert.deepEqual(await geminidbManagement.options!(session, "delete-db-user", cassandraResource), {});
});

test("database user listing shows accounts, types, privileges, and authorized databases", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const list = await geminidbManagement.execute(session, "db-users", {}, redisResource);
  assert.equal(list.message, "2 database users loaded.");
  assert.deepEqual(list.facts!.map((fact) => fact.label), ["rwuser · rwuser", "appuser · acluser"]);
  assert.ok(list.facts!.some((fact) => fact.label === "appuser · acluser" && fact.value === "ReadOnly · databases: 1, 2"));
});

test("database user creation guards duplicates, passwords, privileges, and live databases", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "create-db-user", { name: "appuser", password: "Str0ngPass!1", privilege: "ReadOnly", databases: ["1"] }, redisResource), /already exists/);
  await assert.rejects(geminidbManagement.execute(session, "create-db-user", { name: "service", password: "alllowercase9", privilege: "ReadOnly", databases: ["1"] }, redisResource), /at least three/);
  await assert.rejects(geminidbManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass~1", privilege: "ReadOnly", databases: ["1"] }, redisResource), /outside the supported GeminiDB Redis account set/);
  await assert.rejects(geminidbManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", privilege: "Root", databases: ["1"] }, redisResource), /Select a privilege/);
  await assert.rejects(geminidbManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", privilege: "ReadOnly", databases: [] }, redisResource), /at least one database/);
  await assert.rejects(geminidbManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", privilege: "ReadOnly", databases: ["9"] }, redisResource), /no longer available/);
  assert.equal(writes.length, 0);
  const outcome = await geminidbManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass(1)", privilege: "ReadWrite", databases: ["1", "2"] }, redisResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/redis/instances/geminidb-redis/db-users", method: "POST", body: { users: [{ name: "service", password: "Str0ngPass(1)", databases: ["1", "2"], privilege: "ReadWrite" }] } }]);
  const choices = await geminidbManagement.options!(session, "create-db-user", redisResource);
  assert.deepEqual(choices.redisDatabases.map((choice) => choice.value), ["0", "1", "2"]);
});

test("database user deletion and password reset revalidate fresh child identities and protect the administrator", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "delete-db-user", { user: "rwuser" }, redisResource), /administrator account/);
  await assert.rejects(geminidbManagement.execute(session, "delete-db-user", { user: "ghost" }, redisResource), /was not found on this instance/);
  await assert.rejects(geminidbManagement.execute(session, "reset-db-user-password", { user: "ghost", password: "Str0ngPass!1" }, redisResource), /was not found on this instance/);
  await assert.rejects(geminidbManagement.execute(session, "reset-db-user-password", { user: "appuser", password: "weak" }, redisResource), /8 to 32 characters/);
  assert.equal(writes.length, 0);
  const deletion = await geminidbManagement.execute(session, "delete-db-user", { user: "appuser" }, redisResource);
  assert.equal(deletion.asynchronous, true);
  await geminidbManagement.execute(session, "reset-db-user-password", { user: "appuser", password: "Str0ngPass(1)" }, redisResource);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/redis/instances/geminidb-redis/db-users", method: "DELETE", body: { names: ["appuser"] } },
    { path: "/v3/project-1/redis/instances/geminidb-redis/db-users/password", method: "PUT", body: { name: "appuser", password: "Str0ngPass(1)" } },
  ]);
  const deleteChoices = await geminidbManagement.options!(session, "delete-db-user", redisResource);
  assert.deepEqual(deleteChoices.dbUsers.map((choice) => choice.value), ["appuser"]);
  const resetChoices = await geminidbManagement.options!(session, "reset-db-user-password", redisResource);
  assert.deepEqual(resetChoices.dbUsers.map((choice) => choice.value), ["rwuser", "appuser"]);
});

test("administrator password reset uses the native instance password contract", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "reset-password", { password: "Str0ngPass(1)" }, cassandraResource), /outside the supported GeminiDB set/);
  await assert.rejects(geminidbManagement.execute(session, "reset-password", { password: "weak" }, cassandraResource), /8 to 32 characters/);
  assert.equal(writes.length, 0);
  const outcome = await geminidbManagement.execute(session, "reset-password", { password: "Str0ngPass!1" }, cassandraResource);
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/geminidb-1/password", method: "PUT", body: { password: "Str0ngPass!1" } }]);
});

test("maintenance window and security group updates use their native contracts", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "maintenance-window", { start: "02:30" }, cassandraResource), /UTC whole hour/);
  await assert.rejects(geminidbManagement.execute(session, "security-group", { securityGroup: "forged-group" }, cassandraResource), /no longer available/);
  await assert.rejects(geminidbManagement.execute(session, "security-group", { securityGroup: "sg-1" }, cassandraResource), /already uses/);
  assert.equal(writes.length, 0);
  await geminidbManagement.execute(session, "maintenance-window", { start: "02:00" }, cassandraResource);
  const group = await geminidbManagement.execute(session, "security-group", { securityGroup: "sg-2" }, cassandraResource);
  assert.equal(group.jobId, "cloud-job");
  assert.equal(group.asynchronous, true);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/geminidb-1/maintenance-window", method: "PUT", body: { start_time: "02:00" } },
    { path: "/v3/project-1/instances/geminidb-1/security-group", method: "PUT", body: { security_group_id: "sg-2" } },
  ]);
  const choices = await geminidbManagement.options!(session, "security-group", cassandraResource);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1", "sg-2"]);
});

test("job polling maps native job states and surfaces the job's instance ID", async (t) => {
  const replies = [
    { jobs: [{ id: "cloud-job", status: "Completed", instance: { id: "geminidb-new", name: "Example" } }], total_count: 1 },
    { jobs: [{ id: "cloud-job", status: "Failed", instance: { id: "geminidb-1" }, fail_reason: "Insufficient quota" }], total_count: 1 },
    { jobs: [{ id: "cloud-job", status: "Running", instance: { id: "geminidb-1" } }], total_count: 1 },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname + new URL(input).search, "/v3/project-1/jobs?id=cloud-job"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "geminidb", operation: "Create instance", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job" };
  const succeeded = await geminidbManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "geminidb-new");
  const failed = await geminidbManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /cloud job failed/);
  assert.ok(!failed.message!.includes("Insufficient quota"));
  const running = await geminidbManagement.poll!(session, entry);
  assert.equal(running.state, "submitted");
});

test("GeminiDB native jobs must match the stored job and instance", async (t) => {
  let mode = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json(
    mode === 0 ? { jobs: [], total_count: 0 } :
    mode === 1 ? { jobs: [{ id: "other", status: "Completed", instance: { id: "geminidb-1" } }], total_count: 1 } :
    { jobs: [{ id: "cloud-job", status: "Completed", instance: { id: "other-instance" } }], total_count: 1 },
  ));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "geminidb", operation: "Restart instance", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job", resourceId: "geminidb-1" };
  await assert.rejects(geminidbManagement.poll!(session, entry), /did not return the stored GeminiDB job/);
  mode = 1;
  await assert.rejects(geminidbManagement.poll!(session, entry), /did not return the stored GeminiDB job/);
  mode = 2;
  await assert.rejects(geminidbManagement.poll!(session, entry), /does not belong/);
});

test("outcomes and rejection errors never expose passwords", async (t) => {
  const writes = mockCloud(t);
  const weak = "alllowercase9";
  await assert.rejects(geminidbManagement.execute(session, "create-db-user", { name: "service", password: weak, privilege: "ReadOnly", databases: ["1"] }, redisResource), (error: Error) => !error.message.includes(weak));
  const secret = "Str0ngPass!1";
  const outcome = await geminidbManagement.execute(session, "reset-password", { password: secret }, cassandraResource);
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal(writes.length, 1);
  assert.equal((writes[0].body as { password: string }).password, secret);
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(geminidbManagement.execute(session, "attach-eip", {}, cassandraResource), /Unsupported GeminiDB operation/);
  assert.equal(writes.length, 0);
});

test("operations that mutate data require confirmation and state their billing and data impact", () => {
  for (const id of ["restart", "resize-flavor", "resize-storage", "delete", "delete-backup", "retention", "delete-db-user", "reset-db-user-password", "reset-password", "security-group"]) {
    const operation = geminidbManagement.operations.find((item) => item.id === id)!;
    assert.equal(operation.confirmation, true, id);
    assert.ok(operation.impact, id);
  }
  const create = geminidbManagement.operations.find((item) => item.id === "create")!;
  assert.ok(create.impact!.includes("billed hourly"));
});
