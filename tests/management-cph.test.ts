import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { cphManagement } from "@/lib/huawei/management/adapters/cph";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const serverOne = { server_id: "srv-1", server_name: "Server One", status: 5, availability_zone: "az-1", server_model_name: "physical.rx1.xlarge", phone_model_name: "cloudphone1.xlarge.1", keypair_name: "kp-1", vpc_id: "vpc-1", cidr: "192.168.0.0/24", vpc_cidr: "192.168.0.0/24", subnet_id: "subnet-1", subnet_cidr: "192.168.0.0/24", addresses: [{ server_ip: "192.168.0.1", public_ip: "203.0.113.10" }], metadata: { product_id: "prod-1", order_id: "order-1", charging_mode: 0 }, network_version: "v2", enterprise_project_id: "0", create_time: "2026-01-01T00:00:00Z", update_time: "2026-01-02T00:00:00Z" };
const serverTwo = { ...serverOne, server_id: "srv-2", server_name: "Server Two", metadata: { product_id: "prod-2", order_id: "order-2", charging_mode: 1 }, network_version: "v1", addresses: [{ server_ip: "192.168.0.2", public_ip: "" }] };
const serverFrozen = { ...serverOne, server_id: "srv-3", server_name: "Server Frozen", status: 8, metadata: { charging_mode: 1 }, network_version: "v1" };
const serverStopped = { ...serverOne, server_id: "srv-4", server_name: "Server Stopped", status: 10, metadata: { charging_mode: 1 }, network_version: "v1" };
const servers = [serverOne, serverTwo, serverFrozen, serverStopped];
const bandwidthTwo = [{ band_width_id: "bw-1", band_width_name: "Server Two bandwidth", band_width_size: 10, band_width_charge_mode: 0, band_width_share_type: 0 }];
const bandwidthShared = [{ band_width_id: "bw-2", band_width_name: "Shared", band_width_size: 50, band_width_charge_mode: 0, band_width_share_type: 1 }];
const phoneOne = { phone_id: "ph-1", phone_name: "Phone One", server_id: "srv-1", phone_model_name: "cloudphone1.xlarge.1", image_id: "img-1", image_version: "Android 9.0", status: 2, type: 0, traffic_type: "direct", volume_mode: 1, availability_zone: "az-1", has_encrypt: false, imei: "860000000000001", create_time: "2026-01-01T00:00:00Z", update_time: "2026-01-02T00:00:00Z" };
const phoneTwo = { ...phoneOne, phone_id: "ph-2", phone_name: "Phone Two", status: 8 };
const phoneFrozen = { ...phoneOne, phone_id: "ph-3", phone_name: "Phone Frozen", server_id: "srv-2", status: 6 };
const phoneOrphan = { ...phoneOne, phone_id: "ph-4", phone_name: "Phone Orphan", server_id: "srv-gone" };
const phones = [phoneOne, phoneTwo, phoneFrozen, phoneOrphan];
const phoneOneDetail = { ...phoneOne, access_infos: [{ type: "ADB", server_ip: "192.168.0.1", public_ip: "203.0.113.10", access_port: 7443 }], property: "{\"phone.token\":\"property-secret-123\"}", custom_property: { user_data: "custom-secret-456" }, phone_data_volume: { volume_type: "GPSSD", volume_size: 10 }, metadata: { order_id: "order-1", product_id: "prod-1" } };
const phoneModels = [
  { server_model_name: "physical.rx1.xlarge", phone_model_name: "cloudphone1.xlarge.1", status: 1, cpu: 2, memory: 4096, disk: 10, resolution: "720x1280", spec_code: "cph.cloudphone1", phone_capacity: 60, phone_model_version: 1, image_label: "cloud_phone", product_type: 0 },
  { server_model_name: "physical.rx1.xlarge", phone_model_name: "cloudphone1.xlarge.2", status: 0, phone_capacity: 60, phone_model_version: 1, image_label: "cloud_phone" },
  { server_model_name: "physical.kg1.4xlarge.cp", phone_model_name: "cloudphone2.xlarge.1", status: 1, phone_capacity: 120, phone_model_version: 0, image_label: "cloud_phone_1620" },
];
const offerings = [
  { available_zone: "az-1", model_name: "physical.rx1.xlarge", sell_status: "available" },
  { available_zone: "az-2", model_name: "physical.rx1.xlarge", sell_status: "sellout" },
  { available_zone: "az-1", model_name: "physical.kg1.4xlarge.cp", sell_status: "available" },
];
const phoneImages = [
  { image_id: "img-1", image_name: "Android 9", os_type: "Android", os_name: "Android 9.0", is_public: 1, image_label: "cloud_phone", is_support_encrypt: false, receive_status: 1 },
  { image_id: "img-2", image_name: "Private Image", os_type: "Android", os_name: "Android 10", is_public: 2, image_label: "cloud_phone" },
  { image_id: "img-3", image_name: "Android 9 1620", os_type: "Android", os_name: "Android 9.0", is_public: 1, image_label: "cloud_phone_1620" },
];
const keypairs = [{ keypair: { name: "kp-1" } }, { keypair: { name: "kp-2" } }];
const vpcs = [{ id: "vpc-1", name: "Vpc One", cidr: "192.168.0.0/16", status: "ACTIVE" }];
const subnets = [
  { id: "subnet-1", name: "Subnet One", cidr: "192.168.0.0/24", vpc_id: "vpc-1", neutron_network_id: "network-1", status: "ACTIVE" },
  { id: "subnet-2", name: "Subnet Two", cidr: "10.0.0.0/24", vpc_id: "vpc-9", neutron_network_id: "network-9", status: "ACTIVE" },
];

