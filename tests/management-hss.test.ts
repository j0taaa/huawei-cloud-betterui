import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { hssManagement } from "@/lib/huawei/management/adapters/hss";
import { session } from "./fixtures/session";

const host = { host_id: "host-1", host_name: "web-1", agent_status: "online", version: "hss.version.basic", protect_status: "opened", charging_mode: "", resource_id: "", group_id: "", group_name: "", policy_group_name: "default", os_type: "Linux", os_name: "Ubuntu 22.04", private_ip: "10.0.0.1", public_ip: "", detect_result: "clean", vulnerability: 1, baseline: 2, intrusion: 0, expire_time: 0, agent_install_script: "PRIVATE_AGENT_PAYLOAD" };
const paidHost = { ...host, host_id: "host-2", host_name: "db-1", version: "hss.version.enterprise", charging_mode: "on_demand", resource_id: "quota-used-1" };
const offlineHost = { ...host, host_id: "host-3", host_name: "batch-1", agent_status: "offline" };
const groupedHost = { ...host, host_id: "host-4", host_name: "app-1", group_id: "group-1", group_name: "Webs" };
const foreignGroupedHost = { ...host, host_id: "host-5", host_name: "worker-1", group_id: "group-3", group_name: "Batch" };
const hosts = [host, paidHost, offlineHost, groupedHost, foreignGroupedHost];
const group = { group_id: "group-1", group_name: "Webs", host_num: 1, risk_host_num: 1, unprotect_host_num: 0, host_id_list: ["host-4"] };
const emptyGroup = { group_id: "group-2", group_name: "Databases", host_num: 0, risk_host_num: 0, unprotect_host_num: 0, host_id_list: [] };
const foreignGroup = { group_id: "group-3", group_name: "Batch", host_num: 1, risk_host_num: 0, unprotect_host_num: 1, host_id_list: ["host-5"] };
const groups = [group, emptyGroup, foreignGroup];
const idleQuota = { resource_id: "quota-1", version: "hss.version.enterprise", quota_status: "normal", used_status: "idle", charging_mode: "on_demand", expire_time: 0, host_id: "", host_name: "" };
const monthlyQuota = { resource_id: "quota-2", version: "hss.version.premium", quota_status: "normal", used_status: "idle", charging_mode: "packet_cycle", expire_time: 1893456000, host_id: "", host_name: "" };
const usedQuota = { resource_id: "quota-used-1", version: "hss.version.enterprise", quota_status: "normal", used_status: "used", charging_mode: "on_demand", expire_time: 0, host_id: "host-2", host_name: "db-1" };
const expiredQuota = { resource_id: "quota-3", version: "hss.version.wtp", quota_status: "normal", used_status: "idle", charging_mode: "packet_cycle", expire_time: 1000, host_id: "", host_name: "" };
const quotas = [idleQuota, monthlyQuota, usedQuota, expiredQuota];
const securityEvent = { operate_accept_list: ["mark_as_handled"], event_id: "event-1", event_class_id: "login_0003", event_type: 4004, event_name: "Weak password", severity: "Medium", handle_status: "unhandled", occur_time: 1767225600000, host_id: "host-1", host_name: "web-1" };
const events = [securityEvent];
const policy = { policy_id: "policy-1", group_id: "group-p1", policy_name: "default", feature_name: "login protection", policy_category: "host", policy_status: "applied" };
const policies = [policy];
const hostResource = { id: `host:${host.host_id}`, name: host.host_name, status: "opened" };
const paidResource = { id: `host:${paidHost.host_id}`, name: paidHost.host_name, status: "opened" };
const offlineResource = { id: `host:${offlineHost.host_id}`, name: offlineHost.host_name, status: "opened" };
const groupResource = { id: `group:${group.group_id}`, name: group.group_name, status: "Available" };
const emptyGroupResource = { id: `group:${emptyGroup.group_id}`, name: emptyGroup.group_name, status: "Available" };
const editionValue = JSON.stringify([idleQuota.version, idleQuota.charging_mode, idleQuota.resource_id]);
const eventValue = JSON.stringify([securityEvent.event_class_id, securityEvent.event_id, securityEvent.event_type, securityEvent.occur_time]);

