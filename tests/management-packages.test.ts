import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { packagesManagement } from "@/lib/huawei/management/adapters/packages";
import { CloudLoadError } from "@/lib/huawei/errors";
import { HuaweiApiError } from "@/lib/huawei/http";
import { ManagementInputError } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const account = { ...session, accountToken: "account-token" };
const packageRow = (instance = "purchase-1", scope: string | null = null) => ({ order_instance_id: instance, product_id: "offering-1", product_name: "OBS storage", order_id: "order-1", enterprise_project_id: scope, status: 1, region_code: "sa-brazil-1", service_type_code: "hws.service.type.obs", quota_reuse_mode: 1, free_resources: [{ free_resource_id: "item-1", usage_type_name: "Storage", amount: "10.0001", original_amount: "100", measure_id: 10 }], effective_time: "2026-01-01T00:00:00Z", expire_time: "2027-01-01T00:00:00Z" });
const chosen = { id: "package:purchase-1", name: "OBS storage", values: { enterpriseProject: "" } };
function cloud(t: TestContext, reply?: (url: URL, body: Record<string, unknown>) => Response | undefined) {
  const calls: { path: string; method: string; body: Record<string, unknown>; query: Record<string, string> }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input), body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    assert.equal(new Headers(init?.headers).get("X-Auth-Token"), "account-token");
    calls.push({ path: url.pathname, method: init?.method ?? "GET", body, query: Object.fromEntries(url.searchParams) });
    const custom = reply?.(url, body); if (custom) return custom;
    if (url.pathname.endsWith("/enterprise-projects")) return Response.json({ enterprise_projects: [], total_count: 0 });
    if (url.pathname.endsWith("/free-resources/query")) return Response.json({ free_resource_packages: [packageRow()], total_count: 1 });
    if (url.pathname.endsWith("/measurements")) return Response.json({ measure_units: [{ measure_id: 10, measure_name: "GB", abbreviation: "GB" }] });
    if (url.pathname.endsWith("/usages/details/query")) return Response.json({ free_resources: [{ free_resource_id: "item-1", usage_type_name: "Storage", amount: "9.999", original_amount: "100", measure_id: 10, start_time: "2026-10-01T00:00:00Z", end_time: "2026-11-01T00:00:00Z" }] });
    if (url.pathname.endsWith("/free-resources-usage-records")) return Response.json({ free_resource_records: [{ free_resource_id: "item-1", resource_id: "bucket-1", product_id: "offering-1", deduct_time: "2026-10-01T12:00:00Z", used_amount: "0.001", remaining_amount: "9.999", measure_id: 10 }], total_count: 1 });
    throw new Error("Unexpected package test endpoint");
  });
  return calls;
}

test("packages use account tokens and native purchased-instance identities", async t => {
  const calls = cloud(t);
  const resources = await packagesManagement.inventory(account);
  assert.equal(packagesManagement.accountWide, true);
  assert.equal(resources[0].id, "package:purchase-1");
  assert.equal(resources[0].status, "In effect");
  assert.ok(calls.some(call => call.path === "/v3/payments/free-resources/query" && call.method === "POST" && call.body.limit === 100 && call.body.offset === 0));
  assert.ok(calls.every(call => !("region_code" in call.body)));
});

test("package list and EPS queries complete subsequent offset pages", async t => {
  const calls = cloud(t, (url, body) => {
    if (url.pathname.endsWith("/enterprise-projects")) return Response.json({ enterprise_projects: [{ id: "ep-1" }], total_count: 1 });
    if (!url.pathname.endsWith("/free-resources/query")) return undefined;
    if (body.enterprise_project_id) return Response.json({ free_resource_packages: [packageRow("ep-purchase", "ep-1")], total_count: 1 });
    const offset = Number(body.offset);
    return Response.json({ free_resource_packages: Array.from({ length: offset ? 1 : 100 }, (_, index) => packageRow(`purchase-${index + offset}`)), total_count: 101 });
  });
  const result = await packagesManagement.inventory(account);
  assert.equal(result.length, 102);
  assert.ok(calls.some(call => call.body.offset === 100));
  assert.ok(calls.some(call => call.body.enterprise_project_id === "ep-1"));
});

