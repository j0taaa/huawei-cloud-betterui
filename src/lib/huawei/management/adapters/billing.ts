import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiFetch as nativeFetch, HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { collectList } from "@/lib/huawei/pagination";
import { decimalAmount, sumAmounts } from "@/lib/billing-format";
import { ManagementInputError, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

const orderPrefix = "order:";
const subscriptionPrefix = "subscription:";
const language = { "X-Language": "en_US" };
const orderStatuses: Record<string, string> = { "1": "Pending approval", "3": "Processing", "4": "Cancelled", "5": "Completed", "6": "To be paid", "9": "Pending confirmation" };
const orderTypes: Record<string, string> = { "1": "New", "2": "Renewal", "3": "Change", "4": "Unsubscription", "10": "Period to on-demand", "11": "On-demand to period", "13": "Trial", "14": "To commercial", "15": "Fee adjustment" };
const resourceStatuses: Record<string, string> = { "2": "In use", "3": "Closed", "4": "Frozen", "5": "Expired" };
const expiryPolicies: Record<string, string> = { "0": "Grace period", "1": "Convert to pay-per-use", "2": "Auto delete", "3": "Auto renew", "4": "Freeze", "5": "Delete after retention" };

const periodChoice: ManagementField = { key: "periodType", label: "Renewal period", type: "select", required: true, choices: [{ value: "MONTH", label: "Monthly" }, { value: "YEAR", label: "Yearly" }] };
const periodCount: ManagementField = { key: "periodNum", label: "Number of periods", type: "number", required: true, min: 1, max: 11, help: "Monthly renewal supports 1 to 11 months; yearly renewal supports 1 to 3 years." };
const autoRenewPeriod: ManagementField = { key: "renewalPeriod", label: "Automatic renewal period", type: "select", choices: [{ value: "MONTH", label: "Monthly" }, { value: "YEAR", label: "Yearly" }], help: "Optional. Huawei renews with the last order's period when left unselected." };
const autoRenewLimit: ManagementField = { key: "times", label: "Automatic renewal limit", type: "number", min: 0, max: 99, help: "Optional number of automatic renewals. 0 renews without limit." };

function billingSession(s: BetterUiSession) {
  if (!s.accountToken) throw new ManagementInputError("Sign in again to obtain an account token.", 409);
  return { ...s, token: s.accountToken };
}

async function request(s: BetterUiSession, path: string, method = "GET", body?: unknown) {
  try {
    const response = await nativeFetch<Record<string, unknown>>(billingSession(s), "bss", path, { method, headers: language, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.error_code !== undefined && String(response.error_code) !== "0") throw new HuaweiApiError("Huawei rejected this billing request.", 502);
    return response;
  } catch (error) {
    if (error instanceof ManagementInputError) throw error;
    if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected this billing request.", error.status);
    throw new Error("Huawei returned an unverifiable billing response. Check native state before retrying.");
  }
}

function checkedRows(value: unknown, key: string) {
  if (!Array.isArray(value)) throw new ManagementInputError("Huawei returned an incomplete billing inventory.", 409);
  const rows = value.map(asRecord), seen = new Set<string>();
  for (const row of rows) {
    const id = row[key];
    if (typeof id !== "string" || !id || seen.has(key === "order_id" ? id.toLowerCase() : id)) throw new ManagementInputError("Huawei returned an unverified billing identity.", 409);
    seen.add(key === "order_id" ? id.toLowerCase() : id);
  }
  return rows;
}

function verifiedPage(body: Record<string, unknown>, items: string) {
  if (!Array.isArray(body[items]) || typeof body.total_count !== "number" || !Number.isSafeInteger(body.total_count) || body.total_count < (body[items] as unknown[]).length) throw new ManagementInputError("Huawei returned an incomplete billing page or total.", 409);
  return body;
}

async function orderRows(s: BetterUiSession, id?: string, unpaidOnly = true) {
  const query = new URLSearchParams({ limit: "100" });
  if (id) query.set("order_id", id);
  if (unpaidOnly) query.set("status", "6");
  const body = await collectList(cursor => { query.set("offset", String(cursor)); return request(s, `/v2/orders/customer-orders?${query}`).then(body => verifiedPage(body, "order_infos")); }, { items: ["order_infos"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  const rows = checkedRows(body.order_infos, "order_id");
  if (id && rows.some(row => String(row.order_id).toLowerCase() !== id.toLowerCase())) throw new ManagementInputError("Huawei returned a different billing order.", 409);
  if (unpaidOnly && rows.some(row => row.status !== 6)) throw new ManagementInputError("Huawei returned an order with an unverified unpaid state.", 409);
  return rows;
}
const unpaidOrders = (s: BetterUiSession) => orderRows(s);
const orderLookup = async (s: BetterUiSession, id: string, unpaidOnly: boolean) => (await orderRows(s, id, unpaidOnly))[0];

async function resourceRows(s: BetterUiSession, id?: string, attached = false) {
  const body = await collectList(cursor => request(s, "/v2/orders/subscriptions/resources/query", "POST", { ...(id ? { resource_ids: [id] } : {}), only_main_resource: attached ? 0 : 1, limit: 100, offset: cursor }).then(body => verifiedPage(body, "data")), { items: ["data"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  const rows = checkedRows(body.data, "resource_id");
  if (id && rows.some(row => row.resource_id !== id && (!attached || row.parent_resource_id !== id))) throw new ManagementInputError("Huawei returned a subscription from a different resource parent.", 409);
  if (!id && rows.some(row => row.is_main_resource !== 1)) throw new ManagementInputError("Huawei returned an unexpected attached subscription resource.", 409);
  return rows;
}
const subscriptionResources = (s: BetterUiSession) => resourceRows(s);
const resourceLookup = (s: BetterUiSession, id: string, attached: boolean) => resourceRows(s, id, attached);

function nativeId(resource: ManagementResource | undefined, prefix: string) {
  const id = resource?.id.startsWith(prefix) ? resource.id.slice(prefix.length) : "";
  if (!id) throw new ManagementInputError("Select a billing order or subscription resource of the correct type.", 409);
  return id;
}

async function currentUnpaidOrder(s: BetterUiSession, resource: ManagementResource | undefined) {
  const id = nativeId(resource, orderPrefix);
  const order = await orderLookup(s, id, true);
  if (!order) throw new ManagementInputError("This order no longer appears unpaid for this account. Refresh the order list.", 404);
  return { id, order };
}

async function currentSubscription(s: BetterUiSession, resource: ManagementResource | undefined) {
  const id = nativeId(resource, subscriptionPrefix);
  const record = (await resourceLookup(s, id, false)).find(row => asString(row.resource_id, "") === id);
  if (!record) throw new ManagementInputError("This subscription resource no longer belongs to this account.", 404);
  if (record.is_main_resource !== 1) throw new ManagementInputError("Only main subscription resources support this operation.", 409);
  const status = resourceStatuses[String(record.status)] ?? "Unknown";
  if (status !== "In use") throw new ManagementInputError(`This operation is unavailable while the resource status is ${status}.`, 409);
  if (!Object.hasOwn(expiryPolicies, String(record.expire_policy)) || typeof record.expire_policy !== "number") throw new ManagementInputError("The subscription expiry policy is unverified.", 409);
  if (resource && resource.name !== asString(record.resource_name, id)) throw new ManagementInputError("The subscription name changed. Refresh and review its current identity.", 409);
  return { id, record };
}

function optionalAmount(value: unknown): string {
  if (value === null || value === undefined || typeof value === "boolean") return "-";
  try { return decimalAmount(value) ?? "-"; } catch { return "-"; }
}

function requiredAmount(value: unknown): string {
  const amount = optionalAmount(value);
  if (amount === "-") throw new ManagementInputError("Huawei did not report a verifiable amount for this unpaid order.");
  return amount;
}

function verifyBatch(result: Record<string, unknown>, action: string) {
  if (!Array.isArray(result.fail_resource_infos) || result.fail_resource_infos.length) throw new Error(`Huawei did not verify every resource in this ${action}. The request may have been accepted; inspect native orders before retrying.`);
}
function orderIds(result: Record<string, unknown>) {
  const ids = result.order_ids;
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !id) || new Set(ids.map(id => String(id).toLowerCase())).size !== ids.length) throw new Error("Huawei returned no verified renewal order ID. Inspect orders before retrying.");
  return ids as string[];
}
function canonicalAmount(value: unknown) { return sumAmounts([requiredAmount(value)]); }

export const billingManagement: ManagementAdapter = {
  title: "Billing Orders and Subscription Renewal", accountWide: true,
  operations: [
    { id: "inspect-order", label: "Inspect unpaid order", kind: "inspect", description: "Show the current native amount, currency, service and state of one unpaid order of this account.", resourcePrefixes: ["order:"], fields: [] },
    { id: "cancel-order", label: "Cancel unpaid order", kind: "action", description: "Cancel one current unpaid order of this account. Nothing is provisioned or renewed and no payment is taken.", resourcePrefixes: ["order:"], fields: [], allowedStatuses: ["To be paid"], confirmation: true, impact: "The unpaid order is canceled permanently. Its planned purchase, change or renewal never takes effect." },
    { id: "pay-order", label: "Pay unpaid order", kind: "action", description: "Authorize native payment of one current undiscounted yearly/monthly order after entering its reviewed amount and currency.", resourcePrefixes: ["order:"], fields: [{ key: "reviewedAmount", label: "Reviewed maximum order amount", required: true, max: 40, pattern: "^[0-9]+(?:\\.[0-9]+)?$", help: "Enter the official amount shown by Inspect unpaid order. Discounted orders require the native discount workflow." }, { key: "reviewedCurrency", label: "Reviewed currency", required: true, pattern: "^[A-Z]{3}$", max: 3, help: "The exact native currency code, such as USD." }], allowedStatuses: ["To be paid"], confirmation: true, impact: "Authorizes payment up to the reviewed native official amount. Huawei chooses monthly settlement, cash, or credit according to account settings. Enterprise master-account coupons or approval rules may apply. No coupon or discount is selected by this request. Paid orders are governed by Huawei refund rules; acceptance does not prove payment or provisioning completed." },
    { id: "inspect-subscription", label: "Inspect subscription resource", kind: "inspect", description: "Show the current state, expiry policy and attached resources of one yearly/monthly subscription resource.", resourcePrefixes: ["subscription:"], fields: [] },
    { id: "renew", label: "Create unpaid renewal order", kind: "action", description: "Create an unpaid renewal order for an in-use yearly/monthly resource. Review and pay it separately; the subscription is not extended by this request.", resourcePrefixes: ["subscription:"], fields: [periodChoice, periodCount], allowedStatuses: ["In use"], confirmation: true, impact: "Creates an unpaid renewal order. No immediate payment is requested, and automatic renewal remains as configured. The subscription extends only after the renewal order is paid and completed." },
    { id: "enable-auto-renew", label: "Enable automatic renewal", kind: "action", description: "Enable Huawei's automatic renewal for one in-use yearly/monthly resource.", resourcePrefixes: ["subscription:"], fields: [autoRenewPeriod, autoRenewLimit], allowedStatuses: ["In use"], confirmation: true, impact: "Huawei automatically charges renewals according to the account payment and settlement settings before each expiry, repeatedly, until automatic renewal is disabled or the renewal limit is reached." },
    { id: "disable-auto-renew", label: "Disable automatic renewal", kind: "action", description: "Turn off automatic renewal for one resource. This changes only the renewal policy; the resource itself keeps running and keeps its current charges until expiry.", resourcePrefixes: ["subscription:"], fields: [], allowedStatuses: ["In use"], confirmation: true, impact: "The resource is not renewed automatically anymore and expires at the end of the paid period. Huawei's configured expiry policy then applies and its data can be frozen, released or deleted." },
  ],
  inventory: async s => {
    const [orders, resources] = await Promise.all([unpaidOrders(s), subscriptionResources(s)]);
    return [
      ...orders.flatMap(order => {
        const id = asString(order.order_id, "");
        if (!id) return [];
        return [{ id: `${orderPrefix}${id}`, name: id, status: "To be paid", values: { service: asString(order.service_type_name, asString(order.service_type_code)), type: orderTypes[String(order.order_type)] ?? asString(order.order_type), amount: optionalAmount(order.amount_after_discount), currency: asString(order.currency, ""), created: asString(order.create_time, "") } }];
      }),
      ...resources.flatMap(item => {
        const id = asString(item.resource_id, "");
        if (!id) return [];
        return [{ id: `${subscriptionPrefix}${id}`, name: asString(item.resource_name, id), status: resourceStatuses[String(item.status)] ?? "Unknown", values: { service: asString(item.service_type_name, asString(item.service_type_code)), type: asString(item.resource_type_name, asString(item.resource_type_code)), region: asString(item.region_code, ""), spec: asString(item.product_spec_desc, asString(item.resource_spec_code, "")), expires: asString(item.expire_time, ""), expiryPolicy: expiryPolicies[String(item.expire_policy)] ?? "Not set", autoRenew: item.expire_policy === 3 ? "Enabled" : typeof item.expire_policy === "number" && Object.hasOwn(expiryPolicies, String(item.expire_policy)) ? "Disabled" : "Unknown" } }];
      }),
    ];
  },
  invalidationKeys: () => [cloudCacheKeys.billing(new Date().toISOString().slice(0, 7)), ...Object.values(cloudCacheKeys).flatMap(key => typeof key === "string" ? [key] : [])],
  poll: async (s, entry) => {
    if (["Pay unpaid order", "Cancel unpaid order"].includes(entry.operation)) {
      if (!entry.resourceId?.startsWith(orderPrefix) || entry.jobId !== entry.resourceId.slice(orderPrefix.length)) throw new ManagementInputError("This history entry has no verified original billing order identity.");
      const order = await orderLookup(s, entry.jobId, false);
      if (!order) return { state: "submitted", message: "The original order is not visible. Absence does not prove payment or cancellation." };
      const complete = entry.operation === "Pay unpaid order" ? order.status === 5 : order.status === 4;
      if (complete) return { state: "succeeded", message: "The original order reports the requested native terminal state.", resourceId: entry.resourceId };
      if (entry.operation === "Pay unpaid order" && order.status === 4) return { state: "failed", message: "The original order was cancelled; payment is not complete." };
      return { state: "submitted", message: "The original order has not reached the requested native terminal state." };
    }
    if (!["Enable automatic renewal", "Disable automatic renewal"].includes(entry.operation) || !entry.resourceId?.startsWith(subscriptionPrefix) || entry.jobId !== entry.resourceId.slice(subscriptionPrefix.length)) throw new ManagementInputError("This history entry has no verified original renewal-policy identity.");
    const resource = (await resourceLookup(s, entry.jobId, false)).find(row => row.resource_id === entry.jobId);
    const policy = resource?.expire_policy;
    const known = typeof policy === "number" && Object.hasOwn(expiryPolicies, String(policy));
    const complete = known && (entry.operation === "Enable automatic renewal" ? policy === 3 : policy !== 3);
    return complete ? { state: "succeeded", message: "The original resource reports the requested renewal-policy state. Verify future pricing and settlement separately.", resourceId: entry.resourceId } : { state: "submitted", message: "The original resource has not reported a verified requested renewal policy." };
  },
  execute: async (s, operation, v, resource) => {
    if (operation === "inspect-order") {
      const { order } = await currentUnpaidOrder(s, resource);
      const amount = requiredAmount(order.amount_after_discount);
      const currency = asString(order.currency, "");
      const official = optionalAmount(order.official_amount);
      return { message: "Current unpaid order details.", facts: [
        { label: "Order", value: asString(order.order_id) },
        { label: "Service", value: asString(order.service_type_name, asString(order.service_type_code)) },
        { label: "Status", value: orderStatuses[String(order.status)] ?? asString(order.status) },
        { label: "Type", value: orderTypes[String(order.order_type)] ?? asString(order.order_type) },
        { label: "Amount after discount", value: `${amount} ${currency}`.trim() },
        ...(official === "-" ? [] : [{ label: "Official amount", value: `${official} ${currency}`.trim() }]),
        { label: "Created", value: asString(order.create_time, "") },
      ] };
    }
    if (operation === "cancel-order") {
      const { id } = await currentUnpaidOrder(s, resource);
      if (resource!.name.toLowerCase() !== id.toLowerCase()) throw new ManagementInputError("Refresh and confirm the current order identity.", 409);
      await request(s, "/v2/orders/customer-orders/cancel", "PUT", { order_id: id });
      return { message: "Order cancellation accepted. Observe its original identity to verify the native cancelled state.", resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    if (operation === "pay-order") {
      const { id, order } = await currentUnpaidOrder(s, resource);
      const amount = canonicalAmount(order.official_amount), discounted = canonicalAmount(order.amount_after_discount), currency = asString(order.currency, "");
      if (!/^[A-Z]{3}$/.test(currency) || amount.startsWith("-") || amount !== discounted) throw new ManagementInputError("This order requires a verified native currency and discount-specific payment workflow.", 409);
      if (canonicalAmount(v.reviewedAmount) !== amount || v.reviewedCurrency !== currency) throw new ManagementInputError("The amount or currency differs from your review. Inspect the order and review it again.", 409);
      if (order.is_agent_pay === true || asArray(order.discounts).some(row => asRecord(row).discount_type === "609" || asRecord(row).discount_type === 609)) throw new ManagementInputError("This order requires its native agent or mandatory-discount payment workflow.", 409);
      await request(s, "/v3/orders/customer-orders/pay", "POST", { order_id: id, use_coupon: "NO", use_discount: "NO" });
      return { message: `Payment authorization of up to ${amount} ${currency} accepted for this order. Huawei determines settlement and enterprise approval; observe the original order to verify completion.`, resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    if (operation === "inspect-subscription") {
      const id = nativeId(resource, subscriptionPrefix);
      const rows = await resourceLookup(s, id, true);
      const record = rows.find(row => asString(row.resource_id, "") === id);
      if (!record) throw new ManagementInputError("This subscription resource no longer belongs to this account.", 404);
      const attached = rows.filter(row => asString(row.parent_resource_id, "") === id);
      const facts = [
        { label: "Resource", value: asString(record.resource_name, id) },
        { label: "Resource ID", value: id },
        { label: "Service", value: asString(record.service_type_name, asString(record.service_type_code)) },
        { label: "Type", value: asString(record.resource_type_name, asString(record.resource_type_code)) },
        { label: "Specification", value: asString(record.product_spec_desc, asString(record.resource_spec_code)) },
        { label: "Region", value: asString(record.region_code, "") },
        { label: "Status", value: resourceStatuses[String(record.status)] ?? asString(record.status) },
        { label: "Effective time", value: asString(record.effective_time, "") },
        { label: "Expire time", value: asString(record.expire_time, "") },
        { label: "Expiry policy", value: expiryPolicies[String(record.expire_policy)] ?? asString(record.expire_policy, "Not set") },
        { label: "Auto renew", value: record.expire_policy === 3 ? "Enabled" : typeof record.expire_policy === "number" && Object.hasOwn(expiryPolicies, String(record.expire_policy)) ? "Disabled" : "Unknown" },
        { label: "Main resource", value: record.is_main_resource === 1 ? "Yes" : "No" },
      ];
      for (const item of attached.slice(0, 20)) facts.push({ label: `Attached · ${asString(item.resource_type_name, asString(item.resource_type_code))}`, value: `${asString(item.resource_name, asString(item.resource_id))} · ${asString(item.resource_id)}` });
      if (attached.length > 20) facts.push({ label: "Attached resources", value: `${attached.length} attached resources in total` });
      return { message: "Current subscription resource details.", facts };
    }
    if (operation === "renew") {
      const { id, record } = await currentSubscription(s, resource);
      if (v.periodType !== "MONTH" && v.periodType !== "YEAR") throw new ManagementInputError("Select a renewal period.");
      const periodType = v.periodType === "YEAR" ? 3 : 2;
      const periodNum = Number(v.periodNum);
      if (!Number.isInteger(periodNum) || periodNum < 1 || periodNum > (periodType === 3 ? 3 : 11)) throw new ManagementInputError(periodType === 3 ? "Yearly renewal supports 1 to 3 years." : "Monthly renewal supports 1 to 11 months.");
      if (v.autoPay === true) throw new ManagementInputError("Create an unpaid renewal order and review its price before paying.", 409);
      const result = await request(s, "/v2/orders/subscriptions/resources/renew", "POST", { resource_ids: [id], period_type: periodType, period_num: periodNum, is_auto_pay: 0 });
      verifyBatch(result, "renewal");
      const ids = orderIds(result);
      return { message: `Unpaid renewal order${ids.length > 1 ? "s" : ""} ${ids.join(", ")} accepted for ${asString(record.resource_name, id)}. Review payment separately; the paid period has not yet been extended. Automatic renewal remains as configured.`, resourceId: `${orderPrefix}${ids[0]}` };
    }

    if (operation === "enable-auto-renew") {
      const { id, record } = await currentSubscription(s, resource);
      if (record.expire_policy === 3) throw new ManagementInputError("Automatic renewal is already enabled for this resource.", 409);
      if (v.renewalPeriod !== undefined && v.renewalPeriod !== "MONTH" && v.renewalPeriod !== "YEAR") throw new ManagementInputError("Select an automatic renewal period.");
      const times = v.times === undefined ? undefined : Number(v.times);
      if (times !== undefined && (!Number.isInteger(times) || times < 0 || times > 99)) throw new ManagementInputError("The automatic renewal limit must be a whole number between 0 and 99.");
      await request(s, `/v2/orders/subscriptions/resources/autorenew/${encodeURIComponent(id)}`, "POST", { ...(v.renewalPeriod ? { period_type: v.renewalPeriod } : {}), ...(times !== undefined ? { auto_renew_times: times } : {}) });
      const observed = (await resourceLookup(s, id, false).catch(() => [])).find(row => asString(row.resource_id, "") === id);
      if (!observed || observed.expire_policy !== 3) return { message: "Automatic renewal enablement accepted. Observe the original resource to verify its policy.", resourceId: resource!.id, jobId: id, asynchronous: true };
      return { message: `Automatic renewal enabled for ${asString(record.resource_name, id)}. Huawei will charge each renewal according to account payment and settlement settings before expiry.` };
    }
    if (operation === "disable-auto-renew") {
      const { id, record } = await currentSubscription(s, resource);
      if (record.expire_policy !== 3) throw new ManagementInputError("Automatic renewal is not enabled for this resource.", 409);
      await request(s, `/v2/orders/subscriptions/resources/autorenew/${encodeURIComponent(id)}`, "DELETE");
      const observed = (await resourceLookup(s, id, false).catch(() => [])).find(row => asString(row.resource_id, "") === id);
      if (!observed || typeof observed.expire_policy !== "number" || !Object.hasOwn(expiryPolicies, String(observed.expire_policy)) || observed.expire_policy === 3) return { message: "Automatic renewal disablement accepted. Observe the original resource to verify its policy.", resourceId: resource!.id, jobId: id, asynchronous: true };
      return { message: `Automatic renewal disabled for ${asString(record.resource_name, id)}. The resource keeps running until ${asString(record.expire_time, "its expiry")} and is not renewed afterwards.` };
    }
    throw new ManagementInputError("Unsupported billing operation.");
  },
};
