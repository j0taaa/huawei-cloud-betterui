import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { workspaceManagement } from "@/lib/huawei/management/adapters/workspace";
import { ManagementInputError, validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";
import { HuaweiApiError } from "@/lib/huawei/http";

const desktopSeed = (): Record<string, unknown>[] => [
  { desktop_id: "desk-1", computer_name: "Office-PC-1", os_host_name: "OP1", metadata: { charging_mode: "1" }, status: "ACTIVE", task_status: "", user_name: "alice", user_group: "users", availability_zone: "az-1", desktop_type: "DEDICATED", os_version: "Windows 10", created: "2026-01-01 00:00:00", enterprise_project_id: "0", product_id: "prod-win", product: { product_id: "prod-win", cpu: "4", memory: "8192" }, root_volume: { type: "SSD", size: 80 }, data_volumes: [], ip_addresses: ["10.0.0.1"], sid: "S-1-1" },
  { desktop_id: "desk-2", computer_name: "Office-PC-2", metadata: { charging_mode: "1" }, status: "SHUTOFF", task_status: "", user_name: "bob", user_group: "users", availability_zone: "az-1", desktop_type: "DEDICATED", os_version: "Windows 10", created: "2026-01-02 00:00:00", product_id: "prod-win", product: { product_id: "prod-win", cpu: "4", memory: "8192" }, root_volume: { type: "SSD", size: 80 }, data_volumes: [{ type: "SAS", size: 100 }] },
  { desktop_id: "desk-3", computer_name: "Office-PC-3", status: "BUILD", task_status: "creating", user_name: "carol", user_group: "default", availability_zone: "az-2", desktop_type: "DEDICATED", os_version: "Ubuntu 22.04", created: "2026-01-03 00:00:00", product_id: "prod-linux", product: { product_id: "prod-linux", cpu: "2", memory: "4096" }, root_volume: { type: "SAS", size: 80 }, data_volumes: [] },
  { desktop_id: "desk-4", computer_name: "Office-PC-4", status: "ACTIVE", user_name: "alice", user_group: "users", availability_zone: "az-1", desktop_type: "DEDICATED", os_version: "Windows 10", created: "2026-01-04 00:00:00", product_id: "prod-win", product: { product_id: "prod-win", cpu: "4", memory: "8192" }, root_volume: { type: "SSD", size: 80 }, data_volumes: [] },
  { desktop_id: "desk-5", computer_name: "Pool-PC-1", metadata: { charging_mode: "1" }, status: "SHUTOFF", task_status: "", user_name: "bob", user_group: "users", availability_zone: "az-1", pool_id: "pool-2", desktop_type: "DEDICATED", os_version: "Windows 10", created: "2026-01-05 00:00:00", product_id: "prod-win", product: { product_id: "prod-win", cpu: "4", memory: "8192" }, root_volume: { type: "SSD", size: 80 }, data_volumes: [] },
];
const userSeed = (): Record<string, unknown>[] => [
  { id: "user-1", user_name: "alice", user_email: "alice@example.com", active_type: "USER_ACTIVATE", locked: false, disabled: false, total_desktops: 1, description: "Alice", account_expires: "0", password_never_expired: false, enable_change_password: true, next_login_change_password: false, enterprise_project_id: "0", object_sid: "S-1-2" },
  { id: "user-2", user_name: "bob", user_email: "bob@example.com", active_type: "USER_ACTIVATE", locked: true, disabled: false, total_desktops: 0, account_expires: "0" },
  { id: "user-3", user_name: "carol", user_email: "carol@example.com", active_type: "USER_ACTIVATE", locked: false, disabled: false, total_desktops: 2, account_expires: "0" },
  { id: "user-4", user_name: "dave", user_email: "dave@example.com", active_type: "USER_ACTIVATE", locked: false, disabled: false, total_desktops: null, account_expires: "0" },
  { id: "user-5", user_name: "erin", user_email: "erin@example.com", active_type: "USER_ACTIVATE", total_desktops: 0, account_expires: "0" },
];
const poolSeed = (): Record<string, unknown>[] => [
  { id: "pool-1", name: "Team-Pool", type: "DYNAMIC", description: "team", status: "STEADY", charging_mode: "1", desktop_count: 2, desktop_used: 1, availability_zone: "az-1", product: { product_id: "prod-win", cpu: "4", memory: "8192" }, image_name: "Windows 10", image_os_type: "Windows", image_os_version: "10", root_volume: { type: "SSD", size: 80 }, created_time: "2026-01-01 00:00:00" },
  { id: "pool-2", name: "Empty-Pool", type: "STATIC", description: "", status: "STEADY", charging_mode: "1", desktop_count: 0, desktop_used: 0, availability_zone: "az-1", product: { product_id: "prod-win", cpu: "4", memory: "8192" }, image_name: "Windows 10", image_os_type: "Windows", image_os_version: "10", root_volume: { type: "SSD", size: 80 }, created_time: "2026-01-02 00:00:00" },
  { id: "pool-3", name: "Idle-Pool", type: "STATIC", description: "", status: "STEADY", charging_mode: "1", desktop_count: 0, desktop_used: 0, availability_zone: "az-1", product: { product_id: "prod-win", cpu: "4", memory: "8192" }, image_name: "Windows 10", image_os_type: "Windows", image_os_version: "10", root_volume: { type: "SSD", size: 80 }, created_time: "2026-01-03 00:00:00" },
  { id: "pool-4", name: "Unknown-Pool", type: "DYNAMIC", description: "", status: "STEADY", charging_mode: "1", desktop_count: null, availability_zone: "az-1", product: { product_id: "prod-win", cpu: "4", memory: "8192" }, image_name: "Windows 10", image_os_type: "Windows", image_os_version: "10", root_volume: { type: "SSD", size: 80 }, created_time: "2026-01-04 00:00:00" },
  { id: "pool-5", name: "Busy-Pool", type: "STATIC", description: "", status: "STEADY", charging_mode: "1", desktop_count: 0, desktop_used: 0, task_status: "deleting", availability_zone: "az-1", product: { product_id: "prod-win", cpu: "4", memory: "8192" }, image_name: "Windows 10", image_os_type: "Windows", image_os_version: "10", root_volume: { type: "SSD", size: 80 }, created_time: "2026-01-05 00:00:00" },
];
const products = [
  { product_id: "prod-win", charge_mode: "1", status: "normal", type: "BASE", architecture: "x86", cpu: "4", memory: "8192", package_type: "general", system_disk_type: "SSD", system_disk_size: "80", os_type: "Windows", availability_zone: "az-1", domain_ids: [] },
  { product_id: "prod-linux", charge_mode: "1", status: "normal", type: "BASE", architecture: "x86", cpu: "2", memory: "4096", package_type: "general", system_disk_type: "SAS", system_disk_size: "80", os_type: "Linux", availability_zone: "az-2", domain_ids: [] },
  { product_id: "prod-sub", charge_mode: "0", status: "normal", type: "BASE", architecture: "x86", cpu: "4", memory: "8192", system_disk_type: "SSD", system_disk_size: "80", os_type: "Windows", availability_zone: "az-1", domain_ids: [] },
  { product_id: "prod-nodisk", charge_mode: "1", status: "normal", type: "BASE", architecture: "x86", cpu: "2", memory: "4096", os_type: "Windows", availability_zone: "az-1", domain_ids: [] },
  { product_id: "prod-offsale", charge_mode: "1", status: "soldout", type: "BASE", architecture: "x86", cpu: "4", memory: "8192", system_disk_type: "SSD", system_disk_size: "80", os_type: "Windows", availability_zone: "az-1", domain_ids: [] },
  { product_id: "prod-nomode", status: "normal", type: "BASE", architecture: "x86", cpu: "4", memory: "8192", system_disk_type: "SSD", system_disk_size: "80", os_type: "Windows", availability_zone: "az-1", domain_ids: [] },
  { product_id: "prod-smalldisk", charge_mode: "1", status: "normal", type: "BASE", architecture: "x86", cpu: "2", memory: "4096", system_disk_type: "SSD", system_disk_size: "70", os_type: "Windows", availability_zone: "az-1", domain_ids: [] },
  { product_id: "prod-oddisk", charge_mode: "1", status: "normal", type: "BASE", architecture: "x86", cpu: "2", memory: "4096", system_disk_type: "SSD", system_disk_size: "85", os_type: "Windows", availability_zone: "az-1", domain_ids: [] },
  { product_id: "prod-dedicated", charge_mode: "1", status: "normal", type: "BASE", architecture: "x86", cpu: "4", memory: "8192", system_disk_type: "SSD", system_disk_size: "80", os_type: "Windows", availability_zone: "az-1", domain_ids: ["other-domain"] },
  { product_id: "prod-notbase", charge_mode: "1", status: "normal", type: "ULTIMATE", architecture: "x86", cpu: "4", memory: "8192", system_disk_type: "SSD", system_disk_size: "80", os_type: "Linux", availability_zone: "az-2", domain_ids: [] },
];
const images = [
  { id: "img-gold-win", name: "Windows 10", os_type: "Windows", os_version: "10", image_type: "gold", architecture: "x86" },
  { id: "img-priv-linux", name: "Ubuntu 22.04", os_type: "Linux", os_version: "22.04", image_type: "private", architecture: "x86" },
  { id: "img-shared", name: "Shared Image", os_type: "Windows", os_version: "10", image_type: "shared", architecture: "x86" },
  { id: "img-other", name: "Other OS", os_type: "Other", os_version: "?", image_type: "gold", architecture: "x86" },
];
const zones = [
  { availability_zone: "az-1", default_availability_zone: true },
  { availability_zone: "az-2", default_availability_zone: false },
];
const workspaceSubnets = [
  { id: "wsubnet-1", name: "Office", cidr: "192.168.10.0/24", vpc_id: "vpc-1", neutron_subnet_id: "net-1", availability_zone: "az-1", status: "ACTIVE" },
  { id: "wsubnet-2", name: "Legacy", cidr: "10.0.0.0/24", vpc_id: "vpc-1", availability_zone: "az-1", status: "ACTIVE" },
  { id: "wsubnet-3", name: "Foreign", cidr: "172.16.0.0/24", vpc_id: "vpc-9", neutron_subnet_id: "net-9", availability_zone: "az-1", status: "ACTIVE" },
];
const vpcSubnets = [
  { id: "wsubnet-1", name: "Office", cidr: "192.168.10.0/24", vpc_id: "vpc-1", neutron_network_id: "port-network-1", neutron_subnet_id: "net-1", status: "ACTIVE" },
];
const tenant = { id: "ws-1", status: "SUBSCRIBED", config_status: "0", vpc_id: "vpc-1", vpc_name: "ws-vpc", access_mode: "INTERNET", subnet_ids: [{ subnet_id: "net-1" }], management_subnet_cidr: "192.168.0.0/24" };

type CloudOptions = { deletesComplete?: boolean; tenant?: Record<string, unknown>; vpcSubnets?: unknown[]; jobReplies?: Record<string, unknown>[]; actionFailure?: Record<string, unknown>; noJobId?: boolean; userUpdateReplyId?: string; applyPatches?: boolean };

function page(rows: unknown[], url: URL) {
  const offset = Number(url.searchParams.get("offset") ?? "0") || 0;
  const limit = Number(url.searchParams.get("limit") ?? "100") || 100;
  return rows.slice(offset, offset + limit);
}

function mockCloud(t: TestContext, options: CloudOptions = {}) {
  const store = { desktops: desktopSeed(), users: userSeed(), pools: poolSeed() };
  const writes: { path: string; method: string; body?: unknown }[] = [];
  const reads: string[] = [];
  const deletedDesktops = new Set<string>();
  const deletedUsers = new Set<string>();
  const deletedPools = new Set<string>();
  let deletesComplete = options.deletesComplete ?? true;
  let jobIndex = 0;
  const jobReplies = options.jobReplies ?? [{ id: "cloud-job", status: "SUCCESS" }];
  const applyPatches = options.applyPatches ?? true;
  const record = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
  const last = (path: string) => path.split("/").at(-1) as string;
  const visibleDesktops = () => (deletesComplete ? store.desktops.filter((row) => !deletedDesktops.has(String(row.desktop_id))) : store.desktops);
  const visibleUsers = () => (deletesComplete ? store.users.filter((row) => !deletedUsers.has(String(row.id))) : store.users);
  const visiblePools = () => (deletesComplete ? store.pools.filter((row) => !deletedPools.has(String(row.id))) : store.pools);
  const read = (url: URL): unknown => {
    const path = url.pathname;
    if (path === "/v2/project-1/desktops") return { desktops: page(visibleDesktops(), url), total_count: visibleDesktops().length };
    if (path === "/v2/project-1/users") return { users: page(visibleUsers(), url), total_count: visibleUsers().length };
    if (path === "/v2/project-1/desktop-pools") return { desktop_pools: page(visiblePools(), url), total_count: visiblePools().length };
    if (path === "/v2/project-1/products") {
      const filtered = products.filter((row) => (!url.searchParams.has("charge_mode") || String(row.charge_mode) === url.searchParams.get("charge_mode")) && (!url.searchParams.has("os_type") || row.os_type === url.searchParams.get("os_type")) && (!url.searchParams.has("architecture") || row.architecture === url.searchParams.get("architecture")) && (!url.searchParams.has("availability_zone") || row.availability_zone === url.searchParams.get("availability_zone")));
      return { products: page(filtered, url), total_count: filtered.length };
    }
    if (path === "/v2/project-1/images") return { images: page(images, url), total_count: images.length };
    if (path === "/v2/project-1/availability-zones") return { availability_zones: zones, total_count: zones.length };
    if (path === "/v2/project-1/subnets") return { subnets: workspaceSubnets, subnet_size: workspaceSubnets.length };
    if (path === "/v2/project-1/workspaces") return options.tenant ?? tenant;
    if (path === "/v2/project-1/agencies") return { existing_agencies: [{ name: "ServiceLinkedAgencyForWorkspace", permissions: [{ system_permission_display_names: ["WorkspaceServiceLinkedAgencyPolicy"], wanted_system_permission_display_names: [], should_have_system_permission_display_names: ["WorkspaceServiceLinkedAgencyPolicy"] }] }] };
    if (/^\/v2\/project-1\/desktop-pools\/[^/]+\/users$/.test(path)) return { objects: [], total_count: 0 };
    if (path === "/v1/project-1/subnets") return { subnets: options.vpcSubnets ?? vpcSubnets, page_info: { next_marker: "" } };
    if (/^\/v2\/project-1\/desktops\/[^/]+$/.test(path)) return { desktop: visibleDesktops().find((row) => row.desktop_id === last(path)) };
    if (/^\/v2\/project-1\/users\/[^/]+$/.test(path)) return { user_detail: visibleUsers().find((row) => row.id === last(path)) };
    if (/^\/v2\/project-1\/desktop-pools\/[^/]+$/.test(path)) return visiblePools().find((row) => row.id === last(path)) ?? {};
    if (/^\/v2\/project-1\/workspace-jobs\//.test(path)) return jobReplies[jobIndex++] ?? jobReplies.at(-1);
    throw new Error(`Unexpected GET ${path}`);
  };
  const applyWrite = (url: URL, method: string, body: Record<string, unknown>): unknown => {
    const path = url.pathname;
    if (method === "POST" && path === "/v2/project-1/desktops") return options.noJobId ? {} : { job_id: "cloud-job" };
    if (method === "POST" && path === "/v2/project-1/desktops/action") return options.actionFailure ? { job_id: "", failed_operation_list: [options.actionFailure] } : { job_id: "cloud-job", failed_operation_list: [] };
    if (method === "POST" && path === "/v2/project-1/desktop-pools") return { job_id: "cloud-job" };
    if (method === "POST" && path === "/v2/project-1/users") {
      store.users.push({ id: "user-new", user_name: String(body.user_name ?? ""), user_email: String(body.user_email ?? ""), active_type: "USER_ACTIVATE", locked: false, disabled: false, total_desktops: 0, description: String(body.description ?? ""), account_expires: "0" });
      return { id: "user-new" };
    }
    if (method === "PUT" && /^\/v2\/project-1\/desktops\/[^/]+$/.test(path)) {
      const desktop = store.desktops.find((row) => row.desktop_id === last(path));
      if (applyPatches && desktop) Object.assign(desktop, record(body.desktop));
      return {};
    }
    if (method === "PUT" && /^\/v2\/project-1\/users\/[^/]+$/.test(path)) {
      const user = store.users.find((row) => row.id === last(path));
      if (applyPatches && user) Object.assign(user, body);
      return { id: options.userUpdateReplyId ?? last(path) };
    }
    if (method === "POST" && /^\/v2\/project-1\/users\/[^/]+\/actions$/.test(path)) {
      const user = store.users.find((row) => row.id === path.split("/").at(-2));
      if (applyPatches && user) user.locked = body.op_type === "LOCK";
      return {};
    }
    if (method === "DELETE" && /^\/v2\/project-1\/desktops\/[^/]+$/.test(path)) { deletedDesktops.add(last(path)); return {}; }
    if (method === "DELETE" && /^\/v2\/project-1\/users\/[^/]+$/.test(path)) { deletedUsers.add(last(path)); return {}; }
    if (method === "DELETE" && /^\/v2\/project-1\/desktop-pools\/[^/]+$/.test(path)) { deletedPools.add(last(path)); return {}; }
    return {};
  };
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) {
      reads.push(url.pathname + url.search);
      const body = read(url);
      if ((body === undefined || (body && typeof body === "object" && (!Object.keys(body).length || ("desktop" in body && !body.desktop) || ("user_detail" in body && !body.user_detail)))) && /\/(desktops|users|desktop-pools)\/[^/]+$/.test(url.pathname)) return Response.json({ error_msg: "gone" }, { status: 404 });
      if (url.pathname.includes("/workspace-jobs/")) { const row = record(body); return Response.json({ sub_jobs: [], sub_jobs_total: Array.isArray(row.sub_jobs) ? row.sub_jobs.length : 0, ...row, ...(Array.isArray(row.sub_jobs) ? { sub_jobs: row.sub_jobs.map((sub, index) => ({ id: `sub-${index}`, ...record(sub) })) } : {}) }); }
      return Response.json(body);
    }
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    writes.push({ path: url.pathname + url.search, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(applyWrite(url, init.method, record(writes.at(-1)?.body)));
  });
  return { writes, reads, store, finishDeletes: () => { deletesComplete = true; } };
}

const desktopResource = (id: string, name: string, status?: string): ManagementResource => ({ id: `desktop:${id}`, name, ...(status ? { status } : {}) });
const userResource = (id: string, name: string, status?: string): ManagementResource => ({ id: `user:${id}`, name, ...(status ? { status } : {}) });
const poolResource = (id: string, name: string): ManagementResource => ({ id: `pool:${id}`, name });
const createDesktopValues: ManagementValues = { name: "New-PC", user: "alice", userGroup: "administrators", product: "prod-win", image: "img-gold-win", zone: "az-1", subnet: "wsubnet-1" };
const createPoolValues: ManagementValues = { name: "Night-Shift", type: "DYNAMIC", size: 5, users: ["user-1", "user-3"], userGroup: "administrators", product: "prod-win", image: "img-gold-win", zone: "az-1", subnet: "wsubnet-1", description: "Shift pool" };
const historyEntry = (overrides: Partial<ManagementHistoryEntry>): ManagementHistoryEntry => ({ id: randomUUID(), service: "workspace", operation: "Create desktop", startedAt: new Date().toISOString(), state: "submitted", ...overrides });

test("inventory maps desktops, users, and pools with verified statuses and no private data", async (t) => {
  const cloud = mockCloud(t);
  const resources = await workspaceManagement.inventory(session);
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status ?? ""]), [
    ["desktop:desk-1", "Office-PC-1", "ACTIVE"],
    ["desktop:desk-2", "Office-PC-2", "SHUTOFF"],
    ["desktop:desk-3", "Office-PC-3", "BUILD"],
    ["desktop:desk-4", "Office-PC-4", "ACTIVE"],
    ["desktop:desk-5", "Pool-PC-1", "SHUTOFF"],
    ["user:user-1", "alice", "ACTIVE"],
    ["user:user-2", "bob", "LOCKED"],
    ["user:user-3", "carol", "ACTIVE"],
    ["user:user-4", "dave", "ACTIVE"],
    ["user:user-5", "erin", "UNKNOWN"],
    ["pool:pool-1", "Team-Pool", ""],
    ["pool:pool-2", "Empty-Pool", ""],
    ["pool:pool-3", "Idle-Pool", ""],
    ["pool:pool-4", "Unknown-Pool", ""],
    ["pool:pool-5", "Busy-Pool", ""],
  ]);
  assert.equal(resources.find((item) => item.id === "user:user-1")?.values?.desktops, 1);
  assert.equal(resources.find((item) => item.id === "user:user-4")?.values?.desktops, undefined);
  assert.equal(resources.find((item) => item.id === "pool:pool-4")?.values?.desktops, undefined);
  assert.ok(!JSON.stringify(resources).includes("10.0.0.1"));
  assert.ok(!JSON.stringify(resources).includes("S-1"));
  assert.ok(cloud.reads.some((path) => path.startsWith("/v2/project-1/desktops?")));
});

