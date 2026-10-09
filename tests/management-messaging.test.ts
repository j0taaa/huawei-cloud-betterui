import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManagementOperation, getManagementContext } from "@/lib/huawei/management";
import { messagingManagement } from "@/lib/huawei/management/adapters/messaging";
import { session } from "./fixtures/session";

const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-message-management-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const offering = JSON.stringify(["cluster-flavor", "5.x", "ssd"]);
const input = (operation: string, values = {}, resourceId = "broker-1") => ({ operation, values, resourceId, projectId: session.projectId, requestId: randomUUID(), acknowledgedImpact: true, confirmName: "Broker One" });
function response(url: URL) {
  if (url.pathname.endsWith("/products")) return { versions: ["5.x"], products: [{ type: "cluster", product_id: "cluster-flavor", charging_mode: ["hourly"], ios: [{ io_spec: "ssd", available_zones: ["az-1", "az-2", "az-3"] }] }] };
  if (url.pathname.endsWith("available-zones")) return { available_zones: [{ id: "az-1", name: "Zone 1" }, { id: "sold-out", sold_out: true }] };
  if (url.pathname.endsWith("/subnets")) return { subnets: [{ id: "subnet-1", vpc_id: "vpc-1", neutron_network_id: "network-1", name: "Subnet" }] };
  if (url.pathname.endsWith("security-groups")) return { security_groups: [{ id: "sg-1", name: "Security" }] };
  if (url.pathname.endsWith("/vhosts")) return { items: [{ name: "/" }], total: 1 };
  if (url.pathname.endsWith("/queues")) return { items: [{ name: "queue%2F/one", messages: 4, consumers: 2 }], total: 1 };
  if (url.pathname.endsWith("/users")) return { users: [{ access_key: "reader", secret_key: "must-not-expose" }], total: 1 };
  if (url.pathname.endsWith("/brokers")) return { brokers: [{ broker_name: "broker-0", ids: [0] }], total: 1 };
  if (url.pathname.endsWith("/topics")) return { topics: [{ name: "events" }], total: 1 };
  if (url.pathname.endsWith("/groups")) return { groups: [{ name: "workers" }], total: 1 };
  if (url.pathname.endsWith("/instances")) return { instance_num: 1, instances: [{ instance_id: "broker-1", name: "Broker One", status: "RUNNING", storage_space: 300 }] };
  if (url.pathname.endsWith("/broker-1")) return { instance_id: "broker-1", name: "Broker One", status: "RUNNING", engine_version: "5.x", storage_space: 300 };
  throw new Error(`Unexpected mocked GET ${url.pathname}`);
}

for (const engine of ["rabbitmq", "rocketmq"] as const) {
  const service = `dms-${engine}`;
  test(`${engine} creates from live catalog with subnet's VPC/network and explicit engine`, async (t) => {
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
      if (!init.method) return Response.json(response(new URL(url)));
      writes.push({ path: new URL(url).pathname, body: JSON.parse(String(init.body)) }); return Response.json({ instance_id: "created" });
    });
    const fields = { name: "Example", offering, subnet: "subnet-1", securityGroup: "sg-1", zones: ["az-1"], brokers: 3, storage: 300, ssl: true, ...(engine === "rabbitmq" ? { accessUser: "owner", password: "SecretPass1!" } : {}) };
    const result = await runManagementOperation(session, service, input("create", fields));
    assert.equal(result.resourceId, "created"); assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `/v2/${engine}/${session.projectId}/instances`);
    assert.equal(writes[0].body.engine, engine); assert.equal(writes[0].body.subnet_id, "network-1"); assert.equal(writes[0].body.vpc_id, "vpc-1"); assert.equal(writes[0].body.enable_publicip, false);
    assert.equal(writes[0].body.broker_num, 3); assert.equal(writes[0].body.storage_space, 300);
    if (engine === "rocketmq") assert.equal(writes[0].body.password, undefined);
  });
  test(`${engine} rejects forged choices before any cloud mutation`, async (t) => {
    const writes: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => { if (init.method) writes.push(url); return Response.json(response(new URL(url))); });
    await assert.rejects(runManagementOperation(session, service, input("create", { name: "Example", offering: "fake-product", subnet: "subnet-1", securityGroup: "sg-1", zones: ["sold-out"], brokers: 3, storage: 300, ...(engine === "rabbitmq" ? { accessUser: "owner", password: "SecretPass1!" } : {}) })), /not available/);
    assert.equal(writes.length, 0);
  });
  test(`${engine} protects parent ownership and uses distinct restart contracts`, async (t) => {
    const writes: { path: string; body?: unknown }[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => { if (!init.method) return Response.json(response(new URL(url))); writes.push({ path: new URL(url).pathname, body: init.body ? JSON.parse(String(init.body)) : undefined }); return Response.json({ job_id: "restart-job" }); });
    await assert.rejects(runManagementOperation(session, service, input("restart", {}, "other-broker")), /not found/);
    const result = await runManagementOperation(session, service, input("restart"));
    assert.equal(result.jobId, "restart-job"); assert.equal(writes.length, 1);
    assert.equal(writes[0].path, engine === "rabbitmq" ? "/v2/project-1/instances/action" : "/v2/project-1/rocketmq/instances/broker-1/restart");
    assert.deepEqual(writes[0].body, engine === "rabbitmq" ? { action: "restart", instances: ["broker-1"] } : undefined);
  });
}

test("RabbitMQ queue purge encodes virtual host and queue once; invalid child is rejected", async (t) => {
  const writes: { path: string; method?: string }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => { if (!init.method) return Response.json(response(new URL(url))); writes.push({ path: new URL(url).pathname, method: init.method }); return new Response(null, { status: 204 }); });
  await assert.rejects(runManagementOperation(session, "dms-rabbitmq", input("purge-queue", { vhost: "/", childName: "missing" })), /not in this virtual host/);
  assert.equal(writes.length, 0);
  await runManagementOperation(session, "dms-rabbitmq", input("purge-queue", { vhost: "/", childName: "queue%2F/one" }));
  assert.deepEqual(writes, [{ path: "/v2/rabbitmq/project-1/instances/broker-1/vhosts/%2F/queues/queue%252F%2Fone/contents", method: "DELETE" }]);
});

test("access-user inspection hides secrets and cloud settings are chosen for the selected instance", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => Response.json(response(new URL(url))));
  const users = await runManagementOperation(session, "dms-rabbitmq", input("users"));
  assert.ok(!JSON.stringify(users).includes("must-not-expose"));
  assert.ok(JSON.stringify(users).includes("reader"));
  const context = await getManagementContext(session, "dms-rocketmq", session.projectId, "create-topic", "broker-1");
  assert.deepEqual(context.choices.brokers, [{ value: "broker-0", label: "broker-0" }]);
  assert.ok(messagingManagement("rocketmq").operations.some((operation) => operation.id === "create-group"));
});

test("messaging expansion refuses shrinking storage and propagates background failure", async (t) => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => { if (!init.method) return Response.json(response(new URL(url))); writes++; return Response.json({ results: [{ instance: "broker-1", result: "failed", error_msg: "Restart not allowed" }] }); });
  await assert.rejects(runManagementOperation(session, "dms-rabbitmq", input("expand-storage", { storage: 200 })), /must exceed/);
  assert.equal(writes, 0);
  await assert.rejects(runManagementOperation(session, "dms-rabbitmq", input("restart")), /Restart not allowed/);
  assert.equal(writes, 1);
});
