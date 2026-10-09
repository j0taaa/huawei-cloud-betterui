import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { validateManagementValues, type ManagementOperation } from "@/lib/management-contract";
import { projectForId } from "@/lib/huawei/projects";
import { getManagementContext, runManagementOperation } from "@/lib/huawei/management";
import { listManagementHistory } from "@/lib/huawei/management/history";
import { managementAdapters } from "@/lib/huawei/management/registry";
import { CloudLoadError } from "@/lib/huawei/errors";
import { createSession, deleteSession } from "@/lib/auth-session";
import { withSessionCookie } from "./fixtures/request-context.mjs";
import { project, session } from "./fixtures/session";

const folder = mkdtempSync(path.join(os.tmpdir(), "betterui-management-"));
process.env.BETTERUI_DATA_DIR = folder;
after(() => rm(folder, { force: true, recursive: true }));
const account = { ...session, accountToken: "account-token" };
const operation: ManagementOperation = { id: "create", label: "Create", kind: "create", description: "Create resource", fields: [
  { key: "name", label: "Name", required: true, pattern: "^[a-z]+$", max: 10 },
  { key: "size", label: "Size", type: "number", min: 1, max: 100 },
  { key: "ids", label: "IDs", type: "list", source: "resources" },
  { key: "enabled", label: "Enabled", type: "boolean" },
  { key: "secret", label: "Secret", type: "password", min: 3 },
] };

test("management forms validate types, bounds, unknown fields, and dynamic choices", () => {
  assert.deepEqual(validateManagementValues(operation, { name: " abc ", size: 1, ids: ["one", "one"], enabled: false, secret: " secret " }, { resources: [{ value: "one", label: "One" }] }), { name: "abc", size: 1, ids: ["one"], enabled: false, secret: " secret " });
  for (const values of [{}, { name: "bad name" }, { name: "abc", arbitrary: true }, { name: "abc", size: "1" }, { name: "abc", size: 1.5 }, { name: "abc", size: 101 }, { name: "abc", enabled: "true" }, { name: "abc", ids: ["other"] }, { name: "abc", secret: "x" }]) assert.throws(() => validateManagementValues(operation, values), /required|invalid|unsupported|whole number|enabled|unavailable/);
});

test("explicit unknown project cannot fall back to the default project", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not request cloud."); });
  assert.throws(() => projectForId(session, "other-project"), /not part/);
  assert.equal(projectForId(session).projectId, project.projectId);
  await assert.rejects(getManagementContext(session, "aom", "other-project"), /not part/);
  await assert.rejects(runManagementOperation(session, "aom", { operation: "create", requestId: randomUUID(), projectId: "other-project", acknowledgedImpact: true, values: { name: "Monitor", type: "ECS" } }), /not part/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("unsupported service, operation, fields and missing account scope are rejected", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(getManagementContext(session, "__proto__"), /not been implemented/);
  await assert.rejects(getManagementContext(session, "enterprise-projects"), /account token/);
  await assert.rejects(runManagementOperation(account, "enterprise-projects", { operation: "evil", values: {} }), /Unsupported operation/);
  await assert.rejects(runManagementOperation(account, "enterprise-projects", { operation: "create", requestId: randomUUID(), path: "/evil", values: {} }), /Unsupported operation details/);
  await assert.rejects(runManagementOperation(account, "enterprise-projects", { operation: "create", requestId: randomUUID(), values: { name: "valid", arbitrary: 1 } }), /unsupported field/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("AOM create uses pinned project and region; replay sends only one mutation", async (t) => {
  const second = { ...project, projectId: "second", region: "eu-west-101", token: "second-token" };
  let mutations = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.equal(new URL(input).pathname, "/v1/second/aom/prometheus");
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), second.token);
    assert.equal(new Headers(init.headers).get("region"), second.region);
    assert.deepEqual(JSON.parse(String(init.body)), { prom_name: "Monitor", prom_type: "ECS", enterprise_project_id: "0", project_id: "second" });
    mutations++; return Response.json({ prometheus: [{ prom_id: "created" }] });
  });
  const scoped = { ...session, projects: [project, second] };
  const body = { operation: "create", requestId: randomUUID(), projectId: second.projectId, acknowledgedImpact: true, values: { name: "Monitor", type: "ECS" } };
  const result = await runManagementOperation(scoped, "aom", body);
  assert.equal(result.ok, true); assert.equal(result.resourceId, "created");
  const replay = await runManagementOperation(scoped, "aom", body);
  assert.equal("replayed" in replay && replay.replayed, true); assert.equal(mutations, 1);
  const [entry] = await listManagementHistory(scoped, "aom");
  assert.equal(entry.id, body.requestId); assert.equal(entry.state, "submitted"); assert.equal(entry.projectId, "second");
  assert.deepEqual(await listManagementHistory({ ...scoped, userId: "different-user" }, "aom"), []);
});