function read(url: URL): Record<string, unknown> {
  const path = url.pathname;
  if (path === "/v5/project-1/host-management/hosts") return { total_num: hosts.length, data_list: hosts };
  if (path === "/v5/project-1/host-management/groups") return { total_num: groups.length, data_list: groups };
  if (path === "/v5/project-1/billing/quotas-detail") return { total_num: quotas.length, data_list: quotas };
  if (path === "/v5/project-1/event/events") return { total_num: events.length, data_list: events };
  if (path === "/v5/project-1/host-management/policies") return { total_num: policies.length, data_list: policies };
  if (path === `/v5/project-1/host-management/${host.host_id}/scan-status`) return { scan_status: "scanning", scaned_time: 1767225600000 };
  throw new Error(`Unexpected GET ${path}`);
}

function cloud(t: TestContext, custom?: (url: URL) => Record<string, unknown> | undefined, onWrite?: (path: string, method: string, body?: unknown) => void) {
  const writes: { path: string; method: string; body?: unknown; search: string }[] = [];
  const reads: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) { reads.push(url); return Response.json(custom?.(url) ?? read(url)); }
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    writes.push({ path: url.pathname, method: init.method, body, search: url.search });
    onWrite?.(url.pathname, init.method, body);
    return Response.json({});
  });
  return { writes, reads };
}

test("HSS inventory separates hosts and groups with canonical IDs and native statuses", async t => {
  cloud(t);
  const resources = await hssManagement.inventory(session);
  assert.deepEqual(resources.map(item => item.id), ["host:host-1", "host:host-2", "host:host-3", "host:host-4", "host:host-5", "group:group-1", "group:group-2", "group:group-3"]);
  assert.equal(resources[0].status, "opened");
  assert.equal(resources[0].values?.agentStatus, "online");
  assert.equal(resources[0].values?.version, "hss.version.basic");
  assert.equal(resources[5].status, "Available");
  assert.equal(resources[5].values?.hostNum, 1);
});

test("HSS inventory fails closed on duplicate or malformed rows", async t => {
  let malformed = false;
  cloud(t, url => {
    if (!url.pathname.endsWith("/host-management/hosts")) return undefined;
    return malformed ? { total_num: 1, data_list: [{ host_name: "no-id" }] } : { total_num: 2, data_list: [host, { ...host }] };
  });
  await assert.rejects(hssManagement.inventory(session), /duplicate HSS host/);
  malformed = true;
  await assert.rejects(hssManagement.inventory(session), /without an ID/);
});

test("HSS group creation revalidates live names and ungrouped hosts before writing", async t => {
  const { writes } = cloud(t);
  await assert.rejects(hssManagement.execute(session, "create-group", { name: "Webs", hosts: ["host-1"] }), /already exists/);
  await assert.rejects(hssManagement.execute(session, "create-group", { name: "Api", hosts: ["host-4"] }), /already belong to a host group/);
  await assert.rejects(hssManagement.execute(session, "create-group", { name: "Api", hosts: ["host-x"] }), /no longer available/);
  await assert.rejects(hssManagement.execute(session, "create-group", { name: "Api", hosts: [] as string[] }), /Select at least one member host/);
  assert.equal(writes.length, 0);
});

test("HSS group creation writes native names and host lists and observes the created group", async t => {
  let created = false;
  const { writes } = cloud(t, url => url.pathname.endsWith("/host-management/hosts") && created ? { total_num: hosts.length, data_list: hosts.map(item => item.host_id === "host-1" ? { ...item, group_id: "group-new" } : item) } : url.pathname.endsWith("/host-management/groups") && created ? { total_num: groups.length + 1, data_list: [...groups, { group_id: "group-new", group_name: "Api", host_num: 1, risk_host_num: 0, unprotect_host_num: 0, host_id_list: ["host-1"] }] } : undefined, path => { if (path.endsWith("/host-management/groups")) created = true; });
  const result = await hssManagement.execute(session, "create-group", { name: "Api", hosts: ["host-1"] });
  assert.deepEqual(writes[0], { path: "/v5/project-1/host-management/groups", method: "POST", body: { group_name: "Api", host_id_list: ["host-1"] }, search: writes[0].search });
  assert.equal(result.resourceId, "group:group-new");
  assert.match(result.message, /created with 1 member host/);
});

