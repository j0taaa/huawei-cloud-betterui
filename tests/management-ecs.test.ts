import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { after, test } from "node:test";
import { runManagementOperation } from "@/lib/huawei/management";
import { runEcsAction } from "@/lib/huawei/services/ecs";
import { runRdsAction } from "@/lib/huawei/services/rds";
import { runGaussDbAction } from "@/lib/huawei/services/gaussdb";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-ecs-management-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
function read(url: URL) {
  if (url.pathname.endsWith("/cloudimages")) return { images: [{ id: "image-1", name: "Linux", __os_type: "Linux", status: "active", min_disk: 60, min_ram: 2048 }] };
  if (/\/(flavors|resize_flavors)$/.test(url.pathname)) return { flavors: [{ id: "flavor-1", name: "c6.large.2", vcpus: 2, ram: 4096 }] };
  if (url.pathname.endsWith("/subnets")) return { subnets: [{ id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet" }] };
  if (url.pathname.endsWith("security-groups")) return { security_groups: [{ id: "sg-1", name: "Security" }] };
  if (url.pathname.endsWith("os-availability-zone")) return { availabilityZoneInfo: [{ zoneName: "az-1", zoneState: { available: true } }] };
  if (url.pathname.endsWith("os-keypairs")) return { keypairs: [{ keypair: { name: "existing-key" } }] };
  if (url.pathname.endsWith("/detail")) return { count: 1, servers: [{ id: "server-1", name: "Server", status: "SHUTOFF", charging_mode: 0, flavor: { id: "flavor-1" } }] };
  throw new Error(`Unexpected GET ${url.pathname}`);
}
const createValues = { name: "Example", flavor: "flavor-1", image: "image-1", subnet: "subnet-1", securityGroups: ["sg-1"], zone: "az-1", diskType: "SSD", diskSize: 60, authentication: "key", key: "existing-key" };
const body = (operation: string, values = {}) => ({ requestId: randomUUID(), operation, projectId: session.projectId, resourceId: "server-1", confirmName: "Server", acknowledgedImpact: true, values });

test("ECS provisioning verifies image/flavor requirements and sends documented camel-case payload", async (t) => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (!init.method) return Response.json(read(new URL(input)));
    writes.push({ path: new URL(input).pathname, body: JSON.parse(String(init.body)) }); return Response.json({ job_id: "job-1", serverIds: ["new-server"] });
  });
  await assert.rejects(runManagementOperation(session, "ecs", body("create", { ...createValues, diskSize: 40 })), /larger disk/);
  assert.equal(writes.length, 0);
  const result = await runManagementOperation(session, "ecs", body("create", createValues));
  assert.equal(result.resourceId, "new-server"); assert.equal(result.jobId, "job-1");
  assert.deepEqual(writes, [{ path: "/v1/project-1/cloudservers", body: { server: { name: "Example", description: "", flavorRef: "flavor-1", imageRef: "image-1", availability_zone: "az-1", count: 1, vpcid: "vpc-1", nics: [{ subnet_id: "network-1" }], security_groups: [{ id: "sg-1" }], root_volume: { volumetype: "SSD", size: 60 }, extendparam: { chargingMode: 0, enterprise_project_id: "0" }, key_name: "existing-key" } } }]);
});

test("ECS resize uses instance-compatible choices and numeric pay-per-use billing", async (t) => {
  const calls: URL[] = [];
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { const url = new URL(input); calls.push(url); if (!init.method) return Response.json(read(url)); sent = JSON.parse(String(init.body)); return Response.json({ job_id: "resize-job" }); });
  const result = await runManagementOperation(session, "ecs", body("resize", { flavor: "flavor-1" }));
  assert.equal(result.jobId, "resize-job");
  assert.deepEqual(sent, { resize: { flavorRef: "flavor-1" } });
  assert.ok(calls.some((url) => url.pathname.endsWith("resize_flavors") && url.searchParams.get("instance_uuid") === "server-1"));
});

test("ECS deletion retains attached volumes and IPs unless explicitly selected", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); assert.equal(new URL(input).pathname, "/v1/project-1/cloudservers/delete"); sent = JSON.parse(String(init.body)); return Response.json({ job_id: "delete-job" }); });
  await runManagementOperation(session, "ecs", body("delete"));
  assert.deepEqual(sent, { servers: [{ id: "server-1" }], delete_volume: false, delete_publicip: false });
});

test("legacy ECS/RDS/GaussDB actions never silently target an unknown project's default", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(runEcsAction(session, "server-1", "start", "unknown-project"), /not part/);
  await assert.rejects(runRdsAction(session, "database-1", "reboot", "unknown-project"), /not part/);
  await assert.rejects(runGaussDbAction(session, "database-1", "reboot", "unknown-project"), /not part/);
  assert.equal(fetch.mock.callCount(), 0);
});
