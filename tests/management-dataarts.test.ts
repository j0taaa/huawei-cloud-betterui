import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { dataartsManagement } from "@/lib/huawei/management/adapters/dataarts";
import { listDataArtsInstancesForProject } from "@/lib/huawei/services/dataarts";
import type { ManagementHistoryEntry } from "@/lib/management-contract";
import { project, session } from "./fixtures/session";

// Native ListDataArtsStudioInstancesResponse rows are ApigCommodityOrder objects on the
// commodity_orders array, not an instances[] array.
const instanceOrder = { resource_id: "instance-1", resource_name: "studio", project_id: "project-1", region_id: "sa-brazil-1", domain_id: "domain-1", resource_spec_code: "dayu.basic", charge_type: "postPaid", status: 2, create_time: 1767225600000, eps_id: "0", order_id: "order-900" };
const defaultWorkspace = { id: "ws-1", name: "default-space", is_default: 1, member_num: 4, eps_id: "0", description: "system default", owner_name: "test-user", project_id: "project-1", instance_id: "instance-1", domain_id: "domain-1", create_time: 1767225600000, update_time: 1767225601000 };
const devWorkspace = { id: "ws-2", name: "dev", is_default: 0, member_num: 3, eps_id: "0", description: "development", owner_name: "test-user", project_id: "project-1", instance_id: "instance-1", domain_id: "domain-1", create_time: 1767225600000, update_time: 1767225601000, bad_record_location_name: "obs://bucket/bad", job_log_location_name: "obs://bucket/logs" };
const privateWorkspace = { id: "ws-3", name: "sandbox", is_default: 0, member_num: 1, eps_id: "0", description: "", owner_name: "test-user", project_id: "project-1", instance_id: "instance-1", domain_id: "domain-1" };
const job = { name: "etl-orders", job_type: "BATCH", status: "STOPPED", owner: "test-user", last_instance_status: "fail", path: "/etl/" };
const failedInstance = { instance_id: 123, job_id: 456, plan_time: 1767225600000, submit_time: 1767225600001, status: "fail", job_name: "etl-orders", job_instance_name: "etl-orders_20260101", start_time: 1767225600002, end_time: 1767225660000, execute_time: 59998, version: 1, instance_type: 0 };

type Fixture = { instances?: Record<string, unknown>[]; workspaces?: Record<string, unknown>[]; jobsByWorkspace?: Record<string, Record<string, unknown>[]>; jobInstances?: Record<string, unknown>[]; enterpriseProjects?: Record<string, unknown>[] };
type Write = { path: string; method: string; body?: unknown; workspace: string };

function cloud(t: TestContext, fixture: Fixture = {}, override?: (url: URL, init: RequestInit) => Response | undefined) {
  const writes: Write[] = [];
  const reads: { path: string; workspace: string }[] = [];
  const calls: { kind: "read" | "write"; path: string }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const workspace = headers.get("workspace") ?? "";
    assert.equal(headers.get("X-Auth-Token"), url.pathname === "/v1.0/enterprise-projects" ? "account-token" : session.token);
    if (init.method) {
      writes.push({ path: url.pathname, method: init.method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}), workspace });
      calls.push({ kind: "write", path: url.pathname });
      return override?.(url, init) ?? Response.json(url.pathname.startsWith("/v1/project-1/workspaces/") ? { is_success: true, message: "accepted" } : {});
    }
    reads.push({ path: url.pathname + url.search, workspace });
    calls.push({ kind: "read", path: url.pathname + url.search });
    const own = override?.(url, init);
    if (own) return own;
    if (url.pathname === "/v1.0/enterprise-projects") {
      const rows = fixture.enterpriseProjects ?? [{ id: "0", name: "default", status: 1, type: "prod", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }];
      return Response.json({ total_count: rows.length, enterprise_projects: rows.map(row => ({ ...row })) });
    }
    if (url.pathname === "/v1/project-1/instances") {
      const rows = fixture.instances ?? [instanceOrder];
      return Response.json({ billing_check: true, count: rows.length, commodity_orders: rows.map(row => ({ ...row })) });
    }
    if (url.pathname.startsWith("/v1/project-1/workspaces/")) {
      const rows = fixture.workspaces ?? [defaultWorkspace, devWorkspace];
      return Response.json({ count: rows.length, total_page: 1, data: rows.map(row => ({ ...row })) });
    }
    if (url.pathname === "/v2/project-1/factory/jobs") {
      const rows = fixture.jobsByWorkspace?.[workspace] ?? (workspace === "ws-2" ? [job] : []);
      return Response.json({ total: rows.length, jobs: rows.map(row => ({ ...row })) });
    }
    if (url.pathname === "/v2/project-1/factory/jobs/etl-orders/instances/detail") {
      const rows = fixture.jobInstances ?? [failedInstance];
      return Response.json({ total: rows.length, instances: rows.map(row => ({ ...row })) });
    }
    throw new Error(`Unexpected DataArts request ${url}`);
  });
  return { writes, reads, calls };
}

