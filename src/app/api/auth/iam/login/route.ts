import { NextResponse } from "next/server";

import {
  createSession,
  getSessionCookieOptions,
  sessionCookieName,
} from "@/lib/auth-session";
import { createHuaweiIamToken } from "@/lib/huawei-iam";

const requiredFields = [
  "accountName",
  "username",
  "password",
  "projectName",
] as const;

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!body) {
    return NextResponse.json(
      { error: "Send account, IAM username, password, and project." },
      { status: 400 },
    );
  }

  const fields = {
    accountName: readString(body.accountName),
    iamEndpoint: readString(body.iamEndpoint),
    password: typeof body.password === "string" ? body.password : "",
    projectName: readString(body.projectName),
    region: readString(body.region) || readString(body.projectName),
    username: readString(body.username),
  };

  const missingField = requiredFields.find((field) => !fields[field]);

  if (missingField) {
    return NextResponse.json(
      { error: `Missing required field: ${missingField}.` },
      { status: 400 },
    );
  }

  try {
    const iamToken = await createHuaweiIamToken(fields);
    const sessionId = createSession({
      accountName: fields.accountName,
      catalog: iamToken.catalog,
      createdAt: new Date().toISOString(),
      expiresAt: iamToken.expiresAt,
      iamEndpoint: iamToken.iamEndpoint,
      projectName: iamToken.projectName,
      region: fields.region,
      token: iamToken.token,
      userId: iamToken.userId,
      username: fields.username,
    });

    const response = NextResponse.json({
      expiresAt: iamToken.expiresAt,
      ok: true,
    });

    response.cookies.set(
      sessionCookieName,
      sessionId,
      getSessionCookieOptions(iamToken.expiresAt),
    );

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei IAM login failed.",
      },
      { status: 401 },
    );
  }
}
