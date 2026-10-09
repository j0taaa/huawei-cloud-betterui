import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test, type TestContext } from "node:test";
import { cloudConnectManagement } from "@/lib/huawei/management/adapters/cc";
import { ManagementInputError, validateManagementValues, type ManagementHistoryEntry } from "@/lib/management-contract";
import { session } from "./fixtures/session";
import { serviceEndpoint } from "@/lib/huawei/endpoints";

const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-cc-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));

const account = { ...session, accountToken: "account-token" };
const domainId = "domain-1";
const cc1 = { id: "cc-1", name: "Connection", description: "Main", domain_id: domainId, enterprise_project_id: "0", status: "ACTIVE", admin_state_up: true, used_scene: "vpc", network_instance_number: 3, bandwidth_package_number: 1, inter_region_bandwidth_number: 2, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };
const cc2 = { ...cc1, id: "cc-2", name: "Empty", description: "", network_instance_number: 0, bandwidth_package_number: 0, inter_region_bandwidth_number: 0 };
const cc3 = { ...cc1, id: "cc-3", name: "Building", status: "BUILD" };
const niVpc = { id: "ni-1", name: "Vpc", description: "", domain_id: domainId, cloud_connection_id: "cc-1", instance_id: "vpc-1", instance_domain_id: domainId, region_id: "sa-brazil-1", project_id: "project-1", status: "ACTIVE", type: "vpc", cidrs: ["192.168.0.0/16"], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const niForeign = { ...niVpc, id: "ni-2", name: "Loaded", cloud_connection_id: "cc-1", instance_id: "vpc-foreign", instance_domain_id: "other-domain", region_id: "la-south-2", cidrs: ["10.10.0.0/16"] };
const niVgw = { ...niVpc, id: "ni-3", name: "Gateway", instance_id: "vgw-1", type: "vgw", cidrs: ["172.16.0.0/16"] };
const irb1 = { id: "irb-1", name: "Bandwidth", description: "", domain_id: domainId, cloud_connection_id: "cc-1", bandwidth_package_id: "pkg-1", bandwidth: 100, inter_regions: [{ id: "ir-1", project_id: "project-1", local_region_id: "sa-brazil-1", remote_region_id: "la-south-2" }], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const irb2 = { ...irb1, id: "irb-2", name: "Bandwidth2", bandwidth: 300, inter_regions: [{ id: "ir-2", project_id: "project-1", local_region_id: "sa-east-1", remote_region_id: "la-south-2" }] };
const pkg1 = { id: "pkg-1", name: "Package", domain_id: domainId, status: "ACTIVE", admin_state_up: true, resource_id: "cc-1", resource_type: "cloud_connection", bandwidth: 500, billing_mode: 1, charge_mode: "bandwidth", local_area_id: "BR", remote_area_id: "LA", interflow_mode: "Area" };
const pkg2 = { ...pkg1, id: "pkg-2", name: "Unbound", resource_id: "", resource_type: "", bandwidth: 300, billing_mode: 2 };
const pkg3 = { ...pkg1, id: "pkg-3", name: "PayPerUse", resource_id: "", resource_type: "", bandwidth: 300, billing_mode: 3 };
const pkg4 = { ...pkg1, id: "pkg-4", name: "AdminDown", resource_id: "", resource_type: "", bandwidth: 300, admin_state_up: false };
const pkg5 = { ...pkg1, id: "pkg-5", name: "Percentile", resource_id: "", resource_type: "", bandwidth: 300, charge_mode: "95peak" };
const regionRows = [
  { id: "sa-brazil-1", name: "SA-Brazil", area_id: "BR", area_name: "Brazil", used_scenes: ["vpc"] },
  { id: "la-south-2", name: "LA-South", area_id: "LA", area_name: "LATAM", used_scenes: ["vpc"] },
  { id: "sa-east-1", name: "SA-East", area_id: "BR", area_name: "Brazil", used_scenes: ["vpc"] },
  { id: "na-mexico-1", name: "NA-Mexico", area_id: "LA", area_name: "LATAM", used_scenes: ["vpc"] },
];
const routeRows = [{ id: "route-1", cloud_connection_id: "cc-1", domain_id: domainId, instance_id: "vpc-1", project_id: "project-1", region_id: "sa-brazil-1", destination: "192.168.0.0/16", type: "vpc" }];
const vgwBase = { id: "vgw-1", name: "Gateway", vpc_id: "vpc-1", tenant_id: "project-1", status: "ACTIVE", type: "default", local_ep_group: ["172.16.0.0/16"], local_ep_group_ipv6: [] };

const connections: unknown[] = [cc1, cc2, cc3];
let instances: unknown[] = [niVpc, niForeign, niVgw];
let bandwidths: unknown[] = [irb1, irb2];
let packages: unknown[] = [pkg1, pkg2, pkg3, pkg4, pkg5];
let niStatus = "ACTIVE";

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v3/auth/tokens") return { token: { domain: { id: domainId }, user: { id: session.userId, domain: { id: domainId } } } };
  if (path === `/v3/${domainId}/ccaas/cloud-connections`) return { cloud_connections: connections, page_info: { next_marker: "" } };
  if (path === `/v3/${domainId}/ccaas/cloud-connections/cc-1`) {
    return { cloud_connection: { ...cc1, network_instance_number: instances.filter(row => (row as Record<string, unknown>).cloud_connection_id === "cc-1").length, inter_region_bandwidth_number: bandwidths.filter(row => (row as Record<string, unknown>).cloud_connection_id === "cc-1").length, bandwidth_package_number: packages.filter(row => (row as Record<string, unknown>).resource_id === "cc-1").length } };
  }
  if (path === `/v3/${domainId}/ccaas/cloud-connections/cc-2`) return { cloud_connection: { ...cc2 } };
  if (path === `/v3/${domainId}/ccaas/cloud-connections/cc-3`) return { cloud_connection: { ...cc3 } };
  if (path === `/v3/${domainId}/ccaas/network-instances`) {
    const filter = url.searchParams.get("cloud_connection_id");
    return { network_instances: filter ? instances.filter(row => (row as Record<string, unknown>).cloud_connection_id === filter) : instances, page_info: { next_marker: "" } };
  }
  if (path === `/v3/${domainId}/ccaas/network-instances/ni-1`) return { network_instance: { ...niVpc, status: niStatus } };
  if (path === `/v3/${domainId}/ccaas/network-instances/ni-2`) return { network_instance: niForeign };
  if (path === `/v3/${domainId}/ccaas/inter-region-bandwidths`) {
    const filter = url.searchParams.get("cloud_connection_id");
    return { inter_region_bandwidths: filter ? bandwidths.filter(row => (row as Record<string, unknown>).cloud_connection_id === filter) : bandwidths, page_info: { next_marker: "" } };
  }
  if (path === `/v3/${domainId}/ccaas/inter-region-bandwidths/irb-1`) return { inter_region_bandwidth: irb1 };
  if (path === `/v3/${domainId}/ccaas/inter-region-bandwidths/irb-2`) return { inter_region_bandwidth: irb2 };
  if (path === `/v3/${domainId}/ccaas/bandwidth-packages`) {
    const filter = url.searchParams.get("resource_id");
    return { bandwidth_packages: filter ? packages.filter(row => (row as Record<string, unknown>).resource_id === filter) : packages, page_info: { next_marker: "" } };
  }
  if (path === `/v3/${domainId}/ccaas/regions`) return { regions: regionRows, page_info: { next_marker: "" } };
  if (path === `/v3/${domainId}/ccaas/cloud-connection-routes`) return { cloud_connection_routes: routeRows, page_info: { next_marker: "" } };
  if (path === "/v3/project-1/vpc/vpcs") return { vpcs: [{ id: "vpc-1", name: "Vpc", cidr: "192.168.0.0/16", status: "ACTIVE" }], page_info: { next_marker: "" } };
  if (path === "/v1/project-1/subnets") return { subnets: [{ id: "subnet-1", vpc_id: "vpc-1", cidr: "192.168.0.0/24", name: "Subnet", status: "ACTIVE" }], page_info: { next_marker: "" } };
  if (path === "/v3/project-1/dcaas/virtual-gateways") return { virtual_gateways: [vgwBase], page_info: { next_marker: "" } };
  throw new Error(`Unexpected GET ${path}`);
}

function writeResponse(url: URL, init: RequestInit) {
  const path = url.pathname;
  const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
  if (path === `/v3/${domainId}/ccaas/cloud-connections`) return { cloud_connection: { id: "cc-new", domain_id: domainId, status: "ACTIVE" } };
  if (path === `/v3/${domainId}/ccaas/network-instances`) {
    const sent = body.network_instance as Record<string, unknown>;
    return { network_instance: { id: "ni-new", domain_id: domainId, cloud_connection_id: sent.cloud_connection_id, instance_id: sent.instance_id, type: sent.type, project_id: sent.project_id, region_id: sent.region_id, instance_domain_id: sent.instance_domain_id, cidrs: sent.cidrs } };
  }
  if (path === `/v3/${domainId}/ccaas/inter-region-bandwidths`) {
    const sent = body.inter_region_bandwidth as Record<string, unknown>;
    const ids = sent.inter_region_ids as string[];
    return { inter_region_bandwidth: { id: "irb-new", domain_id: domainId, cloud_connection_id: sent.cloud_connection_id, bandwidth_package_id: sent.bandwidth_package_id, bandwidth: sent.bandwidth, inter_regions: [{ local_region_id: ids[0], remote_region_id: ids[1] }] } };
  }
  if (path === `/v3/${domainId}/ccaas/bandwidth-packages/pkg-2/associate`) { const sent = body.bandwidth_package as Record<string, unknown>; return { bandwidth_package: { id: "pkg-2", domain_id: domainId, resource_id: sent.resource_id, resource_type: sent.resource_type } }; }
  if (path === `/v3/${domainId}/ccaas/bandwidth-packages/pkg-1/disassociate`) return { bandwidth_package: { id: "pkg-1", domain_id: domainId, resource_id: "" } };
  if (path.includes("/network-instances/")) return { network_instance: { id: path.split("/").at(-1), domain_id: domainId } };
  if (path.includes("/inter-region-bandwidths/")) return { inter_region_bandwidth: { id: path.split("/").at(-1), domain_id: domainId } };
  if (path.includes("/cloud-connections/")) return { cloud_connection: { id: path.split("/").at(-1), domain_id: domainId } };
  throw new Error(`Unexpected write ${path}`);
}

function mockCloudWith(t: TestContext, readOverride?: (url: URL) => unknown) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json((readOverride?.(url) ?? read(url)) as Record<string, unknown>);
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), url.pathname.startsWith(`/v3/${domainId}/ccaas`) ? "account-token" : "test-token");
    writes.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json(writeResponse(url, init));
  });
  return writes;
}

