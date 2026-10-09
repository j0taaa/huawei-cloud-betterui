import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test, type TestContext } from "node:test";
import { directConnectManagement } from "@/lib/huawei/management/adapters/direct-connect";
import { validateManagementValues, type ManagementHistoryEntry } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-dc-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));

const gateway1 = { id: "vgw-1", name: "Gateway", vpc_id: "vpc-1", tenant_id: "project-1", status: "ACTIVE", admin_state_up: true, type: "default", local_ep_group: ["192.168.0.0/16"], local_ep_group_ipv6: [], bgp_asn: 64512, enterprise_project_id: "0", device_id: "device-1", redundant_device_id: "device-2" };
const gateway2 = { ...gateway1, id: "vgw-2", name: "Childless" };
const connection = { id: "dc-1", name: "Circuit", status: "ACTIVE", bandwidth: 1000, vlan: 101, location: "Sao Paulo", provider: "Provider", type: "standard", port_type: "10G", admin_state_up: true, provider_status: "ACTIVE" };
const hostedConnection = { ...connection, id: "dc-hosted", name: "Hosted", vlan: 55, type: "hosting" };
const peer4 = { id: "peer-1", vif_id: "vif-1", tenant_id: "project-1", name: "Peer4", address_family: "ipv4", route_mode: "bgp", local_gateway_ip: "10.0.0.1/30", remote_gateway_ip: "10.0.0.2/30", remote_ep_group: ["172.16.0.0/16"], bgp_asn: 65000, bgp_status: "ACTIVE", bgp_route_limit: 100, receive_route_num: 10, enable_bfd: false, enable_nqa: false, status: "ACTIVE", device_id: "device-1" };
const peer6 = { ...peer4, id: "peer-6", name: "Peer6", address_family: "ipv6", local_gateway_ip: "2001:db8::1/126", remote_gateway_ip: "2001:db8::2/126", remote_ep_group: ["2001:db8:aa::/48"] };
const staticPeer = { ...peer4, id: "peer-static", name: "StaticPeer", route_mode: "static", bgp_asn: undefined, bgp_status: undefined };

let gatewayStatus = "ACTIVE";
let gatewayTenant = "project-1";
let vifStatus = "ACTIVE";
let peers: unknown[] = [peer4];

function vifRow() {
  return { id: "vif-1", name: "Interface", vgw_id: "vgw-1", direct_connect_id: "dc-1", tenant_id: "project-1", status: vifStatus, admin_state_up: true, vlan: 101, bandwidth: 100, type: "private", address_family: "ipv4", local_gateway_v4_ip: "10.0.0.1/30", remote_gateway_v4_ip: "10.0.0.2/30", remote_ep_group: ["172.16.0.0/16"], priority: "normal", route_limit: 200, create_time: "2026-01-01 00:00:00", update_time: "2026-01-02 00:00:00", vif_peers: peers };
}

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v3/project-1/dcaas/virtual-gateways") return { virtual_gateways: [{ ...gateway1, status: gatewayStatus }, gateway2], page_info: { next_marker: "" } };
  if (path === "/v3/project-1/dcaas/virtual-gateways/vgw-1") return { virtual_gateway: { ...gateway1, status: gatewayStatus, tenant_id: gatewayTenant } };
  if (path === "/v3/project-1/dcaas/virtual-gateways/vgw-2") return { virtual_gateway: gateway2 };
  if (path === "/v3/project-1/dcaas/virtual-interfaces") {
    const rows = url.searchParams.get("vgw_id") === "vgw-1" ? [vifRow()] : url.searchParams.get("vgw_id") ? [] : [vifRow()];
    return { virtual_interfaces: rows, page_info: { next_marker: "" } };
  }
  if (path === "/v3/project-1/dcaas/virtual-interfaces/vif-1") return { virtual_interface: vifRow() };
  if (path === "/v3/project-1/dcaas/direct-connects") return { direct_connects: [connection, hostedConnection], page_info: { next_marker: "" } };
  if (path === "/v3/project-1/vpc/vpcs") return { vpcs: [{ id: "vpc-1", name: "Vpc", cidr: "192.168.0.0/16", status: "ACTIVE" }, { id: "vpc-other", name: "Other", cidr: "10.0.0.0/16", status: "ACTIVE" }], page_info: { next_marker: "" } };
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", vpc_id: "vpc-1", cidr: "192.168.0.0/24", name: "Subnet", neutron_network_id: "network-1", status: "ACTIVE" },
    { id: "subnet-other", vpc_id: "vpc-other", cidr: "10.0.0.0/24", name: "OtherSubnet", neutron_network_id: "network-other", status: "ACTIVE" },
  ], page_info: { next_marker: "" } };
  throw new Error(`Unexpected GET ${path}`);
}