function read(url: URL): Record<string, unknown> {
  const path = url.pathname;
  if (path === "/v1/project-1/cloud-phone/servers") {
    const offset = Number(url.searchParams.get("offset") ?? "0");
    return { request_id: "req-list", servers: servers.slice(offset, offset + 100), count: servers.length };
  }
  if (path === "/v1/project-1/cloud-phone/phones") {
    const offset = Number(url.searchParams.get("offset") ?? "0");
    return { request_id: "req-list", phones: phones.slice(offset, offset + 100), count: phones.length };
  }
  if (path.startsWith("/v1/project-1/cloud-phone/servers/")) {
    const id = path.slice("/v1/project-1/cloud-phone/servers/".length);
    const server = servers.find((row) => row.server_id === id);
    if (!server) return {};
    return { ...server, ...(id === "srv-2" ? { band_widths: bandwidthTwo } : id === "srv-4" ? { band_widths: bandwidthShared } : {}) };
  }
  if (path.startsWith("/v1/project-1/cloud-phone/phones/")) {
    const id = path.slice("/v1/project-1/cloud-phone/phones/".length);
    return id === "ph-1" ? phoneOneDetail : { ...(phones.find((row) => row.phone_id === id) ?? {}) };
  }
  if (path === "/v1/project-1/cloud-phone/phone-models") {
    const offset = Number(url.searchParams.get("offset") ?? "0");
    return { request_id: "req-models", phone_models: phoneModels.slice(offset, offset + 100) };
  }
  if (path === "/v1/project-1/server-model-offerings") return { request_id: "req-offerings", models: offerings, count: offerings.length, page_info: { next_marker: "" } };
  if (path === "/v1/project-1/cloud-phone/phone-images") return { request_id: "req-images", phone_images: phoneImages, page_info: { next_marker: "" } };
  if (path === "/v2.1/project-1/os-keypairs") return { keypairs };
  if (path === "/v3/project-1/vpc/vpcs") return { vpcs };
  if (path === "/v1/project-1/subnets") return { subnets };
  throw new Error(`Unexpected GET ${path}`);
}

function writeResponse(path: string, method: string, body?: Record<string, unknown>): Record<string, unknown> {
  if (path === "/v2/project-1/cloud-phone/servers") return method === "POST"
    ? { request_id: "req-order", order_id: "CS21010100000001", product_id: "prod-1", server_ids: [] as string[] }
    : { request_id: "req-delete", job_id: "job-delete" };
  if (path === "/v1/project-1/cloud-phone/servers/batch-restart") return { request_id: "req-restart", jobs: [{ server_id: (body?.server_ids as string[] | undefined)?.[0], job_id: "job-server-restart" }] };
  if (path === "/v1/project-1/cloud-phone/servers/open-access") return { request_id: "req-keypair", jobs: [{ server_id: ((body?.servers as Record<string, unknown>[] | undefined)?.[0] ?? {}).server_id, job_id: "job-keypair" }] };
  if (path === "/v1/project-1/cloud-phone/phones/batch-restart") return { request_id: "req-phone-restart", jobs: [{ phone_id: ((body?.phones as Record<string, unknown>[] | undefined)?.[0] ?? {}).phone_id, job_id: "job-phone-restart" }] };
  if (path === "/v1/project-1/cloud-phone/phones/batch-stop") return { request_id: "req-phone-stop", jobs: [{ phone_id: (body?.phone_ids as string[] | undefined)?.[0], job_id: "job-phone-stop" }] };
  if (path === "/v1/project-1/cloud-phone/phones/batch-reset") return { request_id: "req-phone-reset", jobs: [{ phone_id: ((body?.phones as Record<string, unknown>[] | undefined)?.[0] ?? {}).phone_id, job_id: "job-phone-reset" }] };
  if (path === "/v1/project-1/cloud-phone/phones/expand-volume") return { request_id: "req-phone-expand", jobs: [{ phone_id: ((body?.phones as Record<string, unknown>[] | undefined)?.[0] ?? {}).phone_id, job_id: "job-phone-expand" }] };
  return { request_id: "req-accepted" };
}

function mockCloud(t: TestContext, overrides: Record<string, Record<string, unknown>> = {}) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    writes.push({ path: url.pathname, method: init.method, body });
    return Response.json(overrides[`${init.method} ${url.pathname}`] ?? writeResponse(url.pathname, init.method, body));
  });
  return writes;
}

const serverResource = (id: string, name: string): ManagementResource => ({ id: `server:${id}`, name });
const phoneResource = (id: string, name: string): ManagementResource => ({ id: `phone:${id}`, name });
const offering = JSON.stringify(["physical.rx1.xlarge", "cloudphone1.xlarge.1", "az-1"]);
const createValues: ManagementValues = { name: "cph-server-order", offering, image: "img-1", count: 2, keypair: "kp-1", vpc: "vpc-1", subnet: "subnet-1", publicIpCount: 1, eipType: "5_bgp", sharedStorage: true, bandwidthSize: 10, phoneVolumeType: "GPSSD", phoneVolumeSize: 10, shareVolumeType: "SSD", shareVolumeSize: 100, periodType: "2", periodNum: 3 };