function mockCloud(t: TestContext) {
  return mockCloudWith(t);
}

async function operate(operationId: string, values: unknown, resourceId?: string) {
  const operation = cloudConnectManagement.operations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error(`Unknown operation ${operationId}`);
  const resources = await cloudConnectManagement.inventory(account);
  const resource = resourceId ? resources.find((item) => item.id === resourceId) : undefined;
  if (resourceId && !resource) throw new Error(`Unknown resource ${resourceId}`);
  const choices = await cloudConnectManagement.options!(account, operationId, resource);
  return cloudConnectManagement.execute(account, operationId, validateManagementValues(operation, values, choices), resource);
}

const vpcSelection = JSON.stringify(["vpc", "project-1", "sa-brazil-1", "vpc-1"]);
const vgwSelection = JSON.stringify(["vgw", "project-1", "sa-brazil-1", "vgw-1"]);
const vpcCidr = JSON.stringify(["vpc", "project-1", "sa-brazil-1", "vpc-1", "192.168.0.0/16"]);
const subnetCidr = JSON.stringify(["vpc", "project-1", "sa-brazil-1", "vpc-1", "192.168.0.0/24"]);
const vgwCidr = JSON.stringify(["vgw", "project-1", "sa-brazil-1", "vgw-1", "172.16.0.0/16"]);

