import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { enterpriseRouterManagement } from "@/lib/huawei/management/adapters/enterprise-router";
import { vpcEndpointManagement } from "@/lib/huawei/management/adapters/vpc-endpoint";
import { ManagementInputError, validateManagementValues, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { session } from "./fixtures/session";

// Adapter-seam tests: the root registry wires these adapters separately, so
// every case here drives inventory/options/execute directly with fetch mocks
// pinned to the verified native er v3 and vpcep v1 contracts.

const erRouter: ManagementResource = { id: "router:er-1", name: "Router", status: "available" };
const erTable: ManagementResource = { id: "table:er-1/table-1", name: "Custom", status: "available" };
const vpcepService: ManagementResource = { id: "service:svc-1", name: "sa-brazil-1.svc.svc-1", status: "available" };
const vpcepEndpoint: ManagementResource = { id: "endpoint:ep-1", name: "sa-brazil-1.svc.svc-1", status: "accepted" };

const ER_TABLES = [
  { id: "table-default", name: "Default", is_default_association: true, is_default_propagation: true, state: "available" },
  { id: "table-1", name: "Custom", state: "available" },
  { id: "table-2", name: "Spare", state: "available" },
];

function erRead(url: URL) {
  const path = url.pathname;
  if (path.endsWith("/enterprise-router/instances")) return { instances: [{ id: "er-1", name: "Router", state: "available", asn: 64512 }, { id: "er-2", name: "Empty", state: "available" }], page_info: {} };
  if (path.endsWith("/availability-zones")) return { availability_zones: [{ code: "az-1", state: "available" }, { code: "az-2", state: "available" }, { code: "az-3", state: "soldout" }] };
  if (path.endsWith("/er-1/route-tables") || path.endsWith("/er-2/route-tables")) return { route_tables: ER_TABLES, page_info: {} };
  if (path.endsWith("/er-1/vpc-attachments")) {
    if (url.searchParams.get("marker") === "att-1") return { attachments: [{ id: "att-2", name: "Attach 2", state: "available" }], page_info: {} };
    return { attachments: [{ id: "att-1", name: "Attach 1", state: "available" }], page_info: { next_marker: "att-1" } };
  }
  if (path.endsWith("/er-2/vpc-attachments")) return { attachments: [], page_info: {} };
  if (path.endsWith("/route-tables/table-1/associations")) return { associations: [{ id: "assoc-1", attachment_id: "att-1", state: "available" }], page_info: {} };
  if (path.endsWith("/route-tables/table-2/associations")) return { associations: [], page_info: {} };
  if (path.endsWith("/route-tables/table-1/propagations")) return { propagations: [{ id: "prop-1", attachment_id: "att-1", state: "available" }], page_info: {} };
  if (path.endsWith("/route-tables/table-2/propagations")) return { propagations: [], page_info: {} };
  if (path.endsWith("/route-tables/table-1/static-routes")) return { routes: [{ id: "route-1", destination: "10.100.0.0/16", is_blackhole: false, attachments: [{ resource_id: "att-1" }], state: "available" }], page_info: {} };
  if (path.endsWith("/vpc/vpcs")) return { vpcs: [{ id: "vpc-1", name: "Vpc", cidr: "192.168.0.0/16" }] };
  if (path.endsWith("/subnets")) return { subnets: [{ id: "subnet-1", name: "Subnet", vpc_id: "vpc-1", cidr: "192.168.1.0/24", gateway_ip: "192.168.1.1", neutron_network_id: "network-1", neutron_subnet_id: "neutron-subnet-1" }, { id: "subnet-other", name: "Other", vpc_id: "vpc-other", cidr: "10.0.0.0/24", neutron_network_id: "network-other" }] };
  throw Error(`Unexpected ER read ${url}`);
}

function vpcepRead(url: URL) {
  const path = url.pathname;
  if (path.endsWith("/vpc-endpoint-services/public")) return { endpoint_services: [{ id: "pub-1", service_name: "sa-brazil-1.dns.pub-1", service_type: "interface", owner: "ops-domain", is_charge: true }, { id: "pub-gw", service_name: "sa-brazil-1.obs.pub-gw", service_type: "gateway", owner: "ops-domain", is_charge: false }], total_count: 2 };
  if (path.endsWith("/vpc-endpoint-services")) return { endpoint_services: [{ id: "svc-1", service_name: "sa-brazil-1.svc.svc-1", server_type: "LB", vpc_id: "vpc-1", approval_enabled: true, status: "available", service_type: "interface", port_id: "port-lb-1", description: "Own service" }, { id: "svc-2", service_name: "sa-brazil-1.svc.svc-2", server_type: "VM", vpc_id: "vpc-1", approval_enabled: false, status: "available", service_type: "interface", port_id: "port-vm-1" }], total_count: 2 };
  if (path.endsWith("/svc-1/permissions")) return { permissions: [{ id: "perm-1", permission: "iam:domain::6e9dfd51d1124e8d8498dce894923a0d", permission_type: "domainId" }], total_count: 1 };
  if (path.endsWith("/svc-1/connections")) return { connections: [{ id: "ep-2", domain_id: "domain-2", status: "pendingAcceptance" }, { id: "ep-old", domain_id: "domain-3", status: "accepted" }], total_count: 2 };
  if (path.endsWith("/svc-2/connections")) return { connections: [{ id: "ep-rej", domain_id: "domain-4", status: "rejected" }], total_count: 1 };
  if (path.endsWith("/vpc-endpoints")) return { endpoints: [{ id: "ep-1", status: "accepted", endpoint_service_name: "sa-brazil-1.svc.svc-1", vpc_id: "vpc-1", subnet_id: "subnet-1", enable_dns: true, ip: "192.168.1.10" }], total_count: 1 };
  if (path.endsWith("/elb/loadbalancers")) return { loadbalancers: [{ id: "lb-1", name: "Lb", vip_port_id: "port-lb-1", vip_address: "192.168.1.5", vip_subnet_cidr_id: "neutron-subnet-1" }], page_info: {} };
  if (path.endsWith("/ports")) return { ports: [{ id: "port-vm-1", tenant_id: session.projectId, network_id: "network-1", device_owner: "compute:nova", fixed_ips: [{ ip_address: "192.168.1.7" }] }, { id: "port-foreign", tenant_id: "other-project", network_id: "network-1", device_owner: "compute:nova" }] };
  if (path.endsWith("/vpc/vpcs")) return { vpcs: [{ id: "vpc-1", name: "Vpc", cidr: "192.168.0.0/16" }] };
  if (path.endsWith("/subnets")) return { subnets: [{ id: "subnet-1", name: "Subnet", vpc_id: "vpc-1", cidr: "192.168.1.0/24", gateway_ip: "192.168.1.1", neutron_network_id: "network-1", neutron_subnet_id: "neutron-subnet-1" }, { id: "subnet-other", name: "Other", vpc_id: "vpc-other", cidr: "10.0.0.0/24", neutron_network_id: "network-other" }] };
  throw Error(`Unexpected VPCEP read ${url}`);
}

type Write = { method: string; url: string; body?: unknown };

function mockCloud(t: TestContext, read: (url: URL) => Record<string, unknown>, writes: Write[]) {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method || init.method === "GET") return Response.json(read(url));
    writes.push(init.body ? { method: init.method, url: url.pathname, body: JSON.parse(String(init.body)) } : { method: init.method, url: url.pathname });
    if (url.pathname.endsWith("/vpc-endpoints/ep-1")) return new Response(null, { status: 204 });
    return Response.json({});
  });
}

