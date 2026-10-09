import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { taurusdbManagement } from "@/lib/huawei/management/adapters/taurusdb";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

test("TaurusDB resize uses the current multi-AZ catalog and refuses unverified detail IDs", async t => {
  let missingId = false;
  let flavorMode = "";
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v3.1/project-1/instances/taurus-1") return Response.json({ instance: { ...detail, id: missingId ? undefined : "taurus-1", nodes: detail.nodes.map((node, index) => ({ ...node, az_code: index ? "az-2" : "az-1" })) } });
    if (url.pathname.endsWith("/flavors/gaussdb-mysql")) flavorMode = url.searchParams.get("availability_zone_mode")!;
    return Response.json(read(url));
  });
  await taurusdbManagement.options!(session, "resize-flavor", resource);
  assert.equal(flavorMode, "multi");
  missingId = true;
  await assert.rejects(taurusdbManagement.options!(session, "resize-flavor", resource), /different TaurusDB instance/);
});

const detail = {
  id: "taurus-1", name: "Database One", status: "ACTIVE", port: "3306", time_zone: "UTC", az_mode: "single", master_az_code: "az-1", maintenance_window: "22:00-02:00", db_user_name: "root",
  nodes: [
    { id: "node-1", name: "node-1", type: "master", status: "ACTIVE", az_code: "az-1", private_read_ips: ["10.0.0.11"] },
    { id: "node-2", name: "node-2", type: "slave", status: "ACTIVE", az_code: "az-1", private_read_ips: ["10.0.0.12"] },
  ],
};
const instance = {
  id: "taurus-1", name: "Database One", status: "ACTIVE", type: "Cluster", datastore: { type: "gaussdb-mysql", version: "8.0" }, flavor_ref: "gaussdb.mysql.xlarge.x86.4",
  charge_info: { charge_mode: "postPaid" }, vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", volume: { type: "DL6", size: "40" },
  private_ips: ["10.0.0.10"], db_user_name: "root",
};
const prepaidInstance = { ...instance, id: "taurus-prepaid", name: "Prepaid Database", charge_info: { charge_mode: "prePaid" } };
const instances = [instance, prepaidInstance];
const backups = [
  { id: "backup-manual", name: "Manual Backup", type: "manual", status: "COMPLETED", begin_time: "2026-01-02T00:00:00Z", size: 1024, instance_id: "taurus-1" },
  { id: "backup-auto", name: "Auto Backup", type: "auto", status: "COMPLETED", begin_time: "2026-01-01T00:00:00Z", size: 2048, instance_id: "taurus-1" },
  { id: "backup-building", name: "Building Backup", type: "manual", status: "BUILDING", begin_time: "2026-01-03T00:00:00Z", size: 0, instance_id: "taurus-1" },
  { id: "backup-foreign", name: "Foreign Backup", type: "manual", status: "COMPLETED", begin_time: "2026-01-04T00:00:00Z", size: 512, instance_id: "other-instance" },
];
const databases = [{ name: "appdata", charset: "utf8mb4", comment: "Application data" }, { name: "mysql", charset: "utf8" }];
const users = [
  { name: "appuser", host: "%", comment: "Application account", databases: [{ name: "appdata", readonly: false }] },
  { name: "root", host: "%", comment: "Administrator" },
];
const flavors = [
  { spec_code: "gaussdb.mysql.xlarge.x86.4", vcpus: "4", ram: 16, version_name: "8.0", instance_mode: "Cluster", az_status: { "az-1": "normal", "az-2": "sellout" } },
  { spec_code: "gaussdb.mysql.xlarge.x86.8", vcpus: "4", ram: 32, version_name: "8.0", instance_mode: "Cluster", az_status: { "az-1": "normal" } },
  { spec_code: "gaussdb.mysql.large.arm.4", vcpus: "2", ram: 8, version_name: "8.0", instance_mode: "StandSingle", az_status: { "az-1": "normal" } },
  { spec_code: "gaussdb.mysql.xlarge.x86.4", vcpus: "4", ram: 16, version_name: "5.7", instance_mode: "Cluster", az_status: { "az-1": "normal" } },
  { spec_code: "gaussdb.mysql.large.arm.2", vcpus: "2", ram: 4, version_name: "8.0", instance_mode: "single", az_status: { "az-1": "normal" } },
];
const writeResponse = { job_id: "cloud-job", instance: { id: "new-taurus" }, size: 100, backup_id: "backup-new" };

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v3.1/project-1/instances") {
    const id = url.searchParams.get("id");
    if (id) {
      const found = instances.find((item) => item.id === id);
      return { instances: found ? [found] : [], total_count: found ? 1 : 0 };
    }
    return { instances, total_count: instances.length };
  }
  if (path === "/v3.1/project-1/instances/taurus-1" || path === "/v3.1/project-1/instances/taurus-prepaid") return { instance: { ...detail, id: path.split("/").at(-1)!, name: path.includes("prepaid") ? "Prepaid Database" : "Database One" } };
  if (path === "/v3/project-1/instances/taurus-1/backups/policy") return { backup_policy: { keep_days: 7, start_time: "08:00-09:00", period: "1,2,3,4,5" } };
  if (path === "/v3/project-1/instances/taurus-1/databases") return { databases, total_count: databases.length };
  if (path === "/v3/project-1/instances/taurus-1/databases/charsets") return { charsets: ["utf8mb4", "gbk"] };
  if (path === "/v3/project-1/instances/taurus-1/db-users") return { users, total_count: users.length };
  if (path === "/v3/project-1/datastores/gaussdb-mysql") return { datastores: [{ id: "d1", version: "8.0" }] };
  if (path === "/v3/project-1/flavors/gaussdb-mysql") return { flavors };
  if (path === "/v3/project-1/backups") return { backups, total_count: backups.length };
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet", cidr: "192.168.0.0/24" },
    { id: "subnet-2", neutron_network_id: "", vpc_id: "vpc-1", name: "Broken", cidr: "10.0.0.0/24" },
  ] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Security" }, { id: "sg-2", name: "Other" }] };
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

