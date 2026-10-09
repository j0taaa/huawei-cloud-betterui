import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { ddsManagement } from "@/lib/huawei/management/adapters/dds";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const replicaInstance = { id: "dds-1", name: "Replica One", status: "normal", mode: "ReplicaSet", region: "sa-brazil-1", datastore: { type: "DDS-Community", version: "4.0" }, engine: "wiredTiger", db_user_name: "rwuser", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", pay_mode: "0", backup_strategy: { start_time: "08:00-09:00", keep_days: 7 }, maintenance_window: "02:00-06:00", groups: [{ type: "replica", volume: { size: "10", used: "0.33" }, nodes: [{ id: "node-1", name: "Replica One_replica_node_1", status: "normal", role: "Primary", private_ip: "192.168.0.174", spec_code: "dds.mongodb.s2.medium.4.repset", availability_zone: "az-1" }] }] };
const singleInstance = { id: "dds-2", name: "Single One", status: "normal", mode: "Single", region: "sa-brazil-1", datastore: { type: "DDS-Community", version: "4.0" }, db_user_name: "rwuser", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", pay_mode: "0", groups: [{ type: "single", volume: { size: "20" }, nodes: [{ id: "node-2", name: "Single One_single_node_1", status: "normal", role: "Primary", private_ip: "192.168.0.2", spec_code: "dds.mongodb.s2.medium.4.single", availability_zone: "az-1" }] }] };
const prepaidInstance = { id: "dds-pre", name: "Prepaid One", status: "normal", mode: "ReplicaSet", datastore: { type: "DDS-Community", version: "4.0" }, db_user_name: "rwuser", pay_mode: "1", groups: [{ type: "replica", volume: { size: "10" }, nodes: [{ id: "node-3", name: "Prepaid One_replica_node_1", status: "normal", role: "Primary", private_ip: "192.168.0.3", spec_code: "dds.mongodb.s2.medium.4.repset", availability_zone: "az-1" }] }] };
const clusterInstance = { id: "dds-sh", name: "Cluster One", status: "normal", mode: "Sharding", datastore: { type: "DDS-Community", version: "4.0" }, db_user_name: "rwuser", pay_mode: "0", groups: [{ type: "shard", volume: { size: "20" }, nodes: [{ id: "node-4", name: "Cluster One_shard_1", status: "normal", role: "Primary", private_ip: "192.168.0.4", spec_code: "dds.mongodb.c6.medium.4.shard", availability_zone: "az-1" }] }] };
const instances = [replicaInstance, singleInstance, prepaidInstance, clusterInstance];
const backups = [
  { id: "backup-manual", instance_id: "dds-1", name: "Manual Backup", type: "Manual", status: "COMPLETED", begin_time: "2026-01-02 00:00:21", size: 1024 },
  { id: "backup-auto", instance_id: "dds-1", name: "Auto Backup", type: "Auto", status: "COMPLETED", begin_time: "2026-01-01 00:00:21", size: 2048 },
  { id: "backup-building", instance_id: "dds-1", name: "Building Backup", type: "Manual", status: "BUILDING", begin_time: "2026-01-03 00:00:21", size: 0 },
];
const dbUsers = [
  { user: "rwuser", db: "admin", roles: [{ role: "root", db: "admin" }] },
  { user: "appuser", db: "admin", roles: [{ role: "readWrite", db: "appdb" }] },
];
const flavors = [
  { engine_name: "DDS-Community", type: "replica", vcpus: "2", ram: "4", spec_code: "dds.mongodb.c6.large.4.repset", az_status: { "az-1": "normal", "az-2": "sellout" }, engine_versions: ["4.0", "5.0"] },
  { engine_name: "DDS-Community", type: "single", vcpus: "2", ram: "4", spec_code: "dds.mongodb.c6.large.4.single", az_status: { "az-1": "normal" }, engine_versions: ["4.0"] },
  { engine_name: "DDS-Community", type: "mongos", vcpus: "1", ram: "4", spec_code: "dds.mongodb.c6.medium.4.mongos", az_status: { "az-1": "normal" }, engine_versions: ["4.0"] },
];
const writeResponse = { job_id: "cloud-job", id: "dds-new", backup_id: "backup-new", security_group_id: "sg-2" };

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v3/project-1/instances") {
    if (url.searchParams.has("id")) {
      const match = instances.find((instance) => instance.id === url.searchParams.get("id"));
      return { instances: match ? [match] : [], total_count: match ? 1 : 0 };
    }
    return { instances, total_count: instances.length };
  }
  if (path === "/v3/project-1/datastores/DDS-Community/versions") return { versions: ["4.0", "5.0"] };
  if (path === "/v3.1/project-1/flavors") return { flavors, total_count: flavors.length };
  if (path === "/v3/project-1/storage-type") return { storage_type: [{ name: "ULTRAHIGH", az_status: { "az-1": "normal", "az-2": "normal" } }] };
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet", cidr: "192.168.0.0/24" },
    { id: "subnet-2", vpc_id: "vpc-1", name: "Legacy", cidr: "10.0.0.0/24" },
  ] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Security" }, { id: "sg-2", name: "Database" }] };
  if (path === "/v3/project-1/backups") return { backups, total_count: backups.length };
  if (path === "/v3/project-1/instances/dds-1/backups/policy") return { backup_policy: { keep_days: 7, start_time: "08:00-09:00", period: "1,2,3,4,5", enable_incremental_backup: true } };
  if (path.endsWith("/db-user/detail")) return { total_count: dbUsers.length, users: JSON.stringify(dbUsers) };
  if (path.endsWith("/replica-set/name")) return { name: "replica" };
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