test("inventory maps servers and phones as separate resources with parent membership and billing mode", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const resources = await cphManagement.inventory(session);
  assert.deepEqual(resources.map((row) => [row.id, row.name, row.status]), [
    ["server:srv-1", "Server One", "NORMAL"],
    ["server:srv-2", "Server Two", "NORMAL"],
    ["server:srv-3", "Server Frozen", "FROZEN"],
    ["server:srv-4", "Server Stopped", "STOPPED"],
    ["phone:ph-1", "Phone One", "RUNNING"],
    ["phone:ph-2", "Phone Two", "STOPPED"],
    ["phone:ph-3", "Phone Frozen", "FROZEN"],
    ["phone:ph-4", "Phone Orphan", "RUNNING"],
  ]);
  assert.deepEqual(resources.slice(0, 4).map((row) => [row.values?.model, row.values?.chargingMode, row.values?.networkVersion]), [
    ["physical.rx1.xlarge", 0, "v2"],
    ["physical.rx1.xlarge", 1, "v1"],
    ["physical.rx1.xlarge", 1, "v1"],
    ["physical.rx1.xlarge", 1, "v1"],
  ]);
  assert.deepEqual(resources.slice(4).map((row) => row.values?.serverId), ["srv-1", "srv-1", "srv-2", "srv-gone"]);
});

test("server and phone inventory follow native offset pagination to the reported count", async (t) => {
  const serverOffsets: string[] = [];
  const phoneOffsets: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v1/project-1/cloud-phone/servers") {
      const offset = url.searchParams.get("offset") ?? "0";
      serverOffsets.push(offset);
      return Response.json({ servers: Array.from({ length: Number(offset) === 0 ? 100 : 50 }, (_, i) => ({ server_id: `srv-${Number(offset) + i}`, server_name: `S${Number(offset) + i}`, status: 5 })), count: 150 });
    }
    if (url.pathname === "/v1/project-1/cloud-phone/phones") {
      const offset = url.searchParams.get("offset") ?? "0";
      phoneOffsets.push(offset);
      return Response.json({ phones: Array.from({ length: Number(offset) === 0 ? 100 : 1 }, (_, i) => ({ phone_id: `ph-${Number(offset) + i}`, phone_name: `P${Number(offset) + i}`, server_id: "srv-0", status: 2 })), count: 101 });
    }
    throw new Error(`Unexpected GET ${url.pathname}`);
  });
  const resources = await cphManagement.inventory(session);
  assert.equal(resources.length, 251);
  assert.deepEqual(serverOffsets, ["0", "100"]);
  assert.deepEqual(phoneOffsets, ["0", "100"]);
});

test("create options whitelist on-sale offerings, live phone models, public images, key pairs, and networks", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await cphManagement.options!(session, "create-server");
  assert.deepEqual(choices.offerings.map((choice) => choice.value), [offering, JSON.stringify(["physical.kg1.4xlarge.cp", "cloudphone2.xlarge.1", "az-1"])]);
  assert.ok(choices.offerings.every((choice) => !choice.value.includes("az-2") && !choice.value.includes("cloudphone1.xlarge.2")));
  assert.deepEqual(choices.images.map((choice) => choice.value), ["img-1", "img-3"]);
  assert.deepEqual(choices.keypairs.map((choice) => choice.value), ["kp-1", "kp-2"]);
  assert.deepEqual(choices.vpcs.map((choice) => choice.value), ["vpc-1"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual((await cphManagement.options!(session, "reset-phone", phoneResource("ph-1", "Phone One"))).images.map((choice) => choice.value), ["img-1", "img-3"]);
  assert.deepEqual((await cphManagement.options!(session, "update-keypair", serverResource("srv-1", "Server One"))).keypairs.map((choice) => choice.value), ["kp-1", "kp-2"]);
});

test("server orders send the documented unpaid subscription body with automatic payment and renewal disabled", async (t) => {
  const writes = mockCloud(t);
  const outcome = await cphManagement.execute(session, "create-server", createValues);
  assert.match(outcome.message, /CS21010100000001/);
  assert.match(outcome.message, /Automatic payment and renewal are disabled/);
  assert.match(outcome.message, /only after the order is paid/);
  assert.equal(outcome.jobId, undefined);
  assert.equal(outcome.asynchronous, undefined);
  await cphManagement.execute(session, "create-server", { ...createValues, publicIpCount: 0, count: 1, periodType: "3", periodNum: 2 });
  assert.deepEqual(writes, [
    { path: "/v2/project-1/cloud-phone/servers", method: "POST", body: {
      server_name: "cph-server-order", server_model_name: "physical.rx1.xlarge", phone_model_name: "cloudphone1.xlarge.1", image_id: "img-1", count: 2, keypair_name: "kp-1",
      tenant_vpc_id: "vpc-1", nics: [{ subnet_id: "subnet-1" }], public_ip: { count: 1, eip: { type: "5_bgp" } },
      band_width: { band_width_size: 10, band_width_charge_mode: 0, band_width_share_type: 0 },
      phone_data_volume: { volume_type: "GPSSD", size: 10 }, server_share_data_volume: { volume_type: "SSD", size: 100 },
      availability_zone: "az-1", extend_param: { charging_mode: 0, period_type: 2, period_num: 3, is_auto_pay: 0, is_auto_renew: 0 },
    } },
    { path: "/v2/project-1/cloud-phone/servers", method: "POST", body: {
      server_name: "cph-server-order", server_model_name: "physical.rx1.xlarge", phone_model_name: "cloudphone1.xlarge.1", image_id: "img-1", count: 1, keypair_name: "kp-1",
      tenant_vpc_id: "vpc-1", nics: [{ subnet_id: "subnet-1" }], public_ip: { count: 0 },
      band_width: { band_width_size: 10, band_width_charge_mode: 0, band_width_share_type: 0 },
      phone_data_volume: { volume_type: "GPSSD", size: 10 }, server_share_data_volume: { volume_type: "SSD", size: 100 },
      availability_zone: "az-1", extend_param: { charging_mode: 0, period_type: 3, period_num: 2, is_auto_pay: 0, is_auto_renew: 0 },
    } },
  ]);
});

test("server orders reject stale or forged selections, foreign subnets, and out-of-range billing choices before any write", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, offering: "not-json" }, /Select an available server model/],
    [{ ...createValues, offering: JSON.stringify(["physical.rx1.xlarge", "cloudphone1.xlarge.1", "az-2"]) }, /no longer on sale/],
    [{ ...createValues, offering: JSON.stringify(["physical.rx1.xlarge", "cloudphone1.xlarge.2", "az-1"]) }, /no longer available for this server model/],
    [{ ...createValues, image: "img-2" }, /public phone image/],
    [{ ...createValues, image: "img-3" }, /does not match the phone model/],
    [{ ...createValues, keypair: "forged-key" }, /key pair is no longer available/],
    [{ ...createValues, vpc: "vpc-9" }, /VPC is no longer available/],
    [{ ...createValues, subnet: "forged-subnet" }, /subnet is no longer available/],
    [{ ...createValues, subnet: "subnet-2" }, /inside the selected VPC/],
    [{ ...createValues, count: 11 }, /between 1 and 10/],
    [{ ...createValues, publicIpCount: 61 }, /capacity of 60/],
    [{ ...createValues, bandwidthSize: 2001 }, /between 1 and 2000/],
    [{ ...createValues, phoneVolumeSize: 0 }, /between 1 and 32768/],
    [{ ...createValues, shareVolumeSize: 5 }, /between 10 and 32768/],
    [{ ...createValues, periodType: "5" }, /monthly or yearly/],
    [{ ...createValues, periodNum: 10 }, /between 1 and 9/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(cphManagement.execute(session, "create-server", values), expression);
  assert.equal(writes.length, 0);
});

