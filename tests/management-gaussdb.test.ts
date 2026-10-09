import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { gaussdbManagement } from "@/lib/huawei/management/adapters/gaussdb";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

// Fixtures mirror the cached huaweicloudsdkgaussdbforopengauss v3 models: v3 instance lists,
// v3.2 datastore/flavor/backup catalogs, and the v3 mutation routes that return job IDs.
const haInstance = { id: "og-1", name: "Central One", status: "ACTIVE", type: "Ha", instance_mode: "enterprise", region: "sa-brazil-1", datastore: { type: "GaussDB", version: "506.2.0" }, db_user_name: "root", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", flavor_ref: "gaussdb.opengauss.ee.dn.m6.2xlarge.8.in", volume: { type: "ULTRAHIGH", size: 80 }, charge_info: { charge_mode: "postPaid" }, nodes: [{ id: "node-1", name: "node-1", role: "master", status: "ACTIVE", availability_zone: "az-1" }, { id: "node-2", role: "standby", status: "ACTIVE", availability_zone: "az-1" }, { id: "node-3", role: "standby", status: "ACTIVE", availability_zone: "az-1" }] };
const prepaidInstance = { ...haInstance, id: "og-pre", name: "Prepaid One", charge_info: { charge_mode: "prePaid" } };
const distributedInstance = { ...haInstance, id: "og-dist", name: "Distributed One", type: "enterprise" };
const basicInstance = { ...haInstance, id: "og-basic", name: "Basic One", instance_mode: "basic" };
const instances = [haInstance, prepaidInstance, distributedInstance, basicInstance];
const versions = ["506.2.0", "505.3.0"];
const flavorRowsByVersion: Record<string, unknown[]> = {
  "506.2.0": [
    { vcpus: "8", ram: "32", spec_code: "gaussdb.opengauss.ee.dn.m6.2xlarge.8.in", az_status: { "az-1": "normal", "az-2": "sellout" }, group_type: "normal" },
    { vcpus: "16", ram: "64", spec_code: "gaussdb.opengauss.ee.dn.m6.4xlarge.8.in", az_status: { "az-1": "normal" }, group_type: "normal" },
  ],
  "505.3.0": [
    { vcpus: "4", ram: "16", spec_code: "gaussdb.opengauss.ee.dn.m6.xlarge.8.in", az_status: { "az-1": "normal" }, group_type: "normal" },
  ],
};
const storageRowsByVersion: Record<string, unknown[]> = {
  "506.2.0": [
    { name: "ULTRAHIGH", az_status: { "az-1": "normal", "az-2": "normal" }, support_compute_group_type: ["normal"] },
    { name: "ESSD", az_status: { "az-1": "normal" }, support_compute_group_type: ["normal2"] },
  ],
  "505.3.0": [
    { name: "ULTRAHIGH", az_status: { "az-1": "normal" }, support_compute_group_type: ["normal"] },
  ],
};
const backups = [
  { id: "backup-manual", instance_id: "og-1", name: "Manual Backup", type: "manual", status: "COMPLETED", begin_time: "2026-01-02T00:00:21Z", size: 1024.5 },
  { id: "backup-auto", instance_id: "og-1", name: "Auto Backup", type: "auto", status: "COMPLETED", begin_time: "2026-01-01T00:00:21Z", size: 2048 },
  { id: "backup-building", instance_id: "og-1", name: "Building Backup", type: "manual", status: "BUILDING", begin_time: "2026-01-03T00:00:21Z", size: 0 },
  { id: "backup-other", instance_id: "another-instance", name: "Foreign Backup", type: "manual", status: "COMPLETED", begin_time: "2026-01-04T00:00:21Z", size: 10 },
];
const backupPolicy = { keep_days: 7, start_time: "08:00-09:00", period: "1,2,3,4,5", differential_period: 30, rate_limit: 75, prefetch_block: 8, file_split_size: 4, enable_standby_backup: false };
const topologyNodes = [
  { id: "node-1", name: "central_node1", availability_zone_id: "az-1", status: "ACTIVE", components: [{ id: "comp-1", role: "master", status: "ACTIVE", type: "datanode" }] },
  { id: "node-2", name: "central_node2", availability_zone_id: "az-1", status: "ACTIVE", components: [{ id: "comp-2", role: "standby", status: "ACTIVE", type: "datanode" }] },
];
const dbUsers = [
  { name: "root", attribute: { rolsuper: true, rolcreatedb: true, rolcanlogin: true }, memberof: "", lock_status: false },
  { name: "appuser", attribute: { rolcanlogin: true }, memberof: "group_a", lock_status: true },
];
const writeResponse = { instance: { id: "og-new", name: "Example" }, job_id: "cloud-job", order_id: "", backup: { id: "backup-new" }, backup_id: "backup-manual", backup_name: "Manual Backup" };

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v3/project-1/instances") {
    if (url.searchParams.has("id")) {
      const match = instances.find((instance) => instance.id === url.searchParams.get("id"));
      return { instances: match ? [match] : [], total_count: match ? 1 : 0 };
    }
    return { instances, total_count: instances.length };
  }
  if (path === "/v3.2/project-1/datastore/versions") return { database_versions: versions.map((software_version) => ({ software_version })), total: versions.length };
  if (path === "/v3.2/project-1/flavors") {
    const rows = flavorRowsByVersion[url.searchParams.get("version") ?? ""] ?? [];
    return { flavors: rows, total: rows.length };
  }
  if (path === "/v3/project-1/storage-type") return { storage_type: storageRowsByVersion[url.searchParams.get("version") ?? ""] ?? [] };
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet", cidr: "192.168.0.0/24" },
    { id: "subnet-2", vpc_id: "vpc-1", name: "Legacy", cidr: "10.0.0.0/24" },
  ] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Security" }, { id: "sg-2", name: "Database" }] };
  if (path === "/v3.2/project-1/backups") return { backups, total_count: backups.length };
  if (path === "/v3/project-1/instances/og-1/backups/policy") return { backup_policy: backupPolicy };
  if (path === "/v3/project-1/instances/og-1/components") return { nodes: topologyNodes, total_count: topologyNodes.length };
  if (path.endsWith("/db-users")) return { users: dbUsers, total_count: dbUsers.length };
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