async function inventory() {
  return await ddsManagement.inventory(session);
}

const replicaResource: ManagementResource = { id: "dds-1", name: "Replica One", status: "normal", values: { mode: "ReplicaSet", size: 10 } };
const singleResource: ManagementResource = { id: "dds-2", name: "Single One", status: "normal", values: { mode: "Single", size: 20 } };
const prepaidResource: ManagementResource = { id: "dds-pre", name: "Prepaid One", status: "normal", values: { mode: "ReplicaSet" } };
const clusterResource: ManagementResource = { id: "dds-sh", name: "Cluster One", status: "normal", values: { mode: "Sharding" } };
const offering = JSON.stringify(["ReplicaSet", "4.0", "dds.mongodb.c6.large.4.repset"]);
const createValues: ManagementValues = { name: "Example", offering, storageType: "ULTRAHIGH", zone: "az-1", subnet: "subnet-1", securityGroup: "sg-1", diskSize: 40, password: "Str0ngPass!1", enterpriseProjectId: "0" };

test("inventory maps the canonical instance list with mode, version, and storage facts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname + new URL(input).search); return Response.json(read(new URL(input))); });
  const resources = await inventory();
  assert.ok(reads.some((path) => path.startsWith("/v3/project-1/instances?limit=100")));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status, item.values?.mode, item.values?.version, item.values?.size]), [
    ["dds-1", "Replica One", "normal", "ReplicaSet", "4.0", 10],
    ["dds-2", "Single One", "normal", "Single", "4.0", 20],
    ["dds-pre", "Prepaid One", "normal", "ReplicaSet", "4.0", 10],
    ["dds-sh", "Cluster One", "normal", "Sharding", "4.0", 20],
  ]);
});