const instanceResource = { id: "instance:instance-1", name: "studio" };
const workspaceResource = (id: string, name: string) => ({ id: `workspace:instance-1:${id}`, name });
const jobResource = { id: "job:instance-1:ws-2:etl-orders", name: "etl-orders" };
const pendingDelete = (overrides: Partial<ManagementHistoryEntry> = {}): ManagementHistoryEntry => ({ id: "11111111-1111-4111-8111-111111111111", service: "dataarts", operation: "Delete private workspace", resourceId: "workspace:instance-1:ws-3", startedAt: "2026-01-01T00:00:00Z", state: "submitted", jobId: "workspace-observer:ws-3", ...overrides });

test("DataArts instance service maps the native commodity-order wire honestly", async t => {
  cloud(t);
  const rows = await listDataArtsInstancesForProject(project);
  assert.deepEqual(rows, [{
    chargingMode: "Unknown", createdAt: "2026-01-01T00:00:00.000Z", domainId: "domain-1", edition: "dayu.basic", epsId: "0",
    id: "instance-1", name: "studio", orderId: "order-900", projectId: "project-1", projectName: "sa-brazil-1_team",
    region: "sa-brazil-1", status: "in effect", version: "-", workspaceCount: null,
  }]);
});

test("DataArts instance service maps native status integers and reports unknown values", async t => {
  const orders = [1, 2, 3, 4, 5, 6, 9, "2"].map((status, index) => ({ ...instanceOrder, resource_id: `instance-${index}`, resource_name: `studio-${index}`, status }));
  cloud(t, { instances: orders });
  const rows = await listDataArtsInstancesForProject(project);
  assert.deepEqual(rows.map(row => row.status), ["not effective", "in effect", "deleted", "frozen", "grace", "deleting", "UNKNOWN", "UNKNOWN"]);
});

test("DataArts instance service paginates strictly on the native count of every page", async t => {
  const offsets: string[] = [];
  cloud(t, {}, url => {
    if (url.pathname !== "/v1/project-1/instances") return undefined;
    offsets.push(url.searchParams.get("offset")!);
    return offsets.length === 1
      ? Response.json({ billing_check: true, count: 2, commodity_orders: [instanceOrder] })
      : Response.json({ billing_check: true, count: 2, commodity_orders: [{ ...instanceOrder, resource_id: "instance-2", resource_name: "studio-2" }] });
  });
  const rows = await listDataArtsInstancesForProject(project);
  assert.deepEqual(offsets, ["0", "1"]);
  assert.deepEqual(rows.map(row => row.id), ["instance-1", "instance-2"]);
});

test("DataArts instance service rejects an unstable native count across pages", async t => {
  const offsets: string[] = [];
  cloud(t, {}, url => {
    if (url.pathname !== "/v1/project-1/instances") return undefined;
    offsets.push(url.searchParams.get("offset")!);
    return offsets.length === 1
      ? Response.json({ billing_check: true, count: 2, commodity_orders: [instanceOrder] })
      : Response.json({ billing_check: true, count: 3, commodity_orders: [{ ...instanceOrder, resource_id: "instance-2", resource_name: "studio-2" }] });
  });
  await assert.rejects(listDataArtsInstancesForProject(project), /unstable/);
  assert.deepEqual(offsets, ["0", "1"]);
});

test("DataArts instance service rejects a page without its native array or integer count", async t => {
  cloud(t, {}, url => url.pathname === "/v1/project-1/instances" ? Response.json({ billing_check: true, count: 1 }) : undefined);
  await assert.rejects(listDataArtsInstancesForProject(project), /without its native array/);
  cloud(t, {}, url => url.pathname === "/v1/project-1/instances" ? Response.json({ billing_check: true, commodity_orders: [instanceOrder] }) : undefined);
  await assert.rejects(listDataArtsInstancesForProject(project), /native total/);
  cloud(t, {}, url => url.pathname === "/v1/project-1/instances" ? Response.json({ billing_check: true, count: "1", commodity_orders: [instanceOrder] }) : undefined);
  await assert.rejects(listDataArtsInstancesForProject(project), /native total/);
});

test("DataArts instance service rejects truncated and oversized native pagination", async t => {
  const offsets: string[] = [];
  cloud(t, {}, url => {
    if (url.pathname !== "/v1/project-1/instances") return undefined;
    offsets.push(url.searchParams.get("offset")!);
    return offsets.length === 1
      ? Response.json({ billing_check: true, count: 2, commodity_orders: [instanceOrder] })
      : Response.json({ billing_check: true, count: 2, commodity_orders: [] });
  });
  await assert.rejects(listDataArtsInstancesForProject(project), /ended DataArts Studio instance list pagination/);
  assert.deepEqual(offsets, ["0", "1"]);
  cloud(t, {}, url => url.pathname === "/v1/project-1/instances" ? Response.json({ billing_check: true, count: 1, commodity_orders: [instanceOrder, { ...instanceOrder, resource_id: "instance-2", resource_name: "studio-2" }] }) : undefined);
  await assert.rejects(listDataArtsInstancesForProject(project), /more DataArts Studio instance list rows/);
});

