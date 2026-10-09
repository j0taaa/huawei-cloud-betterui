import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { kooGalleryManagement } from "@/lib/huawei/management/adapters/koogallery";
import { getPurchasedApiSubscription, listPurchasedApis, listPurchasedApiSubscriptions } from "@/lib/huawei/services/koogallery-native";
import { listKooGalleryPurchasedApisForProject } from "@/lib/huawei/services/koogallery";
import { HuaweiApiError } from "@/lib/huawei/http";
import { session } from "./fixtures/session";

const sub = { id: "purchase-one", group_id: "group-one", group_name: "Weather", group_remark: "Forecast calls", quota_left: 100, quota_used: 20, order_time: "2026-01-01T00:00:00Z", start_time: "2026-01-01T00:00:00Z", expire_time: "2027-01-01T00:00:00Z", group_domains: null, app_key: "private-key", app_secret: "private-secret" };
const api = { id: "api-one", purchase_id: sub.id, name: "Forecast", remark: "Daily weather", req_uri: "/forecast" };
const selected = { id: `subscription:${sub.id}`, name: sub.group_name };
function cloud(t: TestContext, override?: (url: URL) => unknown) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input); calls.push(url.pathname + url.search);
    assert.ok(!init.method || init.method === "GET");
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    const own = override?.(url); if (own instanceof Response) return own;
    if (own !== undefined) return Response.json(own);
    if (url.pathname.endsWith(`/groups/${sub.id}`)) return Response.json({ ...sub, group_domains: ["weather.vendor.example"] });
    if (url.pathname.endsWith("/groups")) return Response.json({ total: 1, size: 1, purchases: [sub] });
    if (url.pathname.endsWith("/apis")) return Response.json({ total: 1, size: 1, apis: [api] });
    throw new Error("Unexpected mock path");
  });
  return calls;
}

