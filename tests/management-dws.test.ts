import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { dwsManagement } from "@/lib/huawei/management/adapters/dws";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const baseDetail = { id: "cluster-1", name: "Warehouse One", status: "AVAILABLE", version: "8.2.1.100", created: "2026-01-01T00:00:00Z", port: 8000, endpoints: [{ connect_info: "192.168.0.10:8000", jdbc_url: "jdbc:postgresql://192.168.0.10:8000/gaussdb" }], nodes: [{ id: "node-1", status: "200", name: "dws-node-1" }], user_name: "dbadmin", number_of_node: 3, availability_zone: "az-1", enterprise_project_id: "0", vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", public_ip: { public_bind_type: "not_bind" }, action_progress: {}, sub_status: "NORMAL", task_status: "", node_type: "dws.m3.xlarge.8", node_type_id: "flavor-id-1", private_ip: ["192.168.0.10"], maintain_window: { day: "Mon", start_time: "22:00", end_time: "02:00" }, parameter_group: { id: "pg-1", name: "default-dws", status: "In-Sync" }, tags: [{ key: "team", value: "analytics" }], order_id: "" };
const details: Record<string, Record<string, unknown>> = {
  "cluster-1": baseDetail,
  "cluster-pre": { ...baseDetail, id: "cluster-pre", name: "Prepaid One", order_id: "order-1" },
  "cluster-busy": { ...baseDetail, id: "cluster-busy", name: "Busy One", task_status: "SNAPSHOTTING", action_progress: { SNAPSHOTTING: "42%" } },
  "cluster-creating": { ...baseDetail, id: "cluster-creating", name: "Creating One", status: "CREATING", task_status: "CREATING" },
};
const clusters = [
  { id: "cluster-1", name: "Warehouse One", status: "AVAILABLE", version: "8.2.1.100", node_type: "dws.m3.xlarge.8", number_of_node: 3, availability_zone: "az-1", port: 8000 },
  { id: "cluster-pre", name: "Prepaid One", status: "AVAILABLE", version: "8.2.1.100", node_type: "dws.m3.xlarge.8", number_of_node: 3, availability_zone: "az-1", port: 8000 },
  { id: "cluster-busy", name: "Busy One", status: "AVAILABLE", version: "8.2.1.100", node_type: "dws.m3.xlarge.8", number_of_node: 3, availability_zone: "az-1", port: 8000 },
  { id: "cluster-creating", name: "Creating One", status: "CREATING", version: "8.2.1.100", node_type: "dws.m3.xlarge.8", number_of_node: 3, availability_zone: "az-1", port: 8000 },
];
const nodeTypes = [
  { spec_name: "dws.m3.xlarge.8", id: "flavor-id-1", datastore_type: "dws", architecture: "standard", ram: 32, vcpus: 4, volume: { type: "SSD", size: 1024 }, available_zones: [{ code: "az-1", status: "normal" }, { code: "az-2", status: "sellout" }], datastores: [{ version: "8.2.1.100", role: "STABLE" }, { version: "8.3.0.100", role: "PREVIEW" }] },
  { spec_name: "dws3.xlarge.8", id: "flavor-id-2", ram: 32, vcpus: 4, elastic_volume_specs: [{ type: "SSD", step: 100, min_size: 100, max_size: 1000 }], available_zones: [{ code: "az-1", status: "normal" }], datastores: [{ version: "8.2.1.100", role: "STABLE" }] },
  { spec_name: "dws.old.2xlarge", id: "flavor-id-3", ram: 16, vcpus: 8, volume: { type: "SAS", size: 512 }, available_zones: [{ code: "az-1", status: "abandon" }], datastores: [{ version: "8.2.1.100", role: "STABLE" }] },
];
const snapshots = [
  { id: "snap-manual", cluster_id: "cluster-1", name: "Manual Snapshot", type: "MANUAL", status: "AVAILABLE", started: "2026-01-02T00:00:21Z", size: 100 },
  { id: "snap-auto", cluster_id: "cluster-1", name: "Auto Snapshot", type: "AUTO", status: "AVAILABLE", started: "2026-01-01T00:00:21Z", size: 200 },
  { id: "snap-creating", cluster_id: "cluster-1", name: "Creating Snapshot", type: "MANUAL", status: "CREATING", started: "2026-01-03T00:00:21Z", size: 0 },
];
const targetFlavors = [
  { id: "flavor-target-1", name: "dws.m3.2xlarge.8", vcpus: 8, ram: 64, is_current_flavor: false },
  { id: "flavor-id-1", name: "dws.m3.xlarge.8", vcpus: 4, ram: 32, is_current_flavor: true },
];
const writeResponse = { cluster: { id: "cluster-new" }, job_id: "cloud-job", snapshot: { name: "Nightly", cluster_id: "cluster-1" } };
let longAdminUser = false;

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v1.0/project-1/clusters") return { clusters, count: clusters.length };
  if (path === "/v2/project-1/node-types") return { node_types: nodeTypes, count: nodeTypes.length };
  if (path === "/v1.0/project-1/availability-zones") return { availability_zones: [{ code: "az-1", name: "AZ One", status: "available" }, { code: "az-2", name: "AZ Two", status: "unavailable" }], count: 2 };
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet", cidr: "192.168.0.0/24" },
    { id: "subnet-2", vpc_id: "vpc-1", name: "Legacy", cidr: "10.0.0.0/24" },
  ] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Security" }, { id: "sg-2", name: "Database" }] };
  if (path === "/v1.0/project-1/clusters/cluster-1/snapshots") return { snapshots, count: snapshots.length };
  if (path === "/v1/project-1/flavors/flavor-id-1/target-flavors") return { count: targetFlavors.length, flavors: targetFlavors, change_mode: "offline" };
  if (path === "/v1.0/project-1/clusters/cluster-1/storage-expand-range") return { min_size: 100, max_size: 1000, current_size: 200, step: 100 };
  if (path === "/v1.0/project-1/quotas") return { quotas: { resources: [{ type: "instances", used: 2, quota: 15, unit: "count" }] } };
  if (path === "/v2/project-1/clusters/cluster-1/nodes") return { node_list: [{ id: "node-1", name: "dws-node-1", status: "200", spec: "dws.m3.xlarge.8", az_code: "az-1", inst_create_type: "BMS" }], count: 1, failed_count: 0 };
  if (path === "/v1.0/project-1/clusters/cluster-1/configurations") return { configurations: [{ id: "pg-1", name: "default-dws", type: "default", status: "In-Sync" }] };
  if (path === "/v1/project-1/clusters/cluster-1/dms/metrics") return { code: 0, msg: "", data: [{ scope: "cluster", metric_name: "cpu_usage", collect_rate: "1 minute", collect_range: "15 minutes", create_time: "1700000000000" }], count: 1 };
  const detail = path.match(/^\/v1\.0\/project-1\/clusters\/([^/]+)$/);
  if (detail) {
    const record = details[decodeURIComponent(detail[1])];
    if (!record) throw new Error(`Unexpected detail ${path}`);
    return { cluster: longAdminUser && record.id === "cluster-1" ? { ...record, user_name: "warehouse_admin2" } : record };
  }
  if (path === "/v1.0/project-1/job/cloud-job") return { job_id: "cloud-job", job_name: "RestoreCluster", begin_time: "2026-01-04T00:00:00Z", status: "RUNNING", progress: "42%" };
  throw new Error(`Unexpected GET ${path}`);
}