function writeResponse(url: URL) {
  if (url.pathname === "/v3/project-1/dcaas/virtual-gateways") return { virtual_gateway: { id: "vgw-new", vpc_id: "vpc-1", status: "ACTIVE" } };
  if (url.pathname === "/v3/project-1/dcaas/virtual-interfaces") return { virtual_interface: { id: "vif-new", vgw_id: "vgw-1", direct_connect_id: "dc-1", status: "ACTIVE" } };
  if (url.pathname === "/v3/project-1/dcaas/vif-peers") return { vif_peer: { id: "peer-new", vif_id: "vif-1", address_family: "ipv6", status: "ACTIVE" } };
  if (url.pathname.includes("/vif-peers/")) return { vif_peer: { id: "peer-1" } };
  if (url.pathname.includes("/virtual-gateways/")) return { virtual_gateway: { id: "vgw-1" } };
  if (url.pathname.includes("/virtual-interfaces/")) return { virtual_interface: { id: "vif-1" } };
  throw new Error(`Unexpected write ${url.pathname}`);
}

function mockCloud(t: TestContext) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    writes.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    const response = writeResponse(url);
    if (url.pathname.endsWith("/virtual-interfaces") && init.body) { const body = JSON.parse(String(init.body)).virtual_interface;return Response.json({ virtual_interface: { ...response.virtual_interface, vgw_id: body.vgw_id, direct_connect_id: body.direct_connect_id } }); }
    return Response.json(response);
  });
  return writes;
}

async function operate(operationId: string, values: unknown, resourceId?: string) {
  const operation = directConnectManagement.operations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error(`Unknown operation ${operationId}`);
  const resources = await directConnectManagement.inventory(session);
  const resource = resourceId ? resources.find((item) => item.id === resourceId) : undefined;
  if (resourceId && !resource) throw new Error(`Unknown resource ${resourceId}`);
  const choices = await directConnectManagement.options!(session, operationId, resource);
  return directConnectManagement.execute(session, operationId, validateManagementValues(operation, values, choices), resource);
}

test("inventory lists virtual gateways, interfaces, and embedded peers with prefixed ids", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const resources = await directConnectManagement.inventory(session);
  assert.deepEqual(resources.map((item) => item.id), ["vgw:vgw-1", "vgw:vgw-2", "vif:vif-1", "peer:vif-1/peer-1"]);
  const vif = resources.find((item) => item.id === "vif:vif-1")!;
  assert.equal(vif.values?.routeMode, "bgp");
  assert.equal(vif.values?.vlan, 101);
  assert.equal(vif.values?.bandwidth, 100);
  const peer = resources.find((item) => item.id === "peer:vif-1/peer-1")!;
  assert.equal(peer.values?.family, "ipv4");
  assert.equal(peer.values?.routeMode, "bgp");
});

test("create options offer only active owned connections, active gateways, and project VPC endpoints", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const interfaceChoices = await directConnectManagement.options!(session, "create-interface");
  assert.deepEqual(interfaceChoices.directConnects.map((choice) => choice.value), ["dc-1", "dc-hosted"]);
  assert.ok(interfaceChoices.directConnects.every((choice) => !choice.label.includes("BUILD")));
  assert.deepEqual(interfaceChoices.virtualGateways.map((choice) => choice.value), ["vgw-1", "vgw-2"]);
  const gatewayChoices = await directConnectManagement.options!(session, "create-gateway");
  assert.deepEqual(gatewayChoices.vpcs.map((choice) => choice.value), ["vpc-1", "vpc-other"]);
  assert.deepEqual(gatewayChoices.localSubnets.map((choice) => choice.value), [
    JSON.stringify(["vpc-1", "192.168.0.0/16"]),
    JSON.stringify(["vpc-1", "192.168.0.0/24"]),
    JSON.stringify(["vpc-other", "10.0.0.0/16"]),
    JSON.stringify(["vpc-other", "10.0.0.0/24"]),
  ]);
});

