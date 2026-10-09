import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createSession, deleteSession } from "@/lib/auth-session";
import { listManagementHistory, readManagementHistory } from "@/lib/huawei/management/history";
import { recordAcceptedOperation } from "@/lib/huawei/management/accepted-operation";
import { withSessionCookie } from "./fixtures/request-context.mjs";
import { session, project } from "./fixtures/session";

const folder = mkdtempSync(path.join(os.tmpdir(), "betterui-legacy-evs-"));
process.env.BETTERUI_DATA_DIR = folder;
after(() => rm(folder, { recursive: true, force: true }));
const second = { ...project, projectId: "legacy-project", projectName: "Legacy project", token: "legacy-token" };
const account = { ...session, projects: [project, second] };
const disk = { id: "legacy-disk", name: "Legacy disk", size: 100, status: "available", availability_zone: "az-1", volume_type: "SSD", attachments: [], bootable: "false" };
const snapshot = { id: "legacy-snapshot", name: "Legacy snapshot", volume_id: disk.id, size: 100, status: "available" };
const params = { params: Promise.resolve({ id: disk.id }) };

function request(url: string, method: string, body: unknown) {
  return new Request(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

for (const [action, operation, values] of [
  ["update", "Edit disk", { name: "Edited", description: "PRIVATE-DESCRIPTION" }],
  ["extend", "Expand disk", { newSizeGb: 200 }],
  ["attach", "Attach disk", { serverId: "legacy-server", device: "/dev/sdb" }],
  ["detach", "Detach data disk", { serverId: "legacy-server", force: false }],
] as const) test(`legacy EVS ${action} persists its original project/resource and native job`, async t => {
  const { POST } = await import("@/app/api/cloud/evs/disks/[id]/action/route");
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith("cloudvolumes/detail")) return Response.json({ cloudvolumes: url.pathname.includes(second.projectId) ? [disk] : [] });
    writes++;
    assert.ok(url.pathname.includes(second.projectId));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), second.token);
    return Response.json(action === "update" ? {} : { job_id: "legacy-job" });
  });
  const cookie = createSession(account);
  try {
    const response = await withSessionCookie(cookie, () => POST(request(`/api/cloud/evs/disks/${disk.id}/action`, "POST", { action, ...values }), params));
    assert.equal(response.status, 200);
    const outcome = await response.json();
    assert.equal(writes, 1);
    const entry = await readManagementHistory(account, outcome.operationId);
    assert.equal(entry!.service, "evs");
    assert.equal(entry!.projectId, second.projectId);
    assert.equal(entry!.resourceId, disk.id);
    assert.equal(entry!.operation, operation);
    assert.equal(entry!.state, "submitted");
    assert.equal(entry!.finishedAt, undefined);
    assert.equal(entry!.jobId, action === "update" ? undefined : "legacy-job");
    assert.ok(!JSON.stringify(entry).includes("PRIVATE-DESCRIPTION"));
    assert.deepEqual(await listManagementHistory({ ...account, userId: "different-legacy-user" }), []);
  } finally { deleteSession(cookie); }
});