function mockCloud(t: TestContext) {
  const writes: { path: string; search: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    writes.push({ path: url.pathname, search: url.search, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(writeResponse);
  });
  return writes;
}

const clusterResource: ManagementResource = { id: "cluster-1", name: "Warehouse One", status: "AVAILABLE", values: { nodeType: "dws.m3.xlarge.8", nodes: 3 } };
const prepaidResource: ManagementResource = { id: "cluster-pre", name: "Prepaid One", status: "AVAILABLE" };
const busyResource: ManagementResource = { id: "cluster-busy", name: "Busy One", status: "AVAILABLE" };
const offering = JSON.stringify(["dws.m3.xlarge.8", "8.2.1.100"]);
const createValues: ManagementValues = { name: "Example", offering, zone: "az-1", numNode: 3, subnet: "subnet-1", securityGroup: "sg-1", adminUser: "dbadmin", dbPort: 8000, password: "Str0ngPass!1", enterpriseProjectId: "0" };

test("inventory maps the canonical cluster list with status, version, and node facts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname); return Response.json(read(new URL(input))); });
  const resources = await dwsManagement.inventory(session);
  assert.ok(reads.some((path) => path === "/v1.0/project-1/clusters"));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status, item.values?.nodeType, item.values?.nodes]), [
    ["cluster-1", "Warehouse One", "AVAILABLE", "dws.m3.xlarge.8", 3],
    ["cluster-pre", "Prepaid One", "AVAILABLE", "dws.m3.xlarge.8", 3],
    ["cluster-busy", "Busy One", "AVAILABLE", "dws.m3.xlarge.8", 3],
    ["cluster-creating", "Creating One", "CREATING", "dws.m3.xlarge.8", 3],
  ]);
});

