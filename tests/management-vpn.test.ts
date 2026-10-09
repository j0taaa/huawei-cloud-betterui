import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { vpnManagement } from "@/lib/huawei/management/adapters/vpn";
import { ManagementInputError, validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { HuaweiApiError } from "@/lib/huawei/http";
import { session } from "./fixtures/session";

const vgwActive = { id: "vgw-1", name: "Edge Gateway", status: "ACTIVE", attachment_type: "vpc", network_type: "public", ip_version: "ipv4", vpc_id: "vpc-1", connect_subnet: "subnet-1", local_subnets: ["192.168.0.0/16"], flavor: "Professional1", availability_zone_ids: ["az-1", "az-2"], ha_mode: "active-active", bgp_asn: 64512, used_connection_number: 2, enterprise_project_id: "0", eip1: { id: "eip-1", ip_address: "100.20.30.40" }, eip2: { id: "eip-2", ip_address: "100.20.30.41" }, created_at: "2026-01-01T10:00:00Z", updated_at: "2026-01-02T10:00:00Z" };
const vgwIdle = { ...vgwActive, id: "vgw-2", name: "Idle Gateway", used_connection_number: 0, eip1: { id: "eip-3", ip_address: "100.20.30.42" }, eip2: undefined };
const vgwBusy = { ...vgwActive, id: "vgw-3", name: "Busy Gateway", status: "PENDING_UPDATE", used_connection_number: 0, eip1: { id: "eip-4", ip_address: "100.20.30.44" }, eip2: undefined };
const vgwGhost = { ...vgwActive, id: "vgw-4", name: "Ghost Gateway", used_connection_number: 0, eip1: { id: "eip-5", ip_address: "100.20.30.45" }, eip2: undefined };
const vgwStandby = { ...vgwActive, id: "vgw-5", name: "Standby Gateway", ha_mode: "active-standby", used_connection_number: 0 };
const gateways = [vgwActive, vgwIdle, vgwBusy, vgwGhost, vgwStandby];
const cgwBranch = { id: "cgw-1", name: "Branch Office", id_type: "ip", id_value: "203.0.113.10", bgp_asn: 65010, created_at: "2026-01-01T11:00:00Z", updated_at: "2026-01-01T11:00:00Z" };
const cgwEmpty = { id: "cgw-2", name: "Empty Peer", id_type: "ip", id_value: "203.0.113.11", created_at: "2026-01-01T12:00:00Z", updated_at: "2026-01-01T12:00:00Z" };
const cgws = [cgwBranch, cgwEmpty];
const ikepolicy = { ike_version: "v2", authentication_algorithm: "sha2-256", encryption_algorithm: "aes-128", dh_group: "group15", lifetime_seconds: 86400 };
const ipsecpolicy = { authentication_algorithm: "sha2-256", encryption_algorithm: "aes-128", pfs: "group15", transform_protocol: "esp", lifetime_seconds: 3600, encapsulation_mode: "tunnel" };
const connNormal = { id: "conn-1", name: "Branch Link", status: "NORMAL", vgw_id: "vgw-1", vgw_ip: "eip-1", style: "policy", cgw_id: "cgw-1", peer_subnets: ["10.10.0.0/16"], tunnel_local_address: "169.254.56.225/30", tunnel_peer_address: "169.254.56.226/30", policy_rules: [{ source: "192.168.0.0/16", destination: ["10.10.0.0/16"] }], ikepolicy, ipsecpolicy, ha_role: "master", connection_monitor_id: "", enterprise_project_id: "0", created_at: "2026-01-03T10:00:00Z", updated_at: "2026-01-03T10:00:00Z" };
const connCreating = { id: "conn-3", name: "Pending Link", status: "CREATING", vgw_id: "vgw-4", vgw_ip: "eip-5", style: "static", cgw_id: "cgw-1", peer_subnets: ["10.20.0.0/16"], ikepolicy, ipsecpolicy, created_at: "2026-01-04T10:00:00Z", updated_at: "2026-01-04T10:00:00Z" };
const connections = [connNormal, connCreating];
const eips = [
  { id: "eip-1", public_ip_address: "100.20.30.40", alias: "Tunnel One", ip_version: 4, status: "DOWN" },
  { id: "eip-2", public_ip_address: "100.20.30.41", alias: "Tunnel Two", ip_version: 4, status: "DOWN" },
  { id: "eip-3", public_ip_address: "100.20.30.42", alias: "Spare", ip_version: 4, status: "DOWN" },
  { id: "eip-bound", public_ip_address: "100.20.30.43", alias: "Bound", ip_version: 4, status: "ACTIVE", port_id: "port-9" },
  { id: "eip-v6", public_ip_address: "2001:db8::1", alias: "V6", ip_version: 6, status: "DOWN" },
];
const azCatalog = { availability_zones: { basic: { vpc: ["az-1"], er: ["az-1"] }, professional1: { vpc: ["az-1", "az-2"], er: ["az-1", "az-2"] }, professional2: { vpc: ["az-2"], er: ["az-2"] }, gm: { vpc: ["az-1"], er: [] }, "Professional1-NonFixedIP": { vpc: ["az-3"], er: [] } } };

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v5/project-1/vpn-gateways/availability-zones") return azCatalog;
  if (path === "/v5/project-1/vpn-gateways") return { vpn_gateways: gateways };
  if (path.startsWith("/v5/project-1/vpn-gateways/")) return { vpn_gateway: gateways.find((gateway) => gateway.id === path.split("/").pop()) ?? {} };
  if (path === "/v5/project-1/customer-gateways") return { customer_gateways: cgws, total_count: cgws.length, page_info: {} };
  if (path.startsWith("/v5/project-1/customer-gateways/")) return { customer_gateway: cgws.find((cgw) => cgw.id === path.split("/").pop()) ?? {} };
  if (path === "/v5/project-1/vpn-connection") return { vpn_connections: connections, total_count: connections.length, page_info: {} };
  if (path.startsWith("/v5/project-1/vpn-connection/")) {
    const record = connections.find((connection) => connection.id === path.split("/").pop());
    return { vpn_connection: record ? { ...record, psk: "SECRETPSK123" } : {} };
  }
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", vpc_id: "vpc-1", name: "App", cidr: "192.168.0.0/24", neutron_network_id: "network-1" },
    { id: "subnet-2", vpc_id: "vpc-2", name: "Other", cidr: "10.0.0.0/24" },
  ] };
  if (path === "/v3/project-1/vpc/vpcs") return { vpcs: [{ id: "vpc-1", name: "Production", cidr: "192.168.0.0/16" }, { id: "vpc-2", name: "Sandbox", cidr: "10.0.0.0/16" }] };
  if (path === "/v3/project-1/eip/publicips") return { publicips: eips };
  throw new Error(`Unexpected GET ${path}`);
}

