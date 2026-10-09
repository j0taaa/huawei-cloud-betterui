import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { cssManagement } from "@/lib/huawei/management/adapters/css";
import { validateManagementValues, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const essNode = (id: string) => ({ id, type: "ess", status: "200", specCode: "ess.spec-2u8g", azCode: "sa-brazil-1a", volume: { type: "HIGH", size: 40 } });
const clustersPage1 = [
  { id: "css-1", name: "Search One", status: "200", created: "2026-01-01T00:00:00", endpoint: "192.168.0.10:9200", datastore: { type: "elasticsearch", version: "7.10.2" }, instances: [essNode("node-1"), essNode("node-2"), essNode("node-3"), essNode("node-4")] },
  { id: "css-2", name: "Search Two", status: "200", created: "2026-01-02T00:00:00", endpoint: "192.168.0.11:9200", datastore: { type: "opensearch", version: "2.19.0" }, instances: [essNode("node-5"), essNode("node-6"), essNode("node-7")] },
];
const clustersPage2 = [
  { id: "css-3", name: "Search Three", status: "100", created: "2026-01-03T00:00:00", endpoint: "-", datastore: { type: "elasticsearch", version: "7.10.2" }, instances: [essNode("node-8")] },
];
const flavorVersions = [
  { version: "7.10.2", type: "ess", flavors: [
    { name: "ess.spec-2u8g", flavor_id: "flavor-2u8g", cpu: 2, ram: 8, diskrange: "40,800", availableAZ: "sa-brazil-1a,sa-brazil-1b" },
    { name: "ess.spec-4u16g", flavor_id: "flavor-4u16g", cpu: 4, ram: 16, diskrange: "80,1600", availableAZ: "sa-brazil-1a" },
  ] },
  { version: "2.19.0", type: "ess", flavors: [
    { name: "ess.spec-2u8g", flavor_id: "flavor-os-2u8g", cpu: 2, ram: 8, diskrange: "40,800", availableAZ: "sa-brazil-1a" },
  ] },
  { version: "6.2.3", type: "ess", flavors: [
    { name: "ess.spec-1u4g", flavor_id: "flavor-old", cpu: 1, ram: 4, diskrange: "40,400", availableAZ: "sa-brazil-1a" },
  ] },
  { version: "7.10.2", type: "ess-master", flavors: [
    { name: "ess.master-4u32g", flavor_id: "flavor-master", cpu: 4, ram: 32, diskrange: "40,40", availableAZ: "sa-brazil-1a" },
  ] },
];
const resizeFlavors = { id: "engine-1", dbname: "elasticsearch", versions: [{ id: "version-1", name: "7.10.2", flavors: [
  { str_id: "resize-4u16g", cpu: 4, ram: 16, name: "ess.spec-4u16g", region: "sa-brazil-1", typename: "ess", diskrange: "80,1600", condOperationStatus: "normal", localdisk: false, edge: false },
  { str_id: "resize-2u8g", cpu: 2, ram: 8, name: "ess.spec-2u8g", region: "sa-brazil-1", typename: "ess", diskrange: "40,800", condOperationStatus: "normal", localdisk: false, edge: false },
  { str_id: "resize-8u32g", cpu: 8, ram: 32, name: "ess.spec-8u32g", region: "sa-brazil-1", typename: "ess", diskrange: "160,3200", condOperationStatus: "sellout", localdisk: false, edge: false },
  { str_id: "resize-master", cpu: 4, ram: 32, name: "ess.master-4u32g", region: "sa-brazil-1", typename: "ess-master", diskrange: "40,40", condOperationStatus: "normal", localdisk: false, edge: false },
  { str_id: "resize-unknown", cpu: 16, ram: 64, name: "ess.spec-16u64g", region: "sa-brazil-1", typename: "ess", diskrange: "320,6400", condOperationStatus: "normal", localdisk: false, edge: false },
] }] };
const cssDetail = {
  id: "css-1", name: "Search One", status: "200", created: "2026-01-01T00:00:00", updated: "2026-01-01T01:00:00",
  endpoint: "192.168.0.10:9200", desc: "Primary search cluster", datastore: { type: "elasticsearch", version: "7.10.2" },
  httpsEnable: false, authorityEnable: false, diskEncrypted: false, period: false, backupAvailable: true,
  snapshotPolicy: { backupEnable: true, bakPeriod: "16:00 GMT+08:00", bakFrequency: "DAY", bakKeepDay: 7 },
  actions: [], instances: clustersPage1[0].instances,
};
const css2Detail = { ...cssDetail, id: "css-2", name: "Search Two", datastore: { type: "opensearch", version: "2.19.0" }, instances: clustersPage1[1].instances };
const snapshotRows = [
  { clusterId: "css-1", id: "snap-manual", name: "snapshot-manual-one", status: "COMPLETED", backupType: "1", backupMethod: "manual", created: "2026-01-02T00:00:00", indices: "*" },
  { clusterId: "css-1", id: "snap-auto", name: "snapshot-auto-one", status: "COMPLETED", backupType: "0", backupMethod: "auto", created: "2026-01-01T00:00:00", indices: "*" },
  { clusterId: "css-1", id: "snap-building", name: "snapshot-building", status: "BUILDING", backupType: "1", created: "2026-01-03T00:00:00", indices: "logs-*" },
];
const writeResponse = { cluster: { id: "new-css", name: "New Cluster" }, backup: { id: "snap-new", name: "snapshot-new" }, id: "css-1" };

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v1.0/project-1/clusters") {
    return Number(url.searchParams.get("offset") ?? "0") > 0 ? { clusters: clustersPage2, total_count: 3 } : { clusters: clustersPage1, total_count: 3 };
  }
  if (path === "/v1.0/project-1/clusters/css-1") return cssDetail;
  if (path === "/v1.0/project-1/clusters/css-2") return css2Detail;
  if (path === "/v1.0/project-1/clusters/css-1/index_snapshots") return { backups: snapshotRows };
  if (path === "/v1.0/project-1/es-flavors") return { versions: flavorVersions };
  if (path === "/v1.0/project-1/resize-flavors") return resizeFlavors;
  if (path === "/v1/project-1/subnets") return { subnets: [{ id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet", cidr: "192.168.0.0/24" }] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Security" }] };
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

