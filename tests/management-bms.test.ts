import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { bmsManagement } from "@/lib/huawei/management/adapters/bms";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { asRecord } from "@/lib/huawei/parsers";
import { session } from "./fixtures/session";

const flavors = [
  { id: "physical.s2.medium", name: "physical.s2.medium", vcpus: 8, ram: 32768, disk: "19660", os_extra_specs: { resource_type: "ironic", "cond:operation:status": "normal", "cond:operation:az": "az-1(normal), az-2(sellout)", "baremetal:extBootType": "Volume", "baremetal:__support_evs": "true", "capabilities:cpu_arch": "x86_64" } },
  { id: "physical.s2.local", name: "physical.s2.local", vcpus: 8, ram: 32768, disk: "19660", os_extra_specs: { resource_type: "ironic", "cond:operation:status": "promotion", "baremetal:extBootType": "LocalDisk" } },
  { id: "physical.io.large", name: "physical.io.large", vcpus: 32, ram: 131072, disk: "32768", os_extra_specs: { resource_type: "ironic", "cond:operation:status": "abandon", "baremetal:extBootType": "Volume" } },
  { id: "physical.io.obt", name: "physical.io.obt", vcpus: 32, ram: 131072, disk: "32768", os_extra_specs: { resource_type: "ironic", "cond:operation:status": "obt", "baremetal:extBootType": "Volume" } },
  { id: "c6.large.2", name: "c6.large.2", vcpus: 2, ram: 4096, disk: "0", os_extra_specs: { resource_type: "FusionCompute", "cond:operation:status": "normal" } },
];
const images = [
  { id: "image-bms", name: "BMS Linux", __os_type: "Linux", status: "active", min_disk: 40, virtual_env_type: "Ironic" },
  { id: "image-bms-win", name: "BMS Windows", __os_type: "Windows", status: "active", min_disk: 80, virtual_env_type: "Ironic" },
  { id: "image-bms-inactive", name: "BMS Legacy", __os_type: "Linux", status: "inactive", min_disk: 40, virtual_env_type: "Ironic" },
];
const privateImage = { id: "image-private-bms", name: "Private BMS", __os_type: "Linux", status: "active", min_disk: 40, virtual_env_type: "Ironic" };
const servers = [
  { id: "bms-1", name: "Worker One", status: "ACTIVE", key_name: "bms-key", created: "2026-01-01T00:00:00Z", updated: "2026-01-02T00:00:00Z", "OS-EXT-AZ:availability_zone": "az-1", "OS-EXT-STS:task_state": "", flavor: { id: "physical.s2.medium", name: "physical.s2.medium" }, image: { id: "image-bms", name: "BMS Linux" }, addresses: { "bms-subnet": [{ addr: "192.168.0.10", "OS-EXT-IPS:type": "fixed" }] }, metadata: { chargingMode: "0", vpc_id: "vpc-1", op_svc_userid: "user-1", "metering.order_id": "CS2000000001" }, "os-extended-volumes:volumes_attached": [{ id: "vol-1", device: "/dev/sda" }] },
  { id: "bms-2", name: "Worker Two", status: "SHUTOFF", key_name: "bms-key", created: "2026-01-01T00:00:00Z", updated: "2026-01-02T00:00:00Z", "OS-EXT-AZ:availability_zone": "az-1", flavor: { id: "physical.s2.medium", name: "physical.s2.medium" }, image: { id: "image-bms", name: "BMS Linux" }, addresses: { "bms-subnet": [{ addr: "192.168.0.20", "OS-EXT-IPS:type": "fixed" }] }, metadata: { chargingMode: "1", vpc_id: "vpc-1" } },
  { id: "bms-3", name: "Worker Three", status: "SHUTOFF", key_name: "bms-key", created: "2026-01-01T00:00:00Z", updated: "2026-01-02T00:00:00Z", "OS-EXT-AZ:availability_zone": "az-1", flavor: { id: "physical.s2.medium", name: "physical.s2.medium" }, image: { id: "image-bms", name: "BMS Linux" }, addresses: {}, metadata: {} },
  { id: "bms-4", name: "Worker Four", status: "SHUTOFF", key_name: "bms-key", created: "2026-01-01T00:00:00Z", updated: "2026-01-02T00:00:00Z", "OS-EXT-AZ:availability_zone": "az-1", flavor: { id: "physical.s2.medium", name: "physical.s2.medium" }, image: { id: "image-bms", name: "BMS Linux" }, addresses: {}, metadata: { chargingMode: "0", vpc_id: "vpc-1" } },
];
for (const server of servers) Object.assign(server, { tenant_id: session.projectId, locked: false, "OS-EXT-STS:task_state": null });
const nics = {
  "bms-1": [{ port_id: "port-1", net_id: "network-1", port_state: "ACTIVE", mac_addr: "fa:16:3e:00:00:01", fixed_ips: [{ ip_address: "192.168.0.10", subnet_id: "neutron-subnet-1" }] }, { port_id: "port-2", net_id: "network-2", port_state: "ACTIVE", mac_addr: "fa:16:3e:00:00:02", fixed_ips: [{ ip_address: "10.0.0.10", subnet_id: "neutron-subnet-2" }] }],
  "bms-2": [{ port_id: "port-3", net_id: "network-1", port_state: "ACTIVE", mac_addr: "fa:16:3e:00:00:03", fixed_ips: [{ ip_address: "192.168.0.20", subnet_id: "neutron-subnet-1" }] }],
};
const tags = [{ key: "__type_baremetal", value: "physical.s2.medium" }, { key: "env", value: "prod" }];