test("create options whitelist live replica and single offerings, on-sale zones, storage, and project networks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await ddsManagement.options!(session, "create");
  assert.deepEqual(choices.offerings.map((choice) => choice.value), [
    offering,
    JSON.stringify(["ReplicaSet", "5.0", "dds.mongodb.c6.large.4.repset"]),
    JSON.stringify(["Single", "4.0", "dds.mongodb.c6.large.4.single"]),
  ]);
  assert.ok(choices.offerings.every((choice) => !choice.value.includes("mongos")));
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1"]);
  assert.deepEqual(choices.storageTypes.map((choice) => choice.value), ["ULTRAHIGH"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1", "sg-2"]);
});

test("create sends the documented pay-per-use payload with the version's storage engine and the subnet network ID", async (t) => {
  const writes = mockCloud(t);
  const outcome = await ddsManagement.execute(session, "create", createValues);
  assert.equal(outcome.resourceId, "dds-new");
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  await ddsManagement.execute(session, "create", { ...createValues, offering: JSON.stringify(["ReplicaSet", "5.0", "dds.mongodb.c6.large.4.repset"]), diskSize: 100 });
  await ddsManagement.execute(session, "create", { ...createValues, offering: JSON.stringify(["Single", "4.0", "dds.mongodb.c6.large.4.single"]), name: "Solo", diskSize: 30 });
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances", method: "POST", body: { name: "Example", datastore: { type: "DDS-Community", version: "4.0", storage_engine: "wiredTiger" }, region: "sa-brazil-1", availability_zone: "az-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", mode: "ReplicaSet", flavor: [{ type: "replica", num: "3", storage: "ULTRAHIGH", size: "40", spec_code: "dds.mongodb.c6.large.4.repset" }], ssl_option: "1", charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" } },
    { path: "/v3/project-1/instances", method: "POST", body: { name: "Example", datastore: { type: "DDS-Community", version: "5.0", storage_engine: "rocksDB" }, region: "sa-brazil-1", availability_zone: "az-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", mode: "ReplicaSet", flavor: [{ type: "replica", num: "3", storage: "ULTRAHIGH", size: "100", spec_code: "dds.mongodb.c6.large.4.repset" }], ssl_option: "1", charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" } },
    { path: "/v3/project-1/instances", method: "POST", body: { name: "Solo", datastore: { type: "DDS-Community", version: "4.0", storage_engine: "wiredTiger" }, region: "sa-brazil-1", availability_zone: "az-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", mode: "Single", flavor: [{ type: "single", num: "1", storage: "ULTRAHIGH", size: "30", spec_code: "dds.mongodb.c6.large.4.single" }], ssl_option: "1", charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" } },
  ]);
});

test("create rejects forged or unavailable selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, offering: JSON.stringify(["ReplicaSet", "4.0", "forged-spec"]) }, /no longer available/],
    [{ ...createValues, offering: JSON.stringify(["Sharding", "4.0", "dds.mongodb.c6.medium.4.mongos"]) }, /Select an available version, mode/],
    [{ ...createValues, offering: JSON.stringify(["ReplicaSet", "3.4", "dds.mongodb.c6.large.4.repset"]) }, /version is no longer available/],
    [{ ...createValues, zone: "az-2" }, /not on sale in this availability zone/],
    [{ ...createValues, storageType: "ESSD" }, /storage type is unavailable/],
    [{ ...createValues, diskSize: 45 }, /multiples of 10/],
    [{ ...createValues, diskSize: 2010 }, /between 10 and 2000/],
    [{ ...createValues, offering: JSON.stringify(["Single", "4.0", "dds.mongodb.c6.large.4.single"]), diskSize: 1500 }, /between 10 and 1000/],
    [{ ...createValues, password: "alllowercase9" }, /at least three/],
    [{ ...createValues, password: "Str0ngPass(1)" }, /outside the supported DDS set/],
    [{ ...createValues, subnet: "forged-subnet" }, /subnet is no longer available/],
    [{ ...createValues, subnet: "subnet-2" }, /network ID/],
    [{ ...createValues, securityGroup: "forged-group" }, /security group is no longer available/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(ddsManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live choices and enforces documented storage bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = ddsManagement.operations.find((item) => item.id === "create")!;
  const choices = await ddsManagement.options!(session, "create");
  const values = validateManagementValues(operation, { ...createValues, offering: choices.offerings[0].value }, choices);
  assert.equal(values.name, "Example");
  assert.throws(() => validateManagementValues(operation, { ...values, offering: JSON.stringify(["ReplicaSet", "4.0", "forged-spec"]) }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...values, zone: "az-2" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...values, diskSize: 9 }, choices), /at least 10/);
  assert.throws(() => validateManagementValues(operation, { ...values, diskSize: 2001 }, choices), /no more than 2000/);
});

test("rename, restart, and delete use their native instance contracts and delete refuses prepaid instances", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(ddsManagement.execute(session, "delete", {}, prepaidResource), /pay-per-use instances only/);
  assert.equal(writes.length, 0);
  const rename = await ddsManagement.execute(session, "rename", { name: "Renamed" }, replicaResource);
  assert.equal(rename.asynchronous, undefined);
  const reboot = await ddsManagement.execute(session, "restart", {}, replicaResource);
  assert.equal(reboot.asynchronous, true);
  assert.equal(reboot.jobId, "cloud-job");
  const deletion = await ddsManagement.execute(session, "delete", {}, replicaResource);
  assert.equal(deletion.asynchronous, true);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/dds-1/modify-name", method: "PUT", body: { new_instance_name: "Renamed" } },
    { path: "/v3/project-1/instances/dds-1/restart", method: "POST", body: { target_id: "dds-1" } },
    { path: "/v3/project-1/instances/dds-1", method: "DELETE", body: undefined },
  ]);
  const deleteOperation = ddsManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(deleteOperation.confirmation, true);
  assert.ok(deleteOperation.impact);
});

