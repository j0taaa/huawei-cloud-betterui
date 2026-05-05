import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  deleteSession,
  getSessionCookieOptions,
  sessionCookieName,
} from "@/lib/auth-session";

export async function POST() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(sessionCookieName)?.value;

  deleteSession(sessionId);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, "", {
    ...getSessionCookieOptions(),
    expires: new Date(0),
  });

  return response;
}