test("inventory lists connections, instances, and inter-region bandwidths with prefixed ids", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const resources = await cloudConnectManagement.inventory(account);
  assert.deepEqual(resources.map((item) => item.id), ["cc:cc-1", "cc:cc-2", "cc:cc-3", "ni:ni-1", "ni:ni-2", "ni:ni-3", "irb:irb-1", "irb:irb-2"]);
  const connection = resources.find((item) => item.id === "cc:cc-1")!;
  assert.equal(connection.values?.networkInstances, 3);
  assert.equal(connection.values?.bandwidthPackages, 1);
  assert.equal(connection.values?.interRegionBandwidths, 2);
  const owned = resources.find((item) => item.id === "ni:ni-1")!;
  assert.equal(owned.values?.owned, true);
  assert.equal(owned.values?.cloudConnection, "cc-1");
  const foreign = resources.find((item) => item.id === "ni:ni-2")!;
  assert.equal(foreign.values?.owned, false);
  const bandwidth = resources.find((item) => item.id === "irb:irb-1")!;
  assert.equal(bandwidth.values?.regions, "sa-brazil-1/la-south-2");
  assert.equal(bandwidth.values?.bandwidth, 100);
});

test("inventory rejects missing account tokens and mismatched identity domains before native reads", async (t) => {
  await assert.rejects(cloudConnectManagement.inventory(session), /account token/);
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push(url.pathname);
    if (url.pathname === "/v3/auth/tokens") {
      assert.equal(new Headers(init.headers).get("X-Auth-Token"), "account-token");
      assert.equal(new Headers(init.headers).get("X-Subject-Token"), "account-token");
      return Response.json({ token: { domain: { id: domainId }, user: { id: "another-user", domain: { id: domainId } } } });
    }
    return Response.json(read(url));
  });
  await assert.rejects(cloudConnectManagement.inventory(account), /verify this account/);
  assert.deepEqual(calls, ["/v3/auth/tokens"]);
});

test("attach options offer active connections and owned verified VPCs and virtual gateways with live routes", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await cloudConnectManagement.options!(account, "attach-instance");
  assert.deepEqual(choices.cloudConnections.map((choice) => choice.value), ["cc-1", "cc-2"]);
  assert.ok(choices.cloudConnections.every((choice) => !choice.label.includes("BUILD")));
  assert.deepEqual(choices.instances.map((choice) => choice.value), [vpcSelection, vgwSelection]);
  assert.deepEqual(choices.instanceCidrs.map((choice) => choice.value), [vpcCidr, subnetCidr, vgwCidr]);
});

test("network instance loading enforces composite route identity and duplicate loads before the native payload", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(operate("attach-instance", { cloudConnection: "cc-1", instance: vpcSelection, cidrs: [vgwCidr] }), /must belong to the selected network instance/);
  await assert.rejects(operate("attach-instance", { cloudConnection: "cc-1", instance: vpcSelection, cidrs: [vpcCidr] }), /already loaded/);
  assert.equal(writes.length, 0);
  const outcome = await operate("attach-instance", { cloudConnection: "cc-2", instance: vgwSelection, cidrs: [vgwCidr] });
  assert.equal(outcome.resourceId, "ni:ni-new");
  assert.equal(outcome.jobId, "ni-new");
  assert.deepEqual(writes, [{ path: `/v3/${domainId}/ccaas/network-instances`, method: "POST", body: { network_instance: { name: "Gateway", instance_id: "vgw-1", instance_domain_id: domainId, project_id: "project-1", region_id: "sa-brazil-1", cloud_connection_id: "cc-2", type: "vgw", cidrs: ["172.16.0.0/16"] } } }]);
});

test("network instance mutations are limited to instances owned by this account", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(operate("update-instance", { name: "Renamed" }, "ni:ni-2"), /loaded from another account/);
  await assert.rejects(operate("detach-instance", {}, "ni:ni-2"), /loaded from another account/);
  assert.deepEqual(writes, []);
});

test("network instance edits verify the live source and parent connection and keep routes unless replaced", async (t) => {
  const writes = mockCloud(t);
  await operate("update-instance", { name: "Renamed" }, "ni:ni-1");
  assert.deepEqual(writes.at(-1), { path: `/v3/${domainId}/ccaas/network-instances/ni-1`, method: "PUT", body: { network_instance: { name: "Renamed" } } });
  await operate("update-instance", { name: "Renamed", cidrs: [subnetCidr] }, "ni:ni-1");
  assert.deepEqual(writes.at(-1)!.body, { network_instance: { name: "Renamed", cidrs: ["192.168.0.0/24"] } });
  const outcome = await operate("detach-instance", {}, "ni:ni-1");
  assert.equal(outcome.resourceId, "ni:ni-1");
  assert.deepEqual(writes.at(-1), { path: `/v3/${domainId}/ccaas/network-instances/ni-1`, method: "DELETE", body: undefined });
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/network-instances/ni-1`) return Response.json({ network_instance: { ...niVpc, cloud_connection_id: "cc-3" } });
    return Response.json(read(url));
  });
  await assert.rejects(operate("update-instance", { name: "Renamed" }, "ni:ni-1"), /not ACTIVE/);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/network-instances/ni-1`) return Response.json({ network_instance: { ...niVpc, region_id: "eu-west-0" } });
    return Response.json(read(url));
  });
  await assert.rejects(operate("update-instance", { name: "Renamed" }, "ni:ni-1"), /no longer accessible/);
});