test("destructive EPS actions check protected ID, state, impact, and exact name", async (t) => {
  let mutations = 0;
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => {
    if (init.method) { mutations++; return Response.json({}); }
    return Response.json({ enterprise_projects: [{ id: "0", name: "default", status: 1 }, { id: "disabled", name: "Disabled project", status: 2 }, { id: "enabled", name: "Enabled project", status: 1 }], total_count: 3 });
  });
  const base = { operation: "delete", requestId: randomUUID(), values: {}, acknowledgedImpact: true };
  await assert.rejects(runManagementOperation(account, "enterprise-projects", { ...base, resourceId: "0", confirmName: "default" }), /protected/);
  await assert.rejects(runManagementOperation(account, "enterprise-projects", { ...base, resourceId: "enabled", confirmName: "Enabled project" }), /status/);
  await assert.rejects(runManagementOperation(account, "enterprise-projects", { ...base, resourceId: "disabled", confirmName: "wrong" }), /exact resource name/);
  await assert.rejects(runManagementOperation(account, "enterprise-projects", { ...base, acknowledgedImpact: false }), /acknowledge/);
  assert.equal(mutations, 0);
  assert.equal((await runManagementOperation(account, "enterprise-projects", { ...base, resourceId: "disabled", confirmName: "Disabled project" })).ok, true);
  assert.equal(mutations, 1);
});

test("API failure redacts password and a network failure prevents uncertain resubmission", async () => {
  const original = managementAdapters.aom;
  managementAdapters.aom = { ...original, operations: [{ ...operation, fields: [{ key: "secret", label: "Secret", type: "password", required: true }] }], inventory: async () => [], execute: async (_session, _operation, values) => { throw new Error(`Connection lost ${values.secret}`); } };
  try {
    const body = { operation: "create", requestId: randomUUID(), values: { secret: "do-not-store" } };
    await assert.rejects(runManagementOperation(session, "aom", body), (error: Error) => { assert.ok(!error.message.includes("do-not-store")); assert.match(error.message, /redacted.*may have accepted/); return true; });
    await assert.rejects(runManagementOperation(session, "aom", body), /uncertain/);
    const history = await listManagementHistory(session, "aom");
    assert.equal(history.find((entry) => entry.id === body.requestId)?.state, "uncertain");
    const accounts = await readdir(path.join(folder, "operations"));
    for (const directory of accounts) for (const filename of await readdir(path.join(folder, "operations", directory))) if (filename.endsWith(".json")) assert.ok(!(await readFile(path.join(folder, "operations", directory, filename), "utf8")).includes("do-not-store"));
  } finally { managementAdapters.aom = original; }
});

test("management route requires auth, rejects malformed JSON and foreign origin", async () => {
  const { POST, GET } = await import("@/app/api/cloud/management/[service]/route");
  const params = { params: Promise.resolve({ service: "aom" }) };
  assert.equal((await GET(new Request("http://localhost/api/cloud/management/aom"), params)).status, 401);
  const id = createSession(session);
  try {
    assert.equal((await withSessionCookie(id, () => POST(new Request("http://localhost/api/cloud/management/aom", { method: "POST", body: "{" }), params))).status, 400);
    assert.equal((await withSessionCookie(id, () => POST(new Request("http://localhost/api/cloud/management/aom", { method: "POST", headers: { origin: "https://evil.invalid" }, body: "{}" }), params))).status, 403);
  } finally { deleteSession(id); }
});