const haResource: ManagementResource = { id: "og-1", name: "Central One", status: "ACTIVE", values: { type: "Ha", mode: "enterprise", size: 80, chargeMode: "postPaid" } };
const prepaidResource: ManagementResource = { id: "og-pre", name: "Prepaid One", status: "ACTIVE", values: { chargeMode: "prePaid" } };
const distributedResource: ManagementResource = { id: "og-dist", name: "Distributed One", status: "ACTIVE", values: { type: "enterprise" } };
const basicResource: ManagementResource = { id: "og-basic", name: "Basic One", status: "ACTIVE", values: { mode: "basic" } };
const offering = JSON.stringify(["506.2.0", "gaussdb.opengauss.ee.dn.m6.2xlarge.8.in"]);
const createValues: ManagementValues = { name: "Example", offering, storageType: "ULTRAHIGH", zone: "az-1", subnet: "subnet-1", securityGroup: "sg-1", diskSize: 80, password: "Str0ngPass!1", enterpriseProjectId: "0" };

test("GaussDB native jobs require the stored ID and verify the parent instance", async t => {
  let missingId = true;
  t.mock.method(globalThis, "fetch", async () => Response.json({ job: { id: missingId ? undefined : "cloud-job", status: "Completed", instance: { id: "other-instance" } } }));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "gaussdb", operation: "Restart instance", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job", resourceId: haResource.id };
  await assert.rejects(gaussdbManagement.poll!(session, entry), /different GaussDB job/);
  missingId = false;
  await assert.rejects(gaussdbManagement.poll!(session, entry), /does not belong/);
});

test("GaussDB resize refuses incomplete node zones after loading a previously selected flavor", async t => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) { writes++; return Response.json(writeResponse); }
    const body = read(url);
    return Response.json(url.pathname === "/v3/project-1/instances" ? { ...body, instances: [{ ...instances[0], nodes: [] }] } : body);
  });
  await assert.rejects(gaussdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.opengauss.ee.dn.m6.4xlarge.8.in" }, haResource), /node availability zones could not be verified/);
  assert.equal(writes, 0);
});

