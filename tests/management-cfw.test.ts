import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ManagementInputError } from "@/lib/management-contract";
import { HuaweiApiError } from "@/lib/huawei/http";
import { cfwManagement } from "@/lib/huawei/management/adapters/cfw";
import { session } from "./fixtures/session";
import { listCloudFirewallsForProject } from "@/lib/huawei/services/cfw";

const fw = { fw_instance_id: "11111111-1111-1111-1111-111111111111", resource_id: "11111111-1111-1111-1111-111111111111", name: "1700000000000", fw_instance_name: "edge-fwl", enterprise_project_id: "0", ha_type: 1, charge_mode: 1, service_type: 0, engine_type: 1, flavor: { version: 1, eip_count: 50, vpc_count: 5, bandwidth: 100, log_storage: 100 }, status: 2, tags: "" };
const fw2 = { ...fw, fw_instance_id: "22222222-2222-2222-2222-222222222222", resource_id: "22222222-2222-2222-2222-222222222222", fw_instance_name: "second-fwl", name: "1700000000001" };
const object0 = { object_id: "aaaaaaaa-0000-0000-0000-000000000000", object_name: "Internet border", type: 0 };
const object1 = { object_id: "bbbbbbbb-0000-0000-0000-000000000000", object_name: "VPC border", type: 1 };
const natObject = { object_id: "cccccccc-1111-1111-1111-111111111111", object_name: "NAT border", type: 2 };
const detailRecord = { fw_instance_id: fw.fw_instance_id, name: fw.name, ha_type: 1, charge_mode: 1, service_type: 0, engine_type: 1, flavor: fw.flavor, protect_objects: [object0, object1], status: 2, is_old_firewall_instance: false };
const detailRecord2 = { ...detailRecord, fw_instance_id: fw2.fw_instance_id, protect_objects: [] };
const addrSet = { set_id: "cccccccc-0000-0000-0000-000000000000", ref_count: 0, description: "Trusted ranges", address_type: 0, object_id: object0.object_id, address_set_type: 0, name: "trusted-sources" };
const svcSet = { set_id: "dddddddd-0000-0000-0000-000000000000", name: "web-ports", description: "", service_set_type: 0, ref_count: 1, project_id: session.projectId, protocols: [6] };
const addrItem = { item_id: "eeeeeeee-0000-0000-0000-000000000000", name: "office", description: "", address_type: 0, address: "8.8.8.0/24" };
const svcItem = { item_id: "ffffffff-0000-0000-0000-000000000000", protocol: 6, source_port: "0", dest_port: "443", description: "HTTPS" };
const rule = { rule_id: "77777777-0000-0000-0000-000000000000", order_id: 1, applications: [], address_type: 0, name: "allow-office", direction: 0, action_type: 0, status: 1, description: "", long_connect_time: 0, long_connect_enable: 0, long_connect_time_hour: 0, long_connect_time_minute: 0, long_connect_time_second: 0, source: { type: 0, address_type: 0, address: "8.8.8.0/24" }, destination: { type: 0, address_type: 0, address: "0.0.0.0/0" }, service: { type: 0, protocol: 6, source_port: "0", dest_port: "443" }, type: 0, created_date: "2026-01-01T00:00:00Z", modified_date: "2026-01-01T00:00:00Z", tag: null };
const fwResource = { id: `fw:${fw.fw_instance_id}`, name: fw.fw_instance_name, status: "Running" };
const fw2Resource = { id: `fw:${fw2.fw_instance_id}`, name: fw2.fw_instance_name, status: "Running" };
const addrResource = { id: `addr:${fw.fw_instance_id}:${object0.object_id}:${addrSet.set_id}`, name: addrSet.name };
const svcResource = { id: `svc:${fw.fw_instance_id}:${object0.object_id}:${svcSet.set_id}`, name: svcSet.name };
const ruleValues = { protectionObject: object0.object_id, name: "block-inbound", action: "1", direction: "0", source: "8.8.8.0/24", destination: "0.0.0.0/0", protocol: "6", sourcePort: "0", destPort: "443", description: "" };
const ruleEntry = { id: "00000000-0000-0000-0000-000000000000", service: "cfw", operation: "Add ACL rule", startedAt: "2026-01-01T00:00:00Z", state: "submitted" as const, resourceId: fwResource.id };

function read(url: URL): Record<string, unknown> {
  const path = url.pathname;
  const query = url.searchParams;
  if (path === "/v1/project-1/firewall/exist") {
    if (query.get("fw_instance_id") === fw.fw_instance_id) return { data: { limit: 100, offset: 0, total: 1, records: [detailRecord] } };
    if (query.get("fw_instance_id") === fw2.fw_instance_id) return { data: { limit: 100, offset: 0, total: 1, records: [detailRecord2] } };
    throw new Error(`Unexpected exist query ${path}`);
  }
  if (path === "/v1/project-1/acl-rules") return { data: { offset: 0, limit: 100, total: query.get("object_id") === object0.object_id ? 1 : 0, object_id: query.get("object_id"), up_rules_count: 0, records: query.get("object_id") === object0.object_id ? [rule] : [] } };
  if (path === "/v1/project-1/address-sets") return { data: { offset: 0, limit: 100, total: query.get("object_id") === object0.object_id ? 1 : 0, records: query.get("object_id") === object0.object_id ? [addrSet] : [] } };
  if (path === "/v1/project-1/service-sets") return { data: { offset: 0, limit: 100, total: query.get("object_id") === object0.object_id ? 1 : 0, records: query.get("object_id") === object0.object_id ? [svcSet] : [] } };
  if (path === "/v1/project-1/address-items") return { data: { offset: 0, limit: 100, total: 1, set_id: query.get("set_id"), records: [addrItem] } };
  if (path === "/v1/project-1/service-items") return { data: { offset: 0, limit: 100, total: 1, set_id: query.get("set_id"), records: [svcItem] } };
  if (path.startsWith("/v3/project-1/jobs/")) return { data: { id: path.split("/").at(-1), status: "Running", begin_time: "2026-01-01T00:00:00Z", end_time: null } };
  throw new Error(`Unexpected GET ${path}`);
}

function writeResponse(url: URL, body: unknown): Record<string, unknown> {
  const path = url.pathname;
  const request = (body ?? {}) as { rules?: { name?: string }[]; name?: string; bypass_operation?: number; object_id?: string };
  if (path === "/v2/project-1/firewall") return { job_id: "job-create-1", order_id: "", data: body };
  if (path.startsWith("/v2/project-1/firewall/")) return { data: "job-delete-1" };
  if (path === "/v1/project-1/acl-rule") return { data: { rules: [{ id: "rule-new", name: request.rules?.[0]?.name ?? "ack" }] } };
  if (path.startsWith("/v1/project-1/acl-rule/")) return { data: { id: path.split("/").at(-1), name: "ack" } };
  if (path.endsWith("/operation")) return { data: { protection_status: request.bypass_operation === 1 ? 2 : 0, id: fw.fw_instance_id, object_id: object0.object_id }, fail_reason: "" };
  if (path === "/v1/project-1/firewall/east-west/protect") return { data: { id: request.object_id } };
  if (path === "/v1/project-1/address-set") return { data: { id: "addr-set-new", name: request.name } };
  if (path.startsWith("/v1/project-1/address-sets/")) return { data: { id: path.split("/").at(-1), name: request.name ?? "ack" } };
  if (path === "/v1/project-1/address-items") return { data: { items: [{ id: "addr-item-new" }], covered_ip: [] } };
  if (path.startsWith("/v1/project-1/address-items/")) return { data: { id: path.split("/").at(-1), name: "ack" } };
  if (path === "/v1/project-1/service-set") return { data: { id: "svc-set-new", name: request.name } };
  if (path.startsWith("/v1/project-1/service-sets/")) return { data: { id: path.split("/").at(-1), name: request.name ?? "ack" } };
  if (path === "/v1/project-1/service-items") return { data: { items: [{ id: "svc-item-new" }] } };
  if (path.startsWith("/v1/project-1/service-items/")) return { data: { id: path.split("/").at(-1), name: "ack" } };
  throw new Error(`Unexpected write ${path}`);
}

type Hook = (url: URL, init: RequestInit, body?: unknown) => Record<string, unknown> | Response | undefined;

function cloud(t: TestContext, hook?: Hook) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  const lists: number[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    if (url.pathname.endsWith("/firewalls/list")) {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      const hooked = hook?.(url, init, body);
      if (hooked instanceof Response) return hooked;
      if (hooked) return Response.json(hooked);
      lists.push(Number(body.offset ?? 0));
      return Response.json({ data: { limit: 100, offset: Number(body.offset ?? 0), project_id: session.projectId, total: 2, records: [fw, fw2] } });
    }
    if (!init.method || init.method === "GET") {
      const hooked = hook?.(url, init);
      if (hooked instanceof Response) return hooked;
      return Response.json(hooked ?? read(url));
    }
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    writes.push({ path: url.pathname, method: init.method, body });
    const hooked = hook?.(url, init, body);
    if (hooked instanceof Response) return hooked;
    return Response.json(hooked ?? writeResponse(url, body));
  });
  return { writes, lists };
}

/** One mutable ACL rule shape served by the acl-rules list, for roundtrip and observer tests. */
function ruleCloud(t: TestContext, getShape: () => Record<string, unknown>) {
  return cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), up_rules_count: 0, records: [getShape()] } } : undefined);
}

const notInputError = (error: unknown) => { assert.ok(error instanceof Error); assert.ok(!(error instanceof ManagementInputError)); return true; };

