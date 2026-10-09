import "server-only";
import type { HuaweiProjectSession } from "@/lib/auth-session";
import { HuaweiApiError, huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord } from "@/lib/huawei/parsers";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import { ManagementInputError } from "@/lib/management-contract";
const base = (s: HuaweiProjectSession) => `/v1/${s.projectId}`;

// Native HTTP errors are rethrown with sanitized text and the original HTTP status; server errors
// and non-JSON bodies become uncertain outcomes instead of leaking native payload text.
export function sanitize(error: unknown): Error {
  if (error instanceof HuaweiApiError) return new HuaweiApiError(`Huawei rejected the ModelArts request (HTTP ${error.status}).`, error.status);
  return new Error("Huawei returned an invalid ModelArts response. Verify the notebook before retrying.");
}
export function requireProject(s: HuaweiProjectSession, row: Record<string, unknown>) {
  for (const key of ["project_id", "projectId"]) if (key in row && row[key] !== s.projectId) throw new Error("Huawei returned an unverifiable ModelArts project scope.");
}
export async function maFetch<T>(s: HuaweiProjectSession, path: string, init?: RequestInit, notFound?: string): Promise<T> {
  let body: Record<string, unknown>;
  try { body = await huaweiFetch<Record<string, unknown>>(s, "modelarts", `${base(s)}${path}`, init); }
  catch (error) {
    if (error instanceof HuaweiApiError && error.status === 404 && notFound) throw new ManagementInputError(notFound, 404);
    throw sanitize(error);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Huawei returned an invalid ModelArts response.");
  requireProject(s, body);
  if (("error_code" in body && body.error_code !== "0" && body.error_code !== 0) || "error_msg" in body || "error" in body) throw new Error("Huawei reported a ModelArts business error. Verify the cloud state before retrying.");
  return body as T;
}
export async function maList<T>(s: HuaweiProjectSession, path: string, pagination: Pagination): Promise<T> {
  const query = new URLSearchParams(path.split("?")[1]);
  return collectList(async cursor => {
    query.set(pagination.parameter, String(cursor));
    const body = await maFetch<Record<string, unknown>>(s, `${path.split("?")[0]}?${query}`);
    const key = pagination.items[0], total = body[pagination.total![0]];
    if (!Array.isArray(body[key])) throw new Error("Huawei returned an incomplete ModelArts page.");
    if (typeof total !== "number" || !Number.isSafeInteger(total) || total < body[key].length) throw new Error("Huawei omitted the native total or returned an invalid ModelArts page total.");
    for (const row of body[key].map(asRecord)) requireProject(s, row);
    return body;
  }, pagination) as Promise<T>;
}

// Native rows are never silently filtered: missing arrays, empty or duplicated IDs and invalid
// owner or workspace fields are hard errors so an incomplete inventory can never masquerade as
// a complete one.
export function requireRows(rows: Record<string, unknown>[], label: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) throw new Error(`Huawei returned a ${label} entry without a valid native ID.`);
    if (seen.has(row.id)) throw new Error(`Huawei returned duplicate native IDs for ${label}.`);
    seen.add(row.id);
  }
}
export function requireOwner(row: Record<string, unknown>, key: string, expected: string | undefined, label: string) {
  if (!(key in row)) return;
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`Huawei returned a ${label} entry with an invalid owner field.`);
  if (expected !== undefined && value !== expected) throw new Error(`Huawei returned a ${label} entry owned by a different user.`);
}
export function requireWorkspaceScope(row: Record<string, unknown>, expected: string, label: string) {
  if ("workspace_id" in row && row.workspace_id !== expected) throw new Error(`Huawei returned a ${label} entry outside its requested workspace.`);
}

export async function notebooks(s: HuaweiProjectSession) {
  // GET /v1/{project_id}/notebooks/all is natively offset/limit paginated and reports a total.
  const body = await maList<{ data?: unknown; total?: unknown }>(s, "/notebooks/all?limit=50", { items: ["data"], kind: "offset", parameter: "offset", size: 50, total: ["total"] });
  if (typeof body.total !== "number") throw new Error("Huawei omitted the native total of the notebook list; the inventory may be incomplete.");
  const rows = asArray(body.data).map(asRecord);
  requireRows(rows, "notebook");
  for (const row of rows) {
    requireOwner(row, "user_id", undefined, "notebook");
    if ("workspace_id" in row && (typeof row.workspace_id !== "string" || !row.workspace_id)) throw new Error("Huawei returned a notebook with an invalid workspace.");
  }
  return rows;
}