const cssResource: ManagementResource = { id: "css-1", name: "Search One", status: "200", values: { name: "Search One", engine: "elasticsearch", version: "7.10.2", nodeCount: 4, projectId: "project-1" } };
const smallResource: ManagementResource = { id: "css-2", name: "Search Two", status: "200", values: { name: "Search Two", engine: "opensearch", version: "2.19.0", nodeCount: 3, projectId: "project-1" } };
const offering = JSON.stringify(["elasticsearch", "7.10.2", "ess.spec-2u8g"]);
const createValues: ManagementValues = { name: "Example", offering, zone: "sa-brazil-1a", nodeCount: 1, volumeType: "HIGH", diskSizeGb: 100, securityMode: false, subnet: "subnet-1", securityGroup: "sg-1", enterpriseProjectId: "0" };

test("inventory follows cluster pagination and maps engine, version, and node counts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { const url = new URL(input); reads.push(url.pathname + url.search); return Response.json(read(url)); });
  const resources = await cssManagement.inventory(session);
  assert.deepEqual(reads, ["/v1.0/project-1/clusters?limit=100&offset=0", "/v1.0/project-1/clusters?limit=100&offset=2"]);
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status, item.values?.engine, item.values?.version, item.values?.nodeCount]), [
    ["css-1", "Search One", "200", "elasticsearch", "7.10.2", 4],
    ["css-2", "Search Two", "200", "opensearch", "2.19.0", 3],
    ["css-3", "Search Three", "100", "elasticsearch", "7.10.2", 1],
  ]);
});