test("create options whitelist live stable offerings, available zones, and project networks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await dwsManagement.options!(session, "create");
  assert.deepEqual(choices.offerings.map((choice) => choice.value), [offering]);
  assert.ok(choices.offerings.every((choice) => !choice.value.includes("dws3") && !choice.value.includes("8.3.0")));
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1", "sg-2"]);
});

test("create sends the documented v2 pay-per-use payload with the subnet network ID", async (t) => {
  const writes = mockCloud(t);
  const outcome = await dwsManagement.execute(session, "create", createValues);
  assert.equal(outcome.resourceId, "cluster-new");
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, undefined);
  assert.deepEqual(writes, [
    { path: "/v2/project-1/clusters", search: "", method: "POST", body: { cluster: { name: "Example", flavor: "dws.m3.xlarge.8", num_node: 3, db_name: "dbadmin", db_password: "Str0ngPass!1", db_port: 8000, availability_zones: ["az-1"], vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", datastore_version: "8.2.1.100", public_ip: { public_bind_type: "not_use" }, enterprise_project_id: "0" } } },
  ]);
});

test("create rejects forged or stale selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, offering: JSON.stringify(["dws.forged.8", "8.2.1.100"]) }, /no longer available/],
    [{ ...createValues, offering: JSON.stringify(["dws3.xlarge.8", "8.2.1.100"]) }, /no longer available/],
    [{ ...createValues, offering: JSON.stringify(["dws.m3.xlarge.8", "8.3.0.100"]) }, /version is no longer available/],
    [{ ...createValues, zone: "az-2" }, /not on sale in this availability zone/],
    [{ ...createValues, zone: "forged-zone" }, /not on sale in this availability zone/],
    [{ ...createValues, numNode: 2 }, /between 3 and 256/],
    [{ ...createValues, numNode: 257 }, /between 3 and 256/],
    [{ ...createValues, dbPort: 7999 }, /between 8000 and 30000/],
    [{ ...createValues, password: "alllowercase9" }, /at least three/],
    [{ ...createValues, password: "Str0ngPass$1234" }, /outside the supported DWS set/],
    [{ ...createValues, adminUser: "analytics_admin2", password: "analytics_admin2" }, /cannot match the administrator username/],
    [{ ...createValues, subnet: "forged-subnet" }, /subnet is no longer available/],
    [{ ...createValues, subnet: "subnet-2" }, /network ID/],
    [{ ...createValues, securityGroup: "forged-group" }, /security group is no longer available/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(dwsManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live choices and enforces documented bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = dwsManagement.operations.find((item) => item.id === "create")!;
  const choices = await dwsManagement.options!(session, "create");
  const values = validateManagementValues(operation, { ...createValues, offering: choices.offerings[0].value }, choices);
  assert.equal(values.name, "Example");
  assert.throws(() => validateManagementValues(operation, { ...createValues, offering: JSON.stringify(["dws.forged.8", "8.2.1.100"]) }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, zone: "az-2" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, numNode: 2 }, choices), /at least 3/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, dbPort: 30001 }, choices), /no more than 30000/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, password: "short" }, choices), /invalid format/);
});

