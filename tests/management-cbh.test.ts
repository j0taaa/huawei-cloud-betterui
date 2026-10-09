import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { cbhManagement } from "@/lib/huawei/management/adapters/cbh";
import { ManagementInputError, validateManagementValues, type ManagementHistoryEntry, type ManagementResource } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const bastion = { name: "Bastion One", server_id: "server-1", instance_id: "12345", enterprise_project_id: "0", period_num: "1", start_time: "1760000000000", end_time: "1762600000000", created_time: "1760000000000", upgrade_time: 0, update: "NEW", bastion_version: "3.3.3", az_info: { region: "sa-brazil-1", zone: "az-1", availability_zone_display: "AZ one", slave_zone: "", slave_zone_display: "" }, status_info: { status: "ACTIVE", task_status: "NO_TASK", create_instance_status: "", instance_status: "ok", instance_description: "", fail_reason: "private-failure-detail" }, resource_info: { specification: "cbh.basic.50", order_id: "order-old", resource_id: "ecs-res-1", data_disk_size: 1, disk_resource_id: [] }, network: { vip: "192.168.0.5", web_port: "443", public_ip: "", public_id: "", private_ip: "192.168.0.10", vpc_id: "vpc-1", subnet_id: "subnet-1", security_group_id: "sg-1" }, ha_info: { ha_id: "", instance_type: "" } };
const stoppedBastion = { ...bastion, name: "Bastion Stopped", server_id: "server-2", status_info: { ...bastion.status_info, status: "SHUTOFF" } };
const busyBastion = { ...bastion, name: "Bastion Busy", server_id: "server-3", status_info: { ...bastion.status_info, task_status: "rebooting" } };
const publicBastion = { ...bastion, name: "Bastion Public", server_id: "server-4", network: { ...bastion.network, public_ip: "5.6.7.8", public_id: "eip-bound" } };
const oldBastion = { ...bastion, name: "Bastion Old", server_id: "server-5", update: "OLD" };
const scheduledBastion = { ...bastion, name: "Bastion Scheduled", server_id: "server-6", upgrade_time: 1790000000000 };
const provisionedBastion = { ...bastion, name: "Bastion New", server_id: "server-9", resource_info: { ...bastion.resource_info, order_id: "order-new", resource_id: "ecs-res-9" } };
function withoutKeys(source: Record<string, unknown>, keys: string[]) {
  const clone = structuredClone(source);
  for (const key of keys) delete clone[key];
  return clone;
}
const unknownUpgradeBastion = { ...withoutKeys(bastion, ["upgrade_time"]), name: "Bastion Unknown Upgrade", server_id: "server-7" };
const noBindingBastion = { ...bastion, name: "Bastion No Binding Report", server_id: "server-8", network: withoutKeys(bastion.network, ["public_ip", "public_id"]) };
const clones = () => [bastion, stoppedBastion, busyBastion, publicBastion, oldBastion, scheduledBastion, unknownUpgradeBastion, noBindingBastion].map((item) => structuredClone(item) as Record<string, unknown>);
const epsSession = { ...session, accountToken: "account-token" };

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function read(url: URL, instances: Record<string, unknown>[]) {
  const path = url.pathname;
  if (path === "/v2/project-1/cbs/instance/list") return { total: instances.length, instance: instances };
  if (path === "/v2/project-1/cbs/available-zone") return { availability_zone: [
    { region_id: "sa-brazil-1", id: "az-1", display_name: "AZ one", status: "Running", type: "Core" },
    { region_id: "sa-brazil-1", id: "az-internal", display_name: "AZ dedicated", status: "Running", type: "Dedicated" },
    { region_id: "sa-brazil-1", id: "az-down", display_name: "AZ down", status: "Stopped", type: "Core" },
  ] };
  if (path === "/v2/project-1/cbs/instance/specification") return { body: [
    { resource_spec_code: "cbh.basic.50", ecs_system_data_size: 40, cpu: 4, ram: 8, asset: 50, connection: 50, type: "basic", data_disk_size: 1 },
    { resource_spec_code: "cbh.enhance.50", ecs_system_data_size: 40, cpu: 8, ram: 16, asset: 100, connection: 100, type: "enhance", data_disk_size: 2 },
  ] };
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", vpc_id: "vpc-1", name: "Subnet", cidr: "192.168.0.0/24", status: "ACTIVE", neutron_network_id: "network-1" },
    { id: "subnet-2", vpc_id: "vpc-2", name: "Other", cidr: "10.0.0.0/24", status: "ACTIVE", neutron_network_id: "network-2" },
    { id: "subnet-3", vpc_id: "vpc-1", name: "Errored", cidr: "192.168.1.0/24", status: "ERROR", neutron_network_id: "network-3" },
    { id: "subnet-4", vpc_id: "vpc-3", name: "Dead VPC", cidr: "172.16.0.0/24", status: "ACTIVE", neutron_network_id: "network-4" },
  ] };
  if (path === "/v3/project-1/vpc/vpcs") return { vpcs: [
    { id: "vpc-1", name: "Main", status: "ACTIVE", cidr: "192.168.0.0/16" },
    { id: "vpc-2", name: "Other", status: "ACTIVE", cidr: "10.0.0.0/16" },
    { id: "vpc-3", name: "Inactive", status: "INACTIVE", cidr: "172.16.0.0/16" },
  ] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Bastion" }, { id: "sg-2", name: "Locked" }] };
  if (path === "/v3/project-1/eip/publicips") return { publicips: [
    { id: "eip-free", status: "DOWN", public_ip_address: "1.2.3.4", alias: "Free EIP", associate_instance_info: {} },
    { id: "eip-bound", status: "ACTIVE", public_ip_address: "5.6.7.8", alias: "Bound EIP", associate_instance_info: { instance_id: "other-server" } },
    { id: "eip-lying", status: "DOWN", public_ip_address: "9.9.9.9", alias: "Lying EIP", associate_instance_info: { instance_id: "someone-else" } },
  ] };
  if (path === "/v1.0/enterprise-projects") return { total_count: 3, enterprise_projects: [
    { id: "0", name: "default", status: 1, type: "prod" },
    { id: "eps-1", name: "Production", status: 1, type: "prod" },
    { id: "eps-2", name: "Archived", status: 2, type: "poc" },
  ] };
  throw new Error(`Unexpected CBH read ${path}`);
}

