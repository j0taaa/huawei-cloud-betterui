import "server-only";

import {
  getCurrentSession,
  getSessionProjects,
  type BetterUiSession,
} from "@/lib/auth-session";
import path from "node:path";
import {
  createCloudCache,
  type CloudCache,
  type CloudResult,
} from "./cache-store";

export type { CloudResult } from "./cache-store";

const globalCache = globalThis as typeof globalThis & {
  __betterUiCloudCache?: CloudCache;
};
const cache = (globalCache.__betterUiCloudCache ??= createCloudCache({
  directory: path.join(process.cwd(), ".next", "cache", "huawei-cloud-data"),
}));

// Preserve the existing identity scope and disk format across this refactor.
export function sessionCacheScope(session: BetterUiSession) {
  return JSON.stringify({
    accountName: session.accountName,
    projectId: session.projectId,
    projects: getSessionProjects(session).map(({ projectId, region }) => ({
      projectId,
      region,
    })),
    region: session.region,
    userId: session.userId,
    username: session.username,
  });
}

export async function withCloudResult<T>(
  fallback: T,
  loader: (session: BetterUiSession) => Promise<T>,
  cacheKey: string,
): Promise<CloudResult<T>> {
  const session = await getCurrentSession();
  if (!session) {
    return {
      data: fallback,
      error: "Not signed in.",
      isCached: false,
      isRefreshing: false,
      updatedAt: new Date().toISOString(),
    };
  }
  return cache.get(`${cacheKey}:${sessionCacheScope(session)}`, fallback, () =>
    loader(session),
  );
}

export async function invalidateCloudResult(
  session: BetterUiSession,
  cacheKey: string,
) {
  await cache.invalidate(`${cacheKey}:${sessionCacheScope(session)}`);
}