function writeResponse(url: URL, method: string, body?: unknown) {
  const path = url.pathname;
  if (method === "POST" && path === "/v5/project-1/vpn-gateways") return { vpn_gateway: { id: "vgw-new", name: (body as { vpn_gateway?: { name?: string } })?.vpn_gateway?.name } };
  if (method === "POST" && path === "/v5/project-1/customer-gateways") return { customer_gateway: { id: "cgw-new" } };
  if (method === "POST" && path === "/v5/project-1/vpn-connection") return { vpn_connection: { id: "conn-new", vgw_id: (body as { vpn_connection?: { vgw_id?: string } })?.vpn_connection?.vgw_id, cgw_id: (body as { vpn_connection?: { cgw_id?: string } })?.vpn_connection?.cgw_id } };
  if (method === "POST" && path.endsWith("/reset")) return {};
  if (method === "PUT" && path.startsWith("/v5/project-1/vpn-gateways/")) return { vpn_gateway: { id: path.split("/").pop() } };
  if (method === "PUT" && path.startsWith("/v5/project-1/customer-gateways/")) return { customer_gateway: { id: path.split("/").pop() } };
  if (method === "PUT" && path.startsWith("/v5/project-1/vpn-connection/")) return { vpn_connection: { id: path.split("/").pop() } };
  return {};
}

function mockCloud(t: TestContext, override: (url: URL) => unknown = () => undefined, writeOverride: (url: URL, method: string, body?: unknown) => unknown = () => undefined) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) {
      reads.push(`${url.pathname}${url.search}`);
      const own = override(url);
      return Response.json(own !== undefined ? own : read(url));
    }
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    writes.push({ path: url.pathname, method: init.method, body });
    const own = writeOverride(url, init.method, body);
    return Response.json(own !== undefined ? own : writeResponse(url, init.method, body));
  });
  return { writes, reads };
}

const edgeResource: ManagementResource = { id: "gateway:vgw-1", name: "Edge Gateway", status: "ACTIVE" };
const idleResource: ManagementResource = { id: "gateway:vgw-2", name: "Idle Gateway", status: "ACTIVE" };
const busyResource: ManagementResource = { id: "gateway:vgw-3", name: "Busy Gateway", status: "PENDING_UPDATE" };
const ghostResource: ManagementResource = { id: "gateway:vgw-4", name: "Ghost Gateway", status: "ACTIVE" };
const branchResource: ManagementResource = { id: "cgw:cgw-1", name: "Branch Office", status: "Available" };
const emptyResource: ManagementResource = { id: "cgw:cgw-2", name: "Empty Peer", status: "Available" };
const linkResource: ManagementResource = { id: "connection:conn-1", name: "Branch Link", status: "NORMAL" };
const pendingResource: ManagementResource = { id: "connection:conn-3", name: "Pending Link", status: "CREATING" };
const ikepolicyBody = { ike_version: "v2", authentication_algorithm: "sha2-256", encryption_algorithm: "aes-128", dh_group: "group15", lifetime_seconds: 86400 };
const ipsecpolicyBody = { authentication_algorithm: "sha2-256", encryption_algorithm: "aes-128", pfs: "group15", transform_protocol: "esp", lifetime_seconds: 3600, encapsulation_mode: "tunnel" };
const policyValues: ManagementValues = { ikeVersion: "v2", ikeAuthentication: "sha2-256", ikeEncryption: "aes-128", ikeDhGroup: "group15", ikeLifetime: 86400, ipsecAuthentication: "sha2-256", ipsecEncryption: "aes-128", ipsecPfs: "group15", ipsecLifetime: 3600 };
const createGatewayValues: ManagementValues = { name: "Edge-Two", vpc: "vpc-1", subnet: "subnet-1", localSubnets: "192.168.0.0/16, 172.16.0.0/24", flavor: "Professional1", az1: "az-1", az2: "az-2", haMode: "active-active", eip1: "eip-3", eip2: "eip-2", enterpriseProjectId: "0" };
const baseConnectionValues: ManagementValues = { name: "Branch-Two", gateway: JSON.stringify(["vgw-1", "eip-1"]), cgw: "cgw-1", style: "policy", localSubnets: "192.168.0.0/16", peerSubnets: "10.10.0.0/16, 10.20.0.0/16", psk: "Str0ngPass!1", ...policyValues };
const createConnectionValues: ManagementValues = { ...baseConnectionValues, tunnelLocalAddress: "169.254.56.225/30", tunnelPeerAddress: "169.254.56.226/30" };
const gatewayBody = { vpn_gateway: { name: "Edge-Two", attachment_type: "vpc", network_type: "public", ip_version: "ipv4", ha_mode: "active-active", vpc_id: "vpc-1", connect_subnet: "subnet-1", local_subnets: ["192.168.0.0/16", "172.16.0.0/24"], flavor: "Professional1", availability_zone_ids: ["az-1", "az-2"], eip1: { id: "eip-3" }, eip2: { id: "eip-2" }, enterprise_project_id: "0" } };
const connectionBody = { vpn_connection: { name: "Branch-Two", vgw_id: "vgw-1", vgw_ip: "eip-1", cgw_id: "cgw-1", style: "policy", peer_subnets: ["10.10.0.0/16", "10.20.0.0/16"], psk: "Str0ngPass!1", ikepolicy: ikepolicyBody, ipsecpolicy: ipsecpolicyBody, tunnel_local_address: "169.254.56.225/30", tunnel_peer_address: "169.254.56.226/30", policy_rules: [{ source: "192.168.0.0/16", destination: ["10.10.0.0/16", "10.20.0.0/16"] }] } };

test("inventory maps gateways, customer gateways, and connections with prefixed ids and native statuses", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const resources = await vpnManagement.inventory(session);
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status]), [
    ["gateway:vgw-1", "Edge Gateway", "ACTIVE"],
    ["gateway:vgw-2", "Idle Gateway", "ACTIVE"],
    ["gateway:vgw-3", "Busy Gateway", "PENDING_UPDATE"],
    ["gateway:vgw-4", "Ghost Gateway", "ACTIVE"],
    ["gateway:vgw-5", "Standby Gateway", "ACTIVE"],
    ["cgw:cgw-1", "Branch Office", "Available"],
    ["cgw:cgw-2", "Empty Peer", "Available"],
    ["connection:conn-1", "Branch Link", "NORMAL"],
    ["connection:conn-3", "Pending Link", "CREATING"],
  ]);
  assert.equal(resources[0].values?.kind, "gateway");
  assert.equal(resources[0].values?.connections, 2);
  assert.equal(resources[5].values?.peer, "203.0.113.10");
  assert.equal(resources[7].values?.style, "policy");
  assert.equal(resources[7].values?.vgwEip, "eip-1");
  assert.deepEqual(vpnManagement.invalidationKeys(), ["cloud-summary", "listEips", "listVpnConnections"]);
});