test("DataArts instance service rejects duplicate or missing native IDs and names", async t => {
  cloud(t, { instances: [{ ...instanceOrder, resource_id: "" }] });
  await assert.rejects(listDataArtsInstancesForProject(project), /without a valid native ID/);
  cloud(t, { instances: [instanceOrder, { ...instanceOrder, resource_name: "studio" }] });
  await assert.rejects(listDataArtsInstancesForProject(project), /duplicate native IDs/);
  cloud(t, { instances: [{ ...instanceOrder, resource_name: "" }] });
  await assert.rejects(listDataArtsInstancesForProject(project), /without a valid name/);
});

test("DataArts instance service enforces exact native project and region scope", async t => {
  cloud(t, { instances: [{ ...instanceOrder, project_id: "other-project" }] });
  await assert.rejects(listDataArtsInstancesForProject(project), /project scope/);
  cloud(t, { instances: [{ ...instanceOrder, region_id: "other-region" }] });
  await assert.rejects(listDataArtsInstancesForProject(project), /region scope/);
  cloud(t, { instances: [{ ...instanceOrder, project_id: null }] });
  await assert.rejects(listDataArtsInstancesForProject(project), /project scope/);
});

test("DataArts inventory keeps project/instance/workspace-scoped IDs and native values", async t => {
  cloud(t);
  const rows = await dataartsManagement.inventory(session);
  assert.deepEqual(rows.map(row => [row.id, row.name]), [
    ["instance:instance-1", "studio"],
    ["workspace:instance-1:ws-1", "default-space"],
    ["workspace:instance-1:ws-2", "dev"],
    ["job:instance-1:ws-2:etl-orders", "etl-orders"],
  ]);
  assert.equal(rows[0].status, "in effect");
  assert.deepEqual(rows[0].values, { edition: "dayu.basic", version: "-", chargingMode: "Unknown" });
  assert.deepEqual(rows[1].values, { description: "system default", spaceKind: 1, epsId: "0", memberCount: 4 });
  assert.deepEqual(rows[2].values, { description: "development", spaceKind: 0, epsId: "0", memberCount: 3 });
  assert.equal(rows[3].status, "STOPPED");
  assert.deepEqual(rows[3].values, { jobType: "BATCH", owner: "test-user", lastInstanceStatus: "fail" });
});

test("DataArts workspace inventory paginates with the native offset and count on every page", async t => {
  const offsets: string[] = [];
  cloud(t, {}, url => {
    if (!url.pathname.startsWith("/v1/project-1/workspaces/")) return undefined;
    offsets.push(url.searchParams.get("offset")!);
    return Response.json({ count: 2, total_page: 2, data: offsets.length === 1 ? [defaultWorkspace] : [devWorkspace] });
  });
  const rows = await dataartsManagement.inventory(session);
  assert.deepEqual(offsets, ["0", "1"]);
  assert.ok(rows.some(row => row.id === "workspace:instance-1:ws-1"));
  assert.ok(rows.some(row => row.id === "workspace:instance-1:ws-2"));
});

test("DataArts workspace inventory rejects truncated pagination against the native count", async t => {
  const offsets: string[] = [];
  cloud(t, {}, url => {
    if (!url.pathname.startsWith("/v1/project-1/workspaces/")) return undefined;
    offsets.push(url.searchParams.get("offset")!);
    return Response.json({ count: 2, total_page: 2, data: offsets.length === 1 ? [defaultWorkspace] : [] });
  });
  await assert.rejects(dataartsManagement.inventory(session), /ended DataArts workspace list pagination/);
  assert.deepEqual(offsets, ["0", "1"]);
});

test("DataArts inventory rejects missing native workspace and job totals", async t => {
  cloud(t, {}, url => url.pathname.startsWith("/v1/project-1/workspaces/") ? Response.json({ total_page: 1, data: [defaultWorkspace, devWorkspace] }) : undefined);
  await assert.rejects(dataartsManagement.inventory(session), /native total/);
  cloud(t, {}, url => url.pathname === "/v2/project-1/factory/jobs" ? Response.json({ jobs: [job] }) : undefined);
  await assert.rejects(dataartsManagement.inventory(session), /native total/);
});

test("DataArts inventory rejects malformed or duplicated native workspace IDs and job names", async t => {
  cloud(t, { workspaces: [{ ...devWorkspace, id: "" }] });
  await assert.rejects(dataartsManagement.inventory(session), /without a valid native ID/);
  cloud(t, { workspaces: [defaultWorkspace, { ...devWorkspace, id: "ws-1" }] });
  await assert.rejects(dataartsManagement.inventory(session), /duplicate native IDs/);
  cloud(t, { jobsByWorkspace: { "ws-2": [{ ...job, name: "" }] } });
  await assert.rejects(dataartsManagement.inventory(session), /without a valid native name/);
});

test("DataArts workspace scope echoes must be exact, present and well-formed", async t => {
  cloud(t, { workspaces: [{ ...defaultWorkspace, project_id: "other-project" }] });
  await assert.rejects(dataartsManagement.inventory(session), /project scope/);
  cloud(t, { workspaces: [{ ...defaultWorkspace, instance_id: "other-instance" }] });
  await assert.rejects(dataartsManagement.inventory(session), /different instance/);
  cloud(t, { workspaces: [{ ...defaultWorkspace, project_id: null }] });
  await assert.rejects(dataartsManagement.inventory(session), /project scope/);
  cloud(t, { workspaces: [{ ...defaultWorkspace, domain_id: null }] });
  await assert.rejects(dataartsManagement.inventory(session), /matching native domain echo/);
  const tolerated = cloud(t, { workspaces: [{ ...defaultWorkspace, domain_id: undefined }] });
  const rows = await dataartsManagement.inventory(session);
  assert.ok(rows.some(row => row.id === "workspace:instance-1:ws-1"));
  assert.equal(tolerated.writes.length, 0);
});