function operationOf(adapter: { operations: ManagementOperation[] }, id: string) {
  const operation = adapter.operations.find(operation => operation.id === id);
  if (!operation) throw Error(`Missing operation ${id}`);
  return operation;
}

test("ER inventory paginates attachments and tags every family", async t => {
  mockCloud(t, erRead, []);
  const resources = await enterpriseRouterManagement.inventory(session);
  assert.deepEqual(resources.filter(r => r.id.startsWith("attachment:er-1/")).map(r => r.id), ["attachment:er-1/att-1", "attachment:er-1/att-2"]);
  assert.ok(resources.some(r => r.id === "router:er-1" && r.status === "available"));
  assert.ok(resources.some(r => r.id === "table:er-1/table-default" && r.values?.default === true));
  assert.ok(resources.every(r => /^(router|table|attachment):/.test(r.id)));
});

test("ER create uses live availability zones and the native instance payload", async t => {
  const writes: Write[] = [];
  mockCloud(t, erRead, writes);
  const choices = await enterpriseRouterManagement.options!(session, "create");
  assert.deepEqual(choices.availabilityZones?.map(c => c.value), ["az-1", "az-2"]);
  await assert.rejects(enterpriseRouterManagement.execute(session, "create", { name: "R", asn: 64512, availabilityZones: ["az-3"] }), /available zones/);
  assert.equal(writes.length, 0);
  const outcome = await enterpriseRouterManagement.execute(session, "create", { name: "R", description: "", asn: 64512, availabilityZones: ["az-1", "az-2"], enableDefaultAssociation: true });
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ method: "POST", url: "/v3/project-1/enterprise-router/instances", body: { instance: { name: "R", description: "", asn: 64512, enable_default_association: true, enable_default_propagation: false, availability_zone_ids: ["az-1", "az-2"] } } }]);
});