test("native marker pagination collects every customer gateway and connection page", async (t) => {
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    const marker = url.searchParams.get("marker") ?? "";
    if (url.pathname === "/v5/project-1/customer-gateways") {
      requested.push(`${url.pathname}|${marker}`);
      return Response.json(marker ? { customer_gateways: [cgwEmpty], total_count: 2, page_info: {} } : { customer_gateways: [cgwBranch], total_count: 2, page_info: { next_marker: "cgw-1" } });
    }
    if (url.pathname === "/v5/project-1/vpn-connection") {
      requested.push(`${url.pathname}|${marker}`);
      return Response.json(marker ? { vpn_connections: [connCreating], total_count: 2, page_info: {} } : { vpn_connections: [connNormal], total_count: 2, page_info: { next_marker: "conn-1" } });
    }
    if (url.pathname === "/v5/project-1/vpn-gateways") return Response.json({ vpn_gateways: [] });
    throw new Error(`Unexpected GET ${url.pathname}`);
  });
  const resources = await vpnManagement.inventory(session);
  assert.deepEqual(resources.map((item) => item.id), ["cgw:cgw-1", "cgw:cgw-2", "connection:conn-1", "connection:conn-3"]);
  assert.deepEqual(requested.filter((item) => item.startsWith("/v5/project-1/customer-gateways")), ["/v5/project-1/customer-gateways|", "/v5/project-1/customer-gateways|cgw-1"]);
  assert.deepEqual(requested.filter((item) => item.startsWith("/v5/project-1/vpn-connection")), ["/v5/project-1/vpn-connection|", "/v5/project-1/vpn-connection|conn-1"]);
});

test("missing, malformed, or duplicate native rows fail closed instead of hiding inventory entries", async (t) => {
  const cases: Record<string, unknown>[] = [
    { total: 0 },
    { vpn_gateways: [{ name: "No Identifier" }] },
    { vpn_gateways: [{ id: "vgw-1", name: "A" }, { id: "vgw-1", name: "Duplicate" }] },
  ];
  for (const gatewaysBody of cases) {
    t.mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v5/project-1/vpn-gateways") return Response.json(gatewaysBody);
      if (url.pathname === "/v5/project-1/customer-gateways") return Response.json({ customer_gateways: [], page_info: {} });
      if (url.pathname === "/v5/project-1/vpn-connection") return Response.json({ vpn_connections: [], page_info: {} });
      throw new Error(`Unexpected GET ${url.pathname}`);
    });
    await assert.rejects(vpnManagement.inventory(session), /VPN gateway list/);
  }
});

