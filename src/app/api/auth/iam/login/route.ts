import { NextResponse } from "next/server";

import {
  createSession,
  getSessionCookieOptions,
  sessionCookieName,
} from "@/lib/auth-session";
import { createHuaweiIamSession } from "@/lib/huawei-iam";

const requiredFields = [
  "accountName",
  "username",
  "password",
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
      { error: "Send account, IAM username, and password." },
      { status: 400 },
    );
  }

  const fields = {
    accountName: readString(body.accountName),
    iamEndpoint: readString(body.iamEndpoint),
    password: typeof body.password === "string" ? body.password : "",
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
    const iamToken = await createHuaweiIamSession(fields);
    const sessionId = createSession({
      accountName: fields.accountName,
      createdAt: new Date().toISOString(),
      expiresAt: iamToken.expiresAt,
      iamEndpoint: iamToken.iamEndpoint,
      projectId: iamToken.projectId,
      projectName: iamToken.projectName,
      projects: iamToken.projects,
      region: iamToken.region,
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