test("a native order rejection inside an HTTP 200 body fails closed", async (t) => {
  const writes = mockCloud(t, { "POST /v2/project-1/cloud-phone/servers": { request_id: "req-order", error_code: "CPH.5001", error_msg: "server quota exceeded" } });
  await assert.rejects(cphManagement.execute(session, "create-server", createValues), /Huawei rejected this CPH operation/);
  assert.equal(writes.length, 1);
});

test("the form contract whitelists live choices and enforces documented bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = cphManagement.operations.find((item) => item.id === "create-server")!;
  const choices = await cphManagement.options!(session, "create-server");
  const values = validateManagementValues(operation, { ...createValues, offering: choices.offerings[0].value }, choices);
  assert.equal(values.name, "cph-server-order");
  assert.throws(() => validateManagementValues(operation, { ...createValues, offering: JSON.stringify(["physical.rx1.xlarge", "cloudphone1.xlarge.1", "az-2"]) }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, image: "img-2" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, count: 0 }, choices), /at least 1/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, publicIpCount: -1 }, choices), /at least 0/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, periodType: "5" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, name: "bad name!" }, choices), /invalid format/);
  const resetOperation = cphManagement.operations.find((item) => item.id === "reset-phone")!;
  const resetChoices = await cphManagement.options!(session, "reset-phone", phoneResource("ph-1", "Phone One"));
  validateManagementValues(resetOperation, { image: "img-1", factoryReset: true }, resetChoices);
  assert.throws(() => validateManagementValues(resetOperation, { image: "img-2", factoryReset: true }, resetChoices), /not available/);
});

test("server inspection reports non-secret configuration, billing mode, and bandwidth details", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const custom = await cphManagement.execute(session, "inspect-server", {}, serverResource("srv-1", "Server One"));
  assert.ok(custom.facts!.some((fact) => fact.label === "Network" && fact.value === "Custom VPC"));
  assert.ok(custom.facts!.some((fact) => fact.label === "Billing mode" && fact.value === "Subscription"));
  assert.ok(custom.facts!.some((fact) => fact.label === "ADB key pair" && fact.value === "kp-1"));
  assert.ok(custom.facts!.some((fact) => fact.label === "Address" && fact.value.includes("203.0.113.10")));
  const system = await cphManagement.execute(session, "inspect-server", {}, serverResource("srv-2", "Server Two"));
  assert.ok(system.facts!.some((fact) => fact.label === "Network" && fact.value === "System-defined"));
  assert.ok(system.facts!.some((fact) => fact.label === "Billing mode" && fact.value === "Pay-per-use"));
  assert.ok(system.facts!.some((fact) => fact.label === "Bandwidth · Server Two bandwidth" && fact.value === "10 Mbit/s · bandwidth billing · dedicated"));
});

test("server rename uses the native contract and surfaces native rejection errors", async (t) => {
  const writes = mockCloud(t);
  const outcome = await cphManagement.execute(session, "rename-server", { name: "renamed-server" }, serverResource("srv-1", "Server One"));
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v1/project-1/cloud-phone/servers/srv-1", method: "PUT", body: { server_name: "renamed-server" } }]);
  const rejected = mockCloud(t, { "PUT /v1/project-1/cloud-phone/servers/srv-1": { request_id: "req-rename", error_code: "CPH.1001", error_msg: "name already exists" } });
  await assert.rejects(cphManagement.execute(session, "rename-server", { name: "renamed-server" }, serverResource("srv-1", "Server One")), /Huawei rejected this CPH operation/);
  assert.equal(rejected.length, 1);
});

