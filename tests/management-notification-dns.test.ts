import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

// Only the endpoint overrides below are honored; every other request target fails the test.
process.env.HUAWEI_DNS_ENDPOINT = "https://dns.test.invalid";
process.env.HUAWEI_SMN_ENDPOINT = "https://smn.test.invalid";
process.env.HUAWEI_LTS_ENDPOINT = "https://lts.test.invalid";

import { validateManagementValues, ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { ManagementAdapter } from "@/lib/huawei/management/types";
import type { ManagementResource, ManagementValues } from "@/lib/management-contract";
import { dnsManagement } from "@/lib/huawei/management/adapters/dns";
import { smnManagement } from "@/lib/huawei/management/adapters/smn";
import { ltsManagement } from "@/lib/huawei/management/adapters/lts";
import { project, session } from "./fixtures/session";

const allowedHosts = new Set(["dns.test.invalid", "smn.test.invalid", "lts.test.invalid"]);
const originalFetch = globalThis.fetch;

type RecordedCall = { url: URL; init: RequestInit | undefined; body: unknown };

/** Mock the transport exactly like the other suites: recorded calls, restored after the test, unknown targets fail. */
function mockCloud(t: TestContext, handle: (url: URL, init: RequestInit | undefined) => unknown) {
  assert.equal(typeof originalFetch, "function");
  const calls: RecordedCall[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!allowedHosts.has(url.hostname)) throw new Error(`Request to unverified endpoint: ${url.hostname}`);
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, init, body });
    const response = handle(url, init);
    return response instanceof Response ? response : Response.json(response);
  });
  return calls;
}


/** Mirrors the framework's submission path: dynamic options are loaded fresh, then values are validated, then executed. */
async function submit(adapter: ManagementAdapter, operationId: string, values: ManagementValues, resource?: ManagementResource) {
  const operation = adapter.operations.find((operation) => operation.id === operationId);
  if (!operation) throw new ManagementInputError("Unsupported operation.");
  if (operation.kind !== "create" && !resource) throw new ManagementInputError("The resource was not found in the selected project.", 404);
  const sources: Record<string, ManagementChoice[]> = adapter.options ? await adapter.options(session, operationId, resource) : {};
  const validated = validateManagementValues(operation, values, sources);
  return adapter.execute(session, operationId, validated, resource);
}

const recordsetPage = {
  metadata: { total_count: 4 },
  recordsets: [
    { id: "soa-1", name: "example.com.", type: "SOA", ttl: 300, records: ["ns1.example.com. hostmaster.example.com."], default: true },
    { id: "ns-1", name: "example.com.", type: "NS", ttl: 300, records: ["ns1.example.com."], default: true },
    { id: "rs-1", name: "www.example.com.", type: "A", ttl: 300, records: ["203.0.113.10"], default: false, status: "ENABLE" },
    { id: "rs-2", name: "api.example.com.", type: "A", ttl: 300, records: ["203.0.113.11"], default: false, status: "ENABLE" },
  ],
};

const zoneFixture = {
  metadata: { total_count: 2 },
  zones: [
    { id: "zone-1", name: "example.com.", zone_type: "public", status: "ACTIVE", ttl: 3600, record_num: 4, description: "Public site", email: "hostmaster@example.com", project_id: project.projectId },
    { id: "zone-2", name: "internal.example.com.", zone_type: "private", status: "ACTIVE", ttl: 300, record_num: 0, description: "", project_id: project.projectId },
  ],
};

test("DNS inventory keeps public zones only and prefills editable zone values", async (t) => {
  const calls = mockCloud(t, (url) => (url.pathname === "/v2/zones" ? zoneFixture : { error_msg: "unexpected path" }));
  const zones = await dnsManagement.inventory(session);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.hostname, "dns.test.invalid");
  assert.equal(calls[0].url.searchParams.get("type"), "public");
  assert.equal(new Headers(calls[0].init?.headers).get("X-Auth-Token"), project.token);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].id, "zone-1");
  assert.equal(zones[0].name, "example.com.");
  assert.equal(zones[0].status, "ACTIVE");
  assert.equal(zones[0].values?.ttl, 3600);
  assert.deepEqual(dnsManagement.invalidationKeys(), ["listDnsZones"]);
});

