import assert from "node:assert/strict";
import { test } from "node:test";
import { huaweiAccountFetch, huaweiFetch, HuaweiApiError, parseError } from "@/lib/huawei/http";
import { session } from "./fixtures/session";

test("native HTTP errors retain status without provider payloads or status text", async t => {
  let status = 400;
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_msg: "private-password-123", error: { message: "private-connection-string" } }, { status, statusText: "private-status-text" }));
  for (status of [400, 401, 403, 404, 409, 429, 500, 502]) {
    for (const request of [() => huaweiFetch(session, "ecs", "/private-path"), () => huaweiAccountFetch(session, "/private-path")]) {
      await assert.rejects(request(), error => {
        assert.ok(error instanceof HuaweiApiError);
        assert.equal(error.status, status);
        assert.ok(error.message.startsWith(String(status)));
        assert.ok(!error.message.includes("private-"));
        return true;
      });
    }
  }
});

test("native error sanitization does not require JSON error bodies", async () => {
  for (const body of ["private-secret", "{private-secret:broken}", "<html>private-secret</html>"]) {
    const message = await parseError(new Response(body, { status: 403 }));
    assert.match(message, /403.*permission denied/);
    assert.ok(!message.includes("private-secret"));
  }
});

test("both native transports sanitize network failures and unreadable responses", async t => {
  let failure = "network";
  t.mock.method(globalThis, "fetch", async () => {
    if (failure === "network") throw new Error("private-credential-in-request-url");
    const response = new Response("unused");
    response.text = async () => { throw new Error("private-response-stream"); };
    return response;
  });
  for (failure of ["network", "stream"]) for (const request of [() => huaweiFetch(session, "ecs", "/cloudservers"), () => huaweiAccountFetch(session, "/v3/auth/tokens")]) await assert.rejects(request(), error => {
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof HuaweiApiError));
    assert.ok(!error.message.includes("private-"));
    assert.match(error.message, /Check the current resource state/);
    return true;
  });
});

test("malformed successful JSON stays a SyntaxError without echoing its contents", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response('{"private-password":"do-not-log",broken:}', { status: 200 }));
  for (const request of [() => huaweiFetch(session, "ecs", "/cloudservers"), () => huaweiAccountFetch(session, "/v3/auth/tokens")]) await assert.rejects(request(), error => {
    assert.ok(error instanceof SyntaxError);
    assert.ok(!error.message.includes("private-password") && !error.message.includes("do-not-log"));
    assert.match(error.message, /invalid JSON/);
    return true;
  });
});

test("response parsing preserves successful arrays, objects, and empty native ACKs", async t => {
  let payload = "";
  t.mock.method(globalThis, "fetch", async () => new Response(payload, { status: 200 }));
  for (payload of ["", "   ", '{"id":"original-id"}', '[{"id":"original-id"}]']) {
    const expected = payload.trim() ? JSON.parse(payload) : {};
    assert.deepEqual(await huaweiFetch(session, "ecs", "/cloudservers"), expected);
    assert.deepEqual(await huaweiAccountFetch(session, "/v3/auth/tokens"), expected);
  }
});

test("native job failure records reach their service-specific completion observers", async t => {
  const body = { id: "original-job", status: "Failed", error: { message: "private-job-diagnostic" } };
  t.mock.method(globalThis, "fetch", async () => Response.json(body));
  assert.deepEqual(await huaweiFetch(session, "apig", "/jobs/original-job"), body);
});

test("HTTP rejection parsing does not await cancellation of a cloned body", async () => {
  const original = Response.json({ error_msg: "private-diagnostic" }, { status: 403 });
  const clone = original.clone();
  const message = await Promise.race([parseError(clone), new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Cloned response cancellation blocked HTTP error handling.")), 500);
    timer.unref();
  })]);
  assert.match(message, /403.*permission denied/);
  assert.ok(!message.includes("private-diagnostic"));
  await original.body?.cancel();
});
