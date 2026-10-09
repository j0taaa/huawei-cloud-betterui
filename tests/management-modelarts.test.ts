import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { modelartsManagement } from "@/lib/huawei/management/adapters/modelarts";
import { HuaweiApiError } from "@/lib/huawei/http";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, validateManagementValues, type ManagementHistoryEntry } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const notebook = { id: "notebook-1", name: "research", status: "RUNNING", feature: "NOTEBOOK", description: "experiments", flavor: "modelarts.vm.cpu.2u", image: { id: "image-1", name: "pytorch-2.1", arch: "X86_64" }, volume: { category: "EVS", capacity: 50, status: "MOUNTED", mount_path: "/home/ma-user/work" }, workspace_id: "0", billing_items: ["COMPUTE", "STORAGE"], user_id: "user-1", fail_reason: "", token: "SECRET-SESSION-TOKEN", url: "https://modelarts.example.invalid/auth?token=SECRET-SESSION-TOKEN" };
const workspace = { id: "0", name: "default-space", owner: "test-user" };
const flavor = { id: "modelarts.vm.cpu.2u", name: "CPU 2U", category: "CPU", vcpus: 2, feature: "NOTEBOOK", free: false, sold_out: false, storages: ["EVS", "EFS"], evs_max_size: "4096", grow_support_type: "COMMON", arch: "x86_64" };
const image = { id: "image-1", name: "pytorch-2.1", arch: "X86_64", service_type: "DEV", type: "BUILD_IN", support_res_categories: ["CPU"] };
const resource = { id: notebook.id, name: notebook.name, status: notebook.status as string, values: { flavor: flavor.id, image: "pytorch-2.1", feature: "NOTEBOOK", storage: 50, workspace: "0" } };
type Fixture = { notebook?: Record<string, unknown>; notebooks?: Record<string, unknown>[]; workspaces?: Record<string, unknown>[]; flavors?: Record<string, unknown>[]; images?: Record<string, unknown>[]; imagesByWorkspace?: Record<string, Record<string, unknown>[]> };
function cloud(t: TestContext, fixture: Fixture = {}, override?: (url: URL, init: RequestInit) => Response | undefined) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  const current = fixture.notebook ?? notebook;
  const rows = fixture.notebooks ?? [current];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input), path = url.pathname;
    const other = override?.(url, init); if (other) return other;
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    if (init.method) {
      writes.push({ path: path + url.search, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (init.method === "DELETE") return Response.json({ ...current });
      return Response.json({ ...current, ...(init.body ? JSON.parse(String(init.body)) : {}) });
    }
    const lists: Record<string, () => Response> = {
      "/v1/project-1/notebooks/all": () => Response.json({ data: rows, total: rows.length }),
      "/v1/project-1/notebooks/notebook-1": () => Response.json(current),
      "/v1/project-1/workspaces": () => Response.json({ workspaces: fixture.workspaces ?? [workspace], total_count: (fixture.workspaces ?? [workspace]).length }),
      "/v1/project-1/notebooks/flavors": () => Response.json({ flavors: fixture.flavors ?? [flavor] }),
      "/v1/project-1/images": () => {
        const scoped = fixture.imagesByWorkspace?.[url.searchParams.get("workspace_id") ?? "0"] ?? fixture.images ?? [image];
        return Response.json({ data: scoped, total: scoped.length });
      },
    };
    if (path in lists) return lists[path]();
    throw new Error(`Unexpected ModelArts request ${url}`);
  });
  return writes;
}
const entry = (operation: string, jobId = notebook.id): ManagementHistoryEntry => ({ id: "request", service: "modelarts", operation, resourceId: notebook.id, jobId, state: "submitted", startedAt: new Date().toISOString() });
const stoppedResource = { ...resource, status: "STOPPED" };