test("DNS zone create reuses the canonical adapter with a flat typed body", async (t) => {
  const calls = mockCloud(t, (url) => (url.pathname === "/v2/zones" ? { id: "zone-9", name: "new.example.com.", zone_type: "public", status: "PENDING_CREATE" } : { error_msg: "unexpected path" }));
  const outcome = await submit(dnsManagement, "create-zone", { name: "new.example.com.", description: "Second site", email: "hostmaster@example.com", ttl: 300 });
  assert.match(outcome.message, /created/);
  assert.equal(outcome.resourceId, "zone-9");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(calls[0].body, { name: "new.example.com.", zone_type: "public", description: "Second site", email: "hostmaster@example.com", ttl: 300 });
  const invalid = dnsManagement.operations.find((operation) => operation.id === "create-zone")!;
  assert.throws(() => validateManagementValues(invalid, { name: "example.com" }), /Zone name/);
});

test("DNS zone update patches only provided fields and zone delete is asynchronous", async (t) => {
  const calls = mockCloud(t, () => ({ id: "zone-1" }));
  const zone = { id: "zone-1", name: "example.com.", status: "ACTIVE" };
  const updated = await submit(dnsManagement, "update-zone", { description: "Primary site", ttl: 7200 }, zone);
  assert.match(updated.message, /updated/);
  assert.equal(calls[0].init?.method, "PATCH");
  assert.equal(calls[0].url.pathname, "/v2/zones/zone-1");
  assert.deepEqual(calls[0].body, { description: "Primary site", ttl: 7200 });
  const deleted = await submit(dnsManagement, "delete-zone", {}, zone);
  assert.equal(deleted.asynchronous, true);
  assert.equal(calls[1].init?.method, "DELETE");
  await assert.rejects(submit(dnsManagement, "update-zone", {}, zone), /Change at least one field/);
});

test("DNS recordset choices come from a fresh upstream list and hide system recordsets", async (t) => {
  const calls = mockCloud(t, (url) => (url.pathname === "/v2/zones/zone-1/recordsets" ? recordsetPage : { error_msg: "unexpected path" }));
  const sources = await dnsManagement.options!(session, "update-recordset", { id: "zone-1", name: "example.com." });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("limit"), "500");
  assert.deepEqual(sources.recordsets?.map((choice) => choice.value), ["rs-1", "rs-2"]);
  assert.ok(sources.recordsets?.every((choice) => !choice.label.includes("SOA") && !choice.label.startsWith("example.com. (NS")));
  assert.deepEqual(await dnsManagement.options!(session, "update-recordset"), {});
});

test("DNS recordset create validates the zone suffix before calling the API", async (t) => {
  const calls = mockCloud(t, (url) => (url.pathname === "/v2/zones/zone-1/recordsets" ? { id: "rs-9", name: "api.example.com." } : { error_msg: "unexpected path" }));
  const zone = { id: "zone-1", name: "example.com.", status: "ACTIVE" };
  await assert.rejects(submit(dnsManagement, "create-recordset", { name: "api.other.org.", type: "A", ttl: 300, records: ["203.0.113.10"] }, zone), /must equal the zone name/);
  assert.equal(calls.length, 0);
  const outcome = await submit(dnsManagement, "create-recordset", { name: "api.example.com.", type: "A", ttl: 300, records: ["203.0.113.10", "203.0.113.11"], description: "Edge" }, zone);
  assert.equal(outcome.resourceId, "rs-9");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(calls[0].body, { name: "api.example.com.", type: "A", ttl: 300, records: ["203.0.113.10", "203.0.113.11"], description: "Edge" });
});

