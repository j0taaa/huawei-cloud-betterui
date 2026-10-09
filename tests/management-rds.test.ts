import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { rdsManagement } from "@/lib/huawei/management/adapters/rds";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const mysqlInstance = { id: "rds-1", name: "Database One", status: "ACTIVE", datastore: { type: "MySQL", version: "8.0" }, volume: { type: "ULTRAHIGH", size: 40 }, flavor_ref: "rds.mysql.c3.large.4.single", charge_info: { charge_mode: "postPaid" }, vpc_id: "vpc-1", subnet_id: "subnet-1", private_ips: ["10.0.0.10"], nodes: [{ id: "node-1", availability_zone: "az-1", status: "ACTIVE" }] };
const pgInstance = { id: "pg-1", name: "Pg Instance", status: "ACTIVE", datastore: { type: "PostgreSQL", version: "15" }, volume: { type: "ULTRAHIGH", size: 80 }, flavor_ref: "rds.pg.c3.large.4.single", charge_info: { charge_mode: "postPaid" }, vpc_id: "vpc-1", subnet_id: "subnet-1", private_ips: ["10.0.0.11"], nodes: [{ id: "node-2", availability_zone: "az-1", status: "ACTIVE" }] };
const backups = [
  { id: "backup-manual", name: "Manual Backup", type: "manual", status: "COMPLETED", begin_time: "2026-01-02T00:00:00Z" },
  { id: "backup-auto", name: "Auto Backup", type: "auto", status: "COMPLETED", begin_time: "2026-01-01T00:00:00Z" },
  { id: "backup-building", name: "Building Backup", type: "manual", status: "BUILDING", begin_time: "2026-01-03T00:00:00Z" },
];
const databases = [{ name: "appdata", character_set: "utf8mb4", comment: "Application data" }, { name: "mysql", character_set: "utf8" }];
const users = [{ name: "appuser", hosts: ["%"], comment: "Application account" }, { name: "root", hosts: ["%"] }];
const writeResponse = { job_id: "cloud-job", instance: { id: "new-rds" }, backup: { id: "backup-new" } };

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v3/project-1/instances") {
    if (url.searchParams.has("id")) return { instances: [url.searchParams.get("id") === "pg-1" ? pgInstance : mysqlInstance] };
    return { instances: [mysqlInstance, pgInstance], total_count: 2 };
  }
  if (path === "/v3/project-1/flavors/MySQL") return { flavors: [
    { id: "f1", spec_code: "rds.mysql.c3.large.4.single", instance_mode: "single", vcpus: "2", ram: 8192, version_name: ["5.7", "8.0"], az_status: { "az-1": "normal", "az-2": "sellout", "az-3": "normal" }, az_desc: { "az-1": "AZ one" } },
    { id: "f2", spec_code: "rds.mysql.c3.large.4.ha", instance_mode: "ha", vcpus: "2", ram: 8192, version_name: ["8.0"], az_status: { "az-1": "normal" } },
  ] };
  if (path === "/v3/project-1/flavors/PostgreSQL") return { flavors: [
    { id: "f3", spec_code: "rds.pg.c3.large.4.single", instance_mode: "single", vcpus: "2", ram: 8192, version_name: ["15"], az_status: { "az-1": "normal" } },
  ] };
  if (path === "/v3/project-1/storage-type/MySQL") return { storage_type: [{ name: "ULTRAHIGH", az_status: { "az-1": "normal", "az-2": "normal" } }, { name: "LOCALSSD", az_status: { "az-1": "normal" } }] };
  if (path === "/v3/project-1/storage-type/PostgreSQL") return { storage_type: [{ name: "ULTRAHIGH", az_status: { "az-1": "normal" } }] };
  if (path === "/v1/project-1/subnets") return { subnets: [{ id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet", cidr: "192.168.0.0/24" }] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Security" }] };
  if (path === "/v3/project-1/backups") return { backups, total_count: backups.length };
  if (path === "/v3/project-1/instances/rds-1/database/detail") return { databases, total_count: databases.length };
  if (path === "/v3/project-1/instances/rds-1/db_user/detail") return { users, total_count: users.length };
  if (path === "/v3/project-1/instances/pg-1/database/detail") return { databases: [{ name: "appdb", character_set: "UTF8" }], total_count: 1 };
  if (path === "/v3/project-1/instances/pg-1/db_user/detail") return { users: [{ name: "root" }], total_count: 1 };
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
  return await rdsManagement.inventory(session);
}