type Overrides = { flavors?: unknown[]; limits?: Record<string, unknown>; capacity?: number; tags?: unknown[]; server?: Record<string, unknown>; port?: Record<string, unknown> };

function read(url: URL, overrides: Overrides = {}) {
  const path = url.pathname;
  if (path === "/v2/cloudimages") {
    if (url.searchParams.get("__imagetype") === "private") return { images: [privateImage, images[0]] };
    const marker = url.searchParams.get("marker");
    const page = marker ? images.slice(2) : images.slice(0, 2);
    return { images: page, ...(marker ? {} : { page_info: { next_marker: images[2].id } }) };
  }
  if (path === "/v2.1/project-1/os-availability-zone") return { availabilityZoneInfo: [{ zoneName: "az-1", zoneState: { available: true } }, { zoneName: "az-2", zoneState: { available: true } }, { zoneName: "az-3", zoneState: { available: false } }] };
  if (path === "/v2.1/project-1/os-keypairs") return { keypairs: [{ keypair: { name: "bms-key" } }] };
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "BmsSubnet", cidr: "192.168.0.0/24" },
    { id: "subnet-2", vpc_id: "vpc-1", name: "Legacy", cidr: "10.0.0.0/24" },
    { id: "subnet-3", neutron_network_id: "network-3", vpc_id: "vpc-2", name: "OtherVpc", cidr: "172.16.0.0/24" },
  ] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Bms" }, { id: "sg-2", name: "Web" }] };
  if (path === "/v1/project-1/baremetalservers/detail") return { count: servers.length, servers };
  if (path === "/v1/project-1/baremetalservers/flavors") return { flavors: overrides.flavors ?? flavors };
  if (path === "/v1/project-1/baremetalservers/limits") return { absolute: overrides.limits ?? { maxTotalInstances: 10, totalInstancesUsed: 3 } };
  if (path === "/v1/project-1/baremetalservers/available_resource") return { available_resource: [{ availability_zone: url.searchParams.get("availability_zone"), flavors: [{ flavor_id: url.searchParams.get("flavor_id"), count: overrides.capacity ?? 5, status: "normal" }] }] };
  if (path.startsWith("/v1/project-1/ports/")) {
    const id = path.split("/").at(-1);
    return { port: { id, tenant_id: session.projectId, device_id: id === "port-3" ? "bms-2" : "bms-1", network_id: id === "port-2" ? "network-2" : "network-1", "binding:vif_details": { primary_interface: id !== "port-2" }, ...overrides.port } };
  }
  const server = servers.find((item) => path === `/v1/project-1/baremetalservers/${item.id}`);
  if (server) return { server: { ...server, ...overrides.server } };
  const nicsMatch = Object.entries(nics).find(([id]) => path === `/v1/project-1/baremetalservers/${id}/os-interface`);
  if (nicsMatch) return { interfaceAttachments: nicsMatch[1] };
  if (path === "/v1/project-1/baremetalservers/bms-1/tags") return { tags: overrides.tags ?? tags };
  throw new Error(`Unexpected GET ${path}`);
}

function writeResponse(url: URL, body: unknown) {
  if (url.pathname.startsWith("/v1/project-1/ports/")) return { port: { id: url.pathname.split("/").at(-1), security_groups: asRecord(asRecord(body).port).security_groups } };
  if (url.pathname.endsWith("/metadata")) return { metadata: asRecord(body).metadata };
  const serverName = asRecord(asRecord(body).server).name;
  const match = url.pathname.match(/\/baremetalservers\/([^/]+)$/);
  if (match && typeof serverName === "string" && serverName) return { server: { id: match[1], name: serverName } };
  return { job_id: "cloud-job", order_id: "order-1" };
}