test("DNS recordset update resends fresh name/type and rejects stale or system recordsets", async (t) => {
  const calls = mockCloud(t, (url) => {
    if (url.pathname === "/v2/zones/zone-1/recordsets") return recordsetPage;
    if (url.pathname === "/v2/zones/zone-1/recordsets/rs-1") return { id: "rs-1", name: "www.example.com." };
    return { error_msg: "unexpected path" };
  });
  const zone = { id: "zone-1", name: "example.com.", status: "ACTIVE" };
  const outcome = await submit(dnsManagement, "update-recordset", { recordsetId: "rs-1", ttl: 600, records: ["203.0.113.99"] }, zone);
  assert.match(outcome.message, /updated/);
  assert.equal(outcome.resourceId, "rs-1");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init?.method ?? "GET", "GET");
  assert.equal(calls[2].init?.method, "PUT");
  assert.equal(calls[2].url.pathname, "/v2/zones/zone-1/recordsets/rs-1");
  assert.deepEqual(calls[2].body, { name: "www.example.com.", type: "A", ttl: 600, records: ["203.0.113.99"] });
  // A recordset that disappears between form validation and execution is refused, not deleted blindly.
  let reads = 0;
  mockCloud(t, (url) => {
    if (url.pathname !== "/v2/zones/zone-1/recordsets") return { error_msg: "unexpected path" };
    reads += 1;
    return reads === 1 ? recordsetPage : { metadata: { total_count: 0 }, recordsets: [] };
  });
  await assert.rejects(submit(dnsManagement, "update-recordset", { recordsetId: "rs-1", ttl: 600, records: ["203.0.113.99"] }, zone), /not found in this zone/);
  await assert.rejects(submit(dnsManagement, "update-recordset", { recordsetId: "gone", ttl: 600, records: ["203.0.113.99"] }, zone), /not available for this project/);
  mockCloud(t, () => recordsetPage);
  // Belt and braces: the adapter itself refuses system recordsets even if a raw submit bypassed form validation.
  await assert.rejects(dnsManagement.execute(session, "delete-recordset", { recordsetId: "soa-1" }, zone), /System recordsets/);
});

test("DNS recordset delete removes the selected recordset only", async (t) => {
  const calls = mockCloud(t, (url) => (url.pathname === "/v2/zones/zone-1/recordsets" ? recordsetPage : {}));
  const outcome = await submit(dnsManagement, "delete-recordset", { recordsetId: "rs-2" }, { id: "zone-1", name: "example.com.", status: "ACTIVE" });
  assert.equal(outcome.asynchronous, true);
  assert.equal(calls.at(-1)?.init?.method, "DELETE");
  assert.equal(calls.at(-1)?.url.pathname, "/v2/zones/zone-1/recordsets/rs-2");
});

test("DNS inspect lists recordsets including system entries", async (t) => {
  mockCloud(t, (url) => (url.pathname === "/v2/zones/zone-1/recordsets" ? recordsetPage : { error_msg: "unexpected path" }));
  const outcome = await submit(dnsManagement, "list-recordsets", {}, { id: "zone-1", name: "example.com.", status: "ACTIVE" });
  assert.match(outcome.message, /4 recordsets/);
  assert.ok(outcome.facts!.some((fact) => fact.label.includes("SOA") && fact.label.includes("system")));
  assert.ok(outcome.facts!.some((fact) => fact.label.startsWith("www.example.com.")));
});

const topicUrn = "urn:smn:sa-brazil-1:project-1:alerts";
const subscriptionsPage = (offset: number) => offset === 0
  ? { subscription_count: 2, subscriptions: [{ subscription_urn: `${topicUrn}:sub-1`, protocol: "email", endpoint: "oncall@example.com", status: 1 }] }
  : { subscription_count: 2, subscriptions: [{ subscription_urn: `${topicUrn}:sub-2`, protocol: "https", endpoint: "https://ops.example.com/hook", status: 0 }] };

test("SMN inventory identifies topics by URN and invalidates the canonical topic list", async (t) => {
  const calls = mockCloud(t, (url) => (url.pathname === `/v2/${project.projectId}/notifications/topics` ? { total_count: 1, topics: [{ topic_id: "t-1", name: "alerts", display_name: "Alerts", topic_urn: topicUrn }] } : { error_msg: "unexpected path" }));
  const topics = await smnManagement.inventory(session);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.hostname, "smn.test.invalid");
  assert.equal(new Headers(calls[0].init?.headers).get("X-Auth-Token"), project.token);
  assert.equal(topics.length, 1);
  assert.equal(topics[0].id, topicUrn);
  assert.equal(topics[0].name, "alerts");
  assert.equal(topics[0].values?.displayName, "Alerts");
  assert.deepEqual(smnManagement.invalidationKeys(), ["listSmnTopics"]);
});