const mysqlResource: ManagementResource = { id: "rds-1", name: "Database One", status: "ACTIVE", values: { engine: "MySQL", size: 40, chargeMode: "postPaid" } };
const pgResource: ManagementResource = { id: "pg-1", name: "Pg Instance", status: "ACTIVE", values: { engine: "PostgreSQL", size: 80, chargeMode: "postPaid" } };
const offering = JSON.stringify(["MySQL", "8.0", "rds.mysql.c3.large.4.single"]);
const createValues: ManagementValues = { name: "Example", offering, storageType: "ULTRAHIGH", zone: "az-1", subnet: "subnet-1", securityGroup: "sg-1", diskSize: 40, password: "Str0ngPass!1", enterpriseProjectId: "0" };

test("inventory maps the canonical instance list with engine and storage facts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname + new URL(input).search); return Response.json(read(new URL(input))); });
  const resources = await inventory();
  assert.ok(reads.some((path) => path.startsWith("/v3/project-1/instances?limit=100")));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status, item.values?.engine, item.values?.version, item.values?.size, item.values?.chargeMode]), [
    ["rds-1", "Database One", "ACTIVE", "MySQL", "8.0", 40, "postPaid"],
    ["pg-1", "Pg Instance", "ACTIVE", "PostgreSQL", "15", 80, "postPaid"],
  ]);
});

test("create options whitelist live single-node offerings, on-sale zones, storage, and project networks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await rdsManagement.options!(session, "create");
  assert.deepEqual(choices.offerings.map((choice) => choice.value), [
    JSON.stringify(["MySQL", "5.7", "rds.mysql.c3.large.4.single"]),
    offering,
    JSON.stringify(["PostgreSQL", "15", "rds.pg.c3.large.4.single"]),
  ]);
  assert.ok(choices.offerings.every((choice) => !choice.value.includes(".ha\"")));
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1", "az-3"]);
  assert.deepEqual(choices.storageTypes.map((choice) => choice.value), ["ULTRAHIGH", "LOCALSSD"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1"]);
});

test("create sends the documented pay-per-use single-node payload", async (t) => {
  const writes = mockCloud(t);
  const outcome = await rdsManagement.execute(session, "create", createValues);
  assert.equal(outcome.resourceId, "new-rds");
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{
    path: "/v3/project-1/instances", method: "POST",
    body: { name: "Example", datastore: { type: "MySQL", version: "8.0" }, flavor_ref: "rds.mysql.c3.large.4.single", volume: { type: "ULTRAHIGH", size: 40 }, region: "sa-brazil-1", availability_zone: "az-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" },
  }]);
});