test("HSS group rename preserves verified membership and rejects duplicate names", async t => {
  const { writes } = cloud(t);
  await hssManagement.execute(session, "rename-group", { name: "Web servers" }, groupResource);
  assert.deepEqual(writes[0], { path: "/v5/project-1/host-management/groups", method: "PUT", body: { group_id: "group-1", group_name: "Web servers", host_id_list: ["host-4"] }, search: writes[0].search });
  await assert.rejects(hssManagement.execute(session, "rename-group", { name: "Databases" }, groupResource), /already exists/);
  assert.equal(writes.length, 1);
});

test("HSS group rewrites fail closed when reported membership cannot be verified", async t => {
  const { writes } = cloud(t, url => url.pathname.endsWith("/host-management/groups") ? { total_num: groups.length, data_list: groups.map(item => item.group_id === group.group_id ? { ...item, host_num: 2 } : item) } : undefined);
  await assert.rejects(hssManagement.execute(session, "rename-group", { name: "Web servers" }, groupResource), /does not match/);
  await assert.rejects(hssManagement.execute(session, "edit-group-hosts", { hosts: ["host-4"] }, groupResource), /does not match/);
  assert.equal(writes.length, 0);
});

test("HSS group membership replacement sends the complete new list and observes the result", async t => {
  let replaced = false;
  const { writes } = cloud(t, url => replaced && url.pathname.endsWith("/host-management/hosts") ? { total_num: hosts.length, data_list: hosts.map(item => item.host_id === "host-1" ? { ...item, group_id: "group-1" } : item) } : url.pathname.endsWith("/host-management/groups") && replaced ? { total_num: groups.length, data_list: groups.map(item => item.group_id === group.group_id ? { ...item, host_num: 2, host_id_list: ["host-4", "host-1"] } : item) } : undefined, path => { if (path.endsWith("/host-management/groups")) replaced = true; });
  const result = await hssManagement.execute(session, "edit-group-hosts", { hosts: ["host-4", "host-1"] }, groupResource);
  assert.deepEqual(writes[0].body, { group_id: "group-1", group_name: "Webs", host_id_list: ["host-4", "host-1"] });
  assert.match(result.message, /replaced with 2 hosts/);
});

test("HSS group membership replacement allows emptying the group and reports lagging state", async t => {
  const { writes } = cloud(t);
  const result = await hssManagement.execute(session, "edit-group-hosts", { hosts: [] as string[] }, groupResource);
  assert.deepEqual(writes[0].body, { group_id: "group-1", group_name: "Webs", host_id_list: [] });
  assert.match(result.message, /did not yet match the selection/);
});

test("HSS group membership replacement rejects hosts bound to another group", async t => {
  const { writes } = cloud(t);
  await assert.rejects(hssManagement.execute(session, "edit-group-hosts", { hosts: ["host-5"] }, groupResource), /another host group/);
  await assert.rejects(hssManagement.execute(session, "edit-group-hosts", { hosts: ["host-x"] }, groupResource), /no longer available/);
  assert.equal(writes.length, 0);
});

test("HSS group deletion requires an empty group and native group_id addressing", async t => {
  const { writes } = cloud(t);
  await assert.rejects(hssManagement.execute(session, "delete-group", {}, groupResource), /Remove every host/);
  await hssManagement.execute(session, "delete-group", {}, emptyGroupResource);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "DELETE");
  assert.equal(writes[0].path, "/v5/project-1/host-management/groups");
  assert.equal(new URLSearchParams(writes[0].search).get("group_id"), "group-2");
});

