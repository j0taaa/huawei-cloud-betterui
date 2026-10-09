import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createSession, deleteSession } from "@/lib/auth-session";
import { createCloudCache } from "@/lib/huawei/cache-store";
import { withSessionCookie } from "./fixtures/request-context.mjs";
import { session } from "./fixtures/session";

const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-mutations-"));
const cache = createCloudCache({ directory });
(
  globalThis as typeof globalThis & { __betterUiCloudCache?: typeof cache }
).__betterUiCloudCache = cache;
after(() => rm(directory, { recursive: true, force: true }));

for (const [service, listing, detail, action] of [
  ["rds", "listRdsInstances", "rds-instance", "reboot"],
  ["dds", "listDdsInstances", "dds-instance", "restart"],
  ["gaussdb", "listGaussDbInstances", "gaussdb-instance", "reboot"],
  ["taurusdb", "listTaurusDbInstances", "taurusdb-instance", "reboot"],
]) {
  test(`${service} actions invalidate both inventory and detail cache entries`, async (t) => {
    const { sessionCacheScope } = await import("@/lib/huawei/result");
    const keys = [listing, `${detail}:db-1`].map(
      (key) => `${key}:${sessionCacheScope(session)}`,
    );
    for (const key of keys)
      await cache.get(key, null, async () => ({ status: "ACTIVE" }));
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ job_id: "mock-job" }),
    );
    const route = await import(
      `../src/app/api/cloud/${service}/[id]/action/route`
    );
    const id = createSession(session);
    try {
      const response = await withSessionCookie(id, () =>
        route.POST(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ action, projectId: session.projectId }),
          }),
          { params: Promise.resolve({ id: "db-1" }) },
        ),
      );
      assert.equal(response.status, 200);
      for (const key of keys) {
        const refreshed = await cache.get(key, null, async () => ({
          status: "REBOOTING",
        }));
        assert.equal(refreshed.isCached, false);
        assert.equal(
          (refreshed.data as { status: string }).status,
          "REBOOTING",
        );
      }
    } finally {
      deleteSession(id);
    }
  });
}

test("OBS download/delete preserve whitespace and percent characters in the exact object key", async (t) => {
  const operations: { url: string; method: string }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init?: RequestInit) => {
      if (input.includes("securitytokens"))
        return Response.json({
          credential: {
            access: "access",
            secret: "secret",
            securitytoken: "security-token",
          },
        });
      if (input.endsWith("/"))
        return new Response(
          "<Buckets><Bucket><Name>bucket</Name><Location>sa-brazil-1</Location></Bucket></Buckets>",
        );
      operations.push({ url: input, method: init?.method ?? "GET" });
      return new Response(init?.method === "DELETE" ? null : "data", {
        status: init?.method === "DELETE" ? 204 : 200,
      });
    },
  );
  const { GET, DELETE } = await import("@/app/api/cloud/obs/objects/route");
  const key = " report%2F.txt ";
  const id = createSession(session);
  try {
    for (const handler of [GET, DELETE]) {
      const response = await withSessionCookie(id, () =>
        handler(
          new Request(
            "http://localhost/api/cloud/obs/objects?" +
              new URLSearchParams({ bucket: "bucket", key }),
          ),
        ),
      );
      assert.equal(response.status, 200);
    }
    assert.deepEqual(
      operations.map((op) => new URL(op.url).pathname),
      ["/" + encodeURIComponent(key), "/" + encodeURIComponent(key)],
    );
    assert.deepEqual(
      operations.map((op) => op.method),
      ["GET", "DELETE"],
    );
  } finally {
    deleteSession(id);
  }
});

test("OBS mutations invalidate literal nested folder prefixes without normalizing separators", async (t) => {
  const { sessionCacheScope } = await import("@/lib/huawei/result");
  const key = "root//file.txt";
  const prefixKey = `obs-bucket:bucket:root//:${sessionCacheScope(session)}`;
  await cache.get(prefixKey, [], async () => [key]);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input.includes("securitytokens"))
      return Response.json({
        credential: {
          access: "access",
          secret: "secret",
          securitytoken: "security-token",
        },
      });
    if (input.endsWith("/"))
      return new Response(
        "<Buckets><Bucket><Name>bucket</Name><Location>sa-brazil-1</Location></Bucket></Buckets>",
      );
    return new Response(null, { status: 204 });
  });
  const { DELETE } = await import("@/app/api/cloud/obs/objects/route");
  const id = createSession(session);
  try {
    const response = await withSessionCookie(id, () =>
      DELETE(
        new Request(
          "http://localhost?" + new URLSearchParams({ bucket: "bucket", key }),
        ),
      ),
    );
    assert.equal(response.status, 200);
    const result = await cache.get(prefixKey, [], async () => []);
    assert.equal(result.isCached, false);
    assert.deepEqual(result.data, []);
  } finally {
    deleteSession(id);
  }
});

test("FunctionGraph trigger mutations invalidate the global trigger inventory", async (t) => {
  const { sessionCacheScope } = await import("@/lib/huawei/result");
  const key = `functiongraph-triggers:${sessionCacheScope(session)}`;
  await cache.get(key, [], async () => [{ id: "old-trigger" }]);
  t.mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("/triggers/")
      ? Response.json({ trigger_id: "new-trigger" })
      : Response.json({
          functions: [
            {
              func_name: "fn-1",
              func_urn:
                "urn:fss:sa-brazil-1:project-1:function:default:fn-1:latest",
              runtime: "Python3.9",
            },
          ],
        }),
  );
  const { POST } =
    await import("@/app/api/cloud/functiongraph/[id]/triggers/route");
  const id = createSession(session);
  try {
    const response = await withSessionCookie(id, () =>
      POST(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({
            projectId: session.projectId,
            triggerTypeCode: "TIMER",
            eventData: { name: "schedule", schedule: "@every 5m" },
          }),
        }),
        { params: Promise.resolve({ id: "fn-1" }) },
      ),
    );
    assert.equal(response.status, 200, await response.text());
    assert.equal(
      (await cache.get(key, [], async () => [{ id: "new-trigger" }])).isCached,
      false,
    );
  } finally {
    deleteSession(id);
  }
});
