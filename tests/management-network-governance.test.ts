import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManagementOperation } from "@/lib/huawei/management";
import { getServiceCoverage } from "@/lib/huawei/management/coverage";
import { createSession, deleteSession } from "@/lib/auth-session";
import { saveManagementHistory, listManagementHistory } from "@/lib/huawei/management/history";
import { withSessionCookie } from "./fixtures/request-context.mjs";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-network-governance-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const body = (operation: string, values = {}, resourceId = "") => ({ requestId: randomUUID(), operation, resourceId, projectId: session.projectId, confirmName: resourceId.startsWith("sg:") ? "Security" : "Network", acknowledgedImpact: true, values });
function networkRead(url: URL) {
  if (url.pathname.endsWith("/vpcs/vpc-1")) return { vpc: { id: "vpc-1", cidr: "192.168.0.0/16" } };
  if (url.pathname.endsWith("/vpcs")) return { vpcs: [{ id: "vpc-1", name: "Network", cidr: "192.168.0.0/16", status: "ACTIVE" }] };
  if (url.pathname.endsWith("/subnets")) return { subnets: [{ id: "subnet-1", name: "Network", vpc_id: "vpc-1", status: "ACTIVE" }] };
  if (url.pathname.endsWith("/security-groups")) return { security_groups: [{ id: "sg-1", name: "Security" }] };
  if (url.pathname.endsWith("/security-group-rules")) return { security_group_rules: [{ id: "rule-1", security_group_id: "sg-1" }, { id: "foreign", security_group_id: "sg-2" }] };
  throw Error(`Unexpected read ${url}`);
}
test("network provisioning rejects public or unaligned VPC CIDRs without writing", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  for (const cidr of ["8.8.0.0/16", "10.1.0.0/8", "172.0.0.0/8", "192.168.1.1/24"]) await assert.rejects(runManagementOperation(session, "network", body("create-vpc", { name: "Network", cidr })), /aligned private/);
  assert.equal(fetch.mock.callCount(), 0);
});
test("subnet creation validates aligned range and excludes network/broadcast gateways", async (t) => {
  const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(networkRead(new URL(input))); writes.push(JSON.parse(String(init.body))); return Response.json({ subnet: { id: "new-subnet" } }); });
  for (const [cidr, gatewayIp] of [["10.0.0.0/24", "10.0.0.1"], ["192.168.1.1/24", "192.168.1.2"], ["192.168.1.0/24", "192.168.1.0"], ["192.168.1.0/24", "192.168.1.255"]]) await assert.rejects(runManagementOperation(session, "network", body("create-subnet", { name: "Subnet", vpcId: "vpc-1", cidr, gatewayIp })), /inside|aligned/);
  assert.equal(writes.length, 0);
  await runManagementOperation(session, "network", body("create-subnet", { name: "Subnet", vpcId: "vpc-1", cidr: "192.168.1.0/24" }));
  assert.deepEqual(writes, [{ subnet: { name: "Subnet", cidr: "192.168.1.0/24", vpc_id: "vpc-1", gateway_ip: "192.168.1.1" } }]);
});
test("subnet update selects the subnet directly and derives its owning VPC", async (t) => {
  const writes: { path: string; body: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(networkRead(new URL(input))); writes.push({ path: new URL(input).pathname, body: JSON.parse(String(init.body)) }); return Response.json({}); });
  await assert.rejects(runManagementOperation(session, "network", body("update-subnet", { name: "Renamed" }, "vpc:vpc-1")), /correct type/);
  await runManagementOperation(session, "network", body("update-subnet", { name: "Renamed" }, "subnet:subnet-1"));
  assert.deepEqual(writes, [{ path: "/v1/project-1/vpcs/vpc-1/subnets/subnet-1", body: { subnet: { name: "Renamed" } } }]);
});
const rule = { direction: "ingress", ethertype: "IPv4", protocol: "tcp", remoteType: "cidr", remoteCidr: "203.0.113.0/24", action: "allow", priority: 100 };
test("security-group rules reject invalid ports, addresses and mismatched ICMP families", async (t) => {
  const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(networkRead(new URL(input))); writes.push(JSON.parse(String(init.body))); return Response.json({}); });
  for (const values of [{ portRange: "65536" }, { portRange: "99-22" }, { portRange: "0" }, { remoteCidr: "999.0.0.1" }, { remoteCidr: "203.0.113.1/33" }, { remoteCidr: "::/0" }, { protocol: "icmpv6" }]) await assert.rejects(runManagementOperation(session, "network", body("add-sg-rule", { ...rule, ...values }, "sg:sg-1")), /Ports|remote|ICMP/);
  assert.equal(writes.length, 0);
  await runManagementOperation(session, "network", body("add-sg-rule", { ...rule, portRange: "22,80-90", remoteCidr: "203.0.113.1" }, "sg:sg-1"));
  assert.deepEqual(writes, [{ security_group_rule: { security_group_id: "sg-1", direction: "ingress", ethertype: "IPv4", action: "allow", priority: 100, protocol: "tcp", multiport: "22,80-90", remote_ip_prefix: "203.0.113.1/32" } }]);
});
test("security-group rule deletion rejects a foreign child even when the provider ignores its filter", async (t) => {
  let deletes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(networkRead(new URL(input))); deletes++; return Response.json({}); });
  await assert.rejects(runManagementOperation(session, "network", body("delete-sg-rule", { ruleId: "foreign" }, "sg:sg-1")), /not found in the selected/);
  assert.equal(deletes, 0);
});
test("KMS inventory distinguishes key algorithm and protects provider default keys", async (t) => {
  const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (new URL(input).pathname.endsWith("list-keys")) { assert.equal(JSON.parse(String(init.body)).key_spec, "ALL"); return Response.json({ key_details: [{ key_id: "key-1", key_alias: "Customer", key_spec: "AES_256", key_type: "1", key_state: "1", origin: "kms", default_key_flag: "0" }, { key_id: "key-default", key_alias: "UnknownServiceKey", key_spec: "AES_256", key_type: "1", key_state: "1", origin: "kms", default_key_flag: "1" }] }); }
    writes.push(JSON.parse(String(init.body))); return Response.json({});
  });
  await runManagementOperation(session, "dew", body("rotation-enable", {}, "key-1"));
  assert.deepEqual(writes, [{ key_id: "key-1" }]);
  await assert.rejects(runManagementOperation(session, "dew", { ...body("disable", {}, "key-default"), confirmName: "UnknownServiceKey" }), /default key/);
  assert.equal(writes.length, 1);
});
test("CTS update preserves existing OBS, encryption, organization, status, and selection settings", async (t) => {
  const tracker = { id: "tracker-1", tracker_name: "system", status: "enabled", is_support_validate: false, lts: { is_lts_enabled: false }, is_organization_tracker: true, management_event_selector: { exclude_service: ["KMS"] }, is_support_trace_files_encryption: true, kms_id: "key-1", obs_info: { bucket_name: "audit-bucket", file_prefix_name: "activity", is_obs_created: true, is_authorized_bucket: true, compress_type: "gzip", is_sort_by_service: false } };
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => { if (!init.method) return Response.json({ trackers: [tracker] }); sent = JSON.parse(String(init.body)); return Response.json({}); });
  await runManagementOperation(session, "cts", body("update", { lts: true, validate: true }, "tracker-1"));
  assert.deepEqual(sent, { tracker_type: "system", tracker_name: "system", status: "enabled", is_organization_tracker: true, management_event_selector: { exclude_service: ["KMS"] }, is_support_trace_files_encryption: true, kms_id: "key-1", is_support_validate: true, is_lts_enabled: true, obs_info: { bucket_name: "audit-bucket", file_prefix_name: "activity", compress_type: "gzip", is_sort_by_service: false, is_obs_created: false } });
});
test("Cloud Eye alarm creation preserves decimal threshold and live metric dimensions", async (t) => {
  const metric = { namespace: "SYS.ECS", metric_name: "cpu_util", dimensions: [{ name: "instance_id", value: "server-1" }], unit: "%" };
  let sent: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(new URL(input).pathname.endsWith("metrics") ? { metrics: [metric] } : { topics: [], total_count: 0 }); sent = JSON.parse(String(init.body)); return Response.json({ alarm_id: "alarm-1" }); });
  const choice = JSON.stringify({ namespace: metric.namespace, metricName: metric.metric_name, dimensions: metric.dimensions, unit: metric.unit });
  const result = await runManagementOperation(session, "ces", body("create", { name: "CPU", metric: choice, period: "300", filter: "average", comparison: ">=", value: 1.5, count: 2, level: "2" }));
  assert.equal(result.resourceId, "alarm-1"); assert.deepEqual(sent.resources, [metric.dimensions]); assert.equal((sent.policies as Record<string, unknown>[])[0].value, 1.5);
});
test("operation polling is limited to this user's recorded job and project", async (t) => {
  const { GET } = await import("@/app/api/cloud/operations/[id]/route");
  const id = randomUUID(); const cookie = createSession(session);
  await saveManagementHistory(session, { id, service: "ecs", operation: "Create server", projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted", jobId: "job-owned" });
  const fetch = t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname, "/v1/project-1/jobs/job-owned"); return Response.json({ status: "SUCCESS", entities: { server_id: "server-new" } }); });
  try {
    const response = await withSessionCookie(cookie, () => GET(new Request("http://localhost"), { params: Promise.resolve({ id }) }));
    assert.equal(response.status, 200); assert.equal((await response.json()).entry.state, "succeeded");
    assert.equal((await listManagementHistory(session, "ecs")).find((entry) => entry.id === id)?.resultResourceId, "server-new");
    const other = await withSessionCookie(cookie, () => GET(new Request("http://localhost"), { params: Promise.resolve({ id: randomUUID() }) }));
    assert.equal(other.status, 404); assert.equal(fetch.mock.callCount(), 1);
  } finally { deleteSession(cookie); }
});
test("coverage includes every catalog item with unique stable table keys", () => {
  const rows = getServiceCoverage();
  assert.equal(rows.length, 78); assert.equal(new Set(rows.map((row) => row.catalogId)).size, rows.length);
  assert.ok(rows.every((row) => row.status !== "Complete" && row.remaining.length));
});

test("CBR checkpoint status is polled with its recorded ID and selected project", async (t) => {
  const { cbrManagement } = await import("@/lib/huawei/management/adapters/cbr");
  const fetch = t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname, "/v3/project-1/checkpoints/checkpoint-owned"); return Response.json({ checkpoint: { status: "available" } }); });
  const outcome = await cbrManagement.poll!(session, { id: randomUUID(), service: "cbr", operation: "Create resource backup", jobId: "checkpoint-owned", projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted" });
  assert.equal(outcome.state, "succeeded"); assert.equal(fetch.mock.callCount(), 1);
});