test("storage expansion never shrinks, respects mode caps, and sends the documented enlarge-volume body", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(ddsManagement.execute(session, "resize-storage", { size: 10 }, replicaResource), /exceed the current 10 GB/);
  await assert.rejects(ddsManagement.execute(session, "resize-storage", { size: 15 }, replicaResource), /multiples of 10/);
  await assert.rejects(ddsManagement.execute(session, "resize-storage", { size: 5010 }, replicaResource), /between 10 and 5000/);
  await assert.rejects(ddsManagement.execute(session, "resize-storage", { size: 1500 }, singleResource), /between 10 and 1000/);
  await assert.rejects(ddsManagement.execute(session, "resize-storage", { size: 50 }, prepaidResource), /pay-per-use instances only/);
  await assert.rejects(ddsManagement.execute(session, "resize-storage", { size: 50 }, clusterResource), /ReplicaSet and Single instances only/);
  assert.equal(writes.length, 0);
  const outcome = await ddsManagement.execute(session, "resize-storage", { size: 50 }, replicaResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/dds-1/enlarge-volume", method: "POST", body: { volume: { size: "50" } } }]);
});

test("specification changes revalidate the live catalog, refuse prepaid or cluster instances, and require a different spec", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(ddsManagement.execute(session, "resize-flavor", { offering: "dds.mongodb.s2.medium.4.repset" }, replicaResource), /must differ/);
  await assert.rejects(ddsManagement.execute(session, "resize-flavor", { offering: "forged-spec" }, replicaResource), /no longer available/);
  await assert.rejects(ddsManagement.execute(session, "resize-flavor", { offering: "dds.mongodb.c6.large.4.repset" }, prepaidResource), /pay-per-use instances only/);
  await assert.rejects(ddsManagement.execute(session, "resize-flavor", { offering: "dds.mongodb.c6.large.4.repset" }, clusterResource), /ReplicaSet and Single instances only/);
  assert.equal(writes.length, 0);
  const outcome = await ddsManagement.execute(session, "resize-flavor", { offering: "dds.mongodb.c6.large.4.repset" }, replicaResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/dds-1/resize", method: "POST", body: { resize: { target_spec_code: "dds.mongodb.c6.large.4.repset", target_id: "dds-1" } } }]);
  const choices = await ddsManagement.options!(session, "resize-flavor", replicaResource);
  assert.deepEqual(choices.resizeOfferings.map((choice) => choice.value), ["dds.mongodb.c6.large.4.repset"]);
  assert.deepEqual(await ddsManagement.options!(session, "resize-flavor", clusterResource), {});
});

test("backup listing shows every backup and creation targets the documented nested backup body", async (t) => {
  const writes = mockCloud(t);
  const list = await ddsManagement.execute(session, "backups", {}, replicaResource);
  assert.equal(list.message, "3 backups loaded.");
  assert.ok(list.facts!.some((fact) => fact.label.startsWith("Manual Backup · Manual · COMPLETED")));
  await assert.rejects(ddsManagement.execute(session, "create-backup", { name: "Nightly", description: "bad < chars" }, replicaResource), /cannot contain the characters/);
  assert.equal(writes.length, 0);
  const created = await ddsManagement.execute(session, "create-backup", { name: "Nightly", description: "Before upgrade" }, replicaResource);
  assert.equal(created.resourceId, "backup-new");
  assert.equal(created.jobId, "cloud-job");
  assert.equal(created.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/backups", method: "POST", body: { backup: { instance_id: "dds-1", name: "Nightly", description: "Before upgrade" } } }]);
});

test("backup deletion revalidates the child ID and only removes completed manual backups", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(ddsManagement.execute(session, "delete-backup", { backup: "foreign" }, replicaResource), /Select a manual backup/);
  await assert.rejects(ddsManagement.execute(session, "delete-backup", { backup: "backup-auto" }, replicaResource), /Only manual backups/);
  await assert.rejects(ddsManagement.execute(session, "delete-backup", { backup: "backup-building" }, replicaResource), /Only completed backups/);
  assert.equal(writes.length, 0);
  await ddsManagement.execute(session, "delete-backup", { backup: "backup-manual" }, replicaResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/backups/backup-manual", method: "DELETE", body: undefined }]);
  const choices = await ddsManagement.options!(session, "delete-backup", replicaResource);
  assert.deepEqual(choices.backups.map((choice) => choice.value), ["backup-manual"]);
  assert.deepEqual(await ddsManagement.options!(session, "delete-backup"), {});
});

test("backup policy inspection reports retention, window, weekdays, and incremental backup", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const policy = await ddsManagement.execute(session, "backup-policy", {}, replicaResource);
  assert.equal(policy.message, "Backup policy loaded.");
  assert.deepEqual(policy.facts, [
    { label: "Retention", value: "7 days" },
    { label: "Backup window (UTC)", value: "08:00-09:00" },
    { label: "Backup weekdays", value: "Monday, Tuesday, Wednesday, Thursday, Friday" },
    { label: "Incremental backup", value: "Enabled" },
  ]);
});

