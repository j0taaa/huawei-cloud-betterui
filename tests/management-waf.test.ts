import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { wafManagement } from "@/lib/huawei/management/adapters/waf";
import { session } from "./fixtures/session";
const host = { id: "host-1", hostname: "app.example.com", projectid: session.projectId, policyid: "policy-1", protect_status: 1, access_status: 1, access_code: "native-prefix", locked: 0, server: [{ front_protocol: "HTTPS", back_protocol: "HTTP", address: "8.8.8.8", port: 80, type: "ipv4" }], certificatename: "App certificate" };
const host2 = { ...host, id: "host-2", hostname: "other.example.com", policyid: "policy-2" };
const policy = { id: "policy-1", name: "Policy_One", level: 2, hosts: [host.id], bind_host: [{ id: host.id, hostname: host.hostname, waf_type: "cloud" }] };
const policy2 = { id: "policy-2", name: "Policy_Two", level: 2, hosts: [host2.id], bind_host: [{ id: host2.id, hostname: host2.hostname, waf_type: "cloud" }] };
const certificate = { id: "cert-1", name: "App certificate", exp_status: 0 };
const rule = { id: "rule-1", name: "LogExample", policyid: policy.id, addr: "8.8.8.0/24", white: 2, status: 1 };
const hostResource = { id: `host:${host.id}`, name: host.hostname, status: "1" };
const policyResource = { id: `policy:${policy.id}`, name: policy.name, status: "Available" };
const createValues = { hostname: host.hostname, policy: policy.id, frontProtocol: "HTTP", backProtocol: "HTTP", address: "8.8.8.8", port: 80, proxy: false };
function read(url: URL): Record<string, unknown> {
  const path = url.pathname;
  if (path === "/v1/project-1/waf/instance") return { items: [host, host2], total: 2 };
  if (path === "/v1/project-1/waf/instance/host-1") return host;
  if (path === "/v1/project-1/waf/policy") return { items: [policy, policy2], total: 2 };
  if (path === "/v1/project-1/waf/policy/policy-1") return policy;
  if (path === "/v1/project-1/waf/policy/policy-2") return policy2;
  if (path === "/v1/project-1/waf/certificate") return { items: [certificate], total: 1 };
  if (path === "/v1/project-1/waf/certificate/cert-1") return { ...certificate, content: readFileSync(new URL("./fixtures/waf-public-cert.pem", import.meta.url), "utf8"), key: "PROVIDER_PRIVATE_KEY" };
  if (path === "/v1/project-1/waf/policy/policy-1/whiteblackip") return { items: [rule], total: 1 };
  if (path === "/v1/project-1/waf/policy/policy-1/whiteblackip/rule-1") return rule;
  throw new Error(`Unexpected GET ${path}`);
}
function cloud(t: TestContext, custom?: (url: URL) => Record<string, unknown> | undefined) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input); if (!init.method) return Response.json(custom?.(url) ?? read(url));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    writes.push({ path: url.pathname, method: init.method, body });
    return Response.json(url.pathname.endsWith("/whiteblackip") ? { id: "new-rule", policyid: policy.id } : url.pathname.endsWith("/policy") ? { id: "new-policy" } : { id: "new-host", hostname: host.hostname });
  }); return writes;
}
test("WAF inventory separates domains and policies with canonical IDs", async t => {
  cloud(t); assert.deepEqual((await wafManagement.inventory(session)).map(item => item.id), ["host:host-1", "host:host-2", "policy:policy-1", "policy:policy-2"]);
  const options = await wafManagement.options!(session, "create"); assert.equal(options.certificates.length, 1); assert.equal(options.policies.length, 2);
});
test("WAF cloud domains use explicit pay-per-use billing, a single public origin, and pending DNS onboarding", async t => {
  const writes = cloud(t); const result = await wafManagement.execute(session, "create", createValues);
  assert.equal(result.asynchronous, true); assert.match(result.message, /DNS onboarding/); assert.equal(result.resourceId, "host:new-host");
  assert.deepEqual(writes[0], { path: "/v1/project-1/waf/instance", method: "POST", body: { hostname: host.hostname, policyid: policy.id, server: [{ front_protocol: "HTTP", back_protocol: "HTTP", address: "8.8.8.8", port: 80, type: "ipv4" }], proxy: false, exclusive_ip: false, paid_type: "postPaid" } });
});
test("WAF rejects private, shared, reserved, and invalid origin IPv4 addresses before writes", async t => {
  const writes = cloud(t);
  for (const address of ["10.1.2.3", "192.168.0.1", "172.20.1.1", "127.0.0.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "192.0.2.1", "203.0.113.1", "999.1.1.1"]) await assert.rejects(wafManagement.execute(session, "create", { ...createValues, address }), /public origin IPv4/);
  assert.equal(writes.length, 0);
});
test("WAF HTTPS validates a current owned certificate's public contents and hostname without returning private keys", async t => {
  t.mock.method(Date, "now", () => Date.parse("2027-01-01T00:00:00Z"));
  const writes = cloud(t);
  const result = await wafManagement.execute(session, "create", { ...createValues, frontProtocol: "HTTPS", certificate: "cert-1" });
  const body = writes[0].body as Record<string, unknown>; assert.equal(body.certificateid, "cert-1"); assert.equal(body.certificatename, certificate.name);
  assert.ok(!JSON.stringify(result).includes("PROVIDER_PRIVATE_KEY"));
  await assert.rejects(wafManagement.execute(session, "create", { ...createValues, hostname: "wrong.example.com", frontProtocol: "HTTPS", certificate: "cert-1" }), /cover this domain/);
  await assert.rejects(wafManagement.execute(session, "create", { ...createValues, frontProtocol: "HTTPS", certificate: "foreign" }), /current certificate/);
});
test("WAF native protection control distinguishes pause, bypass, and enabled states", async t => {
  const writes = cloud(t);
  for (const operation of ["pause", "bypass", "protect"]) await wafManagement.execute(session, operation, {}, hostResource);
  assert.deepEqual(writes.map(write => write.body), [{ protect_status: 0 }, { protect_status: -1 }, { protect_status: 1 }]); assert.ok(writes.every(write => write.path.endsWith("/protect-status") && write.method === "PUT"));
});
test("WAF locked or cross-project domains are rejected before any mutation", async t => {
  let foreign = false;
  const writes = cloud(t, url => url.pathname.endsWith("/instance/host-1") ? { ...host, locked: 1, projectid: foreign ? "other" : session.projectId } : undefined);
  await assert.rejects(wafManagement.execute(session, "delete-host", {}, hostResource), /locked/);
  foreign = true; await assert.rejects(wafManagement.execute(session, "pause", {}, hostResource), /unverified/); assert.equal(writes.length, 0);
});
test("WAF policy binding preserves verified existing cloud domains and rejects mixed dedicated bindings", async t => {
  let dedicated = false;
  const writes = cloud(t, url => url.pathname.endsWith("/policy/policy-2") && dedicated ? { ...policy2, bind_host: [{ id: "premium-1", waf_type: "premium" }] } : undefined);
  await wafManagement.execute(session, "bind-policy", { policy: "policy-2" }, hostResource);
  assert.deepEqual(writes[0], { path: "/v1/project-1/waf/policy/policy-2", method: "PATCH", body: { hosts: ["host-2", "host-1"] } });
  dedicated = true; await assert.rejects(wafManagement.execute(session, "bind-policy", { policy: "policy-2" }, hostResource), /dedicated WAF domains/);
});
test("WAF policy changes patch only metadata or sensitivity and bound policy deletion is blocked", async t => {
  const writes = cloud(t);
  await wafManagement.execute(session, "rename-policy", { name: "New_Name" }, policyResource);
  await wafManagement.execute(session, "level", { level: "3" }, policyResource);
  assert.deepEqual(writes.map(write => write.body), [{ name: "New_Name" }, { level: 3 }]);
  await assert.rejects(wafManagement.execute(session, "delete-policy", {}, policyResource), /Unbind every domain/);
});
test("WAF IP rules use native action enums, permanent scope, and current policy ownership", async t => {
  const writes = cloud(t); await wafManagement.execute(session, "create-ip-rule", { name: "IPv6Log", address: "2001:4860::/32", action: "2", description: "Observe" }, policyResource);
  assert.deepEqual(writes[0].body, { name: "IPv6Log", addr: "2001:4860::/32", white: 2, time_mode: "permanent", description: "Observe" });
  await wafManagement.execute(session, "ip-rule-status", { rule: "rule-1", enabled: false }, policyResource);
  assert.deepEqual(writes[1].body, { status: 0 }); assert.ok(writes[1].path.endsWith("/whiteblackip/rule-1/status"));
  await wafManagement.execute(session, "delete-ip-rule", { rule: "rule-1" }, policyResource); assert.equal(writes[2].method, "DELETE");
  await assert.rejects(wafManagement.execute(session, "create-ip-rule", { name: "Bad", address: "8.8.8.8/33", action: "0" }, policyResource), /valid IPv4\/IPv6/);
});
test("WAF refuses cross-policy IP rule details and provider-filter violations", async t => {
  let badDetail = false;
  const writes = cloud(t, url => url.pathname.endsWith("/whiteblackip") && !badDetail ? { items: [{ ...rule, policyid: "other-policy" }], total: 1 } : url.pathname.endsWith("/whiteblackip/rule-1") ? { ...rule, policyid: "other-policy" } : undefined);
  await assert.rejects(wafManagement.execute(session, "delete-ip-rule", { rule: "rule-1" }, policyResource), /no longer belongs/);
  badDetail = true; await assert.rejects(wafManagement.execute(session, "ip-rule-status", { rule: "rule-1", enabled: true }, policyResource), /different policy/);
  assert.equal(writes.length, 0);
});
test("WAF inspection omits provider objects and reports actual access/protection states", async t => {
  cloud(t); const result = await wafManagement.execute(session, "inspect-host", {}, hostResource);
  assert.ok(result.facts?.some(fact => fact.label === "Traffic access" && fact.value === "Accessible")); assert.ok(result.facts?.some(fact => fact.label === "Protection" && fact.value === "Enabled")); assert.ok(!JSON.stringify(result).includes("PROVIDER_PRIVATE_KEY"));
});

test("WAF policy deletion checks domain references independently of empty binding reports", async t => {
  let incomplete = false;
  const writes = cloud(t, url => url.pathname.endsWith("/policy/policy-1") ? { ...policy, hosts: [], bind_host: incomplete ? undefined : [] } : undefined);
  await assert.rejects(wafManagement.execute(session, "delete-policy", {}, policyResource), /Unbind every domain/);
  incomplete = true;
  await assert.rejects(wafManagement.execute(session, "delete-policy", {}, policyResource), /binding lists could not be verified/);
  assert.equal(writes.length, 0);
});

test("WAF policy binding rejects a stale existing destination domain without replacing any bindings", async t => {
  const writes = cloud(t, url => url.pathname.endsWith("/policy/policy-2") ? { ...policy2, hosts: ["missing-host"], bind_host: [] } : undefined);
  await assert.rejects(wafManagement.execute(session, "bind-policy", { policy: "policy-2" }, hostResource), /Every existing policy binding/);
  assert.equal(writes.length, 0);
});