test("HSS host inspection reports native states without agent payloads", async t => {
  cloud(t);
  const result = await hssManagement.execute(session, "inspect-host", {}, hostResource);
  assert.ok(result.facts?.some(fact => fact.label === "Agent" && fact.value === "Online"));
  assert.ok(result.facts?.some(fact => fact.label === "Edition" && fact.value === "Basic (free)"));
  assert.ok(result.facts?.some(fact => fact.label === "Protection" && fact.value === "Protecting"));
  assert.ok(result.facts?.some(fact => fact.label === "Entitled resource" && fact.value === "None"));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_AGENT_PAYLOAD"));
});

test("HSS protection options list only idle current entitlements for eligible hosts", async t => {
  cloud(t);
  const eligible = await hssManagement.options!(session, "protect", hostResource);
  assert.deepEqual(eligible.editions.map(choice => choice.value), [JSON.stringify([idleQuota.version, idleQuota.charging_mode, idleQuota.resource_id]), JSON.stringify([monthlyQuota.version, monthlyQuota.charging_mode, monthlyQuota.resource_id])]);
  assert.ok(eligible.editions.every(choice => !choice.value.includes("quota-used-1") && !choice.value.includes("quota-3")));
  assert.equal((await hssManagement.options!(session, "protect", paidResource)).editions.length, 0);
  assert.equal((await hssManagement.options!(session, "protect", offlineResource)).editions.length, 0);
});

test("HSS protection activation writes the entitled quota and observes the edition change", async t => {
  let activated = false;
  const { writes } = cloud(t, url => url.pathname.endsWith("/host-management/hosts") && activated ? { total_num: hosts.length, data_list: hosts.map(item => item.host_id === host.host_id ? { ...item, version: "hss.version.enterprise", charging_mode: "on_demand", resource_id: "quota-1" } : item) } : undefined, path => { if (path.endsWith("/host-management/protection")) activated = true; });
  const result = await hssManagement.execute(session, "protect", { edition: editionValue }, hostResource);
  assert.deepEqual(writes[0], { path: "/v5/project-1/host-management/protection", method: "POST", body: { version: "hss.version.enterprise", charging_mode: "on_demand", resource_id: "quota-1", host_id_list: ["host-1"] }, search: writes[0].search });
  assert.match(result.message, /now reports the Enterprise edition/);
});

test("HSS protection activation reports propagation honestly when state lags", async t => {
  const { writes } = cloud(t);
  const result = await hssManagement.execute(session, "protect", { edition: editionValue }, hostResource);
  assert.equal(writes.length, 1);
  assert.match(result.message, /still reports Basic \(free\)/);
});

test("HSS protection activation guards agent, edition, and entitlement state", async t => {
  const { writes } = cloud(t);
  await assert.rejects(hssManagement.execute(session, "protect", { edition: editionValue }, offlineResource), /agent/i);
  await assert.rejects(hssManagement.execute(session, "protect", { edition: editionValue }, paidResource), /already has a paid/);
  await assert.rejects(hssManagement.execute(session, "protect", { edition: JSON.stringify(["hss.version.enterprise", "on_demand", "quota-used-1"]) }, hostResource), /no longer idle/);
  await assert.rejects(hssManagement.execute(session, "protect", { edition: JSON.stringify(["hss.version.premium", "packet_cycle", "quota-3"]) }, hostResource), /no longer idle/);
  await assert.rejects(hssManagement.execute(session, "protect", { edition: "not-json" }, hostResource), /Select an available protection edition/);
  assert.equal(writes.length, 0);
});

test("HSS protection activation revalidates the quota even when list filters are ignored", async t => {
  const { writes } = cloud(t, url => url.pathname.endsWith("/billing/quotas-detail") ? { total_num: quotas.length, data_list: quotas.map(item => item.resource_id === idleQuota.resource_id ? { ...item, used_status: "used" } : item) } : undefined);
  await assert.rejects(hssManagement.execute(session, "protect", { edition: editionValue }, hostResource), /no longer idle/);
  assert.equal(writes.length, 0);
});