function mockCloud(t: TestContext, overrides: Overrides = {}) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url, overrides));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    writes.push({ path: url.pathname, method: init.method, body });
    return Response.json(writeResponse(url, body));
  });
  return writes;
}

const activeResource: ManagementResource = { id: "bms-1", name: "Worker One", status: "ACTIVE" };
const prepaidResource: ManagementResource = { id: "bms-2", name: "Worker Two", status: "SHUTOFF" };
const unverifiedResource: ManagementResource = { id: "bms-3", name: "Worker Three", status: "SHUTOFF" };
const postpaidStoppedResource: ManagementResource = { id: "bms-4", name: "Worker Four", status: "SHUTOFF" };
const baseCreateValues: ManagementValues = { name: "EdgeOne", flavor: "physical.s2.medium", image: "image-bms", zone: "az-1", subnet: "subnet-1", securityGroups: ["sg-1", "sg-2"], authentication: "key", key: "bms-key", billingMode: "postPaid", enterpriseProjectId: "0" };
const createValues: ManagementValues = { ...baseCreateValues, diskType: "SSD", diskSize: 100 };

test("inventory maps the canonical bare metal server list", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { const url = new URL(input); reads.push(url.pathname + url.search); return Response.json(read(url)); });
  const resources = await bmsManagement.inventory(session);
  assert.ok(reads.some((path) => path.startsWith("/v1/project-1/baremetalservers/detail?limit=1000")));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status]), [
    ["bms-1", "Worker One", "ACTIVE"],
    ["bms-2", "Worker Two", "SHUTOFF"],
    ["bms-3", "Worker Three", "SHUTOFF"],
    ["bms-4", "Worker Four", "SHUTOFF"],
  ]);
  assert.equal(resources[0].values?.flavor, "physical.s2.medium");
  assert.equal(resources[0].values?.zone, "az-1");
  assert.equal(resources[0].values?.privateIp, "192.168.0.10");
});

test("create options whitelist commercial ironic flavors, active Ironic images, available zones, and project networks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await bmsManagement.options!(session, "create");
  assert.deepEqual(choices.flavors.map((choice) => choice.value), ["physical.s2.medium", "physical.s2.local"]);
  assert.ok(choices.flavors.every((choice) => !choice.value.includes("io.")));
  assert.deepEqual(choices.images.map((choice) => choice.value), ["image-bms", "image-bms-win", "image-private-bms"]);
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1", "az-2"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2", "subnet-3"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1", "sg-2"]);
  assert.deepEqual(choices.keys.map((choice) => choice.value), ["bms-key"]);
});

test("create sends the documented native payloads for pay-per-use, prepaid, local-disk, and password paths", async (t) => {
  const writes = mockCloud(t);
  const postPaid = await bmsManagement.execute(session, "create", createValues);
  assert.equal(postPaid.jobId, "cloud-job");
  assert.equal(postPaid.asynchronous, true);
  const prePaid = await bmsManagement.execute(session, "create", { ...createValues, name: "OrderOne", billingMode: "prePaid", periodType: "month", periodNum: 3 });
  assert.equal(prePaid.jobId, undefined);
  assert.match(prePaid.message, /unpaid/i);
  assert.ok(prePaid.facts!.some((fact) => fact.label === "Order ID" && fact.value === "order-1"));
  await bmsManagement.execute(session, "create", { ...baseCreateValues, name: "LocalOne", flavor: "physical.s2.local" });
  const password = await bmsManagement.execute(session, "create", { ...createValues, name: "SecretOne", authentication: "password", password: "Str0ngPass!1" });
  assert.ok(!JSON.stringify(password).includes("Str0ngPass!1"));
  assert.deepEqual(writes, [
    { path: "/v1/project-1/baremetalservers", method: "POST", body: { server: { name: "EdgeOne", imageRef: "image-bms", flavorRef: "physical.s2.medium", availability_zone: "az-1", count: 1, vpcid: "vpc-1", nics: [{ subnet_id: "network-1" }], security_groups: [{ id: "sg-1" }, { id: "sg-2" }], metadata: { op_svc_userid: "user-1" }, key_name: "bms-key", root_volume: { volumetype: "SSD", size: 100 }, extendparam: { chargingMode: "postPaid", regionID: "sa-brazil-1", enterprise_project_id: "0" } } } },
    { path: "/v1/project-1/baremetalservers", method: "POST", body: { server: { name: "OrderOne", imageRef: "image-bms", flavorRef: "physical.s2.medium", availability_zone: "az-1", count: 1, vpcid: "vpc-1", nics: [{ subnet_id: "network-1" }], security_groups: [{ id: "sg-1" }, { id: "sg-2" }], metadata: { op_svc_userid: "user-1" }, key_name: "bms-key", root_volume: { volumetype: "SSD", size: 100 }, extendparam: { chargingMode: "prePaid", regionID: "sa-brazil-1", periodType: "month", periodNum: 3, isAutoRenew: "false", isAutoPay: "false", enterprise_project_id: "0" } } } },
    { path: "/v1/project-1/baremetalservers", method: "POST", body: { server: { name: "LocalOne", imageRef: "image-bms", flavorRef: "physical.s2.local", availability_zone: "az-1", count: 1, vpcid: "vpc-1", nics: [{ subnet_id: "network-1" }], security_groups: [{ id: "sg-1" }, { id: "sg-2" }], metadata: { op_svc_userid: "user-1" }, key_name: "bms-key", extendparam: { chargingMode: "postPaid", regionID: "sa-brazil-1", enterprise_project_id: "0" } } } },
    { path: "/v1/project-1/baremetalservers", method: "POST", body: { server: { name: "SecretOne", imageRef: "image-bms", flavorRef: "physical.s2.medium", availability_zone: "az-1", count: 1, vpcid: "vpc-1", nics: [{ subnet_id: "network-1" }], security_groups: [{ id: "sg-1" }, { id: "sg-2" }], metadata: { op_svc_userid: "user-1" }, adminPass: "Str0ngPass!1", root_volume: { volumetype: "SSD", size: 100 }, extendparam: { chargingMode: "postPaid", regionID: "sa-brazil-1", enterprise_project_id: "0" } } } },
  ]);
  const createOperation = bmsManagement.operations.find((item) => item.id === "create")!;
  assert.ok(createOperation.impact);
});

