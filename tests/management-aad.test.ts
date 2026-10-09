import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { aadManagement } from "@/lib/huawei/management/adapters/aad";
import { ManagementInputError, validateManagementValues, type ManagementValues } from "@/lib/management-contract";
import { HuaweiApiError } from "@/lib/huawei/http";
import type { BetterUiSession } from "@/lib/auth-session";
import { session } from "./fixtures/session";

const accountToken = "account-token";
const accountDomainId = "domain-1";
// A fresh session object per test mirrors the per-request session; the account-domain proof cache is keyed by it.
const accountSession = (): BetterUiSession => ({ ...session, accountToken });
// IAM GET /v3/auth/tokens proof of the account token: token.domain.id identifies the account and no project scope is present.
const iamToken = { token: { domain: { id: accountDomainId, name: "test-account" }, user: { id: "user-1", name: "test-user", domain: { id: accountDomainId } }, methods: ["iam"] } };

const basePackage = { package_id: "pkg-1", package_name: "Advanced One", region_id: "sa-brazil-1", protection_type: 1, instance_type: "cnad", ip_num: 10, ip_num_now: 2, protection_num: 10, protection_num_now: 2, basic_bandwidth: 100, elastic_bandwidth: 50, service_bandwidth: 100, clean_bandwidth: 10, policy_num: 5, create_time: 1767225600 };
const basePolicy = { id: "policy-1", package_id: "pkg-1", package_name: "Advanced One", name: "Web Front", description: "Front doors", region: "sa-brazil-1", clean_threshold: 100, num_protected_ip: 1 };
const baseProtectedIps = [
  { id: "pip-1", ip: "100.64.1.10", type: "EIP", name: "Front EIP", status: 0, status_detail: { block_time: 1767139200, unblock_time: 1767225600 }, policy_name: "Web Front", region: "sa-brazil-1", package_id: "pkg-1", package_name: "Advanced One", tag: "front" },
  { id: "pip-2", ip: "100.64.1.11", type: "EIP", name: "", status: 0, status_detail: {}, policy_name: "", region: "sa-brazil-1", package_id: "pkg-1", package_name: "Advanced One", tag: "" },
  { id: "pip-3", ip: "100.64.9.9", type: "EIP", name: "Other", status: 1, status_detail: {}, policy_name: "Other Policy", region: "sa-brazil-1", package_id: "pkg-2", package_name: "Other Package", tag: "" },
];
const baseInstance = { instance_id: "aad-1", instance_name: "High Defense", ips: [{ ip_id: "ipid-1", ip: "1.2.3.4", basic_bandwidth: 100, elastic_bandwidth: 50, ip_status: 0 }, { ip_id: "ipid-2", ip: "5.6.7.8", basic_bandwidth: 100, elastic_bandwidth: 50, ip_status: 1 }], expire_time: 1798761600, service_bandwidth: 500, instance_status: 0, enterprise_project_id: "0" };
const foreignInstance = { instance_id: "aad-2", instance_name: "Other Project", ips: [{ ip_id: "ipid-3", ip: "9.9.9.8", basic_bandwidth: 100, elastic_bandwidth: 0, ip_status: 0 }], expire_time: 1798761600, service_bandwidth: 500, instance_status: 0, enterprise_project_id: "1" };
const baseDomain = { domain_id: "dom-1", domain_name: "example.com", cname: "example.com.cname.aad.huaweicloud.com", protocol: ["HTTP", "HTTPS"], real_server_type: 0, real_servers: "9.9.9.9", waf_status: 1, enterprise_project_id: "0" };
const baseRules = [{ rule_id: "rule-1", forward_protocol: "tcp", forward_port: 443, source_port: 8443, lb_method: "lc", source_ip: "9.9.9.9", status: 0 }];

type Store = { packages: Record<string, unknown>[]; policies: Record<string, unknown>[]; protectedIps: Record<string, unknown>[]; instances: Record<string, unknown>[]; domains: Record<string, unknown>[]; rulesByIp: Record<string, Record<string, unknown>[]>; black: string[]; white: string[]; instanceBlack: string[]; instanceWhite: string[] };

function store(): Store {
  return {
    packages: [structuredClone(basePackage)],
    policies: [structuredClone(basePolicy)],
    protectedIps: structuredClone(baseProtectedIps),
    instances: [structuredClone(baseInstance), structuredClone(foreignInstance)],
    domains: [structuredClone(baseDomain)],
    rulesByIp: { "1.2.3.4": structuredClone(baseRules), "5.6.7.8": [] },
    black: ["203.0.113.9"],
    white: ["198.51.100.7"],
    instanceBlack: ["203.0.113.20"],
    instanceWhite: ["198.51.100.20"],
  };
}

function read(url: URL, data: Store): Record<string, unknown> {
  const path = url.pathname;
  if (path === "/v1/cnad/packages") return { total: data.packages.length, items: data.packages };
  if (path === "/v1/cnad/policies") return { total: data.policies.length, items: data.policies };
  if (path === "/v1/cnad/policies/policy-1") return { id: "policy-1", package_id: "pkg-1", name: data.policies[0]?.name ?? "Web Front", clean_threshold: data.policies[0]?.clean_threshold ?? 100, pop_policy: { block_location: ["cn-north-4"], block_protocol: ["udp"], bw_list: { black_ip_list: [...data.black], white_ip_list: [...data.white] }, connection_protection: false, fingerprint_count: 1, port_block_count: 2, watermark_count: 0, if_exist_traffic: false, pop: "cn-north-4" } };
  if (path === "/v1/cnad/protected-ips") {
    const packageId = url.searchParams.get("package_id");
    const items = packageId ? data.protectedIps.filter(row => row.package_id === packageId) : data.protectedIps;
    return { total: items.length, items };
  }
  if (path === "/v1/cnad/packages/pkg-1/unbound-protected-ips") {
    const ips = data.protectedIps.filter(row => row.package_id === "pkg-1" && !row.policy_name);
    return { total: ips.length, ips };
  }
  if (path === "/v1/aad/instances") return { count: data.instances.length, items: data.instances };
  if (path === "/v1/aad/protected-domains") return { count: data.domains.length, items: data.domains };
  if (path === "/v2/aad/policies/ddos/blackwhite-list") {
    const type = url.searchParams.get("type");
    const instanceId = url.searchParams.get("instance_id");
    const ips = instanceId === "aad-1" ? (type === "black" ? data.instanceBlack : data.instanceWhite) : [];
    return { total: ips.length, ips: ips.map(ip => ({ ip, desc: "internal note" })) };
  }
  const rulesMatch = path.match(/^\/v1\/aad\/instances\/([^/]+)\/([^/]+)\/rules$/);
  if (rulesMatch) {
    const rules = data.rulesByIp[decodeURIComponent(rulesMatch[2])] ?? [];
    return { total: rules.length, rules };
  }
  throw new Error(`Unexpected AAD read ${path}`);
}

function applyWrite(path: string, method: string, body: Record<string, unknown>, data: Store) {
  if (path === "/v1/cnad/policies" && method === "POST") data.policies.push({ id: "policy-new", package_id: body.package_id, package_name: "Advanced One", name: body.name, description: body.description ?? "", region: "sa-brazil-1", clean_threshold: 100, num_protected_ip: 0 });
  if (path === "/v1/cnad/packages/pkg-1/name") data.packages[0].package_name = body.name;
  if (path === "/v1/cnad/policies/policy-1" && method === "PUT") {
    const policy = data.policies.find(row => row.id === "policy-1");
    if (policy) { policy.name = body.name; policy.clean_threshold = body.threshold; if (body.description !== undefined) policy.description = body.description; }
  }
  if (path === "/v1/cnad/protected-ips/tags") { const row = data.protectedIps.find(item => item.id === body.id); if (row) row.tag = body.tag; }
  if (path === "/v1/cnad/policies/policy-1/bind") for (const id of body.id_list as string[]) { const row = data.protectedIps.find(item => item.id === id); if (row) row.policy_name = "Web Front"; }
  if (path === "/v1/cnad/policies/policy-1/unbind") for (const id of body.id_list as string[]) { const row = data.protectedIps.find(item => item.id === id); if (row) row.policy_name = ""; }
  if (path === "/v1/cnad/policies/policy-1/ip-list/add") (body.type === "black" ? data.black : data.white).push(...(body.ip_list as string[]));
  if (path === "/v1/cnad/policies/policy-1/ip-list/delete") {
    if (body.type === "black") data.black = data.black.filter(ip => !(body.ip_list as string[]).includes(ip));
    else data.white = data.white.filter(ip => !(body.ip_list as string[]).includes(ip));
  }
  if (path === "/v1/aad/instances/aad-1/1.2.3.4/rules/batch-create") {
    const rule = (body.rules as Record<string, unknown>[])[0];
    data.rulesByIp["1.2.3.4"].push({ rule_id: "rule-new", forward_protocol: rule.forward_protocol, forward_port: rule.forward_port, source_port: rule.source_port, lb_method: "lc", source_ip: rule.source_ip, status: 0 });
  }
  if (path === "/v1/aad/instances/aad-1/1.2.3.4/rules/batch-delete") data.rulesByIp["1.2.3.4"] = data.rulesByIp["1.2.3.4"].filter(rule => !(body.ids as string[]).includes(String(rule.rule_id)));
  if (path === "/v1/aad/instances/aad-1/1.2.3.4/rules/rule-1" && method === "PUT") { const rule = data.rulesByIp["1.2.3.4"].find(item => item.rule_id === "rule-1"); if (rule) Object.assign(rule, body); }
  if (path === "/v1/aad/protected-domains/dom-1" && method === "PUT") { const domain = data.domains.find(item => item.domain_id === "dom-1"); if (domain) { domain.real_server_type = body.real_server_type; domain.real_servers = body.real_servers; } }
  if (path === "/v2/aad/domains" && method === "DELETE") data.domains = data.domains.filter(domain => !(body.domain_id as string[]).includes(String(domain.domain_id)));
  if (path === "/v1/project-1/aad/external/domains" && method === "POST") data.domains.push({ domain_id: "dom-new", domain_name: body.domain_name, cname: "shop.example.com.cname.aad.huaweicloud.com", protocol: [], real_server_type: body.real_server_type, real_servers: body.real_server, waf_status: 1, enterprise_project_id: body.enterprise_project_id });
  if (path === "/v1/project-1/aad/external/domains/switch") { const domain = data.domains.find(item => item.domain_id === body.domain_id); if (domain) domain.waf_status = body.waf_switch; }
  if (path === "/v1/project-1/aad/external/bwlist" && method === "POST") {
    const list = body.type === "black" ? data.instanceBlack : data.instanceWhite;
    for (const ip of body.ips as string[]) if (!list.includes(ip)) list.push(ip);
  }
  if (path === "/v1/project-1/aad/external/bwlist" && method === "DELETE") {
    if (body.type === "black") data.instanceBlack = data.instanceBlack.filter(ip => !(body.ips as string[]).includes(ip));
    else data.instanceWhite = data.instanceWhite.filter(ip => !(body.ips as string[]).includes(ip));
  }
}

