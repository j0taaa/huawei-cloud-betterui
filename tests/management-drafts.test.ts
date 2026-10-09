import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createSession, deleteSession } from "@/lib/auth-session";
import { getManagementContext, runManagementOperation } from "@/lib/huawei/management";
import { managementAdapters } from "@/lib/huawei/management/registry";
import { saveCreationDraft, readCreationDraft, deleteCreationDraft } from "@/lib/huawei/management/drafts";
import { pickCreationDraft, validateCreationDraft, restoreCreationDraft } from "@/lib/management-draft-values";
import { isSameOriginManagementRequest } from "@/lib/huawei/management/request-origin";
import type { ManagementOperation } from "@/lib/management-contract";
import { session, project } from "./fixtures/session";
import { withSessionCookie } from "./fixtures/request-context.mjs";

const folder = mkdtempSync(path.join(os.tmpdir(), "betterui-creation-drafts-"));
process.env.BETTERUI_DATA_DIR = folder;
after(() => rm(folder, { recursive: true, force: true }));
const operation: ManagementOperation = { id: "create", label: "Create draft resource", description: "Create", kind: "create", fields: [
  { key: "name", label: "Name", max: 64 },
  { key: "secret", label: "Secret", type: "password" },
  { key: "description", label: "Description", type: "textarea" },
  { key: "apiKey", label: "API key", type: "text" },
  { key: "configuration", label: "Configuration", type: "textarea" },
  { key: "manualList", label: "Manual list", type: "list" },
  { key: "offering", label: "Offering", type: "select", source: "offerings" },
  { key: "size", label: "Size", type: "number", min: 1, max: 100 },
  { key: "rate", label: "Rate", type: "decimal", min: 0, max: 1 },
  { key: "enabled", label: "Enabled", type: "boolean" },
  { key: "children", label: "Children", type: "list", source: "children", max: 2 },
] };
const scope = { service: "aom", projectId: session.projectId, operation };
const draft = { name: "My resource", offering: "live-offering", size: 10, enabled: false, children: ["child-one"], rate: 0.25 };

test("drafts allow safe creation values and omit credentials/free-form fields", () => {
  const values = { ...draft, secret: "PRIVATE-PASSWORD", description: "PRIVATE-DESCRIPTION", apiKey: "PRIVATE-KEY", configuration: "PRIVATE-CONFIG", manualList: ["PRIVATE-LIST"] };
  assert.deepEqual(pickCreationDraft(operation, values), draft);
  assert.deepEqual(validateCreationDraft(operation, draft), draft);
  for (const key of ["secret", "description", "apiKey", "configuration", "manualList", "unsupported", "__proto__"]) {
    const body = JSON.parse(JSON.stringify({ ...draft, [key]: "PRIVATE" }));
    assert.throws(() => validateCreationDraft(operation, body), /cannot be saved/);
  }
});

test("drafts reject non-creation workflows and malformed/bounded values", () => {
  assert.throws(() => validateCreationDraft({ ...operation, kind: "update" }, draft), /creation workflows only/);
  for (const bad of [null, [], "text", { name: 123 }, { name: "x".repeat(65) }, { size: 1.5 }, { size: 101 }, { rate: -1 }, { enabled: "false" }, { children: "child-one" }, { children: ["one", "two", "three"] }, { children: [null] }, { offering: "x".repeat(4097) }]) assert.throws(() => validateCreationDraft(operation, bad));
});

test("restoration retains available choices and removes unavailable choices visibly", () => {
  const result = restoreCreationDraft(operation, { ...draft, offering: "retired", children: ["available", "retired"] }, { offerings: [{ value: "new", label: "New" }], children: [{ value: "available", label: "Available" }] });
  assert.equal(result.unavailable, true);
  assert.equal(result.values.offering, undefined);
  assert.deepEqual(result.values.children, ["available"]);
  assert.equal(result.values.name, draft.name);
  assert.equal(result.values.enabled, false);
  const unchanged = restoreCreationDraft(operation, draft, { offerings: [{ value: draft.offering, label: "Live" }], children: [{ value: draft.children[0], label: "Live" }] });
  assert.equal(unchanged.unavailable, false);
  assert.deepEqual(unchanged.values, draft);
});

