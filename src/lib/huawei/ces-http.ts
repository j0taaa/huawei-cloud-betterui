import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { HuaweiProjectSession } from "@/lib/auth-session";
import { serviceEndpoint } from "@/lib/huawei/endpoints";
import { huaweiFetch } from "@/lib/huawei/http";
import { asRecord, firstString } from "@/lib/huawei/parsers";
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function rfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalQuery(params: URLSearchParams) {
  return Array.from(params.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join("&");
}

async function huaweiCesAkskFetch<T>(
  session: HuaweiProjectSession,
  path: string,
  init?: RequestInit,
) {
  const access = process.env.HUAWEI_CLOUD_AK;
  const secret = process.env.HUAWEI_CLOUD_SK;

  if (!access || !secret) {
    throw new Error(
      "Huawei Cloud AK/SK credentials are not configured for CES fallback.",
    );
  }

  const endpoint = serviceEndpoint("ces", session.region);
  const url = new URL(`${endpoint}${path}`);
  const body = typeof init?.body === "string" ? init.body : "";
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const headers: Record<string, string> = {
    "content-type": "application/json;charset=utf8",
    host: url.host,
    "x-sdk-date": timestamp,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}\n`)
    .join("");
  const canonicalPath = `${url.pathname.replace(/\/+$/, "")}/`
    .split("/")
    .map((part) => rfc3986(decodeURIComponent(part)))
    .join("/");
  const canonicalRequest = [
    init?.method ?? "GET",
    canonicalPath,
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    sha256(body),
  ].join("\n");
  const stringToSign = [
    "SDK-HMAC-SHA256",
    timestamp,
    sha256(canonicalRequest),
  ].join("\n");
  const response = await fetch(url.toString(), {
    ...init,
    cache: "no-store",
    headers: {
      ...headers,
      Authorization: `SDK-HMAC-SHA256 Access=${access}, SignedHeaders=${signedHeaders}, Signature=${hmacSha256(secret, stringToSign)}`,
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let errorBody: Record<string, unknown> = {};

    if (text) {
      try {
        errorBody = asRecord(JSON.parse(text) as unknown);
      } catch {
        errorBody = {};
      }
    }

    throw new Error(
      firstString(
        [
          [errorBody.error_code, errorBody.error_msg]
            .filter(Boolean)
            .join(": "),
          errorBody.message,
          response.statusText,
        ],
        `Huawei CES request returned ${response.status}.`,
      ),
    );
  }

  return (await response.json().catch(() => ({}))) as T;
}

export async function huaweiCesFetch<T>(
  session: HuaweiProjectSession,
  path: string,
  init?: RequestInit,
) {
  if (process.env.HUAWEI_CLOUD_AK && process.env.HUAWEI_CLOUD_SK) {
    try {
      return await huaweiCesAkskFetch<T>(session, path, init);
    } catch (error) {
      return huaweiFetch<T>(session, "ces", path, init).catch(() => {
        throw error;
      });
    }
  }

  try {
    return await huaweiFetch<T>(session, "ces", path, init);
  } catch (error) {
    if (!process.env.HUAWEI_CLOUD_AK || !process.env.HUAWEI_CLOUD_SK) {
      throw error;
    }

    return huaweiCesAkskFetch<T>(session, path, init);
  }
}
