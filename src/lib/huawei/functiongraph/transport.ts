import { asRecord, firstString } from "@/lib/huawei/parsers";
import "server-only";
import { createHmac } from "node:crypto";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { createObsCredential } from "@/lib/huawei/services/obs";
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
    const text = await response.text().catch(() => "");
    throw new Error(
      `Function code download returned ${response.status}: ${text.slice(0, 160)}`,
    );
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
      headers: {
        "Content-Type": "application/json;charset=utf8",
        "X-Auth-Token": session.token,
        ...init?.headers,
      },
    },
  );
  const text = await response.text().catch(() => "");

  if (!response.ok) {
    const body = asRecord(parseJsonOrText(text));
    const message = firstString(
      [body.error_msg, body.message, body.errorMessage, response.statusText],
      "Huawei FunctionGraph request failed.",
    );

    throw new Error(`${response.status} ${message}`);
  }

  return { body: parseJsonOrText(text), response };
}