test("inventory maps the canonical instance list with version, storage, billing, and topology facts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname + new URL(input).search); return Response.json(read(new URL(input))); });
  const resources = await gaussdbManagement.inventory(session);
  assert.ok(reads.some((path) => path.startsWith("/v3/project-1/instances?limit=100")));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status, item.values?.version, item.values?.size, item.values?.chargeMode, item.values?.type, item.values?.mode]), [
    ["og-1", "Central One", "ACTIVE", "506.2.0", 80, "postPaid", "Ha", "enterprise"],
    ["og-pre", "Prepaid One", "ACTIVE", "506.2.0", 80, "prePaid", "Ha", "enterprise"],
    ["og-dist", "Distributed One", "ACTIVE", "506.2.0", 80, "postPaid", "enterprise", "enterprise"],
    ["og-basic", "Basic One", "ACTIVE", "506.2.0", 80, "postPaid", "Ha", "basic"],
  ]);
});

test("create options whitelist live version/spec pairs, on-sale zones, storage, and project networks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await gaussdbManagement.options!(session, "create");
  assert.deepEqual(choices.offerings.map((choice) => choice.value), [
    offering,
    JSON.stringify(["506.2.0", "gaussdb.opengauss.ee.dn.m6.4xlarge.8.in"]),
    JSON.stringify(["505.3.0", "gaussdb.opengauss.ee.dn.m6.xlarge.8.in"]),
  ]);
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1"]);
  assert.deepEqual(choices.storageTypes.map((choice) => choice.value), ["ULTRAHIGH", "ESSD"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1", "sg-2"]);
});

test("a failed flavor query remains visible instead of silently omitting that version", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/v3.2/project-1/flavors" && url.searchParams.get("version") === "505.3.0") return Response.json({ error: { message: "unsupported version" } }, { status: 400 });
    if (!init.method) return Response.json(read(url));
    throw new Error("Unexpected write");
  });
  await assert.rejects(gaussdbManagement.options!(session, "create"), /unsupported version/);
});