const resource: ManagementResource = { id: "taurus-1", name: "Database One", status: "ACTIVE", values: { name: "Database One", version: "8.0", flavor: "gaussdb.mysql.xlarge.x86.4", size: 40, chargeMode: "postPaid" } };
const prepaidResource: ManagementResource = { id: "taurus-prepaid", name: "Prepaid Database", status: "ACTIVE", values: { chargeMode: "prePaid" } };
const offering = JSON.stringify(["8.0", "Cluster", "gaussdb.mysql.xlarge.x86.4"]);
const createValues: ManagementValues = { name: "Example", offering, zone: "az-1", subnet: "subnet-1", securityGroup: "sg-1", password: "Str0ngPass!1", enterpriseProjectId: "0" };

test("inventory maps the canonical instance list with version, specification, and billing facts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname + new URL(input).search); return Response.json(read(new URL(input))); });
  const resources = await taurusdbManagement.inventory(session);
  assert.ok(reads.some((path) => path.startsWith("/v3.1/project-1/instances?limit=100")));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status, item.values?.version, item.values?.flavor, item.values?.size, item.values?.chargeMode]), [
    ["taurus-1", "Database One", "ACTIVE", "8.0", "gaussdb.mysql.xlarge.x86.4", 40, "postPaid"],
    ["taurus-prepaid", "Prepaid Database", "ACTIVE", "8.0", "gaussdb.mysql.xlarge.x86.4", 40, "prePaid"],
  ]);
});

test("create options whitelist live version and specification pairs, on-sale zones, and project networks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await taurusdbManagement.options!(session, "create");
  assert.deepEqual(choices.offerings.map((choice) => choice.value), [
    offering,
    JSON.stringify(["8.0", "Cluster", "gaussdb.mysql.xlarge.x86.8"]),
    JSON.stringify(["8.0", "StandSingle", "gaussdb.mysql.large.arm.4"]),
  ]);
  assert.ok(choices.offerings.every((choice) => !choice.value.includes("5.7") && !choice.value.includes("single")));
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1", "sg-2"]);
});

test("create sends the documented pay-per-use single-AZ payload with the subnet network ID", async (t) => {
  const writes = mockCloud(t);
  const outcome = await taurusdbManagement.execute(session, "create", createValues);
  assert.equal(outcome.resourceId, "new-taurus");
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{
    path: "/v3/project-1/instances", method: "POST",
    body: { name: "Example", datastore: { type: "gaussdb-mysql", version: "8.0" }, mode: "Cluster", flavor_ref: "gaussdb.mysql.xlarge.x86.4", region: "sa-brazil-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", availability_zone_mode: "single", master_availability_zone: "az-1", slave_count: 0, charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" },
  }]);
});