test("DataArts space type accepts only native integers and blocks deletion when unknown", async t => {
  const first = cloud(t, { workspaces: [{ ...devWorkspace, is_default: "0" }] });
  const rows = await dataartsManagement.inventory(session);
  assert.deepEqual(rows.find(row => row.id === "workspace:instance-1:ws-2")!.values, { description: "development", epsId: "0", memberCount: 3 });
  await assert.rejects(dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-2", "dev")), /could not be verified/);
  assert.equal(first.writes.length, 0);
  const second = cloud(t, { workspaces: [{ ...devWorkspace, is_default: true }] });
  await assert.rejects(dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-2", "dev")), /could not be verified/);
  assert.equal(second.writes.length, 0);
  const third = cloud(t, { workspaces: [{ ...devWorkspace, is_default: 2 }] });
  const rows3 = await dataartsManagement.inventory(session);
  assert.equal(rows3.find(row => row.id === "workspace:instance-1:ws-2")!.values!.spaceKind, 2);
  await assert.rejects(dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-2", "dev")), /protected/);
  assert.equal(third.writes.length, 0);
});

test("DataArts maps unknown native job, run and instance statuses to UNKNOWN", async t => {
  cloud(t, { jobsByWorkspace: { "ws-2": [{ ...job, status: "WEIRD", last_instance_status: "WEIRD-RUN" }] } });
  const rows = await dataartsManagement.inventory(session);
  const jobRow = rows.find(row => row.id === "job:instance-1:ws-2:etl-orders");
  assert.equal(jobRow!.status, "UNKNOWN");
  assert.equal(jobRow!.values!.lastInstanceStatus, "UNKNOWN");
  assert.equal(jobRow!.values!.jobType, "BATCH");
  cloud(t, { jobInstances: [{ ...failedInstance, status: "weird" }] });
  const outcome = await dataartsManagement.execute(session, "job-instances", {}, jobResource);
  assert.match(outcome.facts![0].label, /etl-orders_20260101 · UNKNOWN$/);
});

test("DataArts factory requests carry the native workspace header on every request", async t => {
  const { reads, writes } = cloud(t);
  await dataartsManagement.inventory(session);
  await dataartsManagement.options!(session, "retry-job", jobResource);
  await dataartsManagement.execute(session, "retry-job", { instance: "123", retryLocation: "errorNode", retryTaskVersion: "original_version" }, jobResource);
  assert.ok(reads.some(read => read.path === "/v2/project-1/factory/jobs?limit=100&offset=0" && read.workspace === "ws-2"));
  assert.ok(reads.some(read => read.path === "/v2/project-1/factory/jobs/etl-orders/instances/detail?limit=100&offset=0" && read.workspace === "ws-2"));
  assert.ok(reads.every(read => read.workspace === "" || read.path.startsWith("/v2/")));
  assert.equal(writes[0].workspace, "ws-2");
});

test("DataArts sanitizes network failures without leaking transport details", async t => {
  cloud(t, {}, () => { throw new TypeError("network-down PRIVATE"); });
  await assert.rejects(dataartsManagement.inventory(session), (error: Error) => {
    assert.equal(error.message, "The DataArts Studio request returned an unverifiable response or scope. Verify the current resource state before retrying.");
    return true;
  });
});

test("DataArts sanitizes non-JSON responses without echoing the body", async t => {
  cloud(t, {}, url => url.pathname === "/v1/project-1/instances" ? new Response("boom-private", { headers: { "content-type": "application/json" } }) : undefined);
  await assert.rejects(dataartsManagement.inventory(session), (error: Error) => {
    assert.match(error.message, /unverifiable response/);
    assert.ok(!error.message.includes("boom-private"));
    return true;
  });
});

test("DataArts sanitizes HTTP write failures without status codes or native payloads", async t => {
  cloud(t, {}, (url, init) => init.method === "POST" && url.pathname === "/v1/project-1/workspaces/instance-1" ? new Response(JSON.stringify({ error_msg: "PRIVATE-DETAIL" }), { status: 500 }) : undefined);
  await assert.rejects(dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "research", epsId: "0" }), (error: Error) => {
    assert.match(error.message, /could not be completed/);
    assert.ok(!error.message.includes("500"));
    assert.ok(!error.message.includes("PRIVATE-DETAIL"));
    return true;
  });
  cloud(t, {}, (url, init) => init.method === "POST" && url.pathname === "/v1/project-1/workspaces/instance-1" ? new Response(JSON.stringify({ error_msg: "PRIVATE-DETAIL" }), { status: 404 }) : undefined);
  await assert.rejects(dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "research", epsId: "0" }), (error: Error) => {
    assert.match(error.message, /rejected/);
    assert.ok(!error.message.includes("404"));
    assert.ok(!error.message.includes("PRIVATE-DETAIL"));
    return true;
  });
});