function mockReads(t: TestContext, instances: Record<string, unknown>[] = clones()) {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input), instances)));
  return instances;
}

type WriteRecord = { path: string; method: string; body?: unknown };

function mockCloud(t: TestContext, options: { writeResponse?: Record<string, unknown> | "non-json" | "network"; onWrite?: (write: WriteRecord, instances: Record<string, unknown>[], tools: { failLists: () => void }) => void } = {}) {
  const instances = clones();
  const writes: WriteRecord[] = [];
  let failLists = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) {
      if (failLists && url.pathname === "/v2/project-1/cbs/instance/list") return new Response("rejected", { status: 500 });
      return Response.json(read(url, instances));
    }
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    const write: WriteRecord = { path: url.pathname + url.search, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
    writes.push(write);
    options.onWrite?.(write, instances, { failLists: () => { failLists = true; } });
    if (options.writeResponse === "non-json") return new Response("not json", { status: 200 });
    if (options.writeResponse === "network") throw new TypeError("fetch failed");
    return Response.json(options.writeResponse ?? {});
  });
  return { writes, instances };
}

const resource = (id: string, name: string, status = "ACTIVE"): ManagementResource => ({ id, name, status });
const entry = (operation: string, resourceId?: string, jobId?: string): ManagementHistoryEntry => ({ id: randomUUID(), service: "cbh", operation, resourceId, jobId, startedAt: new Date().toISOString(), state: "submitted" });
const poll = (operation: string, resourceId?: string, jobId?: string) => cbhManagement.poll!(session, entry(operation, resourceId, jobId));
const execute = (operation: string, values: Record<string, unknown>, resource?: ManagementResource) => cbhManagement.execute!(session, operation, values as never, resource);
const createValues = { name: "Bastion-Two", specification: "cbh.basic.50", zone: "az-1", subnet: "subnet-1", securityGroup: "sg-1", password: "Str0ngPass!1", periodType: "month", periodNum: 3 };
const createSources = {
  specifications: [{ value: "cbh.basic.50", label: "Basic" }],
  zones: [{ value: "az-1", label: "AZ one" }],
  subnets: [{ value: "subnet-1", label: "Subnet" }],
  securityGroups: [{ value: "sg-1", label: "Bastion" }],
};

test("inventory maps the complete typed native list with instance and server identities", async (t) => {
  const reads: string[] = [];
  const instances = clones();
  t.mock.method(globalThis, "fetch", async (input: string) => { const url = new URL(input); reads.push(url.pathname + url.search); return Response.json(read(url, instances)); });
  const resources = await cbhManagement.inventory(session);
  assert.ok(reads.some((path) => path.startsWith("/v2/project-1/cbs/instance/list?limit=100&offset=0")));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status]), [
    ["bastion:server-1", "Bastion One", "ACTIVE"],
    ["bastion:server-2", "Bastion Stopped", "SHUTOFF"],
    ["bastion:server-3", "Bastion Busy", "ACTIVE"],
    ["bastion:server-4", "Bastion Public", "ACTIVE"],
    ["bastion:server-5", "Bastion Old", "ACTIVE"],
    ["bastion:server-6", "Bastion Scheduled", "ACTIVE"],
    ["bastion:server-7", "Bastion Unknown Upgrade", "ACTIVE"],
    ["bastion:server-8", "Bastion No Binding Report", "ACTIVE"],
  ]);
  assert.equal(resources[0].values?.instanceId, "12345");
  assert.equal(resources[0].values?.task, "NO_TASK");
  assert.equal(resources[3].values?.publicIp, "5.6.7.8");
  assert.equal(resources[7].values?.publicIp, "UNKNOWN");
});

test("inventory paginates until the native total is complete", async (t) => {
  const instances = clones().slice(0, 3);
  const pages: number[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname !== "/v2/project-1/cbs/instance/list") return Response.json(read(url, instances));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    pages.push(offset);
    return Response.json({ total: instances.length, instance: instances.slice(offset, offset + 2) });
  });
  const resources = await cbhManagement.inventory(session);
  assert.deepEqual(pages, [0, 2]);
  assert.equal(resources.length, 3);
});

test("inventory rejects unverified identities, enterprise projects, and inconsistent or false-complete pages", async (t) => {
  let instances: Record<string, unknown>[] = [];
  let listBody: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname !== "/v2/project-1/cbs/instance/list") return Response.json(read(url, instances));
    return Response.json(listBody ?? { total: instances.length, instance: instances });
  });
  const run = async (rows: Record<string, unknown>[], body?: Record<string, unknown>) => {
    instances = rows;
    listBody = body;
    return await cbhManagement.inventory(session);
  };
  await assert.rejects(run([{ ...bastion }, { ...bastion, name: "Copy" }]), /duplicate CBH instance identity/);
  await assert.rejects(run([{ ...bastion, server_id: "" }]), /unverified CBH instance identity/);
  await assert.rejects(run([{ ...bastion, name: "" }]), /without a verified name/);
  await assert.rejects(run([{ ...bastion, enterprise_project_id: null }]), /unverified enterprise project/);
  await assert.rejects(run([{ ...bastion, enterprise_project_id: "" }]), /unverified enterprise project/);
  const absent = [structuredClone(bastion) as Record<string, unknown>];
  delete absent[0].enterprise_project_id;
  assert.equal((await run(absent)).length, 1);
  await assert.rejects(run(clones().slice(0, 2), { instance: clones().slice(0, 2) }), /known numeric total/);
  await assert.rejects(run(clones().slice(0, 3), { total: 2, instance: clones().slice(0, 3) }), /more CBH instances than its reported total/);
  await assert.rejects(run(clones().slice(0, 1), { total: 1 }), /no CBH instance array/);
  await assert.rejects(run([], { total: 3, instance: [] }), /ended CBH pagination before its reported total/);
  await assert.rejects(run(clones().slice(0, 2), { total: 5, instance: clones().slice(0, 2) }), /duplicate CBH instance identity/);
});