test("create rejects forged or unavailable selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, billingMode: "forged" }, /Select a documented billing mode/],
    [{ ...createValues, billingMode: "prePaid" }, /Select a subscription period type/],
    [{ ...createValues, billingMode: "prePaid", periodType: "month", periodNum: 10 }, /1-9 months or a single year/],
    [{ ...createValues, billingMode: "prePaid", periodType: "year", periodNum: 2 }, /1-9 months or a single year/],
    [{ ...createValues, flavor: "forged-flavor" }, /no longer on sale/],
    [{ ...createValues, flavor: "physical.io.large" }, /no longer on sale/],
    [{ ...createValues, flavor: "physical.io.obt" }, /no longer on sale/],
    [{ ...createValues, zone: "az-2" }, /not on sale in this availability zone/],
    [{ ...createValues, image: "forged-image" }, /no longer available/],
    [{ ...createValues, image: "image-bms-inactive" }, /no longer available/],
    [{ ...createValues, subnet: "forged-subnet" }, /no longer available/],
    [{ ...createValues, subnet: "subnet-2" }, /network ID/],
    [{ ...createValues, securityGroups: ["sg-1", "forged-sg"] }, /security group is no longer available/],
    [{ ...createValues, key: "forged-key" }, /SSH key is no longer available/],
    [{ ...createValues, authentication: "password", password: "alllowercase9" }, /at least three/],
    [{ ...createValues, authentication: "password", password: "Str0ngPass#1" }, /outside the supported BMS set/],
    [{ ...createValues, authentication: "password", password: "rootStr0ngPass1" }, /user name/],
    [{ ...createValues, diskSize: 30 }, /between 40 and 1024/],
    [{ ...createValues, image: "image-bms-win", diskSize: 40 }, /requires at least 80 GB/],
    [baseCreateValues, /require a system disk type/],
    [{ ...createValues, flavor: "physical.s2.local", diskType: "SSD", diskSize: 100 }, /clear the system disk fields/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(bmsManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("create refuses exhausted, unverifiable quota, missing zone capacity, and unknown boot types", async (t) => {
  const exhausted = mockCloud(t, { limits: { maxTotalInstances: 3, totalInstancesUsed: 3 } });
  await assert.rejects(bmsManagement.execute(session, "create", createValues), /quota of 3 is already used/);
  assert.equal(exhausted.length, 0);
  const unverifiable = mockCloud(t, { limits: {} });
  await assert.rejects(bmsManagement.execute(session, "create", createValues), /quota could not be verified/);
  assert.equal(unverifiable.length, 0);
  const soldOut = mockCloud(t, { capacity: 0 });
  await assert.rejects(bmsManagement.execute(session, "create", createValues), /no available capacity/);
  assert.equal(soldOut.length, 0);
  const unknownBoot = mockCloud(t, { flavors: [{ id: "physical.weird", name: "physical.weird", vcpus: 8, ram: 32768, os_extra_specs: { resource_type: "ironic", "cond:operation:status": "normal", "baremetal:extBootType": "Weird" } }] });
  await assert.rejects(bmsManagement.execute(session, "create", { ...createValues, flavor: "physical.weird" }), /boot type could not be verified/);
  assert.equal(unknownBoot.length, 0);
});

test("the form contract whitelists live choices and enforces documented disk bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = bmsManagement.operations.find((item) => item.id === "create")!;
  const choices = await bmsManagement.options!(session, "create");
  const values = validateManagementValues(operation, { ...createValues, flavor: choices.flavors[0].value }, choices);
  assert.equal(values.name, "EdgeOne");
  assert.throws(() => validateManagementValues(operation, { ...createValues, flavor: "forged-flavor" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, zone: "az-3" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, diskSize: 2000 }, choices), /no more than 1024/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, diskSize: 10 }, choices), /at least 40/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, bogus: "x" }, choices), /unsupported field/);
});