test("HSS protection deactivation downgrades to basic using the host's verified entitlement", async t => {
  let deactivated = false;
  const { writes } = cloud(t, url => url.pathname.endsWith("/host-management/hosts") && deactivated ? { total_num: hosts.length, data_list: hosts.map(item => item.host_id === paidHost.host_id ? { ...item, version: "hss.version.basic", charging_mode: "", resource_id: "" } : item) } : undefined, path => { if (path.endsWith("/host-management/protection")) deactivated = true; });
  const result = await hssManagement.execute(session, "unprotect", {}, paidResource);
  assert.deepEqual(writes[0], { path: "/v5/project-1/host-management/protection", method: "POST", body: { version: "hss.version.basic", charging_mode: "on_demand", resource_id: "quota-used-1", host_id_list: ["host-2"] }, search: writes[0].search });
  assert.match(result.message, /returned to the free basic edition/);
});

test("HSS protection deactivation guards non-paid hosts and unverifiable entitlements", async t => {
  let stripEntitlement = false;
  const { writes } = cloud(t, url => url.pathname.endsWith("/host-management/hosts") && stripEntitlement ? { total_num: hosts.length, data_list: hosts.map(item => item.host_id === paidHost.host_id ? { ...item, resource_id: "" } : item) } : undefined);
  await assert.rejects(hssManagement.execute(session, "unprotect", {}, hostResource), /does not have a paid/);
  stripEntitlement = true;
  await assert.rejects(hssManagement.execute(session, "unprotect", {}, paidResource), /could not be verified/);
  assert.equal(writes.length, 0);
});

test("HSS manual detection uses the native weak-password route and observes scan status", async t => {
  const { writes, reads } = cloud(t);
  const result = await hssManagement.execute(session, "scan", {}, hostResource);
  assert.deepEqual(writes[0], { path: "/v5/project-1/host-management/host-1/manual-detect", method: "POST", body: { type: "pwd" }, search: "" });
  assert.ok(reads.some(url => url.pathname.endsWith("/host-management/host-1/scan-status") && url.searchParams.get("type") === "pwd"));
  assert.match(result.message, /Scanning/);
  await assert.rejects(hssManagement.execute(session, "scan", {}, offlineResource), /agent/i);
  assert.equal(writes.length, 1);
});

test("HSS scan reports honestly when the post-write status read fails", async t => {
  const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/scan-status")) return new Response("boom", { status: 500 });
    if (init.method) { writes.push(init.method); return Response.json({}); }
    return Response.json(read(url));
  });
  const result = await hssManagement.execute(session, "scan", {}, hostResource);
  assert.equal(writes.length, 1);
  assert.match(result.message, /could not be re-read/);
});

test("HSS scan status inspection reports native scan states", async t => {
  cloud(t);
  const result = await hssManagement.execute(session, "scan-status", {}, hostResource);
  assert.ok(result.facts?.some(fact => fact.label === "Scan status" && fact.value === "Scanning"));
  assert.ok(result.facts?.some(fact => fact.label === "Last completed" && fact.value === new Date(1767225600000).toISOString()));
});

test("HSS security events use native host-scoped queries with a bounded window", async t => {
  const { reads } = cloud(t);
  const result = await hssManagement.execute(session, "events", {}, hostResource);
  assert.ok(reads.some(url => url.pathname.endsWith("/event/events") && url.searchParams.get("category") === "host" && url.searchParams.get("host_id") === "host-1" && url.searchParams.get("last_days") === "30"));
  assert.equal(result.facts?.length, 1);
  assert.match(result.facts![0].label, /Weak password · Medium · unhandled/);
  assert.match(result.facts![0].value, /event-1/);
});