test("inventory rejects foreign or null project fields and sign-ins without an exact selected project", async (t) => {
  let instances: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input), instances)));
  const run = async (rows: Record<string, unknown>[]) => {
    instances = rows;
    return await cbhManagement.inventory(session);
  };
  await assert.rejects(run([{ ...bastion, project_id: null }]), /exactly selected project/);
  await assert.rejects(run([{ ...bastion, project_id: "some-other-project" }]), /exactly selected project/);
  await assert.rejects(run([{ ...bastion, projectId: "" }]), /exactly selected project/);
  assert.equal((await run([{ ...bastion, project_id: "project-1" }])).length, 1);
  assert.equal((await run([structuredClone(bastion) as Record<string, unknown>])).length, 1);
  await assert.rejects(cbhManagement.inventory({ ...session, projectId: "" }), /no exactly selected Huawei project/);
});

test("create options surface live specifications, running core zones, active networks, and current enterprise projects", async (t) => {
  mockReads(t);
  const choices = await cbhManagement.options!(session, "create");
  assert.deepEqual(choices.specifications!.map((choice) => choice.value), ["cbh.basic.50", "cbh.enhance.50"]);
  assert.deepEqual(choices.zones!.map((choice) => choice.value), ["az-1"]);
  assert.deepEqual(choices.subnets!.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual(choices.securityGroups!.map((choice) => choice.value), ["sg-1", "sg-2"]);
  assert.deepEqual(choices.enterpriseProjects, []);
  const epsChoices = await cbhManagement.options!(epsSession, "create");
  assert.deepEqual(epsChoices.enterpriseProjects!.map((choice) => choice.value), ["0", "eps-1"]);
});

test("catalogs reject duplicate identities and unknown capacities, statuses, capability types, and regions", async (t) => {
  const spec = { resource_spec_code: "cbh.basic.50", ecs_system_data_size: 40, cpu: 4, ram: 8, asset: 50, connection: 50, type: "basic", data_disk_size: 1 };
  const zone = { region_id: "sa-brazil-1", id: "az-1", display_name: "AZ one", status: "Running", type: "Core" };
  const cases: Array<{ path: string; body: Record<string, unknown>; message: RegExp }> = [
    { path: "/v2/project-1/cbs/instance/specification", body: { body: [spec, { ...spec, cpu: 8 }] }, message: /duplicate CBH specification/ },
    { path: "/v2/project-1/cbs/instance/specification", body: { body: [{ ...spec, cpu: 0 }] }, message: /known positive vCPU count/ },
    { path: "/v2/project-1/cbs/instance/specification", body: { body: [{ ...spec, asset: "many" }] }, message: /known positive asset capacity/ },
    { path: "/v2/project-1/cbs/instance/specification", body: { body: [{ ...spec, type: "premium" }] }, message: /known offering type/ },
    { path: "/v2/project-1/cbs/available-zone", body: { availability_zone: [zone, { ...zone, display_name: "AZ one again" }] }, message: /duplicate CBH availability zone/ },
    { path: "/v2/project-1/cbs/available-zone", body: { availability_zone: [{ ...zone, status: "Paused" }] }, message: /without a known status/ },
    { path: "/v2/project-1/cbs/available-zone", body: { availability_zone: [{ ...zone, type: "Universal" }] }, message: /without a known capability type/ },
    { path: "/v2/project-1/cbs/available-zone", body: { availability_zone: [{ ...zone, region_id: "cn-north-4" }] }, message: /outside the selected region/ },
  ];
  for (const { path, body, message } of cases) {
    const instances = clones();
    t.mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input);
      if (url.pathname === path) return Response.json(body);
      return Response.json(read(url, instances));
    });
    await assert.rejects(cbhManagement.options!(session, "create"), message);
  }
});

test("the EIP catalog requires known statuses instead of defaulted flags", async (t) => {
  const instances = clones();
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v3/project-1/eip/publicips") return Response.json({ publicips: [{ id: "eip-mum", public_ip_address: "1.2.3.4", alias: "Mum EIP" }] });
    return Response.json(read(url, instances));
  });
  await assert.rejects(cbhManagement.options!(session, "bind-eip"), /without a known status/);
});

test("create sends the documented prepaid unpaid-order payload and verifies the order ID", async (t) => {
  const { writes } = mockCloud(t, { writeResponse: { order_id: "order-new" } });
  const outcome = await execute("create", createValues);
  assert.deepEqual(writes, [{ path: "/v2/project-1/cbs/instance", method: "POST", body: { specification: "cbh.basic.50", instance_name: "Bastion-Two", password: "Str0ngPass!1", region: "sa-brazil-1", availability_zone: "az-1", charging_mode: 0, period_type: 2, period_num: 3, is_auto_renew: 0, is_auto_pay: 0, network: { vpc_id: "vpc-1", subnet_id: "subnet-1", security_groups: [{ id: "sg-1" }] } } }]);
  assert.equal(outcome.resourceId, "order:order-new");
  assert.equal(outcome.jobId, "order-new");
  assert.equal(outcome.asynchronous, true);
  assert.match(outcome.message, /unpaid/i);
  assert.match(outcome.message, /is_auto_pay 0, is_auto_renew 0/);
  assert.match(outcome.message, /ordering conditions/);
  assert.ok(!JSON.stringify(outcome).includes("Str0ngPass!1"));
});

test("create rejects a lost order acknowledgment as an uncertain error, never a definitive failure", async (t) => {
  mockCloud(t, { writeResponse: {} });
  await assert.rejects(execute("create", createValues), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof ManagementInputError));
    return /no verified order ID/.test(error.message);
  });
});