function writeResult(path: string): Record<string, unknown> {
  if (path === "/v1/cnad/policies") return { id: "policy-new", name: "Fresh Policy", package_id: "pkg-1", description: "", clean_threshold: 100 };
  if (path === "/v1/project-1/aad/external/domains") return { cname: "shop.example.com.cname.aad.huaweicloud.com", domainId: "dom-new" };
  if (path.endsWith("/rules/batch-create") || path.endsWith("/rules/batch-delete")) return { success_num: 1 };
  return {};
}

type MockOptions = {
  data?: Store;
  read?: (url: URL, data: Store) => unknown;
  write?: (path: string, body: Record<string, unknown>) => Record<string, unknown> | Response | undefined;
  iam?: () => Record<string, unknown> | Response;
};

function mockCloud(t: TestContext, options: MockOptions = {}) {
  const data = options.data ?? store();
  const s = accountSession();
  const writes: { path: string; method: string; body?: unknown }[] = [];
  let calls = 0;
  let iamCalls = 0;
  let aadCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    calls += 1;
    const url = new URL(input);
    if (url.origin === session.iamEndpoint) {
      iamCalls += 1;
      assert.equal(url.pathname, "/v3/auth/tokens");
      assert.equal(new Headers(init.headers).get("X-Subject-Token"), accountToken);
      assert.equal(new Headers(init.headers).get("X-Auth-Token"), accountToken);
      const own = options.iam?.();
      return own instanceof Response ? own : Response.json(own ?? iamToken);
    }
    // CNAD paths authenticate with the global account token; every other AAD path uses the project token.
    aadCalls += 1;
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), url.pathname.startsWith("/v1/cnad") ? accountToken : session.token);
    if (!init.method) {
      const own = options.read?.(url, data);
      return Response.json(own !== undefined ? own : read(url, data));
    }
    const body = (init.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
    writes.push({ path: url.pathname, method: init.method, ...(init.body ? { body } : {}) });
    const own = options.write?.(url.pathname, body);
    if (own instanceof Response) return own;
    applyWrite(url.pathname, init.method, body, data);
    return Response.json(own ?? writeResult(url.pathname));
  });
  return { writes, data, s, calls: () => calls, iamCalls: () => iamCalls, aadCalls: () => aadCalls };
}

// Raw responder mocks for cases that bypass the read/write split; the IAM proof is still routed.
function mockAad(t: TestContext, respond: (url: URL) => Record<string, unknown> | Response, iam?: () => Record<string, unknown> | Response) {
  const s = accountSession();
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.origin === session.iamEndpoint) {
      const own = iam?.();
      return own instanceof Response ? own : Response.json(own ?? iamToken);
    }
    const own = respond(url);
    return own instanceof Response ? own : Response.json(own);
  });
  return s;
}

const packageResource = { id: "package:pkg-1", name: "Advanced One" };
const policyResource = { id: "policy:policy-1", name: "Web Front" };
const protectedIpResource = { id: "protected-ip:pip-1", name: "Front EIP" };
const instanceResource = { id: "instance:aad-1", name: "High Defense" };
const domainResource = { id: "domain:dom-1", name: "example.com" };
const fullSettings = { name: "Web Front", description: "Edges", threshold: 200, udp: "limiting", udpTrafficLimiting: 1000, udpFragmentRateLimiting: 100, tcp: "limiting", tcpTrafficLimiting: 5, tcpFragmentRateLimiting: 50, icmp: "unblock", other: "block" };

test("inventory maps the five native AAD resource kinds without fabricated statuses", async t => {
  const cloud = mockCloud(t);
  const resources = await aadManagement.inventory(cloud.s);
  assert.deepEqual(resources.map(resource => resource.id), ["package:pkg-1", "policy:policy-1", "protected-ip:pip-1", "protected-ip:pip-2", "protected-ip:pip-3", "instance:aad-1", "instance:aad-2", "domain:dom-1"]);
  assert.ok(resources.every(resource => resource.status === undefined));
  assert.deepEqual(resources.find(resource => resource.id === "policy:policy-1")!.values, { packageId: "pkg-1", packageName: "Advanced One" });
  assert.equal(resources.find(resource => resource.id === "protected-ip:pip-2")!.name, "100.64.1.11");
  assert.deepEqual(resources.find(resource => resource.id === "protected-ip:pip-1")!.values, { ip: "100.64.1.10", packageId: "pkg-1", policyName: "Web Front", tag: "front" });
});

test("CNAD management authenticates with the account token through a single IAM account-domain proof", async t => {
  const cloud = mockCloud(t);
  assert.equal(aadManagement.accountWide, undefined);
  await aadManagement.inventory(cloud.s);
  assert.equal(cloud.iamCalls(), 1);
  await aadManagement.execute(cloud.s, "rename-package", { name: "Renamed Package" }, packageResource);
  assert.deepEqual(cloud.writes[0], { path: "/v1/cnad/packages/pkg-1/name", method: "PUT", body: { name: "Renamed Package" } });
  assert.equal(cloud.iamCalls(), 1);
});

test("the account-domain proof is cached per session object only", async t => {
  const cloud = mockCloud(t);
  await aadManagement.inventory(cloud.s);
  await aadManagement.inventory(cloud.s);
  assert.equal(cloud.iamCalls(), 1);
  await aadManagement.inventory(accountSession());
  assert.equal(cloud.iamCalls(), 2);
});

test("CNAD management is rejected before any request when the session has no account token", async t => {
  const cloud = mockCloud(t);
  await assert.rejects(aadManagement.inventory(session), (error: unknown) => error instanceof ManagementInputError && (error as ManagementInputError).status === 409 && /account token/.test(error.message));
  // The IAM proof is never requested and no CNAD endpoint is reached; only the project-token AAD reads ran.
  assert.equal(cloud.iamCalls(), 0);
  assert.equal(cloud.aadCalls(), 2);
});

test("a project-scoped IAM token never authorizes CNAD requests", async t => {
  const cloud = mockCloud(t, { iam: () => ({ token: { domain: { id: accountDomainId }, project: { id: "project-1" } } }) });
  await assert.rejects(aadManagement.inventory(cloud.s), /project-scoped/);
  assert.equal(cloud.iamCalls(), 1);
  assert.equal(cloud.aadCalls(), 2);
});

test("AAD endpoints authenticate with the project token and need no account proof", async t => {
  const cloud = mockCloud(t);
  const outcome = await aadManagement.execute(session, "inspect-instance", {}, instanceResource);
  assert.ok(outcome.facts!.some(fact => fact.label === "Instance" && fact.value === "High Defense"));
  assert.equal(cloud.iamCalls(), 0);
  await assert.rejects(aadManagement.inventory(session), /account token/);
});

test("IAM proof failures are sanitized with the HTTP status preserved", async t => {
  const rejected = mockCloud(t, { iam: () => new Response(JSON.stringify({ error_msg: "SECRET-IAM-DETAIL" }), { status: 404 }) });
  await assert.rejects(aadManagement.inventory(rejected.s), (error: unknown) => {
    assert.ok(error instanceof HuaweiApiError);
    assert.equal((error as HuaweiApiError).status, 404);
    assert.match((error as Error).message, /IAM domain/);
    assert.ok(!/SECRET-IAM-DETAIL/.test((error as Error).message));
    return true;
  });
  const broken = mockCloud(t, { iam: () => { throw new TypeError("connect ECONNREFUSED SECRET-IAM-HOST"); } });
  await assert.rejects(aadManagement.inventory(broken.s), (error: unknown) => {
    assert.ok(error instanceof ManagementInputError);
    assert.equal((error as ManagementInputError).status, 409);
    assert.match((error as Error).message, /Sign in again/);
    assert.ok(!/ECONNREFUSED|SECRET-IAM-HOST/.test((error as Error).message));
    return true;
  });
});

test("CNAD responses echoing the authenticated account domain pass; any other echo blocks", async t => {
  const withDomain = mockCloud(t, { read: url => url.pathname === "/v1/cnad/packages" ? { total: 1, items: [structuredClone(basePackage)], domain_id: accountDomainId } : undefined });
  const resources = await aadManagement.inventory(withDomain.s);
  assert.equal(resources.filter(resource => resource.id.startsWith("package:")).length, 1);
  for (const echo of ["other-domain", "", null]) {
    const cloud = mockCloud(t, { read: url => url.pathname === "/v1/cnad/packages" ? { total: 1, items: [structuredClone(basePackage)], domain_id: echo } : undefined });
    await assert.rejects(aadManagement.inventory(cloud.s), /different account/);
  }
  const rowEcho = mockCloud(t, { read: url => url.pathname === "/v1/cnad/packages" ? { total: 1, items: [{ ...structuredClone(basePackage), domainId: "other-domain" }] } : undefined });
  await assert.rejects(aadManagement.inventory(rowEcho.s), /different account/);
  const dataEcho = mockCloud(t, { read: url => url.pathname === "/v1/cnad/policies" ? { total: 1, items: [structuredClone(basePolicy)], data: { domain_id: "other-domain" } } : undefined });
  await assert.rejects(aadManagement.inventory(dataEcho.s), /different account/);
});