test("gateway creation enforces VPC-scoped local endpoints and emits the native payload", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(operate("create-gateway", { name: "Gateway", vpc: "vpc-1", localSubnets: [JSON.stringify(["vpc-other", "10.0.0.0/24"])] }), /belong to the selected VPC/);
  assert.equal(writes.length, 0);
  const outcome = await operate("create-gateway", { name: "Gateway", vpc: "vpc-1", localSubnets: [JSON.stringify(["vpc-1", "192.168.0.0/24"]), JSON.stringify(["vpc-1", "192.168.0.0/16"])] });
  assert.equal(outcome.resourceId, "vgw:vgw-new");
  assert.deepEqual(writes, [{ path: "/v3/project-1/dcaas/virtual-gateways", method: "POST", body: { virtual_gateway: { vpc_id: "vpc-1", name: "Gateway", local_ep_group: ["192.168.0.0/24", "192.168.0.0/16"] } } }]);
});

test("gateway edits keep endpoints unless replaced and deletion requires zero interfaces", async (t) => {
  const writes = mockCloud(t);
  await operate("update-gateway", { name: "Renamed" }, "vgw:vgw-1");
  assert.deepEqual(writes.at(-1), { path: "/v3/project-1/dcaas/virtual-gateways/vgw-1", method: "PUT", body: { virtual_gateway: { name: "Renamed" } } });
  await operate("update-gateway", { name: "Renamed", localSubnets: [JSON.stringify(["vpc-1", "192.168.0.0/24"])] }, "vgw:vgw-1");
  assert.deepEqual(writes.at(-1)!.body, { virtual_gateway: { name: "Renamed", local_ep_group: ["192.168.0.0/24"] } });
  await assert.rejects(operate("delete-gateway", {}, "vgw:vgw-1"), /still has 1 virtual interface/);
  assert.equal(writes.length, 2);
  const outcome = await operate("delete-gateway", {}, "vgw:vgw-2");
  assert.equal(outcome.resourceId, "vgw:vgw-2");
  assert.deepEqual(writes.at(-1), { path: "/v3/project-1/dcaas/virtual-gateways/vgw-2", method: "DELETE", body: undefined });
});

test("mutations recheck project identity and resource state at execute time", async (t) => {
  const writes = mockCloud(t);
  gatewayTenant = "other-project";
  await assert.rejects(operate("update-gateway", { name: "Renamed" }, "vgw:vgw-1"), /does not belong to the selected project/);
  gatewayTenant = "project-1";
  gatewayStatus = "BUILD";
  await assert.rejects(operate("update-gateway", { name: "Renamed" }, "vgw:vgw-1"), /BUILD/);
  gatewayStatus = "ACTIVE";
  vifStatus = "PENDING_UPDATE";
  await assert.rejects(operate("delete-interface", {}, "vif:vif-1"), /PENDING_UPDATE/);
  vifStatus = "ACTIVE";
  await operate("update-gateway", { name: "Renamed" }, "vgw:vgw-1");
  assert.equal(writes.length, 1);
});

test("interface creation validates routing mode, CIDRs, and hosted VLANs before the native payload", async (t) => {
  const writes = mockCloud(t);
  const values = { name: "Interface", directConnect: "dc-1", virtualGateway: "vgw-1", vlan: 200, bandwidth: 500, routeMode: "bgp", bgpAsn: 65000, bgpMd5: "secret-key", localGatewayIp: "10.0.1.1/30", remoteGatewayIp: "10.0.1.2/30", remoteSubnets: ["172.16.0.0/16"] };
  await assert.rejects(operate("create-interface", { ...values, routeMode: "static", bgpAsn: undefined, bgpMd5: undefined, remoteSubnets: [] }), /Static routing requires/);
  await assert.rejects(operate("create-interface", { ...values, bgpAsn: undefined }), /BGP ASN/);
  await assert.rejects(operate("create-interface", { ...values, remoteSubnets: ["172.16.0.0"] }), /IPv4 CIDR/);
  await assert.rejects(operate("create-interface", { ...values, directConnect: "dc-hosted", vlan: 56 }), /match the connection VLAN/);
  assert.equal(writes.length, 0);
  const outcome = await operate("create-interface", values);
  assert.equal(outcome.resourceId, "vif:vif-new");
  assert.deepEqual(writes, [{ path: "/v3/project-1/dcaas/virtual-interfaces", method: "POST", body: { virtual_interface: { name: "Interface", type: "private", address_family: "ipv4", direct_connect_id: "dc-1", vgw_id: "vgw-1", vlan: 200, bandwidth: 500, route_mode: "bgp", local_gateway_v4_ip: "10.0.1.1/30", remote_gateway_v4_ip: "10.0.1.2/30", bgp_asn: 65000, bgp_md5: "secret-key", remote_ep_group: ["172.16.0.0/16"] } } }]);
  await operate("create-interface", { ...values, directConnect: "dc-hosted", vlan: 55 });
  assert.deepEqual(writes.at(-1)!.body, { virtual_interface: { name: "Interface", type: "private", address_family: "ipv4", direct_connect_id: "dc-hosted", vgw_id: "vgw-1", vlan: 55, bandwidth: 500, route_mode: "bgp", local_gateway_v4_ip: "10.0.1.1/30", remote_gateway_v4_ip: "10.0.1.2/30", bgp_asn: 65000, bgp_md5: "secret-key", remote_ep_group: ["172.16.0.0/16"] } });
});

