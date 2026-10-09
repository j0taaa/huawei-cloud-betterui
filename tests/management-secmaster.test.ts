import assert from "node:assert/strict";
import { test } from "node:test";
import { secmasterManagement } from "@/lib/huawei/management/adapters/secmaster";
import { validateManagementValues, type ManagementResource } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const resource: ManagementResource = { id: "workspace-1", name: "security" };
const workspace = { id: resource.id, name: resource.name, project_id: session.projectId, region_id: session.region, is_view: false };
const space = { dataspace_id: "space-1", dataspace_name: "events", dataspace_type: "user-defined", project_id: session.projectId };
const pipe = { pipe_id: "pipe-1", pipe_name: "audit", pipe_type: "user-defined", dataspace_id: space.dataspace_id, project_id: session.projectId, storage_period: 30, shards: 1 };
test("SecMaster creates region-scoped regular workspaces without purchasing an edition", async t => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.equal(new URL(input).pathname, "/v1/project-1/workspaces"); assert.equal(init.method, "POST");
    sent = JSON.parse(String(init.body)); return Response.json({ id: "new-workspace" });
  });
  const result = await secmasterManagement.execute(session, "create", { name: "security", enterpriseProjectId: "0" });
  assert.deepEqual(sent, { name: "security", description: "", region_id: session.region, project_name: session.projectName, is_view: false, enterprise_project_id: "0" });
  assert.equal(result.resourceId, "new-workspace"); assert.equal(result.asynchronous, true);
});
test("SecMaster workspace views revalidate their regular workspace binding", async t => {
  let changedToView = false; let writes = 0; let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; sent = JSON.parse(String(init.body)); return Response.json({ id: "view-1" }); }
    return Response.json(new URL(input).pathname.endsWith("/workspaces") ? { workspaces: [workspace], total_count: 1 } : { workspace: { ...workspace, is_view: changedToView } });
  });
  changedToView = true;
  await assert.rejects(secmasterManagement.execute(session, "create-view", { name: "view", workspace: resource.id }), /now a view/);
  assert.equal(writes, 0); changedToView = false;
  await secmasterManagement.execute(session, "create-view", { name: "view", workspace: resource.id });
  assert.deepEqual(sent, { name: "view", description: "", region_id: session.region, project_name: session.projectName, is_view: true, view_bind_id: resource.id });
});
test("SecMaster refuses foreign project or region workspace details before mutation", async t => {
  let wrong: Record<string, unknown> = { project_id: "foreign" }; let writes = 0;
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => { if (init.method) writes++; return Response.json({ workspace: { ...workspace, ...wrong } }); });
  await assert.rejects(secmasterManagement.execute(session, "update", { name: "renamed" }, resource), /could not be verified/);
  wrong = { region_id: "foreign" }; await assert.rejects(secmasterManagement.execute(session, "delete", {}, resource), /could not be verified/);
  assert.equal(writes, 0);
});
test("SecMaster updates only workspace metadata and defaults to non-permanent deletion", async t => {
  const writes: { url: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json({ workspace }); writes.push({ url: input, method: init.method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) }); return new Response(null, { status: 204 }); });
  await secmasterManagement.execute(session, "update", { name: "renamed", description: "" }, resource);
  assert.deepEqual(writes[0].body, { name: "renamed", description: "" }); assert.equal(writes[0].method, "PUT");
  const result = await secmasterManagement.execute(session, "delete", {}, resource);
  assert.equal(new URL(writes[1].url).searchParams.get("permanent_delete"), "false"); assert.equal(result.asynchronous, true);
  await secmasterManagement.execute(session, "delete", { permanent: true }, resource);
  assert.equal(new URL(writes[2].url).searchParams.get("permanent_delete"), "true");
});
test("SecMaster views cannot create or mutate SIEM data", async t => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => { if (init.method) writes++; return Response.json({ workspace: { ...workspace, is_view: true } }); });
  await assert.rejects(secmasterManagement.execute(session, "create-space", { name: "data" }, resource), /regular workspace/);
  assert.equal(writes, 0);
});
test("SecMaster paginates child resources and excludes foreign project resources", async t => {
  const offsets: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const offset = new URL(input).searchParams.get("offset")!; offsets.push(offset);
    return Response.json({ count: 101, records: offset === "0" ? Array.from({ length: 100 }, (_, i) => ({ ...space, dataspace_id: `space-${i}` })) : [{ ...space, dataspace_id: "foreign", project_id: "other" }] });
  });
  const choices = await secmasterManagement.options!(session, "delete-space", resource);
  assert.deepEqual(offsets, ["0", "100"]); assert.equal(choices.spaces.length, 100); assert.ok(!choices.spaces.some(s => s.value === "foreign"));
});
test("SecMaster protects system and nonempty spaces, and revalidates child membership", async t => {
  let current = { ...space }; let pipes = [pipe]; let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return new Response(null, { status: 204 }); }
    const url = new URL(input);
    if (url.pathname.endsWith("/workspace-1")) return Response.json({ workspace });
    return Response.json({ records: url.pathname.endsWith("/dataspaces") ? [current] : pipes, count: url.pathname.endsWith("/dataspaces") ? 1 : pipes.length });
  });
  await assert.rejects(secmasterManagement.execute(session, "delete-space", { space: "foreign" }, resource), /not found/);
  current = { ...space, dataspace_type: "system-defined" }; await assert.rejects(secmasterManagement.execute(session, "delete-space", { space: space.dataspace_id }, resource), /System-defined/);
  current = { ...space }; await assert.rejects(secmasterManagement.execute(session, "delete-space", { space: space.dataspace_id }, resource), /every data pipe/);
  assert.equal(writes, 0); pipes = []; await secmasterManagement.execute(session, "delete-space", { space: space.dataspace_id }, resource); assert.equal(writes, 1);
});
test("SecMaster validates native pipe names and sends typed storage configuration", async t => {
  const operation = secmasterManagement.operations.find(op => op.id === "create-pipe")!;
  const choices = { spaces: [{ value: space.dataspace_id, label: "events" }] };
  for (const name of ["sec_custom", "double__underscore", "trailing_", "Upper", "2bad"]) assert.throws(() => validateManagementValues(operation, { name, space: space.dataspace_id, shards: 1, retention: 30 }, choices), /format/);
  const values = validateManagementValues(operation, { name: "a", space: space.dataspace_id, shards: 2, retention: 30, timestamp: "event_time" }, choices);
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (init.method) { sent = JSON.parse(String(init.body)); return Response.json({ pipe_id: "new-pipe" }); } return Response.json(new URL(input).pathname.endsWith("/workspace-1") ? { workspace } : { count: 1, records: [space] }); });
  const result = await secmasterManagement.execute(session, "create-pipe", values, resource);
  assert.deepEqual(sent, { dataspace_id: space.dataspace_id, pipe_name: "a", description: "", shards: 2, storage_period: 30, timestamp_field: "event_time" }); assert.equal(result.asynchronous, true);
});
test("SecMaster protects system pipes and changes retention without overwriting partitions", async t => {
  let current = { ...pipe }; let sent: unknown; let method = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { sent = JSON.parse(String(init.body)); method = init.method; return new Response(null, { status: 204 }); }
    return Response.json(new URL(input).pathname.endsWith("/workspace-1") ? { workspace } : { count: 1, records: [current] });
  });
  current = { ...pipe, pipe_type: "system-defined" }; await assert.rejects(secmasterManagement.execute(session, "pipe-retention", { pipe: pipe.pipe_id, retention: 60 }, resource), /System-defined/); assert.equal(sent, undefined);
  current = { ...pipe }; await secmasterManagement.execute(session, "pipe-retention", { pipe: pipe.pipe_id, retention: 60 }, resource);
  assert.equal(method, "PUT"); assert.deepEqual(sent, { storage_period: 60 });
});