test("CNAD rows carrying foreign project IDs remain managed under the global account token", async t => {
  const data = store();
  data.protectedIps.push({ ...structuredClone(baseProtectedIps[0]), id: "pip-9", ip: "100.64.1.99", project_id: "other-project" });
  const cloud = mockCloud(t, { data });
  const resources = await aadManagement.inventory(cloud.s);
  assert.ok(resources.some(resource => resource.id === "protected-ip:pip-9"));
  const outcome = await aadManagement.execute(cloud.s, "tag-protected-ip", { tag: "kept" }, { id: "protected-ip:pip-9", name: "Front EIP" });
  assert.equal(outcome.message, "Protected IP tag updated.");
});

test("AAD responses echoing a foreign or unusable project scope block instead of filtering", async t => {
  for (const echo of ["other-project", "", null]) {
    const data = store();
    data.domains.push({ ...structuredClone(baseDomain), domain_id: "dom-9", domain_name: "foreign.example.com", projectId: echo });
    const s = mockAad(t, url => read(url, data));
    await assert.rejects(aadManagement.inventory(s), /different project/);
  }
  const data = store();
  data.instances.push({ ...structuredClone(baseInstance), instance_id: "aad-9", instance_name: "Scoped", ips: [], project_id: "other-project" });
  const s = mockAad(t, url => read(url, data));
  await assert.rejects(aadManagement.inventory(s), /different project/);
  const scoped = store();
  scoped.domains[0].project_id = "project-1";
  const ok = mockAad(t, url => read(url, scoped));
  assert.ok((await aadManagement.inventory(ok)).some(resource => resource.id === "domain:dom-1"));
});

test("create-policy verifies the live package and returns the native policy identity", async t => {
  const cloud = mockCloud(t);
  await assert.rejects(aadManagement.execute(cloud.s, "create-policy", { name: "Fresh Policy", package: "forged" }), /current Anti-DDoS package/);
  assert.equal(cloud.writes.length, 0);
  const outcome = await aadManagement.execute(cloud.s, "create-policy", { name: "Fresh Policy", package: "pkg-1", description: "Edges" });
  assert.deepEqual(cloud.writes, [{ path: "/v1/cnad/policies", method: "POST", body: { name: "Fresh Policy", package_id: "pkg-1", description: "Edges" } }]);
  assert.equal(outcome.resourceId, "policy:policy-new");
});

test("create-policy requires an object response with a consistent optional parent package", async t => {
  const cloud = mockCloud(t, { write: () => ({ id: "policy-x" }) });
  const withoutParent = await aadManagement.execute(cloud.s, "create-policy", { name: "Fresh Policy", package: "pkg-1" });
  assert.equal(withoutParent.resourceId, "policy:policy-x");
  const wrongParent = mockCloud(t, { write: () => ({ id: "policy-y", package_id: "pkg-9" }) });
  await assert.rejects(aadManagement.execute(wrongParent.s, "create-policy", { name: "Fresh Policy", package: "pkg-1" }), /different resource/);
  assert.equal(wrongParent.writes.length, 1);
  const notObject = mockCloud(t, { write: () => new Response(JSON.stringify(["not", "an", "object"]), { status: 200 }) });
  await assert.rejects(aadManagement.execute(notObject.s, "create-policy", { name: "Fresh Policy", package: "pkg-1" }), /invalid Anti-DDoS response/);
  assert.equal(notObject.writes.length, 1);
});

test("policy settings replace the complete explicit protection configuration", async t => {
  const cloud = mockCloud(t);
  const outcome = await aadManagement.execute(cloud.s, "policy-settings", fullSettings, policyResource);
  assert.deepEqual(cloud.writes, [{ path: "/v1/cnad/policies/policy-1", method: "PUT", body: { name: "Web Front", description: "Edges", threshold: 200, udp: "limiting", tcp: "limiting", icmp: "unblock", other: "block", udp_traffic_limiting: 1000, udp_fragment_rate_limiting: 100, tcp_traffic_limiting: 5, tcp_fragment_rate_limiting: 50 } }]);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, undefined);
  assert.match(outcome.message, /cannot be read back/);
  const stale = mockCloud(t, { read: url => url.pathname === "/v1/cnad/policies/policy-1" ? { id: "policy-1", package_id: "pkg-1", name: "Web Front", clean_threshold: 100 } : undefined });
  await assert.rejects(aadManagement.execute(stale.s, "policy-settings", fullSettings, policyResource), /could not be verified/);
  assert.equal(stale.writes.length, 1);
});

test("rate limits are required positive integers exactly when a protocol is rate-limited", async t => {
  const cloud = mockCloud(t);
  const base = { name: "Web Front", threshold: 200, udp: "limiting", udpTrafficLimiting: 1000, udpFragmentRateLimiting: 100, tcp: "block", icmp: "block", other: "block" };
  const missingFragment: ManagementValues = { name: "Web Front", threshold: 200, udp: "limiting", udpTrafficLimiting: 1000, tcp: "block", icmp: "block", other: "block" };
  await assert.rejects(aadManagement.execute(cloud.s, "policy-settings", missingFragment, policyResource), /UDP fragment rate limit/);
  await assert.rejects(aadManagement.execute(cloud.s, "policy-settings", { ...base, udpTrafficLimiting: 0 }, policyResource), /positive whole number/);
  await assert.rejects(aadManagement.execute(cloud.s, "policy-settings", { ...base, udpTrafficLimiting: 1.5 }, policyResource), /positive whole number/);
  await assert.rejects(aadManagement.execute(cloud.s, "policy-settings", { ...base, tcpTrafficLimiting: 10 }, policyResource), /requires TCP handling/);
  assert.equal(cloud.writes.length, 0);
});

test("policy blackwhite changes validate addresses and verify against the live list", async t => {
  const cloud = mockCloud(t);
  await assert.rejects(aadManagement.execute(cloud.s, "policy-blackwhite-add", { type: "black", ips: "not-an-ip" }, policyResource), /valid IPv4 or IPv6/);
  await assert.rejects(aadManagement.execute(cloud.s, "policy-blackwhite-add", { type: "black", ips: "" }, policyResource), /at least one/);
  await assert.rejects(aadManagement.execute(cloud.s, "policy-blackwhite-add", { type: "grey", ips: "203.0.113.10" }, policyResource), /blacklist or whitelist/);
  assert.equal(cloud.writes.length, 0);
  await aadManagement.execute(cloud.s, "policy-blackwhite-add", { type: "black", ips: "203.0.113.10, 203.0.113.11" }, policyResource);
  assert.deepEqual(cloud.writes[0], { path: "/v1/cnad/policies/policy-1/ip-list/add", method: "POST", body: { type: "black", ip_list: ["203.0.113.10", "203.0.113.11"] } });
  assert.deepEqual(cloud.data.black, ["203.0.113.9", "203.0.113.10", "203.0.113.11"]);
  await aadManagement.execute(cloud.s, "policy-blackwhite-delete", { type: "black", ips: "203.0.113.9" }, policyResource);
  assert.deepEqual(cloud.writes[1], { path: "/v1/cnad/policies/policy-1/ip-list/delete", method: "POST", body: { type: "black", ip_list: ["203.0.113.9"] } });
  assert.deepEqual(cloud.data.black, ["203.0.113.10", "203.0.113.11"]);
  const lists = await aadManagement.execute(cloud.s, "policy-blackwhite", {}, policyResource);
  assert.ok(lists.facts!.some(fact => fact.label === "203.0.113.10" && fact.value === "Blacklisted"));
  assert.ok(lists.facts!.some(fact => fact.label === "198.51.100.7" && fact.value === "Whitelisted"));
});

test("unverifiable or unreadable blackwhite changes never report fake success", async t => {
  const unverifiable = mockCloud(t, { read: url => url.pathname === "/v1/cnad/policies/policy-1" ? { id: "policy-1", package_id: "pkg-1", name: "Web Front", clean_threshold: 100, pop_policy: { bw_list: { black_ip_list: [], white_ip_list: [] } } } : undefined });
  await assert.rejects(aadManagement.execute(unverifiable.s, "policy-blackwhite-add", { type: "black", ips: "203.0.113.10" }, policyResource), (error: Error) => !(error instanceof ManagementInputError) && /could not be verified/.test(error.message));
  assert.equal(unverifiable.writes.length, 1);
  const unreadable = mockCloud(t, { read: url => url.pathname === "/v1/cnad/policies/policy-1" ? { id: "policy-1", package_id: "pkg-1", name: "Web Front", clean_threshold: 100 } : undefined });
  const outcome = await aadManagement.execute(unreadable.s, "policy-blackwhite-add", { type: "white", ips: "198.51.100.8" }, policyResource);
  assert.equal(unreadable.writes.length, 1);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, undefined);
  assert.match(outcome.message, /did not return/);
});

test("black/white readbacks require real native arrays with valid IP entries", async t => {
  const invalid = mockCloud(t, { read: url => url.pathname === "/v1/cnad/policies/policy-1" ? { id: "policy-1", package_id: "pkg-1", name: "Web Front", clean_threshold: 100, pop_policy: { bw_list: { black_ip_list: ["not-an-ip"], white_ip_list: [] } } } : undefined });
  await assert.rejects(aadManagement.execute(invalid.s, "policy-blackwhite", {}, policyResource), /invalid entry/);
  const missingArrays = mockCloud(t, { read: url => url.pathname === "/v1/cnad/policies/policy-1" ? { id: "policy-1", package_id: "pkg-1", name: "Web Front", clean_threshold: 100, pop_policy: { bw_list: {} } } : undefined });
  const outcome = await aadManagement.execute(missingArrays.s, "policy-blackwhite-add", { type: "black", ips: "203.0.113.10" }, policyResource);
  assert.equal(outcome.asynchronous, true);
  assert.match(outcome.message, /did not return/);
  assert.equal(missingArrays.writes.length, 1);
});