test("concurrent requests with the same ID execute only one cloud mutation", async () => {
  const original = managementAdapters.aom;
  let mutations = 0;
  managementAdapters.aom = { ...original, operations: [{ id: "create", label: "Concurrent creation", description: "Create", kind: "create", fields: [] }], inventory: async () => [], options: undefined, execute: async () => { mutations++; await new Promise((resolve) => setTimeout(resolve, 20)); return { message: "Accepted", resourceId: "created-child" }; } };
  try {
    const input = { operation: "create", requestId: randomUUID(), values: {} };
    const results = await Promise.allSettled([runManagementOperation(session, "aom", input), runManagementOperation(session, "aom", input)]);
    assert.equal(mutations, 1); assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await runManagementOperation(session, "aom", input)).resourceId, "created-child");
  } finally { managementAdapters.aom = original; }
});

test("child mutation replay remains bound to its parent while returning the child ID", async () => {
  const original = managementAdapters.aom;
  let mutations = 0;
  managementAdapters.aom = { ...original, operations: [{ id: "child", label: "Create child", description: "Create child", kind: "action", fields: [] }], inventory: async () => [{ id: "parent", name: "Parent" }], options: undefined, execute: async () => { mutations++; return { message: "Created", resourceId: "child" }; } };
  try {
    const input = { operation: "child", requestId: randomUUID(), resourceId: "parent", values: {} };
    await runManagementOperation(session, "aom", input);
    const replay = await runManagementOperation(session, "aom", input);
    assert.equal(replay.resourceId, "child"); assert.equal(mutations, 1);
    await assert.rejects(runManagementOperation(session, "aom", { ...input, resourceId: "another-parent" }), /another operation/);
  } finally { managementAdapters.aom = original; }
});

test("management origin checks use the public Host and forwarded protocol behind Next and Traefik", async () => {
  const { POST } = await import("@/app/api/cloud/management/[service]/route");
  const cookie = createSession(session);
  const params = { params: Promise.resolve({ service: "aom" }) };
  try {
    const response = await withSessionCookie(cookie, () => POST(new Request("http://localhost/api/cloud/management/aom", { method: "POST", headers: { host: "ui.hwctools.site", "x-forwarded-proto": "https", origin: "https://ui.hwctools.site" }, body: "{" }), params));
    assert.equal(response.status, 400); // Passed origin verification and reached JSON validation.
    const foreign = await withSessionCookie(cookie, () => POST(new Request("http://localhost/api/cloud/management/aom", { method: "POST", headers: { host: "ui.hwctools.site", "x-forwarded-proto": "https", origin: "https://foreign.invalid" }, body: "{" }), params));
    assert.equal(foreign.status, 403);
  } finally { deleteSession(cookie); }
});

test("partial management inventory remains visible with warnings while writes still require fresh complete inventory", async t => {
  const partial = [{ id: "available", name: "Accessible resource", status: "ACTIVE" }];
  t.mock.method(managementAdapters.aom, "inventory", async () => { throw new CloudLoadError("Workspace Two: 403 permission denied", partial); });
  const execution = t.mock.method(managementAdapters.aom, "execute", async () => { throw new Error("Must not mutate from incomplete inventory."); });
  const context = await getManagementContext(session, "aom");
  assert.deepEqual(context.resources, partial);
  assert.match(context.warnings![0], /Inventory is incomplete.*Workspace Two: 403 permission denied/);
  assert.ok(context.operations.length > 0);
  await assert.rejects(runManagementOperation(session, "aom", { operation: "delete", requestId: randomUUID(), projectId: session.projectId, resourceId: "available", confirmName: "Accessible resource", acknowledgedImpact: true, values: {} }), /permission denied/);
  assert.equal(execution.mock.callCount(), 0);
});

test("management context never turns an unrelated inventory failure into an empty resource list", async t => {
  t.mock.method(managementAdapters.aom, "inventory", async () => { throw new Error("Invalid native response"); });
  await assert.rejects(getManagementContext(session, "aom"), /Invalid native response/);
});

