import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { HuaweiApiError } from "@/lib/huawei/http";
import { assertObsBucket, createObsCredential, deleteObsObject, downloadObsObject, getObsBucket, obsBucketConfigurationRequest, obsFetchXml, obsHost, obsObjectRequest, readObsPreview, uploadObsObject } from "@/lib/huawei/services/obs";
import { session } from "./fixtures/session";
const credential = { access: "access", secret: "secret", securityToken: "token" };
const secret = "private-provider-diagnostic";
const object = () => ({ credential, bucket: "test-bucket", region: session.region, key: "original", method: "GET" as const });

function endpoint(t: TestContext, value: string) {
  const previous = process.env.HUAWEI_OBS_ENDPOINT;
  process.env.HUAWEI_OBS_ENDPOINT = value;
  t.after(() => { if (previous === undefined) delete process.env.HUAWEI_OBS_ENDPOINT; else process.env.HUAWEI_OBS_ENDPOINT = previous; });
}

for (const bucket of ["bucket@evil.example/path", "bucket/evil", "bucket\\evil", "bucket#fragment", "bucket?query", "UPPERCASE", "ab", "a".repeat(64), "127.0.0.1", "a..b", "a.-b", "a-.b", "-bucket", "bucket-"]) {
  test(`OBS rejects unsafe bucket identity ${JSON.stringify(bucket)} before credentials or writes`, async t => {
    let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error(secret); });
    for (const action of [() => getObsBucket(session, bucket), () => downloadObsObject(session, bucket, "original"), () => uploadObsObject(session, bucket, "original", new File(["body"], "file")), () => deleteObsObject(session, bucket, "original"), () => obsBucketConfigurationRequest(session, bucket, "PUT", "versioning", "body")]) await assert.rejects(action(), /Invalid OBS bucket name/);
    assert.equal(calls, 0);
  });
}
test("OBS retains valid dotted bucket names and a configured HTTPS endpoint port", t => {
  assert.doesNotThrow(() => assertObsBucket("valid.bucket"));
  endpoint(t, "https://obs.example.org:8443/");
  assert.equal(obsHost("sa-brazil-1", "valid.bucket"), "valid.bucket.obs.example.org:8443");
});
for (const configuredEndpoint of ["https://user:secret@obs.example.org", "http://obs.example.org", "https://obs.example.org/private", "https://obs.example.org/?token=secret", "https://obs.example.org/#secret", "https://[::1]"]) {
  test(`OBS rejects malformed endpoint ${configuredEndpoint}`, async t => {
    endpoint(t, configuredEndpoint); let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error(secret); });
    await assert.rejects(obsObjectRequest(object()), /Invalid OBS endpoint/); assert.equal(calls, 0);
  });
}
test("OBS provider regions cannot alter request authority even with endpoint override", async t => {
  endpoint(t, "obs.example.org"); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error(secret); });
  for (const region of ["region@evil.example", "region/path", "region?secret", "region\\path", ""]) await assert.rejects(obsObjectRequest({ ...object(), region }), /Invalid OBS region/);
  assert.equal(calls, 0);
});
test("OBS forbids URL dot-segment normalization before any credentials or object mutation", async t => {
  let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error(secret); });
  for (const key of [".", "..", "folder/../other", "folder/./other", "folder/..", "./original"]) {
    await assert.rejects(uploadObsObject(session, "test-bucket", key, new File(["body"], "file")), /dot segments/);
    await assert.rejects(deleteObsObject(session, "test-bucket", key), /dot segments/);
  }
  assert.equal(calls, 0);
});
test("OBS prevents signed identity and transport header overrides in every HeadersInit form", async t => {
  let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error(secret); });
  for (const name of ["Authorization", "Date", "Host", "x-obs-security-token", "X-Auth-Token", "Cookie", "Content-Type", "Content-Length"]) {
    for (const requestHeaders of [{ [name]: "private" }, new Headers({ [name]: "private" }), [[name, "private"]] as [string, string][]]) await assert.rejects(obsObjectRequest({ ...object(), requestHeaders }), /cannot be overridden/);
  }
  assert.equal(calls, 0);
});
test("OBS signed requests refuse redirects and preserve safe optional signed metadata", async t => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.equal(new URL(input).host, "test-bucket.obs.sa-brazil-1.myhuaweicloud.com"); assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers); assert.equal(headers.get("x-obs-security-token"), "token"); assert.equal(headers.get("x-obs-meta-example"), "value"); assert.match(headers.get("authorization")!, /^OBS access:/);
    return new Response("original");
  });
  assert.equal(await (await obsObjectRequest({ ...object(), requestHeaders: { "x-obs-meta-example": "value" } })).text(), "original");
});
test("OBS HTTP failures retain rejection status without XML diagnostics, status text, or cloned-body hangs", async t => {
  const response = new Response(`<Error><Message>${secret}</Message></Error>`, { status: 403, statusText: secret });
  const sibling = response.clone();
  t.mock.method(globalThis, "fetch", async () => sibling);
  await assert.rejects(obsObjectRequest(object()), error => error instanceof HuaweiApiError && error.status === 403 && /permission denied/.test(error.message) && !error.message.includes(secret));
  assert.ok(await response.text());
});
test("OBS credential and object transport failures do not expose provider diagnostics", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error(secret); });
  for (const action of [() => createObsCredential(session), () => obsObjectRequest(object())]) await assert.rejects(action(), error => error instanceof Error && !error.message.includes(secret) && /could not be reached/.test(error.message));
});
test("OBS XML, credential JSON, and preview stream failures have safe public messages", async t => {
  const response = () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)); } }));
  t.mock.method(globalThis, "fetch", async () => response());
  for (const action of [() => createObsCredential(session), () => obsFetchXml(credential, session.region, "/"), () => readObsPreview(response())]) await assert.rejects(action(), error => error instanceof Error && !error.message.includes(secret) && /could not be read/.test(error.message));
});
test("OBS rejects foreign-authority XML paths before signed network calls", async t => {
  let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error(secret); });
  for (const path of ["//evil.example/path", "https://evil.example", "\\\\evil.example/path"]) await assert.rejects(obsFetchXml(credential, session.region, path), /Invalid OBS request path/);
  assert.equal(calls, 0);
});