test("inventories refuse missing arrays, empty IDs, and duplicate IDs or names", async (t) => {
  let mode = "missing";
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v2/project-1/desktops") {
      if (mode === "missing") return Response.json({ total_count: 0 });
      if (mode === "empty-id") return Response.json({ desktops: [{ desktop_id: "", computer_name: "A" }], total_count: 1 });
      if (mode === "duplicate-ids") return Response.json({ desktops: [{ desktop_id: "desk-1", computer_name: "A" }, { desktop_id: "desk-1", computer_name: "B" }], total_count: 2 });
      return Response.json({ desktops: [{ desktop_id: "desk-1", computer_name: "Same-PC" }, { desktop_id: "desk-2", computer_name: "Same-PC" }], total_count: 2 });
    }
    return Response.json({ users: [], total_count: 0 });
  });
  await assert.rejects(workspaceManagement.inventory(session), /expected desktops/);
  mode = "empty-id";
  await assert.rejects(workspaceManagement.inventory(session), /without an ID/);
  mode = "duplicate-ids";
  await assert.rejects(workspaceManagement.inventory(session), /duplicate desktop IDs/);
  mode = "duplicate-names";
  await assert.rejects(workspaceManagement.inventory(session), /duplicate desktop names/);
});

test("catalogs refuse missing arrays and duplicate or incomplete subnet lists", async (t) => {
  let mode = "products";
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (mode === "products" && url.pathname === "/v2/project-1/products") return Response.json({ total_count: 0 });
    if (mode === "images" && url.pathname === "/v2/project-1/images") return Response.json({ total_count: 0 });
    if (mode === "zones" && url.pathname === "/v2/project-1/availability-zones") return Response.json({});
    if (mode === "subnets-missing" && url.pathname === "/v2/project-1/subnets") return Response.json({ subnet_size: 0 });
    if (mode === "subnets-short" && url.pathname === "/v2/project-1/subnets") return Response.json({ subnets: workspaceSubnets, subnet_size: 5 });
    if (mode === "subnets-duplicate" && url.pathname === "/v2/project-1/subnets") return Response.json({ subnets: [workspaceSubnets[0], workspaceSubnets[0]], subnet_size: 2 });
    return Response.json(mockCloudRead(url));
  });
  await assert.rejects(workspaceManagement.options!(session, "create-desktop"), /expected products/);
  mode = "images";
  await assert.rejects(workspaceManagement.options!(session, "create-desktop"), /expected images/);
  mode = "zones";
  await assert.rejects(workspaceManagement.options!(session, "create-desktop"), /no availability zone list/);
  mode = "subnets-missing";
  await assert.rejects(workspaceManagement.options!(session, "create-desktop"), /no workspace subnet list/);
  mode = "subnets-short";
  await assert.rejects(workspaceManagement.options!(session, "create-desktop"), /incomplete workspace subnet list/);
  mode = "subnets-duplicate";
  await assert.rejects(workspaceManagement.options!(session, "create-desktop"), /duplicate workspace subnet IDs/);
});