test("SMN topic create, update, and delete follow the documented URN contract", async (t) => {
  const calls = mockCloud(t, () => ({ request_id: "r-1", topic_urn: "urn:smn:sa-brazil-1:project-1:ops-alerts" }));
  const created = await submit(smnManagement, "create-topic", { name: "ops-alerts", displayName: "Ops Alerts" });
  assert.equal(created.resourceId, "urn:smn:sa-brazil-1:project-1:ops-alerts");
  assert.equal(calls[0].url.pathname, `/v2/${project.projectId}/notifications/topics`);
  assert.deepEqual(calls[0].body, { name: "ops-alerts", display_name: "Ops Alerts" });
  const topic = { id: topicUrn, name: "alerts" };
  await submit(smnManagement, "update-topic", { displayName: "Prod Alerts" }, topic);
  assert.equal(calls[1].url.pathname, `/v2/${project.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}`);
  assert.deepEqual(calls[1].body, { display_name: "Prod Alerts" });
  await submit(smnManagement, "delete-topic", {}, topic);
  assert.equal(calls[2].init?.method, "DELETE");
  const createOperation = smnManagement.operations.find((operation) => operation.id === "create-topic")!;
  assert.throws(() => validateManagementValues(createOperation, { name: "no spaces", displayName: "X" }), /Topic name/);
});