test("binding uses exact protected-IP IDs on the policy's package and verifies the result", async t => {
  const cloud = mockCloud(t);
  assert.deepEqual((await aadManagement.options!(cloud.s, "bind-ips", policyResource)).bindableIps.map(choice => choice.value), ["pip-2"]);
  await assert.rejects(aadManagement.execute(cloud.s, "bind-ips", { ips: ["pip-3"] }, policyResource), /policy's package/);
  await assert.rejects(aadManagement.execute(cloud.s, "bind-ips", { ips: ["pip-1"] }, policyResource), /Unbind/);
  await assert.rejects(aadManagement.execute(cloud.s, "bind-ips", { ips: [] }, policyResource), /at least one protected IP/);
  assert.equal(cloud.writes.length, 0);
  await aadManagement.execute(cloud.s, "bind-ips", { ips: ["pip-2"] }, policyResource);
  assert.deepEqual(cloud.writes, [{ path: "/v1/cnad/policies/policy-1/bind", method: "POST", body: { package_id: "pkg-1", id_list: ["pip-2"] } }]);
  assert.equal(cloud.data.protectedIps.find(row => row.id === "pip-2")!.policy_name, "Web Front");
  assert.deepEqual((await aadManagement.options!(cloud.s, "unbind-ips", policyResource)).boundIps.map(choice => choice.value), ["pip-1", "pip-2"]);
  await aadManagement.execute(cloud.s, "unbind-ips", { ips: ["pip-1"] }, policyResource);
  assert.deepEqual(cloud.writes[1], { path: "/v1/cnad/policies/policy-1/unbind", method: "POST", body: { package_id: "pkg-1", id_list: ["pip-1"] } });
  assert.equal(cloud.data.protectedIps.find(row => row.id === "pip-1")!.policy_name, "");
});

test("bind and unbind require a known, unique policy name", async t => {
  const unnamed = store();
  unnamed.policies[0].name = "";
  const unnamedCloud = mockCloud(t, { data: unnamed });
  await assert.rejects(aadManagement.execute(unnamedCloud.s, "bind-ips", { ips: ["pip-2"] }, { id: "policy:policy-1", name: "policy-1" }), /current name could not be verified/);
  assert.equal(unnamedCloud.writes.length, 0);
  const duplicated = store();
  duplicated.policies.push({ ...structuredClone(basePolicy), id: "policy-2", name: "Web Front" });
  const duplicateCloud = mockCloud(t, { data: duplicated });
  await assert.rejects(aadManagement.execute(duplicateCloud.s, "unbind-ips", { ips: ["pip-1"] }, policyResource), /same name/);
  assert.equal(duplicateCloud.writes.length, 0);
});

test("unbind readbacks require typed policy-name proof after the write", async t => {
  let written = false;
  const cloud = mockCloud(t, {
    read: url => {
      if (url.pathname !== "/v1/cnad/protected-ips") return undefined;
      const source = written
        ? structuredClone(baseProtectedIps).map(row => { const copy: Record<string, unknown> = { ...row }; delete copy.policy_name; return copy; })
        : structuredClone(baseProtectedIps);
      const packageId = url.searchParams.get("package_id");
      const items = packageId ? source.filter(row => row.package_id === packageId) : source;
      return { total: items.length, items };
    },
    write: () => { written = true; return {}; },
  });
  await assert.rejects(aadManagement.execute(cloud.s, "unbind-ips", { ips: ["pip-1"] }, policyResource), /policy binding/);
  assert.equal(cloud.writes.length, 1);
});

test("package-filtered protected-IP listings must only contain that package", async t => {
  const cloud = mockCloud(t, { read: url => {
    if (url.pathname !== "/v1/cnad/protected-ips") return undefined;
    const packageId = url.searchParams.get("package_id");
    if (!packageId) return { total: 3, items: structuredClone(baseProtectedIps) };
    const items = [...structuredClone(baseProtectedIps).filter(row => row.package_id === packageId), { ...structuredClone(baseProtectedIps[2]), id: "pip-8" }];
    return { total: items.length, items };
  } });
  await assert.rejects(aadManagement.options!(cloud.s, "bind-ips", policyResource), /different package/);
});

test("package rename and protected-IP tags use their native contracts and verify live values", async t => {
  const cloud = mockCloud(t);
  await aadManagement.execute(cloud.s, "rename-package", { name: "Renamed Package" }, packageResource);
  assert.deepEqual(cloud.writes[0], { path: "/v1/cnad/packages/pkg-1/name", method: "PUT", body: { name: "Renamed Package" } });
  await aadManagement.execute(cloud.s, "tag-protected-ip", { tag: "edge-1" }, protectedIpResource);
  assert.deepEqual(cloud.writes[1], { path: "/v1/cnad/protected-ips/tags", method: "PUT", body: { id: "pip-1", tag: "edge-1" } });
  await aadManagement.execute(cloud.s, "tag-protected-ip", { tag: "" }, protectedIpResource);
  assert.deepEqual(cloud.writes[2].body, { id: "pip-1", tag: "" });
  const stale = mockCloud(t, { read: url => url.pathname === "/v1/cnad/packages" ? { total: 1, items: [structuredClone(basePackage)] } : undefined });
  await assert.rejects(aadManagement.execute(stale.s, "rename-package", { name: "Renamed Package" }, packageResource), /could not be verified/);
});

test("instance blackwhite inspect reads both native v2 lists strictly without raw descriptions", async t => {
  const cloud = mockCloud(t);
  const outcome = await aadManagement.execute(cloud.s, "instance-blackwhite", {}, instanceResource);
  assert.match(outcome.message, /1 blacklisted and 1 whitelisted IPs/);
  assert.ok(outcome.facts!.some(fact => fact.label === "203.0.113.20" && fact.value === "Blacklisted"));
  assert.ok(outcome.facts!.some(fact => fact.label === "198.51.100.20" && fact.value === "Whitelisted"));
  assert.ok(!JSON.stringify(outcome).includes("internal note"));
  const duplicate = mockCloud(t, { read: url => url.pathname === "/v2/aad/policies/ddos/blackwhite-list" ? { total: 2, ips: [{ ip: "203.0.113.20", desc: "" }, { ip: "203.0.113.20", desc: "" }] } : undefined });
  await assert.rejects(aadManagement.execute(duplicate.s, "instance-blackwhite", {}, instanceResource), /duplicate entry/);
  const invalid = mockCloud(t, { read: url => url.pathname === "/v2/aad/policies/ddos/blackwhite-list" ? { total: 1, ips: [{ ip: "not-an-ip", desc: "" }] } : undefined });
  await assert.rejects(aadManagement.execute(invalid.s, "instance-blackwhite", {}, instanceResource), /invalid entry/);
  const mismatched = mockCloud(t, { read: url => url.pathname === "/v2/aad/policies/ddos/blackwhite-list" ? { total: 3, ips: [{ ip: "203.0.113.20", desc: "" }] } : undefined });
  await assert.rejects(aadManagement.execute(mismatched.s, "instance-blackwhite", {}, instanceResource), /does not match/);
  const missing = mockCloud(t, { read: url => url.pathname === "/v2/aad/policies/ddos/blackwhite-list" ? { total: 0 } : undefined });
  await assert.rejects(aadManagement.execute(missing.s, "instance-blackwhite", {}, instanceResource), /no AAD instance black list/);
  const foreign = mockCloud(t, { read: url => url.pathname === "/v2/aad/policies/ddos/blackwhite-list" ? { total: 0, ips: [], instance_id: "aad-9" } : undefined });
  await assert.rejects(aadManagement.execute(foreign.s, "instance-blackwhite", {}, instanceResource), /different resource/);
});

test("instance blackwhite writes verify against the native list and stay pending when unchanged", async t => {
  const cloud = mockCloud(t);
  const added = await aadManagement.execute(cloud.s, "instance-blackwhite-add", { type: "black", ips: "203.0.113.5" }, instanceResource);
  assert.deepEqual(cloud.writes[0], { path: "/v1/project-1/aad/external/bwlist", method: "POST", body: { instance_id: "aad-1", type: "black", ips: ["203.0.113.5"] } });
  assert.match(added.message, /added to this instance and verified/);
  assert.equal(added.asynchronous, undefined);
  const removed = await aadManagement.execute(cloud.s, "instance-blackwhite-delete", { type: "white", ips: "198.51.100.20" }, instanceResource);
  assert.deepEqual(cloud.writes[1], { path: "/v1/project-1/aad/external/bwlist", method: "DELETE", body: { instance_id: "aad-1", type: "white", ips: ["198.51.100.20"] } });
  assert.match(removed.message, /removed from this instance and verified/);
  const stale = mockCloud(t, { read: url => url.pathname === "/v2/aad/policies/ddos/blackwhite-list" && url.searchParams.get("type") === "black" ? { total: 1, ips: [{ ip: "203.0.113.20", desc: "kept" }] } : undefined });
  const unchanged = await aadManagement.execute(stale.s, "instance-blackwhite-add", { type: "black", ips: "203.0.113.5" }, instanceResource);
  assert.equal(unchanged.asynchronous, true);
  assert.equal(unchanged.jobId, undefined);
  assert.match(unchanged.message, /not yet visible/);
  assert.ok(!/no read API/.test(unchanged.message));
});

test("forwarding rules list, create, update, and delete through the native instance-IP contracts", async t => {
  const cloud = mockCloud(t);
  assert.deepEqual((await aadManagement.options!(cloud.s, "create-rule", instanceResource)).instanceIps.map(choice => choice.value), ["1.2.3.4", "5.6.7.8"]);
  const listed = await aadManagement.execute(cloud.s, "instance-rules", { ip: "1.2.3.4" }, instanceResource);
  assert.match(listed.message, /1 forwarding rule for 1\.2\.3\.4/);
  assert.ok(listed.facts!.some(fact => fact.label === "tcp 443 → 8443" && fact.value.includes("rule rule-1")));
  await assert.rejects(aadManagement.execute(cloud.s, "create-rule", { ip: "8.8.8.8", protocol: "tcp", forwardPort: 8080, sourcePort: 80, sourceIp: "9.9.9.9" }, instanceResource), /belongs to this Anti-DDoS instance/);
  await assert.rejects(aadManagement.execute(cloud.s, "create-rule", { ip: "1.2.3.4", protocol: "tcp", forwardPort: 8080, sourcePort: 80, sourceIp: "9.9.9.9, bad" }, instanceResource), /valid IPv4 or IPv6/);
  await assert.rejects(aadManagement.execute(cloud.s, "create-rule", { ip: "1.2.3.4", protocol: "tcp", forwardPort: 8080, sourcePort: 80, sourceIp: Array.from({ length: 21 }, (_, index) => `10.0.0.${index}`).join(",") }, instanceResource), /at most 20/);
  assert.equal(cloud.writes.length, 0);
  const created = await aadManagement.execute(cloud.s, "create-rule", { ip: "1.2.3.4", protocol: "tcp", forwardPort: 8080, sourcePort: 80, sourceIp: "10.0.0.7, 10.0.0.8" }, instanceResource);
  assert.deepEqual(cloud.writes[0], { path: "/v1/aad/instances/aad-1/1.2.3.4/rules/batch-create", method: "POST", body: { rules: [{ forward_protocol: "tcp", forward_port: 8080, source_port: 80, source_ip: "10.0.0.7,10.0.0.8" }] } });
  assert.equal(created.resourceId, "instance:aad-1");
  assert.equal(created.asynchronous, true);
  assert.match(created.message, /accepted/);
  assert.ok(!/verified/.test(created.message));
  assert.deepEqual((await aadManagement.options!(cloud.s, "update-rule", instanceResource)).ipRules.map(choice => JSON.parse(choice.value)), [{ ip: "1.2.3.4", ruleId: "rule-1" }, { ip: "1.2.3.4", ruleId: "rule-new" }]);
  await aadManagement.execute(cloud.s, "update-rule", { rule: JSON.stringify({ ip: "1.2.3.4", ruleId: "rule-1" }), protocol: "udp", forwardPort: 53, sourcePort: 5353, sourceIp: "9.9.9.9" }, instanceResource);
  assert.deepEqual(cloud.writes[1], { path: "/v1/aad/instances/aad-1/1.2.3.4/rules/rule-1", method: "PUT", body: { forward_protocol: "udp", forward_port: 53, source_port: 5353, source_ip: "9.9.9.9" } });
  await aadManagement.execute(cloud.s, "delete-rule", { rule: JSON.stringify({ ip: "1.2.3.4", ruleId: "rule-new" }) }, instanceResource);
  assert.deepEqual(cloud.writes[2], { path: "/v1/aad/instances/aad-1/1.2.3.4/rules/batch-delete", method: "POST", body: { ids: ["rule-new"] } });
  assert.ok(!cloud.data.rulesByIp["1.2.3.4"].some(rule => rule.rule_id === "rule-new"));
  await assert.rejects(aadManagement.execute(cloud.s, "delete-rule", { rule: JSON.stringify({ ip: "1.2.3.4", ruleId: "rule-new" }) }, instanceResource), /no longer exists/);
  await assert.rejects(aadManagement.execute(cloud.s, "delete-rule", { rule: "not-json" }, instanceResource), /Select a forwarding rule/);
});

test("batch rule results are checked instead of trusting HTTP 200", async t => {
  const cloud = mockCloud(t, { write: () => ({ success_num: 0 }) });
  await assert.rejects(aadManagement.execute(cloud.s, "create-rule", { ip: "1.2.3.4", protocol: "tcp", forwardPort: 8080, sourcePort: 80, sourceIp: "9.9.9.9" }, instanceResource), (error: unknown) => !(error instanceof ManagementInputError) && !(error instanceof HuaweiApiError) && /uncertain/.test((error as Error).message));
  const unverifiable = mockCloud(t, { write: () => ({}) });
  await assert.rejects(aadManagement.execute(unverifiable.s, "create-rule", { ip: "1.2.3.4", protocol: "tcp", forwardPort: 8080, sourcePort: 80, sourceIp: "9.9.9.9" }, instanceResource), (error: unknown) => !(error instanceof ManagementInputError) && /no verifiable/.test((error as Error).message));
  assert.equal(unverifiable.writes.length, 1);
});

test("create-rule never borrows a concurrent matching rule and always reports accepted", async t => {
  const cloud = mockCloud(t);
  const outcome = await aadManagement.execute(cloud.s, "create-rule", { ip: "1.2.3.4", protocol: "tcp", forwardPort: 443, sourcePort: 8443, sourceIp: "9.9.9.9" }, instanceResource);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, undefined);
  assert.match(outcome.message, /no ID/);
  assert.ok(!/verified/.test(outcome.message));
  assert.equal(outcome.resourceId, "instance:aad-1");
  assert.equal(cloud.writes.length, 1);
});