test("inter-region bandwidth creation requires a bound prepaid package, matching areas, a free pair, and unused capacity", async (t) => {
  const writes = mockCloud(t);
  const values = { cloudConnection: "cc-1", bandwidthPackage: "pkg-1", regions: ["sa-brazil-1", "la-south-2"], bandwidth: 100 };
  await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", { ...values, bandwidthPackage: "pkg-2" }), /not bound to this cloud connection/);
  await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", { ...values, regions: ["sa-brazil-1"] }), /exactly two/);
  await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", { ...values, regions: ["sa-brazil-1", "sa-brazil-1"] }), /exactly two/);
  await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", { ...values, regions: ["sa-brazil-1", "eu-west-0"] }), /region catalog/);
  await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", { ...values, regions: ["sa-brazil-1", "sa-east-1"] }), /areas/);
  await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", values), /already exists/);
  await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", { ...values, regions: ["sa-brazil-1", "na-mexico-1"], bandwidth: 150 }), /capacity/);
  assert.deepEqual(writes, []);
  const outcome = await operate("create-inter-region-bandwidth", { cloudConnection: "cc-1", bandwidthPackage: "pkg-1", regions: ["sa-brazil-1", "na-mexico-1"], bandwidth: 90 });
  assert.equal(outcome.resourceId, "irb:irb-new");
  assert.deepEqual(writes, [{ path: `/v3/${domainId}/ccaas/inter-region-bandwidths`, method: "POST", body: { inter_region_bandwidth: { cloud_connection_id: "cc-1", bandwidth_package_id: "pkg-1", bandwidth: 90, inter_region_ids: ["sa-brazil-1", "na-mexico-1"] } } }]);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/regions`) return Response.json({ regions: regionRows.map((row) => row.id === "na-mexico-1" ? { ...row, area_id: undefined } : row), page_info: { next_marker: "" } });
    return Response.json(read(url));
  });
  await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", { cloudConnection: "cc-1", bandwidthPackage: "pkg-1", regions: ["sa-brazil-1", "na-mexico-1"], bandwidth: 90 }), /area/);
});

test("inter-region bandwidth resize guards unchanged, over-capacity, and sibling allocations", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(operate("update-bandwidth", { bandwidth: 100 }, "irb:irb-1"), /must differ/);
  await assert.rejects(operate("update-bandwidth", { bandwidth: 600 }, "irb:irb-1"), /capacity/);
  await assert.rejects(operate("update-bandwidth", { bandwidth: 250 }, "irb:irb-1"), /capacity/);
  assert.deepEqual(writes, []);
  await operate("update-bandwidth", { bandwidth: 200 }, "irb:irb-1");
  assert.deepEqual(writes, [{ path: `/v3/${domainId}/ccaas/inter-region-bandwidths/irb-1`, method: "PUT", body: { inter_region_bandwidth: { bandwidth: 200 } } }]);
  const outcome = await operate("delete-bandwidth", {}, "irb:irb-1");
  assert.equal(outcome.resourceId, "irb:irb-1");
  assert.deepEqual(writes.at(-1), { path: `/v3/${domainId}/ccaas/inter-region-bandwidths/irb-1`, method: "DELETE", body: undefined });
});

test("inter-region bandwidth resize and delete recheck parents, package binding, billing mode, and known regions", async (t) => {
  const writes = mockCloud(t);
  const original = packages;
  packages = original.map((row) => (row as Record<string, unknown>).id === "pkg-1" ? { ...(row as Record<string, unknown>), billing_mode: 3 } : row);
  await assert.rejects(operate("update-bandwidth", { bandwidth: 200 }, "irb:irb-1"), /prepaid/);
  await assert.rejects(operate("delete-bandwidth", {}, "irb:irb-1"), /prepaid/);
  packages = original.map((row) => (row as Record<string, unknown>).id === "pkg-1" ? { ...(row as Record<string, unknown>), resource_id: "" } : row);
  await assert.rejects(operate("update-bandwidth", { bandwidth: 200 }, "irb:irb-1"), /no longer bound/);
  packages = original;
  assert.deepEqual(writes, []);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/cloud-connections/cc-1`) return Response.json({ cloud_connection: { ...cc1, admin_state_up: false } });
    return Response.json(read(url));
  });
  await assert.rejects(operate("update-bandwidth", { bandwidth: 200 }, "irb:irb-1"), /administratively enabled/);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/inter-region-bandwidths/irb-1`) return Response.json({ inter_region_bandwidth: { ...irb1, inter_regions: [{ ...irb1.inter_regions[0], remote_region_id: "eu-west-0" }] } });
    return Response.json(read(url));
  });
  await assert.rejects(operate("update-bandwidth", { bandwidth: 200 }, "irb:irb-1"), /region catalog/);
});

test("cloud connection creation and metadata edits emit native envelopes with honest acceptance", async (t) => {
  const writes = mockCloud(t);
  const outcome = await operate("create-connection", { name: "New", description: "Cross-region" });
  assert.equal(outcome.resourceId, "cc:cc-new");
  assert.equal(outcome.jobId, "cc-new");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: `/v3/${domainId}/ccaas/cloud-connections`, method: "POST", body: { cloud_connection: { name: "New", enterprise_project_id: "0", description: "Cross-region" } } }]);
  const edited = await operate("update-connection", { name: "Renamed" }, "cc:cc-1");
  assert.match(edited.message, /accepted/);
  assert.deepEqual(writes.at(-1), { path: `/v3/${domainId}/ccaas/cloud-connections/cc-1`, method: "PUT", body: { cloud_connection: { name: "Renamed" } } });
});

test("cloud connection deletion requires exact name, agreeing dependency counts, and empty inventories", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(operate("delete-connection", {}, "cc:cc-1"), /Unload them first/);
  instances = [];
  await assert.rejects(operate("delete-connection", {}, "cc:cc-1"), /Remove them first/);
  bandwidths = [];
  await assert.rejects(operate("delete-connection", {}, "cc:cc-1"), /Unbind them first/);
  packages = [pkg2, pkg3, pkg4, pkg5];
  const outcome = await operate("delete-connection", {}, "cc:cc-1");
  assert.equal(outcome.resourceId, "cc:cc-1");
  assert.equal(writes.at(-1)!.method, "DELETE");
  instances = [niVpc, niForeign, niVgw];
  bandwidths = [irb1, irb2];
  packages = [pkg1, pkg2, pkg3, pkg4, pkg5];
  mockCloudWith(t, url => {
    if (url.pathname === `/v3/${domainId}/ccaas/cloud-connections/cc-1`) return { cloud_connection: { ...cc1, name: "Renamed" } };
    return undefined;
  });
  await assert.rejects(operate("delete-connection", {}, "cc:cc-1"), /renamed or replaced/);
  mockCloudWith(t, url => {
    if (url.pathname === `/v3/${domainId}/ccaas/cloud-connections/cc-1`) return { cloud_connection: { ...cc1, network_instance_number: 99 } };
    return undefined;
  });
  await assert.rejects(operate("delete-connection", {}, "cc:cc-1"), /disagree/);
  mockCloudWith(t, url => {
    if (url.pathname === `/v3/${domainId}/ccaas/cloud-connections/cc-1`) return { cloud_connection: { ...cc1, network_instance_number: undefined } };
    return undefined;
  });
  await assert.rejects(operate("delete-connection", {}, "cc:cc-1"), /unverified cloud connection dependency counts/);
});

test("bandwidth package choices exclude non-prepaid, admin-down, percentile, and unknown-area packages", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const bindChoices = await cloudConnectManagement.options!(account, "bind-package", { id: "cc:cc-2", name: "Empty", status: "ACTIVE" });
  assert.deepEqual(bindChoices.packages.map((choice) => choice.value), ["pkg-2"]);
  const unbindChoices = await cloudConnectManagement.options!(account, "unbind-package", { id: "cc:cc-1", name: "Connection", status: "ACTIVE" });
  assert.deepEqual(unbindChoices.packages.map((choice) => choice.value), ["pkg-1"]);
  const createChoices = await cloudConnectManagement.options!(account, "create-inter-region-bandwidth");
  assert.deepEqual(createChoices.bandwidthPackages.map((choice) => choice.value), ["pkg-1"]);
  assert.ok(createChoices.bandwidthPackages[0].label.includes("BR ↔ LA"));
  assert.deepEqual(createChoices.regions.map((choice) => choice.value), ["sa-brazil-1", "la-south-2", "sa-east-1", "na-mexico-1"]);
});

test("bandwidth package binding and unbinding use the native association envelopes", async (t) => {
  const writes = mockCloud(t);
  await operate("bind-package", { package: "pkg-2" }, "cc:cc-2");
  assert.deepEqual(writes, [{ path: `/v3/${domainId}/ccaas/bandwidth-packages/pkg-2/associate`, method: "POST", body: { bandwidth_package: { resource_id: "cc-2", resource_type: "cloud_connection" } } }]);
  await assert.rejects(cloudConnectManagement.execute(account, "bind-package", { package: "pkg-1" }, { id: "cc:cc-2", name: "Empty", status: "ACTIVE" }), /already bound/);
  await assert.rejects(cloudConnectManagement.execute(account, "bind-package", { package: "pkg-3" }, { id: "cc:cc-2", name: "Empty", status: "ACTIVE" }), /prepaid/);
  await assert.rejects(operate("unbind-package", { package: "pkg-1" }, "cc:cc-1"), /Remove the inter-region bandwidths/);
  assert.equal(writes.length, 1);
  bandwidths = [];
  await operate("unbind-package", { package: "pkg-1" }, "cc:cc-1");
  assert.deepEqual(writes.at(-1), { path: `/v3/${domainId}/ccaas/bandwidth-packages/pkg-1/disassociate`, method: "POST", body: { bandwidth_package: { resource_id: "cc-1", resource_type: "cloud_connection" } } });
  bandwidths = [irb1, irb2];
});

test("package acknowledgements with foreign owners or unproven bindings stay uncertain after the write", async (t) => {
  const writes: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes.push(init.method); return Response.json({ bandwidth_package: { id: "pkg-2", domain_id: "other-domain", resource_id: "cc-2", resource_type: "cloud_connection" } }); }
    return Response.json(read(new URL(input)));
  });
  await assert.rejects(operate("bind-package", { package: "pkg-2" }, "cc:cc-2"), (error: Error) => !(error instanceof ManagementInputError) && /unverified Cloud Connect acknowledgement/.test(error.message));
  assert.deepEqual(writes, ["POST"]);
  const unbindWrites: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { unbindWrites.push(init.method); return Response.json({ bandwidth_package: { id: "pkg-1", domain_id: domainId, resource_id: "cc-1" } }); }
    return Response.json(read(new URL(input)));
  });
  bandwidths = [];
  await assert.rejects(operate("unbind-package", { package: "pkg-1" }, "cc:cc-1"), (error: Error) => !(error instanceof ManagementInputError) && /unverified bandwidth package unbinding/.test(error.message));
  assert.deepEqual(unbindWrites, ["POST"]);
  bandwidths = [irb1, irb2];
});

test("cloud connection inventory retains all original identities across marker pages", async (t) => {
  const markers: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/cloud-connections`) {
      if (!url.searchParams.has("marker")) return Response.json({ cloud_connections: [cc1], page_info: { next_marker: "original-marker" } });
      markers.push(url.searchParams.get("marker")!);
      return Response.json({ cloud_connections: [cc2], page_info: { next_marker: "" } });
    }
    return Response.json(read(url));
  });
  const resources = await cloudConnectManagement.inventory(account);
  assert.ok(resources.some((item) => item.id === "cc:cc-1" && item.name === "Connection"));
  assert.ok(resources.some((item) => item.id === "cc:cc-2" && item.name === "Empty"));
  assert.deepEqual(markers, ["original-marker"]);
});