test("persistent draft files are private, atomic, and isolated by account/user/project/service/operation", async () => {
  const identity = { ...session, userId: `draft-user-${randomUUID()}` };
  await saveCreationDraft(identity, scope, draft);
  assert.deepEqual((await readCreationDraft({ ...identity }, scope))!.values, draft);
  for (const other of [{ ...identity, accountName: "other-account" }, { ...identity, userId: "other-user" }]) assert.equal(await readCreationDraft(other, scope), null);
  for (const other of [{ ...scope, service: "other-service" }, { ...scope, projectId: "other-project" }, { ...scope, operation: { ...operation, id: "other-create" } }]) assert.equal(await readCreationDraft(identity, other), null);
  const files = await readdir(path.join(folder, "creation-drafts"));
  assert.ok(files.every(file => /^[a-f0-9]{64}\.json$/.test(file)));
  assert.equal((await stat(path.join(folder, "creation-drafts"))).mode & 0o777, 0o700);
  for (const file of files) {
    assert.equal((await stat(path.join(folder, "creation-drafts", file))).mode & 0o777, 0o600);
    const text = await readFile(path.join(folder, "creation-drafts", file), "utf8");
    assert.ok(!text.includes(session.token));
    assert.ok(!text.includes("PRIVATE-"));
  }
  await deleteCreationDraft(identity, scope);
  assert.equal(await readCreationDraft(identity, scope), null);
});

test("drafts expire after 24 hours and future timestamps do not restore", async t => {
  const identity = { ...session, userId: `expire-${randomUUID()}` };
  const now = Date.now();
  await saveCreationDraft(identity, scope, draft);
  t.mock.method(Date, "now", () => now + 25 * 60 * 60 * 1000);
  assert.equal(await readCreationDraft(identity, scope), null);
  t.mock.restoreAll();
  await saveCreationDraft(identity, scope, draft);
  t.mock.method(Date, "now", () => now - 60 * 1000);
  assert.equal(await readCreationDraft(identity, scope), null);
});

test("corrupt saved files are rejected without exposing their content", async () => {
  const identity = { ...session, userId: `corrupt-${randomUUID()}` };
  const before = new Set(await readdir(path.join(folder, "creation-drafts")));
  await saveCreationDraft(identity, scope, draft);
  const file = (await readdir(path.join(folder, "creation-drafts"))).find(file => !before.has(file))!;
  await writeFile(path.join(folder, "creation-drafts", file), '{"values":{"secret":"PRIVATE-PASSWORD"},"updatedAt":"' + new Date().toISOString() + '"}');
  await assert.rejects(readCreationDraft(identity, scope), error => error instanceof Error && /could not be verified/.test(error.message) && !error.message.includes("PRIVATE-PASSWORD"));
  await deleteCreationDraft(identity, scope);
});

test("draft storage failures are sanitized", async () => {
  const previous = process.env.BETTERUI_DATA_DIR;
  process.env.BETTERUI_DATA_DIR = "/dev/null/PRIVATE-PATH";
  try {
    await assert.rejects(saveCreationDraft(session, scope, draft), error => error instanceof Error && /could not be saved/.test(error.message) && !error.message.includes("PRIVATE-PATH"));
    await assert.rejects(readCreationDraft(session, scope), error => error instanceof Error && /could not be loaded/.test(error.message) && !error.message.includes("PRIVATE-PATH"));
  } finally { process.env.BETTERUI_DATA_DIR = previous; }
});