test("ER VPC attachment sends the VPC subnet ID and rejects cross-VPC subnets", async t => {
  const writes: Write[] = [];
  mockCloud(t, erRead, writes);
  await assert.rejects(enterpriseRouterManagement.execute(session, "create-attachment", { name: "A", description: "", vpc: "vpc-1", subnet: "subnet-other" }, erRouter), /inside the selected VPC/);
  const outcome = await enterpriseRouterManagement.execute(session, "create-attachment", { name: "A", description: "", vpc: "vpc-1", subnet: "subnet-1", autoCreateVpcRoutes: true }, erRouter);
  assert.equal(outcome.asynchronous, true);
  assert.equal(writes[0].url, "/v3/project-1/enterprise-router/er-1/vpc-attachments");
  assert.deepEqual(writes[0].body, { vpc_attachment: { name: "A", description: "", vpc_id: "vpc-1", virsubnet_id: "subnet-1", auto_create_vpc_routes: true } });
});

test("ER router deletion refuses non-empty routers and deletes empty ones", async t => {
  const writes: Write[] = [];
  mockCloud(t, erRead, writes);
  await assert.rejects(enterpriseRouterManagement.execute(session, "delete", {}, { id: "router:er-1", name: "Router", status: "available" }), /attachment/);
  assert.equal(writes.length, 0);
  const outcome = await enterpriseRouterManagement.execute(session, "delete", {}, { id: "router:er-2", name: "Empty", status: "available" });
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ method: "DELETE", url: "/v3/project-1/enterprise-router/instances/er-2" }]);
});

test("ER route table deletion refuses default and in-use tables", async t => {
  const writes: Write[] = [];
  mockCloud(t, erRead, writes);
  await assert.rejects(enterpriseRouterManagement.execute(session, "delete-table", {}, { id: "table:er-1/table-default", name: "Default", status: "available" }), /default/);
  await assert.rejects(enterpriseRouterManagement.execute(session, "delete-table", {}, erTable), /association/);
  assert.equal(writes.length, 0);
  const outcome = await enterpriseRouterManagement.execute(session, "delete-table", {}, { id: "table:er-1/table-2", name: "Spare", status: "available" });
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ method: "DELETE", url: "/v3/project-1/enterprise-router/er-1/route-tables/table-2" }]);
});