test("HSS event handling marks one revalidated unhandled event with a native operate call", async t => {
  const { writes } = cloud(t);
  const result = await hssManagement.execute(session, "handle-event", { event: eventValue, remark: "Reviewed" }, hostResource);
  assert.deepEqual(writes[0], { path: "/v5/project-1/event/operate", method: "POST", body: { operate_type: "mark_as_handled", handler: "Reviewed", operate_event_list: [{ event_class_id: "login_0003", event_id: "event-1", event_type: 4004, occur_time: 1767225600000 }] }, search: writes[0].search });
  assert.match(result.message, /does not remove the underlying threat/);
});

test("HSS event handling revalidates event identity and handling state", async t => {
  let handled = false;
  const { writes } = cloud(t, url => url.pathname.endsWith("/event/events") && handled ? { total_num: events.length, data_list: events.map(item => ({ ...item, handle_status: "handled" })) } : undefined);
  await assert.rejects(hssManagement.execute(session, "handle-event", { event: JSON.stringify(["login_0003", "event-x", 4004, 1767225600000]) }, hostResource), /not found among/);
  await assert.rejects(hssManagement.execute(session, "handle-event", { event: JSON.stringify(["login_0003", "event-1", 4004, 1767225600001]) }, hostResource), /changed/);
  await assert.rejects(hssManagement.execute(session, "handle-event", { event: "not-json" }, hostResource), /Select a current unhandled security event/);
  handled = true;
  await assert.rejects(hssManagement.execute(session, "handle-event", { event: eventValue }, hostResource), /already handled/);
  assert.equal(writes.length, 0);
});

test("HSS policy inspection lists native policies with application status", async t => {
  const { reads } = cloud(t);
  const result = await hssManagement.execute(session, "policies", {}, hostResource);
  assert.ok(reads.some(url => url.pathname.endsWith("/host-management/policies") && !url.searchParams.has("region")));
  assert.deepEqual(result.facts, [{ label: "default · login protection", value: "Applied · group group-p1 · policy-1" }]);
});

test("HSS group options expose only ungrouped or same-group hosts", async t => {
  cloud(t);
  const create = await hssManagement.options!(session, "create-group");
  assert.deepEqual(create.groupCandidates.map(choice => choice.value), ["host-1", "host-2", "host-3"]);
  const edit = await hssManagement.options!(session, "edit-group-hosts", groupResource);
  assert.deepEqual(edit.groupCandidates.map(choice => choice.value), ["host-1", "host-2", "host-3", "host-4"]);
  const handling = await hssManagement.options!(session, "handle-event", hostResource);
  assert.deepEqual(handling.unhandledEvents.map(choice => choice.value), [eventValue]);
});

test("HSS sends region in its native header rather than an undocumented query parameter", async t => {
  const calls: { url: URL; region: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input); calls.push({ url, region: new Headers(init.headers).get("region") }); return Response.json(read(url));
  });
  await hssManagement.inventory(session);
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => call.region === session.region && !call.url.searchParams.has("region")));
});

test("HSS entitlement activation rejects missing status expiry, changed edition, billing mode, or assigned hosts", async t => {
  for (const patch of [{ quota_status: undefined }, { used_status: undefined }, { expire_time: undefined }, { version: "hss.version.premium" }, { charging_mode: "packet_cycle" }, { host_id: "foreign-host" }]) {
    const { writes } = cloud(t, url => url.pathname.endsWith("/quotas-detail") ? { total_num: 1, data_list: [{ ...idleQuota, ...patch }] } : undefined);
    await assert.rejects(hssManagement.execute(session, "protect", { edition: editionValue }, hostResource), /no longer idle/);
    assert.equal(writes.length, 0);
  }
});

test("HSS event handling refuses another host and unavailable native actions", async t => {
  const foreign = cloud(t, url => url.pathname.endsWith("/event/events") ? { total_num: 1, data_list: [{ ...securityEvent, host_id: "foreign-host" }] } : undefined);
  await assert.rejects(hssManagement.execute(session, "handle-event", { event: eventValue }, hostResource), /unverified host parent/);
  assert.equal(foreign.writes.length, 0);
  const unavailable = cloud(t, url => url.pathname.endsWith("/event/events") ? { total_num: 1, data_list: [{ ...securityEvent, operate_accept_list: ["ignore"] }] } : undefined);
  await assert.rejects(hssManagement.execute(session, "handle-event", { event: eventValue }, hostResource), /does not currently offer/);
  assert.equal(unavailable.writes.length, 0);
});