test("configuration observers survive saved history without retaining desired form values", async t => {
  let current = { id: "modelarts-1", name: "Research", status: "RUNNING", feature: "NOTEBOOK", description: "Before", workspace_id: "0", user_id: session.userId };
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/notebooks/all")) return Response.json({ data: [current], total: 1 });
    assert.equal(url.pathname, `/v1/${session.projectId}/notebooks/modelarts-1`);
    return Response.json(init.method === "PUT" ? { ...current, ...JSON.parse(String(init.body)) } : current);
  });
  const desired = "PRIVATE_EXPECTED_NOTEBOOK_DESCRIPTION";
  const requestId = randomUUID();
  const outcome = await runManagementOperation(session, "modelarts", { operation: "update", requestId, resourceId: current.id, projectId: session.projectId, values: { description: desired } });
  const saved = (await listManagementHistory(session, "modelarts")).find(item => item.id === requestId)!;
  assert.equal(saved.state, "submitted"); assert.equal(saved.jobId, current.id);
  assert.deepEqual(saved.verification, outcome.verification); assert.ok(!JSON.stringify(saved).includes(desired));
  assert.equal((await managementAdapters.modelarts.poll!(session, saved)).state, "submitted");
  current = { ...current, description: desired };
  assert.equal((await managementAdapters.modelarts.poll!(session, saved)).state, "succeeded");
});


test("saved restart progress survives status refreshes without accepting old ready state", async t => {
  const { GET } = await import("@/app/api/cloud/operations/[id]/route");
  const requestId = randomUUID();
  let task = "NO_TASK";
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => {
    if (init.method) return Response.json({});
    return Response.json({ total: 1, instance: [{ server_id: "bastion-owned", name: "Bastion", status_info: { status: "ACTIVE", task_status: task } }] });
  });
  await runManagementOperation(session, "cbh", { operation: "reboot", requestId, resourceId: "bastion:bastion-owned", projectId: session.projectId, confirmName: "Bastion", acknowledgedImpact: true, values: { rebootType: "SOFT" } });
  const signed = await createSession(session);
  try {
    const refresh = () => withSessionCookie(signed, () => GET(new Request(`http://localhost/api/cloud/operations/${requestId}`), { params: Promise.resolve({ id: requestId }) }));
    let response = await refresh(); assert.equal(response.status, 200);
    assert.equal((await response.json()).entry.state, "submitted");
    task = "rebooting"; response = await refresh();
    const pending = (await response.json()).entry; assert.equal(pending.observedTask, "rebooting");
    assert.equal((await listManagementHistory(session, "cbh")).find(item => item.id === requestId)?.observedTask, "rebooting");
    task = "NO_TASK"; response = await refresh();
    assert.equal((await response.json()).entry.state, "succeeded");
  } finally { await deleteSession(signed); }
});

test("CFW protection switches keep accepted requests pending without inventing native jobs", async t => {
  const { GET } = await import("@/app/api/cloud/operations/[id]/route");
  const requestId = randomUUID();
  let mutations = 0;
  const firewall = { fw_instance_id: "firewall-1", fw_instance_name: "Firewall", status: 2, charge_mode: 1 };
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/firewalls/list")) return Response.json({ data: { total: 1, records: [firewall] } });
    if (url.pathname.endsWith("/firewall/exist")) return Response.json({ data: { total: 1, records: [{ ...firewall, protect_objects: [{ object_id: "internet-1", type: 0 }] }] } });
    if (url.pathname.endsWith("/address-sets") || url.pathname.endsWith("/service-sets")) return Response.json({ data: { total: 0, records: [] } });
    assert.equal(url.pathname, "/v1/project-1/eip/protect/all/firewall-1/operation");
    mutations++;
    return Response.json({ data: { id: "firewall-1", protection_status: 1 } });
  });
  const body = { operation: "bypass-eip", requestId, resourceId: "fw:firewall-1", projectId: session.projectId, confirmName: "Firewall", acknowledgedImpact: true, values: {} };
  const result = await runManagementOperation(session, "cfw", body);
  const saved = (await listManagementHistory(session, "cfw")).find(item => item.id === requestId)!;
  assert.equal(result.asynchronous, true);
  assert.equal(saved.state, "submitted");
  assert.equal(saved.jobId, undefined);
  assert.equal(saved.finishedAt, undefined);
  assert.equal(saved.resourceId, "fw:firewall-1");
  assert.match(saved.message!, /accepted and is in progress/);
  assert.equal((await runManagementOperation(session, "cfw", body)).replayed, true);
  assert.equal(mutations, 1);
  const signed = await createSession(session);
  try {
    const response = await withSessionCookie(signed, () => GET(new Request(`http://localhost/api/cloud/operations/${requestId}`), { params: Promise.resolve({ id: requestId }) }));
    const value = await response.json();
    assert.equal(value.canRefresh, false);
    assert.equal(value.entry.state, "submitted");
  } finally { await deleteSession(signed); }
});

