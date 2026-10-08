import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CloudLoadError, errorMessage } from "./errors";

export type CloudResult<T> = {
  data: T;
  error: string | null;
  isCached: boolean;
  isRefreshing: boolean;
  updatedAt: string;
};

type StoredResult<T> = { data: T; updatedAt: string };
type LoadResult<T> = { data: T; error: string | null; updatedAt: string };

/** Disk-backed stale-while-revalidate cache. Failures preserve the last good data. */
export function createCloudCache({
  directory,
  staleAfterMs = 15_000,
  now = Date.now,
}: {
  directory: string;
  staleAfterMs?: number;
  now?: () => number;
}) {
  const active = new Map<string, Promise<LoadResult<unknown>>>();
  const attempts = new Map<string, number>();
  const failures = new Map<string, string>();
  const generations = new Map<string, number>();
  const writes = new Map<string, Promise<unknown>>();
  const generation = (key: string) => generations.get(key) ?? 0;
  const filename = (key: string) =>
    path.join(
      directory,
      `${createHash("sha256").update(key).digest("hex")}.json`,
    );

  async function serialize<T>(key: string, operation: () => Promise<T>) {
    const previous = writes.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    writes.set(key, next);
    try {
      return await next;
    } finally {
      if (writes.get(key) === next) writes.delete(key);
    }
  }

  async function read<T>(key: string): Promise<StoredResult<T> | null> {
    try {
      const stored: unknown = JSON.parse(await readFile(filename(key), "utf8"));
      if (
        !stored ||
        typeof stored !== "object" ||
        !("data" in stored) ||
        !("updatedAt" in stored)
      )
        return null;
      if (
        typeof stored.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(stored.updatedAt))
      )
        return null;
      return stored as StoredResult<T>;
    } catch {
      return null;
    }
  }

  async function persist<T>(
    key: string,
    data: StoredResult<T>,
    version: number,
  ) {
    await serialize(key, async () => {
      if (generation(key) !== version) return;
      await mkdir(directory, { recursive: true });
      const temporary = `${filename(key)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(data), {
          encoding: "utf8",
          mode: 0o600,
        });
        if (generation(key) === version) await rename(temporary, filename(key));
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
  }

  function refresh<T>(
    key: string,
    loader: () => Promise<T>,
  ): Promise<LoadResult<T>> {
    const existing = active.get(key);
    if (existing) return existing as Promise<LoadResult<T>>;
    const version = generation(key);
    attempts.set(key, now());
    const job = Promise.resolve()
      .then(loader)
      .then(async (data) => {
        const stored = { data, updatedAt: new Date(now()).toISOString() };
        // Disk failures must not hide a successful API response.
        await persist(key, stored, version).catch(() => undefined);
        if (generation(key) === version) failures.delete(key);
        return { ...stored, error: null };
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        if (generation(key) === version) failures.set(key, message);
        if (
          error instanceof CloudLoadError &&
          error.partialData !== undefined
        ) {
          return {
            data: error.partialData as T,
            error: message,
            updatedAt: new Date(now()).toISOString(),
          };
        }
        throw error;
      })
      .finally(() => {
        if (active.get(key) === job) active.delete(key);
      });
    active.set(key, job);
    return job;
  }

  async function get<T>(
    key: string,
    fallback: T,
    loader: () => Promise<T>,
  ): Promise<CloudResult<T>> {
    const stored = await read<T>(key);
    if (stored) {
      if (
        now() - Date.parse(stored.updatedAt) > staleAfterMs &&
        (!attempts.has(key) || now() - attempts.get(key)! > staleAfterMs)
      ) {
        void refresh(key, loader).catch(() => undefined);
      }
      return {
        ...stored,
        error: failures.get(key) ?? null,
        isCached: true,
        isRefreshing: active.has(key),
      };
    }
    try {
      return {
        ...(await refresh(key, loader)),
        isCached: false,
        isRefreshing: false,
      };
    } catch (error) {
      return {
        data: fallback,
        error: errorMessage(error),
        isCached: false,
        isRefreshing: false,
        updatedAt: new Date(now()).toISOString(),
      };
    }
  }

  async function invalidate(key: string) {
    generations.set(key, generation(key) + 1);
    active.delete(key);
    attempts.delete(key);
    failures.delete(key);
    await serialize(key, () => unlink(filename(key)).catch(() => undefined));
  }

  return { get, refresh, invalidate };
}

export type CloudCache = ReturnType<typeof createCloudCache>;
