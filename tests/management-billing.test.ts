import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { billingManagement } from "@/lib/huawei/management/adapters/billing";
import { randomUUID } from "node:crypto";
import { HuaweiApiError } from "@/lib/huawei/http";
import type { ManagementHistoryEntry, ManagementValues } from "@/lib/management-contract";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { session } from "./fixtures/session";

const account = { ...session, accountToken: "account-token" };
const unpaidOrder = { order_id: "CS-1001", customer_id: "customer-secret-1", service_type_code: "hws.service.type.ecs", service_type_name: "Elastic Cloud Server", status: 6, order_type: 1, amount_after_discount: 12.34, official_amount: 15, currency: "USD", create_time: "2026-09-01T00:00:00Z" };
const renewalOrder = { ...unpaidOrder, order_id: "CS-1002", order_type: 2 };
const mainResource = { resource_id: "r-ecs-1", resource_name: "web-server", region_code: "sa-brazil-1", service_type_code: "hws.service.type.ecs", service_type_name: "Elastic Cloud Server", resource_type_code: "hws.resource.type.vm", resource_type_name: "ECS", resource_spec_code: "c3.large.2", product_spec_desc: "2 vCPUs | 4 GB", parent_resource_id: "", is_main_resource: 1, status: 2, effective_time: "2026-01-01T00:00:00Z", expire_time: "2026-12-01T00:00:00Z", expire_policy: 1 };
const renewingResource = { ...mainResource, resource_id: "r-rds-1", resource_name: "prod-db", service_type_name: "Relational Database Service", resource_type_name: "RDS", expire_policy: 3 };
const attachedDisk = { ...mainResource, resource_id: "r-evs-1", resource_name: "data-disk", resource_type_code: "hws.resource.type.volume", resource_type_name: "EVS", parent_resource_id: "r-ecs-1", is_main_resource: 0 };
const orderResource = { id: "order:CS-1001", name: "CS-1001", status: "To be paid", values: { service: "Elastic Cloud Server", type: "New", amount: "12.34", currency: "USD", created: "2026-09-01T00:00:00Z" } };
const subscriptionResource = { id: "subscription:r-ecs-1", name: "web-server", status: "In use", values: { service: "Elastic Cloud Server", type: "ECS", region: "sa-brazil-1", spec: "2 vCPUs | 4 GB", expires: "2026-12-01T00:00:00Z", expiryPolicy: "Convert to pay-per-use", autoRenew: "Disabled" } };

function mock(t: TestContext, override?: (url: URL, method: string, body: Record<string, unknown>) => unknown) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  const orderOffsets: number[] = [];
  const resourceOffsets: number[] = [];
  let canceled = false;
  let paid = false;
  let policy = 1;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), "account-token");
    assert.equal(new Headers(init.headers).get("X-Language"), "en_US");
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    assert.ok(!url.search.includes("project-1") && !JSON.stringify(body).includes("project-1"));
    if (method !== "GET" && url.pathname !== "/v2/orders/subscriptions/resources/query") writes.push({ path: url.pathname, method, ...(init.body ? { body } : {}) });
    const own = override?.(url, method, body);
    if (own !== undefined) return Response.json(own);
    if (url.pathname === "/v2/orders/customer-orders" && method === "GET") {
      orderOffsets.push(Number(url.searchParams.get("offset")));
      const orderId = url.searchParams.get("order_id");
      const status = url.searchParams.get("status");
      let rows = paid && !status ? [{ ...unpaidOrder, status: 3 }] : [unpaidOrder, renewalOrder];
      if (canceled && status === "6") rows = rows.filter(row => row.order_id !== "CS-1001");
      if (orderId) rows = rows.filter(row => row.order_id === orderId);
      if (status) rows = rows.filter(row => String(row.status) === status);
      if (orderId) return Response.json({ total_count: rows.length, order_infos: rows });
      const offset = Number(url.searchParams.get("offset"));
      return Response.json({ total_count: rows.length, order_infos: rows.slice(offset, offset + 1) });
    }
    if (url.pathname === "/v2/orders/customer-orders/cancel" && method === "PUT") { canceled = true; return Response.json({}); }
    if (url.pathname === "/v3/orders/customer-orders/pay" && method === "POST") { paid = true; return Response.json({}); }
    if (url.pathname === "/v2/accounts/customer-accounts/balances") return Response.json({ account_balances: [{ account_id: "acct-1", account_type: 1, amount: 5000, currency: "USD" }], debt_amount: 0, measure_id: 1, currency: "USD" });
    if (url.pathname === "/v2/orders/subscriptions/resources/query") {
      resourceOffsets.push(Number(body.offset));
      const ids = Array.isArray(body.resource_ids) ? body.resource_ids.map(String) : [];
      const rows = [{ ...mainResource, expire_policy: policy }, renewingResource, attachedDisk];
      let matched = ids.length ? rows.filter(row => ids.includes(row.resource_id) || ids.includes(row.parent_resource_id)) : rows;
      if (body.only_main_resource === 1) matched = matched.filter(row => row.is_main_resource === 1 || (ids.length === 1 && ids.includes(row.resource_id)));
      if (ids.length) return Response.json({ total_count: matched.length, data: matched });
      const offset = Number(body.offset);
      return Response.json({ total_count: matched.length, data: matched.slice(offset, offset + 1) });
    }
    if (url.pathname === "/v2/orders/subscriptions/resources/autorenew/r-ecs-1") {
      if (method === "POST") { policy = 3; return Response.json({}); }
      if (method === "DELETE") { policy = 1; return Response.json({}); }
    }
    if (url.pathname === "/v2/orders/subscriptions/resources/renew") return Response.json({ order_ids: ["CS-2001"], fail_resource_infos: [] });
    if (url.pathname === "/v2/orders/subscriptions/resources/unsubscribe") return Response.json({ order_ids: ["CS-3001"], fail_resource_infos: [] });
    throw new Error(`Unexpected billing request ${method} ${url.pathname}`);
  });
  return { writes, orderOffsets, resourceOffsets };
}