test("DataArts rejects a native HTTP 200 business error without echoing its details", async t => {
  cloud(t, {}, (url, init) => init.method === "POST" && url.pathname === "/v1/project-1/workspaces/instance-1" ? Response.json({ error_code: "DATAARTS.0001", error_msg: "PRIVATE-DETAIL" }) : undefined);
  await assert.rejects(dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "research", epsId: "0" }), (error: Error) => {
    assert.match(error.message, /business error/);
    assert.ok(!error.message.includes("PRIVATE-DETAIL"));
    return true;
  });
});

test("DataArts instance options come from the live native instance list", async t => {
  cloud(t);
  const options = await dataartsManagement.options!(session, "create-workspace");
  assert.deepEqual(options.instances, [{ value: "instance-1", label: "studio · dayu.basic · in effect" }]);
  assert.deepEqual(options.enterpriseProjects, [{ value: "0", label: "0 (default enterprise project, verified in use)" }]);
});

test("DataArts enterprise-project choices come from the account's active native EPS list", async t => {
  const accountSession = { ...session, accountToken: "account-token" };
  cloud(t, { enterpriseProjects: [
    { id: "0", name: "default", status: 1, type: "prod", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    { id: "eps-9", name: "team", status: 1, type: "prod", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    { id: "eps-off", name: "old", status: 2, type: "prod", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  ] });
  const options = await dataartsManagement.options!(accountSession, "create-workspace");
  assert.deepEqual(options.enterpriseProjects, [{ value: "0", label: "default · 0" }, { value: "eps-9", label: "team · eps-9" }]);
});

test("DataArts offers the default enterprise project only when the account actually has it", async t => {
  const accountSession = { ...session, accountToken: "account-token" };
  const { writes } = cloud(t, { enterpriseProjects: [{ id: "eps-9", name: "team", status: 1, type: "prod", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }] });
  const options = await dataartsManagement.options!(accountSession, "create-workspace");
  assert.deepEqual(options.enterpriseProjects, [{ value: "eps-9", label: "team · eps-9" }]);
  await assert.rejects(dataartsManagement.execute(accountSession, "create-workspace", { instance: "instance-1", name: "research", epsId: "0" }), /enterprise project is no longer available/);
  assert.equal(writes.length, 0);
});

test("DataArts falls back to enterprise projects verified in fresh native workspaces", async t => {
  cloud(t, { workspaces: [defaultWorkspace, { ...devWorkspace, eps_id: "eps-live" }] });
  const options = await dataartsManagement.options!(session, "create-workspace");
  assert.deepEqual(options.enterpriseProjects, [{ value: "0", label: "0 (default enterprise project, verified in use)" }, { value: "eps-live", label: "eps-live (verified in use)" }]);
});

test("DataArts workspace creation sends typed native fields and accepts for manual verification", async t => {
  const { writes, calls } = cloud(t);
  const result = await dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "research", description: "line of business", epsId: "0" });
  assert.deepEqual(writes, [{ path: "/v1/project-1/workspaces/instance-1", method: "POST", body: { name: "research", eps_id: "0", description: "line of business" }, workspace: "" }]);
  assert.equal(result.resourceId, "instance:instance-1");
  assert.equal(result.asynchronous, true);
  assert.equal(result.jobId, undefined);
  assert.match(result.message, /accepted/);
  assert.match(result.message, /verify/);
  // The empty native response acknowledges no workspace ID: nothing is read back to borrow one.
  assert.deepEqual(calls.at(-1), { kind: "write", path: "/v1/project-1/workspaces/instance-1" });
});

test("DataArts workspace creation re-verifies the fresh parent, name and enterprise project", async t => {
  const { writes } = cloud(t);
  await assert.rejects(dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "dev", epsId: "0" }), /already exists/);
  await assert.rejects(dataartsManagement.execute(session, "create-workspace", { instance: "foreign", name: "fresh", epsId: "0" }), /instance is no longer available/);
  await assert.rejects(dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "research", epsId: "eps-stale" }), /enterprise project is no longer available/);
  assert.equal(writes.length, 0);
});

test("DataArts instance inspection reports reviewed native fields and a live workspace count", async t => {
  cloud(t);
  const outcome = await dataartsManagement.execute(session, "inspect-instance", {}, instanceResource);
  assert.deepEqual(outcome.facts, [
    { label: "Instance", value: "studio" },
    { label: "Edition", value: "dayu.basic" },
    { label: "Version", value: "-" },
    { label: "Status", value: "in effect" },
    { label: "Charging mode", value: "Unknown" },
    { label: "Workspaces", value: "2" },
    { label: "Created", value: "2026-01-01T00:00:00.000Z" },
    { label: "Enterprise project", value: "0" },
    { label: "Order", value: "order-900" },
  ]);
});

test("DataArts workspace inspection reports the native space type and OBS locations", async t => {
  cloud(t);
  const outcome = await dataartsManagement.execute(session, "inspect-workspace", {}, workspaceResource("ws-2", "dev"));
  assert.deepEqual(outcome.facts, [
    { label: "Workspace", value: "dev" },
    { label: "Space type", value: "Private" },
    { label: "Description", value: "development" },
    { label: "Owner", value: "test-user" },
    { label: "Members", value: "3" },
    { label: "Enterprise project", value: "0" },
    { label: "Bad-data OBS location", value: "obs://bucket/bad" },
    { label: "Job log OBS location", value: "obs://bucket/logs" },
    { label: "Created", value: "2026-01-01T00:00:00.000Z" },
    { label: "Updated", value: "2026-01-01T00:00:01.000Z" },
  ]);
});

