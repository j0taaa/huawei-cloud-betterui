import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { eventgridManagement } from "@/lib/huawei/management/adapters/eventgrid";
import { session } from "./fixtures/session";
const channel = { id: "channel-1", name: "events", provider_type: "CUSTOM", enterprise_project_id: "0" };
const source = { id: "source-1", name: "orders", provider_type: "CUSTOM", channel_id: channel.id, type: "APPLICATION", status: "RUNNING", detail: { password: "private-credential" } };
const subscription = { id: "subscription-1", name: "delivery", status: "ENABLED", channel_id: channel.id, sources: [{ name: source.name, provider_type: "CUSTOM", filter: {} }], targets: [{ id: "target-1", name: "WEBHOOK", provider_type: "CUSTOM", detail: { url: "https://example.org/events?secret=value" }, retry_times: 3 }], used: [] as unknown[] };
const resource = (kind: string, id: string, name: string) => ({ id: `${kind}:${id}`, name });
function mock(t: TestContext, override: (url: URL) => unknown = () => undefined, result: Record<string, unknown> = { id: "created" }) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) { writes.push({ path: url.pathname, method: init.method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) }); return Response.json(result); }
    const own = override(url); if (own !== undefined) return Response.json(own);
    for (const [kind, item] of [["channels", channel], ["sources", source], ["subscriptions", subscription]] as const) {
      if (url.pathname.endsWith(`/${kind}`)) return Response.json({ total: 1, items: [item] });
      if (url.pathname.endsWith(`/${kind}/${item.id}`)) return Response.json(item);
    }
    throw new Error(`Unexpected EventGrid read ${url}`);
  }); return writes;
}
test("EventGrid creates custom channels with cross-account publishing disabled", async t => {
  const writes = mock(t);
  await assert.rejects(eventgridManagement.execute(session, "create-channel", { name: "default" }), /reserved/);
  const result = await eventgridManagement.execute(session, "create-channel", { name: "orders" });
  assert.deepEqual(writes[0], { path: "/v1/project-1/channels", method: "POST", body: { name: "orders", description: "", enterprise_project_id: "0", cross_account: false } });
  assert.equal(result.resourceId, "channels:created");
});
test("EventGrid fresh channel ownership and custom type are required for source creation", async t => {
  const writes = mock(t, url => url.pathname.endsWith("/channels/channel-1") ? { ...channel, provider_type: "OFFICIAL" } : undefined);
  await assert.rejects(eventgridManagement.execute(session, "create-source", { channel: channel.id, name: "app" }), /Only custom/);
  await assert.rejects(eventgridManagement.execute(session, "create-source", { channel: "foreign", name: "app" }), /no longer exists/);
  assert.equal(writes.length, 0);
});
test("EventGrid creates application sources with native channel associations", async t => {
  const writes = mock(t);
  const result = await eventgridManagement.execute(session, "create-source", { channel: channel.id, name: "app" });
  assert.deepEqual(writes[0].body, { name: "app", description: "", channel_id: channel.id, type: "APPLICATION" }); assert.equal(result.asynchronous, true);
});
test("EventGrid webhook subscriptions use original payloads and validate filters and destinations", async t => {
  const writes = mock(t);
  for (const url of ["http://example.org/events", "https://user:secret@example.org/events", "https://example.org/events#part", "invalid"]) await assert.rejects(eventgridManagement.execute(session, "create-subscription", { source: source.id, name: "delivery", filter: "{}", url }), /HTTPS/);
  for (const filter of ["bad", "[]", "null"]) await assert.rejects(eventgridManagement.execute(session, "create-subscription", { source: source.id, name: "delivery", filter, url: "https://example.org/events" }), /JSON/);
  assert.equal(writes.length, 0);
  await eventgridManagement.execute(session, "create-subscription", { source: source.id, name: "delivery", filter: '{"type":["order.created"]}', url: "https://example.org/events", retries: 3 });
  assert.deepEqual(writes[0].body, { name: "delivery", description: "", channel_id: channel.id, sources: [{ name: source.name, provider_type: "CUSTOM", filter: { type: ["order.created"] } }], targets: [{ name: "WEBHOOK", provider_type: "CUSTOM", detail: { url: "https://example.org/events" }, retry_times: 3, transform: { type: "ORIGINAL" } }] });
});
test("EventGrid metadata changes preserve sources, targets, credentials and policies", async t => {
  const writes = mock(t);
  for (const [kind, item, operation] of [["channels", channel, "update-channel"], ["sources", source, "update-source"], ["subscriptions", subscription, "update-subscription"]] as const) await eventgridManagement.execute(session, operation, { description: "" }, resource(kind, item.id, item.name));
  assert.ok(writes.every(w => w.method === "PUT")); assert.deepEqual(writes.map(w => w.body), [{ description: "" }, { description: "" }, { description: "" }]);
});
test("EventGrid inspection omits connection credentials and webhook secret URLs", async t => {
  mock(t);
  const outcome = await eventgridManagement.execute(session, "inspect", {}, resource("sources", source.id, source.name));
  assert.ok(!JSON.stringify(outcome).includes("private-credential"));
  const routed = await eventgridManagement.execute(session, "inspect", {}, resource("subscriptions", subscription.id, subscription.name));
  assert.ok(!JSON.stringify(routed).includes("secret=value"));
});
test("EventGrid deletion protects channels and sources with subscriptions", async t => {
  const writes = mock(t);
  await assert.rejects(eventgridManagement.execute(session, "delete", {}, resource("channels", channel.id, channel.name)), /sources and subscriptions/);
  await assert.rejects(eventgridManagement.execute(session, "delete", {}, resource("sources", source.id, source.name)), /subscription using/);
  assert.equal(writes.length, 0);
});
test("EventGrid refuses deleting subscriptions managed by another resource", async t => {
  const writes = mock(t, url => url.pathname.endsWith("/subscriptions/subscription-1") ? { ...subscription, used: [{ owner: "functiongraph", resource_id: "function-1" }] } : undefined);
  await assert.rejects(eventgridManagement.execute(session, "delete", {}, resource("subscriptions", subscription.id, subscription.name)), /another resource/); assert.equal(writes.length, 0);
});
test("EventGrid checks native batch results instead of treating HTTP 200 as success", async t => {
  const result: Record<string, unknown> = { failed_count: 1, events: [{ subscription_id: subscription.id, error_code: "denied" }] };
  mock(t, () => undefined, result);
  const selected = resource("subscriptions", subscription.id, subscription.name);
  await assert.rejects(eventgridManagement.execute(session, "enable", {}, selected), /rejected/);
  result.failed_count = 0; result.events = []; await assert.rejects(eventgridManagement.execute(session, "enable", {}, selected), /no verifiable/);
  result.events = [{ subscription_id: subscription.id }]; assert.match((await eventgridManagement.execute(session, "disable", {}, selected)).message, /disabled/);
});
test("EventGrid publishes native CloudEvents without returning payloads", async t => {
  const writes = mock(t, () => undefined, { failed_count: 0, events: [{ event_id: "order-123" }] });
  const outcome = await eventgridManagement.execute(session, "publish", { eventId: "order-123", eventType: "order.created", data: '{"customer":"private-data"}' }, resource("sources", source.id, source.name));
  const event = (writes[0].body as { events: Record<string, unknown>[] }).events[0];
  assert.equal(writes[0].path, "/v1/project-1/channels/channel-1/events"); assert.equal(event.source, source.name); assert.equal(event.specversion, "1.0"); assert.equal(event.datacontenttype, "application/json"); assert.deepEqual(event.data, { customer: "private-data" }); assert.match(String(event.time), /^\d{4}-.*Z$/);
  assert.ok(!JSON.stringify(outcome).includes("private-data")); assert.match(outcome.message, /does not confirm target delivery/);
});
