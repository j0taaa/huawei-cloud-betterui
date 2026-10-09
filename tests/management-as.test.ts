import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManagementOperation, getManagementContext } from "@/lib/huawei/management";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-as-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const body = (operation: string, values = {}, resourceId = "group:group-1") => ({ requestId: randomUUID(), operation, resourceId, projectId: session.projectId, confirmName: "Group", acknowledgedImpact: true, values });
const group = { scaling_group_id: "group-1", scaling_group_name: "Group", scaling_group_status: "INSERVICE", current_instance_number: 2, desire_instance_number: 2, min_instance_number: 1, max_instance_number: 5, scaling_configuration_id: "config-1" };
function fixture(url: URL, overrides: Record<string, unknown> = {}) {
  if (url.pathname.endsWith("scaling_configuration")) return { scaling_configurations: [{ scaling_configuration_id: "config-1", scaling_configuration_name: "Group" }], total_number: 1 };
  if (url.pathname.endsWith("scaling_group")) return { scaling_groups: [{ ...group, ...overrides }], total_number: 1 };
  if (url.pathname.includes("scaling_group_instance")) return { scaling_group_instances: [{ instance_id: "server-1", instance_name: "Server", life_cycle_state: "INSERVICE", health_status: "NORMAL", protect_from_scaling_down: false }], total_number: 1 };
  if (url.pathname.includes("scaling_policy")) return { scaling_policies: [{ scaling_policy_id: "policy-1", scaling_policy_name: "Daily", policy_status: "INSERVICE", scaling_policy_type: "RECURRENCE" }], total_number: 1 };
  if (url.pathname.endsWith("vpcs")) return { vpcs: [{ id: "vpc-1", name: "Vpc" }] };
  if (url.pathname.endsWith("subnets")) return { subnets: [{ id: "subnet-1", name: "Subnet", vpc_id: "vpc-1" }, { id: "subnet-other", name: "Other", vpc_id: "vpc-other" }] };
  throw Error(`Unexpected AS read ${url}`);
}
test("AS creation enforces capacity ordering and subnet ownership before provider writes", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(fixture(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({ scaling_group_id: "new-group" }); });
  const values = { name: "Group", description: "", configuration: "config-1", vpc: "vpc-1", subnet: "subnet-other", minimum: 0, desired: 1, maximum: 3, cooldown: 300 };
  await assert.rejects(runManagementOperation(session, "as", body("create", values)), /selected VPC/);
  await assert.rejects(runManagementOperation(session, "as", body("create", { ...values, subnet: "subnet-1", minimum: 2 })), /Minimum/);
  assert.equal(sent, undefined);
  const result = await runManagementOperation(session, "as", body("create", { ...values, subnet: "subnet-1" }));
  assert.equal(result.resourceId, "group:new-group");
  assert.deepEqual(sent, { scaling_group_name: "Group", description: "", scaling_configuration_id: "config-1", vpc_id: "vpc-1", networks: [{ id: "subnet-1" }], min_instance_number: 0, desire_instance_number: 1, max_instance_number: 3, cool_down_time: 300, health_periodic_audit_method: "NOVA_AUDIT", delete_publicip: false, delete_volume: false });
});
test("AS refuses deleting nonempty groups and configurations still used by a group", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(fixture(new URL(input))); writes++; return Response.json({}); });
  await assert.rejects(runManagementOperation(session, "as", body("delete")), /Detach all instances/);
  await assert.rejects(runManagementOperation(session, "as", body("delete-configuration", {}, "configuration:config-1")), /every scaling group/);
  await assert.rejects(runManagementOperation(session, "as", body("rename-configuration", { name: "Config" })), /correct type/);
  assert.equal(writes, 0);
});
test("AS instance detachment checks current membership and uses no-delete native action", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(fixture(new URL(input))); assert.equal(new URL(input).pathname, "/autoscaling-api/v1/project-1/scaling_group_instance/group-1/action"); sent = JSON.parse(String(init.body)); return new Response(null, { status: 200 }); });
  await assert.rejects(runManagementOperation(session, "as", body("remove-members", { members: ["foreign"] })), /unavailable/);
  const result = await runManagementOperation(session, "as", body("remove-members", { members: ["server-1"] }));
  assert.equal(result.asynchronous, true);
  assert.deepEqual(sent, { action: "REMOVE", instances_id: ["server-1"], instance_delete: "no" });
});
test("AS refuses changes during scaling and detachment below minimum capacity", async (t) => {
  let overrides: Record<string, unknown> = { is_scaling: true }; let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(fixture(new URL(input), overrides)); writes++; return Response.json({}); });
  await assert.rejects(runManagementOperation(session, "as", body("protect", { members: ["server-1"] })), /scaling activity/);
  overrides = { min_instance_number: 2 };
  await assert.rejects(runManagementOperation(session, "as", body("remove-members", { members: ["server-1"] })), /minimum capacity/);
  assert.equal(writes, 0);
});
test("AS policies must belong to the selected group, with native pause/resume/execute actions", async (t) => {
  const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(fixture(new URL(input))); assert.equal(new URL(input).pathname, "/autoscaling-api/v1/project-1/scaling_policy/policy-1/action"); writes.push(JSON.parse(String(init.body))); return Response.json({}); });
  const context = await getManagementContext(session, "as", session.projectId, "execute-policy", "group:group-1");
  assert.deepEqual(context.choices.policies.map(p => p.value), ["policy-1"]);
  await assert.rejects(runManagementOperation(session, "as", body("execute-policy", { policy: "foreign" })), /not available/);
  for (const operation of ["enable", "disable", "execute"]) await runManagementOperation(session, "as", body(`${operation}-policy`, { policy: "policy-1" }));
  assert.deepEqual(writes, [{ action: "resume" }, { action: "pause" }, { action: "execute" }]);
});
test("AS daily schedules validate UTC expiry and scaling action count", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(fixture(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({ scaling_policy_id: "new-policy" }); });
  const values = { name: "Daily", action: "ADD", count: 1, cooldown: 300, time: "16:00", end: "2099-02-28T16:00Z" };
  await assert.rejects(runManagementOperation(session, "as", body("create-daily-policy", { ...values, end: "2099-02-30T16:00Z" })), /valid future/);
  await assert.rejects(runManagementOperation(session, "as", body("create-daily-policy", { ...values, count: 0 })), /at least one/);
  assert.equal(sent, undefined);
  await runManagementOperation(session, "as", body("create-daily-policy", values));
  assert.deepEqual(sent, { scaling_policy_name: "Daily", scaling_policy_action: { operation: "ADD", instance_number: 1 }, cool_down_time: 300, scaling_group_id: "group-1", scaling_policy_type: "RECURRENCE", scheduled_policy: { launch_time: "16:00", recurrence_type: "Daily", end_time: "2099-02-28T16:00Z" } });
});
test("AS launch configurations copy an owned ECS without caching its credentials", async (t) => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input); if (!init.method && url.pathname.endsWith("os-keypairs")) return Response.json({ keypairs: [{ keypair: { name: "key-1" } }] });
    if (!init.method && url.pathname.endsWith("servers/detail")) return Response.json({ servers: [{ id: "server-1", name: "Source", status: "ACTIVE" }] });
    if (!init.method) return Response.json(fixture(url)); sent = JSON.parse(String(init.body)); return Response.json({ scaling_configuration_id: "new-config" });
  });
  const result = await runManagementOperation(session, "as", body("create-configuration", { name: "NewConfig", server: "server-1", key: "key-1" }));
  assert.equal(result.resourceId, "configuration:new-config");
  assert.deepEqual(sent, { scaling_configuration_name: "NewConfig", instance_config: { instance_id: "server-1", key_name: "key-1" } });
});