test("update-rule verifies the original rule ID instead of any matching rule", async t => {
  const data = store();
  data.rulesByIp["1.2.3.4"].push({ rule_id: "rule-2", forward_protocol: "udp", forward_port: 53, source_port: 5353, lb_method: "lc", source_ip: "9.9.9.9", status: 0 });
  const cloud = mockCloud(t, { data, write: path => path.endsWith("/rules/rule-1") ? new Response("{}", { status: 200 }) : undefined });
  await assert.rejects(aadManagement.execute(cloud.s, "update-rule", { rule: JSON.stringify({ ip: "1.2.3.4", ruleId: "rule-1" }), protocol: "udp", forwardPort: 53, sourcePort: 5353, sourceIp: "9.9.9.9" }, instanceResource), /original rule could not be verified/);
  assert.equal(cloud.writes.length, 1);
});

test("create-domain sends the exact HostBody and returns the camelCase domain identity", async t => {
  const cloud = mockCloud(t);
  const values = { domainName: "shop.example.com", enterpriseProjectId: "0", vips: ["1.2.3.4"], realServerType: "0", realServer: "9.9.9.9", portHttp: ["80"], portHttps: ["443"] };
  const outcome = await aadManagement.execute(cloud.s, "create-domain", values);
  assert.deepEqual(cloud.writes, [{ path: "/v1/project-1/aad/external/domains", method: "POST", body: { domain_name: "shop.example.com", enterprise_project_id: "0", vips: ["1.2.3.4"], real_server_type: 0, port_http: [80], port_https: [443], real_server: "9.9.9.9" } }]);
  assert.equal(outcome.resourceId, "domain:dom-new");
  assert.match(outcome.message, /CNAME/);
  await assert.rejects(aadManagement.execute(cloud.s, "create-domain", { ...values, vips: ["9.9.9.8"] }), /same enterprise project/);
  await assert.rejects(aadManagement.execute(cloud.s, "create-domain", { ...values, vips: ["8.8.8.8"] }), /current instance IP/);
  await assert.rejects(aadManagement.execute(cloud.s, "create-domain", { ...values, portHttp: [], portHttps: [] }), /at least one HTTP or HTTPS port/);
  await assert.rejects(aadManagement.execute(cloud.s, "create-domain", { ...values, realServer: "not an ip" }), /one origin IPv4/);
  await assert.rejects(aadManagement.execute(cloud.s, "create-domain", { ...values, realServerType: "1", realServer: "bad name" }), /one origin domain/);
  await assert.rejects(aadManagement.execute(cloud.s, "create-domain", { ...values, enterpriseProjectId: "" }), /enterprise project ID/);
  assert.equal(cloud.writes.length, 1);
});

test("create-domain verifies unambiguous instance-IP ownership and enterprise project", async t => {
  const values = { domainName: "shop.example.com", enterpriseProjectId: "0", vips: ["1.2.3.4"], realServerType: "0", realServer: "9.9.9.9", portHttp: ["80"], portHttps: ["443"] };
  const shared = mockCloud(t);
  shared.data.instances.push({ ...structuredClone(baseInstance), instance_id: "aad-3", instance_name: "Shared Holder", ips: [{ ip_id: "ipid-9", ip: "1.2.3.4", basic_bandwidth: 100, elastic_bandwidth: 0, ip_status: 0 }], expire_time: 1798761600, service_bandwidth: 500, instance_status: 0, enterprise_project_id: "0" });
  await assert.rejects(aadManagement.execute(shared.s, "create-domain", values), /shared by multiple instances/);
  assert.equal(shared.writes.length, 0);
  const choices = await aadManagement.options!(shared.s, "create-domain");
  assert.ok(choices.instanceIps.some(choice => choice.value === "1.2.3.4" && /shared by multiple instances/.test(choice.label)));
  const nullEps = mockCloud(t);
  nullEps.data.instances[0].enterprise_project_id = null;
  await assert.rejects(aadManagement.execute(nullEps.s, "create-domain", values), /same enterprise project/);
  assert.equal(nullEps.writes.length, 0);
});