function mockCloudRead(url: URL): unknown {
  const path = url.pathname;
  if (path === "/v2/project-1/desktops") return { desktops: page(desktopSeed(), url), total_count: 5 };
  if (path === "/v2/project-1/users") return { users: page(userSeed(), url), total_count: 5 };
  if (path === "/v2/project-1/desktop-pools") return { desktop_pools: page(poolSeed(), url), total_count: 5 };
  if (path === "/v2/project-1/products") return { products: page(products, url), total_count: products.length };
  if (path === "/v2/project-1/images") return { images: page(images, url), total_count: images.length };
  if (path === "/v2/project-1/availability-zones") return { availability_zones: zones, total_count: zones.length };
  if (path === "/v2/project-1/subnets") return { subnets: workspaceSubnets, subnet_size: workspaceSubnets.length };
  if (path === "/v2/project-1/workspaces") return tenant;
  if (path === "/v1/project-1/subnets") return { subnets: vpcSubnets, page_info: { next_marker: "" } };
  throw new Error(`Unexpected GET ${path}`);
}

test("create options whitelist native on-sale pay-per-use products, MB-based memory labels, and active users only", async (t) => {
  mockCloud(t);
  const choices = await workspaceManagement.options!(session, "create-desktop");
  assert.deepEqual(choices.users.map((choice) => choice.value), ["alice", "carol", "dave"]);
  assert.deepEqual(choices.products.map((choice) => choice.value), ["prod-win", "prod-linux", "prod-notbase"]);
  assert.ok(choices.products.find((choice) => choice.value === "prod-win")!.label.includes("8 GB memory"));
  assert.ok(choices.products.find((choice) => choice.value === "prod-linux")!.label.includes("4 GB memory"));
  assert.deepEqual(choices.images.map((choice) => choice.value), ["img-gold-win", "img-priv-linux"]);
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1", "az-2"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["wsubnet-1", "wsubnet-3"]);
  const poolChoices = await workspaceManagement.options!(session, "create-pool");
  assert.deepEqual(poolChoices.poolUsers.map((choice) => choice.value), ["user-1", "user-3", "user-4"]);
  assert.deepEqual(poolChoices.products.map((choice) => choice.value), ["prod-win", "prod-linux", "prod-notbase"]);
});

