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
