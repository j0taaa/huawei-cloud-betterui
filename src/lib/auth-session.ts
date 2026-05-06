import "server-only";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";

import { sessionCookieName } from "@/lib/auth-constants";

export { sessionCookieName };

export type BetterUiSession = {
  accountName: string;
  catalog?: unknown[];
  createdAt: string;
  expiresAt: string;
  iamEndpoint: string;
  projectId: string;
  projectName: string;
  projects: HuaweiProjectSession[];
  region: string;
  token: string;
  userId?: string;
  username: string;
};

export type HuaweiProjectSession = {
  expiresAt: string;
  projectId: string;
  projectName: string;
  region: string;
  token: string;
};

type SessionRecord = BetterUiSession & {
  id: string;
};

const globalSessions = globalThis as typeof globalThis & {
  __betterUiSessions?: Map<string, SessionRecord>;
};

const sessions =
  globalSessions.__betterUiSessions ??
  new Map<string, SessionRecord>();

globalSessions.__betterUiSessions = sessions;

export function createSession(session: BetterUiSession) {
  const id = randomUUID();
  sessions.set(id, { ...session, id });
  return id;
}

export function getSessionById(id: string | undefined) {
  if (!id) {
    return null;
  }

  const session = sessions.get(id);

  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    sessions.delete(id);
    return null;
  }

  return session;
}

export async function getCurrentSession() {
  const sessionId = (await cookies()).get(sessionCookieName)?.value;
  return getSessionById(sessionId);
}

export function deleteSession(id: string | undefined) {
  if (!id) {
    return;
  }

  sessions.delete(id);
}

export function getSessionCookieOptions(expiresAt?: string) {
  return {
    expires: expiresAt ? new Date(expiresAt) : undefined,
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