test("rename, restart, and delete use their native contracts and delete refuses unsafe clusters", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "delete", {}, prepaidResource), /pay-per-use clusters only/);
  await assert.rejects(dwsManagement.execute(session, "delete", {}, busyResource), /SNAPSHOTTING task/);
  assert.equal(writes.length, 0);
  const rename = await dwsManagement.execute(session, "rename", { name: "Renamed" }, clusterResource);
  assert.equal(rename.jobId, "cloud-job");
  assert.equal(rename.asynchronous, true);
  const restart = await dwsManagement.execute(session, "restart", {}, clusterResource);
  assert.equal(restart.asynchronous, true);
  assert.equal(restart.jobId, undefined);
  const deletion = await dwsManagement.execute(session, "delete", { keepSnapshots: 0 }, clusterResource);
  assert.equal(deletion.asynchronous, true);
  await dwsManagement.execute(session, "delete", { keepSnapshots: 2 }, clusterResource);
  assert.deepEqual(writes, [
    { path: "/v1/project-1/clusters/cluster-1/cluster-name", search: "", method: "PUT", body: { cluster_name: "Renamed" } },
    { path: "/v1.0/project-1/clusters/cluster-1/restart", search: "", method: "POST", body: { restart: {} } },
    { path: "/v2/project-1/clusters/cluster-1", search: "?keep_last_manual_backup=0", method: "DELETE", body: undefined },
    { path: "/v2/project-1/clusters/cluster-1", search: "?keep_last_manual_backup=2", method: "DELETE", body: undefined },
  ]);
  const deleteOperation = dwsManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(deleteOperation.confirmation, true);
  assert.ok(deleteOperation.impact);
  assert.deepEqual(deleteOperation.allowedStatuses, ["AVAILABLE", "FAILED", "CREATE_FAILED", "DELETE_FAILED"]);
});

test("node expansion revalidates the fresh node count and the native minimum", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "scale-out", { count: 2 }, clusterResource), /at least 3 nodes/);
  await assert.rejects(dwsManagement.execute(session, "scale-out", { count: 3 }, prepaidResource), /pay-per-use clusters only/);
  await assert.rejects(dwsManagement.execute(session, "scale-out", { count: 3 }, busyResource), /SNAPSHOTTING task/);
  assert.equal(writes.length, 0);
  const outcome = await dwsManagement.execute(session, "scale-out", { count: 3 }, clusterResource);
  assert.equal(outcome.asynchronous, true);
  assert.match(outcome.message, /from 3 to 6 nodes/);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/clusters/cluster-1/resize", search: "", method: "POST", body: { scale_out: { count: 3 } } }]);
});

test("specification changes use the native target-flavor catalog and refuse the current specification", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "change-flavor", { offering: "flavor-id-1" }, clusterResource), /must differ/);
  await assert.rejects(dwsManagement.execute(session, "change-flavor", { offering: "forged-flavor" }, clusterResource), /no longer available/);
  await assert.rejects(dwsManagement.execute(session, "change-flavor", { offering: "flavor-target-1" }, prepaidResource), /pay-per-use clusters only/);
  await assert.rejects(dwsManagement.execute(session, "change-flavor", { offering: "flavor-target-1" }, busyResource), /SNAPSHOTTING task/);
  assert.equal(writes.length, 0);
  const outcome = await dwsManagement.execute(session, "change-flavor", { offering: "flavor-target-1" }, clusterResource);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1/project-1/clusters/cluster-1/flavor", search: "", method: "POST", body: { target_flavor_id: "flavor-target-1" } }]);
  const choices = await dwsManagement.options!(session, "change-flavor", clusterResource);
  assert.deepEqual(choices.resizeOfferings.map((choice) => choice.value), ["flavor-target-1"]);
  assert.deepEqual(await dwsManagement.options!(session, "change-flavor"), {});
});