test("DataArts job listing shows native job statuses per workspace", async t => {
  cloud(t);
  const outcome = await dataartsManagement.execute(session, "jobs", {}, workspaceResource("ws-2", "dev"));
  assert.match(outcome.message, /1 development job/);
  assert.deepEqual(outcome.facts, [{ label: "etl-orders · BATCH", value: "Status STOPPED · last run fail" }]);
});

test("DataArts job instance listing reports native run coordinates", async t => {
  cloud(t);
  const outcome = await dataartsManagement.execute(session, "job-instances", {}, jobResource);
  assert.match(outcome.message, /1 recent run instance/);
  assert.deepEqual(outcome.facts, [{ label: "etl-orders_20260101 · fail", value: "Instance 123 · planned 2026-01-01T00:00:00.000Z · submitted 2026-01-01T00:00:00.001Z · took 59998 ms" }]);
});

test("DataArts failed-instance options only include failed runs of the selected job", async t => {
  cloud(t, { jobInstances: [failedInstance, { ...failedInstance, instance_id: 124, status: "success" }] });
  const options = await dataartsManagement.options!(session, "retry-job", jobResource);
  assert.deepEqual(options.failedInstances, [{ value: "123", label: "Instance 123 · failed run planned 2026-01-01T00:00:00.000Z" }]);
});

test("DataArts deletes a private workspace even when it still holds development jobs", async t => {
  const fixture: Fixture = { workspaces: [defaultWorkspace, devWorkspace] };
  const { writes } = cloud(t, fixture, (url, init) => {
    if (init.method === "POST" && url.pathname === "/v1/project-1/instance-1/workspaces/batch-delete") {
      fixture.workspaces = fixture.workspaces!.filter(row => row.id !== "ws-2");
      return Response.json({ is_success: true });
    }
    return undefined;
  });
  const result = await dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-2", "dev"));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { workspace_ids: ["ws-2"] });
  assert.match(result.message, /deleted/);
});