test("create rejects unavailable selections, invalid periods, and non-compliant passwords before any write", async (t) => {
  const { writes } = mockCloud(t, { writeResponse: { order_id: "order-new" } });
  const bad = [
    { ...createValues, specification: "cbh.gone" },
    { ...createValues, zone: "az-internal" },
    { ...createValues, zone: "az-down" },
    { ...createValues, zone: "az-gone" },
    { ...createValues, subnet: "subnet-gone" },
    { ...createValues, subnet: "subnet-3" },
    { ...createValues, subnet: "subnet-4" },
    { ...createValues, securityGroup: "sg-gone" },
    { ...createValues, password: "weakpass" },
    { ...createValues, password: "AdminStr0ng!1" },
    { ...createValues, password: "NimdaStr0ng!9" },
    { ...createValues, password: "aaabbbCCC1!" },
    { ...createValues, password: "Str0ng·Pass1" },
    { ...createValues, periodNum: 10 },
    { ...createValues, periodType: "year", periodNum: 11 },
    { ...createValues, periodType: "quarterly" },
  ];
  for (const values of bad) await assert.rejects(execute("create", values));
  assert.equal(writes.length, 0);
});

test("typed create fields reject unsupported keys, invalid names, and unavailable selections", () => {
  const operation = cbhManagement.operations.find((item) => item.id === "create")!;
  assert.throws(() => validateManagementValues(operation, { ...createValues, extra: "x" }, createSources), /unsupported field/i);
  assert.throws(() => validateManagementValues(operation, { ...createValues, name: "bad name!" }, createSources), /invalid format/i);
  assert.throws(() => validateManagementValues(operation, { ...createValues, password: "" }, createSources), /required/i);
  assert.throws(() => validateManagementValues(operation, { ...createValues, enterpriseProjectId: "eps-gone" }, createSources), /not available/i);
  assert.throws(() => validateManagementValues(operation, { ...createValues, periodType: "quarterly" }, createSources), /not available/i);
  const values = validateManagementValues(operation, createValues, createSources);
  assert.equal(values.name, "Bastion-Two");
  assert.equal(values.periodNum, 3);
  assert.ok(!("enterpriseProjectId" in values));
});

test("create verifies the selected enterprise project against the current live active catalog", async (t) => {
  const { writes } = mockCloud(t, { writeResponse: { order_id: "order-new" } });
  const outcome = await cbhManagement.execute!(epsSession, "create", { ...createValues, enterpriseProjectId: "eps-1" });
  assert.equal((writes[0].body as Record<string, unknown>).enterprise_project_id, "eps-1");
  assert.match(outcome.message, /Unpaid order order-new accepted/);
  await assert.rejects(cbhManagement.execute!(epsSession, "create", { ...createValues, enterpriseProjectId: "eps-2" }), /not a current active enterprise project/);
  await assert.rejects(execute("create", { ...createValues, enterpriseProjectId: "0" }), /cannot verify enterprise projects/);
  assert.equal(writes.length, 1);
});

test("mutations require fresh owned records with verified status, idle tasks, and current names", async (t) => {
  const { writes } = mockCloud(t);
  await assert.rejects(execute("start", {}, resource("bastion:server-1", "Bastion One")), /status is ACTIVE/);
  await assert.rejects(execute("stop", {}, resource("bastion:server-2", "Bastion Stopped")), /status is SHUTOFF/);
  await assert.rejects(execute("stop", {}, resource("bastion:server-3", "Bastion Busy")), /native task \(rebooting\)/);
  await assert.rejects(execute("stop", {}, resource("bastion:server-1", "Renamed Away")), /name changed/);
  await assert.rejects(execute("stop", {}, resource("bastion:server-foreign", "Bastion One")), /not found/);
  await assert.rejects(execute("stop", {}, resource("server-1", "Bastion One")), /Select a current CBH bastion/);
  assert.equal(writes.length, 0);
});

test("missing task proof blocks writes even when the status looks active", async (t) => {
  const instances = clones();
  delete (asRecord(instances[0].status_info) as Record<string, unknown>).task_status;
  mockReads(t, instances);
  await assert.rejects(execute("stop", {}, resource("bastion:server-1", "Bastion One")), /native task/);
});

test("start, stop, and restart send native server IDs and retain the original identity", async (t) => {
  const { writes } = mockCloud(t);
  const started = await execute("start", {}, resource("bastion:server-2", "Bastion Stopped", "SHUTOFF"));
  const stopped = await execute("stop", {}, resource("bastion:server-1", "Bastion One"));
  const restarted = await execute("reboot", { rebootType: "HARD" }, resource("bastion:server-1", "Bastion One"));
  assert.deepEqual(writes, [
    { path: "/v2/project-1/cbs/instance/start", method: "POST", body: { server_id: "server-2" } },
    { path: "/v2/project-1/cbs/instance/stop", method: "POST", body: { server_id: "server-1" } },
    { path: "/v2/project-1/cbs/instance/reboot", method: "POST", body: { server_id: "server-1", reboot_type: "HARD" } },
  ]);
  assert.ok(writes.every((write) => !/login|admin-url|om-url/.test(write.path)));
  assert.equal(started.jobId, "server-2");
  assert.equal(stopped.jobId, "server-1");
  assert.equal(restarted.jobId, "server-1");
  assert.equal(started.asynchronous, true);
  assert.equal(restarted.resourceId, "bastion:server-1");
});

