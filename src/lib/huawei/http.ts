import "server-only";

import { collectList, type Pagination } from "@/lib/huawei/pagination";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import type { ServiceKey } from "@/lib/huawei/endpoints";
import { serviceEndpoint } from "@/lib/huawei/endpoints";

// Preserve HTTP status so mutation callers can distinguish rejection from an uncertain outcome.
const apiErrorBrand = Symbol.for("betterui.huawei-api-error");
export class HuaweiApiError extends Error {
  readonly [apiErrorBrand] = true;
  static [Symbol.hasInstance](value: unknown): boolean { return value !== null && typeof value === "object" && (value as Record<symbol, unknown>)[apiErrorBrand] === true; }
  constructor(message: string, public readonly status: number) { super(message); }
}

export async function parseError(response: Response) {
  // Native errors can echo passwords, connection strings, or request payloads.
  // Public errors retain the HTTP status and a stable explanation only.
  const reason = ({
    400: "Huawei Cloud rejected the request parameters.",
    401: "Huawei Cloud authentication failed. Sign in again.",
    403: "permission denied by Huawei Cloud. Check the selected account and project permissions.",
    404: "Huawei Cloud resource not found.",
    409: "Huawei Cloud reported a conflicting operation. Refresh the resource before retrying.",
    429: "Huawei Cloud request limit reached. Retry later.",
  } as Record<number, string>)[response.status] ?? (response.status >= 500 ? "Huawei Cloud could not complete the request. Check the current resource state before retrying." : "Huawei Cloud rejected the request.");
  // A cloned response can wait for its sibling before cancellation settles.
  // Release this branch without delaying the public HTTP rejection.
  void response.body?.cancel().catch(() => undefined);
  return `${response.status} ${reason}`;
}

async function readHuaweiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new HuaweiApiError(await parseError(response), response.status);
  let payload: string;
  try { payload = await response.text(); }
  catch { throw new Error("Huawei Cloud response could not be read. Check the current resource state before retrying."); }
  let result: unknown;
  try { result = payload.trim() ? JSON.parse(payload) : {}; }
  catch { throw new SyntaxError("Huawei Cloud returned invalid JSON. Check the current resource state before retrying."); }
  return result as T;
}

async function fetchHuaweiResponse(url: string, init: RequestInit) {
  try { return await fetch(url, init); }
  catch { throw new Error("Huawei Cloud could not be reached. Check the current resource state before retrying."); }
}

/** Normalize all standard HeadersInit forms before merging authentication and service headers. */
export function huaweiRequestHeaders(session: HuaweiProjectSession, supplied?: HeadersInit) {
  const headers = new Headers({ "Content-Type": "application/json;charset=utf8", "X-Auth-Token": session.token });
  new Headers(supplied).forEach((value, name) => headers.set(name, value));
  return headers;
}

export async function huaweiFetch<T>(
  session: HuaweiProjectSession,
  service: ServiceKey,
  path: string,
  init?: RequestInit,
) {
  const response = await fetchHuaweiResponse(
    `${serviceEndpoint(service, session.region)}${path}`,
    {
      ...init,
      cache: "no-store",
      headers: huaweiRequestHeaders(session, init?.headers),
    },
  );

  return readHuaweiResponse<T>(response);
}

export async function huaweiAccountFetch<T>(
  session: BetterUiSession,
  path: string,
  init?: RequestInit,
) {
  const response = await fetchHuaweiResponse(
    `${session.iamEndpoint.replace(/\/+$/, "")}${path}`,
    {
      ...init,
      cache: "no-store",
      headers: huaweiRequestHeaders(session, init?.headers),
    },
  );

  return readHuaweiResponse<T>(response);
}

/** Pagination is configured by the adapter; transport never guesses a service's protocol. */
export async function huaweiList<T>(
  session: HuaweiProjectSession,
  service: ServiceKey,
  path: string,
  pagination: Pagination,
  init?: RequestInit,
): Promise<T> {
  return collectList<T>(async (cursor) => {
    const url = new URL(path, "https://huawei.invalid");
    let pageInit = init;
    if (pagination.inBody) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      if (cursor !== undefined) body[pagination.parameter] = cursor;
      pageInit = { ...init, body: JSON.stringify(body) };
    } else if (cursor !== undefined) {
      url.searchParams.set(pagination.parameter, String(cursor));
    }
    return huaweiFetch<T>(
      session,
      service,
      `${url.pathname}${url.search}`,
      pageInit,
    );
  }, pagination);
}

/** Some documented endpoints return a JSON array rather than an object envelope. */
export async function huaweiArrayList<T>(
  session: HuaweiProjectSession,
  service: ServiceKey,
  path: string,
  pagination: Omit<Pagination, "items" | "inBody" | "total" | "next" | "hasMore">,
): Promise<T[]> {
  const result = await collectList<{ items: T[] }>(async cursor => {
    const url = new URL(path, "https://huawei.invalid");
    if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor));
    const body = await huaweiFetch<unknown>(session, service, `${url.pathname}${url.search}`);
    if (!Array.isArray(body)) throw new Error("Invalid list response: expected a JSON array.");
    return { items: body as T[] };
  }, { ...pagination, items: ["items"] });
  return result.items;
}
