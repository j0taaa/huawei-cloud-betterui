import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManagementOperation } from "@/lib/huawei/management";
import { obsAuthorization } from "@/lib/huawei/services/obs";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-obs-management-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const credential = { access: "test-access", secret: "test-secret", securityToken: "test-security-token" };
const body = (operation: string, values = {}, resourceId = "example-bucket") => ({ requestId: randomUUID(), operation, resourceId, projectId: session.projectId, confirmName: resourceId, acknowledgedImpact: true, values });
const bucketList = `<ListAllMyBucketsResult><Buckets><Bucket><Name>example-bucket</Name><Location>${session.region}</Location></Bucket><Bucket><Name>foreign-bucket</Name><Location>eu-west-101</Location></Bucket></Buckets></ListAllMyBucketsResult>`;
test("OBS configuration signing includes all x-obs headers and the exact subresource", () => {
  const date = "Wed, 01 Jul 2015 02:25:05 GMT";
  const signed = obsAuthorization({ bucket: "example-bucket", method: "PUT", credential, date, contentType: "application/xml", subresource: "acl", requestHeaders: { "x-obs-storage-class": "STANDARD", "X-OBS-ACL": "private", "Content-Type": "application/xml" } });
  const canonical = `PUT\n\napplication/xml\n${date}\nx-obs-acl:private\nx-obs-security-token:test-security-token\nx-obs-storage-class:STANDARD\n/example-bucket/?acl`;
  assert.equal(signed, `OBS test-access:${createHmac("sha1", credential.secret).update(canonical).digest("base64")}`);
});
test("OBS creation stays private, uses the selected region, and accepts an empty success body", async (t) => {
  const writes: { url: URL; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (new URL(input).pathname.endsWith("securitytokens")) return Response.json({ credential: { access: credential.access, secret: credential.secret, securitytoken: credential.securityToken } }); writes.push({ url: new URL(input), init }); return new Response(null, { status: 200 }); });
  const result = await runManagementOperation(session, "obs", body("create", { name: "new-example-bucket", class: "STANDARD" }));
  assert.equal(result.resourceId, "new-example-bucket"); assert.equal(writes.length, 1);
  assert.equal(writes[0].url.hostname, `new-example-bucket.obs.${session.region}.myhuaweicloud.com`);
  assert.equal(new Headers(writes[0].init.headers).get("x-obs-acl"), "private");
  assert.match(String(writes[0].init.body), new RegExp(`<Location>${session.region}</Location>`));
});
test("OBS refuses unsupported names, foreign-region buckets and cross-bucket policies before mutation", async (t) => {
  const writes: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (new URL(input).pathname.endsWith("securitytokens")) return Response.json({ credential: { access: credential.access, secret: credential.secret, securitytoken: credential.securityToken } });
    if (init.method === "PUT") { writes.push(init.body); return new Response(null, { status: 200 }); }
    return new Response(bucketList);
  });
  for (const name of ["127.0.0.1", "invalid..bucket", "invalid.-bucket"]) await assert.rejects(runManagementOperation(session, "obs", body("create", { name, class: "STANDARD" })), /cannot be IP/);
  await assert.rejects(runManagementOperation(session, "obs", body("versioning", { status: "Enabled" }, "foreign-bucket")), /not found in the selected project/);
  await assert.rejects(runManagementOperation(session, "obs", body("policy", { policy: JSON.stringify({ Statement: [{ Effect: "Allow", Resource: "another-bucket/*", Principal: "*", Action: ["GetObject"] }] }) })), /Every policy resource/);
  assert.equal(writes.length, 0);
});
test("OBS lifecycle XML escapes literal prefixes and policies/CORS validate typed inputs", async (t) => {
  const writes: { query: string; body: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith("securitytokens")) return Response.json({ credential: { access: credential.access, secret: credential.secret, securitytoken: credential.securityToken } });
    if (init.method === "PUT") { writes.push({ query: url.search, body: init.body }); return new Response(null, { status: 200 }); }
    return new Response(bucketList);
  });
  await runManagementOperation(session, "obs", body("lifecycle", { prefix: "logs/<test>&", days: 30 }));
  assert.equal(writes[0].query, "?lifecycle"); assert.match(String(writes[0].body), /<Prefix>logs\/&lt;test&gt;&amp;<\/Prefix>/);
  await assert.rejects(runManagementOperation(session, "obs", body("cors", { origins: ["https://example.com/path"], methods: ["GET"], maxAge: 300 })), /without credentials/);
  assert.equal(writes.length, 1);
  await runManagementOperation(session, "obs", body("cors", { origins: ["https://example.com"], methods: ["GET"], maxAge: 300 }));
  assert.equal(writes[1].query, "?cors"); assert.match(String(writes[1].body), /<AllowedMethod>GET<\/AllowedMethod>/);
});
