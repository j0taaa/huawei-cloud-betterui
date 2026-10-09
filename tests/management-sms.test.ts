import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { smsManagement } from "@/lib/huawei/management/adapters/sms";
import { listSmsTasksForProject } from "@/lib/huawei/services/sms";
import { session } from "./fixtures/session";

const sourceId = "11111111-2222-3333-4444-555555555555";
const targetId = "22222222-3333-4444-5555-666666666666";
const diskId = "33333333-4444-5555-6666-777777777777";
const taskId = "44444444-5555-6666-7777-888888888888";
const createdId = "55555555-6666-7777-8888-999999999999";
const resource = { id: taskId, name: "migrate-orders", status: "READY" };
const currentTask = () => ({ id: taskId, name: resource.name, state: "READY", project_id: session.projectId, region_id: session.region, type: "MIGRATE_BLOCK", speed_limit: 50, source_server: { id: sourceId, name: "source-host" }, target_server: { vm_id: targetId, name: "target-ecs" }, error_json: "PRIVATE_TOKEN", create_date: 1767139200000, sub_tasks: [{ name: "MIGRATE_LINUX_BLOCK", progress: 15, process_trace: "PRIVATE_TRACE" }] });
const registered = () => ({ id: sourceId, name: "source-host", os_type: "LINUX", connected: true, state: "waiting", current_task: null, volume_groups: [], btrfs_list: [], disks: [{ name: "/dev/sda", os_disk: true, partition_style: "GPT", size: 40 * 1024 ** 3, used_size: 10 * 1024 ** 3, physical_volumes: [{ index: 1, name: "/dev/sda1", mount_point: "/", file_system: "ext4", size: 39 * 1024 ** 3, used_size: 10 * 1024 ** 3, secret_config: "PRIVATE_PARTITION" }] }] });
const target = () => ({ id: targetId, name: "target-ecs", tenant_id: session.projectId, status: "SHUTOFF", image: { id: "image-1", name: "Linux" }, addresses: { subnet: [{ addr: "192.168.0.10", version: 4, "OS-EXT-IPS:type": "fixed" }] }, "os-extended-volumes:volumes_attached": [{ id: diskId }] });
const volume = () => ({ id: diskId, status: "in-use", size: 100, bootable: "true", multiattach: false, metadata: { __system__encrypted: "0" }, attachments: [{ server_id: targetId }] });
const values = { name: "migrate-new", source: sourceId, target: targetId, speed: 100 };
type Call = { path: string; method: string; body?: Record<string, unknown> };
function cloud(t: TestContext, change?: (url: URL, method: string) => unknown, response: unknown = {}) {
  const writes: Call[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const replacement = change?.(url, method);
    if (method !== "GET") writes.push({ path: url.pathname, method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (replacement instanceof Response) return replacement;
    if (replacement !== undefined) return Response.json(replacement);
    if (method !== "GET") return Response.json(url.pathname === "/v3/tasks" ? { id: createdId } : response);
    if (url.pathname === "/v3/tasks") return Response.json({ tasks: [currentTask()], count: 1 });
    if (url.pathname === `/v3/tasks/${taskId}`) return Response.json(currentTask());
    if (url.pathname === "/v3/sources") return Response.json({ source_servers: [registered()], count: 1 });
    if (url.pathname === `/v3/sources/${sourceId}`) return Response.json(registered());
    if (url.pathname === `/v1/${session.projectId}/cloudservers/detail`) return Response.json({ servers: [target()] });
    if (url.pathname === `/v1/${session.projectId}/cloudservers/${targetId}`) return Response.json({ server: target() });
    if (url.pathname === `/v2/${session.projectId}/cloudvolumes/${diskId}`) return Response.json({ volume: volume() });
    if (url.pathname === `/v3/tasks/${taskId}/speed-limit`) return Response.json({ speed_limit: [{ start: "08:00", end: "18:00", speed: 50 }] });
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });
  return writes;
}

test("SMS inventory follows native count pagination and exposes exact task states", async t => {
  const offsets: string[] = [];
  cloud(t, url => {
    if (url.pathname !== "/v3/tasks") return undefined;
    offsets.push(url.searchParams.get("offset")!);
    const offset = Number(url.searchParams.get("offset"));
    return { count: 101, tasks: Array.from({ length: offset === 0 ? 100 : 1 }, (_, index) => ({ ...currentTask(), id: (offset + index).toString(16).padStart(32, "0") })) };
  });
  const rows = await smsManagement.inventory(session);
  assert.equal(rows.length, 101);
  assert.deepEqual(offsets, ["0", "100"]);
  assert.equal(rows[0].status, "READY");
});

test("SMS inventory page maps native dates, transfer speed, step counts, and ECS target IDs", async t => {
  cloud(t, url => url.pathname === "/v3/tasks" ? { count: 1, tasks: [{ ...currentTask(), migrate_speed: 25, sub_tasks: [{ progress: 100 }, { progress: 20 }], target_server: { id: "internal-sms-target", vm_id: targetId } }] } : undefined);
  const [row] = await listSmsTasksForProject(session);
  assert.equal(row.targetServerId, targetId);
  assert.equal(row.syncSpeed, "25 Mbit/s");
  assert.equal(row.progress, "1/2 steps complete");
  assert.ok(row.createdAt.includes("2025"));
});

test("SMS creation choices contain connected waiting sources and stopped single-disk ECS targets", async t => {
  cloud(t);
  const choices = await smsManagement.options!(session, "create");
  assert.deepEqual(choices.sources.map(row => row.value), [sourceId]);
  assert.deepEqual(choices.targets.map(row => row.value), [targetId]);
});

test("SMS creates a private nonautomatic task from freshly verified source partitions and target disk", async t => {
  const writes = cloud(t);
  const result = await smsManagement.execute(session, "create", values);
  assert.equal(result.resourceId, createdId);
  assert.equal(writes.length, 1);
  const body = writes[0].body!;
  assert.equal(writes[0].path, "/v3/tasks");
  assert.equal(writes[0].method, "POST");
  assert.equal(body.auto_start, false);
  assert.equal(body.start_target_server, false);
  assert.equal(body.use_public_ip, false);
  assert.equal(body.project_id, session.projectId);
  assert.equal(body.region_id, session.region);
  assert.equal(body.migration_ip, "192.168.0.10");
  assert.equal(body.is_need_consistency_check, true);
  assert.equal(JSON.stringify(body).includes("PRIVATE_PARTITION"), false);
  assert.deepEqual(body.source_server, { id: sourceId });
  const configured = body.target_server as { vm_id: string; disks: { disk_id: string; physical_volumes: unknown[] }[] };
  assert.equal(configured.vm_id, targetId);
  assert.equal(configured.disks[0].disk_id, diskId);
  assert.equal(configured.disks[0].physical_volumes.length, 1);
});

test("SMS creation rejects stale, disconnected, busy, complex, and unverified source layouts before writes", async t => {
  let row: Record<string, unknown> = registered();
  const writes = cloud(t, url => url.pathname === `/v3/sources/${sourceId}` ? row : undefined);
  for (const changes of [{ connected: false }, { current_task: { id: taskId } }, { state: "mystery" }, { os_type: "WINDOWS" }, { disks: [] }, { volume_groups: [{}] }, { btrfs_list: [{}] }, { disks: [{ ...registered().disks[0], used_size: -1 }] }, { disks: [{ ...registered().disks[0], physical_volumes: [{ ...registered().disks[0].physical_volumes[0], file_system: "btrfs" }] }] }]) {
    row = { ...registered(), ...changes };
    await assert.rejects(smsManagement.execute(session, "create", values));
  }
  assert.equal(writes.length, 0);
});

test("SMS rejects cross-project targets, running ECS, extra disks, public-only addresses, and unsafe boot volumes", async t => {
  let currentServer: Record<string, unknown> = target();
  let currentVolume: Record<string, unknown> = volume();
  const writes = cloud(t, url => url.pathname === `/v1/${session.projectId}/cloudservers/${targetId}` ? { server: currentServer } : url.pathname === `/v2/${session.projectId}/cloudvolumes/${diskId}` ? { volume: currentVolume } : undefined);
  for (const changes of [{ tenant_id: "foreign" }, { status: "ACTIVE" }, { "os-extended-volumes:volumes_attached": [{ id: diskId }, { id: sourceId }] }, { addresses: { subnet: [{ addr: "192.168.0.10", "OS-EXT-IPS:type": "floating" }] } }]) {
    currentServer = { ...target(), ...changes };
    await assert.rejects(smsManagement.execute(session, "create", values));
  }
  currentServer = target();
  for (const changes of [{ size: 10 }, { bootable: "false" }, { multiattach: true }, { metadata: {} }, { id: sourceId }, { attachments: [{ server_id: sourceId }] }]) {
    currentVolume = { ...volume(), ...changes };
    await assert.rejects(smsManagement.execute(session, "create", values));
  }
  assert.equal(writes.length, 0);
});

test("SMS creation refuses missing native acknowledgements without claiming a created task", async t => {
  cloud(t, (url, method) => method === "POST" && url.pathname === "/v3/tasks" ? {} : undefined);
  await assert.rejects(smsManagement.execute(session, "create", values), /no verified task ID/);
});

test("SMS inspection hides credentials, process traces, and error payloads", async t => {
  cloud(t);
  const outcome = await smsManagement.execute(session, "inspect", {}, resource);
  assert.ok(JSON.stringify(outcome).includes("15%"));
  assert.ok(!JSON.stringify(outcome).includes("PRIVATE"));
});

test("SMS verifies live target project, region, and identity before all mutations", async t => {
  let changes: Record<string, unknown> = {};
  const writes = cloud(t, url => url.pathname === `/v3/tasks/${taskId}` ? { ...currentTask(), ...changes } : undefined);
  for (changes of [{ id: sourceId }, { project_id: "foreign" }, { region_id: "foreign" }]) await assert.rejects(smsManagement.execute(session, "rename", { name: "new" }, resource), /could not be verified/);
  assert.equal(writes.length, 0);
});

test("SMS rename and fixed-speed updates preserve all other settings using native partial PUT", async t => {
  const writes = cloud(t);
  await smsManagement.execute(session, "rename", { name: "new" }, resource);
  await smsManagement.execute(session, "speed", { speed: 0 }, resource);
  assert.deepEqual(writes.map(row => [row.method, row.body]), [["PUT", { name: "new" }], ["PUT", { speed_limit: 0 }]]);
});

test("SMS fixed-speed updates reject fractional, negative, and over-limit values", async t => {
  const writes = cloud(t);
  for (const speed of [-1, 1001, 1.5, NaN]) await assert.rejects(smsManagement.execute(session, "speed", { speed }, resource), /integer speed/);
  assert.equal(writes.length, 0);
});

test("SMS start rechecks the Agent's current task and sends the native action", async t => {
  const writes = cloud(t, url => url.pathname === `/v3/sources/${sourceId}` ? { ...registered(), current_task: { id: taskId } } : undefined);
  const result = await smsManagement.execute(session, "start", {}, resource);
  assert.equal(result.asynchronous, true);
  assert.deepEqual(writes[0], { path: `/v3/tasks/${taskId}/action`, method: "POST", body: { operation: "start" } });
});

test("SMS rejects a disconnected Agent or a changed source/task association before resuming", async t => {
  let changes: Record<string, unknown> = { connected: false };
  const writes = cloud(t, url => url.pathname === `/v3/sources/${sourceId}` ? { ...registered(), current_task: { id: taskId }, ...changes } : undefined);
  await assert.rejects(smsManagement.execute(session, "start", {}, resource), /Agent/);
  changes = { current_task: { id: sourceId } };
  await assert.rejects(smsManagement.execute(session, "start", {}, resource), /Agent/);
  assert.equal(writes.length, 0);
});

test("SMS pause accepts only native active states and preserves existing data", async t => {
  const writes = cloud(t, url => url.pathname === `/v3/tasks/${taskId}` ? { ...currentTask(), state: "RUNNING" } : url.pathname === `/v3/sources/${sourceId}` ? { ...registered(), current_task: { id: taskId }, connected: false } : undefined);
  await smsManagement.execute(session, "stop", {}, resource);
  assert.deepEqual(writes[0].body, { operation: "stop" });
});

test("SMS unknown and transitioning states block deletion and configuration changes", async t => {
  let state = "mystery";
  const writes = cloud(t, url => url.pathname === `/v3/tasks/${taskId}` ? { ...currentTask(), state } : undefined);
  for (state of ["mystery", "RUNNING", "DELETING", "ABORTING", "RESETING"]) {
    await assert.rejects(smsManagement.execute(session, "delete", {}, resource), /state/);
    await assert.rejects(smsManagement.execute(session, "rename", { name: "new" }, resource), /state/);
  }
  assert.equal(writes.length, 0);
});

test("SMS deletion uses native DELETE, while progress never confuses a scope mismatch with absence", async t => {
  cloud(t, url => url.pathname === `/v3/tasks/${taskId}` ? { ...currentTask(), project_id: "foreign" } : undefined);
  const entry = { id: "request", service: "sms", operation: "Delete inactive migration task", resourceId: taskId, jobId: taskId, state: "submitted" as const, startedAt: new Date().toISOString() };
  await assert.rejects(smsManagement.poll!(session, entry), /could not be verified/);
  const writes = cloud(t);
  await smsManagement.execute(session, "delete", {}, resource);
  assert.deepEqual(writes[0], { path: `/v3/tasks/${taskId}`, method: "DELETE" });
  cloud(t, url => url.pathname === `/v3/tasks/${taskId}` ? new Response("not found", { status: 404 }) : undefined);
  assert.equal((await smsManagement.poll!(session, entry)).state, "succeeded");
});

test("SMS scheduled limits use the native envelope and do not display other response fields", async t => {
  cloud(t);
  const result = await smsManagement.execute(session, "speed-rules", {}, resource);
  assert.deepEqual(result.facts, [{ label: "08:00 - 18:00", value: "50 Mbit/s" }]);
});

test("SMS rejects native 200 error envelopes without echoing private error data", async t => {
  cloud(t, undefined, { error_code: "SMS.error", error_msg: "PRIVATE_CREDENTIALS" });
  await assert.rejects(smsManagement.execute(session, "rename", { name: "new" }, resource), error => error instanceof Error && /SMS rejected/.test(error.message) && !error.message.includes("PRIVATE"));
});