test("the observer verifies original identities, requires idle power states, and never guesses completion", async (t) => {
  const instances = clones();
  mockReads(t, instances);
  await assert.rejects(poll("Start instance", "bastion:server-2", "wrong"), /no verified original bastion identity/);
  await assert.rejects(poll("Start instance", "server-2", "server-2"), /no verified original bastion identity/);
  await assert.rejects(poll("Reset admin password", "bastion:server-1", "server-1"), /no asynchronous observer/);
  await assert.rejects(poll("Create bastion instance", "bastion:server-1", "server-1"), /no verified original CBH order identity/);
  const starting = await poll("Start instance", "bastion:server-2", "server-2");
  assert.equal(starting.state, "submitted");
  assert.match(starting.message!, /still SHUTOFF/);
  asRecord(instances[1]).status_info = { status: "ACTIVE", task_status: "rebooting" };
  const busy = await poll("Start instance", "bastion:server-2", "server-2");
  assert.equal(busy.state, "submitted");
  asRecord(instances[1]).status_info = { status: "ACTIVE", task_status: "NO_TASK" };
  assert.equal((await poll("Start instance", "bastion:server-2", "server-2")).state, "succeeded");
  const stopping = await poll("Stop instance", "bastion:server-1", "server-1");
  assert.equal(stopping.state, "submitted");
  assert.match(stopping.message!, /still ACTIVE/);
  asRecord(instances[0]).status_info = { status: "SHUTOFF", task_status: "NO_TASK" };
  assert.equal((await poll("Stop instance", "bastion:server-1", "server-1")).state, "succeeded");
  const rebooting = await poll("Restart instance", "bastion:server-3", "server-3");
  assert.equal(rebooting.state, "submitted");
  assert.match(rebooting.message!, /in progress/);
  const oldReady = await poll("Restart instance", "bastion:server-1", "server-1");
  assert.equal(oldReady.state, "submitted");
  assert.match(oldReady.message!, /does not prove the restart finished/);
  asRecord(instances[0]).status_info = { status: "ERROR", task_status: "NO_TASK" };
  assert.equal((await poll("Restart instance", "bastion:server-1", "server-1")).state, "failed");
  const absent = await poll("Restart instance", "bastion:server-gone", "server-gone");
  assert.equal(absent.state, "submitted");
  assert.match(absent.message!, /does not prove it was removed/);
});

test("the create observer requires a unique ready match for the original order", async (t) => {
  const instances = clones();
  mockReads(t, instances);
  const waiting = await poll("Create bastion instance", "order:order-new", "order-new");
  assert.equal(waiting.state, "submitted");
  assert.match(waiting.message!, /has not provisioned a bastion yet/);
  instances.push({ ...provisionedBastion, status_info: { status: "BUILDING", task_status: "NO_TASK" } } as Record<string, unknown>);
  const building = await poll("Create bastion instance", "order:order-new", "order-new");
  assert.equal(building.state, "submitted");
  assert.match(building.message!, /not ready yet/);
  asRecord(instances.at(-1)).status_info = { status: "WEIRDSTATE", task_status: "NO_TASK" };
  const unknown = await poll("Create bastion instance", "order:order-new", "order-new");
  assert.equal(unknown.state, "submitted");
  assert.match(unknown.message!, /UNKNOWN/);
  asRecord(instances.at(-1)).status_info = { status: "ACTIVE", task_status: "rebooting" };
  assert.equal((await poll("Create bastion instance", "order:order-new", "order-new")).state, "submitted");
  asRecord(instances.at(-1)).status_info = { status: "ERROR", task_status: "NO_TASK" };
  const failed = await poll("Create bastion instance", "order:order-new", "order-new");
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /reports a fault/);
  asRecord(instances.at(-1)).status_info = { status: "ACTIVE", task_status: "NO_TASK" };
  const provisioned = await poll("Create bastion instance", "order:order-new", "order-new");
  assert.equal(provisioned.state, "succeeded");
  assert.equal(provisioned.resourceId, "bastion:server-9");
  instances.push({ ...provisionedBastion, server_id: "server-10", name: "Bastion Clone", status_info: { status: "ACTIVE", task_status: "NO_TASK" } } as Record<string, unknown>);
  const ambiguous = await poll("Create bastion instance", "order:order-new", "order-new");
  assert.equal(ambiguous.state, "submitted");
  assert.match(ambiguous.message!, /uniquely identified/);
});

test("password reset enforces documented native rules only and never echoes secrets", async (t) => {
  const { writes } = mockCloud(t);
  await assert.rejects(execute("reset-password", { password: "Aa1******" }, resource("bastion:server-1", "Bastion One")), /consecutive identical/);
  await assert.rejects(execute("reset-password", { password: "weakpass" }, resource("bastion:server-1", "Bastion One")), /combine at least three/);
  await assert.rejects(execute("reset-password", { password: "AdminStr0ng!9" }, resource("bastion:server-1", "Bastion One")), /admin user name or its reverse/);
  await assert.rejects(execute("reset-password", { password: "NimdaStr0ng!9" }, resource("bastion:server-1", "Bastion One")), /admin user name or its reverse/);
  assert.equal(writes.length, 0);
  const outcome = await execute("reset-password", { password: "Amdinstr0ng!9" }, resource("bastion:server-1", "Bastion One"));
  assert.deepEqual(writes, [{ path: "/v2/project-1/cbs/instance/password", method: "PUT", body: { server_id: "server-1", new_password: "Amdinstr0ng!9" } }]);
  assert.ok(!JSON.stringify(outcome).includes("Amdinstr0ng!9"));
});

test("login method reset uses the native server identity", async (t) => {
  const { writes } = mockCloud(t);
  await execute("reset-login-method", {}, resource("bastion:server-1", "Bastion One"));
  assert.deepEqual(writes, [{ path: "/v2/project-1/cbs/instance/login-method", method: "PUT", body: { server_id: "server-1" } }]);
});

