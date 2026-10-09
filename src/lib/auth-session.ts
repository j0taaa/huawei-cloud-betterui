import "server-only";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";

import { sessionCookieName } from "@/lib/auth-constants";
import { createHuaweiIamSession } from "@/lib/huawei-iam";

export { sessionCookieName };

export type BetterUiSession = {
  accountName: string;
  accountToken?: string;
  catalog?: unknown[];
  createdAt: string;
  expiresAt: string;
  iamEndpoint: string;
  projectId: string;
  projectName: string;
  projects: HuaweiProjectSession[];
  region: string;
  token: string;
  tokenExpiresAt: string;
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
  refreshCredentials?: {
    accountName: string;
    iamEndpoint?: string;
    password: string;
    username: string;
  };
};

const appSessionDurationMs = 30 * 24 * 60 * 60 * 1000;
const tokenRefreshWindowMs = 10 * 60 * 1000;
const refreshingSessions = new Map<string, Promise<SessionRecord | null>>();

const globalSessions = globalThis as typeof globalThis & {
  __betterUiSessions?: Map<string, SessionRecord>;
};

const sessions =
  globalSessions.__betterUiSessions ?? new Map<string, SessionRecord>();

globalSessions.__betterUiSessions = sessions;

export function createSession(session: BetterUiSession) {
  const id = randomUUID();
  sessions.set(id, { ...session, id });
  return id;
}

export function appSessionExpiresAt(from = new Date()) {
  return new Date(from.getTime() + appSessionDurationMs).toISOString();
}

export function createRefreshableSession(
  session: BetterUiSession,
  refreshCredentials: NonNullable<SessionRecord["refreshCredentials"]>,
) {
  const id = randomUUID();
  sessions.set(id, { ...session, id, refreshCredentials });
  return id;
}

function isExpired(value: string, offsetMs = 0) {
  return new Date(value).getTime() - offsetMs <= Date.now();
}

async function refreshSessionToken(id: string, session: SessionRecord) {
  if (!session.refreshCredentials) {
    return null;
  }

  const existingRefresh = refreshingSessions.get(id);

  if (existingRefresh) {
    return existingRefresh;
  }

  const refresh = createHuaweiIamSession(session.refreshCredentials)
    .then((iamToken): SessionRecord => {
      const refreshedSession: SessionRecord = {
        ...session,
        accountToken: iamToken.accountToken,
        iamEndpoint: iamToken.iamEndpoint,
        projectId: iamToken.projectId,
        projectName: iamToken.projectName,
        projects: iamToken.projects,
        region: iamToken.region,
        token: iamToken.token,
        tokenExpiresAt: iamToken.expiresAt,
        userId: iamToken.userId,
      };

      sessions.set(id, refreshedSession);
      return refreshedSession;
    })
    .catch(() => {
      sessions.delete(id);
      return null;
    })
    .finally(() => {
      refreshingSessions.delete(id);
    });

  refreshingSessions.set(id, refresh);
  return refresh;
}

export async function getSessionById(id: string | undefined) {
  if (!id) {
    return null;
  }

  const session = sessions.get(id);

  if (!session) {
    return null;
  }

  if (isExpired(session.expiresAt)) {
    sessions.delete(id);
    return null;
  }

  if (isExpired(session.tokenExpiresAt, tokenRefreshWindowMs)) {
    return refreshSessionToken(id, session);
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

export function getSessionProjects(session: BetterUiSession) {
  return session.projects?.length
    ? session.projects
    : [
        {
          expiresAt: session.tokenExpiresAt,
          projectId: session.projectId,
          projectName: session.projectName,
          region: session.region,
          token: session.token,
        },
      ];
}