test("SMN publish sends the documented body and reports the cloud message ID", async (t) => {
  const calls = mockCloud(t, () => ({ request_id: "r-2", message_id: "m-1" }));
  const outcome = await submit(smnManagement, "publish", {
    subject: "Deploy finished",
    message: "Release 1.2.3 is live.",
    messageStructure: '{"default":"Release 1.2.3 is live.","email":"Release 1.2.3 is live."}',
    timeToLive: 3600,
  }, { id: topicUrn, name: "alerts" });
  assert.equal(outcome.jobId, "m-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, `/v2/${project.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}/publish`);
  assert.deepEqual(calls[0].body, {
    message: "Release 1.2.3 is live.",
    subject: "Deploy finished",
    message_structure: '{"default":"Release 1.2.3 is live.","email":"Release 1.2.3 is live."}',
    time_to_live: "3600",
  });
});

test("SMN publish validates the JSON message structure before any network call", async (t) => {
  const calls = mockCloud(t, () => { throw new Error("should not publish"); });
  const topic = { id: topicUrn, name: "alerts" };
  await assert.rejects(submit(smnManagement, "publish", { message: "hi", messageStructure: "not json" }, topic), /valid JSON/);
  await assert.rejects(submit(smnManagement, "publish", { message: "hi", messageStructure: '{"email":"only email"}' }, topic), /default/);
  await assert.rejects(submit(smnManagement, "publish", { message: "hi", messageStructure: '{"default":"ok","ftp":"nope"}' }, topic), /not a supported message protocol key/);
  await assert.rejects(submit(smnManagement, "publish", { message: "hi", messageStructure: '{"default":"ok","sms":42}' }, topic), /must be non-empty text/);
  assert.equal(calls.length, 0);
});

test("SMN subscription listing paginates by offset and reports confirmation states", async (t) => {
  const calls = mockCloud(t, (url) => (url.pathname === `/v2/${project.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}/subscriptions` ? subscriptionsPage(Number(url.searchParams.get("offset"))) : { error_msg: "unexpected path" }));
  const outcome = await submit(smnManagement, "list-subscriptions", {}, { id: topicUrn, name: "alerts" });
  assert.match(outcome.message, /2 subscriptions/);
  assert.deepEqual(calls.map((call) => call.url.searchParams.get("offset")), ["0", "1"]);
  assert.ok(outcome.facts!.some((fact) => fact.value === "confirmed" && fact.label.includes("oncall@example.com")));
  assert.ok(outcome.facts!.some((fact) => fact.value === "awaiting confirmation"));
});

test("SMN subscription create enforces the protocol whitelist and per-protocol endpoints", async (t) => {
  const calls = mockCloud(t, () => ({ subscription_urn: `${topicUrn}:sub-9` }));
  const topic = { id: topicUrn, name: "alerts" };
  const created = await submit(smnManagement, "create-subscription", { protocol: "email", endpoint: "oncall@example.com", remark: "on-call" }, topic);
  assert.match(created.message, /Subscription created/);
  assert.equal(calls[0].url.pathname, `/v2/${project.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}/subscriptions`);
  assert.deepEqual(calls[0].body, { protocol: "email", endpoint: "oncall@example.com", remark: "on-call" });
  await assert.rejects(submit(smnManagement, "create-subscription", { protocol: "email", endpoint: "not-an-email" }, topic), /email address/);
  await assert.rejects(submit(smnManagement, "create-subscription", { protocol: "sms", endpoint: "13800000000" }, topic), /country code/);
  await assert.rejects(submit(smnManagement, "create-subscription", { protocol: "https", endpoint: "http://insecure.example.com" }, topic), /https:\/\//);
  const addOperation = smnManagement.operations.find((operation) => operation.id === "create-subscription")!;
  assert.throws(() => validateManagementValues(addOperation, { protocol: "ftp", endpoint: "x@y.z" }), /not available/);
  assert.equal(calls.length, 1);
});

test("SMN subscription delete validates the URN against a fresh list", async (t) => {
  const calls = mockCloud(t, (url) => {
    if (url.pathname === `/v2/${project.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}/subscriptions`) return subscriptionsPage(Number(url.searchParams.get("offset")));
    if (url.pathname === `/v2/${project.projectId}/notifications/subscriptions/${encodeURIComponent(`${topicUrn}:sub-2`)}`) return {};
    return { error_msg: "unexpected path" };
  });
  const sources = await smnManagement.options!(session, "delete-subscription", { id: topicUrn, name: "alerts" });
  assert.equal(sources.subscriptions?.length, 2);
  const outcome = await submit(smnManagement, "delete-subscription", { subscriptionUrn: `${topicUrn}:sub-2` }, { id: topicUrn, name: "alerts" });
  assert.match(outcome.message, /Subscription deleted/);
  const deleteCall = calls.find((call) => call.init?.method === "DELETE")!;
  assert.equal(deleteCall.url.pathname, `/v2/${project.projectId}/notifications/subscriptions/${encodeURIComponent(`${topicUrn}:sub-2`)}`);
  await assert.rejects(submit(smnManagement, "delete-subscription", { subscriptionUrn: "urn:smn:gone" }, { id: topicUrn, name: "alerts" }), /not found on this topic|not available/);
});

const groupFixture = { log_groups: [{ log_group_id: "group-1", log_group_name: "app-logs", ttl_in_days: 7, creation_time: 1710000000000, tag: [] }] };
const streamFixture = { log_streams: [{ log_stream_id: "stream-1", log_stream_name: "runtime", ttl_in_days: 7 }, { log_stream_id: "stream-2", log_stream_name: "audit", ttl_in_days: 14 }] };

test("LTS inventory loads groups with retention and invalidates the canonical group list", async (t) => {
  const calls = mockCloud(t, (url) => (url.pathname === `/v2/${project.projectId}/groups` ? groupFixture : { error_msg: "unexpected path" }));
  const groups = await ltsManagement.inventory(session);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.hostname, "lts.test.invalid");
  assert.equal(new Headers(calls[0].init?.headers).get("X-Auth-Token"), project.token);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "group-1");
  assert.equal(groups[0].values?.ttl, 7);
  assert.deepEqual(ltsManagement.invalidationKeys(), ["listLtsLogGroups"]);
});