test("two purchases of the same offering remain distinct", async t => {
  cloud(t, url => url.pathname.endsWith("/free-resources/query") ? Response.json({ free_resource_packages: [packageRow("purchase-1"), packageRow("purchase-2")], total_count: 2 }) : undefined);
  assert.deepEqual((await packagesManagement.inventory(account)).map(row => row.id), ["package:purchase-1", "package:purchase-2"]);
});

test("incomplete EPS permissions retain visible default packages as uncached partial data", async t => {
  cloud(t, url => url.pathname.endsWith("/enterprise-projects") ? Response.json({ error_msg: "PRIVATE" }, { status: 403 }) : undefined);
  await assert.rejects(packagesManagement.inventory(account), (error: unknown) => error instanceof CloudLoadError && Array.isArray(error.partialData) && error.partialData[0].id === "package:purchase-1" && !error.message.includes("PRIVATE"));
});

test("package pages require arrays and numeric complete totals", async t => {
  let response: unknown = {};
  cloud(t, url => url.pathname.endsWith("/free-resources/query") ? Response.json(response) : undefined);
  for (const body of [{}, { total_count: 0 }, { free_resource_packages: [], total_count: null }, { free_resource_packages: [], total_count: "0" }]) {
    response = body;
    await assert.rejects(packagesManagement.inventory(account), CloudLoadError);
  }
});

test("native purchase and item identities cannot be missing or duplicated", async t => {
  let row: unknown = {};
  cloud(t, url => url.pathname.endsWith("/free-resources/query") ? Response.json({ free_resource_packages: [row], total_count: 1 }) : undefined);
  for (const value of [{ ...packageRow(), order_instance_id: "" }, { ...packageRow(), free_resources: undefined }, { ...packageRow(), free_resources: [{ free_resource_id: "a" }, { free_resource_id: "a" }] }]) {
    row = value;
    await assert.rejects(packagesManagement.inventory(account), CloudLoadError);
  }
});

test("enterprise-project queries independently reject foreign packages", async t => {
  cloud(t, (url, body) => url.pathname.endsWith("/enterprise-projects") ? Response.json({ enterprise_projects: [{ id: "ep-1" }], total_count: 1 }) : url.pathname.endsWith("/free-resources/query") && body.enterprise_project_id ? Response.json({ free_resource_packages: [packageRow("p", "ep-2")], total_count: 1 }) : undefined);
  await assert.rejects(packagesManagement.inventory(account), CloudLoadError);
  await assert.rejects(packagesManagement.execute(account, "inspect", {}, { ...chosen, values: { enterpriseProject: "ep-1" } }), /another enterprise project/);
});

test("inspection preserves decimal quantities and resolves native measurement units", async t => {
  cloud(t);
  const result = await packagesManagement.execute(account, "inspect", {}, chosen);
  assert.ok(result.facts!.some(fact => fact.value === "10.0001 GB remaining of 100 GB"));
  assert.ok(result.facts!.some(fact => fact.label === "Reset mode" && fact.value === "Resettable"));
  assert.equal(result.resourceId, chosen.id);
});

test("current usage sends item IDs belonging to the selected original purchase", async t => {
  const calls = cloud(t);
  const result = await packagesManagement.execute(account, "usage", {}, chosen);
  assert.deepEqual(calls.find(call => call.path.endsWith("/usages/details/query"))?.body, { free_resource_ids: ["item-1"] });
  assert.match(result.facts![0].value, /9.999 GB.*2026-10-01/);
});