test("DataArts creation and retry retain accepted requests as pending history without fabricated jobs", async t => {
  const { GET } = await import("@/app/api/cloud/operations/[id]/route");
  let mutations = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method === "POST") { mutations++; return Response.json(url.pathname.includes("/workspaces/") ? { is_success: true, message: "not-a-typed-workspace-id" } : {}); }
    if (url.pathname.endsWith("/instances")) return Response.json({ count: 1, commodity_orders: [{ resource_id: "studio-1", resource_name: "Studio", status: 2, project_id: session.projectId, region_id: session.region, domain_id: "domain-1" }] });
    if (url.pathname.includes("/workspaces/")) return Response.json({ count: 1, data: [{ id: "workspace-1", name: "Workspace", project_id: session.projectId, instance_id: "studio-1", domain_id: "domain-1", eps_id: "0", is_default: 0 }] });
    if (url.pathname.endsWith("/factory/jobs")) return Response.json({ total: 1, jobs: [{ name: "ETL", status: "STOPPED" }] });
    if (url.pathname.endsWith("/instances/detail")) return Response.json({ total: 1, instances: [{ instance_id: 123, job_id: 456, job_name: "ETL", plan_time: 1767225600000, submit_time: 1767225600001, status: "fail" }] });
    throw new Error("Unexpected native fixture path");
  });
  const requests = [
    { operation: "create-workspace", requestId: randomUUID(), projectId: session.projectId, acknowledgedImpact: true, values: { instance: "studio-1", name: "Research", epsId: "0", description: "Private form description" } },
    { operation: "retry-job", requestId: randomUUID(), projectId: session.projectId, resourceId: "job:studio-1:workspace-1:ETL", confirmName: "ETL", acknowledgedImpact: true, values: { instance: "123", retryLocation: "errorNode", retryTaskVersion: "original_version" } },
  ];
  for (const body of requests) {
    const before = mutations;
    const result = await runManagementOperation(session, "dataarts", body);
    assert.equal(result.asynchronous, true);
    const saved = (await listManagementHistory(session, "dataarts")).find(item => item.id === body.requestId)!;
    assert.equal(saved.state, "submitted"); assert.equal(saved.jobId, undefined); assert.equal(saved.finishedAt, undefined);
    assert.ok(!JSON.stringify(saved).includes("Private form description"));
    assert.equal((await runManagementOperation(session, "dataarts", body)).replayed, true); assert.equal(mutations, before + 1);
    const signed = await createSession(session);
    try {
      const response = await withSessionCookie(signed, () => GET(new Request(`http://localhost/api/cloud/operations/${body.requestId}`), { params: Promise.resolve({ id: body.requestId }) }));
      const value = await response.json(); assert.equal(value.canRefresh, false); assert.equal(value.entry.state, "submitted");
    } finally { await deleteSession(signed); }
  }
});