test("interface edits guard unchanged bandwidth, non-BGP priority, and family-matched subnets", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(operate("update-interface", { name: "Interface", bandwidth: 100 }, "vif:vif-1"), /must differ/);
  peers = [staticPeer];
  await assert.rejects(operate("update-interface", { name: "Interface", priority: "low" }, "vif:vif-1"), /BGP-routed/);
  peers = [peer4];
  const outcome = await operate("update-interface", { name: "Interface", bandwidth: 200, priority: "low", remoteSubnets: ["172.16.0.0/16", "172.17.0.0/16"] }, "vif:vif-1");
  assert.equal(outcome.resourceId, "vif:vif-1");
  assert.deepEqual(writes, [{ path: "/v3/project-1/dcaas/virtual-interfaces/vif-1", method: "PUT", body: { virtual_interface: { name: "Interface", bandwidth: 200, priority: "low", remote_ep_group: ["172.16.0.0/16", "172.17.0.0/16"] } } }]);
  await operate("delete-interface", {}, "vif:vif-1");
  assert.deepEqual(writes.at(-1), { path: "/v3/project-1/dcaas/virtual-interfaces/vif-1", method: "DELETE", body: undefined });
});

test("peer creation enforces the two-peer and one-per-family limits with the native vif-peers payload", async (t) => {
  const writes = mockCloud(t);
  const values = { name: "Peer6", addressFamily: "ipv6", routeMode: "bgp", bgpAsn: 65001, localGatewayIp: "2001:db8::1/126", remoteGatewayIp: "2001:db8::2/126", remoteSubnets: ["2001:db8:aa::/48"] };
  await assert.rejects(operate("create-peer", { ...values, addressFamily: "ipv4", localGatewayIp: "10.0.2.1/30", remoteGatewayIp: "10.0.2.2/30" }, "vif:vif-1"), /already has an ipv4 peer/);
  peers = [peer4, peer6];
  await assert.rejects(operate("create-peer", values, "vif:vif-1"), /maximum of two peers/);
  peers = [peer4];
  const outcome = await operate("create-peer", values, "vif:vif-1");
  assert.equal(outcome.resourceId, "peer:vif-1/peer-new");
  assert.deepEqual(writes, [{ path: "/v3/project-1/dcaas/vif-peers", method: "POST", body: { vif_peer: { name: "Peer6", vif_id: "vif-1", address_family: "ipv6", route_mode: "bgp", local_gateway_ip: "2001:db8::1/126", remote_gateway_ip: "2001:db8::2/126", bgp_asn: 65001, remote_ep_group: ["2001:db8:aa::/48"] } } }]);
});