test("create options whitelist live on-sale data-node offerings, zones, and project networks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await cssManagement.options!(session, "create");
  assert.deepEqual(choices.offerings.map((choice) => choice.value), [
    JSON.stringify(["elasticsearch", "7.10.2", "ess.spec-2u8g"]),
    JSON.stringify(["elasticsearch", "7.10.2", "ess.spec-4u16g"]),
    JSON.stringify(["opensearch", "2.19.0", "ess.spec-2u8g"]),
  ]);
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["sa-brazil-1a", "sa-brazil-1b"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1"]);
  const volumeField = cssManagement.operations.find((item) => item.id === "create")!.fields.find((field) => field.key === "volumeType")!;
  assert.deepEqual(volumeField.choices!.map((choice) => choice.value), ["COMMON", "HIGH", "ULTRAHIGH", "ESSD"]);
});

test("create sends the documented private pay-per-use multi-role payload", async (t) => {
  const writes = mockCloud(t);
  const outcome = await cssManagement.execute(session, "create", createValues);
  assert.equal(outcome.resourceId, "new-css");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{
    path: "/v2.0/project-1/clusters", method: "POST",
    body: { cluster: {
      name: "Example",
      roles: [{ flavorRef: "ess.spec-2u8g", volume: { volume_type: "HIGH", size: 100 }, type: "ess", instanceNum: 1 }],
      nics: { vpcId: "vpc-1", netId: "network-1", securityGroupId: "sg-1" },
      availability_zone: "sa-brazil-1a",
      datastore: { version: "7.10.2", type: "elasticsearch" },
      enterprise_project_id: "0",
    } },
  }]);
});

test("create rejects forged or unavailable selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, offering: JSON.stringify(["elasticsearch", "7.10.2", "forged-flavor"]) }, /no longer available/],
    [{ ...createValues, offering: JSON.stringify(["mysql", "8.0", "ess.spec-2u8g"]) }, /Select an available engine/],
    [{ ...createValues, offering: JSON.stringify(["elasticsearch", "7.10.2", "ess.spec-4u16g"]), zone: "sa-brazil-1b" }, /unavailable in this availability zone/],
    [{ ...createValues, diskSizeGb: 45 }, /multiple of 20/],
    [{ ...createValues, diskSizeGb: 60, offering: JSON.stringify(["elasticsearch", "7.10.2", "ess.spec-4u16g"]) }, /between 80 and 1600/],
    [{ ...createValues, diskSizeGb: 2000 }, /between 40 and 800/],
    [{ ...createValues, securityMode: true }, /required for security clusters/],
    [{ ...createValues, securityMode: true, adminPassword: "alllowercase9" }, /at least three/],
    [{ ...createValues, securityMode: true, adminPassword: "Str0ngPass+1" }, /outside the supported set/],
    [{ ...createValues, subnet: "forged-subnet" }, /subnet is no longer available/],
    [{ ...createValues, securityGroup: "forged-group" }, /security group is no longer available/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(cssManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("security-mode create sends authority, HTTPS, and the password only to the cloud", async (t) => {
  const writes = mockCloud(t);
  const secret = "Str0ngPass!1";
  const outcome = await cssManagement.execute(session, "create", { ...createValues, securityMode: true, adminPassword: secret });
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal(writes.length, 1);
  const body = writes[0].body as { cluster: { authorityEnable: boolean; httpsEnable: boolean; adminPwd: string } };
  assert.equal(body.cluster.authorityEnable, true);
  assert.equal(body.cluster.httpsEnable, true);
  assert.equal(body.cluster.adminPwd, secret);
});

test("the form contract whitelists live choices and enforces documented bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = cssManagement.operations.find((item) => item.id === "create")!;
  const choices = await cssManagement.options!(session, "create");
  const values = validateManagementValues(operation, { ...createValues, offering: choices.offerings[0].value }, choices);
  assert.equal(values.name, "Example");
  assert.throws(() => validateManagementValues(operation, { ...values, offering: JSON.stringify(["elasticsearch", "7.10.2", "forged-flavor"]) }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...values, zone: "forged-az" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...values, diskSizeGb: 39 }, choices), /at least 40/);
  assert.throws(() => validateManagementValues(operation, { ...values, nodeCount: 33 }, choices), /no more than 32/);
});

test("rename uses the documented changename contract and keeps empty descriptions untouched", async (t) => {
  const writes = mockCloud(t);
  await cssManagement.execute(session, "rename", { name: "Renamed", description: "Updated" }, cssResource);
  await cssManagement.execute(session, "rename", { name: "Renamed" }, cssResource);
  assert.deepEqual(writes, [
    { path: "/v1.0/project-1/clusters/css-1/changename", method: "POST", body: { display_name: "Renamed", desc: "Updated" } },
    { path: "/v1.0/project-1/clusters/css-1/changename", method: "POST", body: { display_name: "Renamed" } },
  ]);
});

test("inspect reports live engine, network, security, billing, node, and snapshot-policy facts", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const outcome = await cssManagement.execute(session, "inspect", {}, cssResource);
  const facts = new Map(outcome.facts!.map((fact) => [fact.label, fact.value]));
  assert.equal(facts.get("Engine"), "elasticsearch 7.10.2");
  assert.equal(facts.get("Private endpoint"), "192.168.0.10:9200");
  assert.equal(facts.get("Security mode"), "Disabled");
  assert.equal(facts.get("Billing mode"), "Pay-per-use");
  assert.equal(facts.get("Description"), "Primary search cluster");
  assert.match(facts.get("ess nodes (4)")!, /ess\.spec-2u8g · sa-brazil-1a · HIGH · 40 GB/);
  assert.match(facts.get("Automatic snapshots")!, /DAY at 16:00 GMT\+08:00, kept 7 days/);
});