test("create rejects forged or unavailable selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, offering: JSON.stringify(["MySQL", "8.0", "forged-flavor"]) }, /no longer available/],
    [{ ...createValues, offering: JSON.stringify(["SQLServer", "2019", "rds.sql.x1"]) }, /Select an available engine/],
    [{ ...createValues, zone: "az-2" }, /not on sale in this availability zone/],
    [{ ...createValues, zone: "az-3" }, /storage type is not on sale/],
    [{ ...createValues, storageType: "ESSD" }, /unavailable for this engine/],
    [{ ...createValues, diskSize: 45 }, /multiples of 10/],
    [{ ...createValues, diskSize: 30 }, /between 40 and 4000/],
    [{ ...createValues, password: "alllowercase9" }, /at least three/],
    [{ ...createValues, password: "Str0ngPass(1)" }, /outside the supported MySQL set/],
    [{ ...createValues, subnet: "forged-subnet" }, /subnet is no longer available/],
    [{ ...createValues, securityGroup: "forged-group" }, /security group is no longer available/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(rdsManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live choices and enforces documented disk bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = rdsManagement.operations.find((item) => item.id === "create")!;
  const choices = await rdsManagement.options!(session, "create");
  const values = validateManagementValues(operation, { ...createValues, offering: choices.offerings[1].value }, choices);
  assert.equal(values.name, "Example");
  assert.throws(() => validateManagementValues(operation, { ...values, offering: JSON.stringify(["MySQL", "8.0", "forged-flavor"]) }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...values, zone: "az-2" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...values, diskSize: 39 }, choices), /at least 40/);
  assert.throws(() => validateManagementValues(operation, { ...values, diskSize: 4001 }, choices), /no more than 4000/);
});

test("rename, reboot, and delete use their native instance contracts", async (t) => {
  const writes = mockCloud(t);
  const rename = await rdsManagement.execute(session, "rename", { name: "Renamed" }, mysqlResource);
  assert.equal(rename.asynchronous, undefined);
  const reboot = await rdsManagement.execute(session, "reboot", {}, mysqlResource);
  assert.equal(reboot.asynchronous, true);
  assert.equal(reboot.jobId, "cloud-job");
  const deletion = await rdsManagement.execute(session, "delete", {}, mysqlResource);
  assert.equal(deletion.asynchronous, true);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/rds-1/name", method: "PUT", body: { name: "Renamed" } },
    { path: "/v3/project-1/instances/rds-1/action", method: "POST", body: { restart: {} } },
    { path: "/v3/project-1/instances/rds-1", method: "DELETE", body: undefined },
  ]);
  const deleteOperation = rdsManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(deleteOperation.confirmation, true);
  assert.ok(deleteOperation.impact);
});

test("storage expansion never shrinks and sends the documented enlarge_volume action", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(rdsManagement.execute(session, "resize-storage", { size: 40 }, mysqlResource), /exceed the current 40 GB/);
  await assert.rejects(rdsManagement.execute(session, "resize-storage", { size: 45 }, mysqlResource), /multiples of 10/);
  assert.equal(writes.length, 0);
  const outcome = await rdsManagement.execute(session, "resize-storage", { size: 50 }, mysqlResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/rds-1/action", method: "POST", body: { enlarge_volume: { size: 50 } } }]);
});