test("create sends the documented v3.2 pay-per-use payload with the subnet network ID and a triple availability zone", async (t) => {
  const writes = mockCloud(t);
  const outcome = await gaussdbManagement.execute(session, "create", createValues);
  assert.equal(outcome.resourceId, "og-new");
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  await gaussdbManagement.execute(session, "create", { ...createValues, offering: JSON.stringify(["505.3.0", "gaussdb.opengauss.ee.dn.m6.xlarge.8.in"]), diskSize: 120 });
  assert.deepEqual(writes, [
    { path: "/v3.2/project-1/instances", method: "POST", body: { name: "Example", datastore: { type: "GaussDB", version: "506.2.0" }, ha: { mode: "centralization_standard", replication_mode: "sync", instance_mode: "enterprise" }, flavor_ref: "gaussdb.opengauss.ee.dn.m6.2xlarge.8.in", volume: { type: "ULTRAHIGH", size: 80 }, region: "sa-brazil-1", availability_zone: "az-1,az-1,az-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" } },
    { path: "/v3.2/project-1/instances", method: "POST", body: { name: "Example", datastore: { type: "GaussDB", version: "505.3.0" }, ha: { mode: "centralization_standard", replication_mode: "sync", instance_mode: "enterprise" }, flavor_ref: "gaussdb.opengauss.ee.dn.m6.xlarge.8.in", volume: { type: "ULTRAHIGH", size: 120 }, region: "sa-brazil-1", availability_zone: "az-1,az-1,az-1", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", password: "Str0ngPass!1", charge_info: { charge_mode: "postPaid" }, enterprise_project_id: "0" } },
  ]);
});

test("create rejects forged or unavailable selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, offering: "not-json" }, /Select an available version and specification/],
    [{ ...createValues, offering: JSON.stringify(["506.2.0", "forged-spec"]) }, /no longer available/],
    [{ ...createValues, offering: JSON.stringify(["999.9.9", "gaussdb.opengauss.ee.dn.m6.2xlarge.8.in"]) }, /version is no longer available/],
    [{ ...createValues, zone: "az-2" }, /not on sale in the availability zone/],
    [{ ...createValues, storageType: "FORGED" }, /storage type is unavailable/],
    [{ ...createValues, storageType: "ESSD" }, /does not support this specification/],
    [{ ...createValues, diskSize: 20 }, /between 40 and 16384/],
    [{ ...createValues, diskSize: 45 }, /multiples of 40/],
    [{ ...createValues, diskSize: 16400 }, /between 40 and 16384/],
    [{ ...createValues, password: "alllowercase9" }, /at least three/],
    [{ ...createValues, password: "Str0ngPass(1)" }, /outside the supported GaussDB set/],
    [{ ...createValues, subnet: "forged-subnet" }, /subnet is no longer available/],
    [{ ...createValues, subnet: "subnet-2" }, /network ID/],
    [{ ...createValues, securityGroup: "forged-group" }, /security group is no longer available/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(gaussdbManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live choices and enforces documented disk bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = gaussdbManagement.operations.find((item) => item.id === "create")!;
  const choices = await gaussdbManagement.options!(session, "create");
  const values = validateManagementValues(operation, { ...createValues, offering: choices.offerings[0].value }, choices);
  assert.equal(values.name, "Example");
  assert.throws(() => validateManagementValues(operation, { ...values, offering: JSON.stringify(["506.2.0", "forged-spec"]) }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...values, zone: "az-2" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...values, diskSize: 39 }, choices), /at least 40/);
  assert.throws(() => validateManagementValues(operation, { ...values, diskSize: 16385 }, choices), /no more than 16384/);
});

test("rename, restart, and delete use their native instance contracts and delete refuses prepaid instances", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(gaussdbManagement.execute(session, "delete", {}, prepaidResource), /pay-per-use instances only/);
  assert.equal(writes.length, 0);
  const rename = await gaussdbManagement.execute(session, "rename", { name: "Renamed" }, haResource);
  assert.equal(rename.asynchronous, true);
  assert.equal(rename.jobId, "cloud-job");
  const restart = await gaussdbManagement.execute(session, "restart", {}, haResource);
  assert.equal(restart.asynchronous, true);
  const deletion = await gaussdbManagement.execute(session, "delete", {}, haResource);
  assert.equal(deletion.asynchronous, true);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/instances/og-1/name", method: "PUT", body: { name: "Renamed" } },
    { path: "/v3/project-1/instances/og-1/restart", method: "POST", body: undefined },
    { path: "/v3/project-1/instances/og-1", method: "DELETE", body: undefined },
  ]);
  const deleteOperation = gaussdbManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(deleteOperation.confirmation, true);
  assert.ok(deleteOperation.impact);
});

test("specification changes revalidate the live catalog and refuse prepaid, distributed, or basic edition instances", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(gaussdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.opengauss.ee.dn.m6.2xlarge.8.in" }, haResource), /must differ/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-flavor", { offering: "forged-spec" }, haResource), /no longer available/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.opengauss.ee.dn.m6.4xlarge.8.in" }, prepaidResource), /pay-per-use instances only/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.opengauss.ee.dn.m6.4xlarge.8.in" }, distributedResource), /centralized instances only/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.opengauss.ee.dn.m6.4xlarge.8.in" }, basicResource), /enterprise edition instances only/);
  assert.equal(writes.length, 0);
  const outcome = await gaussdbManagement.execute(session, "resize-flavor", { offering: "gaussdb.opengauss.ee.dn.m6.4xlarge.8.in" }, haResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/og-1/flavor", method: "PUT", body: { flavor_ref: "gaussdb.opengauss.ee.dn.m6.4xlarge.8.in" } }]);
  const choices = await gaussdbManagement.options!(session, "resize-flavor", haResource);
  assert.deepEqual(choices.resizeOfferings.map((choice) => choice.value), ["gaussdb.opengauss.ee.dn.m6.4xlarge.8.in"]);
  await assert.rejects(gaussdbManagement.options!(session, "resize-flavor", distributedResource), /centralized instances only/);
});