test("storage expansion follows the native expansion range and step", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "expand-storage", { newSize: 200 }, clusterResource), /exceed the current 200 GB/);
  await assert.rejects(dwsManagement.execute(session, "expand-storage", { newSize: 1100 }, clusterResource), /exceed the supported 1000 GB/);
  await assert.rejects(dwsManagement.execute(session, "expand-storage", { newSize: 250 }, clusterResource), /expansion step/);
  await assert.rejects(dwsManagement.execute(session, "expand-storage", { newSize: 300 }, prepaidResource), /pay-per-use clusters only/);
  await assert.rejects(dwsManagement.execute(session, "expand-storage", { newSize: 300 }, busyResource), /SNAPSHOTTING task/);
  assert.equal(writes.length, 0);
  const outcome = await dwsManagement.execute(session, "expand-storage", { newSize: 300 }, clusterResource);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/clusters/cluster-1/expand-instance-storage", search: "", method: "POST", body: { new_size: 300 } }]);
});

test("snapshot listing is parent-scoped and paginates the native offset protocol", async (t) => {
  const offsets: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v1.0/project-1/clusters/cluster-1/snapshots") {
      const offset = Number(url.searchParams.get("offset") ?? "0");
      offsets.push(String(offset));
      const rows = Array.from({ length: Math.min(100, 150 - offset) }, (_, index) => ({ id: `snap-${offset + index}`, cluster_id: "cluster-1", name: `Snapshot ${offset + index}`, type: "MANUAL", status: "AVAILABLE", started: "2026-01-02T00:00:21Z", size: 100 }));
      return Response.json({ snapshots: rows, count: 150 });
    }
    return Response.json(read(url));
  });
  const result = await dwsManagement.execute(session, "snapshots", {}, clusterResource);
  assert.equal(result.facts!.length, 150);
  assert.deepEqual(offsets, ["0", "100"]);
});

test("snapshot creation sends the documented nested body and guards descriptions", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "create-snapshot", { name: "Nightly", description: "bad < chars" }, clusterResource), /cannot contain the characters/);
  await assert.rejects(dwsManagement.execute(session, "create-snapshot", { name: "Nightly" }, busyResource), /SNAPSHOTTING task/);
  assert.equal(writes.length, 0);
  const outcome = await dwsManagement.execute(session, "create-snapshot", { name: "Nightly", description: "Before upgrade" }, clusterResource);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/snapshots", search: "", method: "POST", body: { snapshot: { name: "Nightly", cluster_id: "cluster-1", description: "Before upgrade" } } }]);
  const bare = await dwsManagement.execute(session, "create-snapshot", { name: "Nightly" }, clusterResource);
  assert.deepEqual(writes[1], { path: "/v1.0/project-1/snapshots", search: "", method: "POST", body: { snapshot: { name: "Nightly", cluster_id: "cluster-1" } } });
  assert.ok(!JSON.stringify(bare).includes("description"));
});

test("snapshot deletion revalidates the child identity, type, and state within the parent scope", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "delete-snapshot", { snapshot: "foreign" }, clusterResource), /Select a manual snapshot/);
  await assert.rejects(dwsManagement.execute(session, "delete-snapshot", { snapshot: "snap-auto" }, clusterResource), /Only manual snapshots/);
  await assert.rejects(dwsManagement.execute(session, "delete-snapshot", { snapshot: "snap-creating" }, clusterResource), /Only available snapshots/);
  assert.equal(writes.length, 0);
  await dwsManagement.execute(session, "delete-snapshot", { snapshot: "snap-manual" }, clusterResource);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/snapshots/snap-manual", search: "", method: "DELETE", body: undefined }]);
  const choices = await dwsManagement.options!(session, "delete-snapshot", clusterResource);
  assert.deepEqual(choices.snapshots.map((choice) => choice.value), ["snap-manual"]);
  assert.deepEqual(await dwsManagement.options!(session, "delete-snapshot"), {});
});

