import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManagementOperation, getManagementContext } from "@/lib/huawei/management";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-nat-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const body = (operation: string, values = {}) => ({ requestId: randomUUID(), operation, resourceId: "nat-1", projectId: session.projectId, confirmName: "Gateway", acknowledgedImpact: true, values });
function read(url: URL) {
  if (url.pathname.endsWith("nat_gateways")) return { nat_gateways: [{ id: "nat-1", name: "Gateway", status: "ACTIVE", router_id: "vpc-1", admin_state_up: true }] };
  if (url.pathname.endsWith("nat_gateway_specs")) return { specs: ["1", "2"] };
  if (url.pathname.endsWith("vpcs")) return { vpcs: [{ id: "vpc-1", name: "Vpc" }] };
  if (url.pathname.endsWith("subnets")) return { subnets: [{ id: "subnet-1", vpc_id: "vpc-1", neutron_network_id: "network-1", name: "Subnet" }, { id: "subnet-other", vpc_id: "vpc-other", neutron_network_id: "network-other", name: "Other" }] };
  if (url.pathname.endsWith("publicips")) return { publicips: [{ id: "eip-1", alias: "Public", ip_version: 4, status: "DOWN", public_ip_address: "1.2.3.4" }] };
  if (url.pathname.endsWith("snat_rules")) return { snat_rules: [{ id: "snat-1", nat_gateway_id: "nat-1", status: "ACTIVE", floating_ip_id: "eip-1" }, { id: "snat-foreign", nat_gateway_id: "nat-other", status: "ACTIVE" }] };
  if (url.pathname.endsWith("dnat_rules")) return { dnat_rules: [{ id: "dnat-1", nat_gateway_id: "nat-1", status: "ACTIVE", floating_ip_id: "eip-1", port_id: "port-1", external_service_port: 80, internal_service_port: 80 }] };
  if (url.pathname.endsWith("ports")) return { ports: [{ id: "port-1", tenant_id: session.projectId, network_id: "network-1", device_owner: "compute:nova", fixed_ips: [{ ip_address: "192.168.1.10" }] }, { id: "port-foreign", tenant_id: "other-project", network_id: "network-1" }, { id: "port-other-vpc", tenant_id: session.projectId, network_id: "network-other" }] };
  throw Error(`Unexpected NAT read ${url}`);
}
test("NAT creation resolves Neutron network IDs and rejects cross-VPC subnet selection", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({ nat_gateway: { id: "created" } }); });
  const values = { name: "Gateway", description: "", vpc: "vpc-1", subnet: "subnet-other", spec: "1" };
  await assert.rejects(runManagementOperation(session, "nat", body("create", values)), /selected VPC/); assert.equal(sent, undefined);
  const result = await runManagementOperation(session, "nat", body("create", { ...values, subnet: "subnet-1" }));
  assert.equal(result.resourceId, "created");
  assert.deepEqual(sent, { nat_gateway: { name: "Gateway", router_id: "vpc-1", internal_network_id: "network-1", spec: "1", enterprise_project_id: "0" } });
});
test("NAT child selectors reject foreign rules, network ports, and VPCs", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({}); });
  const context = await getManagementContext(session, "nat", session.projectId, "create-dnat", "nat-1");
  assert.deepEqual(context.choices.ports.map(p => p.value), ["port-1"]);
  const values = { eip: "eip-1", port: "port-foreign", protocol: "tcp", internal: 80, external: 80 };
  await assert.rejects(runManagementOperation(session, "nat", body("create-dnat", values)), /not available/);
  await assert.rejects(runManagementOperation(session, "nat", body("delete-snat", { rule: "snat-foreign" })), /not available/);
  await assert.rejects(runManagementOperation(session, "nat", body("create-snat", { subnet: "subnet-other", eip: "eip-1" })), /not available/);
  assert.equal(sent, undefined);
});
test("NAT DNAT validates ANY ports and emits native forwarding payloads", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); assert.equal(new URL(input).pathname, "/v2/project-1/dnat_rules"); sent = JSON.parse(String(init.body)); return Response.json({ dnat_rule: { id: "created-rule" } }); });
  const values = { eip: "eip-1", port: "port-1", protocol: "any", internal: 80, external: 80 };
  await assert.rejects(runManagementOperation(session, "nat", body("create-dnat", values)), /ANY requires/); assert.equal(sent, undefined);
  await runManagementOperation(session, "nat", body("create-dnat", { ...values, protocol: "tcp", external: 8080 }));
  assert.deepEqual(sent, { dnat_rule: { nat_gateway_id: "nat-1", port_id: "port-1", floating_ip_id: "eip-1", protocol: "tcp", internal_service_port: 80, external_service_port: 8080, description: "" } });
});
test("NAT deletion requires both translation rule families to be empty", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); writes++; return Response.json({}); });
  await assert.rejects(runManagementOperation(session, "nat", body("delete")), /every SNAT and DNAT/); assert.equal(writes, 0);
});
test("NAT SNAT uses the current subnet's Neutron network and native source_type", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); assert.equal(new URL(input).pathname, "/v2/project-1/snat_rules"); sent = JSON.parse(String(init.body)); return Response.json({ snat_rule: { id: "created-rule" } }); });
  await runManagementOperation(session, "nat", body("create-snat", { subnet: "subnet-1", eip: "eip-1" }));
  assert.deepEqual(sent, { snat_rule: { nat_gateway_id: "nat-1", network_id: "network-1", source_type: 0, floating_ip_id: "eip-1", description: "" } });
});
test("NAT rule deletion uses its verified gateway parent in the native path", async (t) => {
  let deleted = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); deleted = new URL(input).pathname; return new Response(null, { status: 204 }); });
  await runManagementOperation(session, "nat", body("delete-dnat", { rule: "dnat-1" }));
  assert.equal(deleted, "/v2/project-1/nat_gateways/nat-1/dnat_rules/dnat-1");
});