test("server restart requires the normal state and returns the native job for this server only", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cphManagement.execute(session, "restart-server", {}, serverResource("srv-3", "Server Frozen")), /status is FROZEN/);
  assert.equal(writes.length, 0);
  const outcome = await cphManagement.execute(session, "restart-server", {}, serverResource("srv-1", "Server One"));
  assert.equal(outcome.jobId, "job-server-restart");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1/project-1/cloud-phone/servers/batch-restart", method: "POST", body: { server_ids: ["srv-1"] } }]);
  const foreign = mockCloud(t, { "POST /v1/project-1/cloud-phone/servers/batch-restart": { request_id: "req-restart", jobs: [{ server_id: "srv-9", job_id: "job-other" }] } });
  await assert.rejects(cphManagement.execute(session, "restart-server", {}, serverResource("srv-1", "Server One")), /no verifiable CPH job/);
  assert.equal(foreign.length, 1);
  const failed = mockCloud(t, { "POST /v1/project-1/cloud-phone/servers/batch-restart": { request_id: "req-restart", jobs: [{ server_id: "srv-1", error_code: "CPH.3001", error_msg: "server busy" }] } });
  await assert.rejects(cphManagement.execute(session, "restart-server", {}, serverResource("srv-1", "Server One")), /Huawei rejected this CPH operation/);
  assert.equal(failed.length, 1);
});

test("ADB key pair changes require a live key pair and return the native job", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cphManagement.execute(session, "update-keypair", { keypair: "forged-key" }, serverResource("srv-1", "Server One")), /key pair is no longer available/);
  assert.equal(writes.length, 0);
  const outcome = await cphManagement.execute(session, "update-keypair", { keypair: "kp-2" }, serverResource("srv-1", "Server One"));
  assert.equal(outcome.jobId, "job-keypair");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1/project-1/cloud-phone/servers/open-access", method: "PUT", body: { servers: [{ server_id: "srv-1", keypair_name: "kp-2" }] } }]);
});

test("dedicated bandwidth resizing is limited to system-network servers with a dedicated bandwidth", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cphManagement.execute(session, "resize-bandwidth", { size: 20 }, serverResource("srv-1", "Server One")), /system-defined network/);
  await assert.rejects(cphManagement.execute(session, "resize-bandwidth", { size: 20 }, serverResource("srv-3", "Server Frozen")), /status is FROZEN/);
  await assert.rejects(cphManagement.execute(session, "resize-bandwidth", { size: 20 }, serverResource("srv-4", "Server Stopped")), /no dedicated CPH bandwidth/);
  await assert.rejects(cphManagement.execute(session, "resize-bandwidth", { size: 10 }, serverResource("srv-2", "Server Two")), /must differ from the current size/);
  await assert.rejects(cphManagement.execute(session, "resize-bandwidth", { size: 2001 }, serverResource("srv-2", "Server Two")), /between 1 and 2000/);
  assert.equal(writes.length, 0);
  const outcome = await cphManagement.execute(session, "resize-bandwidth", { size: 20 }, serverResource("srv-2", "Server Two"));
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v1/project-1/cloud-phone/bandwidths/bw-1", method: "PUT", body: { band_width_size: 20 } }]);
});

test("server deletion is pay-per-use only and fails closed for subscription servers", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cphManagement.execute(session, "delete-server", {}, serverResource("srv-1", "Server One")), /Subscription servers cannot be deleted/);
  await assert.rejects(cphManagement.execute(session, "delete-server", {}, serverResource("srv-3", "Server Frozen")), /status is FROZEN/);
  assert.equal(writes.length, 0);
  const outcome = await cphManagement.execute(session, "delete-server", {}, serverResource("srv-4", "Server Stopped"));
  assert.equal(outcome.jobId, "job-delete");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v2/project-1/cloud-phone/servers", method: "DELETE", body: { server_ids: ["srv-4"] } }]);
  const deleteOperation = cphManagement.operations.find((item) => item.id === "delete-server")!;
  assert.equal(deleteOperation.confirmation, true);
  assert.ok(deleteOperation.impact);
});

test("server deletion fails closed when the native billing mode cannot be verified", async (t) => {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) {
      if (url.pathname === "/v1/project-1/cloud-phone/servers/srv-2") return Response.json({ ...serverTwo, metadata: {} });
      return Response.json(read(url));
    }
    writes.push({ path: url.pathname, method: init.method, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
    return Response.json(writeResponse(url.pathname, init.method));
  });
  await assert.rejects(cphManagement.execute(session, "delete-server", {}, serverResource("srv-2", "Server Two")), /billing mode could not be verified/);
  assert.equal(writes.length, 0);
});

test("phone rename, restart, and stop use their native contracts and state guards", async (t) => {
  const writes = mockCloud(t);
  const rename = await cphManagement.execute(session, "rename-phone", { name: "renamed-phone" }, phoneResource("ph-1", "Phone One"));
  assert.equal(rename.asynchronous, undefined);
  await assert.rejects(cphManagement.execute(session, "restart-phone", {}, phoneResource("ph-3", "Phone Frozen")), /status is FROZEN/);
  await assert.rejects(cphManagement.execute(session, "stop-phone", {}, phoneResource("ph-2", "Phone Two")), /status is STOPPED/);
  assert.equal(writes.length, 1);
  const restart = await cphManagement.execute(session, "restart-phone", {}, phoneResource("ph-2", "Phone Two"));
  assert.equal(restart.jobId, "job-phone-restart");
  assert.equal(restart.asynchronous, true);
  const stop = await cphManagement.execute(session, "stop-phone", {}, phoneResource("ph-1", "Phone One"));
  assert.equal(stop.jobId, "job-phone-stop");
  assert.deepEqual(writes.slice(1), [
    { path: "/v1/project-1/cloud-phone/phones/batch-restart", method: "POST", body: { phones: [{ phone_id: "ph-2" }] } },
    { path: "/v1/project-1/cloud-phone/phones/batch-stop", method: "POST", body: { phone_ids: ["ph-1"] } },
  ]);
});