test("malformed native rows cannot hide dependencies, bindings, or other accounts", async (t) => {
  for (const cloud_connections of [[{ ...cc1, id: "" }], [cc1, cc1], [{ ...cc1, domain_id: undefined }]]) {
    t.mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input);
      if (url.pathname === `/v3/${domainId}/ccaas/cloud-connections`) return Response.json({ cloud_connections, page_info: { next_marker: "" } });
      return Response.json(read(url));
    });
    await assert.rejects(cloudConnectManagement.inventory(account), /unverified cloud connection inventory/);
  }
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/cloud-connections`) return Response.json({ cloud_connections: [{ ...cc1, domain_id: "other-domain" }], page_info: { next_marker: "" } });
    return Response.json(read(url));
  });
  await assert.rejects(cloudConnectManagement.inventory(account), /does not belong to this account/);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/network-instances`) return Response.json({ network_instances: [{ ...niVpc, cloud_connection_id: undefined }], page_info: { next_marker: "" } });
    return Response.json(read(url));
  });
  await assert.rejects(cloudConnectManagement.inventory(account), /unverified network instance parent/);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/bandwidth-packages`) return Response.json({ bandwidth_packages: [{ ...pkg1, resource_id: undefined }], page_info: { next_marker: "" } });
    return Response.json(read(url));
  });
  await assert.rejects(cloudConnectManagement.options!(account, "bind-package", { id: "cc:cc-2", name: "Empty", status: "ACTIVE" }), /unverified bandwidth package inventory/);
});

test("filtered inventories that ignore parent filters are rejected", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/network-instances`) return Response.json({ network_instances: instances, page_info: { next_marker: "" } });
    return Response.json(read(url));
  });
  await assert.rejects(operate("attach-instance", { cloudConnection: "cc-2", instance: vgwSelection, cidrs: [vgwCidr] }), /unverified network instance parent/);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/inter-region-bandwidths`) return Response.json({ inter_region_bandwidths: bandwidths, page_info: { next_marker: "" } });
    return Response.json(read(url));
  });
  await assert.rejects(operate("delete-connection", {}, "cc:cc-2"), /unverified inter-region bandwidth parent/);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/bandwidth-packages`) return Response.json({ bandwidth_packages: packages, page_info: { next_marker: "" } });
    return Response.json(read(url));
  });
  await assert.rejects(operate("unbind-package", { package: "pkg-1" }, "cc:cc-1"), /unverified bandwidth package inventory/);
});