test("current usage rejects missing, duplicate, and foreign item results", async t => {
  let value: unknown = [];
  cloud(t, url => url.pathname.endsWith("/usages/details/query") ? Response.json({ free_resources: value }) : undefined);
  for (const items of [undefined, [], [{ free_resource_id: "foreign" }], [{ free_resource_id: "item-1" }, { free_resource_id: "item-1" }]]) {
    value = items;
    await assert.rejects(packagesManagement.execute(account, "usage", {}, chosen), /incomplete|identities|missing or foreign/);
  }
});

test("deduction form choices come from the selected package", async t => {
  cloud(t);
  assert.deepEqual(await packagesManagement.options!(account, "records", chosen), { items: [{ value: "item-1", label: "Storage" }] });
  assert.deepEqual(await packagesManagement.options!(account, "records"), {});
});

test("deduction date filters use native item ID and UTC+08:00 contract", async t => {
  const calls = cloud(t);
  const result = await packagesManagement.execute(account, "records", { item: "item-1", begin: "2026-10-01", end: "2026-10-02" }, chosen);
  assert.equal(calls.at(-1)?.query.free_resource_id, "item-1");
  assert.equal(calls.at(-1)?.query.deduct_time_begin, "2026-10-01");
  assert.match(result.facts![0].value, /0.001 GB deducted/);
});

test("invalid, inverted, overlong dates and forged item choices never query deductions", async t => {
  const calls = cloud(t);
  for (const values of [{ item: "foreign", begin: "2026-10-01", end: "2026-10-02" }, { item: "item-1", begin: "2026-02-30", end: "2026-03-01" }, { item: "item-1", begin: "2026-10-02", end: "2026-10-01" }, { item: "item-1", begin: "2026-01-01", end: "2026-10-01" }]) await assert.rejects(packagesManagement.execute(account, "records", values, chosen), ManagementInputError);
  assert.ok(!calls.some(call => call.path.endsWith("/free-resources-usage-records")));
});

test("deduction responses verify original item, offering, resource, and date", async t => {
  let row: Record<string, unknown> = {};
  cloud(t, url => url.pathname.endsWith("/free-resources-usage-records") ? Response.json({ free_resource_records: [row], total_count: 1 }) : undefined);
  const valid = { free_resource_id: "item-1", product_id: "offering-1", resource_id: "bucket-1", deduct_time: "2026-10-01T12:00:00Z" };
  for (const patch of [{ free_resource_id: "other" }, { product_id: "other" }, { resource_id: null }, { deduct_time: "bad" }, { deduct_time: "2026-10-03T00:00:00Z" }]) {
    row = { ...valid, ...patch };
    await assert.rejects(packagesManagement.execute(account, "records", { item: "item-1", begin: "2026-10-01", end: "2026-10-02" }, chosen), /unverifiable or foreign/);
  }
});

test("missing original purchases cannot resolve by offering ID or imply unsubscription", async t => {
  cloud(t);
  await assert.rejects(packagesManagement.execute(account, "inspect", {}, { ...chosen, id: "package:offering-1" }), /original package.*retention window/);
});

test("unknown native states and quotas remain unknown without fabricated zero balances", async t => {
  cloud(t, url => url.pathname.endsWith("/free-resources/query") ? Response.json({ free_resource_packages: [{ ...packageRow(), status: "1", quota_reuse_mode: null, free_resources: [{ free_resource_id: "i", amount: null, original_amount: "bad", measure_id: 10 }] }], total_count: 1 }) : undefined);
  const result = await packagesManagement.execute(account, "inspect", {}, chosen);
  assert.ok(result.facts!.some(fact => fact.label === "Status" && fact.value === "Unknown"));
  assert.ok(result.facts!.some(fact => fact.value === "Unknown GB remaining of Unknown GB"));
});