test("phone reset requires a matching public image and sends the documented reset body", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cphManagement.execute(session, "reset-phone", { image: "img-1", factoryReset: false }, phoneResource("ph-3", "Phone Frozen")), /status is FROZEN/);
  await assert.rejects(cphManagement.execute(session, "reset-phone", { image: "img-2", factoryReset: false }, phoneResource("ph-1", "Phone One")), /public phone image/);
  await assert.rejects(cphManagement.execute(session, "reset-phone", { image: "img-3", factoryReset: false }, phoneResource("ph-1", "Phone One")), /does not match this phone's model/);
  assert.equal(writes.length, 0);
  await cphManagement.execute(session, "reset-phone", { image: "img-1", factoryReset: false }, phoneResource("ph-1", "Phone One"));
  const factory = await cphManagement.execute(session, "reset-phone", { image: "img-1", factoryReset: true }, phoneResource("ph-1", "Phone One"));
  assert.equal(factory.jobId, "job-phone-reset");
  assert.equal(factory.asynchronous, true);
  assert.deepEqual(writes, [
    { path: "/v1/project-1/cloud-phone/phones/batch-reset", method: "POST", body: { image_id: "img-1", phones: [{ phone_id: "ph-1" }] } },
    { path: "/v1/project-1/cloud-phone/phones/batch-reset", method: "POST", body: { image_id: "img-1", phones: [{ phone_id: "ph-1", factory_reset_enabled: true }] } },
  ]);
  const resetOperation = cphManagement.operations.find((item) => item.id === "reset-phone")!;
  assert.equal(resetOperation.confirmation, true);
  assert.match(resetOperation.impact!, /permanently erased/);
});

test("phone data volume expansion verifies the current volume and only grows", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cphManagement.execute(session, "expand-phone-storage", { size: 20 }, phoneResource("ph-3", "Phone Frozen")), /status is FROZEN/);
  await assert.rejects(cphManagement.execute(session, "expand-phone-storage", { size: 20 }, phoneResource("ph-2", "Phone Two")), /could not be verified/);
  await assert.rejects(cphManagement.execute(session, "expand-phone-storage", { size: 10 }, phoneResource("ph-1", "Phone One")), /exceed the current 10 GiB/);
  await assert.rejects(cphManagement.execute(session, "expand-phone-storage", { size: 32769 }, phoneResource("ph-1", "Phone One")), /between 1 and 32768/);
  assert.equal(writes.length, 0);
  const outcome = await cphManagement.execute(session, "expand-phone-storage", { size: 20 }, phoneResource("ph-1", "Phone One"));
  assert.equal(outcome.jobId, "job-phone-expand");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v1/project-1/cloud-phone/phones/expand-volume", method: "POST", body: { phones: [{ phone_id: "ph-1", new_size: 20 }] } }]);
});

test("phone operations require exact live parent and project membership", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cphManagement.execute(session, "restart-phone", {}, phoneResource("ph-4", "Phone Orphan")), /parent server is no longer available/);
  await assert.rejects(cphManagement.execute(session, "restart-phone", {}, phoneResource("ghost", "Ghost")), /no longer exists in this project/);
  await assert.rejects(cphManagement.execute(session, "restart-server", {}, phoneResource("ph-1", "Phone One")), /Select a current cloud phone server/);
  await assert.rejects(cphManagement.execute(session, "restart-phone", {}, serverResource("srv-1", "Server One")), /Select a current cloud phone/);
  await assert.rejects(cphManagement.execute(session, "rename-server", { name: "Ghost" }, serverResource("ghost", "Ghost")), /no longer exists in this project/);
  assert.equal(writes.length, 0);
});

test("phone inspection shows addresses and storage but never raw properties or credentials", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const outcome = await cphManagement.execute(session, "inspect-phone", {}, phoneResource("ph-1", "Phone One"));
  const serialized = JSON.stringify(outcome);
  assert.ok(outcome.facts!.some((fact) => fact.label === "Access · ADB" && fact.value === "203.0.113.10:7443"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Data volume" && fact.value === "GPSSD · 10 GiB"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Independent data volume" && fact.value === "Yes"));
  assert.ok(!serialized.includes("property-secret-123"));
  assert.ok(!serialized.includes("custom-secret-456"));
});

test("native job polling verifies job identity and the parent resource before mapping states", async (t) => {
  const replies: Record<string, unknown>[] = [
    { request_id: "req-job", job_id: "other-job", status: 2, phone_id: "ph-1" },
    { request_id: "req-job", job_id: "job-1", status: 2, phone_id: "ph-2" },
    { request_id: "req-job", job_id: "job-1", status: 2, phone_id: "ph-1" },
    { request_id: "req-job", job_id: "job-1", status: -1, phone_id: "ph-1", error_msg: "phone restart failed" },
    { request_id: "req-job", job_id: "job-1", status: 1, phone_id: "ph-1" },
    { request_id: "req-job", job_id: "job-1", status: 2, server_id: "srv-2" },
    { request_id: "req-job", job_id: "job-1", status: 2, server_id: "srv-1" },
    { request_id: "req-job", job_id: "job-1", status: 2, phone_id: "ph-1" },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    assert.equal(new URL(input).pathname, "/v1/project-1/cloud-phone/jobs/job-1");
    return Response.json(replies[index++]);
  });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "cph", operation: "Restart phone", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-1", resourceId: "phone:ph-1" };
  await assert.rejects(cphManagement.poll!(session, entry), /different CPH job/);
  await assert.rejects(cphManagement.poll!(session, entry), /does not belong to this cloud phone/);
  assert.deepEqual(await cphManagement.poll!(session, entry), { state: "succeeded", message: "The CPH cloud job completed successfully." });
  const failed = await cphManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /CPH cloud job failed/);
  assert.equal((await cphManagement.poll!(session, entry)).state, "submitted");
  const serverEntry: ManagementHistoryEntry = { ...entry, operation: "Restart server", resourceId: "server:srv-1" };
  await assert.rejects(cphManagement.poll!(session, serverEntry), /does not belong to this cloud phone server/);
  assert.equal((await cphManagement.poll!(session, serverEntry)).state, "succeeded");
  const orphanEntry: ManagementHistoryEntry = { ...entry, resourceId: undefined };
  await assert.rejects(cphManagement.poll!(session, orphanEntry), /no verifiable parent/);
  assert.equal((await cphManagement.poll!(session, { ...entry, jobId: undefined })).state, "failed");
});