test("create-desktop filters the native product API by zone, OS, and architecture and sends the workspace network ID on the wire", async (t) => {
  const cloud = mockCloud(t);
  const outcome = await workspaceManagement.execute(session, "create-desktop", createDesktopValues);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  await workspaceManagement.execute(session, "create-desktop", { ...createDesktopValues, name: "Linux-PC", user: "carol", userGroup: "sudo", product: "prod-linux", image: "img-priv-linux", zone: "az-2" });
  const productReads = cloud.reads.filter((path) => path.startsWith("/v2/project-1/products?"));
  assert.ok(productReads.some((path) => path.includes("charge_mode=1") && path.includes("os_type=Windows") && path.includes("architecture=x86") && path.includes("availability_zone=az-1")));
  assert.ok(productReads.some((path) => path.includes("os_type=Linux") && path.includes("availability_zone=az-2")));
  assert.deepEqual(cloud.writes, [
    { path: "/v2/project-1/desktops", method: "POST", body: { desktop_type: "DEDICATED", availability_zone: "az-1", product_id: "prod-win", image_type: "gold", image_id: "img-gold-win", root_volume: { type: "SSD", size: 80 }, nics: [{ subnet_id: "net-1" }], desktops: [{ user_name: "alice", user_group: "administrators", computer_name: "New-PC" }], email_notification: false } },
    { path: "/v2/project-1/desktops", method: "POST", body: { desktop_type: "DEDICATED", availability_zone: "az-2", product_id: "prod-linux", image_type: "private", image_id: "img-priv-linux", root_volume: { type: "SAS", size: 80 }, nics: [{ subnet_id: "net-1" }], desktops: [{ user_name: "carol", user_group: "sudo", computer_name: "Linux-PC" }], email_notification: false } },
  ]);
});

test("create-desktop rejects forged, subscription, off-sale, unlicensed, and unsafe selections before any cloud mutation", async (t) => {
  const cloud = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createDesktopValues, product: "forged-product" }, /subscription products require an explicit order workflow/],
    [{ ...createDesktopValues, product: "prod-sub" }, /subscription products require an explicit order workflow/],
    [{ ...createDesktopValues, product: "prod-offsale" }, /subscription products require an explicit order workflow/],
    [{ ...createDesktopValues, product: "prod-nomode" }, /subscription products require an explicit order workflow/],
    [{ ...createDesktopValues, product: "prod-dedicated" }, /subscription products require an explicit order workflow/],
    [{ ...createDesktopValues, product: "prod-nodisk" }, /80-32760 GB range/],
    [{ ...createDesktopValues, product: "prod-smalldisk" }, /80-32760 GB range/],
    [{ ...createDesktopValues, product: "prod-oddisk" }, /80-32760 GB range/],
    [{ ...createDesktopValues, image: "img-shared" }, /Only public and private images/],
    [{ ...createDesktopValues, image: "img-other" }, /supported operating system/],
    [{ ...createDesktopValues, image: "forged-image" }, /no longer available in this workspace/],
    [{ ...createDesktopValues, userGroup: "sudo" }, /does not match the selected Windows image/],
    [{ ...createDesktopValues, user: "forged-user" }, /no longer available in this workspace/],
    [{ ...createDesktopValues, user: "bob" }, /locked, disabled, or unverified/],
    [{ ...createDesktopValues, user: "erin" }, /locked, disabled, or unverified/],
    [{ ...createDesktopValues, zone: "az-9" }, /availability zone is no longer available/],
    [{ ...createDesktopValues, subnet: "wsubnet-2" }, /network ID/],
    [{ ...createDesktopValues, subnet: "wsubnet-3" }, /not in the workspace's configured VPC/],
    [{ ...createDesktopValues, subnet: "forged-subnet" }, /no longer registered with this workspace/],
    [{ ...createDesktopValues, name: "Office-PC-1" }, /already exists in the workspace/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(workspaceManagement.execute(session, "create-desktop", values), expression);
  assert.equal(cloud.writes.length, 0);
});

test("private images require a basic BASE product package per the native catalog", async (t) => {
  const cloud = mockCloud(t);
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", { ...createDesktopValues, name: "Linux-PC", user: "carol", userGroup: "sudo", product: "prod-notbase", image: "img-priv-linux", zone: "az-2" }), /basic \(BASE\) product package/);
  assert.equal(cloud.writes.length, 0);
});

test("desktop and pool creation require an activated workspace and verified subnet ownership", async (t) => {
  const unconfigured = mockCloud(t, { tenant: { ...tenant, config_status: "2" } });
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", createDesktopValues), /not fully configured/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", createPoolValues), /not fully configured/);
  assert.equal(unconfigured.writes.length, 0);
  const unverifiedSubnets = mockCloud(t, { tenant: { ...tenant, subnet_ids: [] } });
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", createDesktopValues), /configured service subnets could not be verified/);
  assert.equal(unverifiedSubnets.writes.length, 0);
  const foreignVpc = mockCloud(t, { tenant: { ...tenant, vpc_id: "vpc-other" } });
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", createDesktopValues), /not in the workspace's configured VPC/);
  assert.equal(foreignVpc.writes.length, 0);
  const unknownCatalog = mockCloud(t, { vpcSubnets: [] });
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", createDesktopValues), /could not be verified against the project's VPC subnets/);
  assert.equal(unknownCatalog.writes.length, 0);
});