test("origin replacement changes only origin fields and verifies the live domain", async t => {
  const cloud = mockCloud(t);
  const outcome = await aadManagement.execute(cloud.s, "update-domain-origin", { realServerType: "1", realServer: "origin.example.com" }, domainResource);
  assert.deepEqual(cloud.writes, [{ path: "/v1/aad/protected-domains/dom-1", method: "PUT", body: { real_server_type: 1, real_servers: "origin.example.com" } }]);
  assert.match(outcome.message, /visible in the protected-domain list/);
  assert.ok(!/All of the domain's other reported settings were verified unchanged/.test(outcome.message));
  const stale = mockCloud(t, { read: url => url.pathname === "/v1/aad/protected-domains" ? { count: 1, items: [structuredClone(baseDomain)] } : undefined });
  await assert.rejects(aadManagement.execute(stale.s, "update-domain-origin", { realServerType: "1", realServer: "origin.example.com" }, domainResource), /could not be verified/);
  assert.equal(stale.writes.length, 1);
});

test("origin replacement rejects masked changes to the domain's other reported settings", async t => {
  let originWritten = false;
  const cloud = mockCloud(t, {
    read: url => url.pathname === "/v1/aad/protected-domains" ? { count: 1, items: [{ ...structuredClone(baseDomain), ...(originWritten ? { real_server_type: 1, real_servers: "origin.example.com", waf_status: 0 } : {}) }] } : undefined,
    write: () => { originWritten = true; return {}; },
  });
  await assert.rejects(aadManagement.execute(cloud.s, "update-domain-origin", { realServerType: "1", realServer: "origin.example.com" }, domainResource), /changed unexpectedly/);
  assert.equal(cloud.writes.length, 1);
});

test("web protection switches require actual booleans and map them to the native 0/1 semantics", async t => {
  const cloud = mockCloud(t);
  await assert.rejects(aadManagement.execute(cloud.s, "domain-web-switch", { wafSwitch: "true", ccSwitch: false }, domainResource), /Set both web protection switches/);
  await assert.rejects(aadManagement.execute(cloud.s, "domain-web-switch", { wafSwitch: true }, domainResource), /Set both web protection switches/);
  await assert.rejects(aadManagement.execute(cloud.s, "domain-web-switch", { wafSwitch: false, ccSwitch: true }, domainResource), /CC protection requires/);
  assert.equal(cloud.writes.length, 0);
  const enabled = await aadManagement.execute(cloud.s, "domain-web-switch", { wafSwitch: true, ccSwitch: true }, domainResource);
  assert.deepEqual(cloud.writes[0], { path: "/v1/project-1/aad/external/domains/switch", method: "POST", body: { domain_id: "dom-1", waf_switch: 0, cc_switch: 0 } });
  assert.equal(enabled.asynchronous, true);
  assert.equal(enabled.jobId, undefined);
  assert.match(enabled.message, /accepted the request to enable web basic protection and enable CC protection/);
  assert.match(enabled.message, /cannot be read back/);
  const disabled = await aadManagement.execute(cloud.s, "domain-web-switch", { wafSwitch: false, ccSwitch: false }, domainResource);
  assert.deepEqual(cloud.writes[1].body, { domain_id: "dom-1", waf_switch: 1, cc_switch: 1 });
  assert.equal(disabled.asynchronous, true);
  assert.match(disabled.message, /accepted the request to disable web basic protection and disable CC protection/);
});

test("domain deletion uses the v2 batch contract, proves removal, and retains the original resource", async t => {
  const cloud = mockCloud(t);
  const outcome = await aadManagement.execute(cloud.s, "delete-domain", {}, domainResource);
  assert.deepEqual(cloud.writes, [{ path: "/v2/aad/domains", method: "DELETE", body: { domain_id: ["dom-1"] } }]);
  assert.match(outcome.message, /DNS/);
  assert.equal(outcome.resourceId, "domain:dom-1");
  assert.equal(outcome.asynchronous, undefined);
  const lingering = mockCloud(t, { read: url => url.pathname === "/v1/aad/protected-domains" ? { count: 1, items: [structuredClone(baseDomain)] } : undefined });
  const pending = await aadManagement.execute(lingering.s, "delete-domain", {}, domainResource);
  assert.equal(pending.asynchronous, true);
  assert.equal(pending.jobId, undefined);
  assert.match(pending.message, /still listed/);
  assert.equal(pending.resourceId, "domain:dom-1");
});

test("every manual outcome is asynchronous without a fabricated job ID", async t => {
  const settings = mockCloud(t);
  const policyOutcome = await aadManagement.execute(settings.s, "policy-settings", fullSettings, policyResource);
  const unreadable = mockCloud(t, { read: url => url.pathname === "/v1/cnad/policies/policy-1" ? { id: "policy-1", package_id: "pkg-1", name: "Web Front", clean_threshold: 100 } : undefined });
  const bwOutcome = await aadManagement.execute(unreadable.s, "policy-blackwhite-add", { type: "white", ips: "198.51.100.8" }, policyResource);
  const switches = mockCloud(t);
  const switchOutcome = await aadManagement.execute(switches.s, "domain-web-switch", { wafSwitch: true, ccSwitch: false }, domainResource);
  const rules = mockCloud(t);
  const ruleOutcome = await aadManagement.execute(rules.s, "create-rule", { ip: "1.2.3.4", protocol: "tcp", forwardPort: 8080, sourcePort: 80, sourceIp: "9.9.9.9" }, instanceResource);
  const stale = mockCloud(t, { read: url => url.pathname === "/v2/aad/policies/ddos/blackwhite-list" ? { total: 0, ips: [] } : undefined });
  const bwPending = await aadManagement.execute(stale.s, "instance-blackwhite-add", { type: "black", ips: "203.0.113.5" }, instanceResource);
  const lingering = mockCloud(t, { read: url => url.pathname === "/v1/aad/protected-domains" ? { count: 1, items: [structuredClone(baseDomain)] } : undefined });
  const domainPending = await aadManagement.execute(lingering.s, "delete-domain", {}, domainResource);
  for (const outcome of [policyOutcome, bwOutcome, switchOutcome, ruleOutcome, bwPending, domainPending]) {
    assert.equal(outcome.asynchronous, true, outcome.message);
    assert.equal(outcome.jobId, undefined, outcome.message);
  }
});

test("wrong parent echoes block otherwise-accepted writes", async t => {
  const cases: [string, ManagementValues, { id: string; name: string }, Record<string, unknown>][] = [
    ["rename-package", { name: "Renamed Package" }, packageResource, { package_id: "pkg-9" }],
    ["policy-settings", fullSettings, policyResource, { id: "policy-9" }],
    ["policy-blackwhite-add", { type: "black", ips: "203.0.113.10" }, policyResource, { id: "policy-9" }],
    ["bind-ips", { ips: ["pip-2"] }, policyResource, { package_id: "pkg-9" }],
    ["tag-protected-ip", { tag: "edge" }, protectedIpResource, { id: "pip-9" }],
    ["update-rule", { rule: JSON.stringify({ ip: "1.2.3.4", ruleId: "rule-1" }), protocol: "udp", forwardPort: 53, sourcePort: 5353, sourceIp: "9.9.9.9" }, instanceResource, { rule_id: "rule-9" }],
    ["instance-blackwhite-add", { type: "black", ips: "203.0.113.5" }, instanceResource, { instance_id: "aad-9" }],
    ["domain-web-switch", { wafSwitch: true, ccSwitch: false }, domainResource, { domain_id: "dom-9" }],
    ["update-domain-origin", { realServerType: "1", realServer: "origin.example.com" }, domainResource, { domain_id: "dom-9" }],
    ["delete-domain", {}, domainResource, { domain_id: "dom-9" }],
  ];
  for (const [operation, values, resource, echo] of cases) {
    const cloud = mockCloud(t, { write: () => echo });
    await assert.rejects(aadManagement.execute(cloud.s, operation, values, resource), (error: unknown) => !(error instanceof ManagementInputError) && /different resource/.test((error as Error).message), operation);
    assert.equal(cloud.writes.length, 1, operation);
  }
  const nested = mockCloud(t, { write: () => ({ id: "policy-new", data: { package_id: "pkg-9" } }) });
  await assert.rejects(aadManagement.execute(nested.s, "create-policy", { name: "Fresh Policy", package: "pkg-1" }), /different resource/);
});

test("business-error ACK semantics allow only exact zero error codes", async t => {
  for (const code of [0, "0"]) {
    const cloud = mockCloud(t, { write: () => ({ error_code: code }) });
    const outcome = await aadManagement.execute(cloud.s, "rename-package", { name: "Renamed Package" }, packageResource);
    assert.match(outcome.message, /renamed/);
  }
  for (const code of [404, "AAD.2020", "", null, false]) {
    const cloud = mockCloud(t, { write: () => ({ error_code: code }) });
    await assert.rejects(aadManagement.execute(cloud.s, "rename-package", { name: "Renamed Package" }, packageResource), /business error/);
    assert.equal(cloud.writes.length, 1);
  }
});

test("provided error_msg or error objects block otherwise-valid ACKs", async t => {
  for (const body of [{ error_msg: "private failure" }, { error_msg: "" }, { error: { message: "private failure" } }, { error: null }]) {
    const cloud = mockCloud(t, { write: () => body });
    await assert.rejects(aadManagement.execute(cloud.s, "rename-package", { name: "Renamed Package" }, packageResource), (error: unknown) => /business error/.test((error as Error).message) && !/private failure/.test((error as Error).message));
    assert.equal(cloud.writes.length, 1);
  }
});

test("stale or wrongly typed resources are rejected before any write", async t => {
  const cloud = mockCloud(t);
  const stale: [string, ManagementValues, { id: string; name: string } | undefined][] = [
    ["rename-package", { name: "X" }, { id: "package:gone", name: "Gone" }],
    ["policy-settings", {}, { id: "policy:gone", name: "Gone" }],
    ["tag-protected-ip", { tag: "x" }, { id: "protected-ip:gone", name: "Gone" }],
    ["instance-rules", { ip: "1.2.3.4" }, { id: "instance:gone", name: "Gone" }],
    ["delete-domain", {}, { id: "domain:gone", name: "Gone" }],
    ["rename-package", { name: "X" }, { id: "policy:policy-1", name: "Web Front" }],
    ["bind-ips", { ips: ["pip-2"] }, undefined],
  ];
  for (const [operation, values, resource] of stale) await assert.rejects(aadManagement.execute(cloud.s, operation, values, resource), /no longer exists|Select a current/);
  assert.equal(cloud.writes.length, 0);
});

test("renamed resources never accept stale exact-name confirmations", async t => {
  const cloud = mockCloud(t);
  cloud.data.packages[0].package_name = "Renamed Elsewhere";
  cloud.data.policies[0].name = "Renamed Elsewhere";
  cloud.data.domains[0].domain_name = "moved.example.com";
  await assert.rejects(aadManagement.execute(cloud.s, "rename-package", { name: "X" }, packageResource), (error: unknown) => error instanceof ManagementInputError && (error as ManagementInputError).status === 409 && /renamed or the selection is stale/.test(error.message));
  await assert.rejects(aadManagement.execute(cloud.s, "policy-settings", fullSettings, policyResource), /renamed or the selection is stale/);
  await assert.rejects(aadManagement.execute(cloud.s, "delete-domain", {}, domainResource), /renamed or the selection is stale/);
  await assert.rejects(aadManagement.execute(cloud.s, "tag-protected-ip", { tag: "x" }, { id: "protected-ip:pip-1", name: "Stale Name" }), /renamed or the selection is stale/);
  assert.equal(cloud.writes.length, 0);
});

test("null or wrongly typed native fields block management instead of defaulting", async t => {
  const data = store();
  data.protectedIps.find(row => String(row.id) === "pip-1")!.policy_name = null;
  const s = mockAad(t, url => read(url, data));
  await assert.rejects(aadManagement.inventory(s), /policy binding/);
  const typed = mockCloud(t, { read: url => url.pathname === "/v1/cnad/policies/policy-1" ? { id: "policy-1", package_id: "pkg-1", name: "Web Front", clean_threshold: "200" } : undefined });
  await assert.rejects(aadManagement.execute(typed.s, "policy-settings", fullSettings, policyResource), /could not be verified/);
  assert.equal(typed.writes.length, 1);
});

test("malformed or truncated native lists block management instead of guessing", async t => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["/v1/cnad/packages", { total: 1 }, /no AAD package list/],
    ["/v1/cnad/packages", { total: 1, items: [{ package_id: "" }] }, /without a usable ID/],
    ["/v1/cnad/packages", { total: 1, items: [structuredClone(basePackage), structuredClone(basePackage)] }, /duplicate/],
    ["/v1/cnad/packages", { total: 5, items: [structuredClone(basePackage)] }, /does not match its returned rows/],
    ["/v1/cnad/packages", { total: 1.5, items: [structuredClone(basePackage)] }, /no valid total/],
    ["/v1/cnad/packages", { total: -1, items: [] }, /no valid total/],
    ["/v1/cnad/packages", { total: null, items: [structuredClone(basePackage)] }, /no valid total/],
    ["/v1/cnad/policies", { items: [structuredClone(basePolicy)] }, /no valid total/],
    ["/v1/cnad/policies", { total: 5, items: [structuredClone(basePolicy)] }, /duplicate/],
    ["/v1/aad/protected-domains", { count: 1 }, /no AAD protected domain list/],
  ];
  for (const [path, body, expression] of cases) {
    const s = mockAad(t, url => url.pathname === path ? body : read(url, store()));
    await assert.rejects(aadManagement.inventory(s), expression);
  }
  const nullIps = mockAad(t, url => url.pathname === "/v1/aad/instances" ? { count: 1, items: [{ ...structuredClone(baseInstance), ips: null }] } : read(url, store()));
  await assert.rejects(aadManagement.options!(nullIps, "create-domain"), /ips list/);
  const emptyIps = mockAad(t, url => url.pathname === "/v1/aad/instances" ? { count: 1, items: [{ ...structuredClone(baseInstance), ips: [] }] } : read(url, store()));
  await assert.rejects(aadManagement.options!(emptyIps, "create-domain"), /no IP list/);
  const noProtocol = mockAad(t, url => url.pathname === "/v1/aad/protected-domains" ? { count: 1, items: [{ domain_id: "dom-1", domain_name: "example.com", cname: baseDomain.cname, real_server_type: 0, real_servers: "9.9.9.9", waf_status: 1, enterprise_project_id: "0" }] } : read(url, store()));
  await assert.rejects(aadManagement.inventory(noProtocol), /protocol list/);
});