test("native errors and malformed responses never reveal private Cloud Connect details", async (t) => {
  const responses = [
    () => Response.json({ error_msg: "private-cc-detail" }, { status: 403 }),
    () => Response.json({ error_code: "CC.1", error_msg: "private-cc-detail" }),
    () => new Response('{"private-cc-detail":broken'),
  ];
  for (const respond of responses) {
    t.mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v3/auth/tokens") return Response.json(read(url));
      return respond();
    });
    await assert.rejects(cloudConnectManagement.inventory(account), error => !String(error).includes("private-cc-detail"));
  }
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_msg: "private-cc-detail" }, { status: 403 }));
  await assert.rejects(cloudConnectManagement.inventory(account), error => !String(error).includes("private-cc-detail"));
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v3/project-1/dcaas/virtual-gateways") return Response.json({ error_code: "DC.1", error_msg: "private-vgw" });
    return Response.json(read(url));
  });
  await assert.rejects(cloudConnectManagement.options!(account, "attach-instance"), error => !String(error).includes("private-vgw"));
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v3/project-1/vpc/vpcs") return Response.json({ error_msg: "private-vpc" }, { status: 403 });
    return Response.json(read(url));
  });
  await assert.rejects(cloudConnectManagement.options!(account, "attach-instance"), error => !String(error).includes("private-vpc") && /VPC catalog/.test(String(error)));
});

test("unverified creation acknowledgements retain uncertainty after a write", async (t) => {
  const writes: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes.push(init.method); return Response.json({ network_instance: { id: "ni-new", domain_id: domainId, cloud_connection_id: "cc-other", instance_id: "vgw-1", type: "vgw", project_id: "project-1", region_id: "sa-brazil-1", instance_domain_id: domainId, cidrs: ["172.16.0.0/16"] } }); }
    return Response.json(read(new URL(input)));
  });
  await assert.rejects(operate("attach-instance", { cloudConnection: "cc-2", instance: vgwSelection, cidrs: [vgwCidr] }), (error: Error) => !(error instanceof ManagementInputError) && /unverified network instance acknowledgement/.test(error.message));
  assert.deepEqual(writes, ["POST"]);
  const foreignWrites: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { foreignWrites.push(init.method); return Response.json({ network_instance: { id: "ni-new", domain_id: "other-domain", cloud_connection_id: "cc-2", instance_id: "vgw-1", type: "vgw", project_id: "project-1", region_id: "sa-brazil-1", instance_domain_id: domainId, cidrs: ["172.16.0.0/16"] } }); }
    return Response.json(read(new URL(input)));
  });
  await assert.rejects(operate("attach-instance", { cloudConnection: "cc-2", instance: vgwSelection, cidrs: [vgwCidr] }), (error: Error) => !(error instanceof ManagementInputError) && /unverified Cloud Connect acknowledgement/.test(error.message));
  assert.deepEqual(foreignWrites, ["POST"]);
  const irbWrites: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { irbWrites.push(init.method); return Response.json({ inter_region_bandwidth: { id: "irb-new", domain_id: domainId, cloud_connection_id: "cc-1", bandwidth_package_id: "pkg-1", bandwidth: 999, inter_regions: [{ local_region_id: "sa-brazil-1", remote_region_id: "na-mexico-1" }] } }); }
    return Response.json(read(new URL(input)));
  });
  await assert.rejects(operate("create-inter-region-bandwidth", { cloudConnection: "cc-1", bandwidthPackage: "pkg-1", regions: ["sa-brazil-1", "na-mexico-1"], bandwidth: 90 }), (error: Error) => !(error instanceof ManagementInputError) && /unverified inter-region bandwidth acknowledgement/.test(error.message));
  assert.deepEqual(irbWrites, ["POST"]);
});

test("resource-state observation verifies network instance and inter-region bandwidth progress", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const niEntry: ManagementHistoryEntry = { id: randomUUID(), service: "cc", operation: "Load network instance", state: "submitted", startedAt: new Date().toISOString(), jobId: "ni-1", resourceId: "ni:ni-1" };
  assert.equal((await cloudConnectManagement.poll!(account, niEntry)).state, "succeeded");
  niStatus = "PENDING";
  assert.equal((await cloudConnectManagement.poll!(account, niEntry)).state, "submitted");
  niStatus = "ERROR";
  assert.equal((await cloudConnectManagement.poll!(account, niEntry)).state, "failed");
  niStatus = "ACTIVE";
  const irbEntry: ManagementHistoryEntry = { ...niEntry, operation: "Configure inter-region bandwidth", jobId: "irb-1", resourceId: "irb:irb-1" };
  assert.equal((await cloudConnectManagement.poll!(account, irbEntry)).state, "succeeded");
  const removing: ManagementHistoryEntry = { ...irbEntry, operation: "Remove inter-region bandwidth" };
  assert.equal((await cloudConnectManagement.poll!(account, removing)).state, "submitted");
  await assert.rejects(cloudConnectManagement.poll!(account, { ...niEntry, jobId: "foreign" }), /different Cloud Connect resource identity/);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if ([`/v3/${domainId}/ccaas/network-instances/ni-1`, `/v3/${domainId}/ccaas/inter-region-bandwidths/irb-1`].includes(url.pathname)) return new Response(null, { status: 404 });
    return Response.json(read(url));
  });
  assert.equal((await cloudConnectManagement.poll!(account, removing)).state, "succeeded");
  assert.equal((await cloudConnectManagement.poll!(account, niEntry)).state, "failed");
  assert.equal((await cloudConnectManagement.poll!(account, irbEntry)).state, "failed");
});