test("ER association and propagation only use currently owned attachments", async t => {
  const writes: Write[] = [];
  mockCloud(t, erRead, writes);
  const choices = await enterpriseRouterManagement.options!(session, "associate", erTable);
  assert.deepEqual(choices.attachments?.map(c => c.value), ["att-1", "att-2"]);
  await assert.rejects(enterpriseRouterManagement.execute(session, "associate", { attachment: "att-foreign" }, erTable), /no longer belongs/);
  await assert.rejects(enterpriseRouterManagement.execute(session, "associate", { attachment: "att-1" }, erTable), /already associated/);
  const outcome = await enterpriseRouterManagement.execute(session, "associate", { attachment: "att-2" }, erTable);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ method: "POST", url: "/v3/project-1/enterprise-router/er-1/route-tables/table-1/associate", body: { attachment_id: "att-2" } }]);
  await assert.rejects(enterpriseRouterManagement.execute(session, "disable-propagation", { propagation: "prop-stale" }, erTable), /no longer belongs/);
  await enterpriseRouterManagement.execute(session, "disable-propagation", { propagation: "prop-1" }, erTable);
  assert.deepEqual(writes[1], { method: "POST", url: "/v3/project-1/enterprise-router/er-1/route-tables/table-1/disable-propagations", body: { attachment_id: "att-1" } });
});

test("ER static routes validate CIDR input, next-hop ownership, and black holes", async t => {
  const writes: Write[] = [];
  mockCloud(t, erRead, writes);
  const operation = operationOf(enterpriseRouterManagement, "create-route");
  assert.throws(() => validateManagementValues(operation, { destination: "300.1.2.3/24", nextHopType: "attachment" }), /invalid format/);
  await assert.rejects(enterpriseRouterManagement.execute(session, "create-route", { destination: "10.200.0.0/16", nextHopType: "attachment", attachment: "att-foreign", description: "" }, erTable), /no longer belongs/);
  await enterpriseRouterManagement.execute(session, "create-route", { destination: "10.200.0.0/16", nextHopType: "attachment", attachment: "att-2", description: "" }, erTable);
  await enterpriseRouterManagement.execute(session, "create-route", { destination: "10.201.0.0/16", nextHopType: "blackhole", description: "" }, erTable);
  assert.deepEqual(writes, [
    { method: "POST", url: "/v3/project-1/enterprise-router/route-tables/table-1/static-routes", body: { route: { destination: "10.200.0.0/16", description: "", attachment_id: "att-2" } } },
    { method: "POST", url: "/v3/project-1/enterprise-router/route-tables/table-1/static-routes", body: { route: { destination: "10.201.0.0/16", description: "", is_blackhole: true } } },
  ]);
  await assert.rejects(enterpriseRouterManagement.execute(session, "delete-route", { route: "route-foreign" }, erTable), /no longer belongs/);
  const outcome = await enterpriseRouterManagement.execute(session, "delete-route", { route: "route-1" }, erTable);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes[2], { method: "DELETE", url: "/v3/project-1/enterprise-router/route-tables/table-1/static-routes/route-1" });
});

test("ER rename is synchronous and targets the native instance path", async t => {
  const writes: Write[] = [];
  mockCloud(t, erRead, writes);
  const outcome = await enterpriseRouterManagement.execute(session, "update", { name: "Renamed", description: "d" }, erRouter);
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ method: "PUT", url: "/v3/project-1/enterprise-router/instances/er-1", body: { instance: { name: "Renamed", description: "d" } } }]);
});

test("VPCEP service creation resolves live backends into the native payload", async t => {
  const writes: Write[] = [];
  mockCloud(t, vpcepRead, writes);
  const choices = await vpcEndpointManagement.options!(session, "create-service");
  assert.deepEqual(choices.backends?.map(c => c.value), ["lb:port-lb-1", "vm:port-vm-1"]);
  await assert.rejects(vpcEndpointManagement.execute(session, "create-service", { name: "svc", serverType: "lb", backend: "vm:port-foreign", clientPort: 443, serverPort: 8443, protocol: "TCP", approvalEnabled: true }), /no longer belongs/);
  const outcome = await vpcEndpointManagement.execute(session, "create-service", { name: "svc", description: "d", serverType: "lb", backend: "lb:port-lb-1", clientPort: 443, serverPort: 8443, protocol: "TCP", approvalEnabled: true });
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ method: "POST", url: "/v1/project-1/vpc-endpoint-services", body: { port_id: "port-lb-1", service_name: "svc", vpc_id: "vpc-1", approval_enabled: true, server_type: "LB", ports: [{ client_port: 443, server_port: 8443, protocol: "TCP" }], description: "d" } }]);
});

