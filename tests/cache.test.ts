import { createCloudCache } from "@/lib/huawei/cache-store";
import { CloudLoadError } from "@/lib/huawei/errors";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { deferred } from "./fixtures/session";

async function setup(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "huawei-cache-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = Date.parse("2026-01-01T00:00:00Z");
  const cache = createCloudCache({ directory, now: () => time });
  return {
    directory,
    cache,
    advance: (ms = 16_000) => {
      time += ms;
    },
    filename: (key: string) =>
      path.join(
        directory,
        `${createHash("sha256").update(key).digest("hex")}.json`,
      ),
  };
}

test("fresh cache survives a new cache instance without fetching", async (t) => {
  const { cache, directory } = await setup(t);
  const initial = await cache.get("list:account", [], async () => [1]);
  assert.equal(initial.isCached, false);
  const restarted = createCloudCache({
    directory,
    now: () => Date.parse(initial.updatedAt),
  });
  const result = await restarted.get("list:account", [], async () => {
    throw Error("should not fetch");
  });
  assert.deepEqual(result.data, [1]);
  assert.equal(result.isCached, true);
});

test("concurrent cold reads share one loader", async (t) => {
  const { cache } = await setup(t);
  const pending = deferred<number[]>();
  let calls = 0;
  const loader = () => {
    calls++;
    return pending.promise;
  };
  const results = Array.from({ length: 12 }, () =>
    cache.get("key", [], loader),
  );
  // Wait for all reads to reach the shared refresh without timing-dependent sleeps.
  await new Promise<void>((resolve) => setImmediate(resolve));
  pending.resolve([42]);
  assert.deepEqual(
    (await Promise.all(results)).map((item) => item.data),
    Array(12).fill([42]),
  );
  assert.equal(calls, 1);
});

test("stale reads return immediately and deduplicate background refresh", async (t) => {
  const { cache, advance } = await setup(t);
  await cache.get("key", [], async () => [1]);
  advance();
  const pending = deferred<number[]>();
  let calls = 0;
  const loader = () => {
    calls++;
    return pending.promise;
  };
  const results = await Promise.all(
    Array.from({ length: 8 }, () => cache.get("key", [], loader)),
  );
  assert.ok(results.every((result) => result.isCached && result.isRefreshing));
  assert.deepEqual(results[0].data, [1]);
  assert.equal(calls, 1);
  pending.resolve([2]);
  await cache.refresh("key", loader);
  assert.deepEqual((await cache.get("key", [], loader)).data, [2]);
});

test("failed refresh preserves disk data and exposes error, then retries", async (t) => {
  const { cache, advance } = await setup(t);
  await cache.get("key", [], async () => [1]);
  advance();
  await assert.rejects(
    cache.refresh("key", async () => {
      throw Error("403 denied");
    }),
    /403/,
  );
  const stale = await cache.get("key", [], async () => [2]);
  assert.deepEqual(stale.data, [1]);
  assert.equal(stale.error, "403 denied");
  assert.equal(stale.isRefreshing, false);
  advance();
  const retry = await cache.get("key", [], async () => [2]);
  assert.equal(retry.isRefreshing, true);
  await cache.refresh("key", async () => [3]);
  const fresh = await cache.get("key", [], async () => []);
  assert.deepEqual(fresh.data, [2]);
  assert.equal(fresh.error, null);
});

test("partial results are displayed on a cold miss but never persisted", async (t) => {
  const { cache, directory } = await setup(t);
  const result = await cache.get("key", [], async () => {
    throw new CloudLoadError("region unavailable", [7]);
  });
  assert.deepEqual(result.data, [7]);
  assert.equal(result.error, "region unavailable");
  assert.deepEqual(await readdir(directory), []);
  await cache.get("key", [], async () => [1, 7]);
  await cache.refresh("key", async () => {
    throw new CloudLoadError("region unavailable", [7]);
  });
  assert.deepEqual((await cache.get("key", [], async () => [])).data, [1, 7]);
});

test("invalid JSON and invalid timestamps recover as misses", async (t) => {
  const { cache, filename } = await setup(t);
  for (const corrupt of ['{"data":', '{"data":[9],"updatedAt":"invalid"}']) {
    await writeFile(filename("key"), corrupt);
    assert.deepEqual((await cache.get("key", [], async () => [1])).data, [1]);
  }
});

test("invalidation prevents an old refresh from restoring deleted data", async (t) => {
  const { cache, advance, filename } = await setup(t);
  await cache.get("key", [], async () => [1]);
  advance();
  const pending = deferred<number[]>();
  const old = cache.refresh("key", () => pending.promise);
  await cache.invalidate("key");
  await cache.get("key", [], async () => [3]);
  pending.resolve([2]);
  await old;
  assert.deepEqual(
    JSON.parse(await readFile(filename("key"), "utf8")).data,
    [3],
  );
});

test("old failures cannot replace a newer successful generation", async (t) => {
  const { cache } = await setup(t);
  const pending = deferred<number[]>();
  const old = cache.refresh("key", () => pending.promise);
  await cache.invalidate("key");
  await cache.get("key", [], async () => [3]);
  pending.reject(Error("old request failed"));
  await assert.rejects(old);
  assert.equal((await cache.get("key", [], async () => [])).error, null);
});

test("atomic writes leave valid records and no temporary files", async (t) => {
  const { cache, directory, filename } = await setup(t);
  await cache.get("key", [], async () => [1]);
  for (let i = 2; i <= 6; i++) {
    const update = cache.refresh("key", async () => Array(10_000).fill(i));
    await Promise.all(
      Array.from({ length: 10 }, async () =>
        JSON.parse(await readFile(filename("key"), "utf8")),
      ),
    );
    await update;
  }
  assert.deepEqual(await readdir(directory), [path.basename(filename("key"))]);
});

test("separate session scopes do not share results", async (t) => {
  const { cache } = await setup(t);
  await cache.get("list:user-a", [], async () => [1]);
  await cache.get("list:user-b", [], async () => [2]);
  await cache.invalidate("list:user-a");
  assert.deepEqual(
    (await cache.get("list:user-b", [], async () => [])).data,
    [2],
  );
});

test("unwritable cache location does not hide a successful API response", async (t) => {
  const { directory } = await setup(t);
  const file = path.join(directory, "file");
  await writeFile(file, "not a directory");
  const cache = createCloudCache({ directory: file });
  const result = await cache.get("key", [], async () => [1]);
  assert.deepEqual(result.data, [1]);
  assert.equal(result.error, null);
});