test("DWS never deletes or restores a snapshot belonging to another cluster even if the provider ignores its filter", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.ok(!init.method);
    if (new URL(input).pathname === "/v1.0/project-1/clusters/cluster-1") return Response.json({ cluster: baseDetail });
    return Response.json({ snapshots: [{ id: "foreign", cluster_id: "other", name: "Foreign", type: "MANUAL", status: "AVAILABLE" }], count: 1 });
  });
  assert.deepEqual((await dwsManagement.options!(session, "delete-snapshot", clusterResource)).snapshots, []);
  assert.deepEqual((await dwsManagement.options!(session, "restore-snapshot", clusterResource)).restorableSnapshots, []);
  await assert.rejects(dwsManagement.execute(session, "delete-snapshot", { snapshot: "foreign" }, clusterResource), /Select a manual snapshot/);
  await assert.rejects(dwsManagement.execute(session, "restore-snapshot", { snapshot: "foreign", name: "Restored" }, clusterResource), /Select a snapshot/);
});

test("restore targets only available snapshots and returns the native cluster and task identifiers", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "restore-snapshot", { snapshot: "snap-creating", name: "Restored" }, clusterResource), /Only available snapshots/);
  assert.equal(writes.length, 0);
  const outcome = await dwsManagement.execute(session, "restore-snapshot", { snapshot: "snap-manual", name: "Restored" }, clusterResource);
  assert.equal(outcome.resourceId, "cluster-new");
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/snapshots/snap-manual/actions", search: "", method: "POST", body: { restore: { name: "Restored", public_ip: { public_bind_type: "not_use" } } } }]);
  const choices = await dwsManagement.options!(session, "restore-snapshot", clusterResource);
  assert.deepEqual(choices.restorableSnapshots.map((choice) => choice.value), ["snap-manual", "snap-auto"]);
});

test("maintenance window updates enforce the native four-hour whole-hour window", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "maintenance-window", { day: "Monday", start: "22:00", end: "02:00" }, clusterResource), /Select a weekday/);
  await assert.rejects(dwsManagement.execute(session, "maintenance-window", { day: "Mon", start: "22:00", end: "22:00" }, clusterResource), /exactly four hours/);
  await assert.rejects(dwsManagement.execute(session, "maintenance-window", { day: "Mon", start: "22:00", end: "00:00" }, clusterResource), /exactly four hours/);
  assert.equal(writes.length, 0);
  const outcome = await dwsManagement.execute(session, "maintenance-window", { day: "Mon", start: "22:00", end: "02:00" }, clusterResource);
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/clusters/cluster-1/maintenance-window", search: "", method: "PUT", body: { day: "Mon", start_time: "22:00", end_time: "02:00" } }]);
  const choices = await dwsManagement.options!(session, "maintenance-window");
  assert.deepEqual(choices.days.map((choice) => choice.value), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.equal(choices.hours.length, 24);
});

test("security group changes revalidate the project and refuse the current group", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "security-group", { securityGroup: "forged-group" }, clusterResource), /no longer available/);
  await assert.rejects(dwsManagement.execute(session, "security-group", { securityGroup: "sg-1" }, clusterResource), /already uses/);
  assert.equal(writes.length, 0);
  const outcome = await dwsManagement.execute(session, "security-group", { securityGroup: "sg-2" }, clusterResource);
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v1/project-1/clusters/cluster-1/security-group", search: "", method: "PUT", body: { security_groups: ["sg-2"] } }]);
});