test("peer edits validate the peer's address family and deletion protects the last peer", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(operate("update-peer", { name: "Peer4", remoteSubnets: ["2001:db8::/64"] }, "peer:vif-1/peer-1"), /IPv4 CIDR/);
  await operate("update-peer", { name: "Peer4", remoteSubnets: ["172.16.0.0/16"] }, "peer:vif-1/peer-1");
  assert.deepEqual(writes.at(-1), { path: "/v3/project-1/dcaas/vif-peers/peer-1", method: "PUT", body: { vif_peer: { name: "Peer4", remote_ep_group: ["172.16.0.0/16"] } } });
  await assert.rejects(operate("delete-peer", {}, "peer:vif-1/peer-1"), /at least one peer/);
  assert.equal(writes.length, 1);
  peers = [peer4, peer6];
  const outcome = await operate("delete-peer", {}, "peer:vif-1/peer-1");
  assert.equal(outcome.resourceId, "peer:vif-1/peer-1");
  assert.deepEqual(writes.at(-1), { path: "/v3/project-1/dcaas/vif-peers/peer-1", method: "DELETE", body: undefined });
});

test("inspect operations report native gateway, interface, and peer facts", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const gateway = await operate("inspect-gateway", {}, "vgw:vgw-1");
  assert.ok(gateway.facts!.some((fact) => fact.label === "VPC" && fact.value === "vpc-1"));
  assert.ok(gateway.facts!.some((fact) => fact.label === "Local endpoints (IPv4)" && fact.value === "192.168.0.0/16"));
  const vif = await operate("inspect-interface", {}, "vif:vif-1");
  assert.ok(vif.facts!.some((fact) => fact.label === "VLAN" && fact.value === "101"));
  assert.ok(vif.facts!.some((fact) => fact.label === "Bandwidth" && fact.value === "100 Mbit/s"));
  assert.ok(vif.facts!.some((fact) => fact.label.startsWith("Peer Peer4")));
  const peer = await operate("inspect-peer", {}, "peer:vif-1/peer-1");
  assert.ok(peer.facts!.some((fact) => fact.label === "BGP status" && fact.value === "ACTIVE"));
  assert.ok(peer.facts!.some((fact) => fact.label === "Routes received" && fact.value === "10"));
});

test("invalid IPv6 literals and multiple CIDR suffixes are rejected before peer creation", async t => {
  peers = [peer4];
  const writes = mockCloud(t);
  const values = { name: "Ipv6", addressFamily: "ipv6", routeMode: "static", localGatewayIp: "2001:db8::1/126", remoteGatewayIp: "2001:db8::2/126", remoteSubnets: ["2001:db8::/64"] };
  for (const localGatewayIp of ["1:2:3", "::::", "2001:db8::1/126/extra"]) await assert.rejects(operate("create-peer", { ...values, localGatewayIp }, "vif:vif-1"), /IPv6|prefix/);
  await assert.rejects(operate("create-peer", { ...values, remoteSubnets: ["2001:db8::/64/extra"] }, "vif:vif-1"), /CIDR prefix/);
  assert.deepEqual(writes, []);
});

test("malformed and duplicate native resource and peer rows cannot hide dependencies", async t => {
  for (const virtual_gateways of [[{ ...gateway1, id: "" }], [gateway1, gateway1]]) {
    t.mock.method(globalThis, "fetch", async (input: string) => Response.json(new URL(input).pathname.endsWith("virtual-gateways") ? { virtual_gateways } : { virtual_interfaces: [] }));
    await assert.rejects(directConnectManagement.inventory(session), /unverified virtual gateway inventory/);
  }
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(new URL(input).pathname.endsWith("virtual-gateways") ? { virtual_gateways: [gateway1] } : { virtual_interfaces: [{ ...vifRow(), vif_peers: [{ ...peer4, vif_id: "foreign" }] }] }));
  await assert.rejects(directConnectManagement.inventory(session), /unverified peer parent/);
});

test("Direct Connect inventory retains all original identities across marker pages", async t => {
  const markers: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("virtual-gateways")) {
      if (!url.searchParams.has("marker")) return Response.json({ virtual_gateways: [gateway1], page_info: { next_marker: "original-marker" } });
      markers.push(url.searchParams.get("marker")!);return Response.json({ virtual_gateways: [gateway2], page_info: { next_marker: "" } });
    }
    return Response.json({ virtual_interfaces: [] });
  });
  assert.deepEqual((await directConnectManagement.inventory(session)).map(row => row.id), ["vgw:vgw-1", "vgw:vgw-2"]);
  assert.deepEqual(markers, ["original-marker"]);
});