test("Billing inventories use account tokens, native subscription URI, and every page", async t => {
  const { orderOffsets, resourceOffsets } = mock(t);
  const rows = await billingManagement.inventory(account);
  assert.deepEqual(orderOffsets, [0, 1]); assert.deepEqual(resourceOffsets, [0, 1]);
  assert.deepEqual(rows.map(row => row.id), ["order:CS-1001", "order:CS-1002", "subscription:r-ecs-1", "subscription:r-rds-1"]);
  assert.equal(rows[0].values?.amount, "12.34"); assert.equal(rows[3].values?.autoRenew, "Enabled");
  assert.equal(billingManagement.accountWide, true);
  assert.ok(billingManagement.invalidationKeys().includes(cloudCacheKeys.billing(new Date().toISOString().slice(0, 7))));
  assert.ok(billingManagement.invalidationKeys().includes(cloudCacheKeys.listEcsInstances));
  assert.ok(billingManagement.invalidationKeys().includes(cloudCacheKeys.listRdsInstances));
});

test("Billing mutations require impact review and exact identity confirmation", () => {
  for (const operation of billingManagement.operations.filter(item => item.kind !== "inspect")) { assert.equal(operation.confirmation, true); assert.ok(operation.impact); }
  assert.equal(billingManagement.operations.some(item => item.id === "unsubscribe"), false);
  assert.equal(billingManagement.operations.find(item => item.id === "renew")?.fields.some(field => field.key === "autoPay"), false);
});

test("Billing order inspection shows current official and discounted amounts without private account IDs", async t => {
  mock(t); const result = await billingManagement.execute(account, "inspect-order", {}, orderResource);
  assert.ok(result.facts?.some(fact => fact.label === "Amount after discount" && fact.value === "12.34 USD"));
  assert.ok(result.facts?.some(fact => fact.label === "Official amount" && fact.value === "15 USD"));
  assert.doesNotMatch(JSON.stringify(result), /customer-secret/);
});

test("Billing missing, duplicate, and foreign native list identities fail closed", async t => {
  for (const body of [{}, { order_infos: [], total_count: null }, { order_infos: [unpaidOrder, unpaidOrder], total_count: 2 }, { order_infos: [{ ...unpaidOrder, order_id: "" }], total_count: 1 }]) {
    mock(t, url => url.pathname === "/v2/orders/customer-orders" ? body : undefined);
    await assert.rejects(billingManagement.inventory(account), /inventory|identity|Invalid list|incomplete billing page/);
  }
  mock(t, url => url.pathname === "/v2/orders/customer-orders" ? { order_infos: [{ ...unpaidOrder, order_id: "foreign" }], total_count: 1 } : undefined);
  await assert.rejects(billingManagement.execute(account, "cancel-order", {}, orderResource), /different billing order/);
});

test("Billing filtered unpaid orders must independently report the native unpaid state", async t => {
  const { writes } = mock(t, url => url.pathname === "/v2/orders/customer-orders" ? { order_infos: [{ ...unpaidOrder, status: 5 }], total_count: 1 } : undefined);
  await assert.rejects(billingManagement.execute(account, "cancel-order", {}, orderResource), /unverified unpaid state/);
  assert.equal(writes.length, 0);
});