test("gateway create options use the parameterless native AZ catalog with an explicit flavor mapping and unbound IPv4 EIPs only", async (t) => {
  const { reads } = mockCloud(t);
  const choices = await vpnManagement.options!(session, "create");
  assert.ok(reads.includes("/v5/project-1/vpn-gateways/availability-zones"));
  assert.ok(reads.every((item) => !item.startsWith("/v5/project-1/vpn-gateways/availability-zones?")));
  assert.deepEqual(choices.vpcs.map((choice) => choice.value), ["vpc-1", "vpc-2"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual(choices.flavors.map((choice) => choice.value), ["Basic", "Professional1", "Professional2"]);
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1", "az-2"]);
  assert.deepEqual(choices.eips.map((choice) => choice.value), ["eip-1", "eip-2", "eip-3"]);
});

test("gateway create sends the native v5 envelope with explicit documented defaults, live identifiers, and EIP ids", async (t) => {
  const { writes } = mockCloud(t);
  const outcome = await vpnManagement.execute(session, "create", createGatewayValues);
  assert.equal(outcome.resourceId, "gateway:vgw-new");
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, outcome.resourceId!.split(":")[1]);
  assert.match(outcome.message!, /refresh to verify/);
  assert.deepEqual(writes, [{ path: "/v5/project-1/vpn-gateways", method: "POST", body: gatewayBody }]);
});

test("single-zone flavors deploy one AZ and multi-zone flavors require two distinct AZs", async (t) => {
  const { writes } = mockCloud(t);
  const outcome = await vpnManagement.execute(session, "create", { ...createGatewayValues, flavor: "Professional2", az1: "az-2", az2: "", eip2: "" });
  assert.equal(outcome.resourceId, "gateway:vgw-new");
  assert.deepEqual(writes, [{ path: "/v5/project-1/vpn-gateways", method: "POST", body: { vpn_gateway: { name: "Edge-Two", attachment_type: "vpc", network_type: "public", ip_version: "ipv4", ha_mode: "active-active", vpc_id: "vpc-1", connect_subnet: "subnet-1", local_subnets: ["192.168.0.0/16", "172.16.0.0/24"], flavor: "Professional2", availability_zone_ids: ["az-2"], eip1: { id: "eip-3" }, enterprise_project_id: "0" } } }]);
});

test("gateway create rejects forged or unavailable dependencies before any cloud mutation", async (t) => {
  const { writes } = mockCloud(t);
  const fiftyOne = Array.from({ length: 51 }, (_, index) => `10.${Math.floor(index / 250)}.${index % 250}.0/24`);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createGatewayValues, vpc: "vpc-x" }, /VPC is no longer available/],
    [{ ...createGatewayValues, subnet: "subnet-x" }, /subnet is no longer available/],
    [{ ...createGatewayValues, subnet: "subnet-2" }, /does not belong to the selected VPC/],
    [{ ...createGatewayValues, flavor: "Professional9" }, /flavor is no longer available/],
    [{ ...createGatewayValues, flavor: "Professional2", az2: "" }, /not available for this flavor/],
    [{ ...createGatewayValues, flavor: "Professional2", az1: "az-2", az2: "az-1" }, /Only one availability zone is supported/],
    [{ ...createGatewayValues, az2: "" }, /select both/],
    [{ ...createGatewayValues, az2: "az-1" }, /must differ/],
    [{ ...createGatewayValues, haMode: "active-active-ha" }, /supported HA mode/],
    [{ ...createGatewayValues, eip1: "eip-bound" }, /unbound IPv4 EIP/],
    [{ ...createGatewayValues, eip1: "eip-v6" }, /unbound IPv4 EIP/],
    [{ ...createGatewayValues, eip2: "eip-3" }, /second tunnel EIP must differ/],
    [{ ...createGatewayValues, localSubnets: "192.168.0.0" }, /must be a list of IPv4 CIDR blocks/],
    [{ ...createGatewayValues, localSubnets: fiftyOne.join(", ") }, /at most 50/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(vpnManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("gateway create fails closed when the cloud confirms a different gateway name", async (t) => {
  const { writes } = mockCloud(t, () => undefined, (url, method) => method === "POST" && url.pathname === "/v5/project-1/vpn-gateways" ? { vpn_gateway: { id: "vgw-new", name: "Different" } } : undefined);
  await assert.rejects(vpnManagement.execute(session, "create", createGatewayValues), /different VPN gateway name/);
  assert.equal(writes.length, 1);
});

test("gateway inspection reports native facts from the show envelope", async (t) => {
  mockCloud(t);
  const outcome = await vpnManagement.execute(session, "inspect", {}, edgeResource);
  assert.equal(outcome.message, "Current VPN gateway configuration.");
  assert.ok(outcome.facts!.some((fact) => fact.label === "Flavor" && fact.value === "Professional1"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "EIP 1" && fact.value === "100.20.30.40 · eip-1"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "HA mode" && fact.value === "active-active"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Availability zones" && fact.value === "az-1, az-2"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Connections used" && fact.value === "2"));
});

test("gateway update sends partial bodies, verifies the ACK, and stays synchronous", async (t) => {
  const { writes } = mockCloud(t);
  await assert.rejects(vpnManagement.execute(session, "update", { name: "Renamed" }, busyResource), /Wait for a stable state/);
  assert.equal(writes.length, 0);
  const renamed = await vpnManagement.execute(session, "update", { name: "Renamed" }, edgeResource);
  assert.equal(renamed.asynchronous, undefined);
  const subnets = await vpnManagement.execute(session, "update", { name: "Renamed", localSubnets: "10.9.0.0/16" }, edgeResource);
  assert.equal(subnets.asynchronous, undefined);
  assert.deepEqual(writes, [
    { path: "/v5/project-1/vpn-gateways/vgw-1", method: "PUT", body: { vpn_gateway: { name: "Renamed" } } },
    { path: "/v5/project-1/vpn-gateways/vgw-1", method: "PUT", body: { vpn_gateway: { name: "Renamed", local_subnets: ["10.9.0.0/16"] } } },
  ]);
});

test("gateway update fails closed on an unconfirmed ACK identity", async (t) => {
  const { writes } = mockCloud(t, () => undefined, (url, method) => method === "PUT" && url.pathname === "/v5/project-1/vpn-gateways/vgw-1" ? { vpn_gateway: { id: "vgw-9" } } : undefined);
  await assert.rejects(vpnManagement.execute(session, "update", { name: "Renamed" }, edgeResource), /did not confirm the gateway mutation/);
  assert.equal(writes.length, 1);
});

test("gateway deletion requires a fresh exact-name match, a stable state, and no dependent connections", async (t) => {
  const renamedCloud = mockCloud(t, (url) => url.pathname === "/v5/project-1/vpn-gateways/vgw-2" ? { vpn_gateway: { ...vgwIdle, name: "Renamed Gateway" } } : undefined);
  await assert.rejects(vpnManagement.execute(session, "delete", {}, { ...idleResource, name: "Idle Gateway" }), /renamed or the selection is stale/);
  assert.equal(renamedCloud.writes.length, 0);
  const { writes } = mockCloud(t);
  await assert.rejects(vpnManagement.execute(session, "delete", {}, busyResource), /Wait for a stable state/);
  await assert.rejects(vpnManagement.execute(session, "delete", {}, edgeResource), /still use this gateway/);
  await assert.rejects(vpnManagement.execute(session, "delete", {}, ghostResource), /still reference this gateway/);
  assert.equal(writes.length, 0);
  const outcome = await vpnManagement.execute(session, "delete", {}, idleResource);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v5/project-1/vpn-gateways/vgw-2", method: "DELETE", body: undefined }]);
});

test("customer gateway creation sends the native envelope and validates the IPv4 peer identifier and ASN", async (t) => {
  const { writes } = mockCloud(t);
  await assert.rejects(vpnManagement.execute(session, "create-cgw", { name: "Partner", peerAddress: "not-an-ip" }), /must be an IPv4 address/);
  await assert.rejects(vpnManagement.execute(session, "create-cgw", { name: "Partner", peerAddress: "2001:db8::1" }), /must be an IPv4 address/);
  await assert.rejects(vpnManagement.execute(session, "create-cgw", { name: "Partner", peerAddress: "203.0.113.10", bgpAsn: 99999999999 }), /whole number from 1 to 4294967295/);
  assert.equal(writes.length, 0);
  const outcome = await vpnManagement.execute(session, "create-cgw", { name: "Partner", peerAddress: "203.0.113.10", bgpAsn: 65010 });
  assert.equal(outcome.resourceId, "cgw:cgw-new");
  assert.equal(outcome.asynchronous, undefined);
  await vpnManagement.execute(session, "create-cgw", { name: "Partner", peerAddress: "203.0.113.12" });
  assert.deepEqual(writes, [
    { path: "/v5/project-1/customer-gateways", method: "POST", body: { customer_gateway: { name: "Partner", id_type: "ip", id_value: "203.0.113.10", bgp_asn: 65010 } } },
    { path: "/v5/project-1/customer-gateways", method: "POST", body: { customer_gateway: { name: "Partner", id_type: "ip", id_value: "203.0.113.12" } } },
  ]);
});

test("customer gateway creation fails closed without a confirmed ID", async (t) => {
  const { writes } = mockCloud(t, () => undefined, (url, method) => method === "POST" && url.pathname === "/v5/project-1/customer-gateways" ? {} : undefined);
  await assert.rejects(vpnManagement.execute(session, "create-cgw", { name: "Partner", peerAddress: "203.0.113.10" }), /no customer gateway ID/);
  assert.equal(writes.length, 1);
});

test("customer gateway inspection, rename, and guarded deletion use their native routes", async (t) => {
  const { writes } = mockCloud(t);
  const inspection = await vpnManagement.execute(session, "inspect-cgw", {}, branchResource);
  assert.ok(inspection.facts!.some((fact) => fact.label === "Peer identifier" && fact.value === "ip · 203.0.113.10"));
  assert.ok(inspection.facts!.some((fact) => fact.label === "BGP ASN" && fact.value === "65010"));
  await vpnManagement.execute(session, "rename-cgw", { name: "Renamed-Branch" }, branchResource);
  await assert.rejects(vpnManagement.execute(session, "delete-cgw", {}, branchResource), /still reference this customer gateway/);
  const outcome = await vpnManagement.execute(session, "delete-cgw", {}, emptyResource);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, "cgw-2");
  assert.deepEqual(writes, [
    { path: "/v5/project-1/customer-gateways/cgw-1", method: "PUT", body: { customer_gateway: { name: "Renamed-Branch" } } },
    { path: "/v5/project-1/customer-gateways/cgw-2", method: "DELETE", body: undefined },
  ]);
  const renamedCloud = mockCloud(t, (url) => url.pathname === "/v5/project-1/customer-gateways/cgw-2" ? { customer_gateway: { ...cgwEmpty, name: "Renamed Peer" } } : undefined);
  await assert.rejects(vpnManagement.execute(session, "delete-cgw", {}, emptyResource), /renamed or the selection is stale/);
  assert.equal(renamedCloud.writes.length, 0);
});

test("connection create options bundle stable gateways with their bound EIP ids and mark standby roles", async (t) => {
  mockCloud(t);
  const choices = await vpnManagement.options!(session, "create-connection");
  assert.deepEqual(choices.gateways.map((choice) => choice.value), [
    JSON.stringify(["vgw-1", "eip-1"]),
    JSON.stringify(["vgw-1", "eip-2"]),
    JSON.stringify(["vgw-2", "eip-3"]),
    JSON.stringify(["vgw-4", "eip-5"]),
    JSON.stringify(["vgw-5", "eip-1"]),
    JSON.stringify(["vgw-5", "eip-2"]),
  ]);
  assert.ok(choices.gateways.every((choice) => !choice.value.includes("vgw-3")));
  const standbyPeer = choices.gateways.find((choice) => choice.value === JSON.stringify(["vgw-5", "eip-2"]))!;
  assert.match(standbyPeer.label, /Standby Gateway · 100.20.30.41 · standby/);
  const standbyActive = choices.gateways.find((choice) => choice.value === JSON.stringify(["vgw-5", "eip-1"]))!;
  assert.match(standbyActive.label, /Standby Gateway · 100.20.30.40 · active/);
  assert.deepEqual(choices.cgws.map((choice) => choice.value), ["cgw-1", "cgw-2"]);
});

test("connection create sends the native body with the EIP id as vgw_ip for policy, static, and BGP styles", async (t) => {
  const { writes } = mockCloud(t);
  const outcome = await vpnManagement.execute(session, "create-connection", createConnectionValues);
  assert.equal(outcome.resourceId, "connection:conn-new");
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, outcome.resourceId!.split(":")[1]);
  assert.match(outcome.message!, /refresh to verify/);
  await vpnManagement.execute(session, "create-connection", { ...createConnectionValues, style: "static" });
  await vpnManagement.execute(session, "create-connection", { ...createConnectionValues, style: "bgp", tunnelLocalAddress: "", tunnelPeerAddress: "" });
  assert.deepEqual(writes, [
    { path: "/v5/project-1/vpn-connection", method: "POST", body: connectionBody },
    { path: "/v5/project-1/vpn-connection", method: "POST", body: { vpn_connection: { name: "Branch-Two", vgw_id: "vgw-1", vgw_ip: "eip-1", cgw_id: "cgw-1", style: "static", peer_subnets: ["10.10.0.0/16", "10.20.0.0/16"], psk: "Str0ngPass!1", ikepolicy: ikepolicyBody, ipsecpolicy: ipsecpolicyBody, tunnel_local_address: "169.254.56.225/30", tunnel_peer_address: "169.254.56.226/30" } } },
    { path: "/v5/project-1/vpn-connection", method: "POST", body: { vpn_connection: { name: "Branch-Two", vgw_id: "vgw-1", vgw_ip: "eip-1", cgw_id: "cgw-1", style: "bgp", peer_subnets: ["10.10.0.0/16", "10.20.0.0/16"], psk: "Str0ngPass!1", ikepolicy: ikepolicyBody, ipsecpolicy: ipsecpolicyBody } } },
  ]);
});

test("active-standby gateways set ha_role master on the active EIP and slave on the standby EIP", async (t) => {
  const { writes } = mockCloud(t);
  await vpnManagement.execute(session, "create-connection", { ...createConnectionValues, gateway: JSON.stringify(["vgw-5", "eip-2"]) });
  await vpnManagement.execute(session, "create-connection", { ...createConnectionValues, gateway: JSON.stringify(["vgw-5", "eip-1"]) });
  assert.deepEqual(writes.map((write) => (write.body as { vpn_connection: { ha_role?: string } }).vpn_connection.ha_role), ["slave", "master"]);
});

test("IKEv1 connections carry the mandatory native negotiation mode and PFS can be disabled", async (t) => {
  const { writes } = mockCloud(t);
  await vpnManagement.execute(session, "create-connection", { ...createConnectionValues, ikeVersion: "v1" });
  await vpnManagement.execute(session, "create-connection", { ...createConnectionValues, ipsecPfs: "disable" });
  assert.deepEqual(writes.map((write) => (write.body as { vpn_connection: { ikepolicy: unknown; ipsecpolicy: { pfs: string } } }).vpn_connection), [
    { ...connectionBody.vpn_connection, ikepolicy: { ...ikepolicyBody, ike_version: "v1", phase1_negotiation_mode: "main" } },
    { ...connectionBody.vpn_connection, ipsecpolicy: { ...ipsecpolicyBody, pfs: "disable" } },
  ]);
});

test("connection create rejects weak keys, forged parents, missing peer subnets, and invalid policies before any write", async (t) => {
  const { writes } = mockCloud(t);
  const fiftyOne = Array.from({ length: 51 }, (_, index) => `10.${Math.floor(index / 250)}.${index % 250}.0/24`);
  const sixLocals = ["10.0.0.0/8", "10.1.0.0/16", "10.2.0.0/16", "10.3.0.0/16", "10.4.0.0/16", "10.5.0.0/16"];
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createConnectionValues, psk: "alllowercase9" }, /at least three/],
    [{ ...createConnectionValues, psk: "Str0ngPass[1]" }, /outside the supported set/],
    [{ ...createConnectionValues, psk: "short1A" }, /8 to 128 characters/],
    [{ ...createConnectionValues, gateway: "not-json" }, /Select a current gateway/],
    [{ ...createConnectionValues, gateway: JSON.stringify(["vgw-1", "eip-9"]) }, /no longer belongs/],
    [{ ...createConnectionValues, gateway: JSON.stringify(["vgw-3", "eip-4"]) }, /not ACTIVE/],
    [{ ...createConnectionValues, cgw: "cgw-x" }, /different customer gateway/],
    [{ ...createConnectionValues, style: "policy-template" }, /supported routing style/],
    [{ ...createConnectionValues, style: "dynamic" }, /supported routing style/],
    [{ ...createConnectionValues, localSubnets: "" }, /Local subnets is required/],
    [{ ...createConnectionValues, peerSubnets: "" }, /Peer subnets is required/],
    [{ ...createConnectionValues, style: "static", peerSubnets: "" }, /Peer subnets is required/],
    [{ ...createConnectionValues, style: "bgp", peerSubnets: "" }, /Peer subnets is required/],
    [{ ...createConnectionValues, style: "bgp", cgw: "cgw-2" }, /no valid BGP ASN/],
    [{ ...createConnectionValues, peerSubnets: "10.10.0.0" }, /must be a list of IPv4 CIDR blocks/],
    [{ ...createConnectionValues, peerSubnets: fiftyOne.join(", ") }, /at most 50/],
    [{ ...createConnectionValues, localSubnets: sixLocals.join(", ") }, /at most 5/],
    [{ ...createConnectionValues, peerSubnets: "100.64.0.0/10, 10.0.0.0/8" }, /reserved CIDR block 100.64.0.0 \/10/],
    [{ ...createConnectionValues, peerSubnets: "100.64.0.0/12" }, /reserved CIDR block 100.64.0.0 \/10/],
    [{ ...createConnectionValues, peerSubnets: "214.0.0.0/8" }, /reserved CIDR block 214.0.0.0 \/8/],
    [{ ...createConnectionValues, ikeVersion: "IKEv2" }, /supported IKE version/],
    [{ ...createConnectionValues, ikeVersion: "v3" }, /supported IKE version/],
    [{ ...createConnectionValues, ikeLifetime: 30 }, /60 to 604800/],
    [{ ...createConnectionValues, ipsecLifetime: 10 }, /30 to 604800/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(vpnManagement.execute(session, "create-connection", values), expression);
  assert.equal(writes.length, 0);
});