test("restart guards availability and the documented three-node rolling-restart floor", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cssManagement.execute(session, "restart", {}, smallResource), /more than three nodes/);
  assert.equal(writes.length, 0);
  const outcome = await cssManagement.execute(session, "restart", {}, cssResource);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v2.0/project-1/clusters/css-1/restart", method: "POST", body: { type: "role", value: "ess" } }]);
});

test("restart refuses clusters that are no longer in the available state", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return Response.json({}); }
    return Response.json({ ...read(new URL(input)), status: "300" });
  });
  await assert.rejects(cssManagement.execute(session, "restart", {}, cssResource), /not in the available state/);
  assert.equal(writes, 0);
});

test("change-flavor uses the live resize catalog and rejects stale or no-op selections", async (t) => {
  const writes = mockCloud(t);
  const choices = await cssManagement.options!(session, "change-flavor", cssResource);
  assert.deepEqual(choices.resizeFlavors.map((choice) => choice.value), ["flavor-4u16g", "flavor-2u8g"]);
  await assert.rejects(cssManagement.execute(session, "change-flavor", { flavor: "forged-flavor" }, cssResource), /no longer available/);
  await assert.rejects(cssManagement.execute(session, "change-flavor", { flavor: "flavor-2u8g" }, cssResource), /already the current/);
  assert.equal(writes.length, 0);
  const outcome = await cssManagement.execute(session, "change-flavor", { flavor: "flavor-4u16g" }, cssResource);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/clusters/css-1/ess/flavor", method: "POST", body: { new_flavor_id: "flavor-4u16g", operation_type: "vm" } }]);
});

test("storage expansion enforces 20 GB steps and the flavor's disk ceiling", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cssManagement.execute(session, "expand-storage", { growSizeGb: 30 }, cssResource), /multiple of 20/);
  await assert.rejects(cssManagement.execute(session, "expand-storage", { growSizeGb: 800 }, cssResource), /cannot exceed 800/);
  assert.equal(writes.length, 0);
  const outcome = await cssManagement.execute(session, "expand-storage", { growSizeGb: 40 }, cssResource);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/clusters/css-1/role_extend", method: "POST", body: { grow: [{ type: "ess", nodesize: 0, disksize: 40 }] } }]);
});

