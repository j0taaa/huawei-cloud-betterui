import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManagementOperation, getManagementContext } from "@/lib/huawei/management";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-iam-")); process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const account = { ...session, accountToken: "account-token" };
const body = (operation: string, values = {}, resourceId = "user:user-2", confirmName = "Operator") => ({ requestId: randomUUID(), operation, resourceId, confirmName, acknowledgedImpact: true, values });
const users = [{ id: session.userId, name: session.username, domain_id: "domain-1", enabled: true }, { id: "user-2", name: "Operator", domain_id: "domain-1", enabled: true }, { id: "foreign", name: "Foreign", domain_id: "other-domain", enabled: true }];
function read(url: URL) {
  if (url.pathname.endsWith("auth/tokens")) return { token: { domain: { id: "domain-1" }, user: { id: session.userId, domain: { id: "domain-1" } } } };
  if (url.pathname === "/v3/users") return { users, links: { next: null } };
  if (url.pathname === "/v3/groups") return { groups: [{ id: "group-1", name: "Team", domain_id: "domain-1" }, { id: "admin", name: "admin", domain_id: "domain-1" }], links: { next: null } };
  if (url.pathname === "/v3/groups/group-1/users") return { users: [users[0]], links: { next: null } };
  throw Error(`Unexpected IAM read ${url}`);
}
test("IAM creation uses the account token and verified domain, requiring a password change", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), "account-token"); const url = new URL(input);
    if (init.method === "GET") { if (url.pathname.endsWith("auth/tokens")) assert.equal(new Headers(init.headers).get("X-Subject-Token"), "account-token"); return Response.json(read(url)); }
    assert.equal(url.pathname, "/v3.0/OS-USER/users"); sent = JSON.parse(String(init.body)); return Response.json({ user: { id: "created" } });
  });
  const result = await runManagementOperation(account, "iam", body("create-user", { name: "Operator", password: "Newpass123", access: "console", description: "" }));
  assert.equal(result.resourceId, "user:created");
  assert.deepEqual(sent, { user: { name: "Operator", password: "Newpass123", access_mode: "console", description: "", domain_id: "domain-1", enabled: true, pwd_status: true } });
});
test("IAM filters foreign domains and protects the current signed-in identity", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (init.method === "GET") return Response.json(read(new URL(input))); writes++; return Response.json({}); });
  const context = await getManagementContext(account, "iam");
  assert.equal(context.resources.some(r => r.id === "user:foreign"), false);
  await assert.rejects(runManagementOperation(account, "iam", body("delete-user", {}, "user:user-1", session.username)), /protected/);
  await assert.rejects(runManagementOperation(account, "iam", body("disable-user", {}, "user:foreign", "Foreign")), /not found/);
  await assert.rejects(runManagementOperation(account, "iam", body("delete-group", {}, "group:admin", "admin")), /admin group/);
  assert.equal(writes, 0);
});
test("IAM membership selectors exclude existing members and prevent removing the current identity", async (t) => {
  let write: { path: string; method?: string } | undefined;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (init.method === "GET") return Response.json(read(new URL(input))); write = { path: new URL(input).pathname, method: init.method }; return new Response(null, { status: 204 }); });
  const context = await getManagementContext(account, "iam", undefined, "add-member", "group:group-1");
  assert.deepEqual(context.choices.users.map(u => u.value), ["user-2"]);
  await assert.rejects(runManagementOperation(account, "iam", body("remove-member", { user: session.userId }, "group:group-1", "Team")), /not available/);
  await runManagementOperation(account, "iam", body("add-member", { user: "user-2" }, "group:group-1", "Team"));
  assert.deepEqual(write, { path: "/v3/groups/group-1/users/user-2", method: "PUT" });
});
test("IAM rejects mismatched account-token domains and external pagination destinations", async (t) => {
  let external = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input); const response = read(url);
    if (url.pathname.endsWith("auth/tokens") && !external) return Response.json({ token: { domain: { id: "domain-1" }, user: { id: "another-user", domain: { id: "domain-1" } } } });
    if (url.pathname === "/v3/users") return Response.json({ users, links: { next: "https://evil.invalid/v3/users" } });
    return Response.json(response);
  });
  await assert.rejects(getManagementContext(account, "iam"), /verify this account/);
  external = true;
  await assert.rejects(getManagementContext(account, "iam"), /unexpected pagination destination/);
});
test("IAM refuses deleting groups with members and redacts rejected passwords in history", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method === "GET") return Response.json(read(new URL(input)));
    return Response.json({ error: { message: "Password Newpass123 rejected by policy" } }, { status: 400 });
  });
  await assert.rejects(runManagementOperation(account, "iam", body("delete-group", {}, "group:group-1", "Team")), /every member/);
  await assert.rejects(runManagementOperation(account, "iam", body("create-user", { name: "Operator", password: "Newpass123", access: "console" })), /Password \[redacted\] rejected/);
  const context = await getManagementContext(account, "iam");
  assert.equal(JSON.stringify(context.history).includes("Newpass123"), false);
});
