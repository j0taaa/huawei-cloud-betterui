import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManagementOperation } from "@/lib/huawei/management";
import { evsManagement } from "@/lib/huawei/management/adapters/evs";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-evs-")); process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const body = (operation: string, values = {}) => ({ requestId: randomUUID(), operation, resourceId: "disk-1", projectId: session.projectId, confirmName: "Disk", acknowledgedImpact: true, values });
function read(url: URL, status = "available", attachments: unknown[] = []) {
  if (url.pathname.endsWith("cloudvolumes/detail")) return { cloudvolumes: [{ id: "disk-1", name: "Disk", size: 100, status, availability_zone: "az-1", volume_type: "SSD", attachments, bootable: "false" }] };
  if (url.pathname.endsWith("cloudvolumes/disk-1")) return { volume: { id: "disk-1", attachments } };
  if (url.pathname.endsWith("os-availability-zone")) return { availabilityZoneInfo: [{ zoneName: "az-1", zoneState: { available: true } }, { zoneName: "az-2", zoneState: { available: true } }] };
  if (url.pathname.endsWith("types")) return { volume_types: [{ name: "SSD", is_public: true, extra_specs: { "RESKEY:availability_zones": "az-1" } }] };
  if (url.pathname.endsWith("servers/detail")) return { servers: [{ id: "server-1", name: "Server", status: "ACTIVE", "OS-EXT-AZ:availability_zone": "az-1" }, { id: "server-other-zone", name: "Other", status: "ACTIVE", "OS-EXT-AZ:availability_zone": "az-2" }] };
  if (url.pathname.endsWith("cloudsnapshots/detail")) return { cloudsnapshots: [{ id: "snapshot-1", name: "Owned", volume_id: "disk-1", status: "available" }, { id: "snapshot-foreign", volume_id: "other-disk", status: "available" }] };
  throw Error(`Unexpected EVS read ${url}`);
}
test("EVS create uses region offers and rejects unavailable zone/type combinations", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); assert.equal(new URL(input).pathname, "/v2.1/project-1/cloudvolumes"); sent = JSON.parse(String(init.body)); return Response.json({ job_id: "job-1", volume_ids: ["new-disk"] }); });
  const values = { name: "Disk", description: "", size: 100, type: "SSD", zone: "az-2", shared: false };
  await assert.rejects(runManagementOperation(session, "evs", body("create", values)), /not available in the selected/); assert.equal(sent, undefined);
  const result = await runManagementOperation(session, "evs", body("create", { ...values, zone: "az-1" }));
  assert.equal(result.resourceId, "new-disk"); assert.equal(result.jobId, "job-1");
  assert.deepEqual(sent, { bssParam: { chargingMode: "postPaid" }, volume: { availability_zone: "az-1", description: "", multiattach: false, name: "Disk", size: 100, volume_type: "SSD" } });
});
test("EVS attachment selectors enforce current project and availability zone", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({ job_id: "attach-job" }); });
  await assert.rejects(runManagementOperation(session, "evs", body("attach", { server: "server-other-zone", device: "/dev/sdb" })), /not available/); assert.equal(sent, undefined);
  await runManagementOperation(session, "evs", body("attach", { server: "server-1", device: "/dev/sdb" }));
  assert.deepEqual(sent, { dry_run: false, volumeAttachment: { device: "/dev/sdb", volumeId: "disk-1", volume_type: "SSD" } });
});
test("EVS rejects rollback from another disk and refuses attached-disk deletion", async (t) => {
  let attachments: unknown[] = []; let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input), "available", attachments)); writes++; return Response.json({}); });
  await assert.rejects(runManagementOperation(session, "evs", body("rollback", { snapshot: "snapshot-foreign" })), /not available/);
  attachments = [{ server_id: "server-1" }];
  await assert.rejects(runManagementOperation(session, "evs", body("delete")), /Detach every/);
  assert.equal(writes, 0);
});
test("EVS expansion cannot shrink and snapshot rollback uses the verified source disk", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); assert.equal(new URL(input).pathname, "/v2/project-1/cloudsnapshots/snapshot-1/rollback"); sent = JSON.parse(String(init.body)); return Response.json({ job_id: "rollback-job" }); });
  await assert.rejects(runManagementOperation(session, "evs", body("expand", { size: 99 })), /must exceed/); assert.equal(sent, undefined);
  const result = await runManagementOperation(session, "evs", body("rollback", { snapshot: "snapshot-1" }));
  assert.deepEqual(sent, { rollback: { volume_id: "disk-1" } }); assert.equal(result.jobId, "rollback-job");
});
test("EVS job polling uses ECS for attachment jobs and EVS for disk jobs", async (t) => {
  const hosts: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { const url = new URL(input); hosts.push(url.hostname); assert.equal(url.pathname, "/v1/project-1/jobs/job-1"); return Response.json({ status: "SUCCESS", entities: { volume_id: "disk-1" } }); });
  for (const operation of ["Attach disk", "Expand disk"]) {
    const result = await evsManagement.poll!(session, { id: randomUUID(), service: "evs", operation, jobId: "job-1", projectId: session.projectId, state: "submitted", startedAt: new Date().toISOString() });
    assert.equal(result.state, "succeeded"); assert.equal(result.resourceId, "disk-1");
  }
  assert.deepEqual(hosts, ["ecs.sa-brazil-1.myhuaweicloud.com", "evs.sa-brazil-1.myhuaweicloud.com"]);
});