test("snapshot listing, creation, and deletion revalidate ownership and documented character rules", async (t) => {
  const writes = mockCloud(t);
  const list = await cssManagement.execute(session, "snapshots", {}, cssResource);
  assert.equal(list.message, "3 snapshots loaded.");
  assert.ok(list.facts!.some((fact) => fact.label === "snapshot-manual-one · manual · COMPLETED"));
  assert.ok(list.facts!.some((fact) => fact.label === "snapshot-auto-one · automatic · COMPLETED"));
  await assert.rejects(cssManagement.execute(session, "create-snapshot", { name: "snapshot-nightly", description: "Before!" }, cssResource), /cannot contain/);
  await assert.rejects(cssManagement.execute(session, "create-snapshot", { name: "snapshot-nightly", indices: "Index1" }, cssResource), /uppercase/);
  await assert.rejects(cssManagement.execute(session, "delete-snapshot", { snapshot: "foreign" }, cssResource), /not in this cluster/);
  assert.equal(writes.length, 0);
  const created = await cssManagement.execute(session, "create-snapshot", { name: "snapshot-nightly", description: "Before upgrade", indices: "logs-*" }, cssResource);
  assert.equal(created.resourceId, "snap-new");
  assert.equal(created.asynchronous, true);
  await cssManagement.execute(session, "delete-snapshot", { snapshot: "snap-manual" }, cssResource);
  assert.deepEqual(writes, [
    { path: "/v1.0/project-1/clusters/css-1/index_snapshot", method: "POST", body: { name: "snapshot-nightly", description: "Before upgrade", indices: "logs-*" } },
    { path: "/v1.0/project-1/clusters/css-1/index_snapshot/snap-manual", method: "DELETE", body: undefined },
  ]);
  const choices = await cssManagement.options!(session, "delete-snapshot", cssResource);
  assert.deepEqual(choices.snapshots.map((choice) => choice.value), ["snap-manual"]);
});

test("snapshot policy enable and disable use the documented string flags and required fields", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cssManagement.execute(session, "snapshot-policy", { enable: true, frequency: "DAY", period: "00:00 GMT-03:00", keepday: 7 }, cssResource), /prefix is required/);
  await assert.rejects(cssManagement.execute(session, "snapshot-policy", { enable: true, prefix: "nightly", frequency: "DAY", period: "00:00 GMT-03:00" }, cssResource), /retention in days is required/);
  await assert.rejects(cssManagement.execute(session, "snapshot-policy", { enable: true, prefix: "nightly", frequency: "DAY", keepday: 7 }, cssResource), /start time is required/);
  assert.equal(writes.length, 0);
  await cssManagement.execute(session, "snapshot-policy", { enable: true, prefix: "nightly", frequency: "DAY", period: "00:00 GMT-03:00", keepday: 7 }, cssResource);
  await cssManagement.execute(session, "snapshot-policy", { enable: true, prefix: "hourly", frequency: "HOUR", keepday: 1 }, cssResource);
  await cssManagement.execute(session, "snapshot-policy", { enable: false, deleteAuto: true }, cssResource);
  assert.deepEqual(writes, [
    { path: "/v1.0/project-1/clusters/css-1/index_snapshot/policy", method: "POST", body: { enable: "true", prefix: "nightly", keepday: 7, frequency: "DAY", period: "00:00 GMT-03:00" } },
    { path: "/v1.0/project-1/clusters/css-1/index_snapshot/policy", method: "POST", body: { enable: "true", prefix: "hourly", keepday: 1, frequency: "HOUR" } },
    { path: "/v1.0/project-1/clusters/css-1/index_snapshot/policy", method: "POST", body: { enable: "false", delete_auto: "true" } },
  ]);
});