test("backup listing shows every backup and creation targets the documented endpoint", async (t) => {
  const writes = mockCloud(t);
  const list = await rdsManagement.execute(session, "backups", {}, mysqlResource);
  assert.equal(list.message, "3 backups loaded.");
  assert.ok(list.facts!.some((fact) => fact.label.startsWith("Manual Backup · manual · COMPLETED")));
  const created = await rdsManagement.execute(session, "create-backup", { name: "Nightly", description: "Before upgrade" }, mysqlResource);
  assert.equal(created.resourceId, "backup-new");
  assert.equal(created.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/backups", method: "POST", body: { instance_id: "rds-1", name: "Nightly", description: "Before upgrade" } }]);
});

test("backup deletion revalidates the child ID and only removes completed manual backups", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(rdsManagement.execute(session, "delete-backup", { backup: "foreign" }, mysqlResource), /Select a manual backup/);
  await assert.rejects(rdsManagement.execute(session, "delete-backup", { backup: "backup-auto" }, mysqlResource), /Only manual backups/);
  await assert.rejects(rdsManagement.execute(session, "delete-backup", { backup: "backup-building" }, mysqlResource), /Only completed backups/);
  assert.equal(writes.length, 0);
  await rdsManagement.execute(session, "delete-backup", { backup: "backup-manual" }, mysqlResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/backups/backup-manual", method: "DELETE", body: undefined }]);
  const choices = await rdsManagement.options!(session, "delete-backup", mysqlResource);
  assert.deepEqual(choices.backups.map((choice) => choice.value), ["backup-manual"]);
});

test("retention uses the documented backup_policy body and engine retention caps", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(rdsManagement.execute(session, "retention", { keepDays: 800, backupWindow: "08:00-09:00", weekdays: ["1", "2"] }, mysqlResource), /1-732 days on MySQL/);
  await assert.rejects(rdsManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: [] }, mysqlResource), /at least one backup weekday/);
  assert.equal(writes.length, 0);
  await rdsManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: ["1", "2", "3", "4", "5"] }, mysqlResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/rds-1/backups/policy", method: "PUT", body: { backup_policy: { keep_days: 30, start_time: "08:00-09:00", period: "1,2,3,4,5" } } }]);
  const choices = await rdsManagement.options!(session, "retention", mysqlResource);
  assert.equal(choices.backupWindows.length, 23);
  assert.deepEqual(choices.weekdays.map((choice) => choice.value), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("database lifecycle guards system databases and stale child names", async (t) => {
  const writes = mockCloud(t);
  const list = await rdsManagement.execute(session, "databases", {}, mysqlResource);
  assert.equal(list.message, "2 databases loaded.");
  assert.deepEqual(list.facts!.map((fact) => fact.label), ["appdata", "mysql"]);
  await rdsManagement.execute(session, "create-database", { name: "appdata2", characterSet: "utf8mb4", comment: "Extra data" }, mysqlResource);
  await assert.rejects(rdsManagement.execute(session, "delete-database", { database: "mysql" }, mysqlResource), /System databases cannot be deleted/);
  await assert.rejects(rdsManagement.execute(session, "delete-database", { database: "missing" }, mysqlResource), /was not found on this instance/);
  assert.equal(writes.length, 1);
  await rdsManagement.execute(session, "delete-database", { database: "appdata" }, mysqlResource);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/rds-1/database", method: "POST", body: { name: "appdata2", character_set: "utf8mb4", comment: "Extra data" } },
    { path: "/v3/project-1/instances/rds-1/database/appdata", method: "DELETE", body: undefined },
  ]);
  const choices = await rdsManagement.options!(session, "delete-database", mysqlResource);
  assert.deepEqual(choices.databases.map((choice) => choice.value), ["appdata"]);
});

test("database user lifecycle guards protected accounts, hosts, and password rules", async (t) => {
  const writes = mockCloud(t);
  const list = await rdsManagement.execute(session, "db-users", {}, mysqlResource);
  assert.equal(list.message, "2 database users loaded.");
  assert.ok(list.facts!.some((fact) => fact.label === "appuser" && fact.value.includes("%")));
  await assert.rejects(rdsManagement.execute(session, "create-db-user", { name: "service", password: "alllowercase9" }, mysqlResource), /at least three/);
  await assert.rejects(rdsManagement.execute(session, "create-db-user", { name: "Abc123!xyz", password: "Abc123!xyz" }, mysqlResource), /cannot match the account name/);
  await assert.rejects(rdsManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", hosts: ["bad-host"] }, mysqlResource), /IPv4 addresses/);
  await assert.rejects(rdsManagement.execute(session, "create-db-user", { name: "root", password: "Str0ngPass!1" }, mysqlResource), /Protected database user names/);
  await assert.rejects(rdsManagement.execute(session, "delete-db-user", { user: "root" }, mysqlResource), /Protected database users/);
  await assert.rejects(rdsManagement.execute(session, "delete-db-user", { user: "missing" }, mysqlResource), /was not found on this instance/);
  assert.equal(writes.length, 0);
  await rdsManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", hosts: ["10.0.0.%"] }, mysqlResource);
  await rdsManagement.execute(session, "delete-db-user", { user: "appuser" }, mysqlResource);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/rds-1/db_user", method: "POST", body: { name: "service", password: "Str0ngPass!1", hosts: ["10.0.0.%"] } },
    { path: "/v3/project-1/instances/rds-1/db_user/appuser", method: "DELETE", body: undefined },
  ]);
  const choices = await rdsManagement.options!(session, "delete-db-user", mysqlResource);
  assert.deepEqual(choices.dbUsers.map((choice) => choice.value), ["appuser"]);
});