test("upgrade mutations require known native schedule state, real dates, and documented bounds", async (t) => {
  const { writes } = mockCloud(t);
  const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const when = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  await assert.rejects(execute("schedule-upgrade", { upgradeTime: when }, resource("bastion:server-7", "Bastion Unknown Upgrade")), /cannot be ruled out/);
  await assert.rejects(execute("cancel-upgrade", {}, resource("bastion:server-7", "Bastion Unknown Upgrade")), /cannot be confirmed/);
  await assert.rejects(execute("schedule-upgrade", { upgradeTime: "2027-02-30T00:00:00Z" }, resource("bastion:server-1", "Bastion One")), /not a real UTC calendar date/);
  await assert.rejects(execute("schedule-upgrade", { upgradeTime: soon }, resource("bastion:server-1", "Bastion One")), /at least 24 hours/);
  await assert.rejects(execute("schedule-upgrade", { upgradeTime: soon }, resource("bastion:server-5", "Bastion Old")), /latest version/);
  await assert.rejects(execute("schedule-upgrade", { upgradeTime: soon }, resource("bastion:server-6", "Bastion Scheduled")), /already scheduled/);
  await assert.rejects(execute("cancel-upgrade", {}, resource("bastion:server-1", "Bastion One")), /does not report a scheduled upgrade/);
  assert.equal(writes.length, 0);
  const accepted = await execute("schedule-upgrade", { upgradeTime: when }, resource("bastion:server-1", "Bastion One"));
  assert.match(accepted.message, /accepted, not guaranteed/);
  assert.deepEqual(writes, [{ path: "/v2/project-1/cbs/instance/upgrade", method: "POST", body: { server_id: "server-1", upgrade_time: Date.parse(when) } }]);
  const cancelAccepted = await execute("cancel-upgrade", {}, resource("bastion:server-6", "Bastion Scheduled"));
  assert.match(cancelAccepted.message, /accepted, not guaranteed/);
  assert.deepEqual(writes[1], { path: "/v2/project-1/cbs/instance/upgrade", method: "POST", body: { server_id: "server-6", upgrade_time: scheduledBastion.upgrade_time, cancel: true } });
});

test("upgrade schedule and cancellation verify from fresh records when the state converges", async (t) => {
  const when = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const whenMillis = Date.parse(when);
  const { writes, instances } = mockCloud(t, { onWrite: (write) => {
    if (write.path === "/v2/project-1/cbs/instance/upgrade" && !(write.body as Record<string, unknown>)?.cancel) asRecord(instances[0]).upgrade_time = whenMillis;
    if (write.path === "/v2/project-1/cbs/instance/upgrade" && (write.body as Record<string, unknown>)?.cancel) asRecord(instances[5]).upgrade_time = 0;
  } });
  const scheduled = await execute("schedule-upgrade", { upgradeTime: when }, resource("bastion:server-1", "Bastion One"));
  assert.match(scheduled.message, /verified from the bastion record/);
  const canceled = await execute("cancel-upgrade", {}, resource("bastion:server-6", "Bastion Scheduled"));
  assert.match(canceled.message, /verified from the bastion record|reports no upgrade scheduled/);
  assert.equal(writes.length, 2);
});

test("EIP binding requires a proven unbound owned EIP and a currently unbound bastion", async (t) => {
  mockReads(t);
  const choices = await cbhManagement.options!(session, "bind-eip");
  assert.deepEqual(choices.eips!.map((choice) => choice.value), ["eip-free"]);
  await assert.rejects(execute("bind-eip", { eip: "eip-free" }, resource("bastion:server-4", "Bastion Public")), /already reports a public IP/);
  await assert.rejects(execute("bind-eip", { eip: "eip-bound" }, resource("bastion:server-1", "Bastion One")), /not a verified unbound EIP/);
  await assert.rejects(execute("bind-eip", { eip: "eip-lying" }, resource("bastion:server-1", "Bastion One")), /not a verified unbound EIP/);
  await assert.rejects(execute("bind-eip", { eip: "eip-gone" }, resource("bastion:server-1", "Bastion One")), /not a verified unbound EIP/);
  await assert.rejects(execute("bind-eip", { eip: "eip-free" }, resource("bastion:server-8", "Bastion No Binding Report")), /not reported/);
  await assert.rejects(execute("unbind-eip", {}, resource("bastion:server-1", "Bastion One")), /has no public IP bound/);
  await assert.rejects(execute("unbind-eip", {}, resource("bastion:server-8", "Bastion No Binding Report")), /not reported/);
});

test("EIP bind and unbind send the fresh current public IP identity and verify the effect", async (t) => {
  const { writes, instances } = mockCloud(t, { onWrite: (write) => {
    if (write.path.endsWith("/server-1/eip/bind")) asRecord(instances[0]).network = { ...bastion.network, public_ip: "1.2.3.4", public_id: "eip-free" };
    if (write.path.endsWith("/server-4/eip/unbind")) asRecord(instances[3]).network = { ...bastion.network, public_ip: "", public_id: "" };
  } });
  const bound = await execute("bind-eip", { eip: "eip-free" }, resource("bastion:server-1", "Bastion One"));
  assert.match(bound.message, /is bound to the bastion/);
  const unbound = await execute("unbind-eip", {}, resource("bastion:server-4", "Bastion Public"));
  assert.match(unbound.message, /was unbound from the bastion/);
  assert.deepEqual(writes.map((write) => [write.path, write.body]), [
    ["/v2/project-1/cbs/instance/server-1/eip/bind", { publicip_id: "eip-free" }],
    ["/v2/project-1/cbs/instance/server-4/eip/unbind", { publicip_id: "eip-bound" }],
  ]);
});

test("unbind never reports verified success from a missing instance, unknown fields, or failed verification reads", async (t) => {
  mockCloud(t);
  const stillBound = await execute("unbind-eip", {}, resource("bastion:server-4", "Bastion Public"));
  assert.match(stillBound.message, /not yet verified/);
  assert.ok(!/was unbound from the bastion/.test(stillBound.message));
  mockCloud(t, { onWrite: (write, rows) => { if (write.path.endsWith("/server-4/eip/unbind")) rows.splice(3, 1); } });
  const missing = await execute("unbind-eip", {}, resource("bastion:server-4", "Bastion Public"));
  assert.match(missing.message, /not yet verified/);
  assert.ok(!/was unbound/.test(missing.message));
  assert.equal(missing.resourceId, "bastion:server-4");
  mockCloud(t, { onWrite: (write, rows) => {
    if (write.path.endsWith("/server-4/eip/unbind")) asRecord(rows[3]).network = withoutKeys(bastion.network, ["public_id"]);
  } });
  const unknownFields = await execute("unbind-eip", {}, resource("bastion:server-4", "Bastion Public"));
  assert.match(unknownFields.message, /not yet verified/);
  assert.ok(!/was unbound/.test(unknownFields.message));
  mockCloud(t, { onWrite: (write, rows, tools) => { if (write.path.endsWith("/server-4/eip/unbind")) tools.failLists(); } });
  const failedRead = await execute("unbind-eip", {}, resource("bastion:server-4", "Bastion Public"));
  assert.match(failedRead.message, /not yet verified/);
  assert.equal(failedRead.resourceId, "bastion:server-4");
});