test("VPCEP endpoint creation uses the Neutron network ID and live services only", async t => {
  const writes: Write[] = [];
  mockCloud(t, vpcepRead, writes);
  const choices = await vpcEndpointManagement.options!(session, "create-endpoint");
  assert.deepEqual(choices.endpointServices?.map(c => c.value), ["svc-1", "svc-2", "pub-1"]);
  assert.match(choices.endpointServices?.[2].label ?? "", /requester pays/);
  await assert.rejects(vpcEndpointManagement.execute(session, "create-endpoint", { service: "pub-gw", vpc: "vpc-1", subnet: "subnet-1", enableDns: true }), /not available/);
  await assert.rejects(vpcEndpointManagement.execute(session, "create-endpoint", { service: "pub-1", vpc: "vpc-1", subnet: "subnet-other", enableDns: true }), /inside the selected VPC/);
  const outcome = await vpcEndpointManagement.execute(session, "create-endpoint", { service: "pub-1", vpc: "vpc-1", subnet: "subnet-1", enableDns: true, portIp: "192.168.1.10", description: "d" });
  assert.equal(outcome.asynchronous, true);
  assert.match(outcome.message, /requester-paid/);
  assert.deepEqual(writes, [{ method: "POST", url: "/v1/project-1/vpc-endpoints", body: { port_ip: "192.168.1.10", subnet_id: "network-1", endpoint_service_id: "pub-1", vpc_id: "vpc-1", enable_dns: true, description: "d" } }]);
});

test("VPCEP permissions require full iam:domain principals and current entries", async t => {
  const writes: Write[] = [];
  mockCloud(t, vpcepRead, writes);
  const operation = operationOf(vpcEndpointManagement, "add-permission");
  assert.throws(() => validateManagementValues(operation, { permission: "iam:domain::short" }), /invalid format/);
  await assert.rejects(vpcEndpointManagement.execute(session, "add-permission", { permission: "iam:domain::6e9dfd51d1124e8d8498dce894923a0d" }, vpcepService), /already whitelisted/);
  await assert.rejects(vpcEndpointManagement.execute(session, "remove-permission", { permission: "iam:domain::00000000000000000000000000000000" }, vpcepService), /no longer belongs/);
  assert.equal(writes.length, 0);
  await vpcEndpointManagement.execute(session, "remove-permission", { permission: "iam:domain::6e9dfd51d1124e8d8498dce894923a0d" }, vpcepService);
  assert.deepEqual(writes, [{ method: "POST", url: "/v1/project-1/vpc-endpoint-services/svc-1/permissions/action", body: { permissions: ["iam:domain::6e9dfd51d1124e8d8498dce894923a0d"], permission_type: "domainId", action: "remove" } }]);
});

test("VPCEP connection accept and reject only touch fresh pending entries", async t => {
  const writes: Write[] = [];
  mockCloud(t, vpcepRead, writes);
  const choices = await vpcEndpointManagement.options!(session, "accept-connection", vpcepService);
  assert.deepEqual(choices.connections?.map(c => c.value), ["ep-2"]);
  await assert.rejects(vpcEndpointManagement.execute(session, "accept-connection", { connection: "ep-old" }, vpcepService), /no longer pending/);
  await assert.rejects(vpcEndpointManagement.execute(session, "accept-connection", { connection: "ep-foreign" }, vpcepService), /no longer targets/);
  assert.equal(writes.length, 0);
  await vpcEndpointManagement.execute(session, "accept-connection", { connection: "ep-2" }, vpcepService);
  await vpcEndpointManagement.execute(session, "reject-connection", { connection: "ep-2" }, vpcepService);
  assert.deepEqual(writes.map(w => w.body), [{ action: "receive", endpoints: ["ep-2"] }, { action: "reject", endpoints: ["ep-2"] }]);
  assert.ok(writes.every(w => w.url === "/v1/project-1/vpc-endpoint-services/svc-1/connections/action"));
});