test("legacy disk create/delete and snapshot create/delete/rollback persist receipts", async t => {
  const diskCreate = await import("@/app/api/cloud/evs/disks/route");
  const diskDelete = await import("@/app/api/cloud/evs/disks/[id]/route");
  const snapshots = await import("@/app/api/cloud/evs/snapshots/route");
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("cloudvolumes/detail")) return Response.json({ cloudvolumes: url.pathname.includes(second.projectId) ? [disk] : [] });
    if (url.pathname.endsWith("cloudsnapshots/detail")) return Response.json({ cloudsnapshots: url.pathname.includes(second.projectId) ? [snapshot] : [] });
    writes++;
    assert.ok(url.pathname.includes(second.projectId));
    if (url.pathname.endsWith("cloudsnapshots")) return Response.json({ snapshot: { id: "new-legacy-snapshot" } });
    return Response.json({ job_id: "legacy-job", volume_ids: ["new-legacy-disk"] });
  });
  const cookie = createSession(account);
  try {
    const calls = [
      () => diskCreate.POST(request("/api/cloud/evs/disks", "POST", { availabilityZone: "az-1", name: "Created disk", projectId: second.projectId, sizeGb: 100, volumeType: "SSD", description: "PRIVATE-DESCRIPTION" })),
      () => diskDelete.DELETE(request(`/api/cloud/evs/disks/${disk.id}`, "DELETE", { confirmName: disk.name }), params),
      () => snapshots.POST(request("/api/cloud/evs/snapshots", "POST", { diskId: disk.id, name: "New snapshot", description: "PRIVATE-DESCRIPTION" })),
      () => snapshots.DELETE(request("/api/cloud/evs/snapshots", "DELETE", { snapshotId: snapshot.id, projectId: second.projectId })),
      () => snapshots.POST(request("/api/cloud/evs/snapshots", "POST", { action: "rollback", diskId: disk.id, snapshotId: snapshot.id })),
    ];
    const expected = ["Create disk", "Delete disk", "Create snapshot", "Delete snapshot", "Rollback snapshot"];
    for (const [index, call] of calls.entries()) {
      const response = await withSessionCookie(cookie, call);
      assert.equal(response.status, 200, await response.clone().text());
      const outcome = await response.json();
      const entry = await readManagementHistory(account, outcome.operationId);
      assert.equal(entry!.projectId, second.projectId);
      assert.equal(entry!.operation, expected[index]);
      assert.equal(entry!.state, "submitted");
      assert.equal(entry!.finishedAt, undefined);
      assert.equal(entry!.resourceId, index === 0 ? "new-legacy-disk" : disk.id);
      assert.ok(!JSON.stringify(entry).includes("PRIVATE-DESCRIPTION"));
      if (index === 2) { assert.equal(entry!.resultResourceId, "new-legacy-snapshot"); assert.equal(entry!.jobId, undefined); }
    }
    assert.equal(writes, 5);
    const before = (await listManagementHistory(account)).length;
    assert.equal((await withSessionCookie(cookie, () => snapshots.DELETE(request("/api/cloud/evs/snapshots", "DELETE", { snapshotId: snapshot.id, projectId: project.projectId })))).status, 400);
    assert.equal((await listManagementHistory(account)).length, before);
    assert.equal(writes, 5);
  } finally { deleteSession(cookie); }
});

test("accepted legacy writes remain accepted when cache maintenance fails", async () => {
  const outcome = await recordAcceptedOperation(account, { service: "evs", operation: "Expand disk", projectId: second.projectId, resourceId: disk.id, jobId: "legacy-job" }, () => { throw new Error("PRIVATE-CACHE-DIAGNOSTIC"); });
  assert.ok(outcome.operationId);
  assert.match(outcome.maintenanceWarning!, /accepted.*do not resubmit/);
  assert.ok(!JSON.stringify(outcome).includes("PRIVATE-CACHE-DIAGNOSTIC"));
  assert.equal((await readManagementHistory(account, outcome.operationId!))!.state, "submitted");
});

test("accepted legacy writes remain accepted when history storage fails", async () => {
  const previous = process.env.BETTERUI_DATA_DIR;
  process.env.BETTERUI_DATA_DIR = "/dev/null/cannot-write-operations";
  try {
    const outcome = await recordAcceptedOperation(account, { service: "evs", operation: "Expand disk", projectId: second.projectId, resourceId: disk.id }, async () => undefined);
    assert.equal(outcome.operationId, undefined);
    assert.match(outcome.maintenanceWarning!, /accepted.*do not resubmit/);
    assert.ok(!JSON.stringify(outcome).includes("/dev/null"));
  } finally { process.env.BETTERUI_DATA_DIR = previous; }
});

test("legacy history files contain only receipts, never request configuration", async () => {
  for (const scope of await readdir(path.join(folder, "operations"))) {
    for (const filename of await readdir(path.join(folder, "operations", scope))) {
      if (!filename.endsWith(".json")) continue;
      const text = await readFile(path.join(folder, "operations", scope, filename), "utf8");
      assert.ok(!text.includes("PRIVATE-DESCRIPTION"));
      assert.ok(!text.includes("legacy-token"));
      assert.ok(!text.includes('"values"'));
    }
  }
});

for (const service of ["rds", "gaussdb", "taurusdb", "dds"] as const) test(`legacy ${service} lifecycle jobs appear in operation history under the selected project`, async t => {
  const route = service === "rds" ? await import("@/app/api/cloud/rds/[id]/action/route")
    : service === "gaussdb" ? await import("@/app/api/cloud/gaussdb/[id]/action/route")
    : service === "taurusdb" ? await import("@/app/api/cloud/taurusdb/[id]/action/route")
    : await import("@/app/api/cloud/dds/[id]/action/route");
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.ok(url.pathname.includes(second.projectId));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), second.token);
    writes++;
    return Response.json({ job_id: "native-database-job" });
  });
  const cookie = createSession(account);
  try {
    const response = await withSessionCookie(cookie, () => route.POST(request(`/api/cloud/${service}/${disk.id}/action`, "POST", { action: service === "dds" ? "restart" : "reboot", projectId: second.projectId }), params));
    assert.equal(response.status, 200);
    const outcome = await response.json();
    const entry = await readManagementHistory(account, outcome.operationId);
    assert.equal(entry!.service, service);
    assert.equal(entry!.projectId, second.projectId);
    assert.equal(entry!.resourceId, disk.id);
    assert.equal(entry!.jobId, "native-database-job");
    assert.equal(entry!.state, "submitted");
    assert.equal(entry!.finishedAt, undefined);
    assert.equal(writes, 1);
    const rejected = await withSessionCookie(cookie, () => route.POST(request(`/api/cloud/${service}/${disk.id}/action`, "POST", { action: service === "dds" ? "restart" : "reboot", projectId: "foreign" }), params));
    assert.ok(rejected.status >= 400);
    assert.equal(writes, 1);
  } finally { deleteSession(cookie); }
});