test("storage expansion never shrinks and sends the documented enlarge-volume action body", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(gaussdbManagement.execute(session, "resize-storage", { size: 80 }, haResource), /exceed the current 80 GB/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-storage", { size: 90 }, haResource), /multiples of 40/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-storage", { size: 16400 }, haResource), /between 40 and 16384/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-storage", { size: 120 }, prepaidResource), /pay-per-use instances only/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-storage", { size: 120 }, distributedResource), /centralized instances only/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-storage", { size: 120 }, basicResource), /enterprise edition instances only/);
  assert.equal(writes.length, 0);
  const outcome = await gaussdbManagement.execute(session, "resize-storage", { size: 120 }, haResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/og-1/action", method: "POST", body: { enlarge_volume: { size: 120 } } }]);
});

test("backup listing filters foreign children and creation targets the documented backup body", async (t) => {
  const writes = mockCloud(t);
  const list = await gaussdbManagement.execute(session, "backups", {}, haResource);
  assert.equal(list.message, "3 backups loaded.");
  assert.ok(list.facts!.some((fact) => fact.label.startsWith("Manual Backup · manual · COMPLETED")));
  assert.ok(!list.facts!.some((fact) => fact.label.startsWith("Foreign Backup")));
  await assert.rejects(gaussdbManagement.execute(session, "create-backup", { name: "Nightly", description: "bad < chars" }, haResource), /cannot contain the characters/);
  assert.equal(writes.length, 0);
  const created = await gaussdbManagement.execute(session, "create-backup", { name: "Nightly", description: "Before upgrade" }, haResource);
  assert.equal(created.resourceId, haResource.id);
  assert.equal(created.jobId, "cloud-job");
  assert.equal(created.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/backups", method: "POST", body: { instance_id: "og-1", name: "Nightly", description: "Before upgrade" } }]);
});

test("backup deletion revalidates the child ID and only removes completed manual backups", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(gaussdbManagement.execute(session, "delete-backup", { backup: "backup-other" }, haResource), /Select a manual backup/);
  await assert.rejects(gaussdbManagement.execute(session, "delete-backup", { backup: "backup-auto" }, haResource), /Only manual backups/);
  await assert.rejects(gaussdbManagement.execute(session, "delete-backup", { backup: "backup-building" }, haResource), /Only completed backups/);
  assert.equal(writes.length, 0);
  await gaussdbManagement.execute(session, "delete-backup", { backup: "backup-manual" }, haResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/backups/backup-manual", method: "DELETE", body: undefined }]);
  const choices = await gaussdbManagement.options!(session, "delete-backup", haResource);
  assert.deepEqual(choices.backups.map((choice) => choice.value), ["backup-manual"]);
  assert.deepEqual(await gaussdbManagement.options!(session, "delete-backup"), {});
});

test("GaussDB never deletes a backup belonging to another instance even if the provider ignores its filter", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => {
    assert.ok(!init.method);
    return Response.json({ backups: [{ id: "foreign", instance_id: "other", type: "manual", status: "COMPLETED" }], total_count: 1 });
  });
  assert.deepEqual((await gaussdbManagement.options!(session, "delete-backup", haResource)).backups, []);
  await assert.rejects(gaussdbManagement.execute(session, "delete-backup", { backup: "foreign" }, haResource), /Select a manual backup/);
});

test("backup policy inspection reports retention, window, and weekdays", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const policy = await gaussdbManagement.execute(session, "backup-policy", {}, haResource);
  assert.equal(policy.message, "Backup policy loaded.");
  assert.deepEqual(policy.facts, [
    { label: "Retention", value: "7 days" },
    { label: "Backup window (UTC)", value: "08:00-09:00" },
    { label: "Backup weekdays", value: "Monday, Tuesday, Wednesday, Thursday, Friday" },
  ]);
});