test("native server job polling accepts the matching server parent", async (t) => {
  let status = 1;
  t.mock.method(globalThis, "fetch", async () => Response.json({ request_id: "req-job", job_id: "job-delete", status, server_id: "srv-4", error_msg: status === -1 ? "deletion failed" : "" }));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "cph", operation: "Delete pay-per-use server", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-delete", resourceId: "server:srv-4" };
  assert.equal((await cphManagement.poll!(session, entry)).state, "submitted");
  status = -1;
  const failed = await cphManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /CPH cloud job failed/);
  status = 2;
  assert.equal((await cphManagement.poll!(session, entry)).state, "succeeded");
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cphManagement.execute(session, "install-apk", {}, phoneResource("ph-1", "Phone One")), /Unsupported Cloud Phone operation/);
  await assert.rejects(cphManagement.execute(session, "run-shell-command", {}, serverResource("srv-1", "Server One")), /Unsupported Cloud Phone operation/);
  assert.equal(writes.length, 0);
});

function mockReadOverride(t: TestContext, transform: (url: URL, body: Record<string, unknown>) => Record<string, unknown>) {
  const writes: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(transform(url, read(url)));
    writes.push(`${init.method} ${url.pathname}`);
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    return Response.json(writeResponse(url.pathname, init.method, body));
  });
  return writes;
}

test("fresh server state blocks all mutations even when inventory previously said normal", async t => {
  const writes = mockReadOverride(t, (url, body) => url.pathname === "/v1/project-1/cloud-phone/servers/srv-1" ? { ...body, status: 13 } : body);
  for (const [operation, values] of [["rename-server", { name: "new-name" }], ["restart-server", {}], ["update-keypair", { keypair: "kp-2" }], ["delete-server", {}]] as [string, ManagementValues][]) {
    await assert.rejects(cphManagement.execute(session, operation, values, serverResource("srv-1", "Server One")), /status is STARTING/);
  }
  assert.deepEqual(writes, []);
});

test("server-wide operations block when any phone is busy or has an unknown state", async t => {
  const writes = mockReadOverride(t, (url, body) => url.pathname === "/v1/project-1/cloud-phone/phones" ? { ...body, phones: [...phones, { ...phoneOne, phone_id: "busy-phone", status: 4 }] } : body);
  for (const [operation, values] of [["restart-server", {}], ["update-keypair", { keypair: "kp-2" }]] as [string, ManagementValues][]) {
    await assert.rejects(cphManagement.execute(session, operation, values, serverResource("srv-1", "Server One")), /child phone status is REBOOTING/);
  }
  assert.deepEqual(writes, []);
});

test("deletion checks every phone on the server before submitting", async t => {
  const writes = mockReadOverride(t, (url, body) => url.pathname === "/v1/project-1/cloud-phone/phones" ? { ...body, count: 1, phones: [{ ...phoneOne, server_id: "srv-4", status: 999 }] } : body);
  await assert.rejects(cphManagement.execute(session, "delete-server", {}, serverResource("srv-4", "Server Stopped")), /child phone status is UNKNOWN/);
  assert.deepEqual(writes, []);
});

test("phone mutations verify fresh detail and its parent server identity", async t => {
  let scenario = "parent";
  const writes = mockReadOverride(t, (url, body) => url.pathname === "/v1/project-1/cloud-phone/phones/ph-1" ? { ...body, ...(scenario === "parent" ? { server_id: "srv-2" } : { status: 3 }) } : body);
  await assert.rejects(cphManagement.execute(session, "stop-phone", {}, phoneResource("ph-1", "Phone One")), /different parent/);
  scenario = "status";
  await assert.rejects(cphManagement.execute(session, "rename-phone", { name: "new-name" }, phoneResource("ph-1", "Phone One")), /status is RESETTING/);
  assert.deepEqual(writes, []);
});

test("malformed or duplicate native inventory cannot silently hide cloud phones", async t => {
  let invalid = [{ ...phoneOne, phone_id: "" }];
  mockReadOverride(t, (url, body) => url.pathname === "/v1/project-1/cloud-phone/phones" ? { ...body, count: invalid.length, phones: invalid } : body);
  await assert.rejects(cphManagement.inventory(session), /unverified CPH inventory/);
  invalid = [phoneOne, phoneOne];
  await assert.rejects(cphManagement.inventory(session), /unverified CPH inventory/);
  invalid = [{ ...phoneOne, server_id: "" }];
  await assert.rejects(cphManagement.inventory(session), /without a verified parent/);
});