test("AAD acknowledged protection settings remain submitted without invented native jobs and replay one write", async t => {
  const requestId = randomUUID(); let writes = 0;
  const policy = { id: "policy-owned", name: "Web", package_id: "package-owned" };
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/v3/auth/tokens") return Response.json({ token: { domain: { id: "domain-owned" }, user: { id: account.userId, domain: { id: "domain-owned" } } } });
    if (init.method === "PUT") { writes++; return Response.json({}); }
    if (url.pathname === "/v1/cnad/packages") return Response.json({ total: 1, items: [{ package_id: "package-owned", package_name: "Package" }] });
    if (url.pathname === "/v1/cnad/policies") return Response.json({ total: 1, items: [policy] });
    if (url.pathname === "/v1/cnad/policies/policy-owned") return Response.json({ ...policy, clean_threshold: 100 });
    if (url.pathname === "/v1/cnad/protected-ips") return Response.json({ total: 0, items: [] });
    if (url.pathname.startsWith("/v1/aad/")) return Response.json({ count: 0, items: [] });
    throw new Error("Unexpected native AAD request");
  });
  const body = { requestId, operation: "policy-settings", projectId: account.projectId, resourceId: "policy:policy-owned", confirmName: "Web", acknowledgedImpact: true, values: { name: "Web", description: "private-protection-description", threshold: 100, udp: "unblock", tcp: "unblock", icmp: "unblock", other: "unblock" } };
  const result = await runManagementOperation(account, "aad", body); assert.equal(result.asynchronous, true); assert.equal(result.jobId, undefined);
  const saved = (await listManagementHistory(account, "aad")).find(entry => entry.id === requestId)!;
  assert.equal(saved.state, "submitted"); assert.equal(saved.finishedAt, undefined); assert.equal(saved.resourceId, "policy:policy-owned"); assert.doesNotMatch(JSON.stringify(saved), /private-protection-description/);
  assert.equal((await runManagementOperation(account, "aad", body)).replayed, true); assert.equal(writes, 1);
});
test("Flexus native password acknowledgements keep original resource history pending and do not store secrets", async t => {
  const requestId = randomUUID(); let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/v3/auth/tokens") return Response.json({ token: { domain: { id: "domain-owned" }, user: { id: account.userId, domain: { id: "domain-owned" } } } });
    if (url.pathname.includes("/all-resources")) return Response.json({ resources: [{ provider: "hcss", type: "l-instance", id: "bundle-owned", name: "Bundle", project_id: account.projectId, region_id: account.region, properties: { resources: [{ logical_resource_type: "huaweicloudinternal_ecs_instance", physical_resource_id: "server-owned" }], metadata: { charging_mode: "prePaid" } } }], page_info: { current_count: 1, next_marker: null } });
    if (url.pathname.endsWith("/cloudservers/detail")) return Response.json({ servers: [] });
    if (url.pathname.endsWith("/os-reset-password") && init.method === "PUT") { writes++; return new Response(null, { status: 204 }); }
    if (url.pathname.endsWith("/cloudservers/server-owned")) return Response.json({ server: { id: "server-owned", name: "Server", tenant_id: account.projectId, status: "SHUTOFF", locked: false, "OS-EXT-STS:task_state": null, metadata: { lockSource: "hcss", lockSourceId: "bundle-owned", charging_mode: "1" } } });
    throw new Error("Unexpected native Flexus request");
  });
  const password = "ValidXX47!";
  const body = { requestId, operation: "reset-password", projectId: account.projectId, resourceId: "l:bundle-owned:server-owned", confirmName: "Bundle", acknowledgedImpact: true, values: { password } };
  const result = await runManagementOperation(account, "flexus", body); assert.equal(result.asynchronous, true); assert.equal(result.jobId, undefined);
  const saved = (await listManagementHistory(account, "flexus")).find(entry => entry.id === requestId)!;
  assert.equal(saved.state, "submitted"); assert.equal(saved.finishedAt, undefined); assert.equal(saved.resourceId, body.resourceId); assert.doesNotMatch(JSON.stringify(saved), new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((await runManagementOperation(account, "flexus", body)).replayed, true); assert.equal(writes, 1);
});
test("Cost analysis runs only native read queries and saves no mutation history", async t => {
  const { currentBillingMonth } = await import("@/lib/billing-query");
  const before = await listManagementHistory(account, "cost"); let queries = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/v3/auth/tokens") return Response.json({ token: { domain: { id: "domain-owned" }, user: { id: account.userId, domain: { id: "domain-owned" } } } });
    assert.equal(url.pathname, "/v4/costs/cost-analysed-bills/query"); assert.equal(init.method, "POST"); queries++;
    return Response.json({ currency: "USD", total_count: 1, cost_data: [{ dimensions: [{ key: "REGION_CODE", value: "region-one" }], amount_by_costs: "0.30" }] });
  });
  const result = await runManagementOperation(account, "cost", { operation: "analyze-costs", resourceId: "account:domain-owned", values: { month: currentBillingMonth(), group: "REGION_CODE", type: "ORIGINAL_COST" } });
  assert.equal(result.ok, true); assert.equal(queries, 1); assert.deepEqual(await listManagementHistory(account, "cost"), before);
});