test("Billing cancellation stays submitted with its original native order identity", async t => {
  const { writes } = mock(t); const result = await billingManagement.execute(account, "cancel-order", {}, orderResource);
  assert.deepEqual(writes, [{ path: "/v2/orders/customer-orders/cancel", method: "PUT", body: { order_id: "CS-1001" } }]);
  assert.equal(result.jobId, "CS-1001"); assert.equal(result.asynchronous, true);
  assert.doesNotMatch(result.message, /canceled without/);
});

const reviewed = { reviewedAmount: "12.3400", reviewedCurrency: "USD" };
const undiscounted = { ...unpaidOrder, official_amount: 12.34, discounts: [] };

test("Billing payment requires an amount and currency explicitly submitted by the user", async t => {
  const { writes } = mock(t, url => url.pathname === "/v2/orders/customer-orders" ? { order_infos: [undiscounted], total_count: 1 } : undefined);
  for (const values of [{}, { ...reviewed, reviewedAmount: "99.99" }, { ...reviewed, reviewedCurrency: "CNY" }]) await assert.rejects(billingManagement.execute(account, "pay-order", values, orderResource), /amount|currency/);
  assert.equal(writes.length, 0);
  const result = await billingManagement.execute(account, "pay-order", reviewed, orderResource);
  assert.equal(result.jobId, "CS-1001"); assert.equal(result.asynchronous, true);
  assert.match(result.message, /up to 12.34 USD/); assert.match(result.message, /settlement/);
  assert.deepEqual(writes[0].body, { order_id: "CS-1001", use_coupon: "NO", use_discount: "NO" });
});

test("Billing payment refuses discounts, negative amounts, unknown currency, and agent payment schemas", async t => {
  for (const patch of [{ official_amount: 15 }, { official_amount: -1, amount_after_discount: -1 }, { currency: "" }, { is_agent_pay: true }, { discounts: [{ discount_type: "609" }] }]) {
    const { writes } = mock(t, url => url.pathname === "/v2/orders/customer-orders" ? { order_infos: [{ ...undiscounted, ...patch }], total_count: 1 } : undefined);
    await assert.rejects(billingManagement.execute(account, "pay-order", reviewed, orderResource), /workflow/);
    assert.equal(writes.length, 0);
  }
});

test("Billing subscription inspection loads every attached page and verifies parent identity", async t => {
  const { resourceOffsets } = mock(t, (url, method, body) => {
    if (url.pathname === "/v2/orders/subscriptions/resources/query" && body.only_main_resource === 0) return { total_count: 2, data: Number(body.offset) === 0 ? [mainResource] : [attachedDisk] };
    return undefined;
  });
  const result = await billingManagement.execute(account, "inspect-subscription", {}, subscriptionResource);
  assert.deepEqual(resourceOffsets, []); // override still serves explicitly paged native responses
  assert.ok(result.facts?.some(fact => fact.label === "Attached · EVS" && fact.value === "data-disk · r-evs-1"));
  mock(t, url => url.pathname === "/v2/orders/subscriptions/resources/query" ? { total_count: 1, data: [{ ...attachedDisk, parent_resource_id: "foreign" }] } : undefined);
  await assert.rejects(billingManagement.execute(account, "inspect-subscription", {}, subscriptionResource), /different resource parent/);
});

test("Billing renewal always creates an unpaid order with native period bounds", async t => {
  const { writes } = mock(t);
  for (const values of [{ periodType: "YEAR", periodNum: 4 }, { periodType: "MONTH", periodNum: 12 }, { periodType: "MONTH", periodNum: 1, autoPay: true }] as ManagementValues[]) await assert.rejects(billingManagement.execute(account, "renew", values, subscriptionResource), /years|months|unpaid/);
  assert.equal(writes.length, 0);
  const result = await billingManagement.execute(account, "renew", { periodType: "MONTH", periodNum: 3 }, subscriptionResource);
  assert.deepEqual(writes[0].body, { resource_ids: ["r-ecs-1"], period_type: 2, period_num: 3, is_auto_pay: 0 });
  assert.equal(result.resourceId, "order:CS-2001"); assert.match(result.message, /paid period has not yet been extended/);
});

test("Billing renewal reports partial failures and malformed acknowledgements as uncertain without private payloads", async t => {
  for (const response of [{ order_ids: ["CS-2001"] }, { order_ids: ["CS-2001"], fail_resource_infos: [{ resource_id: "r-ecs-1", error_code: "PRIVATE_NATIVE", error_msg: "PRIVATE_NATIVE" }] }, { order_ids: ["CS-2001", "CS-2001"], fail_resource_infos: [] }]) {
    mock(t, url => url.pathname.endsWith("/renew") ? response : undefined);
    await assert.rejects(billingManagement.execute(account, "renew", { periodType: "MONTH", periodNum: 1 }, subscriptionResource), (error: Error) => !error.message.includes("PRIVATE_NATIVE"));
  }
});

