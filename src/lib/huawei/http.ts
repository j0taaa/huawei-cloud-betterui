import "server-only";

import { collectList, type Pagination } from "@/lib/huawei/pagination";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import type { ServiceKey } from "@/lib/huawei/endpoints";
import { serviceEndpoint } from "@/lib/huawei/endpoints";
import { asRecord, firstString } from "@/lib/huawei/parsers";

// Preserve HTTP status so mutation callers can distinguish rejection from an uncertain outcome.
const apiErrorBrand = Symbol.for("betterui.huawei-api-error");
export class HuaweiApiError extends Error {
  readonly [apiErrorBrand] = true;
  static [Symbol.hasInstance](value: unknown): boolean { return value !== null && typeof value === "object" && (value as Record<symbol, unknown>)[apiErrorBrand] === true; }
  constructor(message: string, public readonly status: number) { super(message); }
}

export async function parseError(response: Response) {
  const body = (await response.json().catch(() => null)) as unknown;
  const record = asRecord(body);
  const error = asRecord(record.error ?? record.Error);
  const message = firstString(
    [
      error.message,
      error.error_msg,
      record.message,
      record.error_msg,
      response.statusText,
    ],
    "Huawei Cloud API request failed.",
  );

  return `${response.status} ${message}`;
}

export async function huaweiFetch<T>(
  session: HuaweiProjectSession,
  service: ServiceKey,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(
    `${serviceEndpoint(service, session.region)}${path}`,
    {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json;charset=utf8",
        "X-Auth-Token": session.token,
        ...init?.headers,
      },
    },
  );

  if (!response.ok) {
    throw new HuaweiApiError(await parseError(response), response.status);
  }

  const payload = await response.text();
  return (payload.trim() ? JSON.parse(payload) : {}) as T;
}

export async function huaweiAccountFetch<T>(
  session: BetterUiSession,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(
    `${session.iamEndpoint.replace(/\/+$/, "")}${path}`,
    {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json;charset=utf8",
        "X-Auth-Token": session.token,
        ...init?.headers,
      },
    },
  );

  if (!response.ok) {
    throw new HuaweiApiError(await parseError(response), response.status);
  }

  const payload = await response.text();
  return (payload.trim() ? JSON.parse(payload) : {}) as T;
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
