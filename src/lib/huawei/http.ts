import "server-only";

import { collectList, type Pagination } from "@/lib/huawei/pagination";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import type { ServiceKey } from "@/lib/huawei/endpoints";
import { serviceEndpoint } from "@/lib/huawei/endpoints";
import { asRecord, firstString } from "@/lib/huawei/parsers";

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
    throw new Error(await parseError(response));
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
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
    throw new Error(await parseError(response));
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
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