test("security group and VPC changes verify fresh ownership and reject no-op or inactive moves", async (t) => {
  const { writes, instances } = mockCloud(t, { onWrite: (write) => {
    if (write.path.endsWith("/server-1/security-groups")) asRecord(instances[0]).network = { ...bastion.network, security_group_id: "sg-2" };
    if (write.path === "/v2/project-1/cbs/instance/vpc") asRecord(instances[0]).network = { ...bastion.network, vpc_id: "vpc-2", subnet_id: "subnet-2", security_group_id: "sg-2" };
  } });
  await assert.rejects(execute("change-security-group", { securityGroup: "sg-1" }, resource("bastion:server-1", "Bastion One")), /already uses/);
  await assert.rejects(execute("change-security-group", { securityGroup: "sg-gone" }, resource("bastion:server-1", "Bastion One")), /no longer available/);
  await assert.rejects(execute("switch-vpc", { subnet: "subnet-1", securityGroup: "sg-2" }, resource("bastion:server-1", "Bastion One")), /already uses this VPC/);
  await assert.rejects(execute("switch-vpc", { subnet: "subnet-gone", securityGroup: "sg-2" }, resource("bastion:server-1", "Bastion One")), /no longer available/);
  await assert.rejects(execute("switch-vpc", { subnet: "subnet-3", securityGroup: "sg-2" }, resource("bastion:server-1", "Bastion One")), /selected subnet is not currently active/);
  await assert.rejects(execute("switch-vpc", { subnet: "subnet-4", securityGroup: "sg-2" }, resource("bastion:server-1", "Bastion One")), /VPC of the selected subnet is not currently active/);
  assert.equal(writes.length, 0);
  const group = await execute("change-security-group", { securityGroup: "sg-2" }, resource("bastion:server-1", "Bastion One"));
  assert.match(group.message, /now uses the selected security group/);
  const moved = await execute("switch-vpc", { subnet: "subnet-2", securityGroup: "sg-2" }, resource("bastion:server-1", "Bastion One"));
  assert.match(moved.message, /now uses the selected VPC, subnet, and security group/);
  assert.deepEqual(writes, [
    { path: "/v2/project-1/cbs/instance/server-1/security-groups", method: "PUT", body: { security_groups: ["sg-2"] } },
    { path: "/v2/project-1/cbs/instance/vpc", method: "PUT", body: { server_id: "server-1", network: { vpc_id: "vpc-2", subnet_id: "subnet-2", security_groups: [{ id: "sg-2" }] } } },
  ]);
});

test("VPC convergence must verify the requested security group too", async (t) => {
  const { instances } = mockCloud(t, { onWrite: (write) => {
    if (write.path === "/v2/project-1/cbs/instance/vpc") asRecord(instances[0]).network = { ...bastion.network, vpc_id: "vpc-2", subnet_id: "subnet-2" };
  } });
  const moved = await execute("switch-vpc", { subnet: "subnet-2", securityGroup: "sg-2" }, resource("bastion:server-1", "Bastion One"));
  assert.match(moved.message, /not yet verified/);
  assert.match(moved.message, /security group/);
  assert.ok(!/now uses the selected VPC/.test(moved.message));
});

test("inspect distinguishes native instance, server, and resource IDs without login endpoints or private payloads", async (t) => {
  mockReads(t);
  const outcome = await execute("inspect", {}, resource("bastion:server-1", "Bastion One"));
  const facts = Object.fromEntries(outcome.facts!.map((fact) => [fact.label, fact.value]));
  assert.equal(facts["Bastion server ID"], "server-1");
  assert.equal(facts["Bastion instance ID"], "12345");
  assert.equal(facts["Native resource ID"], "ecs-res-1");
  assert.equal(facts["Upgrade availability"], "Minor upgrade available");
  assert.equal(facts["Upgrade schedule"], "None scheduled");
  assert.equal(facts["Public IP"], "None bound");
  const scheduled = await execute("inspect", {}, resource("bastion:server-6", "Bastion Scheduled"));
  assert.match(Object.fromEntries(scheduled.facts!.map((fact) => [fact.label, fact.value]))["Upgrade schedule"] as string, /Scheduled for/);
  const unknown = await execute("inspect", {}, resource("bastion:server-7", "Bastion Unknown Upgrade"));
  assert.equal(Object.fromEntries(unknown.facts!.map((fact) => [fact.label, fact.value]))["Upgrade schedule"], "Unknown (not reported)");
  const unreported = await execute("inspect", {}, resource("bastion:server-8", "Bastion No Binding Report"));
  assert.equal(Object.fromEntries(unreported.facts!.map((fact) => [fact.label, fact.value]))["Public IP"], "Unknown (not reported)");
  const serialized = JSON.stringify([outcome, scheduled, unknown, unreported]);
  assert.ok(!serialized.includes("private-failure-detail"));
  assert.ok(!serialized.includes("192.168.0.5"));
  assert.ok(!serialized.includes("web_port"));
});

test("post-write business failures inside HTTP 200 stay uncertain errors instead of definitive input failures", async (t) => {
  const { writes } = mockCloud(t, { writeResponse: { error_code: "CBH.0001", error_msg: "private failure detail" } });
  await assert.rejects(execute("stop", {}, resource("bastion:server-1", "Bastion One")), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof ManagementInputError));
    assert.ok(!error.message.includes("private failure detail"));
    return /may or may not have been applied/.test(error.message);
  });
  assert.equal(writes.length, 1);
});