test("paginated lists validate stable totals, completeness, and duplicates", async t => {
  const policyRows = Array.from({ length: 150 }, (_, index) => ({ ...structuredClone(basePolicy), id: `policy-${index + 1}` }));
  const mockPolicies = (handle: (offset: number) => Record<string, unknown>) => mockAad(t, url => {
    if (url.pathname !== "/v1/cnad/policies") return read(url, store());
    return handle(Number(url.searchParams.get("offset") ?? "0"));
  });
  const complete = mockPolicies(offset => ({ total: 150, items: policyRows.slice(offset, offset + 100) }));
  const resources = await aadManagement.inventory(complete);
  assert.equal(resources.filter(resource => resource.id.startsWith("policy:")).length, 150);
  const incomplete = mockPolicies(offset => ({ total: 150, items: policyRows.slice(offset, Math.min(offset + 100, 120)) }));
  await assert.rejects(aadManagement.inventory(incomplete), /incomplete AAD policy list/);
  const duplicated = mockPolicies(offset => offset === 0 ? { total: 150, items: policyRows.slice(0, 100) } : { total: 150, items: [...policyRows.slice(100, 149), policyRows[0]] });
  await assert.rejects(aadManagement.inventory(duplicated), /duplicate/);
  const stringTotal = mockPolicies(offset => offset === 0 ? { total: 150, items: policyRows.slice(0, 100) } : { total: "150", items: policyRows.slice(100, 150) });
  await assert.rejects(aadManagement.inventory(stringTotal), /no valid total/);
  const unstable = mockPolicies(offset => offset === 0 ? { total: 150, items: policyRows.slice(0, 100) } : { total: 149, items: policyRows.slice(100, 150) });
  await assert.rejects(aadManagement.inventory(unstable), /changed between pages/);
  const overflowing = mockPolicies(() => ({ total: 50, items: policyRows.slice(0, 100) }));
  await assert.rejects(aadManagement.inventory(overflowing), /exceeds its reported total/);
});

test("native HTTP failures preserve a sanitized HuaweiApiError status", async t => {
  const cloud = mockCloud(t, { write: () => new Response(JSON.stringify({ error_code: "AAD.404", error_msg: "domain not found SECRET" }), { status: 404 }) });
  await assert.rejects(aadManagement.execute(cloud.s, "delete-domain", {}, domainResource), (error: unknown) => {
    assert.ok(error instanceof HuaweiApiError);
    assert.equal((error as HuaweiApiError).status, 404);
    assert.match((error as Error).message, /HTTP 404/);
    assert.ok(!/SECRET|domain not found/.test((error as Error).message));
    return true;
  });
  assert.equal(cloud.writes.length, 1);
});

test("transport and payload failures stay uncertain and never leak private details", async t => {
  const data = store();
  let writeAttempted = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.origin === session.iamEndpoint) return Response.json(iamToken);
    if (!init.method) return Response.json(read(url, data));
    writeAttempted = true;
    throw new TypeError("connect ECONNREFUSED 10.0.0.9:443 SECRET-HOST");
  });
  const s = accountSession();
  await assert.rejects(aadManagement.execute(s, "delete-domain", {}, domainResource), (error: unknown) => {
    assert.ok(!(error instanceof ManagementInputError));
    assert.ok(!(error instanceof HuaweiApiError));
    assert.match((error as Error).message, /outcome is unknown/);
    assert.ok(!/ECONNREFUSED|SECRET-HOST|10\.0\.0\.9/.test((error as Error).message));
    return true;
  });
  assert.ok(writeAttempted);
  const badJson = mockCloud(t, { write: () => new Response("<not-json> SECRET-STACK", { status: 200 }) });
  await assert.rejects(aadManagement.execute(badJson.s, "delete-domain", {}, domainResource), (error: unknown) => !(error instanceof ManagementInputError) && !(error instanceof HuaweiApiError) && /invalid Anti-DDoS response/.test((error as Error).message));
  assert.equal(badJson.writes.length, 1);
  const arrayBody = mockCloud(t, { write: () => new Response(JSON.stringify([{ private: "payload" }]), { status: 200 }) });
  await assert.rejects(aadManagement.execute(arrayBody.s, "delete-domain", {}, domainResource), (error: unknown) => /invalid Anti-DDoS response/.test((error as Error).message) && !/payload/.test((error as Error).message));
  assert.equal(arrayBody.writes.length, 1);
});

test("native 200 business errors fail reads and keep writes uncertain", async t => {
  const s = mockAad(t, () => ({ error_code: "AAD.2020", error_msg: "private failure detail" }));
  await assert.rejects(aadManagement.inventory(s), (error: unknown) => !(error instanceof HuaweiApiError) && /business error/.test((error as Error).message));
  const write = mockCloud(t, { write: () => ({ error_code: "AAD.2020", error_msg: "private failure detail" }) });
  await assert.rejects(aadManagement.execute(write.s, "delete-domain", {}, domainResource), (error: unknown) => {
    assert.ok(!(error instanceof ManagementInputError) && !(error instanceof HuaweiApiError));
    assert.match((error as Error).message, /business error/);
    assert.ok(!/private failure detail/.test((error as Error).message));
    return true;
  });
  assert.equal(write.writes.length, 1);
});