test("ModelArts inventory keeps native notebook IDs and exact native statuses", async t => {
  cloud(t);
  const rows = await modelartsManagement.inventory(session);
  assert.deepEqual(rows.map(row => [row.id, row.name, row.status]), [[notebook.id, notebook.name, "RUNNING"]]);
  assert.equal(rows[0].values?.flavor, flavor.id);
});
test("ModelArts inventory maps unrecognised native statuses to UNKNOWN instead of guessing", async t => {
  cloud(t, { notebook: { ...notebook, status: "MIGRATING" } });
  assert.equal((await modelartsManagement.inventory(session))[0].status, "UNKNOWN");
});
test("ModelArts inventory rejects truncated pagination against the native total", async t => {
  const offsets: string[] = [];
  cloud(t, {}, url => {
    if (!url.pathname.endsWith("/notebooks/all")) return undefined;
    offsets.push(url.searchParams.get("offset")!);
    return Response.json(offsets.length === 1 ? { data: [notebook], total: 2 } : { data: [], total: 2 });
  });
  await assert.rejects(modelartsManagement.inventory(session), /ended pagination before its reported total/);
  assert.deepEqual(offsets, ["0", "1"]);
});
test("ModelArts inventory rejects a missing native notebook total", async t => {
  cloud(t, {}, url => url.pathname.endsWith("/notebooks/all") ? Response.json({ data: [notebook] }) : undefined);
  await assert.rejects(modelartsManagement.inventory(session), /omitted the native total/);
});
test("ModelArts inventory rejects malformed native IDs instead of filtering them", async t => {
  cloud(t, { notebooks: [{ ...notebook, id: "" }] });
  await assert.rejects(modelartsManagement.inventory(session), /without a valid native ID/);
});
test("ModelArts inventory rejects duplicated native IDs", async t => {
  cloud(t, { notebooks: [notebook, { ...notebook, name: "duplicate" }] });
  await assert.rejects(modelartsManagement.inventory(session), /duplicate native IDs/);
});
test("ModelArts all-notebook inventory retains other authorized project creators", async t => {
  cloud(t, { notebooks: [{ ...notebook, user_id: "someone-else" }] });
  assert.equal((await modelartsManagement.inventory(session))[0].id, notebook.id);
});
test("ModelArts inventory rejects null owner fields", async t => {
  cloud(t, { notebook: { ...notebook, user_id: null } });
  await assert.rejects(modelartsManagement.inventory(session), /invalid owner/);
});
test("ModelArts inventory rejects notebooks with an invalid workspace field", async t => {
  cloud(t, { notebook: { ...notebook, workspace_id: "" } });
  await assert.rejects(modelartsManagement.inventory(session), /invalid workspace/);
});
test("ModelArts create options only offer usable billed flavors and workspace-compatible dev images", async t => {
  const unflagged = { id: "modelarts.vm.cpu.unflagged", name: "Unflagged", category: "CPU", vcpus: 2, feature: "NOTEBOOK", sold_out: false, storages: ["EVS"], evs_max_size: "100", arch: "x86_64" };
  cloud(t, {
    flavors: [flavor, { ...flavor, id: "modelarts.vm.cpu.free", feature: "DEFAULT", free: true }, { ...flavor, id: "modelarts.vm.cpu.gone", sold_out: true }, { ...flavor, id: "modelarts.bm.noevs", storages: ["EFS"] }, { ...flavor, id: "modelarts.vm.cpu.strcap", evs_max_size: "invalid" }, unflagged],
    images: [image, { ...image, id: "image-2", service_type: "INFERENCE" }, { ...image, id: "image-3", service_type: undefined }, { ...image, id: "image-arm", arch: "AARCH64" }],
  });
  const options = await modelartsManagement.options!(session, "create");
  assert.deepEqual(options.workspaces.map(choice => choice.value), ["0"]);
  assert.deepEqual(options.flavors.map(choice => choice.value), [flavor.id]);
  assert.deepEqual(options.images.map(choice => choice.value), ["image-1"]);
});
test("ModelArts create options offer the union of images across all accessible workspaces", async t => {
  cloud(t, { workspaces: [workspace, { id: "ws-9", name: "team-space", owner: "test-user" }], imagesByWorkspace: { "0": [image], "ws-9": [{ ...image, id: "image-2", name: "tensorflow" }] } });
  const options = await modelartsManagement.options!(session, "create");
  assert.deepEqual(options.workspaces.map(choice => choice.value), ["0", "ws-9"]);
  assert.deepEqual(options.images.map(choice => choice.value), ["image-1", "image-2"]);
});
test("ModelArts notebook creation sends the typed native contract and keeps the original notebook ID", async t => {
  const writes = cloud(t);
  const result = await modelartsManagement.execute(session, "create", { name: "research", description: "experiments", workspace: "0", flavor: flavor.id, image: image.id, storageSize: 50 });
  assert.deepEqual(writes[0], { path: "/v1/project-1/notebooks", method: "POST", body: { name: "research", description: "experiments", feature: "NOTEBOOK", flavor: flavor.id, image_id: image.id, volume: { category: "EVS", capacity: 50 }, workspace_id: "0" } });
  assert.equal(result.asynchronous, true); assert.equal(result.jobId, notebook.id); assert.equal(result.resourceId, notebook.id);
  assert.match(result.message, /billing starts/);
});
test("ModelArts creation rechecks fresh workspace, flavor, image and EVS limits before writing", async t => {
  const writes = cloud(t, { flavors: [{ ...flavor, evs_max_size: "100" }] });
  const values = { name: "research", workspace: "0", flavor: flavor.id, image: image.id, storageSize: 50 };
  await assert.rejects(modelartsManagement.execute(session, "create", { ...values, storageSize: 200 }), /at most 100 GB/);
  await assert.rejects(modelartsManagement.execute(session, "create", { ...values, workspace: "foreign" }), /accessible workspace/);
  await assert.rejects(modelartsManagement.execute(session, "create", { ...values, flavor: "modelarts.vm.cpu.gone" }), /current notebook flavor/);
  await assert.rejects(modelartsManagement.execute(session, "create", { ...values, image: "foreign-image" }), /not available for the selected workspace/);
  assert.equal(writes.length, 0);
});
test("ModelArts creation rejects flavors with unknown native catalog flags", async t => {
  const writes = cloud(t, { flavors: [{ ...flavor, id: "modelarts.vm.cpu.unflagged", free: undefined }, { ...flavor, id: "modelarts.vm.cpu.strcap", evs_max_size: "invalid" }] });
  const values = { name: "research", workspace: "0", image: image.id, storageSize: 50 };
  await assert.rejects(modelartsManagement.execute(session, "create", { ...values, flavor: "modelarts.vm.cpu.unflagged" }), /Only on-sale billed NOTEBOOK flavors/);
  await assert.rejects(modelartsManagement.execute(session, "create", { ...values, flavor: "modelarts.vm.cpu.strcap" }), /Only on-sale billed NOTEBOOK flavors/);
  assert.equal(writes.length, 0);
});
test("ModelArts creation rejects images whose architecture does not match the flavor", async t => {
  const writes = cloud(t, { images: [image, { ...image, id: "image-arm", arch: "AARCH64" }] });
  await assert.rejects(modelartsManagement.execute(session, "create", { name: "research", workspace: "0", flavor: flavor.id, image: "image-arm", storageSize: 50 }), /architecture does not match/);
  assert.equal(writes.length, 0);
});
test("ModelArts creation enforces direct whole-number storage bounds", async t => {
  const writes = cloud(t);
  const values = { name: "research", workspace: "0", flavor: flavor.id, image: image.id, storageSize: 50 };
  for (const storageSize of ["50", 4, 4097, Number.NaN, 5.5]) await assert.rejects(modelartsManagement.execute(session, "create", { ...values, storageSize }), /whole number between 5 and 4096/);
  assert.equal(writes.length, 0);
});
test("ModelArts metadata updates send only provided fields and report acceptance honestly", async t => {
  const writes = cloud(t, { notebook: { ...notebook, status: "STOPPED" } });
  const first = await modelartsManagement.execute(session, "update", { description: "new text" }, stoppedResource);
  const second = await modelartsManagement.execute(session, "update", { name: "renamed", description: "new text" }, stoppedResource);
  await assert.rejects(modelartsManagement.execute(session, "update", {}, stoppedResource), /Enter a new name or description/);
  assert.deepEqual(writes.map(write => write.body), [{ description: "new text" }, { name: "renamed", description: "new text" }]);
  assert.match(first.message, /accepted/); assert.match(second.message, /accepted/);
});
test("ModelArts writes are blocked by fresh native statuses and unknown statuses", async t => {
  let status = "CREATING";
  const writes = cloud(t, {}, url => url.pathname.endsWith("/notebooks/notebook-1") ? Response.json({ ...notebook, status }) : undefined);
  await assert.rejects(modelartsManagement.execute(session, "update", { description: "x" }, resource), /unavailable while the notebook status is CREATING/);
  status = "WEIRD";
  await assert.rejects(modelartsManagement.execute(session, "stop", {}, resource), /status is UNKNOWN/);
  assert.equal(writes.length, 0);
});
test("ModelArts inspection omits the native access URL, session token and failure reason", async t => {
  cloud(t, { notebook: { ...notebook, fail_reason: "SECRET-FAILURE-REASON quota exhausted" } });
  const outcome = await modelartsManagement.execute(session, "inspect", {}, resource);
  const serialized = JSON.stringify(outcome);
  assert.ok(!serialized.includes("SECRET-SESSION-TOKEN"));
  assert.ok(!serialized.includes("auth?token="));
  assert.ok(!serialized.includes("SECRET-FAILURE-REASON"));
  assert.match(outcome.message, /failure reason are not shown/);
  assert.ok(outcome.facts!.some(fact => fact.label === "Flavor" && fact.value === flavor.id));
});
test("ModelArts image switching uses the notebook's actual non-default workspace", async t => {
  const writes = cloud(t, { notebook: { ...notebook, status: "STOPPED", workspace_id: "ws-9" }, imagesByWorkspace: { "ws-9": [image] } });
  await modelartsManagement.execute(session, "change-image", { image: image.id }, stoppedResource);
  assert.deepEqual(writes[0], { path: "/v1/project-1/notebooks/notebook-1", method: "PUT", body: { image_id: image.id } });
  await assert.rejects(modelartsManagement.execute(session, "change-image", { image: "foreign-image" }, stoppedResource), /not available for this notebook's workspace/);
  assert.equal(writes.length, 1);
});
test("ModelArts image switching never defaults a missing workspace to the default space", async t => {
  const unscoped: Record<string, unknown> = { ...notebook, status: "STOPPED" };
  delete unscoped.workspace_id;
  const writes = cloud(t, { notebook: unscoped });
  await assert.rejects(modelartsManagement.execute(session, "change-image", { image: image.id }, stoppedResource), /workspace could not be verified/);
  assert.equal(writes.length, 0);
});
test("ModelArts image switching verifies the architecture of the notebook's current flavor", async t => {
  const writes = cloud(t, { notebook: { ...notebook, status: "STOPPED" }, images: [image, { ...image, id: "image-arm", arch: "AARCH64" }] });
  await assert.rejects(modelartsManagement.execute(session, "change-image", { image: "image-arm" }, stoppedResource), /architecture does not match/);
  assert.equal(writes.length, 0);
});
test("ModelArts storage expansion only grows verified EVS capacity within the flavor limit", async t => {
  const writes = cloud(t, { notebook: { ...notebook, status: "STOPPED" } });
  await modelartsManagement.execute(session, "expand-storage", { storageNewSize: 100 }, stoppedResource);
  assert.deepEqual(writes[0], { path: "/v1/project-1/notebooks/notebook-1", method: "PUT", body: { storage_new_size: 100 } });
  await assert.rejects(modelartsManagement.execute(session, "expand-storage", { storageNewSize: 50 }, stoppedResource), /greater than the current 50 GB/);
  await assert.rejects(modelartsManagement.execute(session, "expand-storage", { storageNewSize: 5000 }, stoppedResource), /whole number between 5 and 4096/);
  assert.equal(writes.length, 1);
});
test("ModelArts storage expansion blocks unverifiable native flavor limits", async t => {
  const writes = cloud(t, { notebook: { ...notebook, status: "STOPPED" }, flavors: [{ ...flavor, evs_max_size: "invalid" }] });
  await assert.rejects(modelartsManagement.execute(session, "expand-storage", { storageNewSize: 100 }, stoppedResource), /capacity limit could not be verified/);
  assert.equal(writes.length, 0);
});
test("ModelArts storage expansion resolves the flavor by its native ID, never a display label", async t => {
  const writes = cloud(t, { notebook: { ...notebook, status: "STOPPED", flavor: "CPU 2U" } });
  await assert.rejects(modelartsManagement.execute(session, "expand-storage", { storageNewSize: 100 }, stoppedResource), /current flavor could not be verified/);
  assert.equal(writes.length, 0);
});
test("ModelArts start and stop use native action endpoints with verified state gates", async t => {
  let status = "STOPPED";
  const writes = cloud(t, {}, url => url.pathname.endsWith("/notebooks/notebook-1") ? Response.json({ ...notebook, status }) : undefined);
  await assert.rejects(modelartsManagement.execute(session, "stop", {}, stoppedResource), /status is STOPPED/);
  const started = await modelartsManagement.execute(session, "start", { autoStopHours: 2 }, stoppedResource);
  assert.deepEqual(writes[0], { path: "/v1/project-1/notebooks/notebook-1/start?duration=7200000&type=TIMING", method: "POST", body: undefined });
  assert.equal(started.asynchronous, true); assert.equal(started.jobId, notebook.id);
  status = "RUNNING";
  const stopped = await modelartsManagement.execute(session, "stop", {}, resource);
  assert.deepEqual(writes[1], { path: "/v1/project-1/notebooks/notebook-1/stop", method: "POST", body: undefined });
  assert.equal(stopped.asynchronous, true);
});
test("ModelArts start without a timer sends no body and a wrong ACK identity is uncertain, not an input error", async t => {
  let mismatch = false;
  const writes = cloud(t, { notebook: { ...notebook, status: "STOPPED" } }, (url, init) => init.method === "POST" && mismatch ? Response.json({ id: "other-notebook", status: "STARTING" }) : undefined);
  await modelartsManagement.execute(session, "start", {}, stoppedResource);
  assert.deepEqual(writes[0], { path: "/v1/project-1/notebooks/notebook-1/start", method: "POST", body: undefined });
  mismatch = true;
  await assert.rejects(modelartsManagement.execute(session, "start", {}, stoppedResource), error => {
    assert.ok(!(error instanceof ManagementInputError));
    assert.match((error as Error).message, /different notebook/);
    return true;
  });
});
test("ModelArts start enforces direct whole-number timer bounds", async t => {
  const writes = cloud(t, { notebook: { ...notebook, status: "STOPPED" } });
  for (const autoStopHours of [0, 73, "2", 2.5]) await assert.rejects(modelartsManagement.execute(session, "start", { autoStopHours }, stoppedResource), /whole number between 1 and 72/);
  assert.equal(writes.length, 0);
});
test("ModelArts deletion is an asynchronous native DELETE that keeps the notebook identity", async t => {
  const writes = cloud(t);
  const result = await modelartsManagement.execute(session, "delete", {}, resource);
  assert.deepEqual(writes[0], { path: "/v1/project-1/notebooks/notebook-1", method: "DELETE", body: undefined });
  assert.equal(result.asynchronous, true); assert.equal(result.jobId, notebook.id);
  assert.match(result.message, /permanently/);
});
test("ModelArts deletion refuses transient, terminal and frozen native statuses", async t => {
  for (const status of ["CREATING", "STOPPING", "DELETING", "SNAPSHOTTING", "DELETED", "FROZEN", "INIT"]) {
    const writes = cloud(t, { notebook: { ...notebook, status } });
    await assert.rejects(modelartsManagement.execute(session, "delete", {}, { ...resource, status }), /unavailable while the notebook status is/);
    assert.equal(writes.length, 0);
  }
});
test("ModelArts deletion compares the exact fresh notebook name before writing", async t => {
  const writes = cloud(t);
  await assert.rejects(modelartsManagement.execute(session, "delete", {}, { ...resource, name: "stale-name" }), /does not match the selected name/);
  await assert.rejects(modelartsManagement.execute(session, "delete", {}, { ...resource, name: "" }), /does not match the selected name/);
  assert.equal(writes.length, 0);
});
test("ModelArts free CodeLab notebooks are an explicit gap and are never modified or deleted", async t => {
  const writes = cloud(t, { notebook: { ...notebook, feature: "DEFAULT" } });
  await assert.rejects(modelartsManagement.execute(session, "inspect", {}, resource), /Only billed NOTEBOOK notebooks/);
  await assert.rejects(modelartsManagement.execute(session, "update", { description: "x" }, resource), /Only billed NOTEBOOK notebooks/);
  await assert.rejects(modelartsManagement.execute(session, "delete", {}, resource), /Only billed NOTEBOOK notebooks/);
  assert.equal(writes.length, 0);
});
test("ModelArts dedicated resource pool notebooks are an explicit gap and are never deleted", async t => {
  const writes = cloud(t, { notebook: { ...notebook, pool: { id: "pool-1", name: "dedicated" } } });
  await assert.rejects(modelartsManagement.execute(session, "delete", {}, resource), /dedicated resource pools/);
  assert.equal(writes.length, 0);
});
test("ModelArts polling keeps original notebook IDs and reports only verified native outcomes", async t => {
  let reply: Record<string, unknown> = { ...notebook, status: "CREATING" };
  cloud(t, {}, url => url.pathname.endsWith("/notebooks/notebook-1") ? Response.json(reply) : undefined);
  assert.equal((await modelartsManagement.poll!(session, entry("Create notebook"))).state, "submitted");
  reply = { ...reply, status: "RUNNING" };
  assert.equal((await modelartsManagement.poll!(session, entry("Create notebook"))).state, "succeeded");
  reply = { ...reply, status: "CREATE_FAILED", fail_reason: "SECRET-QUOTA-REASON" };
  const failed = await modelartsManagement.poll!(session, entry("Create notebook"));
  assert.equal(failed.state, "failed"); assert.match(failed.message!, /not created successfully/);
  assert.ok(!failed.message!.includes("SECRET-QUOTA-REASON"));
  reply = { ...reply, status: "WEIRD" };
  assert.equal((await modelartsManagement.poll!(session, entry("Start notebook"))).state, "submitted");
  reply = { ...reply, status: "STOPPED" };
  assert.equal((await modelartsManagement.poll!(session, entry("Start notebook"))).state, "submitted");
  reply = { ...reply, status: "STOPPED" };
  assert.equal((await modelartsManagement.poll!(session, entry("Stop notebook"))).state, "succeeded");
  reply = { ...reply, id: "other-notebook" };
  await assert.rejects(modelartsManagement.poll!(session, entry("Stop notebook")), /different notebook/);
  await assert.rejects(modelartsManagement.poll!(session, entry("Unrecognized operation")), /not polled/);
  await assert.rejects(modelartsManagement.poll!(session, entry("Stop notebook", "other-notebook")), /original notebook identity/);
});
test("ModelArts start polling keeps a stale STOPPED status submitted instead of failing", async t => {
  let reply: Record<string, unknown> = { ...notebook, status: "STOPPED" };
  cloud(t, {}, url => url.pathname.endsWith("/notebooks/notebook-1") ? Response.json(reply) : undefined);
  assert.equal((await modelartsManagement.poll!(session, entry("Start notebook"))).state, "submitted");
  reply = { ...reply, status: "START_FAILED" };
  assert.equal((await modelartsManagement.poll!(session, entry("Start notebook"))).state, "failed");
  reply = { ...reply, status: "RUNNING" };
  assert.equal((await modelartsManagement.poll!(session, entry("Start notebook"))).state, "succeeded");
});
test("ModelArts delete polling treats a native transport 404 as success and other operations as failure", async t => {
  cloud(t, {}, (_url, init) => !init.method && _url.pathname.endsWith("/notebooks/notebook-1") ? Response.json({ error_msg: "not found" }, { status: 404 }) : undefined);
  assert.equal((await modelartsManagement.poll!(session, entry("Delete notebook"))).state, "succeeded");
  assert.equal((await modelartsManagement.poll!(session, entry("Create notebook"))).state, "submitted");
});
test("ModelArts delete polling keeps DELETING submitted and reports DELETE_FAILED without finishing it", async t => {
  let reply: Record<string, unknown> = { ...notebook, status: "DELETING" };
  cloud(t, {}, url => url.pathname.endsWith("/notebooks/notebook-1") ? Response.json(reply) : undefined);
  assert.equal((await modelartsManagement.poll!(session, entry("Delete notebook"))).state, "submitted");
  reply = { ...reply, status: "DELETE_FAILED" };
  assert.equal((await modelartsManagement.poll!(session, entry("Delete notebook"))).state, "failed");
  reply = { ...reply, status: "DELETED" };
  assert.equal((await modelartsManagement.poll!(session, entry("Delete notebook"))).state, "succeeded");
});
test("ModelArts native HTTP error text is sanitized while the HTTP status is preserved", async t => {
  cloud(t, { notebook: { ...notebook, status: "STOPPED" } }, (url, init) => init.method === "PUT" ? Response.json({ error_code: "MA.0001", error_msg: "SECRET-INTERNAL-DETAILS" }, { status: 409 }) : undefined);
  await assert.rejects(modelartsManagement.execute(session, "update", { description: "x" }, stoppedResource), error => {
    assert.ok(error instanceof HuaweiApiError);
    const rejected = error as HuaweiApiError;
    assert.equal(rejected.status, 409);
    assert.ok(!rejected.message.includes("SECRET-INTERNAL-DETAILS"));
    return true;
  });
});
test("ModelArts native server errors are sanitized as uncertain outcomes", async t => {
  cloud(t, { notebook: { ...notebook, status: "STOPPED" } }, (url, init) => init.method === "PUT" ? Response.json({ error_msg: "SECRET-INTERNAL-DETAILS" }, { status: 502 }) : undefined);
  await assert.rejects(modelartsManagement.execute(session, "update", { description: "x" }, stoppedResource), error => {
    assert.ok(!(error instanceof ManagementInputError));
    const rejected = error as Error;
    assert.match(rejected.message, /HTTP 502/);
    assert.ok(!rejected.message.includes("SECRET-INTERNAL-DETAILS"));
    return true;
  });
});
test("ModelArts non-JSON native responses are sanitized as invalid responses", async t => {
  cloud(t, {}, url => url.pathname.endsWith("/notebooks/notebook-1") ? new Response("<html>broken</html>", { headers: { "Content-Type": "text/html" } }) : undefined);
  await assert.rejects(modelartsManagement.execute(session, "inspect", {}, resource), error => {
    assert.ok(!(error instanceof ManagementInputError));
    const rejected = error as Error;
    assert.match(rejected.message, /invalid ModelArts response/);
    assert.ok(!rejected.message.includes("<html>"));
    return true;
  });
});
test("ModelArts workspace catalog requires the native total and valid native rows", async t => {
  cloud(t, {}, url => url.pathname.endsWith("/workspaces") ? Response.json({ workspaces: [workspace] }) : undefined);
  await assert.rejects(modelartsManagement.options!(session, "create"), /omitted the native total/);
});
test("ModelArts workspace catalog rejects rows without valid names", async t => {
  cloud(t, { workspaces: [{ id: "0", owner: "test-user" }] });
  await assert.rejects(modelartsManagement.options!(session, "create"), /without a valid name/);
});
test("ModelArts image catalog verifies the native workspace filter independently", async t => {
  cloud(t, { imagesByWorkspace: { "0": [{ ...image, workspace_id: "ws-9" }] } });
  await assert.rejects(modelartsManagement.options!(session, "create"), /outside its requested workspace/);
});
test("ModelArts image catalog requires the native total", async t => {
  cloud(t, {}, url => url.pathname.endsWith("/images") ? Response.json({ data: [image] }) : undefined);
  await assert.rejects(modelartsManagement.options!(session, "create"), /omitted the native total/);
});
test("ModelArts flavor catalog requires a native array", async t => {
  cloud(t, {}, url => url.pathname.endsWith("/flavors") ? Response.json({}) : undefined);
  await assert.rejects(modelartsManagement.options!(session, "create"), /no native notebook flavor catalog/);
});
test("ModelArts form contract enforces native name, description, timer and storage bounds", () => {
  const create = modelartsManagement.operations.find(operation => operation.id === "create")!;
  const sources = { workspaces: [{ value: "0", label: "default" }], flavors: [{ value: flavor.id, label: "CPU" }], images: [{ value: image.id, label: "pytorch" }] };
  const values = { name: "research", workspace: "0", flavor: flavor.id, image: image.id, storageSize: 50 };
  assert.doesNotThrow(() => validateManagementValues(create, values, sources));
  assert.throws(() => validateManagementValues(create, { ...values, name: "bad name" }, sources), /invalid format/);
  assert.throws(() => validateManagementValues(create, { ...values, description: "<script>" }, sources), /invalid format/);
  assert.throws(() => validateManagementValues(create, { ...values, storageSize: 4 }, sources), /at least 5/);
  assert.throws(() => validateManagementValues(create, { ...values, storageSize: 4097 }, sources), /no more than 4096/);
  assert.throws(() => validateManagementValues(create, { ...values, flavor: "foreign" }, sources), /not available/);
  const start = modelartsManagement.operations.find(operation => operation.id === "start")!;
  assert.throws(() => validateManagementValues(start, { autoStopHours: 0 }), /at least 1/);
  assert.throws(() => validateManagementValues(start, { autoStopHours: 73 }), /no more than 72/);
});
test("ModelArts operations declare cost and data impacts and invalidate the notebook and summary caches", () => {
  const create = modelartsManagement.operations.find(operation => operation.id === "create")!;
  const deleteOperation = modelartsManagement.operations.find(operation => operation.id === "delete")!;
  const stop = modelartsManagement.operations.find(operation => operation.id === "stop")!;
  assert.match(create.impact!, /pay-per-use/);
  assert.equal(deleteOperation.confirmation, true); assert.match(deleteOperation.impact!, /permanently deleted/);
  assert.match(stop.impact!, /EVS storage charges continue/);
  assert.deepEqual(modelartsManagement.invalidationKeys(), [cloudCacheKeys.listModelArtsNotebooks, cloudCacheKeys.summary]);
});

for (const field of ["status", "feature", "name"]) test(`ModelArts deletion never falls back to stale inventory ${field}`, async t => {
  const incomplete: Record<string, unknown> = { ...notebook }; delete incomplete[field];
  const writes = cloud(t, {}, (url, init) => !init.method && url.pathname.endsWith("/notebooks/notebook-1") ? Response.json(incomplete) : undefined);
  await assert.rejects(modelartsManagement.execute(session, "delete", {}, resource)); assert.equal(writes.length, 0);
});
for (const location of ["list", "detail", "ack", "poll"]) test(`ModelArts rejects native foreign project on ${location}`, async t => {
  const writes = cloud(t, {}, (url, init) => {
    if (location === "list" && url.pathname.endsWith("/notebooks/all")) return Response.json({ data: [{ ...notebook, project_id: "foreign" }], total: 1 });
    if (location === "ack" && init.method === "POST") return Response.json({ ...notebook, projectId: null });
    if ((location === "detail" || location === "poll") && !init.method && url.pathname.endsWith("/notebooks/notebook-1")) return Response.json({ ...notebook, project_id: "" });
    return undefined;
  });
  if (location === "list") await assert.rejects(modelartsManagement.inventory(session), /project scope/);
  else if (location === "poll") await assert.rejects(modelartsManagement.poll!(session, entry("Create notebook")), /invalid ModelArts response/);
  else await assert.rejects(modelartsManagement.execute(session, "stop", {}, resource), /project scope/);
  assert.equal(writes.length, 0);
});
test("ModelArts validates required totals and arrays on later pages", async t => {
  cloud(t, {}, url => url.pathname.endsWith("/notebooks/all") ? Response.json(url.searchParams.get("offset") === "0" ? { data: [notebook], total: 2 } : { data: [{ ...notebook, id: "notebook-2" }] }) : undefined);
  await assert.rejects(modelartsManagement.inventory(session), /native total/);
});
test("ModelArts rejects native HTTP-200 business failures on reads and polling", async t => {
  cloud(t, {}, url => url.pathname.endsWith("/notebooks/notebook-1") ? Response.json({ ...notebook, error_code: "MA.1", error_msg: "PRIVATE_NATIVE_DETAILS" }) : undefined);
  await assert.rejects(modelartsManagement.execute(session, "inspect", {}, resource), error => error instanceof Error && !error.message.includes("PRIVATE_NATIVE_DETAILS"));
  await assert.rejects(modelartsManagement.poll!(session, entry("Create notebook")), error => error instanceof Error && !error.message.includes("PRIVATE_NATIVE_DETAILS"));
});
test("ModelArts native string EVS limits are usable and unsupported expansion sites block writes", async t => {
  const writes = cloud(t, { notebook: { ...notebook, status: "STOPPED" }, flavors: [{ ...flavor, grow_support_type: "NATIONAL" }] });
  assert.equal((await modelartsManagement.options!(session, "create")).flavors[0].value, flavor.id);
  await assert.rejects(modelartsManagement.execute(session, "expand-storage", { storageNewSize: 100 }, stoppedResource), /international site/); assert.equal(writes.length, 0);
});
test("ModelArts unknown architectures and incompatible resource categories never match", async t => {
  const writes = cloud(t, { flavors: [{ ...flavor, arch: "PRIVATE_ARCH" }], images: [{ ...image, arch: "PRIVATE_ARCH" }] });
  await assert.rejects(modelartsManagement.execute(session, "create", { name: "research", workspace: "0", flavor: flavor.id, image: image.id, storageSize: 50 }), /architecture/); assert.equal(writes.length, 0);
});
test("ModelArts image choices exclude custom and unfinished images", async t => {
  cloud(t, { images: [image, { ...image, id: "saved", type: "DEDICATED", status: "ACTIVE" }, { ...image, id: "pending", status: "CREATING" }] });
  assert.deepEqual((await modelartsManagement.options!(session, "create")).images.map(row => row.value), [image.id]);
});
test("ModelArts deletion blocks additional data volumes before writing", async t => {
  const writes = cloud(t, { notebook: { ...notebook, data_volumes: [{ category: "EVS", capacity: 100 }] } });
  await assert.rejects(modelartsManagement.execute(session, "delete", {}, resource), /additional data volumes/); assert.equal(writes.length, 0);
});
test("ModelArts polling requires both original job and resource identities", async t => {
  cloud(t); await assert.rejects(modelartsManagement.poll!(session, { ...entry("Delete notebook"), jobId: undefined }), /original notebook identity/);
});

test("ModelArts malformed dedicated-pool metadata never becomes a public-pool write", async t => {
 const writes = cloud(t, { notebook: { ...notebook, pool: {} } });
 await assert.rejects(modelartsManagement.execute(session, "delete", {}, resource), /pool could not be verified/); assert.equal(writes.length, 0);
});

test("ModelArts metadata observers retain fingerprints and wait for fresh configuration", async t => {
 let current: Record<string, unknown> = { ...notebook };
 cloud(t, {}, (url, init) => !init.method && url.pathname.endsWith("/notebooks/notebook-1") ? Response.json(current) : undefined);
 const desired = "PRIVATE_NOTEBOOK_DESCRIPTION";
 const result = await modelartsManagement.execute(session, "update", { description: desired }, resource);
 assert.equal(result.asynchronous, true); assert.equal(result.jobId, notebook.id);
 assert.ok(!JSON.stringify(result.verification).includes(desired));
 const saved = { ...entry("Rename or edit description"), verification: result.verification };
 assert.equal((await modelartsManagement.poll!(session, saved)).state, "submitted");
 current = { ...current, description: desired };
 assert.equal((await modelartsManagement.poll!(session, saved)).state, "succeeded");
 await assert.rejects(modelartsManagement.poll!(session, { ...saved, verification: { fields: ["token"], digest: result.verification!.digest } }), /observer/);
});
test("ModelArts image and capacity observers verify the exact accepted targets", async t => {
 let current: Record<string, unknown> = { ...notebook, status: "STOPPED" };
 cloud(t, { images: [image, { ...image, id: "image-2" }] }, (url, init) => !init.method && url.pathname.endsWith("/notebooks/notebook-1") ? Response.json(current) : undefined);
 const imageChange = await modelartsManagement.execute(session, "change-image", { image: "image-2" }, stoppedResource);
 const diskChange = await modelartsManagement.execute(session, "expand-storage", { storageNewSize: 100 }, stoppedResource);
 const imageEntry = { ...entry("Switch image"), verification: imageChange.verification }, diskEntry = { ...entry("Expand EVS storage"), verification: diskChange.verification };
 assert.equal((await modelartsManagement.poll!(session, imageEntry)).state, "submitted"); assert.equal((await modelartsManagement.poll!(session, diskEntry)).state, "submitted");
 current = { ...current, image: { ...image, id: "image-2" }, volume: { category: "EVS", capacity: 100 } };
 assert.equal((await modelartsManagement.poll!(session, imageEntry)).state, "succeeded"); assert.equal((await modelartsManagement.poll!(session, diskEntry)).state, "succeeded");
 current = { ...current, volume: { category: "EVS" } }; assert.equal((await modelartsManagement.poll!(session, diskEntry)).state, "submitted");
});