test("private HTTP, business, and non-JSON responses are sanitized", async t => {
  let response = () => Response.json({ error_msg: "PRIVATE_PASSWORD" }, { status: 403 });
  cloud(t, url => url.pathname.endsWith("/free-resources/query") ? response() : undefined);
  await assert.rejects(packagesManagement.execute(account, "inspect", {}, chosen), (error: unknown) => error instanceof HuaweiApiError && error.status === 403 && !error.message.includes("PRIVATE_PASSWORD"));
  response = () => Response.json({ error_code: "PRIVATE", error_msg: "PRIVATE_PASSWORD" });
  await assert.rejects(packagesManagement.execute(account, "inspect", {}, chosen), (error: Error) => !error.message.includes("PRIVATE_PASSWORD"));
  response = () => new Response("PRIVATE_PASSWORD");
  await assert.rejects(packagesManagement.execute(account, "inspect", {}, chosen), (error: Error) => !error.message.includes("PRIVATE_PASSWORD"));
});

test("unsupported procurement operations and missing account tokens fail without requests", async t => {
  const calls = cloud(t);
  await assert.rejects(packagesManagement.execute(account, "delete", {}, chosen), ManagementInputError);
  await assert.rejects(packagesManagement.execute(session, "inspect", {}, chosen), /account token/);
  assert.equal(calls.length, 0);
});

test("default EPS overlapping purchases coalesce only when their native snapshots agree", async t => {
  let conflict = false;
  cloud(t, (url, body) => {
    if (url.pathname.endsWith("/enterprise-projects")) return Response.json({ enterprise_projects: [{ id: "0" }], total_count: 1 });
    if (url.pathname.endsWith("/free-resources/query")) return Response.json({ free_resource_packages: [{ ...packageRow("purchase-1", "0"), ...(conflict && body.enterprise_project_id ? { status: 3 } : {}) }], total_count: 1 });
    return undefined;
  });
  assert.equal((await packagesManagement.inventory(account)).length, 1);
  conflict = true;
  await assert.rejects(packagesManagement.inventory(account), /conflicting package purchase identities/);
});

test("usage requests batch native item identities and retain separate measurements", async t => {
  const items = Array.from({ length: 101 }, (_, index) => ({ free_resource_id: `item-${index}`, usage_type_name: `Quota ${index}`, amount: "1", original_amount: "2", measure_id: 10 }));
  const calls = cloud(t, (url, body) => {
    if (url.pathname.endsWith("/free-resources/query")) return Response.json({ free_resource_packages: [{ ...packageRow(), free_resources: items }], total_count: 1 });
    if (url.pathname.endsWith("/usages/details/query")) return Response.json({ free_resources: items.filter(item => (body.free_resource_ids as string[]).includes(item.free_resource_id)) });
    return undefined;
  });
  const outcome = await packagesManagement.execute(account, "usage", {}, chosen);
  assert.equal(outcome.facts!.length, 101);
  assert.deepEqual(calls.filter(call => call.path.endsWith("/usages/details/query")).map(call => (call.body.free_resource_ids as string[]).length), [100, 1]);
});

test("deduction pagination reads every later page without widening item filters", async t => {
  const calls = cloud(t, url => {
    if (!url.pathname.endsWith("/free-resources-usage-records")) return undefined;
    const offset = Number(url.searchParams.get("offset"));
    return Response.json({ free_resource_records: Array.from({ length: offset ? 1 : 100 }, (_, index) => ({ free_resource_id: "item-1", product_id: "offering-1", resource_id: `bucket-${offset + index}`, deduct_time: "2026-10-01T12:00:00Z", used_amount: "1", remaining_amount: "10", measure_id: 10 })), total_count: 101 });
  });
  assert.equal((await packagesManagement.execute(account, "records", { item: "item-1", begin: "2026-10-01", end: "2026-10-02" }, chosen)).facts!.length, 101);
  assert.deepEqual(calls.filter(call => call.path.endsWith("/free-resources-usage-records")).map(call => [call.query.offset, call.query.free_resource_id]), [["0", "item-1"], ["100", "item-1"]]);
});