test("inspections report known native facts and never echo private or unknown values", async t => {
  const cloud = mockCloud(t);
  const pkg = await aadManagement.execute(cloud.s, "inspect-package", {}, packageResource);
  assert.ok(pkg.facts!.some(fact => fact.label === "Protected IP quota" && fact.value === "2 of 10"));
  assert.ok(pkg.facts!.some(fact => fact.label === "Basic cleaning bandwidth" && fact.value === "100 Mbps"));
  const policy = await aadManagement.execute(cloud.s, "inspect-policy", {}, policyResource);
  assert.ok(policy.facts!.some(fact => fact.label === "Cleaning threshold" && fact.value === "100"));
  assert.ok(policy.facts!.some(fact => fact.label === "Blacklisted IPs" && fact.value === "1"));
  const ip = await aadManagement.execute(cloud.s, "inspect-protected-ip", {}, protectedIpResource);
  assert.ok(ip.facts!.some(fact => fact.label === "IP address" && fact.value === "100.64.1.10"));
  assert.ok(ip.facts!.some(fact => fact.label === "Block time" && /2025-12-31/.test(fact.value)));
  assert.ok(ip.facts!.some(fact => fact.label === "Policy" && fact.value === "Web Front"));
  const instance = await aadManagement.execute(cloud.s, "inspect-instance", {}, instanceResource);
  assert.ok(instance.facts!.some(fact => fact.label === "1.2.3.4" && fact.value === "Basic 100 Mbps · elastic 50 Mbps · status 0"));
  const packageIps = await aadManagement.execute(cloud.s, "package-ips", {}, packageResource);
  assert.match(packageIps.message, /2 protected IPs on this package/);
  assert.ok(packageIps.facts!.some(fact => fact.label === "Unbound to a policy" && fact.value === "1"));
  const secret = mockCloud(t, { read: url => url.pathname === "/v1/aad/protected-domains" ? { count: 1, items: [{ ...structuredClone(baseDomain), cert_private_key: "SECRET-KEY-MATERIAL" }] } : undefined });
  const domain = await aadManagement.execute(secret.s, "inspect-domain", {}, domainResource);
  assert.ok(!JSON.stringify(domain).includes("SECRET-KEY-MATERIAL"));
  assert.ok(domain.facts!.some(fact => fact.label === "CNAME" && fact.value === baseDomain.cname));
  assert.ok(domain.facts!.some(fact => fact.label === "Origin" && fact.value === "9.9.9.9 (origin IP)"));
  const rules = store();
  rules.rulesByIp["1.2.3.4"] = [{ rule_id: "rule-x", forward_protocol: "sctp", forward_port: 443, source_port: 8443, lb_method: "lc", source_ip: "9.9.9.9", status: 9 }];
  const ruleCloud = mockCloud(t, { data: rules });
  const listed = await aadManagement.execute(ruleCloud.s, "instance-rules", { ip: "1.2.3.4" }, instanceResource);
  assert.ok(listed.facts!.some(fact => fact.label === "Unknown 443 → 8443" && fact.value === "Origin 9.9.9.9 · rule rule-x · status Unknown"));
  const domainData = store();
  domainData.domains[0] = { ...structuredClone(baseDomain), protocol: [true], real_server_type: null, waf_status: 3 };
  const domainCloud = mockCloud(t, { data: domainData });
  const unknownDomain = await aadManagement.execute(domainCloud.s, "inspect-domain", {}, domainResource);
  assert.ok(unknownDomain.facts!.some(fact => fact.label === "Protocols" && fact.value === "Unknown"));
  assert.ok(unknownDomain.facts!.some(fact => fact.label === "Origin" && fact.value === "9.9.9.9 (Unknown)"));
  assert.ok(unknownDomain.facts!.some(fact => fact.label === "Web protection status" && fact.value === "Unknown"));
  const ipData = store();
  ipData.protectedIps[0] = { ...structuredClone(baseProtectedIps[0]), status: 7 };
  const ipCloud = mockCloud(t, { data: ipData });
  const unknownStatus = await aadManagement.execute(ipCloud.s, "inspect-protected-ip", {}, protectedIpResource);
  assert.ok(unknownStatus.facts!.some(fact => fact.label === "Native status" && fact.value === "Unknown"));
});

test("the operation contract is whitelisted, confirmed, and impact-aware", async t => {
  const cloud = mockCloud(t);
  const ids = aadManagement.operations.map(operation => operation.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const operation of aadManagement.operations) {
    assert.ok(operation.description, operation.id);
    if (operation.kind === "delete") assert.equal(operation.confirmation, true, operation.id);
    if (operation.kind !== "create" && operation.kind !== "inspect") assert.ok(operation.resourcePrefixes?.length, operation.id);
  }
  assert.equal(aadManagement.operations.find(operation => operation.id === "instance-blackwhite")?.kind, "inspect");
  for (const id of ["policy-settings", "policy-blackwhite-add", "policy-blackwhite-delete", "bind-ips", "unbind-ips", "create-rule", "update-rule", "delete-rule", "create-domain", "update-domain-origin", "domain-web-switch", "delete-domain", "instance-blackwhite-add", "instance-blackwhite-delete"]) assert.ok(aadManagement.operations.find(operation => operation.id === id)?.impact, id);
  await assert.rejects(aadManagement.execute(cloud.s, "purchase-package", {}, undefined), /Unsupported AAD operation/);
  assert.equal(cloud.writes.length, 0);
});

test("the form contract enforces live selections, native enums, and typed bounds", async t => {
  const cloud = mockCloud(t);
  const create = aadManagement.operations.find(operation => operation.id === "create-domain")!;
  const choices = await aadManagement.options!(cloud.s, "create-domain");
  const values = { domainName: "shop.example.com", enterpriseProjectId: "0", vips: ["1.2.3.4"], realServerType: "0", realServer: "9.9.9.9", portHttp: ["80"], portHttps: ["443"] };
  validateManagementValues(create, values, choices);
  assert.throws(() => validateManagementValues(create, { ...values, vips: ["8.8.8.8"] }, choices), /unavailable/);
  assert.throws(() => validateManagementValues(create, { ...values, realServerType: "7" }, choices), /not available/);
  assert.throws(() => validateManagementValues(create, { ...values, extra: "x" }, choices), /unsupported field/);
  const settings = aadManagement.operations.find(operation => operation.id === "policy-settings")!;
  validateManagementValues(settings, { name: "Web Front", threshold: 200, udp: "block", tcp: "block", icmp: "block", other: "block" });
  assert.throws(() => validateManagementValues(settings, { name: "Web Front", threshold: 0, udp: "block", tcp: "block", icmp: "block", other: "block" }), /at least 1/);
  assert.throws(() => validateManagementValues(settings, { name: "Web Front", threshold: 200, udp: "sometimes", tcp: "block", icmp: "block", other: "block" }), /not available/);
  const rule = aadManagement.operations.find(operation => operation.id === "create-rule")!;
  const ruleChoices = { instanceIps: [{ value: "1.2.3.4", label: "1.2.3.4" }] };
  validateManagementValues(rule, { ip: "1.2.3.4", protocol: "tcp", forwardPort: 8080, sourcePort: 80, sourceIp: "9.9.9.9" }, ruleChoices);
  assert.throws(() => validateManagementValues(rule, { ip: "1.2.3.4", protocol: "gre", forwardPort: 8080, sourcePort: 80, sourceIp: "9.9.9.9" }, ruleChoices), /not available/);
  assert.throws(() => validateManagementValues(rule, { ip: "1.2.3.4", protocol: "tcp", forwardPort: 70000, sourcePort: 80, sourceIp: "9.9.9.9" }, ruleChoices), /no more than 65535/);
});

test("CNAD account proof requires the current user and the user's native domain", async t => {
  for (const user of [{ id: "foreign", domain: { id: accountDomainId } }, { id: "user-1", domain: { id: "foreign" } }, { id: "user-1" }, { id: "user-1", domain: null }]) {
    const cloud = mockCloud(t, { iam: () => ({ token: { domain: { id: accountDomainId }, user } }) });
    await assert.rejects(aadManagement.execute(cloud.s, "rename-package", { name: "Fresh" }, packageResource), /identity could not be verified/);
    assert.equal(cloud.writes.length, 0); t.mock.restoreAll();
  }
});
test("CNAD malformed provided project identities cannot be silently skipped", async t => {
  for (const project_id of [null, false, 0, ""]) {
    const cloud = mockCloud(t, { read: url => url.pathname === "/v1/cnad/packages" ? { total: 1, items: [{ ...basePackage, project_id }] } : undefined });
    await assert.rejects(aadManagement.execute(cloud.s, "rename-package", { name: "Fresh" }, packageResource), /unverifiable.*project identity/);
    assert.equal(cloud.writes.length, 0); t.mock.restoreAll();
  }
});
test("AAD nested native business errors cannot be accepted as write acknowledgements", async t => {
  const cloud = mockCloud(t, { write: () => ({ data: { error_code: "private-code", error_msg: "private-secret" } }) });
  await assert.rejects(aadManagement.execute(cloud.s, "rename-package", { name: "Fresh" }, packageResource), error => error instanceof Error && /business error/.test(error.message) && !error.message.includes("private"));
  assert.equal(cloud.writes.length, 1);
});
test("AAD instance blackwhite list entries preserve exact project scope", async t => {
  for (const project_id of ["foreign", null]) {
    const cloud = mockCloud(t, { read: url => url.pathname === "/v2/aad/policies/ddos/blackwhite-list" ? { total: 1, ips: [{ ip: "203.0.113.1", project_id }] } : undefined });
    await assert.rejects(aadManagement.execute(cloud.s, "instance-blackwhite", {}, instanceResource), /different project/); t.mock.restoreAll();
  }
});
test("AAD unknown protocol states do not enter public inspection facts", async t => {
  const cloud = mockCloud(t, { read: url => url.pathname === "/v1/aad/protected-domains" ? { count: 1, items: [{ ...baseDomain, protocol: ["private-protocol-state"] }] } : undefined });
  const result = await aadManagement.execute(cloud.s, "inspect-domain", {}, domainResource);
  assert.doesNotMatch(JSON.stringify(result), /private-protocol-state/);
  assert.equal(result.facts?.find(fact => fact.label === "Protocols")?.value, "Unknown");
});