test("read-side business failures inside HTTP 200 are definitive rejections without leaked payloads", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_code: "CBH.0002", error_msg: "private read detail" }));
  await assert.rejects(cbhManagement.inventory(session), (error: unknown) => {
    assert.ok(error instanceof ManagementInputError);
    assert.ok(!error.message.includes("private read detail"));
    return /response body/.test(error.message);
  });
});

test("non-JSON and unreachable write responses stay uncertain and never leak transport details", async (t) => {
  mockCloud(t, { writeResponse: "non-json" });
  await assert.rejects(execute("stop", {}, resource("bastion:server-1", "Bastion One")), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof ManagementInputError));
    return /may or may not have been applied/.test(error.message);
  });
  mockCloud(t, { writeResponse: "network" });
  await assert.rejects(execute("stop", {}, resource("bastion:server-1", "Bastion One")), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("fetch failed"));
    return /could not be reached for this change/.test(error.message) && /may or may not have been applied/.test(error.message);
  });
});

test("no delete operation exists and the console gaps are declared in the header", () => {
  assert.ok(!cbhManagement.operations.some((operation) => operation.kind === "delete"));
  assert.match(cbhManagement.title, /unsubscription remain in the CBH console/);
  assert.ok(cbhManagement.operations.every((operation) => !operation.fields.some((field) => field.type === "textarea")));
});


test("CBH restart completion requires an observed native task followed by active idle", async t => {
  const instances = mockReads(t, [structuredClone(bastion)]);
  const saved = entry("Restart instance", "bastion:server-1", "server-1");
  assert.equal((await cbhManagement.poll!(session, saved)).state, "submitted");
  instances[0].status_info = { status: "ACTIVE", task_status: "rebooting" };
  const restarting = await cbhManagement.poll!(session, saved);
  assert.equal(restarting.observedTask, "rebooting");
  instances[0].status_info = { status: "SHUTOFF", task_status: "NO_TASK" };
  assert.equal((await cbhManagement.poll!(session, { ...saved, observedTask: restarting.observedTask })).state, "submitted");
  instances[0].status_info = { status: "ACTIVE", task_status: "NO_TASK" };
  assert.equal((await cbhManagement.poll!(session, { ...saved, observedTask: restarting.observedTask })).state, "succeeded");
  assert.equal((await cbhManagement.poll!(session, { ...saved, observedTask: "powering-on" })).state, "submitted");
});

test("CBH preserves documented build and busy task states without enabling mutations", async t => {
  mockReads(t, [{ ...bastion, status_info: { status: "BUILD", task_status: "data-migrating" } }]);
  const [item] = await cbhManagement.inventory(session);
  assert.equal(item.status, "BUILD"); assert.equal(item.values?.task, "data-migrating");
  await assert.rejects(execute("stop", {}, item), /unavailable/);
});

test("CBH rejects boolean and string native capacities rather than coercing them", async t => {
  let capacity: unknown = true;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input), response = read(url, clones());
    if (url.pathname.endsWith("/specification")) asRecord((response as { body: unknown[] }).body[0]).cpu = capacity;
    return Response.json(response);
  });
  for (capacity of [true, "4", null, 1.5]) await assert.rejects(cbhManagement.options!(session, "create"), /known positive vCPU/);
});

test("CBH rejects invalid enterprise-project totals and sanitizes account catalog failures", async t => {
  let response: unknown = { enterprise_projects: [], total_count: null };
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v1.0/enterprise-projects") return response instanceof Response ? response.clone() : Response.json(response);
    return Response.json(read(url, clones()));
  });
  await assert.rejects(cbhManagement.options!(epsSession, "create"), /incomplete enterprise-project/);
  response = new Response("PRIVATE-EPS-PAYLOAD", { status: 403 });
  await assert.rejects(cbhManagement.options!(epsSession, "create"), error => error instanceof Error && /HTTP 403/.test(error.message) && !error.message.includes("PRIVATE"));
});

test("CBH rejects malformed EIP binding identities and provided foreign projects", async t => {
  let eip: Record<string, unknown> = { id: "eip-free", status: "DOWN", associate_instance_info: { instance_id: false } };
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    return Response.json(url.pathname.endsWith("/publicips") ? { publicips: [eip] } : read(url, clones()));
  });
  await assert.rejects(cbhManagement.options!(session, "bind-eip"), /unverifiable EIP binding/);
  eip = { id: "eip-free", status: "DOWN", project_id: null };
  await assert.rejects(cbhManagement.options!(session, "bind-eip"), /exactly selected project/);
});

test("CBH path-addressed changes reject a mismatched acknowledgment parent", async t => {
  const { writes } = mockCloud(t, { writeResponse: { server_id: "different-bastion" } });
  await assert.rejects(execute("bind-eip", { eip: "eip-free" }, resource("bastion:server-1", "Bastion One")), /different bastion/);
  assert.equal(writes.length, 1);
});

test("CBH ordinary inventory rejects missing native pages and foreign projects", async t => {
  const { listCbhInstancesForProject } = await import("@/lib/huawei/services/cbh");
  let response: unknown = { total: 0 };
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  await assert.rejects(listCbhInstancesForProject({ ...session, projectName: "Selected" }), /no CBH instance array/);
  response = { total: 1, instance: [{ ...bastion, project_id: null }] };
  await assert.rejects(listCbhInstancesForProject({ ...session, projectName: "Selected" }), /exactly selected project/);
});


test("CBH binding requires both native public identity and address to prove no binding", async t => {
  const rows = mockReads(t, [{ ...bastion, network: { ...bastion.network, public_id: "", public_ip: "1.2.3.4" } }]);
  const selected = resource("bastion:server-1", "Bastion One");
  await assert.rejects(execute("bind-eip", { eip: "eip-free" }, selected), /already reports a public IP/);
  rows[0].network = withoutKeys(bastion.network, ["public_ip"]);
  await assert.rejects(execute("bind-eip", { eip: "eip-free" }, selected), /binding is not reported/);
});