test("create rejects forged, stale, or undocumented selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, offering: JSON.stringify(["8.0", "Cluster", "forged-spec"]) }, /no longer available/],
    [{ ...createValues, offering: JSON.stringify(["8.0", "single", "gaussdb.mysql.large.arm.2"]) }, /Select an available version, mode/],
    [{ ...createValues, offering: JSON.stringify(["5.7", "Cluster", "gaussdb.mysql.xlarge.x86.4"]) }, /version is no longer available/],
    [{ ...createValues, zone: "az-2" }, /not on sale in this availability zone/],
    [{ ...createValues, subnet: "forged-subnet" }, /subnet is no longer available/],
    [{ ...createValues, subnet: "subnet-2" }, /does not expose the network ID/],
    [{ ...createValues, securityGroup: "forged-group" }, /security group is no longer available/],
    [{ ...createValues, password: "alllowercase9" }, /at least three/],
    [{ ...createValues, password: "Str0ngPass[1]" }, /outside the supported TaurusDB set/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(taurusdbManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live choices and documented password bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = taurusdbManagement.operations.find((item) => item.id === "create")!;
  const choices = await taurusdbManagement.options!(session, "create");
  const values = validateManagementValues(operation, createValues, choices);
  assert.equal(values.name, "Example");
  assert.throws(() => validateManagementValues(operation, { ...createValues, offering: JSON.stringify(["8.0", "Cluster", "forged-spec"]) }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, zone: "az-2" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, password: "short" }, choices), /invalid format/);
});

test("rename, restart, and delete use their native instance contracts with fresh scope checks", async (t) => {
  const writes = mockCloud(t);
  const rename = await taurusdbManagement.execute(session, "rename", { name: "Renamed" }, resource);
  assert.equal(rename.asynchronous, true);
  assert.equal(rename.jobId, "cloud-job");
  const restart = await taurusdbManagement.execute(session, "restart", {}, resource);
  assert.equal(restart.asynchronous, true);
  const deletion = await taurusdbManagement.execute(session, "delete", {}, resource);
  assert.equal(deletion.asynchronous, true);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/taurus-1/name", method: "PUT", body: { name: "Renamed" } },
    { path: "/v3/project-1/instances/taurus-1/restart", method: "POST", body: {} },
    { path: "/v3/project-1/instances/taurus-1", method: "DELETE", body: undefined },
  ]);
  const deleteOperation = taurusdbManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(deleteOperation.confirmation, true);
  assert.ok(deleteOperation.impact);
  const restartOperation = taurusdbManagement.operations.find((item) => item.id === "restart")!;
  assert.deepEqual(restartOperation.allowedStatuses, ["ACTIVE"]);
});

test("stale or foreign instance IDs cannot enter mutation workflows", async (t) => {
  const writes = mockCloud(t);
  const stale: ManagementResource = { id: "taurus-missing", name: "Missing", status: "ACTIVE" };
  await assert.rejects(taurusdbManagement.execute(session, "restart", {}, stale), /not found in this project/);
  await assert.rejects(taurusdbManagement.execute(session, "delete", {}, stale), /not found in this project/);
  assert.equal(writes.length, 0);
});

test("prepaid instances cannot enter pay-per-use deletion or resizing workflows", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(taurusdbManagement.execute(session, "delete", {}, prepaidResource), /subscription order/);
  await assert.rejects(taurusdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.mysql.xlarge.x86.8" }, prepaidResource), /subscription order/);
  await assert.rejects(taurusdbManagement.execute(session, "resize-storage", { size: 100 }, prepaidResource), /subscription order/);
  assert.equal(writes.length, 0);
});

test("specification changes require a different compatible on-sale specification", async (t) => {
  const writes = mockCloud(t);
  const choices = await taurusdbManagement.options!(session, "resize-flavor", resource);
  assert.deepEqual(choices.resizeOfferings.map((choice) => choice.value), ["gaussdb.mysql.xlarge.x86.8"]);
  await assert.rejects(taurusdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.mysql.xlarge.x86.4" }, resource), /must differ from the current/);
  await assert.rejects(taurusdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.mysql.large.arm.4" }, resource), /no longer available for this instance/);
  await assert.rejects(taurusdbManagement.execute(session, "resize-flavor", { offering: "forged-spec" }, resource), /no longer available for this instance/);
  assert.equal(writes.length, 0);
  const outcome = await taurusdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.mysql.xlarge.x86.8" }, resource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/taurus-1/action", method: "POST", body: { resize_flavor: { spec_code: "gaussdb.mysql.xlarge.x86.8" } } }]);
});