test("gateway deletion refuses native interface lists from a different parent", async t => {
  const writes: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes.push(init.method);return Response.json({}); }
    const url = new URL(input);
    if (url.pathname.endsWith("virtual-interfaces")) return Response.json({ virtual_interfaces: [vifRow()] });
    return Response.json(read(url));
  });
  await assert.rejects(directConnectManagement.execute(session, "delete-gateway", {}, { id: "vgw:vgw-2", name: "Childless", status: "ACTIVE" }), /another virtual gateway/);
  assert.deepEqual(writes, []);
});

test("HTTP and malformed-response errors never reveal BGP credentials", async t => {
  for (const response of [Response.json({ error_msg: "private-bgp-password" }, { status: 403 }), Response.json({ error_code: "DC.1", error_msg: "private-bgp-password" }), new Response('{"private-bgp-password":broken')]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(directConnectManagement.inventory(session), error => !String(error).includes("private-bgp-password"));
  }
});

test("unverified creation acknowledgements retain uncertainty after a write", async t => {
  const writes: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes.push(init.method);return Response.json({ virtual_gateway: { id: "foreign", vpc_id: "vpc-other" } }); }
    return Response.json(read(new URL(input)));
  });
  await assert.rejects(operate("create-gateway", { name: "NewGateway", vpc: "vpc-1", localSubnets: [JSON.stringify(["vpc-1", "192.168.0.0/16"])] }), /different VPC/);
  assert.deepEqual(writes, ["POST"]);
});

test("native resource-state observation never treats an ACTIVE resource as completed deletion", async t => {
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "direct-connect", operation: "Delete virtual interface", state: "submitted", startedAt: new Date().toISOString(), jobId: "vif-1", resourceId: "vif:vif-1" };
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  assert.equal((await directConnectManagement.poll!(session, entry)).state, "submitted");
  assert.equal((await directConnectManagement.poll!(session, { ...entry, operation: "Create virtual interface" })).state, "succeeded");
  await assert.rejects(directConnectManagement.poll!(session, { ...entry, jobId: "foreign" }), /different virtual interface identity/);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  assert.equal((await directConnectManagement.poll!(session, entry)).state, "succeeded");
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }));
  await assert.rejects(directConnectManagement.poll!(session, entry), error => (error as { status: number }).status === 403);
});

test("interface writes reject unknown circuit capacity, disabled circuits, and unverified hosted VLANs", async t => {
  const writes: string[] = [];
  let circuit: Record<string, unknown> = { ...hostedConnection, bandwidth: 100 };
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) { writes.push(url.pathname); return Response.json(writeResponse(url)); }
    return Response.json(url.pathname.endsWith("/direct-connects") ? { direct_connects: [circuit] } : read(url));
  });
  const values = { name: "Interface", directConnect: "dc-hosted", virtualGateway: "vgw-1", vlan: 55, bandwidth: 500, routeMode: "static", localGatewayIp: "10.0.1.1/30", remoteGatewayIp: "10.0.1.2/30", remoteSubnets: ["172.16.0.0/16"] };
  await assert.rejects(directConnectManagement.execute(session, "create-interface", values), /capacity/);
  circuit = { ...hostedConnection, bandwidth: "1000" };
  await assert.rejects(directConnectManagement.execute(session, "create-interface", values), /capacity/);
  circuit = { ...hostedConnection, admin_state_up: false };
  await assert.rejects(directConnectManagement.execute(session, "create-interface", values), /administratively enabled/);
  circuit = { ...hostedConnection, vlan: undefined };
  await assert.rejects(directConnectManagement.execute(session, "create-interface", values), /unverified hosted connection VLAN/);
  circuit = { ...connection, tenant_id: "foreign-project" };
  await assert.rejects(directConnectManagement.execute(session, "create-interface", { ...values, directConnect: "dc-1" }), /does not belong/);
  assert.deepEqual(writes, []);
});

test("resource observers reject mismatched operations and ambiguous peer identities before native reads", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { calls.push(input); return Response.json({}); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "direct-connect", operation: "Delete peer", state: "submitted", startedAt: new Date().toISOString(), jobId: "peer-1", resourceId: "peer:vif-1/peer-1/extra" };
  await assert.rejects(directConnectManagement.poll!(session, entry), /Select a virtual interface peer/);
  await assert.rejects(directConnectManagement.poll!(session, { ...entry, jobId: "vgw-1", resourceId: "vgw:vgw-1" }), /different Direct Connect operation identity/);
  assert.deepEqual(calls, []);
});