test("rename, start, stop, and reboot use their native contracts", async (t) => {
  const writes = mockCloud(t);
  const rename = await bmsManagement.execute(session, "rename", { name: "Renamed" }, activeResource);
  assert.equal(rename.asynchronous, undefined);
  const start = await bmsManagement.execute(session, "start", {}, prepaidResource);
  assert.equal(start.jobId, "cloud-job");
  assert.equal(start.asynchronous, true);
  await bmsManagement.execute(session, "stop", {}, activeResource);
  await bmsManagement.execute(session, "reboot", {}, activeResource);
  assert.deepEqual(writes, [
    { path: "/v1/project-1/baremetalservers/bms-1", method: "PUT", body: { server: { name: "Renamed" } } },
    { path: "/v1/project-1/baremetalservers/action", method: "POST", body: { "os-start": { servers: [{ id: "bms-2" }] } } },
    { path: "/v1/project-1/baremetalservers/action", method: "POST", body: { "os-stop": { type: "HARD", servers: [{ id: "bms-1" }] } } },
    { path: "/v1/project-1/baremetalservers/action", method: "POST", body: { reboot: { type: "HARD", servers: [{ id: "bms-1" }] } } },
  ]);
  const stopOperation = bmsManagement.operations.find((item) => item.id === "stop")!;
  assert.equal(stopOperation.confirmation, true);
  assert.ok(stopOperation.impact);
  assert.deepEqual(stopOperation.allowedStatuses, ["ACTIVE"]);
});

test("mutations without a native job, order, or echo acknowledgment fail closed", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    return Response.json({});
  });
  await assert.rejects(bmsManagement.execute(session, "start", {}, prepaidResource), /no job ID/);
  await assert.rejects(bmsManagement.execute(session, "rename", { name: "Renamed" }, activeResource), /no matching confirmation/);
  await assert.rejects(bmsManagement.execute(session, "set-metadata", { key: "agency_name", value: "team-a" }, activeResource), /no confirmation/);
  await assert.rejects(bmsManagement.execute(session, "create", createValues), /no job ID/);
  await assert.rejects(bmsManagement.execute(session, "create", { ...createValues, billingMode: "prePaid", periodType: "month", periodNum: 1 }), /no order ID/);
});

test("inspect reports topology without raw metadata or credentials", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const outcome = await bmsManagement.execute(session, "inspect", {}, activeResource);
  assert.equal(outcome.resourceId, "bms-1");
  assert.ok(outcome.facts!.some((fact) => fact.label === "Status" && fact.value.includes("ACTIVE")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Flavor" && fact.value === "physical.s2.medium"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Billing" && fact.value === "postPaid (pay-per-use)"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "NIC port-1" && fact.value.includes("192.168.0.10")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Volume vol-1" && fact.value === "/dev/sda"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Tag env" && fact.value === "prod"));
  assert.ok(!JSON.stringify(outcome).includes("op_svc_userid"));
  assert.ok(!JSON.stringify(outcome).includes("CS2000000001"));
});

test("add-nic enforces the two-NIC and same-VPC constraints and uses the network ID", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(bmsManagement.execute(session, "add-nic", { subnet: "subnet-1" }, activeResource), /at most two NICs/);
  await assert.rejects(bmsManagement.execute(session, "add-nic", { subnet: "subnet-3" }, prepaidResource), /same VPC/);
  await assert.rejects(bmsManagement.execute(session, "add-nic", { subnet: "subnet-2" }, prepaidResource), /network ID/);
  await assert.rejects(bmsManagement.execute(session, "add-nic", { subnet: "forged-subnet" }, prepaidResource), /no longer available/);
  await assert.rejects(bmsManagement.execute(session, "add-nic", { subnet: "subnet-1", securityGroups: ["forged-sg"] }, prepaidResource), /security group is no longer available/);
  assert.equal(writes.length, 0);
  const outcome = await bmsManagement.execute(session, "add-nic", { subnet: "subnet-1", securityGroups: ["sg-2"] }, prepaidResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1/project-1/baremetalservers/bms-2/nics", method: "POST", body: { nics: [{ subnet_id: "network-1", security_groups: [{ id: "sg-2" }] }] } }]);
});