test("power actions re-check the fresh native status and cloud task state inside execute", async (t) => {
  const cloud = mockCloud(t);
  const start = await workspaceManagement.execute(session, "start", {}, desktopResource("desk-2", "Office-PC-2", "SHUTOFF"));
  assert.equal(start.jobId, "cloud-job");
  assert.equal(start.asynchronous, true);
  await workspaceManagement.execute(session, "stop", {}, desktopResource("desk-1", "Office-PC-1", "ACTIVE"));
  await workspaceManagement.execute(session, "reboot", {}, desktopResource("desk-1", "Office-PC-1", "ACTIVE"));
  await workspaceManagement.execute(session, "hibernate", {}, desktopResource("desk-1", "Office-PC-1", "ACTIVE"));
  assert.deepEqual(cloud.writes, [
    { path: "/v2/project-1/desktops/action", method: "POST", body: { desktop_ids: ["desk-2"], op_type: "os-start", type: "SOFT" } },
    { path: "/v2/project-1/desktops/action", method: "POST", body: { desktop_ids: ["desk-1"], op_type: "os-stop", type: "SOFT" } },
    { path: "/v2/project-1/desktops/action", method: "POST", body: { desktop_ids: ["desk-1"], op_type: "reboot", type: "SOFT" } },
    { path: "/v2/project-1/desktops/action", method: "POST", body: { desktop_ids: ["desk-1"], op_type: "os-hibernate", type: "SOFT" } },
  ]);
  await assert.rejects(workspaceManagement.execute(session, "start", {}, desktopResource("desk-1", "Office-PC-1", "SHUTOFF")), /shut-down desktop/);
  await assert.rejects(workspaceManagement.execute(session, "stop", {}, desktopResource("desk-2", "Office-PC-2", "ACTIVE")), /runs only on a running desktop/);
  await assert.rejects(workspaceManagement.execute(session, "start", {}, desktopResource("desk-3", "Office-PC-3", "BUILD")), /cloud task/);
  await assert.rejects(workspaceManagement.execute(session, "stop", {}, desktopResource("desk-4", "Office-PC-4", "ACTIVE")), /did not report the desktop's cloud task state/);
  assert.equal(cloud.writes.length, 4);
  assert.deepEqual(workspaceManagement.operations.find((item) => item.id === "start")!.allowedStatuses, ["SHUTOFF"]);
  assert.deepEqual(workspaceManagement.operations.find((item) => item.id === "stop")!.allowedStatuses, ["ACTIVE"]);
  for (const id of ["stop", "reboot", "hibernate", "delete-desktop"]) {
    const operation = workspaceManagement.operations.find((item) => item.id === id)!;
    assert.equal(operation.confirmation, true);
    assert.ok(operation.impact);
  }
});

test("a rejected batch power operation surfaces a sanitized native failure without mutating anything", async (t) => {
  const cloud = mockCloud(t, { actionFailure: { desktop_id: "desk-1", error_code: "WKS.0001", error_msg: "Desktop 10.0.0.1 is being\toperated" } });
  await assert.rejects(workspaceManagement.execute(session, "stop", {}, desktopResource("desk-1", "Office-PC-1", "ACTIVE")), /unsuccessful or unverifiable desktop operation result/);
  assert.equal(cloud.writes.length, 1);
});

test("a desktop creation without a native job ID stays uncertain instead of reporting success", async (t) => {
  mockCloud(t, { noJobId: true });
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", createDesktopValues), (error: Error) => !(error instanceof ManagementInputError) && /no job ID for the desktop creation/.test(error.message));
});

test("rename and snapshot settings verify convergence with a fresh read and refuse busy desktops", async (t) => {
  const cloud = mockCloud(t);
  const renamed = await workspaceManagement.execute(session, "rename-desktop", { name: "Renamed-PC" }, desktopResource("desk-1", "Office-PC-1"));
  assert.match(renamed.message, /renamed and verified/);
  const backup = await workspaceManagement.execute(session, "self-backup", { enable: true }, desktopResource("desk-1", "Office-PC-1"));
  assert.match(backup.message, /enabled and verified/);
  assert.deepEqual(cloud.writes, [
    { path: "/v2/project-1/desktops/desk-1", method: "PUT", body: { desktop: { computer_name: "Renamed-PC" } } },
    { path: "/v2/project-1/desktops/desk-1", method: "PUT", body: { desktop: { self_backup_management: "1" } } },
  ]);
  await assert.rejects(workspaceManagement.execute(session, "rename-desktop", { name: "Office-PC-2" }, desktopResource("desk-1", "Office-PC-1")), /already exists in the workspace/);
  await assert.rejects(workspaceManagement.execute(session, "rename-desktop", { name: "Nope" }, desktopResource("desk-3", "Office-PC-3")), /cloud task/);
  await assert.rejects(workspaceManagement.execute(session, "rename-desktop", { name: "Nope" }, desktopResource("desk-4", "Office-PC-4")), /did not report the desktop's cloud task state/);
  assert.equal(cloud.writes.length, 2);
  mockCloud(t, { applyPatches: false });
  const unverified = await workspaceManagement.execute(session, "rename-desktop", { name: "Renamed-PC" }, desktopResource("desk-1", "Office-PC-1"));
  assert.match(unverified.message, /could not verify/);
});

test("desktop deletion requires an idle, identifiable desktop and keeps watching until 404 proves it gone", async (t) => {
  const cloud = mockCloud(t, { deletesComplete: false });
  await assert.rejects(workspaceManagement.execute(session, "delete-desktop", {}, desktopResource("desk-3", "Office-PC-3")), /cloud task/);
  await assert.rejects(workspaceManagement.execute(session, "delete-desktop", {}, desktopResource("desk-4", "Office-PC-4")), /did not report the desktop's cloud task state/);
  await assert.rejects(workspaceManagement.execute(session, "delete-desktop", {}, desktopResource("desk-1", "Wrong-Name")), /now named "Office-PC-1"/);
  assert.equal(cloud.writes.length, 0);
  const outcome = await workspaceManagement.execute(session, "delete-desktop", {}, desktopResource("desk-1", "Office-PC-1"));
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, "desk-1");
  assert.match(outcome.message!, /keeps watching/);
  assert.deepEqual(cloud.writes, [{ path: "/v2/project-1/desktops/desk-1?delete_users=false&email_notification=false", method: "DELETE", body: undefined }]);
  const entry = historyEntry({ operation: "Delete desktop", resourceId: "desktop:desk-1", jobId: "desk-1" });
  assert.equal((await workspaceManagement.poll!(session, entry)).state, "submitted");
  cloud.finishDeletes();
  const done = await workspaceManagement.poll!(session, entry);
  assert.equal(done.state, "succeeded");
  assert.match(done.message!, /original resource gone/);
  mockCloud(t);
  const verified = await workspaceManagement.execute(session, "delete-desktop", {}, desktopResource("desk-1", "Office-PC-1"));
  assert.equal(verified.asynchronous, true);
  assert.match(verified.message!, /deletion accepted/);
});

test("workspace users are created without passwords, verified by a fresh read, and duplicates are refused", async (t) => {
  const cloud = mockCloud(t);
  await assert.rejects(workspaceManagement.execute(session, "create-user", { name: "alice", email: "alice@example.com" }), /already exists/);
  assert.equal(cloud.writes.length, 0);
  const outcome = await workspaceManagement.execute(session, "create-user", { name: "frank", email: "frank@example.com", description: "New hire" });
  assert.equal(outcome.resourceId, "user:user-new");
  assert.equal(outcome.asynchronous, undefined);
  assert.match(outcome.message, /created and verified/);
  assert.equal(cloud.writes.length, 1);
  const body = cloud.writes[0].body as Record<string, unknown>;
  assert.deepEqual(body, { user_name: "frank", user_email: "frank@example.com", active_type: "USER_ACTIVATE", description: "New hire" });
  assert.ok(!("password" in body));
  const operation = workspaceManagement.operations.find((item) => item.id === "create-user")!;
  assert.throws(() => validateManagementValues(operation, { name: "frank", email: "not-an-email" }, {}), /invalid format/);
});

test("user inspection reports verified settings without machine identifiers or secrets", async (t) => {
  mockCloud(t);
  const outcome = await workspaceManagement.execute(session, "inspect-user", {}, userResource("user-1", "alice"));
  assert.equal(outcome.message, "Current workspace user settings.");
  assert.ok(outcome.facts!.some((fact) => fact.label === "Email" && fact.value === "alice@example.com"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Desktops owned" && fact.value === "1"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Locked" && fact.value === "No"));
  assert.ok(!JSON.stringify(outcome).includes("S-1-2"));
  const unknown = await workspaceManagement.execute(session, "inspect-user", {}, userResource("user-5", "erin"));
  assert.ok(unknown.facts!.some((fact) => fact.label === "Locked" && fact.value === "Unknown"));
  await assert.rejects(workspaceManagement.execute(session, "inspect-user", {}, userResource("user-9", "Ghost")), /HTTP 404/);
});

test("user updates send only the entered settings, verify convergence, and check the returned identity", async (t) => {
  const cloud = mockCloud(t);
  const updated = await workspaceManagement.execute(session, "update-user", { description: "Updated" }, userResource("user-1", "alice"));
  assert.match(updated.message, /updated and verified/);
  await workspaceManagement.execute(session, "update-user", { email: "alice2@example.com" }, userResource("user-1", "alice"));
  assert.deepEqual(cloud.writes, [
    { path: "/v2/project-1/users/user-1", method: "PUT", body: { description: "Updated" } },
    { path: "/v2/project-1/users/user-1", method: "PUT", body: { user_email: "alice2@example.com" } },
  ]);
  await assert.rejects(workspaceManagement.execute(session, "update-user", {}, userResource("user-1", "alice")), /Enter a new email or description/);
  assert.equal(cloud.writes.length, 2);
  const mismatch = mockCloud(t, { userUpdateReplyId: "user-other" });
  await assert.rejects(workspaceManagement.execute(session, "update-user", { description: "Updated" }, userResource("user-1", "alice")), /different workspace user ID/);
  assert.equal(mismatch.writes.length, 1);
});

test("lock and unlock verify the native lock state before and after the action", async (t) => {
  const cloud = mockCloud(t);
  await assert.rejects(workspaceManagement.execute(session, "lock-user", {}, userResource("user-2", "bob", "LOCKED")), /already locked/);
  await assert.rejects(workspaceManagement.execute(session, "unlock-user", {}, userResource("user-1", "alice", "ACTIVE")), /not locked/);
  await assert.rejects(workspaceManagement.execute(session, "lock-user", {}, userResource("user-5", "erin", "UNKNOWN")), /lock state could not be verified/);
  assert.equal(cloud.writes.length, 0);
  const locked = await workspaceManagement.execute(session, "lock-user", {}, userResource("user-1", "alice", "ACTIVE"));
  assert.match(locked.message, /locked and verified/);
  const unlocked = await workspaceManagement.execute(session, "unlock-user", {}, userResource("user-2", "bob", "LOCKED"));
  assert.match(unlocked.message, /unlocked and verified/);
  assert.deepEqual(cloud.writes, [
    { path: "/v2/project-1/users/user-1/actions", method: "POST", body: { op_type: "LOCK" } },
    { path: "/v2/project-1/users/user-2/actions", method: "POST", body: { op_type: "UNLOCK" } },
  ]);
  assert.deepEqual(workspaceManagement.operations.find((item) => item.id === "lock-user")!.allowedStatuses, ["ACTIVE"]);
  assert.deepEqual(workspaceManagement.operations.find((item) => item.id === "unlock-user")!.allowedStatuses, ["LOCKED"]);
});

test("user deletion blocks on unverified counts, live inventory assignments, and stale confirmations", async (t) => {
  const cloud = mockCloud(t);
  await assert.rejects(workspaceManagement.execute(session, "delete-user", {}, userResource("user-1", "alice")), /still owns 1 desktop/);
  await assert.rejects(workspaceManagement.execute(session, "delete-user", {}, userResource("user-3", "carol")), /still owns 2 desktops/);
  await assert.rejects(workspaceManagement.execute(session, "delete-user", {}, userResource("user-4", "dave")), /desktop ownership could not be verified/);
  await assert.rejects(workspaceManagement.execute(session, "delete-user", {}, userResource("user-2", "bob")), /live inventory still lists 2 desktops/);
  await assert.rejects(workspaceManagement.execute(session, "delete-user", {}, userResource("user-5", "Wrong-Name")), /now named "erin"/);
  assert.equal(cloud.writes.length, 0);
  const outcome = await workspaceManagement.execute(session, "delete-user", {}, userResource("user-5", "erin"));
  assert.equal(outcome.asynchronous, true);
  assert.match(outcome.message!, /deletion accepted/);
  assert.deepEqual(cloud.writes, [{ path: "/v2/project-1/users/user-5", method: "DELETE", body: undefined }]);
});

test("user deletion keeps watching when the account is still present", async (t) => {
  const cloud = mockCloud(t, { deletesComplete: false });
  const outcome = await workspaceManagement.execute(session, "delete-user", {}, userResource("user-5", "erin"));
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, "user-5");
  const entry = historyEntry({ operation: "Delete user", resourceId: "user:user-5", jobId: "user-5" });
  assert.equal((await workspaceManagement.poll!(session, entry)).state, "submitted");
  cloud.finishDeletes();
  assert.equal((await workspaceManagement.poll!(session, entry)).state, "succeeded");
});

test("desktop pools are created from live catalogs with fresh authorized users and the workspace network ID", async (t) => {
  const cloud = mockCloud(t);
  const outcome = await workspaceManagement.execute(session, "create-pool", createPoolValues);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(cloud.writes, [{ path: "/v2/project-1/desktop-pools", method: "POST", body: {
    name: "Night-Shift", type: "DYNAMIC", size: 5, description: "Shift pool", availability_zone: "az-1", product_id: "prod-win", image_type: "gold", image_id: "img-gold-win",
    root_volume: { type: "SSD", size: 80 }, vpc_id: "vpc-1", subnet_ids: ["net-1"],
    authorized_objects: [
      { object_type: "USER", object_id: "user-1", object_name: "alice", user_group: "administrators" },
      { object_type: "USER", object_id: "user-3", object_name: "carol", user_group: "administrators" },
    ],
  } }]);
});

test("pool creation refuses duplicates, unsafe products, invalid bounds, and non-active users before any cloud mutation", async (t) => {
  const cloud = mockCloud(t);
  const values: ManagementValues = { ...createPoolValues, name: "Team-Pool", type: "STATIC", size: 1, users: ["user-1"] };
  await assert.rejects(workspaceManagement.execute(session, "create-pool", values), /already exists in the workspace/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", product: "prod-sub" }), /subscription products require an explicit order workflow/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", product: "prod-notbase", image: "img-priv-linux", userGroup: "sudo", zone: "az-2" }), /basic \(BASE\) product package/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", users: ["user-9"] }), /no longer available in this workspace/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", users: ["user-2"] }), /locked, disabled, or unverified/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", users: ["user-5"] }), /locked, disabled, or unverified/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", users: ["user-1", "user-1"] }), /must not contain duplicates/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", users: [] }), /at least one authorized/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", type: "MIXED" }), /valid desktop pool type/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", size: 0 }), /between 1 and 100/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", size: 101 }), /between 1 and 100/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", userGroup: "sudo" }), /does not match the selected Windows image/);
  await assert.rejects(workspaceManagement.execute(session, "create-pool", { ...values, name: "Fresh-Pool", subnet: "wsubnet-2" }), /network ID/);
  assert.equal(cloud.writes.length, 0);
});