test("storage expansion never shrinks and sends the documented volume extend body", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(taurusdbManagement.execute(session, "resize-storage", { size: 40 }, resource), /exceed the current 40 GB/);
  await assert.rejects(taurusdbManagement.execute(session, "resize-storage", { size: 45 }, resource), /multiples of 10/);
  await assert.rejects(taurusdbManagement.execute(session, "resize-storage", { size: 10 }, resource), /between 20 and 128000/);
  assert.equal(writes.length, 0);
  const outcome = await taurusdbManagement.execute(session, "resize-storage", { size: 100 }, resource);
  assert.equal(outcome.asynchronous, true);
  assert.match(outcome.message, /100 GB/);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/taurus-1/volume/extend", method: "POST", body: { size: 100 } }]);
});

test("topology shows live node roles, zones, and maintenance facts", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const outcome = await taurusdbManagement.execute(session, "topology", {}, resource);
  assert.equal(outcome.message, "2 topology entries loaded.");
  assert.ok(outcome.facts!.some((fact) => fact.label === "node-1 · master" && fact.value.includes("az-1")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Availability zone mode" && fact.value === "single"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Maintenance window" && fact.value === "22:00-02:00"));
});

test("backup listing filters foreign backups and creation targets the documented endpoint", async (t) => {
  const writes = mockCloud(t);
  const list = await taurusdbManagement.execute(session, "backups", {}, resource);
  assert.equal(list.message, "3 backups loaded.");
  assert.ok(!JSON.stringify(list.facts).includes("Foreign"));
  assert.ok(list.facts!.some((fact) => fact.label.startsWith("Manual Backup · manual · COMPLETED")));
  const created = await taurusdbManagement.execute(session, "create-backup", { name: "Nightly", description: "Before upgrade" }, resource);
  assert.equal(created.jobId, "cloud-job");
  assert.equal(created.asynchronous, true);
  await assert.rejects(taurusdbManagement.execute(session, "create-backup", { name: "Nightly", description: "Before > upgrade" }, resource), /description cannot contain/);
  assert.deepEqual(writes, [{ path: "/v3/project-1/backups/create", method: "POST", body: { instance_id: "taurus-1", name: "Nightly", description: "Before upgrade" } }]);
});

test("backup deletion revalidates child ownership, type, and completion", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(taurusdbManagement.execute(session, "delete-backup", { backup: "backup-foreign" }, resource), /Select a manual backup/);
  await assert.rejects(taurusdbManagement.execute(session, "delete-backup", { backup: "backup-auto" }, resource), /Only manual backups/);
  await assert.rejects(taurusdbManagement.execute(session, "delete-backup", { backup: "backup-building" }, resource), /Only completed backups/);
  assert.equal(writes.length, 0);
  const outcome = await taurusdbManagement.execute(session, "delete-backup", { backup: "backup-manual" }, resource);
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v3/project-1/backups/backup-manual", method: "DELETE", body: undefined }]);
  const choices = await taurusdbManagement.options!(session, "delete-backup", resource);
  assert.deepEqual(choices.backups.map((choice) => choice.value), ["backup-manual"]);
});