test("draft origin checks accept the public proxy origin and reject foreign origins", () => {
  assert.equal(isSameOriginManagementRequest(new Request("http://localhost/api", { headers: { host: "betterui.example.com", "x-forwarded-proto": "https", origin: "https://betterui.example.com" } })), true);
  assert.equal(isSameOriginManagementRequest(new Request("http://localhost/api", { headers: { host: "betterui.example.com", "x-forwarded-proto": "https", origin: "https://foreign.example.com" } })), false);
});

test("authenticated draft routes persist and delete valid choices without making cloud requests", async t => {
  const { GET, PUT, DELETE } = await import("@/app/api/cloud/management/[service]/draft/route");
  const original = managementAdapters.aom;
  managementAdapters.aom = { ...original, operations: [operation] };
  const cloud = t.mock.method(globalThis, "fetch", async () => { throw new Error("Drafts must not call cloud APIs."); });
  const context = { params: Promise.resolve({ service: "aom" }) };
  const url = `http://localhost/api/cloud/management/aom/draft?projectId=${project.projectId}&operation=create`;
  const cookie = createSession(session);
  try {
    assert.equal((await GET(new Request(url), context)).status, 401);
    const put = await withSessionCookie(cookie, () => PUT(new Request(url, { method: "PUT", body: JSON.stringify(draft) }), context));
    assert.equal(put.status, 200);
    const read = await withSessionCookie(cookie, () => GET(new Request(url), context));
    assert.deepEqual((await read.json()).draft.values, draft);
    const forbidden = await withSessionCookie(cookie, () => PUT(new Request(url, { method: "PUT", headers: { origin: "https://foreign.invalid" }, body: JSON.stringify(draft) }), context));
    assert.equal(forbidden.status, 403);
    const privateField = await withSessionCookie(cookie, () => PUT(new Request(url, { method: "PUT", body: JSON.stringify({ secret: "PRIVATE-PASSWORD" }) }), context));
    assert.equal(privateField.status, 400);
    assert.ok(!(await privateField.text()).includes("PRIVATE-PASSWORD"));
    assert.equal((await withSessionCookie(cookie, () => GET(new Request(url.replace(project.projectId, "foreign")), context))).status, 403);
    assert.equal((await withSessionCookie(cookie, () => GET(new Request(url.replace("operation=create", "operation=delete")), context))).status, 400);
    assert.equal((await withSessionCookie(cookie, () => DELETE(new Request(url, { method: "DELETE" }), context))).status, 200);
    assert.equal((await (await withSessionCookie(cookie, () => GET(new Request(url), context))).json()).draft, null);
    assert.equal(cloud.mock.callCount(), 0);
  } finally { deleteSession(cookie); managementAdapters.aom = original; }
});

test("accepted creation clears its draft; failed creation retains its draft", async () => {
  const identity = { ...session, userId: `accepted-draft-${randomUUID()}` };
  const original = managementAdapters.aom;
  managementAdapters.aom = { ...original, operations: [operation], options: async () => ({ offerings: [{ value: draft.offering, label: "Live" }], children: [{ value: draft.children[0], label: "Live" }] }), inventory: async () => [], execute: async () => ({ message: "Accepted", resourceId: "created-resource", asynchronous: true }) };
  try {
    await saveCreationDraft(identity, scope, draft);
    const outcome = await runManagementOperation(identity, "aom", { requestId: randomUUID(), operation: "create", projectId: session.projectId, values: draft });
    assert.equal(outcome.ok, true);
    assert.equal(await readCreationDraft(identity, scope), null);
    managementAdapters.aom = { ...managementAdapters.aom, execute: async () => { throw new Error("Creation failed."); } };
    await saveCreationDraft(identity, scope, draft);
    await assert.rejects(runManagementOperation(identity, "aom", { requestId: randomUUID(), operation: "create", projectId: session.projectId, values: draft }));
    assert.deepEqual((await readCreationDraft(identity, scope))!.values, draft);
    // The normal live context still owns choices; drafts cannot bypass them.
    assert.equal((await getManagementContext(identity, "aom", session.projectId, "create")).choices.offerings[0].value, draft.offering);
  } finally { managementAdapters.aom = original; }
});