test("password resets follow the native rules, guard running tasks, and never leak the secret", async (t) => {
  const writes = mockCloud(t);
  const secret = "Str0ngPass!1";
  await assert.rejects(dwsManagement.execute(session, "reset-password", { password: "alllowercase9" }, clusterResource), /at least three/);
  await assert.rejects(dwsManagement.execute(session, "reset-password", { password: "Str0ngPass$1234" }, clusterResource), /outside the supported DWS set/);
  await assert.rejects(dwsManagement.execute(session, "reset-password", { password: secret }, busyResource), (error: Error) => !error.message.includes(secret));
  longAdminUser = true;
  try {
    await assert.rejects(dwsManagement.execute(session, "reset-password", { password: "warehouse_admin2" }, clusterResource), /cannot match the administrator username/);
  } finally { longAdminUser = false; }
  assert.equal(writes.length, 0);
  const outcome = await dwsManagement.execute(session, "reset-password", { password: secret }, clusterResource);
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/clusters/cluster-1/reset-password", search: "", method: "POST", body: { new_password: secret } }]);
});

test("inspect reports topology, private endpoints, and non-secret configuration", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const result = await dwsManagement.execute(session, "inspect", {}, clusterResource);
  assert.ok(result.facts!.some((fact) => fact.label === "Status" && fact.value === "AVAILABLE · NORMAL"));
  assert.ok(result.facts!.some((fact) => fact.label === "Private endpoints" && fact.value.includes("192.168.0.10:8000")));
  assert.ok(result.facts!.some((fact) => fact.label === "Public IP" && fact.value === "Not bound (private only)"));
  assert.ok(result.facts!.some((fact) => fact.label === "Network" && fact.value.includes("vpc-1") && fact.value.includes("network-1") && fact.value.includes("sg-1")));
  assert.ok(result.facts!.some((fact) => fact.label === "dws-node-1 · Available" && fact.value.includes("az-1")));
  assert.ok(result.facts!.some((fact) => fact.label === "Parameter group default-dws"));
  assert.ok(!JSON.stringify(result).toLowerCase().includes("password"));
});

test("progress surfaces the native task state and action progress", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const idle = await dwsManagement.execute(session, "progress", {}, clusterResource);
  assert.equal(idle.message, "No management task is running.");
  assert.ok(idle.facts!.some((fact) => fact.label === "Sub-status" && fact.value === "NORMAL"));
  const busy = await dwsManagement.execute(session, "progress", {}, busyResource);
  assert.equal(busy.message, "The cluster is running the SNAPSHOTTING task.");
  assert.ok(busy.facts!.some((fact) => fact.label === "Task progress" && fact.value === "SNAPSHOTTING: 42%"));
});

test("quotas and metrics report the native project catalogs", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const quotas = await dwsManagement.execute(session, "quotas", {}, clusterResource);
  assert.deepEqual(quotas.facts, [{ label: "instances", value: "2 used of 15 count" }]);
  const metrics = await dwsManagement.execute(session, "metrics", {}, clusterResource);
  assert.equal(metrics.message, "1 supported metrics loaded.");
  assert.ok(metrics.facts!.some((fact) => fact.label === "cpu_usage" && fact.value.includes("collect rate 1 minute")));
});

test("description updates use the native description contract", async (t) => {
  const writes = mockCloud(t);
  const outcome = await dwsManagement.execute(session, "describe", { description: "Primary analytics warehouse" }, clusterResource);
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v1/project-1/clusters/cluster-1/description", search: "", method: "POST", body: { description_info: "Primary analytics warehouse" } }]);
});