test("remove-nic keeps the last primary NIC and revalidates the port", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(bmsManagement.execute(session, "remove-nic", { port: "port-3" }, prepaidResource), /primary NIC/);
  await assert.rejects(bmsManagement.execute(session, "remove-nic", { port: "forged-port" }, activeResource), /Select a current NIC port/);
  assert.equal(writes.length, 0);
  const outcome = await bmsManagement.execute(session, "remove-nic", { port: "port-2" }, activeResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.deepEqual(writes, [{ path: "/v1/project-1/baremetalservers/bms-1/nics/delete", method: "POST", body: { nics: [{ id: "port-2" }] } }]);
  const choices = await bmsManagement.options!(session, "remove-nic", activeResource);
  assert.deepEqual(choices.ports.map((choice) => choice.value), ["port-2"]);
  assert.deepEqual((await bmsManagement.options!(session, "remove-nic", prepaidResource)).ports, []);
  assert.deepEqual(await bmsManagement.options!(session, "remove-nic"), {});
});

test("tag operations protect system tags, duplicates, and the nine-user-tag limit", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(bmsManagement.execute(session, "add-tag", { key: "__type_baremetal", value: "x" }, activeResource), /System tag/);
  await assert.rejects(bmsManagement.execute(session, "add-tag", { key: "env", value: "stage" }, activeResource), /already exists/);
  await assert.rejects(bmsManagement.execute(session, "remove-tag", { tag: "__type_baremetal" }, activeResource), /Select a current user tag/);
  await assert.rejects(bmsManagement.execute(session, "remove-tag", { tag: "ghost" }, activeResource), /Select a current user tag/);
  assert.equal(writes.length, 0);
  await bmsManagement.execute(session, "add-tag", { key: "agency_name", value: "team-a" }, activeResource);
  await bmsManagement.execute(session, "remove-tag", { tag: "env" }, activeResource);
  assert.deepEqual(writes, [
    { path: "/v1/project-1/baremetalservers/bms-1/tags/action", method: "POST", body: { action: "create", tags: [{ key: "agency_name", value: "team-a" }] } },
    { path: "/v1/project-1/baremetalservers/bms-1/tags/action", method: "POST", body: { action: "delete", tags: [{ key: "env" }] } },
  ]);
  const choices = await bmsManagement.options!(session, "remove-tag", activeResource);
  assert.deepEqual(choices.tags.map((choice) => choice.value), ["env"]);
});

test("a server already carrying nine user tags refuses another one", async (t) => {
  const writes = mockCloud(t, { tags: [{ key: "__type_baremetal", value: "physical.s2.medium" }, ...Array.from({ length: 9 }, (_, index) => ({ key: `tag-${index}`, value: "v" }))] });
  await assert.rejects(bmsManagement.execute(session, "add-tag", { key: "extra", value: "v" }, activeResource), /nine user tags/);
  assert.equal(writes.length, 0);
});

test("metadata updates block system keys and verify the echoed acknowledgment", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(bmsManagement.execute(session, "set-metadata", { key: "chargingMode", value: "0" }, activeResource), /System metadata/);
  await assert.rejects(bmsManagement.execute(session, "set-metadata", { key: "metering.order_id", value: "x" }, activeResource), /System metadata/);
  await assert.rejects(bmsManagement.execute(session, "set-metadata", { key: "__bms_support_evs", value: "true" }, activeResource), /System metadata/);
  assert.equal(writes.length, 0);
  const outcome = await bmsManagement.execute(session, "set-metadata", { key: "agency_name", value: "bms-delegate" }, activeResource);
  assert.equal(outcome.resourceId, "bms-1");
  assert.deepEqual(writes, [{ path: "/v1/project-1/baremetalservers/bms-1/metadata", method: "POST", body: { metadata: { agency_name: "bms-delegate" } } }]);
});

test("deletion is inactive-only, refuses prepaid and unverified billing, and retains disks and IPs by default", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(bmsManagement.execute(session, "delete", {}, activeResource), /Only stopped/);
  await assert.rejects(bmsManagement.execute(session, "delete", {}, prepaidResource), /subscription cancellation/);
  await assert.rejects(bmsManagement.execute(session, "delete", {}, unverifiedResource), /billing mode could not be verified/);
  assert.equal(writes.length, 0);
  const outcome = await bmsManagement.execute(session, "delete", {}, postpaidStoppedResource);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1/project-1/baremetalservers/delete", method: "POST", body: { servers: [{ id: "bms-4" }], delete_publicip: false, delete_volume: false } }]);
  const deleteOperation = bmsManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(deleteOperation.confirmation, true);
  assert.deepEqual(deleteOperation.allowedStatuses, ["SHUTOFF"]);
  assert.ok(deleteOperation.impact);
});