test("inter-region bandwidth observation requires a complete native configuration before completion", async (t) => {
  let incomplete = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === `/v3/${domainId}/ccaas/inter-region-bandwidths/irb-1`) return Response.json({ inter_region_bandwidth: incomplete ? { ...irb1, bandwidth: undefined } : irb1 });
    return Response.json(read(url));
  });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "cc", operation: "Configure inter-region bandwidth", state: "submitted", startedAt: new Date().toISOString(), jobId: "irb-1", resourceId: "irb:irb-1" };
  assert.equal((await cloudConnectManagement.poll!(account, entry)).state, "succeeded");
  incomplete = true;
  assert.equal((await cloudConnectManagement.poll!(account, entry)).state, "submitted");
});

test("resource observers reject unsupported operations before native reads", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { calls.push(input); return Response.json({}); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "cc", operation: "Edit cloud connection", state: "submitted", startedAt: new Date().toISOString(), jobId: "cc-1", resourceId: "cc:cc-1" };
  await assert.rejects(cloudConnectManagement.poll!(account, entry), /no Cloud Connect resource-state observation/);
  await assert.rejects(cloudConnectManagement.poll!(account, { ...entry, operation: "Load network instance" }), /different Cloud Connect operation identity/);
  assert.deepEqual(calls, []);
});

test("inspect operations report native connection, instance, and bandwidth facts", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const connection = await operate("inspect-connection", {}, "cc:cc-1");
  assert.ok(connection.facts!.some((fact) => fact.label === "Network instances" && fact.value === "3"));
  assert.ok(connection.facts!.some((fact) => fact.label === "Bandwidth packages" && fact.value === "1"));
  assert.ok(connection.facts!.some((fact) => fact.label === "Inter-region bandwidths" && fact.value === "2"));
  assert.ok(connection.facts!.some((fact) => fact.label === "Route · 192.168.0.0/16" && fact.value === "sa-brazil-1 · vpc"));
  const owned = await operate("inspect-instance", {}, "ni:ni-1");
  assert.ok(owned.facts!.some((fact) => fact.label === "Owning account" && fact.value === "This account"));
  assert.ok(owned.facts!.some((fact) => fact.label === "Published routes" && fact.value === "192.168.0.0/16"));
  const foreign = await operate("inspect-instance", {}, "ni:ni-2");
  assert.ok(foreign.facts!.some((fact) => fact.label === "Owning account" && fact.value === "other-domain"));
  const bandwidth = await operate("inspect-bandwidth", {}, "irb:irb-1");
  assert.ok(bandwidth.facts!.some((fact) => fact.label === "Regions" && fact.value === "sa-brazil-1 ↔ la-south-2"));
  assert.ok(bandwidth.facts!.some((fact) => fact.label === "Bandwidth" && fact.value === "100 Mbit/s"));
});

test("exact-name confirmation blocks all three deletes after renames", async (t) => {
  const writes = mockCloudWith(t, url => {
    if (url.pathname === `/v3/${domainId}/ccaas/cloud-connections/cc-1`) return { cloud_connection: { ...cc1, name: "Renamed" } };
    if (url.pathname === `/v3/${domainId}/ccaas/network-instances/ni-1`) return { network_instance: { ...niVpc, name: "Renamed" } };
    if (url.pathname === `/v3/${domainId}/ccaas/inter-region-bandwidths/irb-1`) return { inter_region_bandwidth: { ...irb1, name: "Renamed" } };
    return undefined;
  });
  await assert.rejects(operate("delete-connection", {}, "cc:cc-1"), /renamed or replaced/);
  await assert.rejects(operate("detach-instance", {}, "ni:ni-1"), /renamed or replaced/);
  await assert.rejects(operate("delete-bandwidth", {}, "irb:irb-1"), /renamed or replaced/);
  assert.deepEqual(writes, []);
});

test("instance and route selections must be exact typed strings", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cloudConnectManagement.execute(account, "attach-instance", { cloudConnection: "cc-2", instance: JSON.stringify(["vpc", 5, "sa-brazil-1", "vpc-1"]), cidrs: [vpcCidr] }), /Select a network instance/);
  await assert.rejects(cloudConnectManagement.execute(account, "attach-instance", { cloudConnection: "cc-2", instance: vpcSelection, cidrs: [JSON.stringify(["vpc", "project-1", "sa-brazil-1", "vpc-1"])] }), /Select routes/);
  await assert.rejects(cloudConnectManagement.execute(account, "attach-instance", { cloudConnection: "cc-2", instance: vpcSelection, cidrs: [JSON.stringify({ owner: "vpc-1", cidr: "192.168.0.0/16" })] }), /Select routes/);
  assert.deepEqual(writes, []);
});

test("virtual gateway and VPC catalogs validate ownership, state, and sanitized errors", async (t) => {
  for (const gateway of [{ ...vgwBase, tenant_id: "other-project" }, { ...vgwBase, status: "PENDING" }, { ...vgwBase, tenant_id: undefined }]) {
    t.mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v3/project-1/dcaas/virtual-gateways") return Response.json({ virtual_gateways: [gateway], page_info: { next_marker: "" } });
      return Response.json(read(url));
    });
    const choices = await cloudConnectManagement.options!(account, "attach-instance");
    assert.deepEqual(choices.instances.map((choice) => choice.value), [vpcSelection]);
  }
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v3/project-1/vpc/vpcs") return Response.json({ vpcs: [{ id: "vpc-1", name: "Vpc", cidr: "192.168.0.0/16", status: "DOWN" }], page_info: { next_marker: "" } });
    return Response.json(read(url));
  });
  const choices = await cloudConnectManagement.options!(account, "attach-instance");
  assert.deepEqual(choices.instances.map((choice) => choice.value), [vgwSelection]);
  assert.deepEqual(choices.instanceCidrs.map((choice) => choice.value), [vgwCidr]);
  const updateChoices = await cloudConnectManagement.options!(account, "update-instance", { id: "ni:ni-1", name: "Vpc", status: "ACTIVE" });
  assert.equal(updateChoices.instanceCidrs, undefined);
});