test("job polling maps native task states and rejects foreign tasks", async (t) => {
  const replies = [
    { job_id: "other", status: "RUNNING" },
    { job_id: "cloud-job", status: "SUCCESS", progress: "100%" },
    { job_id: "cloud-job", status: "FAIL", failed_code: "DWS.5000", failed_detail: "Insufficient quota" },
    { job_id: "cloud-job", status: "STOP" },
    { job_id: "cloud-job", status: "RUNNING", progress: "42%" },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname, "/v1.0/project-1/job/cloud-job"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "dws", operation: "Restore to new cluster", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job" };
  await assert.rejects(dwsManagement.poll!(session, entry), /different DWS task/);
  const succeeded = await dwsManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  const failed = await dwsManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /cloud task failed/);
  assert.doesNotMatch(failed.message!, /Insufficient quota/);
  const stopped = await dwsManagement.poll!(session, entry);
  assert.equal(stopped.state, "failed");
  assert.match(stopped.message!, /stopped/);
  const running = await dwsManagement.poll!(session, entry);
  assert.equal(running.state, "submitted");
  assert.match(running.message!, /42%/);
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(dwsManagement.execute(session, "attach-eip", {}, clusterResource), /Unsupported DWS operation/);
  assert.equal(writes.length, 0);
});

test("DWS mutations reject unknown states and every unverified or nonempty native management task", async t => {
  let state: Record<string, unknown> = { ...baseDetail, task_status: "NEW_NATIVE_TASK" };
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return Response.json(writeResponse); }
    if (new URL(input).pathname === "/v1.0/project-1/clusters/cluster-1") return Response.json({ cluster: state });
    return Response.json(read(new URL(input)));
  });
  for (const operation of ["rename", "describe", "restart", "maintenance-window", "security-group", "create-snapshot", "delete-snapshot", "restore-snapshot", "delete"]) await assert.rejects(dwsManagement.execute(session, operation, { name: "Renamed" }, clusterResource), /task/);
  state = { ...baseDetail, status: "UNKNOWN" };
  await assert.rejects(dwsManagement.execute(session, "delete", {}, clusterResource), /unknown state/);
  state = { ...baseDetail }; delete state.task_status;
  await assert.rejects(dwsManagement.execute(session, "restart", {}, clusterResource), /could not be verified/);
  assert.equal(writes, 0);
});

test("DWS creation rechecks the native AZ catalog after an offering remains on sale", async t => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return Response.json(writeResponse); }
    if (new URL(input).pathname === "/v1.0/project-1/availability-zones") return Response.json({ availability_zones: [{ code: "az-1", status: "unavailable" }] });
    return Response.json(read(new URL(input)));
  });
  await assert.rejects(dwsManagement.execute(session, "create", createValues), /zone is no longer available/);
  assert.equal(writes, 0);
});

test("DWS rejects incomplete creation acknowledgements and private native 200 errors", async t => {
  let response: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => Response.json(init.method ? response : read(new URL(input))));
  await assert.rejects(dwsManagement.execute(session, "create", createValues), /no verified cluster ID/);
  response = { error_code: "DWS.error", error_msg: "PRIVATE_PASSWORD" };
  await assert.rejects(dwsManagement.execute(session, "create", createValues), error => error instanceof Error && /Huawei rejected/.test(error.message) && !error.message.includes("PRIVATE_PASSWORD"));
  await assert.rejects(dwsManagement.execute(session, "rename", { name: "Renamed" }, clusterResource), /Huawei rejected/);
});

test("DWS refuses fractional and nonfinite native sizing values before writes", async t => {
  const writes = mockCloud(t);
  for (const numNode of [NaN, 3.5, Infinity]) await assert.rejects(dwsManagement.execute(session, "create", { ...createValues, numNode }), /node count/);
  for (const dbPort of [NaN, 8000.5, Infinity]) await assert.rejects(dwsManagement.execute(session, "create", { ...createValues, dbPort }), /database port/);
  for (const count of [NaN, 3.5, Infinity]) await assert.rejects(dwsManagement.execute(session, "scale-out", { count }, clusterResource), /at least 3/);
  for (const keepSnapshots of [NaN, 1.5, Infinity]) await assert.rejects(dwsManagement.execute(session, "delete", { keepSnapshots }, clusterResource), /snapshot count/);
  assert.equal(writes.length, 0);
});