test("backup policy inspection and retention use the documented policy contract", async (t) => {
  const writes = mockCloud(t);
  const policy = await taurusdbManagement.execute(session, "backup-policy", {}, resource);
  assert.ok(policy.facts!.some((fact) => fact.label === "Retention" && fact.value === "7 days"));
  assert.ok(policy.facts!.some((fact) => fact.label === "Backup weekdays" && fact.value.includes("Monday")));
  await assert.rejects(taurusdbManagement.execute(session, "retention", { keepDays: 800, backupWindow: "08:00-09:00", weekdays: ["1", "2"] }, resource), /1 to 732 days/);
  await assert.rejects(taurusdbManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: [] }, resource), /at least one backup weekday/);
  assert.equal(writes.length, 0);
  const outcome = await taurusdbManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: ["3", "1", "2", "4", "5"] }, resource);
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/taurus-1/backups/policy/update", method: "PUT", body: { backup_policy: { keep_days: 30, start_time: "08:00-09:00", period: "1,2,3,4,5" } } }]);
  const choices = await taurusdbManagement.options!(session, "retention", resource);
  assert.equal(choices.backupWindows.length, 23);
  assert.deepEqual(choices.weekdays.map((choice) => choice.value), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("database lifecycle guards system databases, hyphen limits, and stale names", async (t) => {
  const writes = mockCloud(t);
  const list = await taurusdbManagement.execute(session, "databases", {}, resource);
  assert.equal(list.message, "2 databases loaded.");
  assert.deepEqual(list.facts!.map((fact) => fact.label), ["appdata", "mysql"]);
  await assert.rejects(taurusdbManagement.execute(session, "create-database", { name: "a-b-c-d-e-f-g-h-i-j-k-l", characterSet: "utf8mb4" }, resource), /at most 10 hyphens/);
  await assert.rejects(taurusdbManagement.execute(session, "create-database", { name: "appdata2", characterSet: "utf8mb4", comment: "Extra > data" }, resource), /comment cannot contain/);
  await assert.rejects(taurusdbManagement.execute(session, "delete-database", { database: "mysql" }, resource), /System databases cannot be deleted/);
  await assert.rejects(taurusdbManagement.execute(session, "delete-database", { database: "missing" }, resource), /was not found on this instance/);
  assert.equal(writes.length, 0);
  await taurusdbManagement.execute(session, "create-database", { name: "appdata2", characterSet: "utf8mb4", comment: "Extra data" }, resource);
  await taurusdbManagement.execute(session, "delete-database", { database: "appdata" }, resource);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/taurus-1/databases", method: "POST", body: { databases: [{ name: "appdata2", character_set: "utf8mb4", comment: "Extra data" }] } },
    { path: "/v3/project-1/instances/taurus-1/databases", method: "DELETE", body: { databases: ["appdata"] } },
  ]);
  const choices = await taurusdbManagement.options!(session, "delete-database", resource);
  assert.deepEqual(choices.databases.map((choice) => choice.value), ["appdata"]);
  const charsets = await taurusdbManagement.options!(session, "create-database", resource);
  assert.deepEqual(charsets.characterSets.map((choice) => choice.value), ["utf8mb4", "gbk"]);
});

test("database user lifecycle guards the administrator, hosts, duplicates, and password rules", async (t) => {
  const writes = mockCloud(t);
  const list = await taurusdbManagement.execute(session, "db-users", {}, resource);
  assert.equal(list.message, "2 database users loaded.");
  assert.ok(list.facts!.some((fact) => fact.label === "appuser @ %" && fact.value.includes("Application account")));
  await assert.rejects(taurusdbManagement.execute(session, "create-db-user", { name: "service", password: "alllowercase9" }, resource), /at least three/);
  await assert.rejects(taurusdbManagement.execute(session, "create-db-user", { name: "Service9", password: "Service9" }, resource), /cannot match the database user name/);
  await assert.rejects(taurusdbManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", hosts: ["bad-host"] }, resource), /IPv4 addresses/);
  await assert.rejects(taurusdbManagement.execute(session, "create-db-user", { name: "appuser", password: "Str0ngPass!1" }, resource), /already exists/);
  await assert.rejects(taurusdbManagement.execute(session, "delete-db-user", { user: JSON.stringify(["root", "%"]) }, resource), /administrator/);
  await assert.rejects(taurusdbManagement.execute(session, "delete-db-user", { user: JSON.stringify(["missing", "%"]) }, resource), /was not found on this instance/);
  assert.equal(writes.length, 0);
  await taurusdbManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1", hosts: ["10.0.0.%"] }, resource);
  await taurusdbManagement.execute(session, "delete-db-user", { user: JSON.stringify(["appuser", "%"]) }, resource);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/taurus-1/db-users", method: "POST", body: { users: [{ name: "service", password: "Str0ngPass!1", hosts: ["10.0.0.%"] }] } },
    { path: "/v3/project-1/instances/taurus-1/db-users", method: "DELETE", body: { users: [{ name: "appuser", host: "%" }] } },
  ]);
  const choices = await taurusdbManagement.options!(session, "delete-db-user", resource);
  assert.deepEqual(choices.dbUsers.map((choice) => choice.value), [JSON.stringify(["appuser", "%"])]);
});