test("tunnel addresses are optional but when provided must be a paired 169.254 /30 host pair", async (t) => {
  const { writes } = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createConnectionValues, tunnelPeerAddress: "" }, /Provide both tunnel addresses/],
    [{ ...createConnectionValues, tunnelLocalAddress: "" }, /Provide both tunnel addresses/],
    [{ ...createConnectionValues, tunnelLocalAddress: "169.254.195.1/30" }, /reserved 169.254.195/],
    [{ ...createConnectionValues, tunnelLocalAddress: "192.168.1.1/30" }, /must start with 169.254/],
    [{ ...createConnectionValues, tunnelLocalAddress: "169.254.56.225/29" }, /\/30 mask/],
    [{ ...createConnectionValues, tunnelPeerAddress: "169.254.57.226/30" }, /same \/30 block/],
    [{ ...createConnectionValues, tunnelLocalAddress: "169.254.56.224/30" }, /two usable host addresses/],
    [{ ...createConnectionValues, tunnelPeerAddress: "169.254.56.225/30" }, /two usable host addresses/],
    [{ ...createConnectionValues, tunnelPeerAddress: "169.254.56.227/30" }, /two usable host addresses/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(vpnManagement.execute(session, "create-connection", values), expression);
  assert.equal(writes.length, 0);
  await vpnManagement.execute(session, "create-connection", { ...createConnectionValues, tunnelLocalAddress: "169.254.56.226/30", tunnelPeerAddress: "169.254.56.225/30" });
  assert.deepEqual((writes[0].body as { vpn_connection: { tunnel_local_address: string; tunnel_peer_address: string } }).vpn_connection, { ...connectionBody.vpn_connection, tunnel_local_address: "169.254.56.226/30", tunnel_peer_address: "169.254.56.225/30" });
});