for (const service of ["ecs", "geminidb"] as const) test(`legacy ${service} receipts use the resource's fresh native project rather than the default`, async t => {
  const route = service === "ecs" ? await import("@/app/api/cloud/ecs/[id]/action/route") : await import("@/app/api/cloud/geminidb/[id]/action/route");
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) {
      writes++;
      assert.ok(url.pathname.includes(second.projectId));
      assert.equal(new Headers(init.headers).get("X-Auth-Token"), second.token);
      return Response.json({ job_id: "native-lifecycle-job" });
    }
    const owns = url.pathname.includes(second.projectId);
    if (url.pathname.endsWith("cloudvolumes/detail")) return Response.json({ cloudvolumes: [] });
    if (service === "ecs" && url.pathname.includes("servers/detail")) return Response.json({ servers: owns ? [{ id: disk.id, name: "Native server", status: "SHUTOFF", flavor: { id: "flavor-1" }, addresses: {} }] : [] });
    if (service === "geminidb" && url.pathname.endsWith("/instances")) return Response.json({ instances: owns ? [{ id: disk.id, name: "Native database", status: "normal", datastore: { type: "Cassandra" } }] : [] });
    return Response.json({});
  });
  const cookie = createSession(account);
  try {
    const response = await withSessionCookie(cookie, () => route.POST(request(`/api/cloud/${service}/${disk.id}/action`, "POST", { action: service === "ecs" ? "start" : "restart", projectId: second.projectId }), params));
    assert.equal(response.status, 200, await response.clone().text());
    const entry = await readManagementHistory(account, (await response.json()).operationId);
    assert.equal(entry!.projectId, second.projectId);
    assert.equal(entry!.resourceId, disk.id);
    assert.equal(entry!.jobId, "native-lifecycle-job");
    assert.equal(entry!.state, "submitted");
    assert.equal(writes, 1);
    const rejected = await withSessionCookie(cookie, () => route.POST(request(`/api/cloud/${service}/${disk.id}/action`, "POST", { action: service === "ecs" ? "start" : "restart", projectId: project.projectId }), params));
    assert.equal(rejected.status, 400);
    assert.equal(writes, 1);
  } finally { deleteSession(cookie); }
});

test("legacy EVS backup history retains the source disk and native checkpoint without inventing a job", async t => {
  const { POST } = await import("@/app/api/cloud/evs/disks/[id]/backup/route");
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const owns = url.pathname.includes(second.projectId);
    if (url.pathname.endsWith("cloudvolumes/detail")) return Response.json({ cloudvolumes: owns ? [disk] : [] });
    if (url.pathname.endsWith("/backups")) return Response.json({ backups: [] });
    if (url.pathname.endsWith("/vaults")) return Response.json({ vaults: owns ? [{ id: "native-vault", name: "Native vault", resources: [{ id: disk.id, type: "OS::Cinder::Volume", protect_status: "available" }], billing: { size: 200 } }] : [] });
    if (init.method === "POST") { writes++; assert.ok(owns); return Response.json({ checkpoint: { id: "native-checkpoint", status: "protecting" } }); }
    return Response.json({});
  });
  const cookie = createSession(account);
  try {
    const response = await withSessionCookie(cookie, () => POST(request(`/api/cloud/evs/disks/${disk.id}/backup`, "POST", { name: "NativeBackup", description: "PRIVATE-DESCRIPTION", projectId: second.projectId, vaultId: "native-vault" }), params));
    assert.equal(response.status, 200, await response.clone().text());
    const entry = await readManagementHistory(account, (await response.json()).operationId);
    assert.equal(entry!.projectId, second.projectId);
    assert.equal(entry!.resourceId, disk.id);
    assert.equal(entry!.resultResourceId, "native-checkpoint");
    assert.equal(entry!.jobId, undefined);
    assert.equal(entry!.state, "submitted");
    assert.ok(!JSON.stringify(entry).includes("PRIVATE-DESCRIPTION"));
    assert.equal(writes, 1);
  } finally { deleteSession(cookie); }
});