test("pool inspection reports verified counts and configuration", async (t) => {
  mockCloud(t);
  const inspection = await workspaceManagement.execute(session, "inspect-pool", {}, poolResource("pool-1", "Team-Pool"));
  assert.ok(inspection.facts!.some((fact) => fact.label === "Desktops in pool" && fact.value === "2"));
  assert.ok(inspection.facts!.some((fact) => fact.label === "Charging mode" && fact.value === "Pay-per-use"));
  assert.ok(inspection.facts!.some((fact) => fact.label === "Product" && fact.value.includes("8 GB memory")));
  const unknown = await workspaceManagement.execute(session, "inspect-pool", {}, poolResource("pool-4", "Unknown-Pool"));
  assert.ok(unknown.facts!.some((fact) => fact.label === "Desktops in pool" && fact.value === "Unknown"));
});

test("pool deletion blocks on counts, busy tasks, live inventory, and stale names, then watches until gone", async (t) => {
  const cloud = mockCloud(t);
  await assert.rejects(workspaceManagement.execute(session, "delete-pool", {}, poolResource("pool-1", "Team-Pool")), /still contains 2 desktops/);
  await assert.rejects(workspaceManagement.execute(session, "delete-pool", {}, poolResource("pool-2", "Empty-Pool")), /live inventory still lists desktops/);
  await assert.rejects(workspaceManagement.execute(session, "delete-pool", {}, poolResource("pool-4", "Unknown-Pool")), /desktop count could not be verified/);
  await assert.rejects(workspaceManagement.execute(session, "delete-pool", {}, poolResource("pool-5", "Busy-Pool")), /cloud task/);
  await assert.rejects(workspaceManagement.execute(session, "delete-pool", {}, poolResource("pool-3", "Wrong-Name")), /now named "Idle-Pool"/);
  assert.equal(cloud.writes.length, 0);
  const outcome = await workspaceManagement.execute(session, "delete-pool", {}, poolResource("pool-3", "Idle-Pool"));
  assert.equal(outcome.asynchronous, true);
  assert.match(outcome.message!, /deletion accepted/);
  assert.deepEqual(cloud.writes, [{ path: "/v2/project-1/desktop-pools/pool-3", method: "DELETE", body: undefined }]);
  const slow = mockCloud(t, { deletesComplete: false });
  const watching = await workspaceManagement.execute(session, "delete-pool", {}, poolResource("pool-3", "Idle-Pool"));
  assert.equal(watching.asynchronous, true);
  assert.equal(watching.jobId, "pool-3");
  const entry = historyEntry({ operation: "Delete empty pool", resourceId: "pool:pool-3", jobId: "pool-3" });
  assert.equal((await workspaceManagement.poll!(session, entry)).state, "submitted");
  slow.finishDeletes();
  assert.equal((await workspaceManagement.poll!(session, entry)).state, "succeeded");
});