test("database user and administrator password resets use their native contracts", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(taurusdbManagement.execute(session, "reset-db-password", { user: JSON.stringify(["missing", "%"]), password: "Str0ngPass!1" }, resource), /was not found on this instance/);
  await assert.rejects(taurusdbManagement.execute(session, "reset-db-password", { user: JSON.stringify(["appuser", "%"]), password: "alllowercase9" }, resource), /at least three/);
  assert.equal(writes.length, 0);
  const reset = await taurusdbManagement.execute(session, "reset-db-password", { user: JSON.stringify(["appuser", "%"]), password: "Str0ngPass!1" }, resource);
  assert.equal(reset.asynchronous, true);
  assert.equal(reset.jobId, "cloud-job");
  const admin = await taurusdbManagement.execute(session, "reset-admin-password", { password: "Str0ngPass!1" }, resource);
  assert.equal(admin.asynchronous, undefined);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/taurus-1/db-users/password", method: "PUT", body: { users: [{ name: "appuser", host: "%", password: "Str0ngPass!1" }] } },
    { path: "/v3/project-1/instances/taurus-1/password", method: "POST", body: { password: "Str0ngPass!1" } },
  ]);
});

test("security group and maintenance window updates use their native contracts", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(taurusdbManagement.execute(session, "security-group", { securityGroup: "sg-1" }, resource), /already uses/);
  await assert.rejects(taurusdbManagement.execute(session, "security-group", { securityGroup: "forged" }, resource), /no longer available/);
  await assert.rejects(taurusdbManagement.execute(session, "maintenance-window", { start: "21:00" }, resource), /whole-hour UTC start/);
  assert.equal(writes.length, 0);
  const group = await taurusdbManagement.execute(session, "security-group", { securityGroup: "sg-2" }, resource);
  assert.equal(group.asynchronous, true);
  const window = await taurusdbManagement.execute(session, "maintenance-window", { start: "10:00" }, resource);
  assert.equal(window.asynchronous, undefined);
  assert.match(window.message, /10:00-14:00 UTC/);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/taurus-1/security-group", method: "PUT", body: { security_group_id: "sg-2" } },
    { path: "/v3/project-1/instances/taurus-1/ops-window", method: "PUT", body: { start_time: "10:00", end_time: "14:00" } },
  ]);
});

test("job polling maps native job states and rejects foreign jobs", async (t) => {
  const replies = [
    { job: { id: "cloud-job", status: "Completed", instance: { id: "taurus-1" } } },
    { job: { id: "cloud-job", status: "Failed", fail_reason: "Insufficient quota" } },
    { job: { id: "cloud-job", status: "Running" } },
    { job: { id: "other-job", status: "Completed" } },
    { job: { id: "cloud-job", status: "Completed", instance: { id: "other-instance" } } },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname + new URL(input).search, "/v3/project-1/jobs?id=cloud-job"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "taurusdb", operation: "Restart instance", resourceId: "taurus-1", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job" };
  const succeeded = await taurusdbManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "taurus-1");
  const failed = await taurusdbManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /Insufficient quota/);
  const running = await taurusdbManagement.poll!(session, entry);
  assert.equal(running.state, "submitted");
  await assert.rejects(taurusdbManagement.poll!(session, entry), /different TaurusDB job/);
  await assert.rejects(taurusdbManagement.poll!(session, entry), /does not belong to the selected instance/);
});

test("outcomes and rejection errors never expose passwords", async (t) => {
  const writes = mockCloud(t);
  const weak = "alllowercase9";
  await assert.rejects(taurusdbManagement.execute(session, "create-db-user", { name: "service", password: weak }, resource), (error: Error) => !error.message.includes(weak));
  const secret = "Str0ngPass!1";
  const outcome = await taurusdbManagement.execute(session, "create-db-user", { name: "service", password: secret }, resource);
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal(writes.length, 1);
  assert.equal((writes[0].body as { users: Array<{ password: string }> }).users[0].password, secret);
});

test("every destructive operation declares confirmation and impact, and inspect operations stay read-only", () => {
  const destructive = new Set(["restart", "resize-flavor", "resize-storage", "delete-backup", "delete-database", "delete-db-user", "reset-db-password", "reset-admin-password", "security-group", "retention", "delete"]);
  const billed = new Set(["create", "create-backup"]);
  for (const operation of taurusdbManagement.operations) {
    if (destructive.has(operation.id)) {
      assert.equal(operation.confirmation, true, operation.id);
      assert.ok(operation.impact, operation.id);
    }
    if (billed.has(operation.id)) assert.ok(operation.impact, operation.id);
    if (operation.kind === "inspect") {
      assert.equal(operation.confirmation, undefined, operation.id);
      assert.equal(operation.impact, undefined, operation.id);
    }
  }
  assert.deepEqual(taurusdbManagement.invalidationKeys(resource), ["listTaurusDbInstances", "cloud-summary", "taurusdb-instance:taurus-1"]);
  assert.equal(taurusdbManagement.title, "TaurusDB");
});
