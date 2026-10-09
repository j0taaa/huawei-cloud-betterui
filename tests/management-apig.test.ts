import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { apigManagement } from "@/lib/huawei/management/adapters/apig";
import { session } from "./fixtures/session";
const gateway = { id: "gateway-1", project_id: session.projectId, instance_name: "Gateway", status: "Running", charging_mode: 0, cbc_operation_locks: [] };
const group = { id: "group-1", name: "Orders", version: "V1" };
const api = { id: "api-1", name: "ReadOrders", group_id: group.id, req_method: "GET", req_uri: "/orders", auth_type: "IAM", backend_type: "MOCK" };
const environment = { id: "env-1", name: "TEST" };
const resource = { id: gateway.id, name: gateway.instance_name };
const offer = JSON.stringify({ zone: "az-1", spec: "BASIC" });
function read(url: URL): Record<string, unknown> {
  const path = url.pathname;
  if (path.endsWith("/available-zones")) return { available_zones: [{ id: "az-1", name: "Zone 1", specs: { BASIC: true, PROFESSIONAL: false, PLATINUM: true, PLATINUM_X8: true } }] };
  if (path.endsWith("/instances")) return { instances: [gateway], total: 1 };
  if (path.endsWith("/instances/gateway-1")) return gateway;
  if (path.endsWith("/api-groups")) return { groups: [group], total: 1 };
  if (path.endsWith("/apis")) return { apis: [api], total: 1 };
  if (path.endsWith("/apis/api-1")) return api;
  if (path.endsWith("/apis/publish/api-1")) return { api_versions: [{ api_id: api.id, env_id: environment.id, status: 1 }], total: 1 };
  if (path.endsWith("/envs")) return { envs: [environment, { id: "release", name: "RELEASE" }], total: 2 };
  if (path.endsWith("/vpcs")) return { vpcs: [{ id: "vpc-1", name: "Vpc", cidr: "192.168.0.0/16" }], total: 1 };
  if (path.endsWith("/subnets")) return { subnets: [{ id: "subnet-1", name: "Subnet", cidr: "192.168.1.0/24", vpc_id: "vpc-1", neutron_network_id: "network-1" }], total: 1 };
  if (path.endsWith("/security-groups")) return { security_groups: [{ id: "sg-1", name: "Security" }], total: 1 };
  if (path.endsWith("/progress")) return { progress: 100, status: "success" };
  throw new Error(`Unexpected APIG read ${url}`);
}
function mock(t: TestContext, override: (url: URL) => Record<string, unknown> | undefined = () => undefined) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(override(url) ?? read(url));
    writes.push({ path: url.pathname, method: init.method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) }); return Response.json({ id: "created", instance_id: "created-gateway", job_id: "job-1" });
  }); return writes;
}
test("APIG offers include only live supported spec/zone pairs", async t => {
  mock(t); const choices = await apigManagement.options!(session, "create");
  assert.deepEqual(choices.offers.map(choice => JSON.parse(choice.value).spec), ["BASIC", "PLATINUM"]);
});
test("APIG provisioning revalidates offers and uses the Neutron network ID", async t => {
  const writes = mock(t); const values = { name: "Gateway", offer, vpc: "vpc-1", subnet: "subnet-1", securityGroup: "sg-1", bandwidth: 5 };
  await assert.rejects(apigManagement.execute(session, "create", { ...values, offer: JSON.stringify({ zone: "az-1", spec: "PROFESSIONAL" }) }), /no longer available/);
  await assert.rejects(apigManagement.execute(session, "create", { ...values, vpc: "foreign" }), /current VPC/); assert.equal(writes.length, 0);
  const result = await apigManagement.execute(session, "create", values);
  assert.deepEqual(writes[0].body, { instance_name: "Gateway", description: "", spec_id: "BASIC", available_zone_ids: ["az-1"], vpc_id: "vpc-1", subnet_id: "network-1", security_group_id: "sg-1", enterprise_project_id: "0", bandwidth_size: 5, bandwidth_charging_mode: "bandwidth", ipv6_enable: false });
  assert.equal(result.resourceId, "created-gateway"); assert.equal(result.jobId, "job-1"); assert.equal(result.asynchronous, true);
});
test("APIG refuses foreign gateway details before writes", async t => {
  const writes = mock(t, url => url.pathname.endsWith("/instances/gateway-1") ? { ...gateway, project_id: "other" } : undefined);
  await assert.rejects(apigManagement.execute(session, "update", { name: "Renamed" }, resource), /scope could not be verified/); assert.equal(writes.length, 0);
});
test("APIG metadata updates omit maintenance and security configuration", async t => {
  const writes = mock(t); await apigManagement.execute(session, "update", { name: "Renamed", description: "" }, resource);
  assert.deepEqual(writes[0], { path: "/v2/project-1/apigw/instances/gateway-1", method: "PUT", body: { instance_name: "Renamed", description: "" } });
});
test("APIG gateway deletion rejects prepaid, locked and nonempty gateways", async t => {
  let current: Record<string, unknown> = { ...gateway, charging_mode: 1 }; const writes = mock(t, url => url.pathname.endsWith("/instances/gateway-1") ? current : undefined);
  await assert.rejects(apigManagement.execute(session, "delete", {}, resource), /pay-per-use/);
  current = { ...gateway, cbc_operation_locks: [{ lock_scene: "TO_PERIOD_LOCK" }] }; await assert.rejects(apigManagement.execute(session, "delete", {}, resource), /billing locks/);
  current = { ...gateway }; await assert.rejects(apigManagement.execute(session, "delete", {}, resource), /delete their definitions/); assert.equal(writes.length, 0);
});
test("APIG protects RELEASE and groups with current APIs", async t => {
  const writes = mock(t);
  await assert.rejects(apigManagement.execute(session, "delete-environment", { environment: "release" }, resource), /RELEASE/);
  await assert.rejects(apigManagement.execute(session, "delete-group", { group: group.id }, resource), /every API/);
  await assert.rejects(apigManagement.execute(session, "edit-group", { group: "foreign", name: "Updated" }, resource), /no longer belongs/); assert.equal(writes.length, 0);
});
test("APIG creates unpublished HTTPS mock definitions with IAM authentication", async t => {
  const writes = mock(t); await apigManagement.execute(session, "create-api", { name: "ReadOrders", group: group.id, method: "GET", uri: "/orders", backend: "MOCK", response: "[]" }, resource);
  assert.deepEqual(writes[0].body, { name: "ReadOrders", remark: "", group_id: group.id, type: 1, req_protocol: "HTTPS", req_method: "GET", req_uri: "/orders", auth_type: "IAM", cors: false, match_mode: "NORMAL", backend_type: "MOCK", mock_info: { result_content: "[]" } });
});
test("APIG HTTPS backends are fixed URLs with explicit native timeouts and no automatic retries", async t => {
  const writes = mock(t); const values = { name: "ReadOrders", group: group.id, method: "POST", uri: "/orders", backend: "HTTP", timeout: 5000 };
  for (const backendUrl of ["invalid", "http://example.org/api", "https://user:secret@example.org/api", "https://example.org/api?secret=value", "https://example.org/api#fragment"]) await assert.rejects(apigManagement.execute(session, "create-api", { ...values, backendUrl }, resource), /HTTPS/);
  assert.equal(writes.length, 0); await apigManagement.execute(session, "create-api", { ...values, backendUrl: "https://example.org:8443/api" }, resource);
  assert.deepEqual((writes[0].body as { backend_api: unknown }).backend_api, { url_domain: "example.org:8443", req_protocol: "HTTPS", req_method: "POST", req_uri: "/api", timeout: 5000, vpc_channel_status: 2, retry_count: "0" });
});
test("APIG publication revalidates API and environment ownership", async t => {
  const writes = mock(t);
  await assert.rejects(apigManagement.execute(session, "publish", { api: "foreign", environment: environment.id }, resource), /no longer belongs/);
  await assert.rejects(apigManagement.execute(session, "publish", { api: api.id, environment: "foreign" }, resource), /no longer belongs/); assert.equal(writes.length, 0);
  await apigManagement.execute(session, "publish", { api: api.id, environment: environment.id }, resource);
  await apigManagement.execute(session, "offline", { api: api.id, environment: environment.id }, resource);
  assert.deepEqual(writes.map(write => write.body), [{ api_id: api.id, env_id: environment.id, action: "online", remark: "" }, { api_id: api.id, env_id: environment.id, action: "offline", remark: "" }]);
});
test("APIG API deletion checks active native version records and permits inactive history", async t => {
  let status = 1; const writes = mock(t, url => url.pathname.endsWith("/apis/publish/api-1") ? { api_versions: [{ api_id: api.id, env_id: environment.id, status }], total: 1 } : undefined);
  await assert.rejects(apigManagement.execute(session, "delete-api", { api: api.id }, resource), /offline from every/); assert.equal(writes.length, 0);
  status = 2; await apigManagement.execute(session, "delete-api", { api: api.id }, resource); assert.deepEqual(writes[0], { path: "/v2/project-1/apigw/instances/gateway-1/apis/api-1", method: "DELETE" });
});
test("APIG provisioning polling maps native completion, failure, and progress", async t => {
  let status = "success"; mock(t, url => url.pathname.endsWith("/progress") ? { status, progress: 50, error_code: status === "failed" ? "APIC.failed" : null } : undefined);
  const entry = { id: "request", service: "apig", operation: "Create pay-per-use gateway", resourceId: gateway.id, projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted" as const };
  assert.equal((await apigManagement.poll!(session, entry)).state, "succeeded"); status = "failed"; assert.equal((await apigManagement.poll!(session, entry)).state, "failed"); status = "creating"; assert.equal((await apigManagement.poll!(session, entry)).state, "submitted");
});

test("APIG progress inspection and saved outcomes omit private diagnostics", async t => {
  let status = "failed"; mock(t, url => url.pathname.endsWith("/progress") ? { status, progress: "private-progress", error_code: status === "failed" ? "private-code" : null, error_msg: status === "failed" ? "private-message" : null, start_time: "private-time" } : undefined);
  const result = await apigManagement.execute(session, "progress", {}, resource);
  assert.deepEqual(result.facts, [{ label: "Status", value: "Failed" }, { label: "Progress", value: "Unknown" }]);
  const entry = { id: "request", service: "apig", operation: "Create pay-per-use gateway", resourceId: gateway.id, projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted" as const };
  for (status of ["failed", "creating", "success"]) assert.doesNotMatch(JSON.stringify(await apigManagement.poll!(session, entry)), /private/);
});
test("APIG unknown or malformed progress cannot report successful completion", async t => {
  let body: Record<string, unknown> = {}; mock(t, url => url.pathname.endsWith("/progress") ? body : undefined);
  const entry = { id: "request", service: "apig", operation: "Create pay-per-use gateway", resourceId: gateway.id, projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted" as const };
  for (body of [{}, { status: "private-state", progress: 100 }, { status: null }, { error_code: "private-code", error_msg: "private-message" }]) {
    await assert.rejects(apigManagement.execute(session, "progress", {}, resource), /status could not be verified/);
    await assert.rejects(apigManagement.poll!(session, entry), error => error instanceof Error && /status could not be verified/.test(error.message) && !error.message.includes("private"));
  }
});
test("APIG progress rechecks provided identity echoes and the history project", async t => {
  let body: Record<string, unknown> = {}; let reads = 0; mock(t, url => { reads++; return url.pathname.endsWith("/progress") ? body : undefined; });
  const entry = { id: "request", service: "apig", operation: "Create pay-per-use gateway", resourceId: gateway.id, projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted" as const };
  for (const key of ["project_id", "instance_id", "id"]) for (const value of ["foreign", null]) {
    body = { status: "success", progress: 100, [key]: value };
    await assert.rejects(apigManagement.poll!(session, entry), /scope could not be verified/);
    await assert.rejects(apigManagement.execute(session, "progress", {}, resource), /scope could not be verified/);
  }
  const before = reads; await assert.rejects(apigManagement.poll!(session, { ...entry, projectId: "foreign" }), /progress check/); assert.equal(reads, before);
});
test("APIG only displays native integer progress percentages within bounds", async t => {
  let progress: unknown; mock(t, url => url.pathname.endsWith("/progress") ? { status: "creating", progress } : undefined);
  for (progress of [null, false, "50", -1, 101, 0.5, "private-progress"]) assert.equal((await apigManagement.execute(session, "progress", {}, resource)).facts?.[1].value, "Unknown");
  for (progress of [0, 50, 100]) assert.equal((await apigManagement.execute(session, "progress", {}, resource)).facts?.[1].value, `${progress}%`);
});

test("APIG business errors cannot become successful progress outcomes", async t => {
  let body: Record<string, unknown> = {}; mock(t, url => url.pathname.endsWith("/progress") ? body : undefined);
  const entry = { id: "request", service: "apig", operation: "Create pay-per-use gateway", resourceId: gateway.id, projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted" as const };
  for (body of [{ status: "success", error_code: "private-code" }, { status: "creating", error_msg: "private-message" }, { status: "success", error: "private-error" }, { status: "success", error_code: false }]) {
    await assert.rejects(apigManagement.poll!(session, entry), error => error instanceof Error && /response could not be verified/.test(error.message) && !error.message.includes("private"));
  }
});