test("job polling maps native BMS states and surfaces the provisioned server", async (t) => {
  const replies = [
    { job_id: "cloud-job", status: "SUCCESS", entities: { server_id: "bms-new" } },
    { job_id: "cloud-job", status: "FAIL", fail_reason: "Insufficient quota", entities: { server_id: "bms-1" } },
    { job_id: "cloud-job", status: "RUNNING", entities: { server_id: "bms-1" } },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname, "/v1/project-1/jobs/cloud-job"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "bms", operation: "Create server", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job" };
  const succeeded = await bmsManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "bms-new");
  const failed = await bmsManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /cloud job failed/);
  const running = await bmsManagement.poll!(session, entry);
  assert.equal(running.state, "submitted");
});

test("BMS native jobs must match the stored job and server membership", async (t) => {
  let wrongJob = true;
  t.mock.method(globalThis, "fetch", async () => Response.json({ job_id: wrongJob ? "other-job" : "cloud-job", status: "SUCCESS", entities: { server_id: "bms-9" } }));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "bms", operation: "Stop server", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job", resourceId: "bms-1" };
  await assert.rejects(bmsManagement.poll!(session, entry), /different BMS job/);
  wrongJob = false;
  await assert.rejects(bmsManagement.poll!(session, entry), /does not belong/);
});

test("job membership accepts the sub-job server entity but fails closed without one", async (t) => {
  let withSubJob = true;
  t.mock.method(globalThis, "fetch", async () => Response.json(withSubJob
    ? { job_id: "cloud-job", status: "SUCCESS", entities: { sub_jobs_total: 1, sub_jobs: [{ job_id: "sub-1", status: "SUCCESS", entities: { server_id: "bms-1" } }] } }
    : { job_id: "cloud-job", status: "RUNNING", entities: {} }));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "bms", operation: "Delete server", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job", resourceId: "bms-1" };
  const succeeded = await bmsManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "bms-1");
  withSubJob = false;
  await assert.rejects(bmsManagement.poll!(session, entry), /does not belong/);
});

test("outcomes and rejection errors never expose the administrator password", async (t) => {
  const writes = mockCloud(t);
  const weak = "alllowercase9";
  await assert.rejects(bmsManagement.execute(session, "create", { ...createValues, authentication: "password", password: weak }), (error: Error) => !error.message.includes(weak));
  const secret = "Str0ngPass!1";
  const outcome = await bmsManagement.execute(session, "create", { ...createValues, authentication: "password", password: secret });
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal((writes.at(-1)?.body as { server: { adminPass: string } }).server.adminPass, secret);
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(bmsManagement.execute(session, "attach-eip", {}, activeResource), /Unsupported BMS operation/);
  await assert.rejects(bmsManagement.execute(session, "rename", { name: "Renamed" }), /Select a bare metal server/);
  assert.equal(writes.length, 0);
});


test("All BMS writes reject unknown tasks, locks, and foreign project identity", async t => {
  for (const server of [{ "OS-EXT-STS:task_state": "rebuilding" }, { "OS-EXT-STS:task_state": undefined }, { locked: true }, { locked: undefined }, { tenant_id: "foreign-project" }]) {
    const writes = mockCloud(t, { server });
    for (const operation of ["rename", "start", "stop", "reboot", "add-tag", "remove-tag", "set-metadata", "add-nic", "remove-nic", "delete"]) {
      await assert.rejects(bmsManagement.execute(session, operation, { name: "Safe", key: "agency_name", value: "agency", port: "port-2" }, activeResource), /verified|does not allow|current task/);
    }
    assert.equal(writes.length, 0);
  }
});

test("NIC deletion rejects primary ports even when another NIC remains", async t => {
  const writes = mockCloud(t);
  await assert.rejects(bmsManagement.execute(session, "remove-nic", { port: "port-1" }, activeResource), /primary NIC cannot be removed/);
  assert.equal(writes.length, 0);
});

test("NIC deletion rejects missing primary status and changed port ownership", async t => {
  for (const port of [{ "binding:vif_details": {} }, { device_id: "foreign-server" }, { tenant_id: "foreign-project" }, { network_id: "foreign-network" }, { id: "foreign-port" }]) {
    const writes = mockCloud(t, { port });
    await assert.rejects(bmsManagement.execute(session, "remove-nic", { port: "port-2" }, activeResource), /could not be verified/);
    assert.equal(writes.length, 0);
  }
});