test("orders reject unknown capacity, image labels and storage generation before charging", async t => {
  let scenario = "capacity";
  const writes = mockReadOverride(t, (url, body) => {
    if (url.pathname !== "/v1/project-1/cloud-phone/phone-models") return body;
    return { ...body, phone_models: [{ ...phoneModels[0], ...(scenario === "capacity" ? { phone_capacity: undefined } : scenario === "storage" ? { phone_model_version: undefined } : { image_label: "" }) }] };
  });
  await assert.rejects(cphManagement.execute(session, "create-server", createValues), /capacity could not be verified/);
  scenario = "storage";
  await assert.rejects(cphManagement.execute(session, "create-server", createValues), /storage specification could not be verified/);
  scenario = "label";
  await assert.rejects(cphManagement.execute(session, "create-server", createValues), /does not match/);
  assert.deepEqual(writes, []);
});

test("storage 1.0 orders omit independent and shared volumes while preserving mandatory bandwidth", async t => {
  const writes = mockCloud(t);
  await cphManagement.execute(session, "create-server", { ...createValues, offering: JSON.stringify(["physical.kg1.4xlarge.cp", "cloudphone2.xlarge.1", "az-1"]), image: "img-3", sharedStorage: false, publicIpCount: 0 });
  const body = writes[0].body as Record<string, unknown>;
  assert.equal(body.phone_data_volume, undefined);
  assert.equal(body.server_share_data_volume, undefined);
  assert.deepEqual(body.public_ip, { count: 0 });
  assert.deepEqual(body.band_width, { band_width_size: 10, band_width_charge_mode: 0, band_width_share_type: 0 });
  await assert.rejects(cphManagement.execute(session, "create-server", { ...createValues, offering: JSON.stringify(["physical.kg1.4xlarge.cp", "cloudphone2.xlarge.1", "az-1"]), image: "img-3" }), /do not support shared/);
  assert.equal(writes.length, 1);
});

test("phone rename rejects native errors and unacknowledged replies without exposing secrets", async t => {
  const path = "PUT /v1/project-1/cloud-phone/phones/ph-1";
  mockCloud(t, { [path]: { request_id: "req", error_code: "CPH.123", error_msg: "private-adb-password" } });
  await assert.rejects(cphManagement.execute(session, "rename-phone", { name: "new-name" }, phoneResource("ph-1", "Phone One")), error => {
    assert.match(String(error), /Huawei rejected this CPH operation/);
    assert.ok(!String(error).includes("private-adb-password"));
    return true;
  });
  mockCloud(t, { [path]: {} });
  await assert.rejects(cphManagement.execute(session, "rename-phone", { name: "new-name" }, phoneResource("ph-1", "Phone One")), /no verifiable CPH acknowledgement/);
});

test("transport failures preserve uncertain HTTP status while removing native secrets", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_msg: "private-keypair-material" }, { status: 503 }));
  await assert.rejects(cphManagement.inventory(session), error => {
    assert.equal((error as { status: number }).status, 503);
    assert.ok(!String(error).includes("private-keypair-material"));
    return true;
  });
});

test("native job failures never copy private error details into operation history", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ job_id: "job-secret", phone_id: "ph-1", status: -1, error_msg: "private-property-password" }));
  const outcome = await cphManagement.poll!(session, { id: randomUUID(), service: "cph", operation: "Reset phone", startedAt: new Date().toISOString(), state: "submitted", resourceId: "phone:ph-1", jobId: "job-secret" });
  assert.equal(outcome.state, "failed");
  assert.ok(!JSON.stringify(outcome).includes("private-property-password"));
});

test("RX7 with AOSP 11 rejects shared application storage before creating an order", async t => {
  const writes = mockReadOverride(t, (url, body) => {
    if (url.pathname === "/v1/project-1/server-model-offerings") return { ...body, models: [{ ...offerings[0], model_name: "physical.rx7.xlarge" }] };
    if (url.pathname === "/v1/project-1/cloud-phone/phone-models") return { ...body, phone_models: [{ ...phoneModels[0], server_model_name: "physical.rx7.xlarge" }] };
    if (url.pathname === "/v1/project-1/cloud-phone/phone-images") return { ...body, phone_images: [{ ...phoneImages[0], os_name: "AOSP 11" }] };
    return body;
  });
  await assert.rejects(cphManagement.execute(session, "create-server", { ...createValues, offering: JSON.stringify(["physical.rx7.xlarge", "cloudphone1.xlarge.1", "az-1"]) }), /do not support shared/);
  assert.deepEqual(writes, []);
});

test("frozen parents remain inspectable while phone mutations are blocked", async t => {
  const writes = mockReadOverride(t, (url, body) => url.pathname === "/v1/project-1/cloud-phone/servers/srv-1" ? { ...body, status: 8 } : body);
  assert.ok((await cphManagement.execute(session, "inspect-phone", {}, phoneResource("ph-1", "Phone One"))).facts?.length);
  await assert.rejects(cphManagement.execute(session, "restart-phone", {}, phoneResource("ph-1", "Phone One")), /parent server status is FROZEN/);
  assert.deepEqual(writes, []);
});

test("batch acknowledgements cannot substitute duplicate or foreign jobs", async t => {
  const nativeJob = { server_id: "srv-1", job_id: "job-first" };
  mockCloud(t, { "POST /v1/project-1/cloud-phone/servers/batch-restart": { request_id: "req", jobs: [nativeJob, nativeJob] } });
  await assert.rejects(cphManagement.execute(session, "restart-server", {}, serverResource("srv-1", "Server One")), /no verifiable CPH job/);
});
