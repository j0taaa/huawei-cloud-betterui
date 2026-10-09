import assert from "node:assert/strict";
import { test } from "node:test";
import { huaweiFetch, huaweiAccountFetch, HuaweiApiError } from "@/lib/huawei/http";
import { functionGraphFetchWithHeaders } from "@/lib/huawei/functiongraph/transport";
import { session } from "./fixtures/session";

test("Huawei transports preserve every standard header input and case-insensitive overrides", async t => {
  const calls: Headers[] = [];
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => { calls.push(new Headers(init.headers)); return Response.json({}); });
  for (const headers of [new Headers({ region: session.region, "content-type": "application/custom" }), [["region", session.region], ["content-type", "application/custom"]] as [string, string][], { region: session.region, "content-type": "application/custom" }]) {
    await huaweiFetch(session, "hss", "/headers", { headers });
    await huaweiAccountFetch(session, "/headers", { headers });
    await functionGraphFetchWithHeaders(session, "/headers", { headers });
  }
  assert.equal(calls.length, 9);
  assert.ok(calls.every(headers => headers.get("region") === session.region && headers.get("content-type") === "application/custom" && headers.get("X-Auth-Token") === session.token));
});

test("FunctionGraph transport preserves rejection status without exposing private cloud payloads", async t => {
  for (const response of [new Response("PRIVATE_PASSWORD", { status: 403 }), Response.json({ error_code: "FGS.1", error_msg: "PRIVATE_PASSWORD" }), new Response("PRIVATE_PASSWORD", { status: 200 })]) {
    t.mock.method(globalThis, "fetch", async () => response.clone());
    await assert.rejects(functionGraphFetchWithHeaders(session, "/functions/config"), error => error instanceof Error && !error.message.includes("PRIVATE_PASSWORD"));
  }
  t.mock.method(globalThis, "fetch", async () => new Response("PRIVATE_PASSWORD", { status: 403 }));
  await assert.rejects(functionGraphFetchWithHeaders(session, "/functions/config"), error => error instanceof HuaweiApiError && error.status === 403);
});

test("FunctionGraph invocation output and successful empty acknowledgements retain their native meaning", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("plain function output"));
  assert.equal((await functionGraphFetchWithHeaders(session, "/functions/urn/invocations")).body, "plain function output");
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_code: "application-result", result: "intentional" }));
  assert.deepEqual((await functionGraphFetchWithHeaders(session, "/functions/urn/invocations")).body, { error_code: "application-result", result: "intentional" });
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  assert.equal((await functionGraphFetchWithHeaders(session, "/functions/urn")).body, null);
});