test("HSS membership observation compares original host identities, including same-sized alternatives", async t => {
  let mutated = false;
  cloud(t, url => mutated && url.pathname.endsWith("/hosts") ? { total_num: hosts.length, data_list: hosts.map(item => item.host_id === "host-2" ? { ...item, group_id: "group-1" } : item) } : mutated && url.pathname.endsWith("/groups") ? { total_num: groups.length, data_list: groups.map(item => item.group_id === "group-1" ? { ...item, host_num: 2 } : item) } : undefined, () => { mutated = true; });
  const result = await hssManagement.execute(session, "edit-group-hosts", { hosts: ["host-4", "host-1"] }, groupResource);
  assert.match(result.message, /did not yet match/);
});

test("HSS group deletion checks original name and refuses unknown membership counts", async t => {
  for (const patch of [{ group_name: "Changed" }, { host_num: undefined }, { host_num: null }, { host_num: "" }]) {
    const { writes } = cloud(t, url => url.pathname.endsWith("/groups") ? { total_num: groups.length, data_list: groups.map(item => item.group_id === "group-2" ? { ...item, ...patch } : item) } : undefined);
    await assert.rejects(hssManagement.execute(session, "delete-group", {}, emptyGroupResource), /name changed|membership/);
    assert.equal(writes.length, 0);
  }
});

test("HSS deletion observation needs complete native inventory and never treats a present group as deleted", async t => {
  const entry = { id: "history-1", service: "hss", operation: "Delete host group", state: "submitted" as const, startedAt: "2026-01-01", resourceId: "group:group-2", jobId: "group-2" };
  cloud(t);
  assert.equal((await hssManagement.poll!(session, entry)).state, "submitted");
  cloud(t, url => url.pathname.endsWith("/groups") ? { total_num: 0, data_list: [] } : undefined);
  assert.equal((await hssManagement.poll!(session, entry)).state, "succeeded");
  cloud(t, url => url.pathname.endsWith("/groups") ? {} : undefined);
  await assert.rejects(hssManagement.poll!(session, entry));
});

test("HSS private API errors are redacted and ownership mismatches block writes", async t => {
  for (const response of [new Response("PRIVATE_PAYLOAD", { status: 403 }), Response.json({ error_code: "HSS.1", error_msg: "PRIVATE_PAYLOAD" }), new Response("PRIVATE_PAYLOAD", { status: 200 })]) {
    t.mock.method(globalThis, "fetch", async () => response.clone());
    await assert.rejects(hssManagement.inventory(session), error => error instanceof Error && !error.message.includes("PRIVATE_PAYLOAD"));
  }
  const { writes } = cloud(t, url => url.pathname.endsWith("/hosts") ? { total_num: 1, data_list: [{ ...host, project_id: "foreign" }] } : undefined);
  await assert.rejects(hssManagement.execute(session, "protect", { edition: editionValue }, hostResource), /another project/);
  assert.equal(writes.length, 0);
});


test("HSS group creation does not claim selected membership from a matching count alone", async t => {
  let created = false;
  cloud(t, url => created && url.pathname.endsWith("/groups") ? { total_num: groups.length + 1, data_list: [...groups, { group_id: "group-new", group_name: "Api", host_num: 1 }] } : created && url.pathname.endsWith("/hosts") ? { total_num: hosts.length, data_list: hosts.map(item => item.host_id === "host-2" ? { ...item, group_id: "group-new" } : item) } : undefined, () => { created = true; });
  const result = await hssManagement.execute(session, "create-group", { name: "Api", hosts: ["host-1"] });
  assert.equal(result.resourceId, "group:group-new");
  assert.match(result.message, /exact selected membership has not been verified/);
  assert.doesNotMatch(result.message, /created with/);
});