test("Flexus X remains manageable when the independent L account inventory is denied", async t => {
  let writes = 0;
  const server = { id: "x-partial", name: "Accessible X", status: "SHUTOFF", tenant_id: session.projectId, flavor: { name: "x1.2u.4g", vcpus: "2", ram: "4096" }, locked: false, "OS-EXT-STS:task_state": null, metadata: {} };
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/v3/auth/tokens") return Response.json({ token: { domain: { id: "domain-1" }, user: { id: session.userId, domain: { id: "domain-1" } } } });
    if (url.hostname.startsWith("rms.")) return Response.json({ error: "PRIVATE-L-DIAGNOSTIC" }, { status: 403 });
    if (init.method === "POST") { writes++; return Response.json({ job_id: "native-x-job" }); }
    if (url.pathname.endsWith("/cloudservers/detail")) return Response.json({ servers: [server] });
    return Response.json({ server });
  });
  const context = await getManagementContext(account, "flexus");
  assert.equal(context.resources[0].id, "x:x-partial");
  assert.match(context.warnings!.join(" "), /Flexus L.*403/);
  assert.ok(!context.warnings!.join(" ").includes("PRIVATE-L-DIAGNOSTIC"));
  const body = { requestId: randomUUID(), operation: "start", projectId: session.projectId, resourceId: "x:x-partial", confirmName: server.name, acknowledgedImpact: true, values: {} };
  const outcome = await runManagementOperation(account, "flexus", body);
  assert.equal(outcome.jobId, "native-x-job");
  assert.equal(outcome.asynchronous, true);
  await assert.rejects(runManagementOperation(account, "flexus", { ...body, requestId: randomUUID(), resourceId: "x:foreign" }), /not found/);
  assert.equal(writes, 1);
});

test("AAD project domains remain manageable when the independent global CNAD planes are denied", async t => {
  let writes = 0;
  const domain = { domain_id: "accessible", domain_name: "accessible.example.com", enterprise_project_id: "0", real_server_type: 0, real_servers: ["192.0.2.20"], protocol: ["HTTP"], cname: "aad.example.com", waf_switch: true };
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/v3/auth/tokens") return Response.json({ token: { domain: { id: "domain-1" }, user: { id: session.userId, domain: { id: "domain-1" } } } });
    if (url.pathname.startsWith("/v1/cnad/")) return Response.json({}, { status: 403 });
    if (init.method) { writes++; return Response.json({}); }
    if (url.pathname.endsWith("/protected-domains")) return Response.json({ items: [domain], count: 1 });
    if (url.pathname.endsWith("/instances")) return Response.json({ items: [], count: 0 });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  const context = await getManagementContext(account, "aad");
  assert.equal(context.resources[0].id, "domain:accessible");
  assert.match(context.warnings!.join(" "), /403/);
  const inspect = await runManagementOperation(account, "aad", { operation: "inspect-domain", projectId: session.projectId, resourceId: "domain:accessible", values: {} });
  assert.ok(inspect.facts!.some(fact => fact.value.includes("accessible.example.com")));
  const body = { requestId: randomUUID(), operation: "domain-web-switch", projectId: session.projectId, resourceId: "domain:accessible", confirmName: domain.domain_name, acknowledgedImpact: true, values: { wafSwitch: true, ccSwitch: false } };
  assert.equal((await runManagementOperation(account, "aad", body)).asynchronous, true);
  await assert.rejects(runManagementOperation(account, "aad", { ...body, requestId: randomUUID(), resourceId: "domain:foreign" }), /not found/);
  assert.equal(writes, 1);
});

test("affected detail caches reload after management mutations across native and composite identities", async () => {
  const { withCloudResult } = await import("@/lib/huawei/result");
  const cases = [
    ["dcs", "cache-detail", "dcs-instance:cache-detail"],
    ["dms-kafka", "kafka-detail", "dms-kafka-instance:kafka-detail"],
    ["geminidb", "gemini-detail", "geminidb-instance:gemini-detail"],
    ["cci", "namespace-detail", "cci-namespace:namespace-detail"],
    ["evs", "disk-detail", "evs-disk-snapshots:disk-detail"],
    ["flexus", "x:server-detail", "ecs-instance-v2:server-detail"],
    ["flexus", "l:bundle-detail:server-detail", "ecs-monitoring-v3:server-detail"],
  ];
  const scoped = { ...session, userId: `cache-review-${randomUUID()}` };
  const cookie = createSession(scoped);
  try {
    for (const [service, resourceId, key] of cases) {
      const original = managementAdapters[service];
      let current = "before";
      let reads = 0;
      managementAdapters[service] = { ...original, operations: [{ id: "update", label: "Review cache mutation", description: "Change", kind: "update", fields: [] }], options: undefined, inventoryForResource: undefined, inventory: async () => [{ id: resourceId, name: "Resource" }], execute: async () => { current = "after"; return { message: "Updated" }; } };
      try {
        const read = () => withSessionCookie(cookie, () => withCloudResult("", async () => { reads++; return current; }, key));
        assert.equal((await read()).data, "before");
        assert.equal((await read()).data, "before");
        assert.equal(reads, 1);
        await runManagementOperation(scoped, service, { requestId: randomUUID(), operation: "update", resourceId, values: {} });
        assert.equal((await read()).data, "after", `${service} must invalidate ${key}`);
        assert.equal(reads, 2);
      } finally { managementAdapters[service] = original; }
    }
  } finally { deleteSession(cookie); }
});