test("LTS group create, update, and delete use the verified v2 endpoints", async (t) => {
  const calls = mockCloud(t, (url) => (url.pathname === `/v2/${project.projectId}/groups` ? { log_group_id: "group-2" } : {}));
  const created = await submit(ltsManagement, "create-group", { name: "new-logs", alias: "New logs", ttl: 14 });
  assert.equal(created.resourceId, "group-2");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(calls[0].body, { log_group_name: "new-logs", ttl_in_days: 14, log_group_name_alias: "New logs" });
  const group = { id: "group-1", name: "app-logs" };
  await submit(ltsManagement, "update-group", { ttl: 30 }, group);
  assert.equal(calls[1].init?.method, "POST");
  assert.equal(calls[1].url.pathname, `/v2/${project.projectId}/groups/group-1`);
  assert.deepEqual(calls[1].body, { ttl_in_days: 30 });
  await submit(ltsManagement, "delete-group", {}, group);
  assert.equal(calls[2].init?.method, "DELETE");
  const createOperation = ltsManagement.operations.find((operation) => operation.id === "create-group")!;
  assert.throws(() => validateManagementValues(createOperation, { name: "-leading", ttl: 7 }), /Group name/);
  assert.throws(() => validateManagementValues(createOperation, { name: "ok-name", ttl: 400 }), /whole number/);
});

test("LTS stream choices, creation, and inspection stay scoped to the parent group", async (t) => {
  const calls = mockCloud(t, (url, init) => (url.pathname === `/v2/${project.projectId}/groups/group-1/streams` ? init?.method === "POST" ? { log_stream_id: "stream-2" } : streamFixture : { error_msg: "unexpected path" }));
  const group = { id: "group-1", name: "app-logs" };
  const sources = await ltsManagement.options!(session, "update-stream", group);
  assert.equal(sources.streams?.length, 2);
  assert.equal(sources.streams?.[0].value, "stream-1");
  const outcome = await submit(ltsManagement, "list-streams", {}, group);
  assert.match(outcome.message, /2 log streams/);
  assert.ok(outcome.facts!.some((fact) => fact.label === "runtime" && fact.value.includes("retention 7 days")));
  const created = await submit(ltsManagement, "create-stream", { name: "ingress", alias: "Ingress", ttl: 30 }, group);
  assert.equal(created.resourceId, "stream-2");
  assert.deepEqual(calls.at(-1)?.body, { log_stream_name: "ingress", log_stream_name_alias: "Ingress", ttl_in_days: 30 });
});

test("LTS stream retention update and delete validate the stream against a fresh list", async (t) => {
  const calls = mockCloud(t, (url) => {
    if (url.pathname === `/v2/${project.projectId}/groups/group-1/streams`) return streamFixture;
    if (url.pathname === `/v2/${project.projectId}/groups/group-1/streams-ttl/stream-1`) return {};
    return { error_msg: "unexpected path" };
  });
  const group = { id: "group-1", name: "app-logs" };
  const updated = await submit(ltsManagement, "update-stream", { streamId: "stream-1", ttl: 14 }, group);
  assert.match(updated.message, /retention updated/);
  assert.equal(calls.at(-1)?.init?.method, "PUT");
  assert.equal(calls.at(-1)?.url.pathname, `/v2/${project.projectId}/groups/group-1/streams-ttl/stream-1`);
  assert.deepEqual(calls.at(-1)?.body, { ttl_in_days: 14 });
  mockCloud(t, () => streamFixture);
  const second = await submit(ltsManagement, "delete-stream", { streamId: "stream-2" }, group);
  assert.match(second.message, /deleted/);
  await assert.rejects(submit(ltsManagement, "update-stream", { streamId: "gone", ttl: 14 }, group), /not found in this group|not available/);
});

test("adapters reject unsupported operations and inspect needs no form values", async () => {
  await assert.rejects(submit(dnsManagement, "purge-zone", {}, { id: "zone-1", name: "example.com." }), /Unsupported operation/);
  await assert.rejects(submit(smnManagement, "restart", {}, { id: topicUrn, name: "alerts" }), /Unsupported operation/);
  await assert.rejects(submit(ltsManagement, "resize", {}, { id: "group-1", name: "app-logs" }), /Unsupported operation/);
  for (const adapter of [dnsManagement, smnManagement, ltsManagement]) {
    assert.ok(adapter.operations.every((operation) => ["create", "update", "delete", "action", "inspect"].includes(operation.kind)), adapter.title);
    assert.ok(adapter.operations.every((operation) => operation.kind === "create" || operation.kind === "inspect" || operation.fields.length > 0 || operation.confirmation), adapter.title);
  }
});
