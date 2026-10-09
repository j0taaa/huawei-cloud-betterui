import "server-only";
import type { HuaweiProjectSession } from "@/lib/auth-session";
import { HuaweiApiError, huaweiFetch } from "@/lib/huawei/http";
import { asRecord } from "@/lib/huawei/parsers";

// Shared-gateway buyer subscription APIs; marketplace seller APIs do not authorize buyer orders.
const root = "/v1.0/apigw/purchases";
export function kooScope(session: HuaweiProjectSession, row: Record<string, unknown>) {
  for (const key of ["project_id", "projectId"]) if (key in row && row[key] !== session.projectId) throw new Error("Huawei returned an unverifiable purchased API project scope.");
}
export function kooId(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= 128 && !/[\s/\\?#\u0000-\u001f]/u.test(value);
}
async function request(session: HuaweiProjectSession, path: string) {
  if (!session.projectId?.trim()) throw new Error("Select a project before inspecting purchased APIs.");
  let body: Record<string, unknown>;
  try { body = await huaweiFetch<Record<string, unknown>>(session, "apig", path); }
  catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected the purchased API request (HTTP ${error.status}).`, error.status);
    throw new Error("Huawei returned an unverifiable purchased API response.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Huawei returned an unverifiable purchased API response.");
  for (const item of [body, asRecord(body.data)]) {
    kooScope(session, item);
    if (("error_code" in item && item.error_code !== 0 && item.error_code !== "0") || "error_msg" in item || "error" in item) throw new Error("Huawei reported a purchased API business failure.");
  }
  return body;
}
async function list(session: HuaweiProjectSession, kind: "groups" | "apis", key: "purchases" | "apis") {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let page = 1; page <= 1000; page++) {
    // Native first-page API: /v1.0/apigw/purchases/apis?page_size=100&page_no=1
    const body = await request(session, `${root}/${kind}?page_size=100&page_no=${page}`);
    const items = body[key];
    if (!Array.isArray(items) || typeof body.total !== "number" || !Number.isSafeInteger(body.total) || body.total < 0 || typeof body.size !== "number" || body.size !== items.length || !Number.isSafeInteger(body.size) || body.size > 100) throw new Error("Huawei returned an incomplete purchased API inventory page.");
    if (total !== undefined && total !== body.total) throw new Error("Purchased API inventory changed during pagination. Refresh before inspecting subscriptions.");
    total = body.total;
    for (const item of items) {
      const row = asRecord(item); kooScope(session, row);
      if (!kooId(row.id) || (kind === "groups" ? !kooId(row.group_id) : !kooId(row.purchase_id))) throw new Error("Huawei returned an unverifiable purchased API or subscription identity.");
      const identity = kind === "groups" ? row.id : JSON.stringify([row.purchase_id, row.id]);
      if (seen.has(identity)) throw new Error("Huawei returned duplicate purchased API identities.");
      seen.add(identity); rows.push(row);
    }
    if (rows.length > total || (!items.length && rows.length < total)) throw new Error("Huawei returned incomplete purchased API inventory.");
    if (rows.length === total) return rows;
  }
  throw new Error("Purchased API inventory exceeded its pagination limit.");
}
function text(value: unknown) { return typeof value === "string" && value.trim() ? value : "Unknown"; }
function count(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function timestamp(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value)) ? value : "Unknown";
}
function domains(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string" && item.length <= 253 && /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/u.test(item))) return null;
  return [...new Set(value)];
}
export type PurchasedApiSubscription = {
  id: string; groupId: string; name: string; description: string; orderedAt: string;
  startsAt: string; expiresAt: string; quotaLeft: number | null; quotaUsed: number | null; domains: string[] | null;
};
function subscription(row: Record<string, unknown>): PurchasedApiSubscription {
  return { id: String(row.id), groupId: String(row.group_id), name: text(row.group_name), description: typeof row.group_remark === "string" ? row.group_remark : "", orderedAt: timestamp(row.order_time), startsAt: timestamp(row.start_time), expiresAt: timestamp(row.expire_time), quotaLeft: count(row.quota_left), quotaUsed: count(row.quota_used), domains: domains(row.group_domains) };
}
// Positive projections keep generated app_key/app_secret out of loaders, forms, caches and history.
export async function listPurchasedApiSubscriptions(session: HuaweiProjectSession) {
  return (await list(session, "groups", "purchases")).map(subscription);
}
export async function getPurchasedApiSubscription(session: HuaweiProjectSession, selected: PurchasedApiSubscription) {
  const row = await request(session, `${root}/groups/${encodeURIComponent(selected.id)}`);
  if (row.id !== selected.id || row.group_id !== selected.groupId) throw new Error("Huawei returned a different purchased API subscription.");
  return subscription(row);
}
export type PurchasedApi = { id: string; purchaseId: string; name: string; description: string; path: string; groupId: string; groupName: string };
export async function listPurchasedApis(session: HuaweiProjectSession, subscriptions?: PurchasedApiSubscription[]): Promise<PurchasedApi[]> {
  const parents = subscriptions ?? await listPurchasedApiSubscriptions(session);
  const byId = new Map(parents.map(item => [item.id, item]));
  return (await list(session, "apis", "apis")).map(row => {
    const parent = byId.get(String(row.purchase_id));
    if (!parent) throw new Error("Huawei returned an API without a current owned subscription.");
    if ("group_id" in row && row.group_id !== parent.groupId) throw new Error("Huawei returned an API from another subscription group.");
    const path = typeof row.req_uri === "string" && row.req_uri.startsWith("/") && !/[?#\u0000-\u001f]/u.test(row.req_uri) && row.req_uri.length <= 2048 ? row.req_uri : "Unknown";
    return { id: String(row.id), purchaseId: parent.id, name: text(row.name), description: typeof row.remark === "string" ? row.remark : "", path, groupId: parent.groupId, groupName: parent.name };
  });
}