test("job polling whitelists exact native statuses, never leaks the private fail_reason, and verifies job identity", async (t) => {
  const replies = [
    { id: "cloud-job", status: "SUCCESS", sub_jobs: [{ entities: { desktop_id: "desk-9" }, status: "SUCCESS", project_id: "project-1" }] },
    { id: "cloud-job", status: "COMPLETE", sub_jobs: [{ entities: { desktop_id: "desk-9" }, status: "SUCCESS" }] },
    { id: "cloud-job", status: "FAIL", fail_reason: "Insufficient quota PRIVATE" },
    { id: "cloud-job", status: "WAITING" },
    { id: "cloud-job" },
    { id: "other-job", status: "SUCCESS" },
  ];
  mockCloud(t, { jobReplies: replies });
  const entry = historyEntry({ jobId: "cloud-job" });
  const succeeded = await workspaceManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "desktop:desk-9");
  assert.equal((await workspaceManagement.poll!(session, entry)).state, "succeeded");
  const failed = await workspaceManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.ok(!failed.message!.includes("Insufficient quota"));
  assert.match(failed.message!, /not surfaced/);
  const waiting = await workspaceManagement.poll!(session, entry);
  assert.equal(waiting.state, "submitted");
  assert.match(waiting.message!, /still processing/);
  const silent = await workspaceManagement.poll!(session, entry);
  assert.equal(silent.state, "submitted");
  assert.match(silent.message!, /still processing/);
  await assert.rejects(workspaceManagement.poll!(session, entry), /different Workspace job/);
  await assert.rejects(workspaceManagement.poll!(session, historyEntry({})), /no Workspace job reference/);
});

test("job polling rejects jobs that belong to another project or desktop", async (t) => {
  mockCloud(t, { jobReplies: [{ id: "cloud-job", status: "RUNNING", sub_jobs: [{ project_id: "other-project", entities: { desktop_id: "desk-9" } }] }] });
  await assert.rejects(workspaceManagement.poll!(session, historyEntry({ jobId: "cloud-job" })), /another project/);
  mockCloud(t, { jobReplies: [{ id: "cloud-job", status: "RUNNING", sub_jobs: [{ project_id: "project-1", entities: { desktop_id: "desk-2" } }] }] });
  await assert.rejects(workspaceManagement.poll!(session, historyEntry({ jobId: "cloud-job", resourceId: "desktop:desk-1" })), /different desktop/);
});

test("delete polling refuses inconsistent records", async (t) => {
  mockCloud(t);
  await assert.rejects(workspaceManagement.poll!(session, historyEntry({ operation: "Delete desktop", resourceId: "desktop:desk-1", jobId: "desk-9" })), /inconsistent/);
  await assert.rejects(workspaceManagement.poll!(session, historyEntry({ operation: "Delete desktop", resourceId: undefined, jobId: "desk-1" })), /inconsistent/);
});

test("invalidation keys use the real reader cache keys instead of invented ones", () => {
  assert.deepEqual(workspaceManagement.invalidationKeys(), ["listWorkspaceTenants", "listWorkspaceResources", "cloud-summary"]);
  assert.deepEqual(workspaceManagement.invalidationKeys(desktopResource("desk-1", "Office-PC-1")), ["listWorkspaceTenants", "listWorkspaceResources", "cloud-summary"]);
});

test("impact statements explain licensed-OS pricing and honest deletion billing without unprovable license claims", () => {
  const create = workspaceManagement.operations.find((item) => item.id === "create-desktop")!;
  assert.ok(create.impact!.includes("image licensing"));
  assert.ok(!create.impact!.includes("add-on license"));
  const pool = workspaceManagement.operations.find((item) => item.id === "create-pool")!;
  assert.ok(pool.impact!.includes("image licensing"));
  const remove = workspaceManagement.operations.find((item) => item.id === "delete-desktop")!;
  assert.ok(remove.impact!.includes("keeps watching"));
  assert.ok(remove.impact!.includes("Review final charges"));
});

test("the form contract whitelists live choices and enforces the documented name rules", async (t) => {
  mockCloud(t);
  const operation = workspaceManagement.operations.find((item) => item.id === "create-desktop")!;
  const choices = await workspaceManagement.options!(session, "create-desktop");
  const values = validateManagementValues(operation, createDesktopValues, choices);
  assert.equal(values.name, "New-PC");
  assert.throws(() => validateManagementValues(operation, { ...createDesktopValues, product: "forged-product" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createDesktopValues, user: "bob" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createDesktopValues, name: "Bad-Name-" }, choices), /invalid format/);
  assert.equal(validateManagementValues(operation, { ...createDesktopValues, name: "X" }, choices).name, "X");
});

test("desktop inspection reports configuration without private addresses or machine identifiers", async (t) => {
  mockCloud(t);
  const outcome = await workspaceManagement.execute(session, "inspect-desktop", {}, desktopResource("desk-1", "Office-PC-1"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Computer name" && fact.value === "Office-PC-1"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Assigned user" && fact.value === "alice"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "System disk" && fact.value === "SSD · 80 GB"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Product" && fact.value.includes("8 GB memory")));
  assert.ok(!JSON.stringify(outcome).includes("10.0.0.1"));
  assert.ok(!JSON.stringify(outcome).includes("S-1-1"));
  await assert.rejects(workspaceManagement.execute(session, "inspect-desktop", {}, desktopResource("desk-9", "Ghost")), /HTTP 404/);
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const cloud = mockCloud(t);
  await assert.rejects(workspaceManagement.execute(session, "attach-eip", {}, desktopResource("desk-1", "Office-PC-1")), /Unsupported Workspace operation/);
  await assert.rejects(workspaceManagement.execute(session, "inspect-desktop", {}), /Select a desktop/);
  assert.equal(cloud.writes.length, 0);
});

test("desktop pagination completes every page", async (t) => {
  const offsets: string[] = [];
  const generated = Array.from({ length: 101 }, (_, index) => ({ desktop_id: `desk-${index}`, computer_name: `PC-${index}`, status: "ACTIVE", user_name: "alice", task_status: "" }));
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v2/project-1/desktops") {
      offsets.push(url.searchParams.get("offset") ?? "0");
      return Response.json({ desktops: page(generated, url), total_count: generated.length });
    }
    return Response.json(mockCloudRead(url));
  });
  const resources = await workspaceManagement.inventory(session);
  assert.equal(resources.filter((item) => item.id.startsWith("desktop:")).length, 101);
  assert.deepEqual(offsets, ["0", "100"]);
});

function overrideRead(t: TestContext, match: (url: URL) => boolean, reply: () => Response) {
  const original = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => !init?.method && match(new URL(input)) ? reply() : original(input, init));
}

test("root: malformed successful detail responses never prove deletion", async t => {
  mockCloud(t);
  let reply: unknown = {};
  overrideRead(t, url => /\/(desktops|users|desktop-pools)\/[^/]+$/.test(url.pathname), () => Response.json(reply));
  for (const [operation, resourceId, jobId] of [["Delete desktop", "desktop:desk-1", "desk-1"], ["Delete user", "user:user-1", "user-1"], ["Delete empty pool", "pool:pool-1", "pool-1"]]) {
    await assert.rejects(workspaceManagement.poll!(session, historyEntry({ operation, resourceId, jobId })), /unverifiable .*identity/);
  }
  reply = { desktop: { desktop_id: "foreign", project_id: "other" } };
  await assert.rejects(workspaceManagement.poll!(session, historyEntry({ operation: "Delete desktop", resourceId: "desktop:desk-1", jobId: "desk-1" })), /unverifiable Workspace response/);
});