test("connection create fails closed when the cloud confirms different parents", async (t) => {
  const { writes } = mockCloud(t, () => undefined, (url, method) => method === "POST" && url.pathname === "/v5/project-1/vpn-connection" ? { vpn_connection: { id: "conn-new", vgw_id: "vgw-9", cgw_id: "cgw-1" } } : undefined);
  await assert.rejects(vpnManagement.execute(session, "create-connection", createConnectionValues), /different gateway/);
  assert.equal(writes.length, 1);
});

test("connection inspection reports peer and policy facts and never exposes the preshared key", async (t) => {
  mockCloud(t);
  const outcome = await vpnManagement.execute(session, "inspect-connection", {}, linkResource);
  assert.ok(outcome.facts!.some((fact) => fact.label === "Style" && fact.value === "policy"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Gateway" && fact.value === "vgw-1 · EIP eip-1"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Policy rule 0" && fact.value === "192.168.0.0/16 → 10.10.0.0/16"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "IKE policy" && fact.value.includes("v2")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "IPsec policy" && fact.value.includes("esp")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Tunnel addresses" && fact.value === "169.254.56.225/30 ↔ 169.254.56.226/30"));
  assert.ok(!JSON.stringify(outcome).includes("SECRETPSK123"));
});

test("peer tunnel policy updates send partial native policies and never round-trip masked keys", async (t) => {
  const { writes } = mockCloud(t);
  await assert.rejects(vpnManagement.execute(session, "connection-policy", { ...policyValues, psk: "******" }, linkResource), /masked preshared key/);
  await assert.rejects(vpnManagement.execute(session, "connection-policy", { ...policyValues, psk: "weakkey" }, linkResource), /8 to 128/);
  await assert.rejects(vpnManagement.execute(session, "connection-policy", policyValues, pendingResource), /Wait for a stable state/);
  assert.equal(writes.length, 0);
  const updated = await vpnManagement.execute(session, "connection-policy", policyValues, linkResource);
  assert.equal(updated.asynchronous, undefined);
  await vpnManagement.execute(session, "connection-policy", { ...policyValues, psk: "NewStr0ngKey!7" }, linkResource);
  await vpnManagement.execute(session, "connection-policy", { ...policyValues, psk: "NewStr0ngKey*7" }, linkResource);
  assert.deepEqual(writes, [
    { path: "/v5/project-1/vpn-connection/conn-1", method: "PUT", body: { vpn_connection: { ikepolicy: ikepolicyBody, ipsecpolicy: ipsecpolicyBody } } },
    { path: "/v5/project-1/vpn-connection/conn-1", method: "PUT", body: { vpn_connection: { ikepolicy: ikepolicyBody, ipsecpolicy: ipsecpolicyBody, psk: "NewStr0ngKey!7" } } },
    { path: "/v5/project-1/vpn-connection/conn-1", method: "PUT", body: { vpn_connection: { ikepolicy: ikepolicyBody, ipsecpolicy: ipsecpolicyBody, psk: "NewStr0ngKey*7" } } },
  ]);
});

test("connection rename and reset use native routes with state guards and honest synchronous ACKs", async (t) => {
  const { writes } = mockCloud(t);
  await assert.rejects(vpnManagement.execute(session, "rename-connection", { name: "Renamed-Link" }, pendingResource), /Wait for a stable state/);
  await assert.rejects(vpnManagement.execute(session, "reset-connection", {}, pendingResource), /Wait for a stable state/);
  assert.equal(writes.length, 0);
  const renamed = await vpnManagement.execute(session, "rename-connection", { name: "Renamed-Link" }, linkResource);
  assert.equal(renamed.asynchronous, undefined);
  const reset = await vpnManagement.execute(session, "reset-connection", {}, linkResource);
  assert.equal(reset.asynchronous, undefined);
  assert.match(reset.message!, /verify the connection status afterwards/);
  assert.deepEqual(writes, [
    { path: "/v5/project-1/vpn-connection/conn-1", method: "PUT", body: { vpn_connection: { name: "Renamed-Link" } } },
    { path: "/v5/project-1/vpn-connection/conn-1/reset", method: "POST", body: undefined },
  ]);
});

test("connection deletion requires a fresh exact-name match and a stable state", async (t) => {
  const renamedCloud = mockCloud(t, (url) => url.pathname === "/v5/project-1/vpn-connection/conn-1" ? { vpn_connection: { ...connNormal, name: "Renamed Link" } } : undefined);
  await assert.rejects(vpnManagement.execute(session, "delete-connection", {}, linkResource), /renamed or the selection is stale/);
  assert.equal(renamedCloud.writes.length, 0);
  const { writes } = mockCloud(t);
  await assert.rejects(vpnManagement.execute(session, "delete-connection", {}, pendingResource), /Wait for a stable state/);
  assert.equal(writes.length, 0);
  const outcome = await vpnManagement.execute(session, "delete-connection", {}, linkResource);
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v5/project-1/vpn-connection/conn-1", method: "DELETE", body: undefined }]);
});

test("poll observes native resource states honestly and never trusts a stored job id", async (t) => {
  let gatewayStatus = "PENDING_CREATE";
  let connectionStatus = "CREATING";
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v5/project-1/vpn-gateways/vgw-new") return Response.json({ vpn_gateway: { id: "vgw-new", status: gatewayStatus } });
    if (url.pathname === "/v5/project-1/vpn-connection/conn-1") return Response.json({ vpn_connection: { id: "conn-1", status: connectionStatus } });
    throw new Error(`Unexpected GET ${url.pathname}`);
  });
  const created: ManagementHistoryEntry = { id: randomUUID(), service: "vpn", operation: "Create VPN gateway", startedAt: new Date().toISOString(), state: "submitted", resourceId: "gateway:vgw-new", jobId: "vgw-new" };
  assert.equal((await vpnManagement.poll!(session, created)).state, "submitted");
  gatewayStatus = "ACTIVE";
  assert.equal((await vpnManagement.poll!(session, created)).state, "succeeded");
  gatewayStatus = "ERROR";
  assert.equal((await vpnManagement.poll!(session, created)).state, "failed");
  const link: ManagementHistoryEntry = { ...created, operation: "Create VPN connection", resourceId: "connection:conn-1", jobId: "conn-1" };
  assert.equal((await vpnManagement.poll!(session, link)).state, "submitted");
  connectionStatus = "NORMAL";
  assert.equal((await vpnManagement.poll!(session, link)).state, "succeeded");
  gatewayStatus = "PENDING_CREATE";
  const withJob: ManagementHistoryEntry = { ...created, jobId: "job-1" };
  await assert.rejects(vpnManagement.poll!(session, withJob), /verified original/);
  gatewayStatus = "ACTIVE";
  await assert.rejects(vpnManagement.poll!(session, withJob), /verified original/);
  await assert.rejects(vpnManagement.poll!(session, { ...created, resourceId: "bogus" }), /not a native gateway, customer gateway, or connection/);
});