test("DataArts workspace deletion protects default spaces and stale or unverifiable selections", async t => {
  const first = cloud(t);
  await assert.rejects(dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-1", "default-space")), /protected/);
  await assert.rejects(dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-2", "old-name")), /renamed or replaced/);
  assert.equal(first.writes.length, 0);
  const second = cloud(t, { workspaces: [{ ...privateWorkspace, is_default: undefined }] });
  await assert.rejects(dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-3", "sandbox")), /could not be verified/);
  assert.equal(second.writes.length, 0);
});

test("DataArts workspace deletion proves convergence with a fresh list and keeps the original ID", async t => {
  const fixture: Fixture = { workspaces: [defaultWorkspace, devWorkspace, { ...privateWorkspace }] };
  const { writes } = cloud(t, fixture, (url, init) => {
    if (init.method === "POST" && url.pathname === "/v1/project-1/instance-1/workspaces/batch-delete") {
      fixture.workspaces = fixture.workspaces!.filter(row => row.id !== "ws-3");
      return Response.json({ is_success: true, message: "PRIVATE-INTERNAL-NOTE" });
    }
    return undefined;
  });
  const result = await dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-3", "sandbox"));
  assert.deepEqual(writes, [{ path: "/v1/project-1/instance-1/workspaces/batch-delete", method: "POST", body: { workspace_ids: ["ws-3"] }, workspace: "" }]);
  assert.equal(result.resourceId, "workspace:instance-1:ws-3");
  assert.equal(result.asynchronous, undefined);
  assert.match(result.message, /deleted/);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-INTERNAL-NOTE"));
});

test("DataArts deletion stays observable when the workspace is still listed", async t => {
  cloud(t, { workspaces: [defaultWorkspace, devWorkspace, { ...privateWorkspace }] }, (url, init) => init.method === "POST" ? Response.json({ is_success: true, message: "PRIVATE-INTERNAL-NOTE" }) : undefined);
  const result = await dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-3", "sandbox"));
  assert.equal(result.asynchronous, true);
  assert.equal(result.jobId, "workspace-observer:ws-3");
  assert.equal(result.resourceId, "workspace:instance-1:ws-3");
  assert.match(result.message, /still listed/);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-INTERNAL-NOTE"));
});

test("DataArts deletion rejects rejected and unconfirmed native acknowledgements", async t => {
  const acknowledged: Record<string, unknown> = { is_success: true };
  cloud(t, { workspaces: [defaultWorkspace, devWorkspace, { ...privateWorkspace }] }, (url, init) => init.method === "POST" ? Response.json(acknowledged) : undefined);
  acknowledged.is_success = false;
  await assert.rejects(dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-3", "sandbox")), /rejected/);
  delete acknowledged.is_success;
  await assert.rejects(dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-3", "sandbox")), /no verifiable confirmation/);
});

test("DataArts deletion polling is whitelisted to the original workspace identifier", async t => {
  cloud(t, { workspaces: [defaultWorkspace, devWorkspace, { ...privateWorkspace }] });
  assert.deepEqual(await dataartsManagement.poll!(session, pendingDelete()), { state: "submitted", message: "The workspace is still listed; the deletion has not completed yet." });
  cloud(t, { workspaces: [defaultWorkspace, devWorkspace] });
  assert.deepEqual(await dataartsManagement.poll!(session, pendingDelete()), { state: "succeeded", message: "Private workspace deleted.", resourceId: "workspace:instance-1:ws-3" });
  cloud(t, { instances: [] });
  assert.deepEqual(await dataartsManagement.poll!(session, pendingDelete()), { state: "succeeded", message: "The workspace's instance no longer exists, so the workspace is gone as well." });
  cloud(t);
  await assert.rejects(dataartsManagement.poll!(session, pendingDelete({ jobId: "ws-other" })), /no longer matches/);
  await assert.rejects(dataartsManagement.poll!(session, pendingDelete({ operation: "Create workspace" })), /Only a pending private-workspace deletion/);
  await assert.rejects(dataartsManagement.poll!(session, pendingDelete({ resourceId: undefined, jobId: undefined })), /Only a pending private-workspace deletion/);
});

test("DataArts job retry sends native typed coordinates and accepts for manual verification", async t => {
  const { writes, calls } = cloud(t);
  const result = await dataartsManagement.execute(session, "retry-job", { instance: "123", retryLocation: "errorNode", retryTaskVersion: "original_version" }, jobResource);
  assert.deepEqual(writes, [{ path: "/v2/project-1/factory/jobs/etl-orders/instances/retry", method: "POST", body: { retry_location: "errorNode", retry_task_version: "original_version", task_retrys: { job_id: 456, plan_time: 1767225600000, submit_time: 1767225600001 } }, workspace: "ws-2" }]);
  assert.equal(result.asynchronous, true);
  assert.equal(result.jobId, undefined);
  assert.equal(result.resourceId, "job:instance-1:ws-2:etl-orders");
  assert.match(result.message, /without a native outcome/);
  // No fresh run status is claimed from a read-back after the empty native response.
  assert.deepEqual(calls.at(-1), { kind: "write", path: "/v2/project-1/factory/jobs/etl-orders/instances/retry" });
});

test("DataArts job retry refuses non-failed, foreign, malformed or unverifiable instances", async t => {
  const first = cloud(t, { jobInstances: [{ ...failedInstance, status: "success" }] });
  await assert.rejects(dataartsManagement.execute(session, "retry-job", { instance: "123", retryLocation: "errorNode", retryTaskVersion: "original_version" }, jobResource), /Only failed/);
  assert.equal(first.writes.length, 0);
  const second = cloud(t);
  await assert.rejects(dataartsManagement.execute(session, "retry-job", { instance: "999", retryLocation: "errorNode", retryTaskVersion: "original_version" }, jobResource), /no longer exists/);
  await assert.rejects(dataartsManagement.execute(session, "retry-job", { instance: "123", retryLocation: "specifiedNode", retryTaskVersion: "original_version" }, jobResource), /Select a retry start point/);
  assert.equal(second.writes.length, 0);
  const third = cloud(t, { jobInstances: [{ ...failedInstance, plan_time: undefined }] });
  await assert.rejects(dataartsManagement.execute(session, "retry-job", { instance: "123", retryLocation: "errorNode", retryTaskVersion: "original_version" }, jobResource), /retry coordinates/);
  assert.equal(third.writes.length, 0);
  const fourth = cloud(t, { jobInstances: [{ ...failedInstance, job_name: "etl-orders_child" }] });
  await assert.rejects(dataartsManagement.execute(session, "retry-job", { instance: "123", retryLocation: "errorNode", retryTaskVersion: "original_version" }, jobResource), /different job/);
  assert.equal(fourth.writes.length, 0);
});

test("DataArts rejects unsupported operations and malformed resource selections", async () => {
  await assert.rejects(dataartsManagement.execute(session, "nonsense", {}), /Unsupported DataArts/);
  await assert.rejects(dataartsManagement.execute(session, "inspect-workspace", {}, { id: "workspace:ws-1", name: "broken" }), /Select a DataArts Studio workspace/);
  await assert.rejects(dataartsManagement.execute(session, "job-instances", {}, { id: "job:instance-1:etl-orders", name: "broken" }), /Select a DataArts Studio job/);
});

test("DataArts validates envelope and nested scope echoes even on otherwise complete empty pages", async t => {
  for (const scope of [null, "", false, "other-project"]) for (const at of ["top", "data"]) {
    cloud(t, {}, url => url.pathname.endsWith("/instances") ? Response.json({ commodity_orders: [], count: 0, ...(at === "top" ? { project_id: scope } : { data: { projectId: scope } }) }) : undefined);
    await assert.rejects(listDataArtsInstancesForProject(project), /unverifiable response or scope/);
  }
});
test("DataArts business failure cannot hide inside a valid inventory or accepted write", async t => {
  for (const errorCode of [null, false, 17, "PRIVATE-DIAGNOSTIC"]) {
    cloud(t, {}, url => url.pathname.endsWith("/instances") ? Response.json({ count: 0, commodity_orders: [], error_code: errorCode }) : undefined);
    await assert.rejects(listDataArtsInstancesForProject(project), error => error instanceof Error && /business error/.test(error.message) && !error.message.includes("PRIVATE"));
  }
});
test("workspace account scope is checked against its fresh parent instance", async t => {
  const { writes } = cloud(t, { workspaces: [{ ...devWorkspace, domain_id: "different-account" }] });
  await assert.rejects(dataartsManagement.execute(session, "delete-workspace", {}, workspaceResource("ws-2", "dev")), /matching native domain echo/);
  assert.equal(writes.length, 0);
});
test("creation requires native acceptance and never borrows a workspace ID from message text", async t => {
  cloud(t, {}, (url, init) => init.method === "POST" && url.pathname.startsWith("/v1/project-1/workspaces/") ? Response.json({ is_success: true, message: "looks-like-a-workspace-id" }) : undefined);
  const result = await dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "research", epsId: "0" });
  assert.equal(result.asynchronous, true);
  assert.equal(result.resourceId, "instance:instance-1");
  assert.equal(result.jobId, undefined);
  for (const ack of [{}, { is_success: null }, { is_success: "true" }]) {
    cloud(t, {}, (url, init) => init.method === "POST" && url.pathname.startsWith("/v1/project-1/workspaces/") ? Response.json(ack) : undefined);
    await assert.rejects(dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "research", epsId: "0" }), /no verifiable acceptance/);
  }
});
test("creation rejects native rejection and mismatched accepted parent echoes", async t => {
  for (const ack of [{ is_success: false }, { is_success: true, instance_id: null }, { is_success: true, project_id: "other" }, { is_success: true, eps_id: "other" }]) {
    cloud(t, {}, (url, init) => init.method === "POST" && url.pathname.startsWith("/v1/project-1/workspaces/") ? Response.json(ack) : undefined);
    await assert.rejects(dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "research", epsId: "0" }), /rejected|unverifiable/);
  }
});
test("creation is unavailable on non-effective or unknown native instance states", async t => {
  for (const status of [1, 3, 4, 5, 6, null, "2", false]) {
    const { writes } = cloud(t, { instances: [{ ...instanceOrder, status }] });
    await assert.rejects(dataartsManagement.execute(session, "create-workspace", { instance: "instance-1", name: "research", epsId: "0" }), /Only an effective/);
    assert.equal(writes.length, 0);
  }
});
test("global EPS permission failures remain visible rather than falling back to stale workspace use", async t => {
  const accountSession = { ...session, accountToken: "account-token" };
  const { writes } = cloud(t, {}, url => url.pathname === "/v1.0/enterprise-projects" ? Response.json({ error_msg: "PRIVATE-DIAGNOSTIC" }, { status: 403 }) : undefined);
  await assert.rejects(dataartsManagement.options!(accountSession, "create-workspace"), /Check account permissions/);
  assert.equal(writes.length, 0);
});
test("EPS discovery requires complete native pages and stable totals", async t => {
  const accountSession = { ...session, accountToken: "account-token" };
  for (const body of [{}, { enterprise_projects: [], total_count: null }, { enterprise_projects: [{ id: "0", status: 1 }], total_count: 0 }, { enterprise_projects: [{ id: "0" }, { id: "0" }], total_count: 2 }]) {
    cloud(t, {}, url => url.pathname === "/v1.0/enterprise-projects" ? Response.json(body) : undefined);
    await assert.rejects(dataartsManagement.options!(accountSession, "create-workspace"), /incomplete|duplicate/);
  }
  cloud(t, {}, url => url.pathname === "/v1.0/enterprise-projects" ? Response.json(url.searchParams.get("offset") === "0" ? { enterprise_projects: [{ id: "0", status: 1 }], total_count: 2 } : { enterprise_projects: [{ id: "next", status: 1 }], total_count: 3 }) : undefined);
  await assert.rejects(dataartsManagement.options!(accountSession, "create-workspace"), /changed during pagination/);
});
test("exact job requests reject foreign job and workspace echoes", async t => {
  cloud(t, { jobInstances: [{ ...failedInstance, job_name: "other-job" }] });
  await assert.rejects(dataartsManagement.options!(session, "retry-job", jobResource), /different job/);
  cloud(t, {}, url => url.pathname.endsWith("/factory/jobs") ? Response.json({ total: 1, jobs: [{ ...job, workspace_id: null }] }) : undefined);
  await assert.rejects(dataartsManagement.inventory(session), /another workspace/);
});
test("DataArts instance pagination uses native page numbers rather than workspace record offsets", async t => {
  const { reads } = cloud(t, {}, url => {
    if (url.pathname !== "/v1/project-1/instances") return undefined;
    const first = url.searchParams.get("offset") === "0";
    const commodity_orders = first ? Array.from({ length: 100 }, (_, index) => ({ ...instanceOrder, resource_id: `instance-${index}` })) : [{ ...instanceOrder, resource_id: "instance-100" }];
    return Response.json({ count: 101, commodity_orders });
  });
  assert.equal((await listDataArtsInstancesForProject(project)).length, 101);
  assert.equal(reads[1].path, "/v1/project-1/instances?limit=100&offset=1");
});