test("retention uses the v3.1 policy route and preserves differential backup settings", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(gaussdbManagement.execute(session, "retention", { keepDays: 800, backupWindow: "08:00-09:00", weekdays: ["1", "2"] }, haResource), /1 to 732 days/);
  await assert.rejects(gaussdbManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: [] }, haResource), /at least one backup weekday/);
  await assert.rejects(gaussdbManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: ["1", "8"] }, haResource), /at least one backup weekday/);
  assert.equal(writes.length, 0);
  await gaussdbManagement.execute(session, "retention", { keepDays: 30, backupWindow: "08:00-09:00", weekdays: ["5", "1"] }, haResource);
  assert.deepEqual(writes, [{ path: "/v3.1/project-1/instances/og-1/backups/policy", method: "PUT", body: { backup_policy: { keep_days: 30, start_time: "08:00-09:00", period: "1,5", differential_period: "30", rate_limit: 75, prefetch_block: 8, file_split_size: 4, enable_standby_backup: false } } }]);
  const choices = await gaussdbManagement.options!(session, "retention", haResource);
  assert.equal(choices.backupWindows.length, 23);
  assert.equal(choices.backupWindows[0].value, "00:00-01:00");
  assert.equal(choices.backupWindows.at(-1)!.value, "22:00-23:00");
  assert.deepEqual(choices.weekdays.map((choice) => choice.value), ["1", "2", "3", "4", "5", "6", "7"]);
});

test("topology lists node and component roles from the live components endpoint", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname); return Response.json(read(new URL(input))); });
  const topology = await gaussdbManagement.execute(session, "topology", {}, haResource);
  assert.equal(topology.message, "2 nodes loaded.");
  assert.ok(topology.facts!.some((fact) => fact.label === "central_node1 · ACTIVE" && fact.value.includes("az-1")));
  assert.ok(topology.facts!.some((fact) => fact.label === "  datanode · master · ACTIVE" && fact.value === "comp-1"));
  assert.ok(reads.some((path) => path === "/v3/project-1/instances/og-1/components"));
});

test("database user listing reports attributes and lock status without passwords", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const list = await gaussdbManagement.execute(session, "db-users", {}, haResource);
  assert.equal(list.message, "2 database users loaded.");
  assert.deepEqual(list.facts!.map((fact) => fact.label), ["root", "appuser"]);
  assert.ok(list.facts!.some((fact) => fact.label === "root" && fact.value === "unlocked · superuser, create database"));
  assert.ok(list.facts!.some((fact) => fact.label === "appuser" && fact.value === "locked · group_a"));
  assert.ok(!JSON.stringify(list).includes("password"));
});

test("database user creation guards system names, duplicates, and password rules", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(gaussdbManagement.execute(session, "create-db-user", { name: "pguser", password: "Str0ngPass!1" }, haResource), /cannot start with pg/);
  await assert.rejects(gaussdbManagement.execute(session, "create-db-user", { name: "rdsadmin", password: "Str0ngPass!1" }, haResource), /system users/);
  await assert.rejects(gaussdbManagement.execute(session, "create-db-user", { name: "appuser", password: "Str0ngPass!1" }, haResource), /already exists/);
  await assert.rejects(gaussdbManagement.execute(session, "create-db-user", { name: "service", password: "alllowercase9" }, haResource), /at least three/);
  await assert.rejects(gaussdbManagement.execute(session, "create-db-user", { name: "Service1", password: "1ecivreS" }, haResource), /cannot match the account name/);
  assert.equal(writes.length, 0);
  await gaussdbManagement.execute(session, "create-db-user", { name: "service", password: "Str0ngPass!1" }, haResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/og-1/db-user", method: "POST", body: { name: "service", password: "Str0ngPass!1" } }]);
});

test("database user password resets revalidate fresh child identities", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(gaussdbManagement.execute(session, "reset-db-user-password", { user: "appuser", password: "weak" }, haResource), /8 to 32 characters/);
  await assert.rejects(gaussdbManagement.execute(session, "reset-db-user-password", { user: "ghost", password: "Str0ngPass!1" }, haResource), /was not found on this instance/);
  assert.equal(writes.length, 0);
  await gaussdbManagement.execute(session, "reset-db-user-password", { user: "appuser", password: "Str0ngPass!1" }, haResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/og-1/db-user/password", method: "PUT", body: { name: "appuser", password: "Str0ngPass!1" } }]);
  const choices = await gaussdbManagement.options!(session, "reset-db-user-password", haResource);
  assert.deepEqual(choices.dbUsers.map((choice) => choice.value), ["root", "appuser"]);
});