test("poll treats deletion as complete only when the resource is gone (404), not while it still exists", async (t) => {
  const gatewayStatus = "ACTIVE";
  const connectionStatus = "NORMAL";
  let gone = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (gone) return new Response("{}", { status: 404 });
    const url = new URL(input);
    if (url.pathname === "/v5/project-1/vpn-gateways/vgw-2") return Response.json({ vpn_gateway: { id: "vgw-2", status: gatewayStatus } });
    if (url.pathname === "/v5/project-1/vpn-connection/conn-1") return Response.json({ vpn_connection: { id: "conn-1", status: connectionStatus } });
    throw new Error(`Unexpected GET ${url.pathname}`);
  });
  const removed: ManagementHistoryEntry = { id: randomUUID(), service: "vpn", operation: "Delete VPN gateway", startedAt: new Date().toISOString(), state: "submitted", resourceId: "gateway:vgw-2", jobId: "vgw-2" };
  assert.equal((await vpnManagement.poll!(session, removed)).state, "submitted");
  const removedLink: ManagementHistoryEntry = { ...removed, operation: "Delete connection", resourceId: "connection:conn-1", jobId: "conn-1" };
  assert.equal((await vpnManagement.poll!(session, removedLink)).state, "submitted");
  gone = true;
  assert.equal((await vpnManagement.poll!(session, removed)).state, "succeeded");
  assert.equal((await vpnManagement.poll!(session, removedLink)).state, "succeeded");
  const vanished: ManagementHistoryEntry = { ...removed, operation: "Create VPN gateway" };
  assert.equal((await vpnManagement.poll!(session, vanished)).state, "failed");
});

