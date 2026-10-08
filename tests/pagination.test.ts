import { huaweiList } from "@/lib/huawei/http";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import assert from "node:assert/strict";
import { test } from "node:test";
import { project } from "./fixtures/session";

const offset: Pagination = {
  items: ["items"],
  kind: "offset",
  parameter: "offset",
  size: 2,
};

test("offset and page cursors advance according to their distinct protocols", async () => {
  for (const kind of ["offset", "page"] as const) {
    const seen: unknown[] = [];
    const body = await collectList(
      async (cursor) => {
        seen.push(cursor);
        return {
          items: seen.length === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }],
        };
      },
      { ...offset, kind, first: kind === "page" ? 1 : 0 },
    );
    assert.deepEqual(seen, kind === "page" ? [1, 2] : [0, 2]);
    assert.equal(body.items.length, 3);
  }
});

test("marker pagination follows a cursor even when a page is shorter than the limit", async () => {
  const seen: unknown[] = [];
  const body = await collectList(
    async (cursor) => {
      seen.push(cursor);
      return {
        result: { records: [{ id: seen.length }] },
        page_info: { next_marker: seen.length === 1 ? "next +/%" : "" },
      };
    },
    {
      items: ["result.records"],
      kind: "marker",
      parameter: "marker",
      size: 100,
      next: ["page_info.next_marker"],
    },
  );
  assert.deepEqual(seen, [undefined, "next +/%"]);
  assert.equal(body.result.records.length, 2);
});

test("last-resource fallback finishes exact full pages and accepts an empty final page", async () => {
  const seen: unknown[] = [];
  const body = await collectList(
    async (cursor) => {
      seen.push(cursor);
      return { items: cursor === undefined ? [{ id: "a" }, { id: "b" }] : [] };
    },
    { ...offset, kind: "marker", next: ["next"], fallbackKey: "id" },
  );
  assert.deepEqual(seen, [undefined, "b"]);
  assert.equal(body.items.length, 2);
});

test("known totals handle server-side page-size caps", async () => {
  let calls = 0;
  const body = await collectList(
    async () => ({ items: [{ id: ++calls }], total: 3 }),
    { ...offset, size: 100, total: ["total"] },
  );
  assert.equal(body.items.length, 3);
  assert.equal(calls, 3);
});

test("repeating cursor and ignored pagination fail instead of caching incomplete inventories", async () => {
  await assert.rejects(
    collectList(async () => ({ items: [{ id: "a" }, { id: "b" }] }), offset),
    /repeated a page/,
  );
  let calls = 0;
  await assert.rejects(
    collectList(async () => ({ items: [{ id: ++calls }], next: "same" }), {
      ...offset,
      kind: "marker",
      next: ["next"],
    }),
    /repeated its pagination cursor/,
  );
});

test("malformed list shapes and later-page failures remain errors", async () => {
  await assert.rejects(
    collectList(async () => ({ unexpected: [] }), offset),
    /Invalid list response/,
  );
  let calls = 0;
  await assert.rejects(
    collectList(async () => {
      if (++calls === 2) throw Error("403 second page");
      return { items: [{ id: "a" }, { id: "b" }] };
    }, offset),
    /403 second page/,
  );
});

test("an empty later page cannot silently truncate a known total", async () => {
  let calls = 0;
  await assert.rejects(
    collectList(async () => ({ items: ++calls === 1 ? [1] : [], total: 2 }), {
      ...offset,
      total: ["total"],
    }),
    /before its reported total/,
  );
});

test("GET pagination retains filters and authentication", async (t) => {
  const urls: URL[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      const url = new URL(input);
      urls.push(url);
      assert.equal(url.searchParams.get("engine"), "kafka");
      assert.equal(
        new Headers(init.headers).get("X-Auth-Token"),
        project.token,
      );
      assert.equal(init.cache, "no-store");
      return Response.json({ items: urls.length === 1 ? [1, 2] : [3] });
    },
  );
  const body = await huaweiList<{ items: number[] }>(
    project,
    "dms",
    "/v2/project-1/instances?limit=2&engine=kafka",
    offset,
  );
  assert.deepEqual(body.items, [1, 2, 3]);
  assert.deepEqual(
    urls.map((url) => url.searchParams.get("offset")),
    ["0", "2"],
  );
});

test("read-only POST pagination retains body filters and custom headers", async (t) => {
  const bodies: Record<string, unknown>[] = [];
  const init = {
    method: "POST",
    body: JSON.stringify({ limit: 2, project_id: "p", offset: 0 }),
    headers: { Accept: "application/json" },
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: string, request: RequestInit) => {
      assert.equal(request.method, "POST");
      assert.equal(
        new Headers(request.headers).get("Accept"),
        "application/json",
      );
      const body = JSON.parse(String(request.body));
      bodies.push(body);
      assert.equal(body.project_id, "p");
      return Response.json({ items: bodies.length === 1 ? [1, 2] : [3] });
    },
  );
  await huaweiList(
    project,
    "cfw",
    "/list?enterprise_project_id=all_granted_eps",
    { ...offset, inBody: true },
    init,
  );
  assert.deepEqual(
    bodies.map((body) => body.offset),
    [0, 2],
  );
  assert.equal(JSON.parse(init.body).offset, 0);
});