test("PostgreSQL database and user operations use engine-specific contracts", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(rdsManagement.execute(session, "create-database", { name: "pgdata", characterSet: "UTF8" }, pgResource), /cannot start with pg/);
  await assert.rejects(rdsManagement.execute(session, "create-db-user", { name: "appuser", password: "Str0ngPass!1", hosts: ["%"] }, pgResource), /MySQL instances only/);
  await assert.rejects(rdsManagement.execute(session, "delete-database", { database: "postgres" }, pgResource), /System databases cannot be deleted/);
  assert.equal(writes.length, 0);
  await rdsManagement.execute(session, "create-database", { name: "appdb", characterSet: "UTF8" }, pgResource);
  await rdsManagement.execute(session, "create-db-user", { name: "appuser", password: "Str0ngPass!1" }, pgResource);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/pg-1/database", method: "POST", body: { name: "appdb", character_set: "UTF8" } },
    { path: "/v3/project-1/instances/pg-1/db_user", method: "POST", body: { name: "appuser", password: "Str0ngPass!1" } },
  ]);
});

test("job polling maps native job states and surfaces created resource IDs", async (t) => {
  const replies = [
    { job: { status: "Completed", entities: { resource_ids: ["rds-new"] } } },
    { job: { status: "Failed", fail_reason: "Insufficient quota" } },
    { job: { status: "Running" } },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname + new URL(input).search, "/v3/project-1/jobs?id=cloud-job"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "rds", operation: "Create instance", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job" };
  const succeeded = await rdsManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "rds-new");
  const failed = await rdsManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /Insufficient quota/);
  const running = await rdsManagement.poll!(session, entry);
  assert.equal(running.state, "submitted");
});

test("outcomes and rejection errors never expose passwords", async (t) => {
  const writes = mockCloud(t);
  const weak = "alllowercase9";
  await assert.rejects(rdsManagement.execute(session, "create-db-user", { name: "service", password: weak }, mysqlResource), (error: Error) => !error.message.includes(weak));
  const secret = "Str0ngPass!1";
  const outcome = await rdsManagement.execute(session, "create-db-user", { name: "service", password: secret }, mysqlResource);
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal(writes.length, 1);
  assert.equal((writes[0].body as { password: string }).password, secret);
});

test("child option loaders refuse unsupported engines instead of guessing contracts", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const sqlServer: ManagementResource = { id: "sql-1", name: "Legacy Server", status: "ACTIVE", values: { engine: "SQLServer" } };
  assert.deepEqual(await rdsManagement.options!(session, "delete-database", sqlServer), {});
  assert.deepEqual(await rdsManagement.options!(session, "delete-db-user", sqlServer), {});
  await assert.rejects(rdsManagement.execute(session, "create-database", { name: "appdb", characterSet: "utf8mb4" }, sqlServer), /MySQL and PostgreSQL instances only/);
});

test("prepaid RDS deletion and resizing cannot enter pay-per-use native workflows", async t => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async () => { writes++; return Response.json({}); });
  const prepaid = { ...mysqlResource, values: { ...mysqlResource.values, chargeMode: "prePaid" } };
  await assert.rejects(rdsManagement.execute(session, "delete", {}, prepaid), /prepaid/);
  await assert.rejects(rdsManagement.execute(session, "resize-storage", { size: 100 }, prepaid), /Prepaid/);
  assert.equal(writes, 0);
});