test("CFW inventory lists firewalls and custom groups with canonical parent-qualified IDs", async t => {
  const { writes } = cloud(t);
  const resources = await cfwManagement.inventory(session);
  assert.deepEqual(resources.map(resource => resource.id), [`fw:${fw.fw_instance_id}`, `fw:${fw2.fw_instance_id}`, `addr:${fw.fw_instance_id}:${object0.object_id}:${addrSet.set_id}`, `svc:${fw.fw_instance_id}:${object0.object_id}:${svcSet.set_id}`]);
  assert.equal(resources[0].status, "Running");
  assert.equal(resources[0].values?.chargeMode, "Pay-per-use");
  assert.equal(writes.length, 0);
});

test("CFW firewall inventory paginates the native in-body offset list", async t => {
  const offsets: number[] = [];
  cloud(t, (url, init, body) => {
    if (!url.pathname.endsWith("/firewalls/list")) return undefined;
    const offset = Number((body as { offset?: number } | undefined)?.offset ?? 0);
    offsets.push(offset);
    return { data: { limit: 100, offset, project_id: session.projectId, total: 2, records: offset === 0 ? [fw] : [fw2] } };
  });
  const resources = await cfwManagement.inventory(session);
  assert.deepEqual(offsets, [0, 1]);
  assert.deepEqual(resources.filter(resource => resource.id.startsWith("fw:")).map(resource => resource.name), [fw.fw_instance_name, fw2.fw_instance_name]);
});

test("CFW inventory rejects missing arrays, untyped totals, foreign projects, and bad IDs", async t => {
  let mode = "records-missing";
  cloud(t, url => {
    if (!url.pathname.endsWith("/firewalls/list")) return undefined;
    if (mode === "records-missing") return { data: { limit: 100, offset: 0, project_id: session.projectId, total: 2 } };
    if (mode === "total-string") return { data: { limit: 100, offset: 0, project_id: session.projectId, total: "2", records: [fw] } };
    if (mode === "foreign-project") return { data: { limit: 100, offset: 0, project_id: "other-project", total: 1, records: [fw] } };
    if (mode === "empty-id") return { data: { limit: 100, offset: 0, project_id: session.projectId, total: 1, records: [{ ...fw, fw_instance_id: "" }] } };
    return { data: { limit: 100, offset: 0, project_id: session.projectId, total: 2, records: [fw, { ...fw }] } };
  });
  mode = "records-missing"; await assert.rejects(cfwManagement.inventory(session), /incomplete Cloud Firewall inventory page/);
  mode = "total-string"; await assert.rejects(cfwManagement.inventory(session), /incomplete Cloud Firewall inventory page/);
  mode = "foreign-project"; await assert.rejects(cfwManagement.inventory(session), /unverifiable Cloud Firewall project scope/);
  mode = "empty-id"; await assert.rejects(cfwManagement.inventory(session), /unverifiable Cloud Firewall identity/);
  mode = "duplicate"; await assert.rejects(cfwManagement.inventory(session), /duplicate Cloud Firewall identities/);
});

test("CFW creates only typed pay-per-use Professional firewalls after a live support check", async t => {
  let supported = true;
  const { writes } = cloud(t, url => url.pathname.endsWith("/firewalls/list") ? { data: { limit: 100, offset: 0, project_id: session.projectId, total: 0, records: [] }, is_support_postpaid: supported } : undefined);
  supported = false;
  await assert.rejects(cfwManagement.execute(session, "create-firewall", { name: "edge-two" }), /not available/);
  assert.equal(writes.length, 0);
  supported = true;
  const result = await cfwManagement.execute(session, "create-firewall", { name: "edge-two" });
  assert.equal(result.jobId, "job-create-1");
  assert.equal(result.asynchronous, true);
  assert.match(result.message, /"edge-two"/);
  assert.deepEqual(writes[0], { path: "/v2/project-1/firewall", method: "POST", body: { name: "edge-two", flavor: { version: "Professional" }, charge_info: { charge_mode: "postPaid" } } });
});

test("CFW creation without a verified native job ID reports an uncertain outcome, not an input error", async t => {
  const { writes } = cloud(t, url => {
    if (url.pathname.endsWith("/firewalls/list")) return { data: { limit: 100, offset: 0, project_id: session.projectId, total: 0, records: [] }, is_support_postpaid: true };
    if (url.pathname === "/v2/project-1/firewall") return { order_id: "order-1" };
    return undefined;
  });
  await assert.rejects(cfwManagement.execute(session, "create-firewall", { name: "edge-two" }), error => notInputError(error) && /no verified creation job/.test(String(error)));
  assert.equal(writes.length, 1);
});

test("CFW firewall deletion verifies fresh exact name, pay-per-use billing, and a stable running state", async t => {
  let mode = "ok";
  const { writes } = cloud(t, url => {
    if (!url.pathname.endsWith("/firewalls/list")) return undefined;
    if (mode === "prepaid") return { data: { limit: 100, offset: 0, project_id: session.projectId, total: 1, records: [{ ...fw, charge_mode: 0 }] } };
    if (mode === "creating") return { data: { limit: 100, offset: 0, project_id: session.projectId, total: 1, records: [{ ...fw, status: 0 }] } };
    return { data: { limit: 100, offset: 0, project_id: session.projectId, total: 1, records: [fw] } };
  });
  mode = "prepaid"; await assert.rejects(cfwManagement.execute(session, "delete-firewall", {}, fwResource), /order cancellation/);
  mode = "creating"; await assert.rejects(cfwManagement.execute(session, "delete-firewall", {}, fwResource), /stable running state/);
  mode = "ok"; await assert.rejects(cfwManagement.execute(session, "delete-firewall", {}, { ...fwResource, name: "stale-name" }), /renamed since selection/);
  const result = await cfwManagement.execute(session, "delete-firewall", {}, fwResource);
  assert.equal(result.jobId, "job-delete-1");
  assert.equal(result.asynchronous, true);
  assert.equal(result.resourceId, fwResource.id);
  assert.equal(writes[0].path, `/v2/project-1/firewall/${fw.resource_id}`);
  assert.equal(writes[0].method, "DELETE");
});

test("CFW poll whitelists labels, verifies job echoes, and never derives creation identities from names", async t => {
  let jobStatus = "Running";
  let echoOk = true;
  let listHasFw = true;
  cloud(t, url => {
    if (url.pathname.startsWith("/v3/project-1/jobs/")) {
      const id = url.pathname.split("/").at(-1)!;
      return { data: { id: echoOk ? id : "other-job", status: jobStatus, begin_time: "2026-01-01T00:00:00Z", end_time: null } };
    }
    if (url.pathname.endsWith("/firewalls/list")) return { data: { limit: 100, offset: 0, project_id: session.projectId, total: listHasFw ? 2 : 1, records: listHasFw ? [fw, fw2] : [fw2] } };
    return undefined;
  });
  const entry = { id: "00000000-0000-0000-0000-000000000000", service: "cfw", operation: "Create pay-per-use cloud firewall", startedAt: "2026-01-01T00:00:00Z", state: "submitted" as const, jobId: "job-create-1", message: `Pay-per-use cloud firewall creation submitted for "${fw.fw_instance_name}".` };
  await assert.rejects(cfwManagement.poll!(session, { ...entry, operation: "Inspect firewall and protection objects" }), /progress check/);
  await assert.rejects(cfwManagement.poll!(session, { ...entry, jobId: undefined }), /job ID/);
  jobStatus = "Running";
  assert.equal((await cfwManagement.poll!(session, entry)).state, "submitted");
  echoOk = false;
  await assert.rejects(cfwManagement.poll!(session, entry), error => notInputError(error) && /different cloud firewall job/.test(String(error)));
  echoOk = true;
  jobStatus = "Success";
  const created = await cfwManagement.poll!(session, entry);
  assert.equal(created.state, "succeeded");
  assert.equal(created.resourceId, undefined);
  assert.match(created.message ?? "", /does not return its resource ID/);
  jobStatus = "Failed";
  assert.equal((await cfwManagement.poll!(session, entry)).state, "failed");
  jobStatus = "Success";
  const deleteEntry = { ...entry, operation: "Delete pay-per-use firewall", resourceId: `fw:${fw.fw_instance_id}`, jobId: "job-delete-1" };
  listHasFw = true;
  assert.equal((await cfwManagement.poll!(session, deleteEntry)).state, "submitted");
  listHasFw = false;
  assert.equal((await cfwManagement.poll!(session, deleteEntry)).state, "succeeded");
});

test("CFW ACL rules use typed native enums and real IP/CIDR validation without invented border scopes", async t => {
  const { writes } = cloud(t);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "not-an-ip" }, fwResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, destination: "1.2.3.4/5/6" }, fwResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "10.0.0.0/33" }, fwResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, direction: "" }, fwResource), /Direction is required/);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, destPort: "70000" }, fwResource), /port/);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, destination: "2001:db8::/32" }, fwResource), /same IP version/);
  assert.equal(writes.length, 0);
  const result = await cfwManagement.execute(session, "create-rule", ruleValues, fwResource);
  assert.equal(result.resourceId, fwResource.id);
  assert.deepEqual(writes[0], { path: "/v1/project-1/acl-rule", method: "POST", body: { object_id: object0.object_id, type: 0, rules: [{ name: "block-inbound", address_type: 0, action_type: 1, status: 1, description: "", direction: 0, source: { type: 0, address_type: 0, address: "8.8.8.0/24" }, destination: { type: 0, address_type: 0, address: "0.0.0.0/0" }, service: { type: 0, protocol: 6, source_port: "0", dest_port: "443" } }] } });
});