test("root: deletion observers require operation-specific resource prefixes", async t => {
  const cloud = mockCloud(t);
  await assert.rejects(workspaceManagement.poll!(session, historyEntry({ operation: "Delete user", resourceId: "desktop:desk-1", jobId: "desk-1" })), /inconsistent/);
  await assert.rejects(workspaceManagement.poll!(session, historyEntry({ operation: "invented", jobId: "cloud-job" })), /Unsupported/);
  assert.equal(cloud.reads.length, 0);
});

test("root: incomplete pagination totals and foreign project fields are rejected", async t => {
  mockCloud(t);
  let body: unknown = { desktops: [] };
  overrideRead(t, url => url.pathname === "/v2/project-1/desktops", () => Response.json(body));
  for (const total_count of [undefined, null, "0", -1, 0.5]) {
    body = { desktops: [], total_count };
    await assert.rejects(workspaceManagement.inventory(session), /incomplete Workspace/);
  }
  for (const project_id of ["other", "", null]) {
    body = { desktops: [{ desktop_id: "d", computer_name: "D", project_id }], total_count: 1 };
    await assert.rejects(workspaceManagement.inventory(session), /unverifiable Workspace response/);
  }
});

test("root: native errors and malformed JSON preserve no private payload", async t => {
  const secret = "PRIVATE_PASSWORD token=secret 10.0.0.1";
  const replies = [Response.json({ error_msg: secret }, { status: 403 }), Response.json({ error_code: "PRIVATE", error_msg: secret }), new Response(secret)];
  t.mock.method(globalThis, "fetch", async () => replies.shift()!);
  await assert.rejects(workspaceManagement.execute(session, "inspect-desktop", {}, desktopResource("d", "D")), (error: unknown) => error instanceof HuaweiApiError && error.status === 403 && !error.message.includes(secret));
  for (let index = 0; index < 2; index++) await assert.rejects(workspaceManagement.execute(session, "inspect-desktop", {}, desktopResource("d", "D")), (error: Error) => !error.message.includes(secret));
});

test("root: desktop and pool deletion require native pay-per-use and stable state", async t => {
  const cloud = mockCloud(t);
  for (const charging_mode of [undefined, null, "", "0", 1]) {
    cloud.store.desktops[0].metadata = { charging_mode };
    await assert.rejects(workspaceManagement.execute(session, "delete-desktop", {}, desktopResource("desk-1", "Office-PC-1")), /pay-per-use/);
    cloud.store.pools[2].charging_mode = charging_mode;
    await assert.rejects(workspaceManagement.execute(session, "delete-pool", {}, poolResource("pool-3", "Idle-Pool")), /pay-per-use/);
  }
  cloud.store.pools[2].charging_mode = "1";
  for (const status of [undefined, "TEMPORARY", "UNKNOWN", "PRIVATE_SECRET"]) {
    cloud.store.pools[2].status = status;
    await assert.rejects(workspaceManagement.execute(session, "delete-pool", {}, poolResource("pool-3", "Idle-Pool")), /steady/);
  }
  assert.equal(cloud.writes.length, 0);
});

test("root: provisioning checks current agency permissions without granting them", async t => {
  const cloud = mockCloud(t);
  let permissions: unknown = [];
  overrideRead(t, url => url.pathname.endsWith("/agencies"), () => Response.json({ existing_agencies: [{ name: "ServiceLinkedAgencyForWorkspace", permissions }] }));
  for (const value of [undefined, [], [{ system_permission_display_names: [], wanted_system_permission_display_names: [], should_have_system_permission_display_names: ["WorkspaceServiceLinkedAgencyPolicy"] }], [{ system_permission_display_names: ["WorkspaceServiceLinkedAgencyPolicy"], wanted_system_permission_display_names: ["WorkspaceServiceLinkedAgencyPolicy"], should_have_system_permission_display_names: ["WorkspaceServiceLinkedAgencyPolicy"] }]]) {
    permissions = value;
    for (const [operation, values] of [["create-desktop", createDesktopValues], ["create-pool", createPoolValues]] as const) await assert.rejects(workspaceManagement.execute(session, operation, values), /agency/);
  }
  assert.equal(cloud.writes.length, 0);
  assert.ok(cloud.reads.every(path => !path.includes("/agencies") || path.includes("scene=WORKSPACE")));
});

test("root: subnet identity must match both native VPC fields exactly", async t => {
  const cloud = mockCloud(t, { vpcSubnets: [{ ...vpcSubnets[0], neutron_subnet_id: "other", neutron_network_id: "net-1" }] });
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", createDesktopValues), /verified against/);
  assert.equal(cloud.writes.length, 0);
});

test("root: missing or numeric tenant configuration and subnet totals block provisioning", async t => {
  const cloud = mockCloud(t, { tenant: { ...tenant, config_status: 0 } });
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", createDesktopValues), /fully configured/);
  mockCloud(t);
  overrideRead(t, url => url.pathname === "/v2/project-1/subnets", () => Response.json({ subnets: workspaceSubnets }));
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", createDesktopValues), /incomplete workspace subnet/);
  assert.equal(cloud.writes.length, 0);
});

test("root: user deletion blocks direct and unresolved group pool authorizations", async t => {
  const cloud = mockCloud(t);
  let object_type = "USER";
  overrideRead(t, url => /\/desktop-pools\/[^/]+\/users$/.test(url.pathname), () => Response.json({ objects: [{ object_type, object_id: "user-5", object_name: "erin" }], total_count: 1 }));
  await assert.rejects(workspaceManagement.execute(session, "delete-user", {}, userResource("user-5", "erin")), /pool authorization/);
  object_type = "USER_GROUP";
  await assert.rejects(workspaceManagement.execute(session, "delete-user", {}, userResource("user-5", "erin")), /pool authorization/);
  assert.equal(cloud.writes.length, 0);
});

test("root: job polling requires original identity and complete successful subtasks", async t => {
  mockCloud(t);
  let body: unknown = { status: "SUCCESS", sub_jobs: [], sub_jobs_total: 0 };
  overrideRead(t, url => url.pathname.includes("/workspace-jobs/"), () => Response.json(body));
  const entry = historyEntry({ jobId: "cloud-job" });
  await assert.rejects(workspaceManagement.poll!(session, entry), /job identity/);
  body = { id: "cloud-job", status: "COMPLETE", sub_jobs: [], sub_jobs_total: 1 };
  await assert.rejects(workspaceManagement.poll!(session, entry), /incomplete/);
  for (const sub_jobs of [[], [{ id: "sub", entities: { desktop_id: "d" }, status: "RUNNING" }]]) {
    body = { id: "cloud-job", status: "COMPLETE", sub_jobs, sub_jobs_total: sub_jobs.length };
    assert.equal((await workspaceManagement.poll!(session, entry)).state, "submitted");
  }
  body = { id: "cloud-job", status: "COMPLETE", sub_jobs: [{ id: "sub", job_id: "other", status: "SUCCESS" }], sub_jobs_total: 1 };
  await assert.rejects(workspaceManagement.poll!(session, entry), /another Workspace job/);
  body = { id: "cloud-job", status: "PRIVATE_PASSWORD", sub_jobs: [], sub_jobs_total: 0 };
  assert.ok(!(await workspaceManagement.poll!(session, entry)).message!.includes("PRIVATE_PASSWORD"));
});

test("root: accepted writes survive unavailable post-write verification", async t => {
  const cloud = mockCloud(t);
  const original = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => !init?.method && cloud.writes.length ? Response.json({ error_msg: "PRIVATE" }, { status: 503 }) : original(input, init));
  const outcome = await workspaceManagement.execute(session, "rename-desktop", { name: "Renamed-PC" }, desktopResource("desk-1", "Office-PC-1"));
  assert.equal(outcome.resourceId, "desktop:desk-1");
  assert.match(outcome.message, /accepted.*could not verify/);
});

test("root: image minimum disk and memory requirements are checked against the selected product", async t => {
  const cloud = mockCloud(t);
  let min_ram = 16384;
  overrideRead(t, url => url.pathname.endsWith("/images"), () => Response.json({ images: [{ ...images[0], min_ram, min_disk: 80 }], total_count: 1 }));
  await assert.rejects(workspaceManagement.execute(session, "create-desktop", createDesktopValues), /image's disk or memory/);
  min_ram = 0;
  const outcome = await workspaceManagement.execute(session, "create-desktop", createDesktopValues);
  assert.equal(outcome.jobId, "cloud-job");
  assert.equal(cloud.writes.length, 1);
});