test("retention uses the documented backup_policy body and enforces the daily-backup rule under seven days", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(ddsManagement.execute(session, "retention", { keepDays: 800, backupWindow: "08:00-09:00", weekdays: ["1", "2"] }, replicaResource), /1 to 732 days/);
  await assert.rejects(ddsManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: [] }, replicaResource), /at least one backup weekday/);
  await assert.rejects(ddsManagement.execute(session, "retention", { keepDays: 5, backupWindow: "08:00-09:00", weekdays: ["1", "2"] }, replicaResource), /daily backups/);
  assert.equal(writes.length, 0);
  await ddsManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: ["5", "1"] }, replicaResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/dds-1/backups/policy", method: "PUT", body: { backup_policy: { keep_days: 30, start_time: "08:00-09:00", period: "1,5" } } }]);
  const choices = await ddsManagement.options!(session, "retention", replicaResource);
  assert.equal(choices.backupWindows.length, 24);
  assert.ok(choices.backupWindows.some((choice) => choice.value === "23:00-00:00"));
  assert.deepEqual(choices.weekdays.map((choice) => choice.value), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("topology lists node roles and the replica set name for replica sets only", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname); return Response.json(read(new URL(input))); });
  const replica = await ddsManagement.execute(session, "topology", {}, replicaResource);
  assert.ok(replica.facts!.some((fact) => fact.label === "Replica One_replica_node_1 · Primary" && fact.value.includes("az-1")));
  assert.ok(replica.facts!.some((fact) => fact.label === "Replica set name" && fact.value === "replica"));
  assert.ok(reads.some((path) => path === "/v3/project-1/instances/dds-1/replica-set/name"));
  reads.length = 0;
  const single = await ddsManagement.execute(session, "topology", {}, singleResource);
  assert.ok(single.facts!.some((fact) => fact.label === "Single One_single_node_1 · Primary"));
  assert.ok(!reads.some((path) => path.endsWith("/replica-set/name")));
});

test("database user listing decodes the DDS JSON string payload", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const list = await ddsManagement.execute(session, "db-users", {}, replicaResource);
  assert.equal(list.message, "2 database users loaded.");
  assert.deepEqual(list.facts!.map((fact) => fact.label), ["rwuser @ admin", "appuser @ admin"]);
  assert.ok(list.facts!.some((fact) => fact.label === "appuser @ admin" && fact.value.includes("readWrite@appdb")));
});

test("a malformed database user payload blocks management instead of guessing entries", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ total_count: 1, users: "not-json" }));
  await assert.rejects(ddsManagement.execute(session, "db-users", {}, replicaResource));
});

