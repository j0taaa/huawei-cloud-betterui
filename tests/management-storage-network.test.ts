import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManagementOperation, getManagementContext } from "@/lib/huawei/management";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-storage-network-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const body = (operation: string, values = {}, resourceId = "resource-1", name = "Resource") => ({ requestId: randomUUID(), operation, resourceId, projectId: session.projectId, confirmName: name, acknowledgedImpact: true, values });
const vault = { id: "vault-1", name: "Resource", status: "available", resources: [{ id: "server-1", name: "Server", type: "OS::Nova::Server" }], billing: { size: 100, object_type: "server", charging_mode: "post_paid" } };
function backupRead(url: URL) {
  if (url.pathname.endsWith("vaults")) return { vaults: [vault], count: 1 };
  if (url.pathname.endsWith("backups")) return { backups: [{ id: "backup-1", name: "Backup", vault_id: "vault-1", resource_id: "server-1", status: "available" }], count: 1 };
  if (url.pathname.endsWith("policies")) return { policies: [], count: 0 };
  throw Error(`Unexpected backup read ${url}`);
}
test("CBR creates explicit pay-per-use crash-consistent empty vaults", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { assert.equal(new URL(input).pathname, "/v3/project-1/vaults"); sent = JSON.parse(String(init.body)); return Response.json({ vault: { id: "new-vault" } }); });
  const result = await runManagementOperation(session, "cbr", body("create-vault", { name: "Backup", size: 100, type: "server" }));
  assert.equal(result.resourceId, "new-vault");
  assert.deepEqual(sent, { vault: { name: "Backup", billing: { cloud_type: "public", consistent_level: "crash_consistent", object_type: "server", protect_type: "backup", size: 100, charging_mode: "post_paid" }, resources: [], enterprise_project_id: "0", auto_bind: false, auto_expand: false } });
});
test("CBR refuses nonempty vault deletion and foreign backup IDs", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(backupRead(new URL(input))); writes++; return Response.json({}); });
  await assert.rejects(runManagementOperation(session, "cbr", body("delete-vault", {}, "vault:vault-1")), /Delete backups and detach/);
  await assert.rejects(runManagementOperation(session, "cbr", body("delete-backup", { backup: "foreign" }, "vault:vault-1")), /not available/);
  assert.equal(writes, 0);
});
test("CBR schedule update omits create-only operation_type and preserves UTC schedule syntax", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method && url.pathname.endsWith("policies")) return Response.json({ policies: [{ id: "policy-1", name: "Resource", operation_type: "backup", enabled: true }] });
    if (!init.method) return Response.json(backupRead(url));
    sent = JSON.parse(String(init.body)); return Response.json({ policy: { id: "policy-1" } });
  });
  await runManagementOperation(session, "cbr", body("update-policy", { name: "Daily", hour: 14, retention: 30, enabled: true }, "policy:policy-1"));
  assert.deepEqual(sent, { policy: { name: "Daily", enabled: true, operation_definition: { retention_duration_days: 30 }, trigger: { properties: { pattern: ["FREQ=DAILY;INTERVAL=1;BYHOUR=14;BYMINUTE=00"] } } } });
});
test("SWR handles nested repository paths and returns every paginated tag", async (t) => {
  const encoded = Buffer.from(JSON.stringify([session.region, "prod", "team/api"])).toString("base64url");
  let deleted = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) { deleted = url.pathname; return new Response(null, { status: 204 }); }
    if (url.pathname.endsWith("/namespaces")) return Response.json({ namespaces: [{ name: "prod" }] });
    if (url.pathname.endsWith("/repos")) return Response.json({ repos: [{ name: "team/api", namespace_name: "prod", category: "other" }] });
    if (url.pathname.endsWith("/tags")) { assert.match(url.pathname, /team%24api/); const second = url.searchParams.has("marker"); return Response.json({ tags: [{ tag: second ? "second" : "first", digest: "sha256:test" }], ...(second ? { has_more: false } : { nextMarker: "page-2", has_more: true }) }); }
    throw Error(`Unexpected registry read ${url}`);
  });
  const context = await getManagementContext(session, "swr", session.projectId, "delete-tag", `repository:${encoded}`);
  assert.deepEqual(context.choices.tags.map((choice) => choice.value), ["first", "second"]);
  await runManagementOperation(session, "swr", body("delete-tag", { tag: "second" }, `repository:${encoded}`, "prod/team/api"));
  assert.equal(deleted, "/v2/manage/namespaces/prod/repos/team%24api/tags/second");
});
test("SWR refuses organization deletion while repositories remain", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (init.method) { writes++; return Response.json({}); } return Response.json(new URL(input).pathname.endsWith("namespaces") ? { namespaces: [{ name: "prod" }] } : { repos: [{ name: "api", namespace_name: "prod" }] }); });
  await assert.rejects(runManagementOperation(session, "swr", body("delete-namespace", {}, "namespace:prod", "prod")), /repositories before deleting/);
  assert.equal(writes, 0);
});
test("SFS expansion never shrinks storage and uses native Manila action", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json({ shares: [{ id: "share-1", name: "Resource", size: 100, status: "available" }] }); assert.equal(new URL(input).pathname, "/v2/project-1/shares/share-1/action"); assert.equal(new Headers(init.headers).get("X-Openstack-Manila-Api-Version"), "2.9"); sent = JSON.parse(String(init.body)); return new Response(null, { status: 202 }); });
  await assert.rejects(runManagementOperation(session, "sfs", body("expand", { size: 99 }, "share-1")), /exceed/); assert.equal(sent, undefined);
  await runManagementOperation(session, "sfs", body("expand", { size: 200 }, "share-1")); assert.deepEqual(sent, { "os-extend": { new_size: 200 } });
});
test("EIP alias changes do not mix port changes into the native update body", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => { if (!init.method) return Response.json({ publicips: [{ id: "ip-1", alias: "Resource", port_id: "port-bound", status: "ACTIVE" }] }); sent = JSON.parse(String(init.body)); return Response.json({}); });
  await runManagementOperation(session, "eip", body("rename", { name: "Renamed" }, "ip-1")); assert.deepEqual(sent, { publicip: { alias: "Renamed" } });
  sent = undefined; await assert.rejects(runManagementOperation(session, "eip", body("delete", {}, "ip-1")), /Unbind/); assert.equal(sent, undefined);
});
test("EIP bandwidth changes cannot alter shared bandwidth", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (init.method) { writes++; return Response.json({}); } return Response.json(new URL(input).pathname.includes("bandwidths") ? { bandwidth: { id: "bandwidth-1", share_type: "WHOLE" } } : { publicips: [{ id: "ip-1", alias: "Resource", bandwidth: { id: "bandwidth-1", size: 5 } }] }); });
  await assert.rejects(runManagementOperation(session, "eip", body("bandwidth", { size: 100, charge: "traffic" }, "ip-1")), /shared bandwidth/); assert.equal(writes, 0);
});
function lbRead(url: URL) {
  const id = "lb-1";
  if (url.pathname.endsWith("loadbalancers")) return { loadbalancers: [{ id, name: "Resource", provisioning_status: "ACTIVE" }] };
  if (url.pathname.endsWith("/listeners")) return { listeners: [{ id: "listener-1", name: "Listener", protocol: "HTTP", loadbalancers: [{ id }] }] };
  if (url.pathname.endsWith("/pools")) return { pools: [{ id: "pool-1", name: "Pool", protocol: "HTTP", loadbalancers: [{ id }] }, { id: "pool-other", name: "Other", protocol: "HTTP", loadbalancers: [{ id: "other" }] }] };
  if (url.pathname.endsWith("/members")) return { members: [{ id: "member-1", name: "Member", address: "192.168.1.10", protocol_port: 80 }] };
  if (url.pathname.endsWith("/healthmonitors")) return { healthmonitors: [] };
  throw Error(`Unexpected LB read ${url}`);
}
test("ELB child selectors filter foreign pools and decode nested member collection correctly", async (t) => {
  const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(lbRead(new URL(input))); writes.push(JSON.parse(String(init.body))); return Response.json({}); });
  const context = await getManagementContext(session, "elb", session.projectId, "update-member", "lb-1");
  assert.deepEqual(context.choices.pools.map((choice) => choice.value), ["pool-1"]);
  assert.deepEqual(context.choices.members.map((choice) => choice.value), ["member-1"]);
  await assert.rejects(runManagementOperation(session, "elb", body("update-member", { pool: "pool-other", member: "member-1", weight: 10 }, "lb-1")), /not available/);
  await assert.rejects(runManagementOperation(session, "elb", body("update-member", { pool: "pool-1", member: "foreign", weight: 10 }, "lb-1")), /not available/);
  await runManagementOperation(session, "elb", body("update-member", { pool: "pool-1", member: "member-1", weight: 10 }, "lb-1"));
  assert.deepEqual(writes, [{ member: { weight: 10 } }]);
});
test("ELB rejects incompatible listener/pool assignments and unsafe health check timing", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return Response.json({}); }
    const result = lbRead(new URL(input));
    if (result.listeners) result.listeners[0].protocol = "UDP";
    return Response.json(result);
  });
  await assert.rejects(runManagementOperation(session, "elb", body("assign-pool", { listener: "listener-1", pool: "pool-1" }, "lb-1")), /incompatible/);
  await assert.rejects(runManagementOperation(session, "elb", body("create-health", { pool: "pool-1", type: "HTTP", interval: 5, timeout: 10, retries: 3, path: "/" }, "lb-1")), /timeout cannot exceed/);
  assert.equal(writes, 0);
});