test("unsupported or mismatched operations fail closed without touching the cloud", async (t) => {
  const { writes } = mockCloud(t);
  await assert.rejects(vpnManagement.execute(session, "attach-eip", {}, edgeResource), /Unsupported VPN operation/);
  await assert.rejects(vpnManagement.execute(session, "inspect", {}, branchResource), /Select a current VPN gateway/);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live gateway and connection choices and enforces native bounds", async (t) => {
  mockCloud(t);
  const operation = vpnManagement.operations.find((item) => item.id === "create")!;
  const choices = await vpnManagement.options!(session, "create");
  const values = validateManagementValues(operation, createGatewayValues, choices);
  assert.equal(values.name, "Edge-Two");
  assert.equal(values.haMode, "active-active");
  assert.throws(() => validateManagementValues(operation, { ...createGatewayValues, flavor: "Professional9" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createGatewayValues, eip1: "eip-bound" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createGatewayValues, eip1: "eip-v6" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createGatewayValues, haMode: "active-active-ha" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createGatewayValues, enterpriseProjectId: "default" }, choices), /invalid format/);
  const connectionOperation = vpnManagement.operations.find((item) => item.id === "create-connection")!;
  const connectionChoices = await vpnManagement.options!(session, "create-connection");
  const connectionValues = validateManagementValues(connectionOperation, createConnectionValues, connectionChoices);
  assert.equal(connectionValues.style, "policy");
  assert.equal(connectionValues.ikeVersion, "v2");
  assert.throws(() => validateManagementValues(connectionOperation, { ...createConnectionValues, gateway: JSON.stringify(["vgw-3", "eip-4"]) }, connectionChoices), /not available/);
  assert.throws(() => validateManagementValues(connectionOperation, { ...createConnectionValues, style: "dynamic" }, connectionChoices), /not available/);
  assert.throws(() => validateManagementValues(connectionOperation, { ...createConnectionValues, ikeVersion: "IKEv2" }, connectionChoices), /not available/);
  assert.throws(() => validateManagementValues(connectionOperation, { ...createConnectionValues, psk: "short" }, connectionChoices), /invalid format/);
});

test("outcomes and rejection errors never expose the preshared key while the wire body carries it", async (t) => {
  const { writes } = mockCloud(t);
  const weak = "alllowercase9";
  await assert.rejects(vpnManagement.execute(session, "create-connection", { ...createConnectionValues, psk: weak }), (error: Error) => !error.message.includes(weak));
  const secret = "Str0ngPass!1";
  const outcome = await vpnManagement.execute(session, "create-connection", createConnectionValues);
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal(writes.length, 1);
  assert.equal((writes[0].body as { vpn_connection: { psk: string } }).vpn_connection.psk, secret);
});


test("VPN private HTTP, business, and malformed response payloads are sanitized", async t => {
  for (const response of [new Response("PRIVATE_NATIVE", { status: 403 }), Response.json({ error_code: "PRIVATE_NATIVE", error_msg: "PRIVATE_NATIVE" }), new Response("PRIVATE_NATIVE", { status: 200 })]) {
    t.mock.method(globalThis, "fetch", async () => response.clone());
    await assert.rejects(vpnManagement.inventory(session), (error: Error) => !error.message.includes("PRIVATE_NATIVE") && (response.status !== 403 || error instanceof HuaweiApiError && error.status === 403));
  }
});

test("VPN supplied project owners must match on inventory and detail", async t => {
  for (const project_id of ["foreign", null, ""]) {
    mockCloud(t, url => url.pathname.endsWith("/vpn-gateways") ? { vpn_gateways: [{ ...vgwIdle, project_id }] } : url.pathname.endsWith("/vpn-gateways/vgw-2") ? { vpn_gateway: { ...vgwIdle, project_id } } : undefined);
    await assert.rejects(vpnManagement.inventory(session), /another project/);
    await assert.rejects(vpnManagement.execute(session, "delete", {}, idleResource), /another project/);
  }
});

test("VPN connection creation and policy updates require the verified PSK gateway schema", async t => {
  for (const patch of [{ flavor: "GM" }, { ip_version: "ipv6" }, { attachment_type: "er" }, { network_type: "private" }, { ha_mode: undefined }]) {
    const { writes } = mockCloud(t, url => url.pathname.endsWith("/vpn-gateways/vgw-1") ? { vpn_gateway: { ...vgwActive, ...patch } } : undefined);
    await assert.rejects(vpnManagement.execute(session, "create-connection", createConnectionValues), /different native connection schema/);
    await assert.rejects(vpnManagement.execute(session, "connection-policy", createConnectionValues, linkResource), /different native policy schema/);
    assert.equal(writes.length, 0);
  }
});

test("VPN BGP connections require a known native gateway ASN", async t => {
  for (const bgp_asn of [null, undefined, "", 0, 4294967296]) {
    const { writes } = mockCloud(t, url => url.pathname.endsWith("/vpn-gateways/vgw-1") ? { vpn_gateway: { ...vgwActive, bgp_asn } } : undefined);
    await assert.rejects(vpnManagement.execute(session, "create-connection", { ...createConnectionValues, style: "bgp" }), /verified BGP ASN/);
    assert.equal(writes.length, 0);
  }
});

test("VPN history polling rejects unrelated operations and original resource identities", async t => {
  const { reads } = mockCloud(t);
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "vpn", operation: "Delete VPN gateway", startedAt: new Date().toISOString(), state: "submitted", resourceId: "gateway:vgw-2", jobId: "vgw-2" };
  for (const patch of [{ operation: "Delete something else" }, { operation: "Reset tunnel" }, { jobId: "another" }, { resourceId: "connection:vgw-2" }]) await assert.rejects(vpnManagement.poll!(session, { ...entry, ...patch }), /verified original/);
  assert.equal(reads.length, 0);
});

test("VPN gateway deletion blocks unknown native dependency counts", async t => {
  for (const used_connection_number of [null, undefined, "", -1]) {
    const { writes } = mockCloud(t, url => url.pathname.endsWith("/vpn-gateways/vgw-2") ? { vpn_gateway: { ...vgwIdle, used_connection_number } } : undefined);
    await assert.rejects(vpnManagement.execute(session, "delete", {}, idleResource), /connection count is unverified/);
    assert.equal(writes.length, 0);
  }
});

test("VPN dependency inventory and AZ choices reject missing parents and duplicate native zones", async t => {
  mockCloud(t, url => url.pathname.endsWith("/vpn-connection") ? { vpn_connections: [{ ...connNormal, cgw_id: undefined }], page_info: {} } : undefined);
  await assert.rejects(vpnManagement.inventory(session), /parent identities/);
  mockCloud(t, url => url.pathname.endsWith("/availability-zones") ? { availability_zones: { professional1: { vpc: ["az-1", "az-1"] } } } : undefined);
  await assert.rejects(vpnManagement.options!(session, "create"), /incomplete VPN zone catalog/);
});

test("VPN mutation acknowledgements from another project remain uncertain", async t => {
  mockCloud(t, undefined, () => ({ vpn_gateway: { id: "vgw-new", project_id: "foreign" } }));
  await assert.rejects(vpnManagement.execute(session, "create", createGatewayValues), (error: Error) => !(error instanceof ManagementInputError) && /may have been accepted/.test(error.message));
});
