import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManagementOperation } from "@/lib/huawei/management";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-deh-")); process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const body = (operation: string, values = {}) => ({ requestId: randomUUID(), operation, resourceId: "host-1", projectId: session.projectId, confirmName: "Host", acknowledgedImpact: true, values });
function read(url: URL, total = 0) {
  if (url.pathname.endsWith("os-availability-zone")) return { availabilityZoneInfo: [{ zoneName: "az-1", zoneState: { available: true } }] };
  if (url.pathname.endsWith("dedicated-host-types")) return { dedicated_host_types: [{ host_type: "c6", host_type_name: "General purpose" }] };
  if (url.pathname.endsWith("dedicated-hosts")) return { dedicated_hosts: [{ dedicated_host_id: "host-1", name: "Host", state: "available" }] };
  if (url.pathname.endsWith("dedicated-hosts/host-1")) return { dedicated_host: { dedicated_host_id: "host-1", project_id: session.projectId, instance_total: total, instance_uuids: [] } };
  if (url.pathname.endsWith("servers")) return { servers: [] };
  throw Error(`Unexpected DeH read ${url}`);
}
test("DeH orders an offered monthly host with auto-payment and renewal disabled", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({ order_id: "order-1", job_id: "job-1" }); });
  const result = await runManagementOperation(session, "deh", body("create", { name: "Host", offering: JSON.stringify(["az-1", "c6"]), months: 1, placement: false }));
  assert.deepEqual(sent, { name: "Host", availability_zone: "az-1", host_type: "c6", quantity: 1, auto_placement: "off", extend_param: { charging_mode: "prePaid", period_type: "month", period_num: 1, is_auto_pay: false, is_auto_renew: false, enterprise_project_id: "0" } });
  assert.equal(result.jobId, "job-1"); assert.equal(result.facts?.[0].value, "order-1");
});
test("DeH refuses foreign offerings and release while the native host has servers", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input), 1)); writes++; return Response.json({}); });
  await assert.rejects(runManagementOperation(session, "deh", body("create", { name: "Host", offering: JSON.stringify(["other-zone", "c6"]), months: 1 })), /not available/);
  await assert.rejects(runManagementOperation(session, "deh", body("delete")), /every hosted ECS/);
  assert.equal(writes, 0);
});
test("DeH name edits preserve placement and empty-host release uses native DELETE", async (t) => {
  const writes: { method?: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); assert.equal(new URL(input).pathname, "/v1.0/project-1/dedicated-hosts/host-1"); writes.push({ method: init.method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) }); return new Response(null, { status: 204 }); });
  await runManagementOperation(session, "deh", body("rename", { name: "NewHost" }));
  await runManagementOperation(session, "deh", body("delete"));
  assert.deepEqual(writes, [{ method: "PUT", body: { dedicated_host: { name: "NewHost" } } }, { method: "DELETE" }]);
});