test("administrator password reset uses the native instance password route", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(gaussdbManagement.execute(session, "reset-password", { password: "weak" }, haResource), /8 to 32 characters/);
  assert.equal(writes.length, 0);
  const outcome = await gaussdbManagement.execute(session, "reset-password", { password: "Str0ngPass!1" }, haResource);
  assert.equal(outcome.message, "Administrator password reset accepted.");
  assert.deepEqual(writes, [{ path: "/v3/project-1/instances/og-1/password", method: "POST", body: { password: "Str0ngPass!1" } }]);
});

test("job polling maps native job states, keeps stored resource IDs, and refuses foreign jobs", async (t) => {
  const replies = [
    { job: { id: "cloud-job", status: "Completed", instance: { id: "og-new", name: "Example" } } },
    { job: { id: "cloud-job", status: "Failed", instance: { id: "og-1" }, fail_reason: "Insufficient quota" } },
    { job: { id: "cloud-job", status: "Running", instance: { id: "og-1" } } },
    { job: { id: "cloud-job", status: "Completed", instance: { id: "og-1" } } },
    { job: { id: "other-job", status: "Completed", instance: { id: "og-1" } } },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname + new URL(input).search, "/v3/project-1/jobs?id=cloud-job"); return Response.json(replies[index++]); });
  const createEntry: ManagementHistoryEntry = { id: randomUUID(), service: "gaussdb", operation: "Create instance", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job" };
  const succeeded = await gaussdbManagement.poll!(session, createEntry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "og-new");
  const failed = await gaussdbManagement.poll!(session, createEntry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /Insufficient quota/);
  const running = await gaussdbManagement.poll!(session, createEntry);
  assert.equal(running.state, "submitted");
  const restartEntry: ManagementHistoryEntry = { id: randomUUID(), service: "gaussdb", operation: "Restart instance", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job", resourceId: "og-1" };
  const kept = await gaussdbManagement.poll!(session, restartEntry);
  assert.equal(kept.state, "succeeded");
  assert.equal(kept.resourceId, "og-1");
  await assert.rejects(gaussdbManagement.poll!(session, restartEntry), /different GaussDB job/);
});

test("outcomes and rejection errors never expose passwords", async (t) => {
  const writes = mockCloud(t);
  const weak = "alllowercase9";
  await assert.rejects(gaussdbManagement.execute(session, "create-db-user", { name: "service", password: weak }, haResource), (error: Error) => !error.message.includes(weak));
  const secret = "Str0ngPass!1";
  const outcome = await gaussdbManagement.execute(session, "create-db-user", { name: "service", password: secret }, haResource);
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal(writes.length, 1);
  assert.equal((writes[0].body as { password: string }).password, secret);
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(gaussdbManagement.execute(session, "attach-eip", {}, haResource), /Unsupported GaussDB operation/);
  assert.equal(writes.length, 0);
});

test("stale instance IDs fail closed before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const ghost: ManagementResource = { id: "og-ghost", name: "Ghost", status: "ACTIVE" };
  await assert.rejects(gaussdbManagement.execute(session, "delete", {}, ghost), /was not found in this project/);
  await assert.rejects(gaussdbManagement.execute(session, "resize-storage", { size: 120 }, ghost), /was not found in this project/);
  assert.equal(writes.length, 0);
});

test("database user pagination walks native offset pages and refuses malformed lists", async (t) => {
  const offsets: string[] = [];
  let malformed = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input); const offset = url.searchParams.get("offset") ?? "0";
    offsets.push(offset);
    if (malformed) return Response.json({ total_count: 1 });
    return Response.json({ users: Array.from({ length: offset === "0" ? 100 : 1 }, (_, index) => ({ name: `user${Number(offset) + index}`, attribute: {}, lock_status: false })), total_count: 101 });
  });
  const result = await gaussdbManagement.execute(session, "db-users", {}, haResource);
  assert.equal(result.facts?.length, 101);
  assert.deepEqual(offsets, ["0", "100"]);
  malformed = true;
  offsets.length = 0;
  await assert.rejects(gaussdbManagement.execute(session, "db-users", {}, haResource));
});