test("KooGallery inventory uses native subscription identities and excludes generated credentials", async t => {
  cloud(t);
  const resources = await kooGalleryManagement.inventory(session);
  assert.deepEqual(resources, [{ id: selected.id, name: sub.group_name, values: { groupId: sub.group_id, expiresAt: sub.expire_time } }]);
  assert.ok(!JSON.stringify(await listPurchasedApiSubscriptions(session)).includes("private-"));
  assert.ok(kooGalleryManagement.operations.every(operation => operation.kind === "inspect"));
});
test("subscription inspection reads native detail by purchase ID and reports quotas/dates/domains safely", async t => {
  const calls = cloud(t);
  const outcome = await kooGalleryManagement.execute(session, "inspect-subscription", {}, selected);
  assert.equal(outcome.resourceId, selected.id);
  assert.deepEqual(outcome.facts?.find(fact => fact.label === "Calls remaining"), { label: "Calls remaining", value: "100" });
  assert.deepEqual(outcome.facts?.find(fact => fact.label === "Domains"), { label: "Domains", value: "weather.vendor.example" });
  assert.ok(calls.includes(`/v1.0/apigw/purchases/groups/${sub.id}`));
  assert.ok(!JSON.stringify(outcome).includes("private-"));
});
test("subscribed APIs use documented id/name/purchase_id fields and composite inventory identities", async t => {
  cloud(t, url => url.pathname.endsWith("/apis") ? { total: 2, size: 2, apis: [api, { ...api, id: "api-two", name: "History" }] } : undefined);
  const rows = await listKooGalleryPurchasedApisForProject(session);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].apiName, "Forecast");
  assert.equal(rows[0].subscriptionId, sub.id);
  assert.equal(rows[0].apiId, api.id);
  assert.equal(rows[0].id, JSON.stringify([sub.id, api.id]));
  assert.equal(rows[0].groupName, sub.group_name);
  assert.equal(rows[0].status, "Not reported");
  assert.equal(rows[0].runEnvName, "Not reported");
});
test("the same API ID in different owned subscriptions remains distinct", async t => {
  cloud(t, url => url.pathname.endsWith("/groups") ? { total: 2, size: 2, purchases: [sub, { ...sub, id: "purchase-two" }] } : url.pathname.endsWith("/apis") ? { total: 2, size: 2, apis: [api, { ...api, purchase_id: "purchase-two" }] } : undefined);
  const rows = await listKooGalleryPurchasedApisForProject(session);
  assert.equal(new Set(rows.map(row => row.id)).size, 2);
  const options = await kooGalleryManagement.options!(session, "inspect-api", selected);
  assert.deepEqual(options.apis, [{ value: api.id, label: api.name }]);
});
test("inspect-api verifies original subscription membership and never invokes a vendor endpoint", async t => {
  const calls = cloud(t);
  const outcome = await kooGalleryManagement.execute(session, "inspect-api", { api: api.id }, selected);
  assert.equal(outcome.facts?.find(fact => fact.label === "Access path")?.value, "/forecast");
  assert.ok(calls.every(path => path.startsWith("/v1.0/apigw/purchases/")));
  await assert.rejects(kooGalleryManagement.execute(session, "inspect-api", { api: "foreign" }, selected), /no longer belongs/);
  await assert.rejects(kooGalleryManagement.execute(session, "delete", {}, selected), /Unsupported/);
});
test("listing APIs stays scoped to an exact purchased subscription", async t => {
  cloud(t, url => url.pathname.endsWith("/groups") ? { total: 2, size: 2, purchases: [sub, { ...sub, id: "purchase-two" }] } : url.pathname.endsWith("/apis") ? { total: 2, size: 2, apis: [api, { ...api, id: "api-two", purchase_id: "purchase-two", name: "Other" }] } : undefined);
  const outcome = await kooGalleryManagement.execute(session, "list-apis", {}, selected);
  assert.equal(outcome.facts?.length, 1);
  assert.equal(outcome.facts?.[0].label, api.name);
});
test("missing or malformed subscription selection cannot be inspected", async t => {
  cloud(t);
  for (const resource of [undefined, { id: "group:group-one", name: "Weather" }, { id: "subscription:missing", name: "Weather" }, { id: "subscription:../escape", name: "Weather" }]) await assert.rejects(kooGalleryManagement.execute(session, "inspect-subscription", {}, resource), /Select|no longer/);
});
for (const invalid of [undefined, null, false, -1, 1.5, "1", NaN]) test(`subscription total ${String(invalid)} cannot prove a complete page`, async t => {
  cloud(t, url => url.pathname.endsWith("/groups") ? { total: invalid, size: 1, purchases: [sub] } : undefined);
  await assert.rejects(listPurchasedApiSubscriptions(session), /incomplete.*page/);
});
test("native page size must match every returned array and remain within requested size", async t => {
  let size: unknown;
  cloud(t, url => url.pathname.endsWith("/groups") ? { total: 1, size, purchases: [sub] } : undefined);
  for (size of [undefined, null, "1", 0, 2, -1, 1.5]) await assert.rejects(listPurchasedApiSubscriptions(session), /incomplete.*page/);
});
test("missing native lists never become false empty inventory", async t => {
  cloud(t, url => url.pathname.endsWith("/groups") ? { total: 0, size: 0, items: [] } : undefined);
  await assert.rejects(listPurchasedApiSubscriptions(session), /incomplete/);
});
test("purchased subscription pagination follows page numbers with stable totals", async t => {
  const calls = cloud(t, url => {
    if (!url.pathname.endsWith("/groups")) return undefined;
    const first = url.searchParams.get("page_no") === "1";
    const purchases = first ? Array.from({ length: 100 }, (_, i) => ({ ...sub, id: `purchase-${i}` })) : [{ ...sub, id: "purchase-100" }];
    return { total: 101, size: purchases.length, purchases };
  });
  assert.equal((await listPurchasedApiSubscriptions(session)).length, 101);
  assert.ok(calls.includes("/v1.0/apigw/purchases/groups?page_size=100&page_no=2"));
});
test("changing totals and premature empty pages reject incomplete inventory", async t => {
  let mode = "changed";
  cloud(t, url => {
    if (!url.pathname.endsWith("/groups")) return undefined;
    const first = url.searchParams.get("page_no") === "1";
    return first ? { total: 2, size: 1, purchases: [sub] } : mode === "changed" ? { total: 1, size: 0, purchases: [] } : { total: 2, size: 0, purchases: [] };
  });
  await assert.rejects(listPurchasedApiSubscriptions(session), /changed during pagination/);
  mode = "empty"; await assert.rejects(listPurchasedApiSubscriptions(session), /incomplete/);
});
test("duplicate native identities are rejected across pages", async t => {
  cloud(t, url => url.pathname.endsWith("/groups") ? { total: 2, size: 1, purchases: [sub] } : undefined);
  await assert.rejects(listPurchasedApiSubscriptions(session), /duplicate/);
});
test("API identities require both native id and original purchase_id", async t => {
  let row: Record<string, unknown> = {};
  cloud(t, url => url.pathname.endsWith("/apis") ? { total: 1, size: 1, apis: [row] } : undefined);
  for (row of [{ ...api, id: undefined }, { ...api, purchase_id: undefined }, { ...api, purchase_id: "unowned" }, { ...api, group_id: "foreign" }]) await assert.rejects(listPurchasedApis(session), /identity|owned subscription|another subscription/);
});
test("duplicate API IDs within one subscription reject inventory", async t => {
  cloud(t, url => url.pathname.endsWith("/apis") ? { total: 2, size: 2, apis: [api, api] } : undefined);
  await assert.rejects(listPurchasedApis(session), /duplicate/);
});
test("provided project echoes on envelopes, data and rows must exactly match, including null", async t => {
  let body: unknown;
  cloud(t, url => url.pathname.endsWith("/groups") ? body : undefined);
  for (const scope of [null, "", false, "foreign"]) for (const at of ["top", "data", "row"]) {
    body = { total: 1, size: 1, purchases: [at === "row" ? { ...sub, project_id: scope } : sub], ...(at === "top" ? { project_id: scope } : at === "data" ? { data: { projectId: scope } } : {}) };
    await assert.rejects(listPurchasedApiSubscriptions(session), /project scope/);
  }
});
test("subscription details retain both original purchase ID and group ID", async t => {
  let detail: unknown;
  cloud(t, url => url.pathname.endsWith(`/groups/${sub.id}`) ? detail : undefined);
  const parent = (await listPurchasedApiSubscriptions(session))[0];
  for (detail of [{ ...sub, id: "another-purchase" }, { ...sub, group_id: "another-group" }, { ...sub, group_id: null }]) await assert.rejects(getPurchasedApiSubscription(session, parent), /different purchased API subscription/);
});
test("unknown quota/date/domain values remain unknown rather than fabricated zero or valid links", async t => {
  cloud(t, url => url.pathname.endsWith(`/groups/${sub.id}`) ? { ...sub, quota_left: null, quota_used: "0", expire_time: "private-invalid-date", group_domains: ["https://private-token@host/path"] } : undefined);
  const outcome = await kooGalleryManagement.execute(session, "inspect-subscription", {}, selected);
  for (const label of ["Calls remaining", "Calls used", "Expires", "Domains"]) assert.equal(outcome.facts?.find(fact => fact.label === label)?.value, "Unknown");
  assert.ok(!JSON.stringify(outcome).includes("private-"));
});
test("access paths with credentials/query diagnostics are not exposed", async t => {
  cloud(t, url => url.pathname.endsWith("/apis") ? { total: 1, size: 1, apis: [{ ...api, req_uri: "/forecast?token=private-token" }] } : undefined);
  const outcome = await kooGalleryManagement.execute(session, "inspect-api", { api: api.id }, selected);
  assert.equal(outcome.facts?.find(fact => fact.label === "Access path")?.value, "Unknown");
  assert.ok(!JSON.stringify(outcome).includes("private-token"));
});
test("native business and transport errors never disclose generated credentials", async t => {
  let result: unknown;
  cloud(t, () => result);
  for (result of [{ error_code: "private-secret", error_msg: "private-key" }, { error_code: null }, { error: { message: "private-secret" } }, []]) await assert.rejects(listPurchasedApiSubscriptions(session), error => error instanceof Error && !error.message.includes("private-") && /business failure|unverifiable/.test(error.message));
  result = new Response("private-secret", { status: 403, statusText: "private-key" });
  await assert.rejects(listPurchasedApiSubscriptions(session), error => error instanceof HuaweiApiError && error.status === 403 && !error.message.includes("private-"));
});
