import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementResource } from "@/lib/management-contract";
import { HuaweiApiError, huaweiFetch as nativeFetch } from "@/lib/huawei/http";
import { asRecord, firstString } from "@/lib/huawei/parsers";
import { collectList } from "@/lib/huawei/pagination";
import { CloudLoadError, mapCloudLoad } from "@/lib/huawei/errors";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

// Verified BSS Intl v3 package list and v2 usage contracts. Order-instance IDs identify purchases;
// product IDs identify offerings and must never be used as purchased-instance identities.
// Purchase/renewal, reassignment, unsubscription/refund quotes, exports and older archives remain gaps.
// Native queries cannot return packages that expired over 18 months ago. EPS-scoped packages require
// separate explicit queries; permission errors stay visible and partial loads never enter the cache.
const states: Record<number, string> = { 0: "Not effective", 1: "In effect", 2: "Used up", 3: "Expired", 4: "Unsubscribed" };
const prefix = "package:";
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function id(value: unknown) { return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 64; }
function text(value: unknown) { return firstString([value], "Unknown"); }
function quantity(value: unknown) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : "Unknown";
  return typeof value === "string" && value.length <= 32 && /^\d+(\.\d+)?$/.test(value) ? value : "Unknown";
}
async function request(s: BetterUiSession, service: "bss" | "eps", path: string, body?: unknown) {
  if (!s.accountToken) throw new ManagementInputError("Sign in again to obtain an account token.", 409);
  try {
    const response = await nativeFetch<Record<string, unknown>>({ ...s, token: s.accountToken }, service, path, { method: body === undefined ? "GET" : "POST", headers: { "X-Language": "en_US" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.error_code !== undefined && response.error_code !== "0") throw new HuaweiApiError("Huawei rejected the package request.", 502);
    return response;
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected the resource package request (HTTP ${error.status}).`, error.status);
    throw new Error("Huawei returned an unverifiable resource package response.");
  }
}
function rows(value: unknown, key: string) {
  if (!Array.isArray(value)) throw new Error("Huawei returned an incomplete package list.");
  const items = value.map(asRecord), seen = new Set<string>();
  for (const item of items) {
    if (!id(item[key]) || seen.has(String(item[key]))) throw new Error("Huawei returned missing or duplicate package identities.");
    seen.add(String(item[key]));
  }
  return items;
}
function page(response: Record<string, unknown>, key: string) {
  if (!Array.isArray(response[key]) || !count(response.total_count) || Number(response.total_count) < response[key].length) throw new Error("Huawei returned an incomplete package page or total.");
  return response;
}
async function projects(s: BetterUiSession) {
  const body = await collectList(cursor => request(s, "eps", `/v1.0/enterprise-projects?limit=100&offset=${cursor}`).then(body => page(body, "enterprise_projects")), { items: ["enterprise_projects"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return rows(body.enterprise_projects, "id").map(row => String(row.id));
}
async function scopedPackages(s: BetterUiSession, enterpriseProject?: string) {
  const body = await collectList(cursor => request(s, "bss", "/v3/payments/free-resources/query", { offset: cursor, limit: 100, ...(enterpriseProject === undefined ? {} : { enterprise_project_id: enterpriseProject }) }).then(body => page(body, "free_resource_packages")), { items: ["free_resource_packages"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  const packages = rows(body.free_resource_packages, "order_instance_id");
  for (const pkg of packages) {
    if (enterpriseProject !== undefined && pkg.enterprise_project_id !== enterpriseProject) throw new Error("Huawei returned a package from another enterprise project.");
    if (enterpriseProject === undefined && pkg.enterprise_project_id !== undefined && pkg.enterprise_project_id !== null && pkg.enterprise_project_id !== "" && pkg.enterprise_project_id !== "0") throw new Error("Huawei returned an unexpected enterprise-project package.");
    const items = rows(pkg.free_resources, "free_resource_id");
    const scope = enterpriseProject ?? "";
    pkg.query_scope = scope;
    pkg.free_resources = items;
  }
  return packages;
}
async function packages(s: BetterUiSession) {
  const initial = await Promise.allSettled([scopedPackages(s), projects(s)]);
  const collected = initial[0].status === "fulfilled" ? initial[0].value : [];
  let incomplete = initial.some(result => result.status === "rejected");
  if (initial[1].status === "fulfilled") {
    const extra = await Promise.allSettled(initial[1].value.map(project => scopedPackages(s, project)));
    for (const result of extra) { if (result.status === "fulfilled") collected.push(...result.value); else incomplete = true; }
  }
  // Default EPS (0) can overlap the native unassigned query. Only byte-identical snapshots with
  // the same native purchase identity may coalesce; conflicting snapshots are never guessed.
  const unique = new Map<string, Record<string, unknown>>();
  for (const pkg of collected) {
    const key = String(pkg.order_instance_id), previous = unique.get(key);
    if (previous) {
      const { query_scope: previousScope, ...before } = previous, { query_scope: nextScope, ...after } = pkg;
      if (!((previousScope === "" && nextScope === "0") || (previousScope === "0" && nextScope === "")) || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Huawei returned conflicting package purchase identities.");
    } else unique.set(key, pkg);
  }
  const result = [...unique.values()];
  if (incomplete) throw new CloudLoadError("Resource package inventory is incomplete. Enterprise-project or billing permissions could not be verified.", result);
  return result;
}
function resource(pkg: Record<string, unknown>): ManagementResource {
  return { id: prefix + pkg.order_instance_id, name: firstString([pkg.product_name, pkg.order_instance_id], "Package"), status: typeof pkg.status === "number" ? states[pkg.status] ?? "Unknown" : "Unknown", values: { region: text(pkg.region_code), service: text(pkg.service_type_name ?? pkg.service_type_code), enterpriseProject: String(pkg.query_scope ?? ""), order: text(pkg.order_id), expires: text(pkg.expire_time), items: (pkg.free_resources as unknown[]).length } };
}
async function selected(s: BetterUiSession, selected?: ManagementResource) {
  const nativeId = selected?.id.startsWith(prefix) ? selected.id.slice(prefix.length) : "";
  if (!id(nativeId)) throw new ManagementInputError("Select a purchased resource package.");
  const scope = selected?.values?.enterpriseProject;
  if (scope !== undefined && typeof scope !== "string") throw new ManagementInputError("Select a verified package scope.");
  if (scope && !(await projects(s)).includes(scope)) throw new ManagementInputError("The package enterprise project is no longer available.", 409);
  const pkg = (await scopedPackages(s, scope || undefined)).find(row => row.order_instance_id === nativeId);
  if (!pkg) throw new ManagementInputError("The original package is no longer in this inventory scope. Missing packages can also be outside Huawei's retention window.", 404);
  return pkg;
}
async function units(s: BetterUiSession) {
  const body = await request(s, "bss", "/v2/bases/measurements");
  if (!Array.isArray(body.measure_units)) throw new Error("Huawei returned no package measurement unit catalog.");
  const result = new Map<number, string>();
  for (const row of body.measure_units.map(asRecord)) {
    if (!count(row.measure_id) || result.has(Number(row.measure_id)) || typeof row.measure_name !== "string" || !row.measure_name) throw new Error("Huawei returned an unverifiable package measurement unit.");
    result.set(Number(row.measure_id), row.measure_name);
  }
  return result;
}
function date(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ManagementInputError("Enter a date in YYYY-MM-DD format.");
  const milliseconds = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) throw new ManagementInputError("Enter a valid calendar date.");
  return milliseconds;
}
export const packagesManagement: ManagementAdapter = {
  title: "Resource Packages",
  accountWide: true,
  operations: [
    { id: "inspect", label: "View package details", kind: "inspect", description: "Inspect a purchased package, its billing scope, expiry, reset policy, and included quotas. Huawei omits packages expired for more than 18 months.", fields: [], resourcePrefixes: [prefix] },
    { id: "usage", label: "View current remaining quota", kind: "inspect", description: "Read the current quota period and remaining amount for every resource item in this purchased package. Units remain separate.", fields: [], resourcePrefixes: [prefix] },
    { id: "records", label: "View quota deductions", kind: "inspect", description: "Inspect native usage deductions for one verified package item over up to 90 days. Dates use UTC+08:00.", fields: [
      { key: "item", label: "Package item", type: "select", source: "items", required: true },
      { key: "begin", label: "First deduction date", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$", help: "YYYY-MM-DD in UTC+08:00." },
      { key: "end", label: "Last deduction date", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$", help: "YYYY-MM-DD; at most 90 days after the first date." },
    ], resourcePrefixes: [prefix] },
  ],
  inventory: s => mapCloudLoad(() => packages(s), items => items.map(resource)),
  options: async (s, operation, chosen): Promise<Record<string, ManagementChoice[]>> => {
    if (operation !== "records" || !chosen) return {};
    const items = (await selected(s, chosen)).free_resources as Record<string, unknown>[];
    return { items: items.map(row => ({ value: String(row.free_resource_id), label: text(row.usage_type_name) })) };
  },
  invalidationKeys: () => [cloudCacheKeys.listResourcePackages, cloudCacheKeys.summary],
  execute: async (s, operation, values, chosen) => {
    if (!["inspect", "usage", "records"].includes(operation)) throw new ManagementInputError("Unsupported resource package operation. Purchase and unsubscription require their service-specific order workflows.");
    const pkg = await selected(s, chosen), items = pkg.free_resources as Record<string, unknown>[];
    const measurements = await units(s);
    const amount = (value: unknown, unit: unknown) => `${quantity(value)} ${typeof unit === "number" ? measurements.get(unit) ?? `unit ${unit}` : "unknown unit"}`;
    if (operation === "inspect") return { message: "Current purchased-package configuration. Quotas of different units are not combined.", resourceId: chosen!.id, facts: [
      { label: "Purchase ID", value: String(pkg.order_instance_id) }, { label: "Offering ID", value: text(pkg.product_id) }, { label: "Order", value: text(pkg.order_id) }, { label: "Region", value: text(pkg.region_code) }, { label: "Status", value: resource(pkg).status! }, { label: "Enterprise project", value: text(pkg.enterprise_project_id) }, { label: "Effective", value: text(pkg.effective_time) }, { label: "Expires", value: text(pkg.expire_time) }, { label: "Reset mode", value: pkg.quota_reuse_mode === 1 ? "Resettable" : pkg.quota_reuse_mode === 2 ? "Not resettable" : "Unknown" },
      ...items.map(item => ({ label: `${text(item.usage_type_name)} · ${item.free_resource_id}`, value: `${amount(item.amount, item.measure_id)} remaining of ${amount(item.original_amount, item.measure_id)}` })),
    ] };
    if (operation === "usage") {
      const output: Record<string, unknown>[] = [];
      for (let start = 0; start < items.length; start += 100) {
        const ids = items.slice(start, start + 100).map(row => String(row.free_resource_id));
        const body = await request(s, "bss", "/v2/payments/free-resources/usages/details/query", { free_resource_ids: ids });
        const current = rows(body.free_resources, "free_resource_id");
        if (current.length !== ids.length || current.some(row => !ids.includes(String(row.free_resource_id)))) throw new Error("Huawei returned missing or foreign package quota items.");
        output.push(...current);
      }
      return { message: "Current native quota periods and remaining amounts. Reset periods are shown per item.", resourceId: chosen!.id, facts: output.map(row => ({ label: `${text(row.usage_type_name)} · ${row.free_resource_id}`, value: `${amount(row.amount, row.measure_id)} remaining of ${amount(row.original_amount, row.measure_id)}; ${text(row.start_time)} to ${text(row.end_time)}` })) };
    }
    const item = items.find(row => row.free_resource_id === values.item);
    if (!item) throw new ManagementInputError("Select a current item belonging to this package.");
    const begin = date(values.begin), end = date(values.end);
    if (end < begin || end - begin > 90 * 86400000) throw new ManagementInputError("The deduction date range must be ordered and no longer than 90 days.");
    const query = new URLSearchParams({ free_resource_id: String(item.free_resource_id), deduct_time_begin: String(values.begin), deduct_time_end: String(values.end), limit: "100" });
    const body = await collectList(cursor => { query.set("offset", String(cursor)); return request(s, "bss", `/v2/bills/customer-bills/free-resources-usage-records?${query}`).then(body => page(body, "free_resource_records")); }, { items: ["free_resource_records"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
    const records = (body.free_resource_records as unknown[]).map(asRecord);
    for (const row of records) {
      const timestamp = typeof row.deduct_time === "string" ? Date.parse(row.deduct_time) : NaN;
      if (row.free_resource_id !== item.free_resource_id || (row.product_id !== undefined && row.product_id !== pkg.product_id) || !id(row.resource_id) || !Number.isFinite(timestamp) || timestamp < begin - 8 * 3600000 || timestamp >= end + 86400000 - 8 * 3600000) throw new Error("Huawei returned an unverifiable or foreign package deduction record.");
    }
    return { message: `Loaded ${records.length} native package deduction records in the selected UTC+08:00 date range.`, resourceId: chosen!.id, facts: records.map(row => ({ label: `${row.deduct_time} · ${row.resource_id}`, value: `${amount(row.used_amount, row.measure_id)} deducted; ${amount(row.remaining_amount, row.measure_id)} remaining` })) };
  },
};
