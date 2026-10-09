import { asRecord } from "@/lib/huawei/parsers";
import "server-only";
import { createHmac } from "node:crypto";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { createObsCredential } from "@/lib/huawei/services/obs";
import { HuaweiApiError, huaweiRequestHeaders } from "@/lib/huawei/http";
import { serviceEndpoint } from "@/lib/huawei/endpoints";
export async function downloadFunctionGraphCodeLink(
  session: BetterUiSession,
  link: string,
) {
  const codeUrl = new URL(link);
  const bucket = codeUrl.hostname.split(".")[0];
  const credential = await createObsCredential(session);
  const date = new Date().toUTCString();
  const canonicalHeaders = `x-obs-security-token:${credential.securityToken}\n`;
  const canonicalResource = `/${bucket}${codeUrl.pathname}`;
  const signature = createHmac("sha1", credential.secret)
    .update(
      ["GET", "", "", date, `${canonicalHeaders}${canonicalResource}`].join(
        "\n",
      ),
    )
    .digest("base64");
  const response = await fetch(codeUrl, {
    cache: "no-store",
    headers: {
      Authorization: `OBS ${credential.access}:${signature}`,
      Date: date,
      Host: codeUrl.host,
      "x-obs-security-token": credential.securityToken,
    },
  });

  if (!response.ok) {
    throw new HuaweiApiError(`Function code download returned ${response.status}.`, response.status);
  }

  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

function parseJsonOrText(text: string) {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function functionGraphFetchWithHeaders(
  session: HuaweiProjectSession,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(
    `${serviceEndpoint("fg", session.region)}${path}`,
    {
      ...init,
      cache: "no-store",
      headers: huaweiRequestHeaders(session, init?.headers),
    },
  );
  const text = await response.text().catch(() => "");

  if (!response.ok) {
    throw new HuaweiApiError(`Huawei rejected this FunctionGraph request (${response.status}).`, response.status);
  }
  const parsed = parseJsonOrText(text);
  // Invocation output belongs to the function and may legitimately be text or contain error-like keys.
  if (!path.split("?", 1)[0].endsWith("/invocations")) {
    if (typeof parsed === "string") throw new Error("Huawei returned an unverifiable FunctionGraph response. Check native state before retrying.");
    const row = asRecord(parsed);
    if (row.error_code !== undefined && String(row.error_code) !== "0") throw new HuaweiApiError("Huawei rejected this FunctionGraph request.", 502);
  }

  return { body: parsed, response };
}