test("Cloud Connect uses its global endpoint and account-wide inventory scope", () => {
  const saved = process.env.HUAWEI_CC_ENDPOINT;
  delete process.env.HUAWEI_CC_ENDPOINT;
  try {
    assert.equal(serviceEndpoint("cc", "sa-brazil-1"), "https://cc.myhuaweicloud.com");
    assert.equal(serviceEndpoint("cc", "cn-north-4"), "https://cc.myhuaweicloud.com");
    assert.equal(cloudConnectManagement.accountWide, true);
  } finally { if (saved !== undefined) process.env.HUAWEI_CC_ENDPOINT = saved; }
});

test("Cloud Connect supports native reciprocal directional records and rejects foreign second directions", async (t) => {
  let bad = false;
  mockCloudWith(t, url => {
    if (url.pathname.endsWith("/inter-region-bandwidths")) return { inter_region_bandwidths: [{ ...irb1, inter_regions: [...irb1.inter_regions, { id: "ir-reverse", local_region_id: "la-south-2", remote_region_id: bad ? "foreign" : "sa-brazil-1" }] }], page_info: { next_marker: "" } };
    return undefined;
  });
  const rows = await cloudConnectManagement.inventory(account);
  assert.equal(rows.find(row => row.id === "irb:irb-1")?.values?.regions, "sa-brazil-1/la-south-2");
  bad = true;
  await assert.rejects(cloudConnectManagement.inventory(account), /unverified inter-region bandwidth region pair/);
});

test("Cloud Connect validates native reciprocal direction acknowledgements after allocation", async (t) => {
  let bad = false, writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) {
      writes++;
      const response = writeResponse(url, init);
      const bandwidth = response.inter_region_bandwidth!;
      const pair = bandwidth.inter_regions![0];
      bandwidth.inter_regions!.push({ local_region_id: pair.remote_region_id, remote_region_id: bad ? "foreign" : pair.local_region_id });
      return Response.json(response);
    }
    return Response.json(read(url));
  });
  const values = { cloudConnection: "cc-1", bandwidthPackage: "pkg-1", regions: ["sa-brazil-1", "na-mexico-1"], bandwidth: 50 };
  assert.equal((await cloudConnectManagement.execute(account, "create-inter-region-bandwidth", values)).asynchronous, true);
  bad = true;
  await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", values), (error: Error) => !(error instanceof ManagementInputError) && /Check native state/.test(error.message));
  assert.equal(writes, 2);
});

test("Cloud Connect network writes refuse disabled or unknown parent administrative state", async (t) => {
  let admin: unknown = false;
  const writes = mockCloudWith(t, url => {
    if (url.pathname.endsWith("/cloud-connections")) return { cloud_connections: [{ ...cc1, admin_state_up: admin }], page_info: { next_marker: "" } };
    if (url.pathname.endsWith("/cloud-connections/cc-1")) return { cloud_connection: { ...cc1, admin_state_up: admin } };
    return undefined;
  });
  for (admin of [false, null, undefined, "true"]) {
    await assert.rejects(cloudConnectManagement.execute(account, "create-inter-region-bandwidth", { cloudConnection: "cc-1", bandwidthPackage: "pkg-1", regions: ["sa-brazil-1", "na-mexico-1"], bandwidth: 50 }), /wait until it is ACTIVE/);
    await assert.rejects(cloudConnectManagement.execute(account, "bind-package", { package: "pkg-2" }, { id: "cc:cc-1", name: "Connection" }), /administratively enabled/);
  }
  assert.equal(writes.length, 0);
});

test("Cloud Connect cannot infer an ACTIVE VPC from missing native status or ignore malformed ownership", async (t) => {
  let patch: Record<string, unknown> = {};
  const writes = mockCloudWith(t, url => {
    if (url.pathname === "/v3/project-1/vpc/vpcs") return { vpcs: [{ id: "vpc-1", name: "Vpc", cidr: "192.168.0.0/16", ...patch }], page_info: { next_marker: "" } };
    return undefined;
  });
  for (patch of [{}, { status: "ACTIVE", project_id: null }, { status: "ACTIVE", project_id: "foreign" }]) {
    await assert.rejects(cloudConnectManagement.execute(account, "attach-instance", { cloudConnection: "cc-2", instance: vpcSelection, cidrs: [vpcCidr] }), /no longer available/);
  }
  assert.equal(writes.length, 0);
});

test("Cloud Connect package options reject unverified applicability and unrelated resource families", async (t) => {
  let patch: Record<string, unknown> = {};
  mockCloudWith(t, url => url.pathname.endsWith("/bandwidth-packages") ? { bandwidth_packages: [{ ...pkg2, ...patch }], page_info: { next_marker: "" } } : undefined);
  for (patch of [{ interflow_mode: undefined }, { interflow_mode: "Region" }, { resource_type: "central_network" }]) {
    const options = await cloudConnectManagement.options!(account, "bind-package", { id: "cc:cc-1", name: "Connection" });
    assert.deepEqual(options.packages, []);
    await assert.rejects(cloudConnectManagement.execute(account, "bind-package", { package: "pkg-2" }, { id: "cc:cc-1", name: "Connection" }), /excluded/);
  }
});

test("Cloud Connect resize revalidates native geographic coverage before writing", async (t) => {
  const writes = mockCloudWith(t, url => url.pathname.endsWith("/bandwidth-packages") ? { bandwidth_packages: [{ ...pkg1, local_area_id: "foreign" }], page_info: { next_marker: "" } } : undefined);
  await assert.rejects(cloudConnectManagement.execute(account, "update-bandwidth", { bandwidth: 90 }, { id: "irb:irb-1", name: "Bandwidth" }), /does not cover/);
  assert.equal(writes.length, 0);
});

test("Cloud Connect metadata descriptions can be explicitly cleared", async (t) => {
  const writes = mockCloud(t);
  await cloudConnectManagement.execute(account, "update-connection", { name: "Connection", description: "" }, { id: "cc:cc-1", name: "Connection" });
  assert.deepEqual(writes[0].body, { cloud_connection: { name: "Connection", description: "" } });
});