test("Billing subscription writes require known state, main-resource status, renewal policy, and fresh name", async t => {
  for (const patch of [{ is_main_resource: 0 }, { status: 5 }, { expire_policy: null }, { expire_policy: "" }, { resource_name: "renamed" }]) {
    const { writes } = mock(t, url => url.pathname === "/v2/orders/subscriptions/resources/query" ? { total_count: 1, data: [{ ...mainResource, ...patch }] } : undefined);
    await assert.rejects(billingManagement.execute(account, "renew", { periodType: "MONTH", periodNum: 1 }, subscriptionResource), /main|status|policy|name changed/);
    assert.equal(writes.length, 0);
  }
});

test("Billing automatic renewal controls preserve native optional period and renewal-count contracts", async t => {
  const { writes } = mock(t);
  const enabled = await billingManagement.execute(account, "enable-auto-renew", { renewalPeriod: "MONTH", times: 6 }, subscriptionResource);
  assert.match(enabled.message, /enabled for web-server/);
  const disabled = await billingManagement.execute(account, "disable-auto-renew", {}, subscriptionResource);
  assert.match(disabled.message, /keeps running until/);
  assert.deepEqual(writes.map(row => row.method), ["POST", "DELETE"]);
  assert.deepEqual(writes[0].body, { period_type: "MONTH", auto_renew_times: 6 });
});

test("Billing accepted but propagating renewal policy retains a refreshable original identity", async t => {
  mock(t, (url, method) => url.pathname.endsWith("/autorenew/r-ecs-1") && method === "POST" ? {} : undefined);
  const result = await billingManagement.execute(account, "enable-auto-renew", {}, subscriptionResource);
  assert.equal(result.asynchronous, true); assert.equal(result.jobId, "r-ecs-1");
});

function history(operation: string, resourceId = "order:CS-1001"): ManagementHistoryEntry { return { id: randomUUID(), service: "billing/center", operation, resourceId, jobId: resourceId.split(":")[1], startedAt: new Date().toISOString(), state: "submitted" }; }

test("Billing order observers require the exact requested terminal state; missing orders stay pending", async t => {
  let state: number | undefined = 6;
  mock(t, url => url.pathname === "/v2/orders/customer-orders" ? { total_count: state === undefined ? 0 : 1, order_infos: state === undefined ? [] : [{ ...unpaidOrder, status: state }] } : undefined);
  for (state of [6, 3, 9, undefined]) assert.equal((await billingManagement.poll!(account, history("Pay unpaid order"))).state, "submitted");
  state = 5; assert.equal((await billingManagement.poll!(account, history("Pay unpaid order"))).state, "succeeded");
  assert.equal((await billingManagement.poll!(account, history("Cancel unpaid order"))).state, "submitted");
  state = 4; assert.equal((await billingManagement.poll!(account, history("Pay unpaid order"))).state, "failed");
  assert.equal((await billingManagement.poll!(account, history("Cancel unpaid order"))).state, "succeeded");
});

test("Billing policy observers require known native policy values and original identities", async t => {
  let policy: unknown = null;
  mock(t, url => url.pathname === "/v2/orders/subscriptions/resources/query" ? { data: [{ ...mainResource, expire_policy: policy }], total_count: 1 } : undefined);
  const entry = history("Disable automatic renewal", "subscription:r-ecs-1");
  assert.equal((await billingManagement.poll!(account, entry)).state, "submitted");
  policy = 3; assert.equal((await billingManagement.poll!(account, entry)).state, "submitted");
  policy = 1; assert.equal((await billingManagement.poll!(account, entry)).state, "succeeded");
  await assert.rejects(billingManagement.poll!(account, { ...entry, jobId: "foreign" }), /original/);
  await assert.rejects(billingManagement.poll!(account, { ...entry, operation: "Unsubscribe" }), /original/);
});

test("Billing HTTP, native business, and malformed JSON errors preserve status without private text", async t => {
  for (const response of [new Response("PRIVATE_NATIVE", { status: 403 }), Response.json({ error_code: "PRIVATE_NATIVE", error_msg: "PRIVATE_NATIVE" }), new Response("PRIVATE_NATIVE")]) {
    t.mock.method(globalThis, "fetch", async () => response.clone());
    await assert.rejects(billingManagement.inventory(account), (error: Error) => !error.message.includes("PRIVATE_NATIVE") && (response.status !== 403 || error instanceof HuaweiApiError && error.status === 403));
  }
});

test("Billing requires account authentication and refuses unavailable operations", async t => {
  mock(t); await assert.rejects(billingManagement.inventory(session), /account token/);
  await assert.rejects(billingManagement.execute(account, "unsubscribe", {}, subscriptionResource), /Unsupported/);
  await assert.rejects(billingManagement.execute(account, "pay-order", reviewed, subscriptionResource), /correct type/);
});