test("CFW VPC border rules omit direction and accept public and private addresses", async t => {
  const { writes } = cloud(t);
  const result = await cfwManagement.execute(session, "create-rule", { protectionObject: object1.object_id, name: "vpc-rule", action: "0", source: "10.1.0.0/16", destination: "10.2.0.0/16", protocol: "17", sourcePort: "0", destPort: "0", description: "" }, fwResource);
  assert.equal(result.resourceId, fwResource.id);
  assert.deepEqual(writes[0].body, { object_id: object1.object_id, type: 1, rules: [{ name: "vpc-rule", address_type: 0, action_type: 0, status: 1, description: "", source: { type: 0, address_type: 0, address: "10.1.0.0/16" }, destination: { type: 0, address_type: 0, address: "10.2.0.0/16" }, service: { type: 0, protocol: 17, source_port: "0", dest_port: "0" } }] });
  assert.ok(!("direction" in (writes[0].body as { rules: Record<string, unknown>[] }).rules[0]));
  await cfwManagement.execute(session, "create-rule", { protectionObject: object1.object_id, name: "vpc-public", action: "0", source: "8.8.8.0/24", destination: "9.9.9.0/24", protocol: "6", sourcePort: "0", destPort: "0", description: "" }, fwResource);
  assert.deepEqual((writes[1].body as { rules: Record<string, unknown>[] }).rules[0].source, { type: 0, address_type: 0, address: "8.8.8.0/24" });
});