test("Unknown quota usage and flavor sale state never fall back to availability", async t => {
  for (const limits of [{ maxTotalInstances: 10 }, { maxTotalInstances: 10, totalInstancesUsed: null }, { maxTotalInstances: 10, totalInstancesUsed: -1 }]) {
    const writes = mockCloud(t, { limits });
    await assert.rejects(bmsManagement.execute(session, "create", createValues), /quota usage could not be verified/);
    assert.equal(writes.length, 0);
  }
  const writes = mockCloud(t, { flavors: [{ ...flavors[0], os_extra_specs: { ...flavors[0].os_extra_specs, "cond:operation:status": undefined } }] });
  await assert.rejects(bmsManagement.execute(session, "create", createValues), /no longer on sale/);
  assert.equal(writes.length, 0);
});

test("Native HTTP 200 errors and private job faults are never echoed or acknowledged", async t => {
  const secret = "PRIVATE_PASSWORD_HOST_CONFIG";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => init.method ? Response.json({ error: { code: "BMS.failed", message: secret } }) : Response.json(read(new URL(input))));
  await assert.rejects(bmsManagement.execute(session, "add-tag", { key: "stage", value: "prod" }, activeResource), error => error instanceof Error && /Huawei rejected/.test(error.message) && !error.message.includes(secret));
  t.mock.method(globalThis, "fetch", async () => Response.json({ job_id: "cloud-job", status: "FAIL", fail_reason: secret, entities: { server_id: "bms-1" } }));
  const result = await bmsManagement.poll!(session, { id: randomUUID(), service: "bms", operation: "stop", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job", resourceId: "bms-1" });
  assert.equal(result.state, "failed");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("A completed creation job requires a native server identity", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ job_id: "cloud-job", status: "SUCCESS", entities: {} }));
  await assert.rejects(bmsManagement.poll!(session, { id: randomUUID(), service: "bms", operation: "create", startedAt: new Date().toISOString(), state: "submitted", jobId: "cloud-job" }), /created server identity/);
});


test("Existing BMS NIC security groups change through the verified native VPC port", async t => {
  const writes = mockCloud(t);
  const choices = await bmsManagement.options!(session, "security-groups", activeResource);
  assert.deepEqual(choices.ports.map(choice => choice.value), ["port-1", "port-2"]);
  await bmsManagement.execute(session, "security-groups", { port: "port-1", securityGroups: ["sg-2"] }, activeResource);
  assert.deepEqual(writes, [{ method: "PUT", path: "/v1/project-1/ports/port-1", body: { port: { security_groups: ["sg-2"] } } }]);
  await assert.rejects(bmsManagement.execute(session, "security-groups", { port: "port-2", securityGroups: ["foreign"] }, activeResource), /current security groups/);
  await assert.rejects(bmsManagement.execute(session, "security-groups", { port: "foreign", securityGroups: ["sg-2"] }, activeResource), /current NIC port/);
  assert.equal(writes.length, 1);
});

test("A foreign security group acknowledgement remains uncertain", async t => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => init.method ? Response.json({ port: { id: "foreign", security_groups: ["sg-2"] } }) : Response.json(read(new URL(input))));
  await assert.rejects(bmsManagement.execute(session, "security-groups", { port: "port-2", securityGroups: ["sg-2"] }, activeResource), /no matching confirmation/);
});


test("Transport failures preserve uncertainty classification without leaking returned credentials", async t => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => init.method ? Response.json({ error: { message: "PRIVATE_PASSWORD_CONFIG" } }, { status: 503 }) : Response.json(read(new URL(input))));
  await assert.rejects(bmsManagement.execute(session, "create", { ...createValues, authentication: "password", password: "Str0ngPass!1" }), error => error instanceof Error && "status" in error && error.status === 503 && !error.message.includes("PRIVATE_PASSWORD_CONFIG"));
});


test("Native enterprise and type tags are protected alongside double-underscore tags", async t => {
  const writes = mockCloud(t, { tags: [{ key: "_sys_enterprise_project_id", value: "0" }, { key: "_type_baremetal", value: "bms" }, { key: "team", value: "ops" }] });
  for (const key of ["_sys_enterprise_project_id", "_type_baremetal", "__type_baremetal"]) {
    await assert.rejects(bmsManagement.execute(session, "add-tag", { key, value: "x" }, activeResource), /System tag/);
    await assert.rejects(bmsManagement.execute(session, "remove-tag", { tag: key }, activeResource), /current user tag/);
  }
  assert.deepEqual((await bmsManagement.options!(session, "remove-tag", activeResource)).tags.map(choice => choice.value), ["team"]);
  assert.equal(writes.length, 0);
});
