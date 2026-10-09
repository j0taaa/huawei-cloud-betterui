import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { isValidElement, type ReactNode } from "react";
import { CloudErrorBanner } from "@/components/cloud-error";
import { createSession, deleteSession } from "@/lib/auth-session";
import { createCloudCache } from "@/lib/huawei/cache-store";
import { withSessionCookie } from "./fixtures/request-context.mjs";
import { session } from "./fixtures/session";

const directory = mkdtempSync(
  path.join(os.tmpdir(), "betterui-detail-errors-"),
);
let time = Date.now();
const cache = createCloudCache({ directory, now: () => time });
(
  globalThis as typeof globalThis & { __betterUiCloudCache?: typeof cache }
).__betterUiCloudCache = cache;
after(() => rm(directory, { recursive: true, force: true }));
function errorBanner(
  node: ReactNode,
): { error: string; isCached: boolean } | undefined {
  if (Array.isArray(node)) return node.map(errorBanner).find(Boolean);
  if (
    !isValidElement<{ children?: ReactNode; error: string; isCached: boolean }>(
      node,
    )
  )
    return undefined;
  if (node.type === CloudErrorBanner) return node.props;
  return errorBanner(node.props.children);
}

test("RDS detail renders a backup permission error alongside its usable partial instance", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("/backups")
      ? Response.json(
          { error_msg: "backup permission denied" },
          { status: 403 },
        )
      : Response.json({
          instances: [{ id: "db-1", name: "database", nodes: [] }],
        }),
  );
  const { default: page } = await import("@/app/services/rds/[id]/page");
  const id = createSession(session);
  try {
    const tree = await withSessionCookie(id, () =>
      page({ params: Promise.resolve({ id: "db-1" }) }),
    );
    const banner = errorBanner(tree);
    assert.match(banner?.error ?? "", /backups: 403.*permission denied/);
    assert.equal(banner?.isCached, false);
  } finally {
    deleteSession(id);
  }
});

test("RDS detail displays refresh failures while retaining the last complete data", async (t) => {
  const { sessionCacheScope } = await import("@/lib/huawei/result");
  const { getRdsInstanceDetails } = await import("@/lib/huawei/services/rds");
  const key = `rds-instance:db-2:${sessionCacheScope(session)}`;
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("/backups")
      ? Response.json({ backups: [] })
      : Response.json({
          instances: [{ id: "db-2", name: "database", nodes: [] }],
        }),
  );
  await cache.get(key, null, () => getRdsInstanceDetails(session, "db-2"));
  time += 16_000;
  fetchMock.mock.mockImplementation(async () =>
    Response.json({ error_msg: "refresh permission denied" }, { status: 403 }),
  );
  await cache.get(key, null, () => getRdsInstanceDetails(session, "db-2"));
  // Wait for the background refresh, without advancing the retry clock.
  for (let i = 0; i < 100; i++) {
    const result = await cache.get(key, null, () =>
      getRdsInstanceDetails(session, "db-2"),
    );
    if (!result.isRefreshing) {
      assert.match(result.error ?? "", /403.*permission denied/);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const { default: page } = await import("@/app/services/rds/[id]/page");
  const id = createSession(session);
  try {
    const tree = await withSessionCookie(id, () =>
      page({ params: Promise.resolve({ id: "db-2" }) }),
    );
    const banner = errorBanner(tree);
    assert.match(banner?.error ?? "", /403.*permission denied/);
    assert.equal(banner?.isCached, true);
  } finally {
    deleteSession(id);
  }
});