test("CFW rule status changes preserve the verified current configuration and reject unverifiable shapes", async t => {
  let ruleShape: Record<string, unknown> = rule;
  const { writes } = cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), up_rules_count: 0, records: [ruleShape] } } : undefined);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await cfwManagement.execute(session, "rule-status", values, fwResource);
  assert.equal(writes[0].path, `/v1/project-1/acl-rule/${rule.rule_id}`);
  assert.equal(writes[0].method, "PUT");
  assert.deepEqual(writes[0].body, { name: rule.name, description: rule.description, direction: rule.direction, action_type: rule.action_type, address_type: rule.address_type, applications: rule.applications, long_connect_enable: rule.long_connect_enable, long_connect_time: rule.long_connect_time, long_connect_time_hour: rule.long_connect_time_hour, long_connect_time_minute: rule.long_connect_time_minute, long_connect_time_second: rule.long_connect_time_second, type: rule.type, source: { type: 0, address_type: 0, address: "8.8.8.0/24" }, destination: { type: 0, address_type: 0, address: "0.0.0.0/0" }, service: { type: 0, protocol: 6, source_port: "0", dest_port: "443" }, status: 0 });
  ruleShape = { ...rule, source: { ...rule.source, type: 5, ip_address: ["1.2.3.4"], address_group: ["group-1"] } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /cannot be safely preserved/);
  ruleShape = rule;
  const idempotent = await cfwManagement.execute(session, "rule-status", { ...values, enabled: true }, fwResource);
  assert.match(idempotent.message, /already enabled/);
  assert.equal(writes.length, 1);
  await assert.rejects(cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:missing-rule`, enabled: false }, fwResource), /no longer belongs/);
});

test("CFW rule deletion verifies fresh ownership, the typed current name, and the native ACK", async t => {
  let badAck = false;
  const { writes } = cloud(t, (url, init) => badAck && url.pathname.startsWith("/v1/project-1/acl-rule/") && init.method === "DELETE" ? { data: { id: "other-rule", name: "ack" } } : undefined);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, confirmName: rule.name };
  await assert.rejects(cfwManagement.execute(session, "delete-rule", { ...values, confirmName: "wrong-name" }, fwResource), /does not match the rule's current name/);
  assert.equal(writes.length, 0);
  await cfwManagement.execute(session, "delete-rule", values, fwResource);
  assert.equal(writes[0].method, "DELETE");
  assert.equal(writes[0].path, `/v1/project-1/acl-rule/${rule.rule_id}`);
  badAck = true;
  await assert.rejects(cfwManagement.execute(session, "delete-rule", values, fwResource), error => notInputError(error) && /unverified rule deletion/.test(String(error)));
  badAck = false;
  await assert.rejects(cfwManagement.execute(session, "delete-rule", { rule: `${object0.object_id}:missing-rule`, confirmName: rule.name }, fwResource), /no longer belongs/);
});

test("CFW one-key EIP protection switch verifies parents and never leaks raw failure text", async t => {
  let failReason = "";
  let echoId = fw.fw_instance_id;
  let pending = false;
  const { writes } = cloud(t, (url, init, body) => {
    if (!url.pathname.endsWith("/operation")) return undefined;
    const bypass = (body as { bypass_operation?: number }).bypass_operation === 1;
    return { data: { protection_status: pending ? (bypass ? 1 : 4) : bypass ? 2 : 0, id: echoId, object_id: object0.object_id }, fail_reason: failReason };
  });
  const bypassed = await cfwManagement.execute(session, "bypass-eip", {}, fwResource);
  assert.match(bypassed.message, /bypassed/);
  assert.deepEqual(writes[0], { path: `/v1/project-1/eip/protect/all/${fw.fw_instance_id}/operation`, method: "POST", body: { bypass_operation: 1 } });
  const restored = await cfwManagement.execute(session, "protect-eip", {}, fwResource);
  assert.match(restored.message, /restored/);
  assert.deepEqual(writes[1].body, { bypass_operation: 0 });
  pending = true;
  const bypassPending = await cfwManagement.execute(session, "bypass-eip", {}, fwResource);
  assert.equal(bypassPending.asynchronous, true);
  assert.match(bypassPending.message, /accepted and is in progress/);
  assert.equal(bypassPending.resourceId, fwResource.id);
  const restorePending = await cfwManagement.execute(session, "protect-eip", {}, fwResource);
  assert.equal(restorePending.asynchronous, true);
  assert.match(restorePending.message, /accepted and is in progress/);
  pending = false;
  failReason = "PROVIDER_INTERNAL_FAILURE_DETAIL";
  await assert.rejects(cfwManagement.execute(session, "bypass-eip", {}, fwResource), error => notInputError(error) && !String(error).includes("PROVIDER_INTERNAL_FAILURE_DETAIL") && /protection switch failed/.test(String(error)));
  failReason = "";
  echoId = "99999999-9999-9999-9999-999999999999";
  await assert.rejects(cfwManagement.execute(session, "bypass-eip", {}, fwResource), error => notInputError(error) && /did not verify which firewall/.test(String(error)));
});

test("CFW VPC border protection switch derives the single VPC object and verifies the ACK", async t => {
  let badAck = false;
  const { writes } = cloud(t, url => url.pathname === "/v1/project-1/firewall/east-west/protect" && badAck ? { data: { id: "other-object" } } : undefined);
  await assert.rejects(cfwManagement.execute(session, "bypass-vpc", {}, fw2Resource), /no VPC border/);
  const bypassed = await cfwManagement.execute(session, "bypass-vpc", {}, fwResource);
  assert.match(bypassed.message, /accepted/);
  assert.deepEqual(writes[0], { path: "/v1/project-1/firewall/east-west/protect", method: "POST", body: { object_id: object1.object_id, status: 1 } });
  const protectedVpc = await cfwManagement.execute(session, "protect-vpc", {}, fwResource);
  assert.match(protectedVpc.message, /accepted/);
  assert.deepEqual(writes[1].body, { object_id: object1.object_id, status: 0 });
  badAck = true;
  await assert.rejects(cfwManagement.execute(session, "bypass-vpc", {}, fwResource), error => notInputError(error) && /unverified VPC protection/.test(String(error)));
});

test("CFW address group lifecycle enforces references, exact names, and verified ACKs", async t => {
  let refCount = addrSet.ref_count;
  let setName = addrSet.name;
  let badAck = false;
  const { writes } = cloud(t, url => {
    if (url.pathname === "/v1/project-1/address-sets") return { data: { offset: 0, limit: 100, total: 1, records: [{ ...addrSet, ref_count: refCount, name: setName }] } };
    if (badAck && url.pathname.startsWith("/v1/project-1/address-sets/")) return { data: { id: "other-set", name: "ack" } };
    return undefined;
  });
  const created = await cfwManagement.execute(session, "create-addr-set", { protectionObject: object0.object_id, name: "partners", addressType: "0", description: "" }, fwResource);
  assert.deepEqual(writes[0], { path: "/v1/project-1/address-set", method: "POST", body: { object_id: object0.object_id, name: "partners", description: "", address_type: 0 } });
  assert.equal(created.resourceId, `addr:${fw.fw_instance_id}:${object0.object_id}:addr-set-new`);
  badAck = true;
  await assert.rejects(cfwManagement.execute(session, "rename-addr", { name: "partners2", description: "Updated" }, addrResource), error => notInputError(error) && /unverified address group update/.test(String(error)));
  assert.equal(writes[1].method, "PUT");
  badAck = false;
  await cfwManagement.execute(session, "rename-addr", { name: "partners2", description: "Updated" }, addrResource);
  assert.deepEqual(writes[2], { path: `/v1/project-1/address-sets/${addrSet.set_id}`, method: "PUT", body: { name: "partners2", description: "Updated" } });
  refCount = 2;
  await assert.rejects(cfwManagement.execute(session, "delete-addr", {}, addrResource), /verified as zero/);
  refCount = 0;
  setName = "renamed-elsewhere";
  await assert.rejects(cfwManagement.execute(session, "delete-addr", {}, addrResource), /renamed since selection/);
  setName = addrSet.name;
  await cfwManagement.execute(session, "delete-addr", {}, addrResource);
  assert.equal(writes[3].method, "DELETE");
  assert.equal(writes[3].path, `/v1/project-1/address-sets/${addrSet.set_id}`);
});

test("CFW address items validate the group's address family and current ownership", async t => {
  const { writes } = cloud(t);
  await assert.rejects(cfwManagement.execute(session, "add-addr-item", { address: "2001:db8::1", description: "" }, addrResource), /holds IPv4/);
  await cfwManagement.execute(session, "add-addr-item", { address: "8.8.8.0/24", description: "DNS" }, addrResource);
  assert.deepEqual(writes[0], { path: "/v1/project-1/address-items", method: "POST", body: { set_id: addrSet.set_id, address_items: [{ address_type: 0, address: "8.8.8.0/24", description: "DNS" }] } });
  await cfwManagement.execute(session, "delete-addr-item", { item: addrItem.item_id }, addrResource);
  assert.equal(writes[1].path, `/v1/project-1/address-items/${addrItem.item_id}`);
  assert.equal(writes[1].method, "DELETE");
  await assert.rejects(cfwManagement.execute(session, "delete-addr-item", { item: "foreign-item" }, addrResource), /no longer belongs/);
});

test("CFW service group lifecycle and items enforce references, foreign projects, and typed protocols", async t => {
  let foreignProject = false;
  let refCount = svcSet.ref_count;
  const { writes } = cloud(t, url => url.pathname === "/v1/project-1/service-sets" ? { data: { offset: 0, limit: 100, total: 1, records: [{ ...svcSet, ref_count: refCount, project_id: foreignProject ? "other-project" : session.projectId }] } } : undefined);
  foreignProject = true;
  await assert.rejects(cfwManagement.execute(session, "rename-svc", { name: "web", description: "" }, svcResource), /unverifiable Cloud Firewall project scope/);
  foreignProject = false;
  const created = await cfwManagement.execute(session, "create-svc-set", { protectionObject: object0.object_id, name: "apps", description: "" }, fwResource);
  assert.deepEqual(writes[0], { path: "/v1/project-1/service-set", method: "POST", body: { object_id: object0.object_id, name: "apps", description: "" } });
  assert.equal(created.resourceId, `svc:${fw.fw_instance_id}:${object0.object_id}:svc-set-new`);
  await cfwManagement.execute(session, "add-svc-item", { protocol: "17", sourcePort: "0", destPort: "53", description: "DNS" }, svcResource);
  assert.deepEqual(writes[1], { path: "/v1/project-1/service-items", method: "POST", body: { set_id: svcSet.set_id, service_items: [{ protocol: 17, source_port: "0", dest_port: "53", description: "DNS" }] } });
  await cfwManagement.execute(session, "delete-svc-item", { item: svcItem.item_id }, svcResource);
  assert.equal(writes[2].path, `/v1/project-1/service-items/${svcItem.item_id}`);
  assert.equal(writes[2].method, "DELETE");
  await assert.rejects(cfwManagement.execute(session, "delete-svc", {}, svcResource), /verified as zero/);
  refCount = 0;
  await cfwManagement.execute(session, "delete-svc", {}, svcResource);
  assert.equal(writes[3].method, "DELETE");
  assert.equal(writes[3].path, `/v1/project-1/service-sets/${svcSet.set_id}`);
});

test("CFW options build live typed catalogs for protection objects, rules, and group items", async t => {
  cloud(t);
  const ruleOptions = await cfwManagement.options!(session, "delete-rule", fwResource);
  assert.equal(ruleOptions.aclRules.length, 1);
  assert.equal(ruleOptions.aclRules[0].value, `${object0.object_id}:${rule.rule_id}`);
  assert.match(ruleOptions.aclRules[0].label, /Internet border/);
  const objectOptions = await cfwManagement.options!(session, "create-rule", fwResource);
  assert.deepEqual(objectOptions.protectionObjects.map(choice => choice.value), [object0.object_id, object1.object_id]);
  const itemOptions = await cfwManagement.options!(session, "delete-addr-item", addrResource);
  assert.equal(itemOptions.addressItems.length, 1);
  assert.match(itemOptions.addressItems[0].label, /8\.8\.8\.0\/24/);
  const svcItemOptions = await cfwManagement.options!(session, "delete-svc-item", svcResource);
  assert.equal(svcItemOptions.serviceItems.length, 1);
  assert.match(svcItemOptions.serviceItems[0].label, /TCP/);
});

test("CFW inspection reports exact native states without assuming idle or active", async t => {
  let statusValue: unknown = fw.status;
  cloud(t, url => url.pathname.endsWith("/firewalls/list") ? { data: { limit: 100, offset: 0, project_id: session.projectId, total: 1, records: [{ ...fw, status: statusValue }] } } : undefined);
  const result = await cfwManagement.execute(session, "inspect", {}, fwResource);
  assert.ok(result.facts?.some(fact => fact.label === "Status" && fact.value === "Running"));
  assert.ok(result.facts?.some(fact => fact.label === "Billing" && fact.value === "Pay-per-use"));
  assert.ok(result.facts?.some(fact => fact.label === "Protection object \u00b7 Internet border" && fact.value === object0.object_name));
  statusValue = 99;
  const unknown = await cfwManagement.execute(session, "inspect", {}, fwResource);
  assert.ok(unknown.facts?.some(fact => fact.label === "Status" && fact.value === "Unknown"));
  const rules = await cfwManagement.execute(session, "rules", { protectionObject: object0.object_id }, fwResource);
  assert.match(rules.message, /1 ACL rules/);
  assert.ok(rules.facts?.some(fact => fact.label.startsWith("allow-office")));
});

test("CFW group inspection reports references, protocols, and item counts", async t => {
  cloud(t);
  const addrInspect = await cfwManagement.execute(session, "inspect-addr", {}, addrResource);
  assert.ok(addrInspect.facts?.some(fact => fact.label === "Rule references" && fact.value === "0"));
  assert.ok(addrInspect.facts?.some(fact => fact.label === "Addresses" && fact.value === "1"));
  const items = await cfwManagement.execute(session, "addr-items", {}, addrResource);
  assert.match(items.message, /1 address items/);
  const svcInspect = await cfwManagement.execute(session, "inspect-svc", {}, svcResource);
  assert.ok(svcInspect.facts?.some(fact => fact.label === "Protocols" && fact.value === "TCP"));
  const svcItemsResult = await cfwManagement.execute(session, "svc-items", {}, svcResource);
  assert.match(svcItemsResult.message, /1 service items/);
});

test("CFW rejects resources whose firewall or protection object parent is not verifiable", async t => {
  const { writes } = cloud(t);
  const foreignObjectResource = { id: `addr:${fw.fw_instance_id}:99999999-9999-9999-9999-999999999999:${addrSet.set_id}`, name: addrSet.name };
  await assert.rejects(cfwManagement.execute(session, "delete-addr", {}, foreignObjectResource), /no longer belongs/);
  const foreignFwResource = { id: "fw:99999999-9999-9999-9999-999999999999", name: "ghost" };
  await assert.rejects(cfwManagement.execute(session, "inspect", {}, foreignFwResource), /no longer belongs to this project/);
  await assert.rejects(cfwManagement.execute(session, "bypass-eip", {}, { ...fwResource, id: `addr:${fw.fw_instance_id}:${object0.object_id}:${addrSet.set_id}` }), /Select a current Cloud Firewall firewall/);
  assert.equal(writes.length, 0);
});

test("CFW sanitizes unreadable non-JSON mutation responses", async t => {
  const { writes } = cloud(t, (url, init) => url.pathname === "/v1/project-1/address-set" && init.method === "POST" ? new Response("PROVIDER_RAW_INTERNAL_DETAIL", { status: 200, headers: { "content-type": "text/plain" } }) : undefined);
  await assert.rejects(cfwManagement.execute(session, "create-addr-set", { protectionObject: object0.object_id, name: "partners", addressType: "0", description: "" }, fwResource), error => notInputError(error) && /unverifiable Cloud Firewall response/.test(String(error)) && !String(error).includes("PROVIDER_RAW"));
  assert.equal(writes.length, 1);
});

// ---------------------------------------------------------------------------
// Correction 1: the rule roundtrip whitelists complete known schemas and types,
// rejects unknown nonempty settings, masked values, and nested array objects,
// and ignores only documented read-only echo fields.
// ---------------------------------------------------------------------------

test("CFW rule roundtrip blocks unknown nonempty rule fields and skips null ones", async t => {
  let shape: Record<string, unknown> = { ...rule, hit_count: 7 };
  const { writes } = ruleCloud(t, () => shape);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /unverifiable field hit_count/);
  assert.equal(writes.length, 0);
  shape = { ...rule, hit_count: null };
  await cfwManagement.execute(session, "rule-status", values, fwResource);
  assert.equal(writes.length, 1);
  assert.ok(!("hit_count" in (writes[0].body as Record<string, unknown>)));
});

test("CFW rule roundtrip ignores only documented read-only echo fields", async t => {
  const { writes } = ruleCloud(t, () => ({ ...rule, rule_id: rule.rule_id, order_id: 99, created_date: "2026-01-01T00:00:00Z", modified_date: "2026-01-02T00:00:00Z" }));
  await cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource);
  const body = writes[0].body as Record<string, unknown>;
  for (const key of ["rule_id", "order_id", "created_date", "modified_date"]) assert.ok(!(key in body), `unexpected ${key} in roundtrip`);
  assert.equal(body.name, rule.name);
  assert.equal(body.status, 0);
});

test("CFW rule roundtrip blocks masked current values everywhere", async t => {
  let shape: Record<string, unknown> = { ...rule, description: "****" };
  const { writes } = ruleCloud(t, () => shape);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /masked/);
  shape = { ...rule, source: { ...rule.source, address: "****" } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /masked/);
  shape = { ...rule, tag: { tag_key: "env", tag_value: "****" } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /masked/);
  assert.equal(writes.length, 0);
});

test("CFW rule roundtrip blocks nested array objects and mistyped fields", async t => {
  let shape: Record<string, unknown> = { ...rule, applications: [{ app: "http" }] };
  const { writes } = ruleCloud(t, () => shape);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /could not be verified for a safe update/);
  shape = { ...rule, long_connect_time: "0" };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /could not be verified for a safe update/);
  shape = { ...rule, applications: ["http"] };
  await cfwManagement.execute(session, "rule-status", values, fwResource);
  assert.deepEqual((writes[0].body as Record<string, unknown>).applications, ["http"]);
});

test("CFW rule roundtrip whitelists manual and group address types only", async t => {
  let shape: Record<string, unknown> = { ...rule, source: { type: 2, address_type: 0, domain_address_name: "example.com" } };
  const { writes } = ruleCloud(t, () => shape);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /cannot be safely preserved/);
  shape = { ...rule, source: { type: 3, address_type: 0, region_list_json: "[{\"region\":\"br\"}]" } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /cannot be safely preserved/);
  shape = { ...rule, source: { type: 1, address_type: 0, address_set_id: "set-1", address_set_name: "group-1", address_set_type: 0, ip_address: [] } };
  await cfwManagement.execute(session, "rule-status", values, fwResource);
  assert.deepEqual((writes[0].body as Record<string, unknown>).source, { type: 1, address_type: 0, address_set_id: "set-1", address_set_name: "group-1", address_set_type: 0 });
});

test("CFW rule roundtrip blocks unknown nonempty address and service fields", async t => {
  let shape: Record<string, unknown> = { ...rule, source: { ...rule.source, region_list_json: "{\"region\":\"br\"}" } };
  const { writes } = ruleCloud(t, () => shape);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /unverifiable field region_list_json/);
  shape = { ...rule, service: { ...rule.service, custom_service: [{ protocol: 6 }] } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /unverifiable field custom_service/);
  shape = { ...rule, service: { type: 2, custom_service: [{ protocol: 6, source_port: "1", dest_port: "2" }] } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /cannot be safely preserved/);
  assert.equal(writes.length, 0);
});

test("CFW rule roundtrip skips known null optional flags but blocks missing critical fields", async t => {
  let shape: Record<string, unknown> = { ...rule, direction: null };
  const { writes } = ruleCloud(t, () => shape);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await cfwManagement.execute(session, "rule-status", values, fwResource);
  assert.ok(!("direction" in (writes[0].body as Record<string, unknown>)));
  const missingName: Record<string, unknown> = { ...rule };
  delete missingName.name;
  shape = missingName;
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /required for a safe update but is missing/);
  shape = { ...rule, action_type: null };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /native match or protection type could not be verified/);
  shape = { ...rule, source: null };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /match configuration could not be verified/);
  assert.equal(writes.length, 1);
});

test("CFW rule roundtrip preserves typed tags and blocks unknown tag fields", async t => {
  let shape: Record<string, unknown> = { ...rule, tag: { tag_key: "env", tag_value: "prod" } };
  const { writes } = ruleCloud(t, () => shape);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await cfwManagement.execute(session, "rule-status", values, fwResource);
  assert.deepEqual((writes[0].body as Record<string, unknown>).tag, { tag_key: "env", tag_value: "prod" });
  shape = { ...rule, tag: { custom: "x" } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /unverifiable field custom/);
  shape = { ...rule, tag: {} };
  await cfwManagement.execute(session, "rule-status", values, fwResource);
  assert.ok(!("tag" in (writes[1].body as Record<string, unknown>)));
});

test("CFW service roundtrip whitelists service groups with exact typed fields", async t => {
  let shape: Record<string, unknown> = { ...rule, service: { type: 1, service_set_id: "svc-1", service_set_name: "web", protocols: [6], service_set_type: 0 } };
  const { writes } = ruleCloud(t, () => shape);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await cfwManagement.execute(session, "rule-status", values, fwResource);
  assert.deepEqual((writes[0].body as Record<string, unknown>).service, { type: 1, service_set_id: "svc-1", service_set_name: "web", protocols: [6], service_set_type: 0 });
  shape = { ...rule, service: { type: 1, service_set_name: "web" } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /required for a safe update but is missing/);
  shape = { ...rule, service: { type: 1, service_set_id: "svc-1", service_group: ["g1"] } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /unverifiable field service_group/);
});

test("CFW rule roundtrip rejects non-integer address and service types", async t => {
  let shape: Record<string, unknown> = { ...rule, source: { ...rule.source, type: "0" } };
  const { writes } = ruleCloud(t, () => shape);
  const values = { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /cannot be safely preserved/);
  shape = { ...rule, service: { ...rule.service, type: "0" } };
  await assert.rejects(cfwManagement.execute(session, "rule-status", values, fwResource), /cannot be safely preserved/);
  assert.equal(writes.length, 0);
});

test("CFW rule roundtrip copies empty documented strings and arrays verbatim", async t => {
  const { writes } = ruleCloud(t, () => ({ ...rule, description: "", applications: [] }));
  await cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource);
  const body = writes[0].body as Record<string, unknown>;
  assert.equal(body.description, "");
  assert.deepEqual(body.applications, []);
});

test("CFW rule roundtrip blocks unknown nonempty destination fields", async t => {
  let shape: Record<string, unknown> = { ...rule, destination: { ...rule.destination, domain_set_id: "domain-1" } };
  const { writes } = ruleCloud(t, () => shape);
  await assert.rejects(cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource), /unverifiable field domain_set_id/);
  shape = { ...rule, destination: { ...rule.destination, domain_set_id: null } };
  await cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource);
  assert.equal(writes.length, 1);
});

// ---------------------------------------------------------------------------
// Correction 2: the native RuleAddressDto has no public/private border scope
// prohibition; only real IP/CIDR, family, and native object-type checks remain.
// ---------------------------------------------------------------------------

test("CFW Internet border rules accept private source and destination addresses", async t => {
  const { writes } = cloud(t);
  await cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "10.0.0.0/8", destination: "192.168.1.0/24" }, fwResource);
  const created = (writes[0].body as { rules: Record<string, unknown>[] }).rules[0];
  assert.deepEqual(created.source, { type: 0, address_type: 0, address: "10.0.0.0/8" });
  assert.deepEqual(created.destination, { type: 0, address_type: 0, address: "192.168.1.0/24" });
});

test("CFW rule addresses require a valid IP or CIDR before any write", async t => {
  const { writes } = cloud(t);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "not-an-ip" }, fwResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "1.2.3.4/5/6" }, fwResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "" }, fwResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  assert.equal(writes.length, 0);
});

test("CFW rule address prefixes stay within the family bit limits", async t => {
  const { writes } = cloud(t);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "10.0.0.0/33" }, fwResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "2001:db8::/129", destination: "2001:db8::/32" }, fwResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  await cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "10.0.0.0/32" }, fwResource);
  assert.deepEqual((writes[0].body as { rules: Record<string, unknown>[] }).rules[0].source, { type: 0, address_type: 0, address: "10.0.0.0/32" });
});

test("CFW rule source and destination must share the IP family", async t => {
  const { writes } = cloud(t);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, destination: "2001:db8::/32" }, fwResource), /same IP version/);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "2001:db8::1", destination: "0.0.0.0/0" }, fwResource), /same IP version/);
  assert.equal(writes.length, 0);
});

test("CFW IPv6 rules are created with the native IPv6 address type", async t => {
  const { writes } = cloud(t);
  await cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "2001:db8::/32", destination: "2001:db8::/64" }, fwResource);
  const created = (writes[0].body as { rules: Record<string, unknown>[] }).rules[0];
  assert.equal(created.address_type, 1);
  assert.deepEqual(created.source, { type: 0, address_type: 1, address: "2001:db8::/32" });
});

test("CFW address items accept any valid CIDR regardless of the border type", async t => {
  const { writes } = cloud(t);
  await cfwManagement.execute(session, "add-addr-item", { address: "10.0.0.0/8", description: "Internal" }, addrResource);
  await cfwManagement.execute(session, "add-addr-item", { address: "172.16.5.4", description: "Host" }, addrResource);
  assert.deepEqual(writes[0].body, { set_id: addrSet.set_id, address_items: [{ address_type: 0, address: "10.0.0.0/8", description: "Internal" }] });
  assert.deepEqual(writes[1].body, { set_id: addrSet.set_id, address_items: [{ address_type: 0, address: "172.16.5.4", description: "Host" }] });
});

test("CFW address items enforce the group's address family both ways", async t => {
  let groupType: unknown = 0;
  const { writes } = cloud(t, url => url.pathname === "/v1/project-1/address-sets" ? { data: { offset: 0, limit: 100, total: 1, records: [{ ...addrSet, address_type: groupType }] } } : undefined);
  await assert.rejects(cfwManagement.execute(session, "add-addr-item", { address: "2001:db8::1", description: "" }, addrResource), /holds IPv4/);
  groupType = 1;
  await assert.rejects(cfwManagement.execute(session, "add-addr-item", { address: "8.8.8.8", description: "" }, addrResource), /holds IPv6/);
  await cfwManagement.execute(session, "add-addr-item", { address: "2001:db8::1", description: "IPv6 host" }, addrResource);
  assert.deepEqual(writes[0].body, { set_id: addrSet.set_id, address_items: [{ address_type: 1, address: "2001:db8::1", description: "IPv6 host" }] });
});

test("CFX wildcard any-addresses are plain CIDRs without special scope handling", async t => {
  const { writes } = cloud(t);
  await cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "0.0.0.0/0", destination: "0.0.0.0/0" }, fwResource);
  await cfwManagement.execute(session, "create-rule", { ...ruleValues, source: "::/0", destination: "::/0" }, fwResource);
  const first = (writes[0].body as { rules: Record<string, unknown>[] }).rules[0];
  const second = (writes[1].body as { rules: Record<string, unknown>[] }).rules[0];
  assert.equal((first.source as Record<string, unknown>).address, "0.0.0.0/0");
  assert.equal(second.address_type, 1);
  assert.equal((second.source as Record<string, unknown>).address, "::/0");
});

test("CFW rule address help documents the native contract without invented scopes", () => {
  const operation = cfwManagement.operations.find(item => item.id === "create-rule")!;
  const help = operation.fields.find(field => field.key === "source")!.help ?? "";
  assert.ok(!help.includes("RFC1918"), "help must not invent RFC1918 restrictions");
  assert.ok(!help.toLowerCase().includes("public"), "help must not invent public-only scopes");
  assert.ok(help.includes("same family"), "help must document the real family check");
});

test("CFW NAT border protection objects are rejected for rule creation natively", async t => {
  const { writes } = cloud(t, url => url.pathname === "/v1/project-1/firewall/exist" ? { data: { limit: 100, offset: 0, total: 1, records: [{ ...detailRecord, protect_objects: [object0, object1, natObject] }] } } : undefined);
  await assert.rejects(cfwManagement.execute(session, "create-rule", { ...ruleValues, protectionObject: natObject.object_id }, fwResource), /NAT border/);
  await assert.rejects(cfwManagement.execute(session, "rules", { protectionObject: natObject.object_id }, fwResource), /cannot be listed here/);
  assert.equal(writes.length, 0);
});

test("CFW invalid address item values are rejected before any write", async t => {
  const { writes } = cloud(t);
  await assert.rejects(cfwManagement.execute(session, "add-addr-item", { address: "300.1.1.1", description: "" }, addrResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  await assert.rejects(cfwManagement.execute(session, "add-addr-item", { address: "10.0.0.0/33", description: "" }, addrResource), /must be one valid IPv4\/IPv6 address or CIDR/);
  assert.equal(writes.length, 0);
});

// ---------------------------------------------------------------------------
// Correction 3: unknown statuses, actions, and reference counts never default
// to permit/free/zero; group deletes need a numeric exact-zero ref_count plus
// a fresh ACL dependency proof; provided echo keys must be exact; every
// HTTP, network, non-JSON, and business failure is sanitized.
// ---------------------------------------------------------------------------

test("CFW group deletion requires a numeric exact-zero reference count", async t => {
  let refCount: unknown = 0;
  const { writes } = cloud(t, url => url.pathname === "/v1/project-1/address-sets" ? { data: { offset: 0, limit: 100, total: 1, records: [{ ...addrSet, ref_count: refCount }] } } : undefined);
  refCount = undefined;
  await assert.rejects(cfwManagement.execute(session, "delete-addr", {}, addrResource), /verified as zero/);
  refCount = "0";
  await assert.rejects(cfwManagement.execute(session, "delete-addr", {}, addrResource), /verified as zero/);
  refCount = null;
  await assert.rejects(cfwManagement.execute(session, "delete-addr", {}, addrResource), /verified as zero/);
  assert.equal(writes.length, 0);
});

test("CFW address group deletion proves no fresh ACL rule references the group", async t => {
  const { writes } = cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), records: [{ ...rule, source: { type: 1, address_type: 0, address_set_id: addrSet.set_id, address_set_name: addrSet.name } }] } } : undefined);
  await assert.rejects(cfwManagement.execute(session, "delete-addr", {}, addrResource), /still references this address group/);
  assert.equal(writes.length, 0);
});

test("CFW service group deletion proves no fresh rule references the group", async t => {
  const { writes } = cloud(t, url => {
    if (url.pathname === "/v1/project-1/service-sets") return { data: { offset: 0, limit: 100, total: 1, records: [{ ...svcSet, ref_count: 0 }] } };
    if (url.pathname === "/v1/project-1/acl-rules") return { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), records: [{ ...rule, service: { type: 1, service_set_id: svcSet.set_id, service_set_name: svcSet.name } }] } };
    return undefined;
  });
  await assert.rejects(cfwManagement.execute(session, "delete-svc", {}, svcResource), /still references this service group/);
  assert.equal(writes.length, 0);
});

test("CFW address group deletion succeeds when the fresh ACL proof is clean", async t => {
  const { writes } = cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), records: [{ ...rule, source: { type: 1, address_type: 0, address_set_id: "another-set", address_set_name: "other" } }] } } : undefined);
  await cfwManagement.execute(session, "delete-addr", {}, addrResource);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "DELETE");
  assert.equal(writes[0].path, `/v1/project-1/address-sets/${addrSet.set_id}`);
});

test("CFW NAT border group deletion relies on the numeric count only", async t => {
  const { writes } = cloud(t, url => {
    if (url.pathname === "/v1/project-1/firewall/exist") return { data: { limit: 100, offset: 0, total: 1, records: [{ ...detailRecord, protect_objects: [object0, object1, natObject] }] } };
    if (url.pathname === "/v1/project-1/address-sets") return { data: { offset: 0, limit: 100, total: 1, records: [{ ...addrSet, object_id: natObject.object_id }] } };
    return undefined;
  });
  const natResource = { id: `addr:${fw.fw_instance_id}:${natObject.object_id}:${addrSet.set_id}`, name: addrSet.name };
  await cfwManagement.execute(session, "delete-addr", {}, natResource);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "DELETE");
});

test("CFW rule listings never default unknown actions, states, or directions", async t => {
  cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), records: [{ ...rule, action_type: 99, status: undefined, direction: 5 }] } } : undefined);
  const rules = await cfwManagement.execute(session, "rules", { protectionObject: object0.object_id }, fwResource);
  const label = rules.facts?.[0]?.label ?? "";
  assert.match(label, /Unknown action/);
  assert.match(label, /Unknown state/);
  assert.match(label, /Unknown direction/);
});

test("CFW rule option labels never default unknown actions or states", async t => {
  cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), records: [{ ...rule, action_type: 99, status: undefined }] } } : undefined);
  const options = await cfwManagement.options!(session, "delete-rule", fwResource);
  assert.match(options.aclRules[0].label, /Unknown action/);
  assert.match(options.aclRules[0].label, /Unknown state/);
});

test("CFW group inspection reports unknown reference counts without echoing raw values", async t => {
  cloud(t, url => url.pathname === "/v1/project-1/address-sets" ? { data: { offset: 0, limit: 100, total: 1, records: [{ ...addrSet, ref_count: "PRIVATE_COUNT" }] } } : undefined);
  const inspect = await cfwManagement.execute(session, "inspect-addr", {}, addrResource);
  assert.ok(inspect.facts?.some(fact => fact.label === "Rule references" && fact.value === "Unknown"));
  assert.ok(!JSON.stringify(inspect.facts).includes("PRIVATE_COUNT"));
});

test("CFW inventory keeps unknown reference counts non-zero", async t => {
  cloud(t, url => url.pathname === "/v1/project-1/address-sets" && url.searchParams.get("object_id") === object0.object_id ? { data: { offset: 0, limit: 100, total: 1, records: [{ ...addrSet, ref_count: undefined }] } } : undefined);
  const resources = await cfwManagement.inventory(session);
  const group = resources.find(resource => resource.id.startsWith("addr:"));
  assert.equal(group?.values?.refCount, -1);
});

test("CFW ACK parent echoes must be exact across items and rules", async t => {
  const { writes } = cloud(t, (url, init) => {
    if (url.pathname === "/v1/project-1/address-items" && init.method === "POST") return { data: { items: [{ id: "addr-item-new", set_id: "other-set" }], covered_ip: [] } };
    if (url.pathname === "/v1/project-1/acl-rule" && init.method === "POST") return { data: { rules: [{ id: "rule-new", name: "block-inbound", object_id: "other-object" }] } };
    return undefined;
  });
  await assert.rejects(cfwManagement.execute(session, "add-addr-item", { address: "8.8.8.8", description: "" }, addrResource), error => notInputError(error) && /different group/.test(String(error)));
  await assert.rejects(cfwManagement.execute(session, "create-rule", ruleValues, fwResource), error => notInputError(error) && /different protection object/.test(String(error)));
  assert.equal(writes.length, 2);
});

test("CFW HTTP-200 business failures never echo private payloads", async t => {
  const { writes } = cloud(t, (url, init) => url.pathname === "/v1/project-1/acl-rule" && init.method === "POST" ? Response.json({ error_code: "CFW.0001", error_msg: "PRIVATE_NATIVE_DETAILS" }) : undefined);
  await assert.rejects(cfwManagement.execute(session, "create-rule", ruleValues, fwResource), error => notInputError(error) && /business failure/.test(String(error)) && !String(error).includes("PRIVATE_NATIVE_DETAILS"));
  assert.equal(writes.length, 1);
});

test("CFW poll reads sanitize non-JSON responses", async t => {
  cloud(t, url => url.pathname.startsWith("/v3/project-1/jobs/") ? new Response("PROVIDER_RAW_JOB_DETAIL", { status: 200, headers: { "content-type": "text/plain" } }) : undefined);
  const entry = { id: "00000000-0000-0000-0000-000000000000", service: "cfw", operation: "Create pay-per-use cloud firewall", startedAt: "2026-01-01T00:00:00Z", state: "submitted" as const, jobId: "job-create-1" };
  await assert.rejects(cfwManagement.poll!(session, entry), error => notInputError(error) && /unverifiable Cloud Firewall response/.test(String(error)) && !String(error).includes("PROVIDER_RAW"));
});

test("CFW transport errors keep only the HTTP status", async t => {
  cloud(t, url => url.pathname.endsWith("/firewalls/list") ? new Response("PRIVATE_GATEWAY_DETAIL", { status: 500 }) : undefined);
  await assert.rejects(cfwManagement.inventory(session), error => error instanceof HuaweiApiError && error.status === 500 && /HTTP 500/.test(String(error)) && !String(error).includes("PRIVATE_GATEWAY_DETAIL"));
});

// ---------------------------------------------------------------------------
// Correction 4: every post-write claim is verified by a fresh native read or
// stated as accepted with a hash observer; original identities are retained;
// EIP/VPC protection has no queryable job so in-progress is honest accepted
// manual verification; rule deletion requires the typed current name.
// ---------------------------------------------------------------------------

test("CFW rule creation verifies convergence with a fresh native read", async t => {
  cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), records: [{ rule_id: "rule-new", name: "block-inbound", action_type: 1, status: 1 }] } } : undefined);
  const result = await cfwManagement.execute(session, "create-rule", ruleValues, fwResource);
  assert.equal(result.asynchronous, undefined);
  assert.match(result.message, /verified by a fresh native read/);
  assert.equal(result.resourceId, fwResource.id);
});

test("CFW rule creation waits as accepted when the fresh read lags", async t => {
  const { writes } = cloud(t);
  const result = await cfwManagement.execute(session, "create-rule", ruleValues, fwResource);
  assert.equal(result.asynchronous, true);
  assert.equal(result.jobId, `${object0.object_id}:rule-new`);
  assert.equal(result.resourceId, fwResource.id);
  assert.match(result.message, /accepted/);
  assert.ok(result.verification);
  assert.deepEqual(result.verification.fields, ["action_type", "name", "status"]);
  assert.match(result.verification.digest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result.verification).includes("block-inbound"), "no raw values stored");
  assert.equal(writes.length, 1);
});

test("CFW rule creation observer converges on the exact accepted target", async t => {
  let visible = false;
  cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), records: [visible ? { rule_id: "rule-new", name: "block-inbound", action_type: 1, status: 1 } : rule] } } : undefined);
  const result = await cfwManagement.execute(session, "create-rule", ruleValues, fwResource);
  const saved = { ...ruleEntry, jobId: result.jobId, verification: result.verification };
  assert.equal((await cfwManagement.poll!(session, saved)).state, "submitted");
  visible = true;
  const convergedResult = await cfwManagement.poll!(session, saved);
  assert.equal(convergedResult.state, "succeeded");
  assert.equal(convergedResult.resourceId, fwResource.id);
});

test("CFW rule creation observer rejects invalid verification schemas", async t => {
  cloud(t);
  const result = await cfwManagement.execute(session, "create-rule", ruleValues, fwResource);
  const saved = { ...ruleEntry, jobId: result.jobId, verification: result.verification };
  await assert.rejects(cfwManagement.poll!(session, { ...saved, verification: undefined }), /observer is missing or invalid/);
  await assert.rejects(cfwManagement.poll!(session, { ...saved, verification: { fields: ["token"], digest: result.verification!.digest } }), /observer is missing or invalid/);
  await assert.rejects(cfwManagement.poll!(session, { ...saved, verification: { fields: ["status"], digest: "not-a-hex-digest" } }), /observer is missing or invalid/);
});

test("CFW rule status verifies convergence with a fresh native read", async t => {
  let reads = 0;
  const { writes } = cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: 1, object_id: url.searchParams.get("object_id"), records: [{ ...rule, status: ++reads >= 2 ? 0 : 1 }] } } : undefined);
  const result = await cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource);
  assert.equal(result.asynchronous, undefined);
  assert.match(result.message, /disabled, verified by a fresh native read/);
  assert.equal(writes[0].method, "PUT");
});

test("CFW rule status waits as accepted when the fresh read lags", async t => {
  const { writes } = ruleCloud(t, () => rule);
  const result = await cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource);
  assert.equal(result.asynchronous, true);
  assert.equal(result.jobId, `${object0.object_id}:${rule.rule_id}`);
  assert.equal(result.resourceId, fwResource.id);
  assert.deepEqual(result.verification?.fields, ["status"]);
  assert.match(result.verification?.digest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(writes.length, 1);
});

test("CFW rule status observer converges only on the exact status", async t => {
  let statusValue: unknown = 1;
  ruleCloud(t, () => ({ ...rule, status: statusValue }));
  const result = await cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource);
  const saved = { ...ruleEntry, operation: "Enable or disable ACL rule", jobId: result.jobId, verification: result.verification };
  assert.equal((await cfwManagement.poll!(session, saved)).state, "submitted");
  statusValue = 0;
  assert.equal((await cfwManagement.poll!(session, saved)).state, "succeeded");
  statusValue = 2;
  assert.equal((await cfwManagement.poll!(session, saved)).state, "submitted");
});

test("CFW rule deletion requires the typed current name", async t => {
  const { writes } = cloud(t);
  await assert.rejects(cfwManagement.execute(session, "delete-rule", { rule: `${object0.object_id}:${rule.rule_id}`, confirmName: "" }, fwResource), /Type the rule's current name/);
  await assert.rejects(cfwManagement.execute(session, "delete-rule", { rule: `${object0.object_id}:${rule.rule_id}`, confirmName: "allow" }, fwResource), /does not match the rule's current name/);
  assert.equal(writes.length, 0);
  await cfwManagement.execute(session, "delete-rule", { rule: `${object0.object_id}:${rule.rule_id}`, confirmName: rule.name }, fwResource);
  assert.equal(writes[0].method, "DELETE");
});

test("CFW rule deletion blocks unreviewed renamed rules", async t => {
  const { writes } = ruleCloud(t, () => ({ ...rule, name: "renamed-elsewhere" }));
  await assert.rejects(cfwManagement.execute(session, "delete-rule", { rule: `${object0.object_id}:${rule.rule_id}`, confirmName: rule.name }, fwResource), /does not match the rule's current name/);
  assert.equal(writes.length, 0);
});

test("CFW rule deletion verifies absence with a fresh native read", async t => {
  let deleted = false;
  const { writes } = cloud(t, (url, init) => {
    if (url.pathname === "/v1/project-1/acl-rules") return { data: { offset: 0, limit: 100, total: deleted ? 0 : 1, object_id: url.searchParams.get("object_id"), records: deleted ? [] : [rule] } };
    if (url.pathname.startsWith("/v1/project-1/acl-rule/") && init.method === "DELETE") deleted = true;
    return undefined;
  });
  const result = await cfwManagement.execute(session, "delete-rule", { rule: `${object0.object_id}:${rule.rule_id}`, confirmName: rule.name }, fwResource);
  assert.equal(result.asynchronous, undefined);
  assert.match(result.message, /verified by a fresh native read/);
  assert.equal(result.resourceId, fwResource.id);
  assert.equal(writes.length, 1);
});

test("CFW rule deletion waits as accepted while the rule is still present", async t => {
  const { writes } = cloud(t);
  const accepted = await cfwManagement.execute(session, "delete-rule", { rule: `${object0.object_id}:${rule.rule_id}`, confirmName: rule.name }, fwResource);
  assert.equal(accepted.asynchronous, true);
  assert.equal(accepted.jobId, `${object0.object_id}:${rule.rule_id}`);
  assert.equal(accepted.resourceId, fwResource.id);
  assert.match(accepted.message, /accepted/);
  assert.equal(writes.length, 1);
});

test("CFW rule deletion observer converges on verified absence", async t => {
  let present = true;
  cloud(t, url => url.pathname === "/v1/project-1/acl-rules" ? { data: { offset: 0, limit: 100, total: present ? 1 : 0, object_id: url.searchParams.get("object_id"), records: present ? [rule] : [] } } : undefined);
  const saved = { ...ruleEntry, operation: "Delete ACL rule", jobId: `${object0.object_id}:${rule.rule_id}` };
  assert.equal((await cfwManagement.poll!(session, saved)).state, "submitted");
  present = false;
  const gone = await cfwManagement.poll!(session, saved);
  assert.equal(gone.state, "succeeded");
  assert.equal(gone.resourceId, fwResource.id);
});

test("CFW rule observers retain the original identities and labels stay whitelisted", async t => {
  cloud(t);
  const saved = { ...ruleEntry, jobId: `${object0.object_id}:${rule.rule_id}`, verification: { fields: ["status"], digest: "a".repeat(64) } };
  await assert.rejects(cfwManagement.poll!(session, { ...saved, resourceId: undefined }), /missing its original firewall or rule identity/);
  await assert.rejects(cfwManagement.poll!(session, { ...saved, jobId: "garbage" }), /missing its original firewall or rule identity/);
  await assert.rejects(cfwManagement.poll!(session, { ...saved, operation: "View ACL rules" }), /progress check/);
});

test("CFW rule observer verifies the fresh rule belongs to the original firewall", async t => {
  cloud(t, url => url.pathname === "/v1/project-1/firewall/exist" ? { data: { limit: 100, offset: 0, total: 1, records: [{ ...detailRecord, protect_objects: [object1] }] } } : undefined);
  const saved = { ...ruleEntry, operation: "Enable or disable ACL rule", jobId: `${object0.object_id}:${rule.rule_id}`, verification: { fields: ["status"], digest: "a".repeat(64) } };
  await assert.rejects(cfwManagement.poll!(session, saved), /no longer belongs to this firewall/);
});

test("CFW preserves native writable protocol arrays and rejects malformed arrays", async t => {
  let shape: Record<string, unknown> = { ...rule, service: { ...rule.service, protocols: [6, 17] } };
  const { writes } = ruleCloud(t, () => shape);
  await cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource);
  assert.deepEqual((writes[0].body as { service: { protocols: number[] } }).service.protocols, [6, 17]);
  for (const protocols of [[true], ["6"], [999], [{}]]) {
    shape = { ...rule, service: { ...rule.service, protocols } };
    await assert.rejects(cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource), /could not be verified/);
  }
  assert.equal(writes.length, 1);
});

test("CFW blocks nonempty multi-object addresses on an unsupported rule rewrite", async t => {
  const { writes } = ruleCloud(t, () => ({ ...rule, source: { ...rule.source, ip_address: ["1.2.3.4"] } }));
  await assert.rejects(cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource), /unverifiable field ip_address/);
  assert.equal(writes.length, 0);
});

test("CFW deletion finds multi-object group references despite a stale zero count", async t => {
  let kind = "address";
  const { writes } = cloud(t, url => {
    if (url.pathname.endsWith("/service-sets")) return { data: { total: 1, records: [{ ...svcSet, ref_count: 0 }] } };
    if (!url.pathname.endsWith("/acl-rules")) return undefined;
    const current = kind === "address" ? { ...rule, source: { type: 5, address_group: [addrSet.set_id], predefined_group: [], ip_address: [] } } : { ...rule, service: { type: 1, service_group: [svcSet.set_id], predefined_group: [] } };
    return { data: { total: 1, records: [current] } };
  });
  await assert.rejects(cfwManagement.execute(session, "delete-addr", {}, addrResource), /fresh ACL rule check still references/);
  kind = "service";
  await assert.rejects(cfwManagement.execute(session, "delete-svc", {}, svcResource), /fresh ACL rule check still references/);
  assert.equal(writes.length, 0);
});

test("CFW group deletion blocks incomplete or malformed fresh dependency records", async t => {
  let source: unknown = null;
  const { writes } = cloud(t, url => url.pathname.endsWith("/acl-rules") ? { data: { total: 1, records: [{ ...rule, source }] } } : undefined);
  for (source of [null, {}, { type: 1 }, { type: 5, address_group: [] }, { type: 5, address_group: [true], predefined_group: [] }]) {
    await assert.rejects(cfwManagement.execute(session, "delete-addr", {}, addrResource), /could not be verified/);
  }
  assert.equal(writes.length, 0);
});

test("CFW main inventory uses native IDs and typed capacities without unknown defaults", async t => {
  cloud(t, url => url.pathname.endsWith("/firewalls/list") ? { data: { total: 1, records: [{ ...fw, status: "private-status", charge_mode: null, flavor: { eip_count: true, vpc_count: "0", bandwidth: null } }] } } : undefined);
  const [current] = await listCloudFirewallsForProject(session);
  assert.equal(current.id, fw.fw_instance_id);
  assert.equal(current.status, "UNKNOWN");
  assert.equal(current.chargeMode, "UNKNOWN");
  assert.equal(current.eipCount, null);
  assert.equal(current.vpcCount, null);
  assert.equal(current.bandwidth, "Unknown");
});

test("CFW main and management inventories reject changing or missing totals on later pages", async t => {
  let second: unknown = 99;
  cloud(t, (url, _init, body) => {
    if (!url.pathname.endsWith("/firewalls/list")) return undefined;
    const offset = (body as { offset?: number }).offset ?? 0;
    return { data: { total: offset ? second : 101, records: offset ? [fw2] : Array.from({ length: 100 }, (_, index) => ({ ...fw, fw_instance_id: `native-${index}` })) } };
  });
  for (second of [99, undefined, "101", null]) for (const loader of [listCloudFirewallsForProject, cfwManagement.inventory]) await assert.rejects(loader(session), /changed during pagination|incomplete Cloud Firewall inventory page/);
});

test("CFW sanitizes nested business failures and network errors on inventory reads", async t => {
  let network = false;
  t.mock.method(globalThis, "fetch", async () => {
    if (network) throw new Error("private-network-message");
    return Response.json({ data: { error_code: "CFW.failure", error_msg: "private-business-message" } });
  });
  for (network of [false, true]) await assert.rejects(listCloudFirewallsForProject(session), error => error instanceof Error && !error.message.includes("private-") && /Cloud Firewall/.test(error.message));
});

test("CFW refuses renamed parents and malformed selected rule identities before writes", async t => {
  const { writes } = cloud(t);
  await assert.rejects(cfwManagement.execute(session, "protect-eip", {}, { ...fwResource, name: "old name" }), /renamed since selection/);
  await assert.rejects(cfwManagement.execute(session, "rename-addr", { name: "new" }, { ...addrResource, name: "old name" }), /renamed since selection/);
  await assert.rejects(cfwManagement.execute(session, "delete-rule", { rule: `${object0.object_id}:${rule.rule_id}:extra`, confirmName: rule.name }, fwResource), /Select a current ACL rule/);
  assert.equal(writes.length, 0);
});

test("CFW unknown address families cannot authorize an address insertion", async t => {
  let addressType: unknown = null;
  const { writes } = cloud(t, url => url.pathname.endsWith("/address-sets") ? { data: { total: 1, records: [{ ...addrSet, address_type: addressType }] } } : undefined);
  for (addressType of [null, true, false, "0"]) await assert.rejects(cfwManagement.execute(session, "add-addr-item", { address: "1.2.3.4" }, addrResource), /could not be verified/);
  assert.equal(writes.length, 0);
});

test("CFW rejects malformed custom group classifications instead of filtering away rows", async t => {
  let mode: unknown = null;
  const { writes } = cloud(t, url => url.pathname.endsWith("/address-sets") ? { data: { total: 1, records: [{ ...addrSet, address_set_type: mode }] } } : undefined);
  for (mode of [null, "0", false, 1]) await assert.rejects(cfwManagement.inventory(session), /unverifiable custom address group type/);
  assert.equal(writes.length, 0);
});

test("CFW service group and item readbacks reject provided foreign or empty parents", async t => {
  let parent: unknown = null;
  let kind = "group";
  cloud(t, url => {
    if (kind === "group" && url.pathname.endsWith("/service-sets")) return { data: { total: 1, records: [{ ...svcSet, object_id: parent }] } };
    if (kind === "item" && url.pathname.endsWith("/address-items")) return { data: { total: 1, records: [{ ...addrItem, set_id: parent }] } };
    return undefined;
  });
  for (parent of [null, "", "foreign"]) await assert.rejects(cfwManagement.inventory(session), /different protection object/);
  kind = "item";
  for (parent of [null, "", "foreign"]) await assert.rejects(cfwManagement.execute(session, "addr-items", {}, addrResource), /different group/);
});

test("CFW nested creation ACKs reject null or foreign parent identities", async t => {
  let parent: unknown = null;
  let kind = "rule";
  cloud(t, url => {
    if (kind === "rule" && url.pathname.endsWith("/acl-rule")) return { data: { rules: [{ id: "accepted-rule", name: ruleValues.name, object_id: parent }] } };
    if (kind === "item" && url.pathname.endsWith("/address-items")) return { data: { items: [{ id: "accepted-item", set_id: parent }] } };
    return undefined;
  });
  for (parent of [null, "", "foreign"]) await assert.rejects(cfwManagement.execute(session, "create-rule", ruleValues, fwResource), /different protection object/);
  kind = "item";
  for (parent of [null, "", "foreign"]) await assert.rejects(cfwManagement.execute(session, "add-addr-item", { address: "1.2.3.4" }, addrResource), /different group/);
});

test("CFW rule rewrites reject fractional native settings and contradictory rule types", async t => {
  let shape: Record<string, unknown> = rule;
  const { writes } = ruleCloud(t, () => shape);
  for (const change of [{ long_connect_time: 1.5 }, { action_type: Infinity }, { type: 1 }, { action_type: 99 }, { address_type: true }]) {
    shape = { ...rule, ...change };
    await assert.rejects(cfwManagement.execute(session, "rule-status", { rule: `${object0.object_id}:${rule.rule_id}`, enabled: false }, fwResource), /could not be verified/);
  }
  assert.equal(writes.length, 0);
});

test("CFW progress checks require the complete creation fingerprint", async t => {
  cloud(t);
  await assert.rejects(cfwManagement.poll!(session, { ...ruleEntry, jobId: `${object0.object_id}:${rule.rule_id}`, verification: { fields: ["status"], digest: "a".repeat(64) } }), /observer is missing or invalid/);
});

test("CFW invalidates the actual inventory cache and retains original deleted group IDs", async t => {
  cloud(t);
  assert.ok(cfwManagement.invalidationKeys().includes("listCloudFirewalls"));
  const result = await cfwManagement.execute(session, "delete-addr", {}, addrResource);
  assert.equal(result.resourceId, addrResource.id);
});