test("native cloud-job failure diagnostics never enter HTTP responses or persisted history", async t => {
  const { saveManagementHistory, readManagementHistory } = await import("@/lib/huawei/management/history");
  const { GET } = await import("@/app/api/cloud/operations/[id]/route");
  const diagnostic = "adminPass=PRIVATE-PASSWORD; connectionString=PRIVATE-CONNECTION";
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "FAIL", fail_reason: diagnostic, error_msg: diagnostic, entities: { server_id: "native-private-test" } }));
  const id = randomUUID();
  await saveManagementHistory(session, { id, service: "ecs", projectId: session.projectId, operation: "Start", resourceId: "native-private-test", startedAt: new Date().toISOString(), state: "submitted", jobId: "native-private-job" });
  const cookie = createSession(session);
  try {
    const response = await withSessionCookie(cookie, () => GET(new Request(`http://localhost/api/cloud/operations/${id}`), { params: Promise.resolve({ id }) }));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes("PRIVATE-"));
    assert.equal((await readManagementHistory(session, id))!.state, "failed");
    assert.ok(!JSON.stringify(await readManagementHistory(session, id)).includes("PRIVATE-"));
  } finally { deleteSession(cookie); }
});

test("resource observations persist and refresh independently of native cloud jobs", async () => {
  const { GET } = await import("@/app/api/cloud/operations/[id]/route");
  const original = managementAdapters.aom;
  const requestId = randomUUID();
  let writes = 0;
  let complete = false;
  const scoped = { ...session, userId: `observation-${requestId}` };
  managementAdapters.aom = { ...original, operations: [{ id: "change", label: "Observed change", kind: "update", description: "Observe", fields: [] }], inventory: async () => [{ id: "parent", name: "Parent" }], execute: async () => { writes++; return { message: "Accepted", resourceId: "parent", observationId: "native-child", asynchronous: true }; }, poll: async (selected, entry) => {
    assert.equal(selected.projectId, session.projectId);
    assert.equal(entry.resourceId, "parent");
    assert.equal(entry.jobId, undefined);
    assert.equal(entry.observationId, "native-child");
    return { state: complete ? "succeeded" : "submitted", message: complete ? "Verified" : "Pending" };
  } };
  const cookie = createSession(scoped);
  try {
    const input = { requestId, operation: "change", projectId: session.projectId, resourceId: "parent", values: {} };
    const outcome = await runManagementOperation(scoped, "aom", input);
    assert.equal(outcome.jobId, undefined);
    assert.equal(outcome.observationId, "native-child");
    const replay = await runManagementOperation(scoped, "aom", input);
    assert.equal(replay.observationId, "native-child");
    assert.equal(writes, 1);
    const refresh = () => withSessionCookie(cookie, () => GET(new Request(`http://localhost/api/cloud/operations/${requestId}`), { params: Promise.resolve({ id: requestId }) }));
    const pending = await refresh();
    assert.equal(pending.status, 200);
    assert.equal((await pending.json()).canRefresh, true);
    complete = true;
    const done = await refresh();
    const result = await done.json();
    assert.equal(result.entry.state, "succeeded");
    assert.equal(result.canRefresh, false);
    assert.equal(result.entry.observationId, "native-child");
    assert.equal(result.entry.jobId, undefined);
  } finally { deleteSession(cookie); managementAdapters.aom = original; }
});