test("delete uses the native cluster contract and destructive operations declare confirmations and status gates", async (t) => {
  const writes = mockCloud(t);
  const outcome = await cssManagement.execute(session, "delete", {}, cssResource);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1.0/project-1/clusters/css-1", method: "DELETE", body: undefined }]);
  for (const id of ["restart", "change-flavor", "expand-storage", "delete", "delete-snapshot", "snapshot-policy"]) {
    const operation = cssManagement.operations.find((item) => item.id === id)!;
    assert.equal(operation.confirmation, true, id);
    assert.ok(operation.impact, id);
  }
  for (const id of ["restart", "change-flavor", "expand-storage", "snapshot-policy"]) {
    assert.deepEqual(cssManagement.operations.find((item) => item.id === id)!.allowedStatuses, ["200"], id);
  }
});

test("provider failures surface the cloud error without leaking secrets", async (t) => {
  const secret = "Str0ngPass!1";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    if (url.pathname === "/v2.0/project-1/clusters") return Response.json({ error_msg: "Flavor sold out" }, { status: 400 });
    return Response.json({});
  });
  await assert.rejects(
    cssManagement.execute(session, "create", { ...createValues, securityMode: true, adminPassword: secret }),
    (error: Error) => /Flavor sold out/.test(error.message) && !error.message.includes(secret),
  );
});

test("CSS snapshot deletion requires current parent ownership and a completed manual snapshot", async (t) => {
  let foreign = true;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.ok(!init.method); const url = new URL(input);
    if (url.pathname.endsWith("/index_snapshots")) return Response.json({ backups: foreign ? [{ ...snapshotRows[0], clusterId: "other-cluster" }] : snapshotRows });
    return Response.json(read(url));
  });
  await assert.rejects(cssManagement.execute(session, "delete-snapshot", { snapshot: "snap-manual" }, cssResource), /not in this cluster/);
  foreign = false;
  await assert.rejects(cssManagement.execute(session, "delete-snapshot", { snapshot: "snap-auto" }, cssResource), /completed manual/);
  await assert.rejects(cssManagement.execute(session, "delete-snapshot", { snapshot: "snap-building" }, cssResource), /completed manual/);
});

test("CSS rejects unverified cluster IDs, billing mode, and missing snapshot storage", async (t) => {
  let detail: Record<string, unknown> = { ...cssDetail, id: "other-cluster" };
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => { assert.ok(!init.method); return Response.json(detail); });
  await assert.rejects(cssManagement.execute(session, "delete", {}, cssResource), /different search cluster/);
  detail = { ...cssDetail, period: true };
  await assert.rejects(cssManagement.execute(session, "delete", {}, cssResource), /pay-per-use/);
  detail = { ...cssDetail, period: undefined };
  await assert.rejects(cssManagement.execute(session, "delete", {}, cssResource), /pay-per-use/);
  detail = { ...cssDetail, backupAvailable: false };
  await assert.rejects(cssManagement.execute(session, "create-snapshot", { name: "manual" }, cssResource), /snapshot storage/);
});

test("CSS provisioning refuses unavailable subnet network IDs", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.ok(!init.method); const url = new URL(input);
    return Response.json(url.pathname.endsWith("/subnets") ? { subnets: [{ id: "subnet-1", vpc_id: "vpc-1", neutron_network_id: "-" }] } : read(url));
  });
  await assert.rejects(cssManagement.execute(session, "create", createValues), /subnet is no longer available/);
});

test("CSS resizing checks every current node's zone and disk capacity", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.ok(!init.method); const url = new URL(input);
    return Response.json(url.pathname.endsWith("/clusters/css-1") ? { ...cssDetail, instances: [{ ...essNode("node"), azCode: "sold-out-zone" }] } : read(url));
  });
  await assert.rejects(cssManagement.execute(session, "change-flavor", { flavor: "flavor-4u16g" }, cssResource), /current engine, node zones, or disk/);
  assert.deepEqual((await cssManagement.options!(session, "change-flavor", cssResource)).resizeFlavors, []);
});