test("database user creation guards the administrator account, duplicates, and password rules", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(ddsManagement.execute(session, "create-db-user", { name: "rwuser", password: "Str0ngPass!1", role: "readWrite" }, replicaResource), /administrator account/);
  await assert.rejects(ddsManagement.execute(session, "create-db-user", { name: "appuser", password: "Str0ngPass!1", role: "readWrite" }, replicaResource), /already exists/);
  await assert.rejects(ddsManagement.execute(session, "create-db-user", { name: "service", password: "alllowercase9", role: "readWrite" }, replicaResource), /at least three/);
  await assert.rejects(ddsManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", dbName: "bad-db", role: "readWrite" }, replicaResource), /Database names are 1-64/);
  assert.equal(writes.length, 0);
  await ddsManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", dbName: "appdb", role: "readWrite" }, replicaResource);
  await ddsManagement.execute(session, "create-db-user", { name: "reporter", password: "Str0ngPass!1", role: "read", roleDb: "appdb" }, replicaResource);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/dds-1/db-user", method: "POST", body: { user_name: "service", user_pwd: "Str0ngPass!1", db_name: "appdb", roles: [{ role_name: "readWrite", role_db_name: "appdb" }] } },
    { path: "/v3/project-1/instances/dds-1/db-user", method: "POST", body: { user_name: "reporter", user_pwd: "Str0ngPass!1", roles: [{ role_name: "read", role_db_name: "appdb" }] } },
  ]);
});

test("database user deletion and password reset revalidate fresh child identities and protect the administrator", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(ddsManagement.execute(session, "delete-db-user", { user: JSON.stringify(["rwuser", "admin"]) }, replicaResource), /administrator account/);
  await assert.rejects(ddsManagement.execute(session, "delete-db-user", { user: JSON.stringify(["ghost", "admin"]) }, replicaResource), /was not found on this instance/);
  await assert.rejects(ddsManagement.execute(session, "delete-db-user", { user: "not-json" }, replicaResource), /Select a database user/);
  await assert.rejects(ddsManagement.execute(session, "reset-password", { user: JSON.stringify(["ghost", "admin"]), password: "Str0ngPass!1" }, replicaResource), /was not found on this instance/);
  await assert.rejects(ddsManagement.execute(session, "reset-password", { user: JSON.stringify(["appuser", "admin"]), password: "weak" }, replicaResource), /8 to 32 characters/);
  assert.equal(writes.length, 0);
  await ddsManagement.execute(session, "delete-db-user", { user: JSON.stringify(["appuser", "admin"]) }, replicaResource);
  await ddsManagement.execute(session, "reset-password", { user: JSON.stringify(["appuser", "admin"]), password: "Str0ngPass!1" }, replicaResource);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/dds-1/db-user", method: "DELETE", body: { user_name: "appuser", db_name: "admin" } },
    { path: "/v3/project-1/instances/dds-1/reset-password", method: "PUT", body: { user_name: "appuser", user_pwd: "Str0ngPass!1", db_name: "admin" } },
  ]);
  const deleteChoices = await ddsManagement.options!(session, "delete-db-user", replicaResource);
  assert.deepEqual(deleteChoices.dbUsers.map((choice) => choice.value), [JSON.stringify(["appuser", "admin"])]);
  const resetChoices = await ddsManagement.options!(session, "reset-password", replicaResource);
  assert.deepEqual(resetChoices.dbUsers.map((choice) => choice.value), [JSON.stringify(["rwuser", "admin"]), JSON.stringify(["appuser", "admin"])]);
});

test("maintenance window and security group updates use their native contracts", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(ddsManagement.execute(session, "maintenance-window", { start: "02:00", end: "02:00" }, replicaResource), /different whole hours/);
  await assert.rejects(ddsManagement.execute(session, "security-group", { securityGroup: "forged-group" }, replicaResource), /no longer available/);
  await assert.rejects(ddsManagement.execute(session, "security-group", { securityGroup: "sg-1" }, replicaResource), /already uses/);
  assert.equal(writes.length, 0);
  await ddsManagement.execute(session, "maintenance-window", { start: "02:00", end: "06:00" }, replicaResource);
  const group = await ddsManagement.execute(session, "security-group", { securityGroup: "sg-2" }, replicaResource);
  assert.equal(group.jobId, "cloud-job");
  assert.equal(group.asynchronous, true);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/dds-1/maintenance-window", method: "PUT", body: { start_time: "02:00", end_time: "06:00" } },
    { path: "/v3/project-1/instances/dds-1/modify-security-group", method: "POST", body: { security_group_id: "sg-2" } },
  ]);
  const choices = await ddsManagement.options!(session, "security-group", replicaResource);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1", "sg-2"]);
});