test("VPCEP service deletion refuses live connections and passes empty ones", async t => {
  const writes: Write[] = [];
  mockCloud(t, vpcepRead, writes);
  await assert.rejects(vpcEndpointManagement.execute(session, "delete-service", {}, vpcepService), /connection/);
  assert.equal(writes.length, 0);
  const outcome = await vpcEndpointManagement.execute(session, "delete-service", {}, { id: "service:svc-2", name: "sa-brazil-1.svc.svc-2", status: "available" });
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ method: "DELETE", url: "/v1/project-1/vpc-endpoint-services/svc-2" }]);
});

test("VPCEP endpoint inspect and deletion use the native detail paths", async t => {
  const writes: Write[] = [];
  mockCloud(t, url => (url.pathname.endsWith("/vpc-endpoints/ep-1") ? { id: "ep-1", status: "accepted", endpoint_service_name: "sa-brazil-1.svc.svc-1", ip: "192.168.1.10", vpc_id: "vpc-1", subnet_id: "subnet-1", enable_dns: true, marker_id: 7 } : vpcepRead(url)), writes);
  const detail = await vpcEndpointManagement.execute(session, "inspect-endpoint", {}, vpcepEndpoint);
  assert.match(detail.message, /ep-1/);
  assert.ok(detail.facts?.some(fact => fact.label === "Private address" && fact.value === "192.168.1.10"));
  const outcome = await vpcEndpointManagement.execute(session, "delete-endpoint", {}, vpcepEndpoint);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ method: "DELETE", url: "/v1/project-1/vpc-endpoints/ep-1" }]);
});

test("VPCEP inventory tags services and endpoints with live status", async t => {
  mockCloud(t, vpcepRead, []);
  const resources = await vpcEndpointManagement.inventory(session);
  assert.deepEqual(resources.map(r => r.id), ["service:svc-1", "service:svc-2", "endpoint:ep-1"]);
  assert.equal(resources.find(r => r.id === "service:svc-1")?.status, "available");
  assert.equal(resources.find(r => r.id === "endpoint:ep-1")?.status, "accepted");
  assert.equal(resources.find(r => r.id === "service:svc-1")?.values?.approvalEnabled, true);
  assert.equal(resources.find(r => r.id === "service:svc-1")?.values?.name, "");
});

test("VPCEP refuses invalid, foreign-subnet and reserved endpoint private addresses", async t => {
  const writes: Write[] = [];
  mockCloud(t, vpcepRead, writes);
  for (const portIp of ["", "192.168.1.999", "10.0.0.5", "192.168.1.0", "192.168.1.255", "192.168.1.1", "192.168.01.5"]) {
    await assert.rejects(vpcEndpointManagement.execute(session, "create-endpoint", { service: "pub-1", vpc: "vpc-1", subnet: "subnet-1", portIp }), /usable IPv4/);
  }
  assert.equal(writes.length, 0);
});

test("VPCEP update service is synchronous and refuses empty updates", async t => {
  const writes: Write[] = [];
  mockCloud(t, vpcepRead, writes);
  await assert.rejects(vpcEndpointManagement.execute(session, "update-service", {}, vpcepService), /Enter a new/);
  const outcome = await vpcEndpointManagement.execute(session, "update-service", { name: "renamed", approvalEnabled: false }, vpcepService);
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ method: "PUT", url: "/v1/project-1/vpc-endpoint-services/svc-1", body: { service_name: "renamed", approval_enabled: false } }]);
});

test("Foreign selections are rejected by the shared value contract at the seam", async t => {
  mockCloud(t, vpcepRead, []);
  const choices = await vpcEndpointManagement.options!(session, "remove-permission", vpcepService);
  const operation = operationOf(vpcEndpointManagement, "remove-permission");
  assert.throws(() => validateManagementValues(operation, { permission: "iam:domain::ffffffffffffffffffffffffffffffff" }, choices), /not available/);
  const associate = operationOf(enterpriseRouterManagement, "associate");
  assert.throws(() => validateManagementValues(associate, { attachment: "att-foreign" }, { attachments: [{ value: "att-1", label: "a" }] }), /not available/);
  assert.ok(ManagementInputError[Symbol.hasInstance](new ManagementInputError("x")));
});