test("job polling maps native job states and surfaces the job's instance ID", async (t) => {
  const replies = [
    { job: { id: "cloud-job", status: "Completed", instance: { id: "dds-new", name: "Example" } } },
    { job: { id: "cloud-job", status: "Failed", instance: { id: "dds-1" }, fail_reason: "Insufficient quota" } },
    { job: { id: "cloud-job", status: "Running", instance: { id: "dds-1" } } },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname + new URL(input).search, "/v3/project-1/jobs?id=cloud-job"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "dds", operation: "Create instance", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job" };
  const succeeded = await ddsManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "dds-new");
  const failed = await ddsManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /cloud job failed/);
  assert.ok(!failed.message!.includes("Insufficient quota"));
  const running = await ddsManagement.poll!(session, entry);
  assert.equal(running.state, "submitted");
});

test("outcomes and rejection errors never expose passwords", async (t) => {
  const writes = mockCloud(t);
  const weak = "alllowercase9";
  await assert.rejects(ddsManagement.execute(session, "create-db-user", { name: "service", password: weak, role: "readWrite" }, replicaResource), (error: Error) => !error.message.includes(weak));
  const secret = "Str0ngPass!1";
  const outcome = await ddsManagement.execute(session, "create-db-user", { name: "service", password: secret, role: "readWrite" }, replicaResource);
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal(writes.length, 1);
  assert.equal((writes[0].body as { user_pwd: string }).user_pwd, secret);
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(ddsManagement.execute(session, "attach-eip", {}, replicaResource), /Unsupported DDS operation/);
  assert.equal(writes.length, 0);
});

test("DDS user pagination decodes native JSON pages and refuses incomplete or malformed lists", async (t) => {
  const offsets: string[] = [];
  let malformed = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input); const offset = url.searchParams.get("offset") ?? "0";
    offsets.push(offset);
    return Response.json({ users: malformed ? "invalid-json" : JSON.stringify(Array.from({ length: offset === "0" ? 100 : 1 }, (_, i) => ({ user: `user${Number(offset) + i}`, db: "admin", roles: [] }))), total_count: 101 });
  });
  const result = await ddsManagement.execute(session, "db-users", {}, replicaResource);
  assert.equal(result.facts?.length, 101); assert.deepEqual(offsets, ["0", "100"]);
  malformed = true;
  await assert.rejects(ddsManagement.execute(session, "db-users", {}, replicaResource));
});

test("DDS never deletes a backup belonging to another instance even if the provider ignores its filter", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => {
    assert.ok(!init.method);
    return Response.json({ backups: [{ id: "foreign", instance_id: "other", type: "Manual", status: "COMPLETED" }], total_count: 1 });
  });
  assert.deepEqual((await ddsManagement.options!(session, "delete-backup", replicaResource)).backups, []);
  await assert.rejects(ddsManagement.execute(session, "delete-backup", { backup: "foreign" }, replicaResource), /Select a manual backup/);
});

test("DDS resize rejects a specification unavailable for any current node zone or engine version", async (t) => {
  let incompatibleVersion = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.ok(!init.method); const url = new URL(input);
    if (url.pathname.endsWith("/flavors")) return Response.json({ flavors: [{ ...flavors[0], engine_versions: incompatibleVersion ? ["5.0"] : ["4.0"], az_status: { "az-1": "normal", "az-2": "sellout" } }] });
    return Response.json({ instances: [{ ...replicaInstance, groups: [{ ...replicaInstance.groups[0], nodes: [{ ...replicaInstance.groups[0].nodes[0], availability_zone: incompatibleVersion ? "az-1" : "az-2" }] }] }] });
  });
  assert.deepEqual((await ddsManagement.options!(session, "resize-flavor", replicaResource)).resizeOfferings, []);
  await assert.rejects(ddsManagement.execute(session, "resize-flavor", { offering: flavors[0].spec_code }, replicaResource), /no longer available/);
  incompatibleVersion = true;
  await assert.rejects(ddsManagement.execute(session, "resize-flavor", { offering: flavors[0].spec_code }, replicaResource), /no longer available/);
});

test("DDS native jobs must match the stored job and instance", async (t) => {
  let wrongJob = true;
  t.mock.method(globalThis, "fetch", async () => Response.json({ job: { id: wrongJob ? "other" : "cloud-job", status: "Completed", instance: { id: "other-instance" } } }));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "dds", operation: "Restart instance", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job", resourceId: "dds-1" };
  await assert.rejects(ddsManagement.poll!(session, entry), /different DDS job/);
  wrongJob = false; await assert.rejects(ddsManagement.poll!(session, entry), /does not belong/);
});
