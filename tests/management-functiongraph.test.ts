import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { functionGraphManagement } from "@/lib/huawei/management/adapters/functiongraph";
import { updateFunctionGraphFunctionConfig } from "@/lib/huawei/services/functiongraph";
import { session } from "./fixtures/session";

const domain = session.projectId;
const urn = `urn:fss:${session.region}:${domain}:function:default:orders:latest`;
const baseUrn = `urn:fss:${session.region}:${domain}:function:default:orders`;
const billingUrn = `urn:fss:${session.region}:${domain}:function:default:billing:latest`;
const config = { func_urn: urn, func_name: "orders", package: "default", runtime: "Python3.9", timeout: 3, handler: "index.handler", memory_size: 128, code_type: "inline", code_size: 4096, code_filename: "index.py", code_url: "https://obs.example.invalid/private/package.zip", description: "Process orders", version: "latest", type: "v2", enterprise_project_id: "0", last_modified: "2026-01-01T00:00:00Z", user_data: "token=private-token", encrypted_user_data: "cipher-text", func_vpc: { vpc_id: "vpc-1", subnet_id: "subnet-1" }, mount_config: {}, strategy_config: { concurrency: 1, concurrent_num: 1 }, custom_image: { image: "swr.example.invalid/private/img:1" }, initializer_handler: "index.init", initializer_timeout: 3 };
const versionRow = { func_urn: `${baseUrn}:1.0.0`, version: "1.0.0", description: "First release", last_modified: "2026-01-02T00:00:00Z", code_size: 4096 };
const aliasRow = { name: "live", version: "1.0.0", description: "Live traffic", last_modified: "2026-01-03T00:00:00Z", alias_urn: `${baseUrn}:live` };
const timerTrigger = { trigger_id: "trigger-1", trigger_type_code: "TIMER", trigger_status: "ACTIVE", event_data: { name: "nightly", schedule_type: "Cron", schedule: "0 0 1 * *" }, created_time: "2026-01-04T00:00:00Z" };
const resource = { id: `function:${urn}`, name: "orders" };
type Cloud = { list?: unknown; config?: unknown; versions?: unknown; aliases?: unknown; triggers?: unknown; reserved?: unknown };

function cloud(t: TestContext, overrides: Cloud = {}, result: { body: Record<string, unknown> } = { body: { func_urn: urn } }) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) {
      assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
      writes.push({ path: url.pathname, method: init.method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return Response.json(result.body);
    }
    const path = url.pathname;
    if (path === `/v2/${session.projectId}/fgs/functions`) return Response.json(url.searchParams.get("marker") === "marker-2"
      ? { functions: [{ ...config, func_urn: billingUrn, func_name: "billing" }], next_marker: "", count: 2 }
      : overrides.list ?? { functions: [config], next_marker: "", count: 1 });
    if (path === `/v2/${session.projectId}/fgs/functions/reservedinstances`) return Response.json(overrides.reserved ?? { reservedinstances: [{ func_urn: urn, count: 0 }], page_info: { next_marker: 0 }, count: 1 });
    if (path === `/v2/${session.projectId}/fgs/functions/${urn}/config`) return Response.json(overrides.config ?? config);
    if (path === `/v2/${session.projectId}/fgs/functions/${urn}/versions`) return Response.json(overrides.versions ?? { versions: [versionRow], next_marker: "", count: 1 });
    if (path === `/v2/${session.projectId}/fgs/functions/${urn}/aliases`) return Response.json(overrides.aliases ?? [aliasRow]);
    if (path === `/v2/${session.projectId}/fgs/triggers/${baseUrn}:1.0.0`) return Response.json(overrides.triggers ?? []);
    if (path === `/v2/${session.projectId}/fgs/triggers/${urn}`) return Response.json(overrides.triggers ?? [timerTrigger]);
    throw new Error(`Unexpected FunctionGraph read ${path}`);
  });
  return writes;
}

test("FunctionGraph inventory paginates the native marker envelope and keeps original URNs", async (t) => {
  cloud(t, { list: { functions: [config], next_marker: "marker-2", count: 2 } });
  const resources = await functionGraphManagement.inventory(session);
  assert.deepEqual(resources.map((item) => item.name), ["orders", "billing"]);
  assert.equal(resources[0].id, `function:${urn}`);
  assert.equal(resources[0].values?.runtime, "Python3.9");
  assert.equal(resources[0].values?.memorySize, 128);
});

test("FunctionGraph inventory rejects malformed native list envelopes", async (t) => {
  cloud(t, { list: { functions: "corrupt" } });
  await assert.rejects(functionGraphManagement.inventory(session), /Invalid list response/);
});

test("FunctionGraph inline creation enforces byte limits, handlers, and duplicate names before writes", async (t) => {
  const writes = cloud(t);
  const base = { name: "orders", package: "default", runtime: "Python3.9", handler: "index.handler", memorySize: 128, timeout: 3 };
  await assert.rejects(functionGraphManagement.execute(session, "create", { ...base, code: "x".repeat(40961) }), /40 KB/);
  await assert.rejects(functionGraphManagement.execute(session, "create", { ...base, handler: "", code: "print(1)" }), /handler/);
  await assert.rejects(functionGraphManagement.execute(session, "create", { ...base, handler: "indexhandler", code: "print(1)" }), /file\.function/);
  await assert.rejects(functionGraphManagement.execute(session, "create", { ...base, memorySize: 9999, code: "print(1)" }), /memory/);
  await assert.rejects(functionGraphManagement.execute(session, "create", { ...base, code: "print(1)" }), /already exists/);
  assert.equal(writes.length, 0);
});

test("FunctionGraph inline creation sends the native payload and returns the original identity", async (t) => {
  const writes = cloud(t, {}, { body: { func_urn: billingUrn } });
  const result = await functionGraphManagement.execute(session, "create", { name: "billing", package: "default", runtime: "Node.js20.15", handler: "index.handler", memorySize: 256, timeout: 30, code: "exports.handler = async () => ({})", description: "Billing jobs", enterpriseProjectId: "0" });
  assert.deepEqual(writes[0], { path: `/v2/${session.projectId}/fgs/functions`, method: "POST", body: { func_name: "billing", package: "default", runtime: "Node.js20.15", timeout: 30, memory_size: 256, code_type: "inline", func_code: { file: Buffer.from("exports.handler = async () => ({})", "utf8").toString("base64"), link: "" }, description: "Billing jobs", type: "v2", enterprise_project_id: "0", handler: "index.handler" } });
  assert.equal(result.resourceId, `function:${billingUrn}`);
  assert.match(result.message, /does not invoke/);
});

test("FunctionGraph inline creation rejects binary/image runtimes and retains uncertain acknowledgements", async t => {
  const writes = cloud(t, {}, { body: {} });
  for (const runtime of ["http", "Custom Image", "Java17", "Go1.x"]) await assert.rejects(functionGraphManagement.execute(session, "create", { name: "billing", package: "default", runtime, memorySize: 128, timeout: 3, code: "ok" }), /supported runtime/);
  assert.deepEqual(writes, []);
  await assert.rejects(functionGraphManagement.execute(session, "create", { name: "billing", package: "default", runtime: "Python3.12", handler: "index.handler", memorySize: 128, timeout: 3, code: "ok" }), /no verifiable identity/);
  assert.equal(writes.length, 1);
});

test("FunctionGraph inspection whitelists configuration and never exposes private values", async (t) => {
  cloud(t);
  const outcome = await functionGraphManagement.execute(session, "inspect", {}, resource);
  assert.ok(outcome.facts?.some((fact) => fact.label === "Runtime" && fact.value === "Python3.9"));
  assert.ok(outcome.facts?.some((fact) => fact.label === "Memory" && fact.value === "128 MB"));
  assert.ok(outcome.facts?.some((fact) => fact.label === "Network" && fact.value === "VPC attached"));
  const serialized = JSON.stringify(outcome);
  for (const secret of ["private-token", "cipher-text", "obs.example.invalid", "swr.example.invalid", "index.py"]) assert.ok(!serialized.includes(secret), secret);
});

test("FunctionGraph configuration updates round-trip every native setting", async (t) => {
  const writes = cloud(t);
  await functionGraphManagement.execute(session, "update", { description: "Updated", timeout: 10, memorySize: 256 }, resource);
  assert.equal(writes[0].path, `/v2/${session.projectId}/fgs/functions/${urn}/config`);
  assert.equal(writes[0].method, "PUT");
  const body = writes[0].body as Record<string, unknown>;
  assert.equal(body.user_data, "token=private-token");
  assert.equal(body.encrypted_user_data, "cipher-text");
  assert.deepEqual(body.func_vpc, { vpc_id: "vpc-1", subnet_id: "subnet-1" });
  assert.deepEqual(body.strategy_config, { concurrency: 1, concurrent_num: 1 });
  assert.equal(body.func_name, "orders");
  assert.equal(body.handler, "index.handler");
  assert.equal(body.runtime, "Python3.9");
  assert.equal(body.description, "Updated");
  assert.equal(body.timeout, 10);
  assert.equal(body.memory_size, 256);
});

test("FunctionGraph updates refuse masked private settings, foreign configurations, and incomplete read-backs", async (t) => {
  const overrides: Cloud = { config: { ...config, user_data: "******" } };
  const writes = cloud(t, overrides);
  await assert.rejects(functionGraphManagement.execute(session, "update", { description: "Updated", timeout: 10, memorySize: 128 }, resource), /masked/);
  overrides.config = { ...config, func_urn: billingUrn };
  await assert.rejects(functionGraphManagement.execute(session, "update", { description: "Updated", timeout: 10, memorySize: 128 }, resource), /different function's configuration/);
  overrides.config = { ...config, runtime: undefined };
  await assert.rejects(functionGraphManagement.execute(session, "update", { description: "Updated", timeout: 10, memorySize: 128 }, resource), /incomplete function configuration/);
  assert.equal(writes.length, 0);
});

test("FunctionGraph version listing stays scoped to the selected function", async (t) => {
  const overrides: Cloud = {};
  cloud(t, overrides);
  const outcome = await functionGraphManagement.execute(session, "versions", {}, resource);
  assert.match(outcome.message, /1 published version/);
  assert.equal(outcome.facts?.[0]?.label, "1.0.0 · 2026-01-02T00:00:00Z");
  overrides.versions = { versions: [{ ...versionRow, func_urn: `urn:fss:${session.region}:${domain}:function:default:billing:1.0.0` }], next_marker: "", count: 1 };
  await assert.rejects(functionGraphManagement.execute(session, "versions", {}, resource), /does not belong/);
});

test("FunctionGraph version publishing checks ownership and native confirmation", async (t) => {
  const result: { body: Record<string, unknown> } = { body: { func_urn: `${baseUrn}:2.0.0` } };
  const writes = cloud(t, {}, result);
  await assert.rejects(functionGraphManagement.execute(session, "publish-version", { version: "1.0.0", description: "" }, resource), /already published/);
  assert.equal(writes.length, 0);
  await functionGraphManagement.execute(session, "publish-version", { version: "2.0.0", description: "Second" }, resource);
  assert.deepEqual(writes[0], { path: `/v2/${session.projectId}/fgs/functions/${urn}/versions`, method: "POST", body: { version: "2.0.0", description: "Second" } });
  result.body = { func_urn: urn };
  await assert.rejects(functionGraphManagement.execute(session, "publish-version", { version: "2.0.0", description: "" }, resource), /no verifiable confirmation/);
  assert.equal(writes.length, 2);
});

test("FunctionGraph alias options only offer versions and aliases owned by the function", async (t) => {
  cloud(t);
  const options = await functionGraphManagement.options!(session, "update-alias", resource);
  assert.deepEqual(options.versions, [{ value: "1.0.0", label: "1.0.0" }]);
  assert.deepEqual(options.aliases, [{ value: "live", label: "live → 1.0.0" }]);
  assert.deepEqual(await functionGraphManagement.options!(session, "create", resource), {});
});

test("FunctionGraph alias lifecycle enforces owned versions and current aliases", async (t) => {
  const result: { body: Record<string, unknown> } = { body: { name: "stage", version: "1.0.0", alias_urn: `${baseUrn}:stage` } };
  const writes = cloud(t, {}, result);
  await assert.rejects(functionGraphManagement.execute(session, "create-alias", { name: "stage", version: "9.9.9", description: "" }, resource), /version published by this function/);
  await assert.rejects(functionGraphManagement.execute(session, "create-alias", { name: "live", version: "1.0.0", description: "" }, resource), /already has an alias/);
  assert.equal(writes.length, 0);
  await functionGraphManagement.execute(session, "create-alias", { name: "stage", version: "1.0.0", description: "Staging" }, resource);
  assert.deepEqual(writes[0], { path: `/v2/${session.projectId}/fgs/functions/${urn}/aliases`, method: "POST", body: { name: "stage", version: "1.0.0", description: "Staging" } });
  result.body = { name: "live", version: "1.0.0", alias_urn: `${baseUrn}:live` };
  await assert.rejects(functionGraphManagement.execute(session, "update-alias", { alias: "ghost", version: "1.0.0", description: "" }, resource), /no longer exists/);
  await assert.rejects(functionGraphManagement.execute(session, "update-alias", { alias: "live", version: "9.9.9", description: "" }, resource), /version published by this function/);
  await functionGraphManagement.execute(session, "update-alias", { alias: "live", version: "1.0.0", description: "Retargeted" }, resource);
  assert.deepEqual(writes[1], { path: `/v2/${session.projectId}/fgs/functions/${urn}/aliases/live`, method: "PUT", body: { version: "1.0.0", description: "Retargeted" } });
  await assert.rejects(functionGraphManagement.execute(session, "delete-alias", { alias: "ghost" }, resource), /no longer exists/);
  result.body = {};
  await functionGraphManagement.execute(session, "delete-alias", { alias: "live" }, resource);
  assert.deepEqual(writes[2], { path: `/v2/${session.projectId}/fgs/functions/${urn}/aliases/live`, method: "DELETE" });
});

test("FunctionGraph alias listing refuses foreign alias data", async (t) => {
  const overrides: Cloud = { aliases: [{ ...aliasRow, alias_urn: `urn:fss:${session.region}:${domain}:function:default:billing:live` }] };
  cloud(t, overrides);
  await assert.rejects(functionGraphManagement.execute(session, "aliases", {}, resource), /does not belong/);
});

test("FunctionGraph maximum instances use native bounds and verified identity", async (t) => {
  const result: { body: Record<string, unknown> } = { body: { func_urn: urn } };
  const writes = cloud(t, {}, result);
  await assert.rejects(functionGraphManagement.execute(session, "max-instances", { maxInstances: 1001 }, resource), /-1/);
  await assert.rejects(functionGraphManagement.execute(session, "max-instances", { maxInstances: -2 }, resource), /-1/);
  assert.equal(writes.length, 0);
  const outcome = await functionGraphManagement.execute(session, "max-instances", { maxInstances: 16 }, resource);
  assert.deepEqual(writes[0], { path: `/v2/${session.projectId}/fgs/functions/${urn}/config-max-instance`, method: "PUT", body: { max_instance_num: 16 } });
  assert.match(outcome.message, /16/);
  result.body = {};
  await assert.rejects(functionGraphManagement.execute(session, "max-instances", { maxInstances: 0 }, resource), /no verifiable confirmation/);
  assert.equal(writes.length, 2);
});

test("FunctionGraph timer triggers use the verified native TIMER schema without leaking event data", async (t) => {
  const result: { body: Record<string, unknown> } = { body: { trigger_id: "trigger-2", trigger_type_code: "TIMER", trigger_status: "ACTIVE", event_data: { name: "hourly", schedule_type: "Rate", schedule: "1h" } } };
  const writes = cloud(t, {}, result);
  await assert.rejects(functionGraphManagement.execute(session, "create-timer", { name: "hourly", scheduleType: "Rate", schedule: "61m", timerStatus: "ACTIVE" }, resource), /1-60 minutes/);
  await assert.rejects(functionGraphManagement.execute(session, "create-timer", { name: "hourly", scheduleType: "Rate", schedule: "3x", timerStatus: "ACTIVE" }, resource), /1-60 minutes/);
  await assert.rejects(functionGraphManagement.execute(session, "create-timer", { name: "hourly", scheduleType: "Cron", schedule: "bad", timerStatus: "ACTIVE" }, resource), /cron expression/);
  await assert.rejects(functionGraphManagement.execute(session, "create-timer", { name: "nightly", scheduleType: "Cron", schedule: "0 0 1 * *", timerStatus: "ACTIVE" }, resource), /already has a timer/);
  assert.equal(writes.length, 0);
  const outcome = await functionGraphManagement.execute(session, "create-timer", { name: "hourly", scheduleType: "Rate", schedule: "1h", timerStatus: "ACTIVE", userEvent: "private-event-payload" }, resource);
  assert.deepEqual(writes[0], { path: `/v2/${session.projectId}/fgs/triggers/${urn}`, method: "POST", body: { trigger_type_code: "TIMER", trigger_status: "ACTIVE", event_data: { name: "hourly", schedule_type: "Rate", schedule: "1h", user_event: "private-event-payload" } } });
  assert.ok(!JSON.stringify(outcome).includes("private-event-payload"));
  result.body = { trigger_type_code: "APIG", event_data: {} };
  await assert.rejects(functionGraphManagement.execute(session, "create-timer", { name: "minutely", scheduleType: "Rate", schedule: "1m", timerStatus: "DISABLED" }, resource), /no verifiable confirmation/);
  assert.equal(writes.length, 2);
});

test("FunctionGraph whole-function deletion is guarded by current triggers, aliases, and reserved capacity", async (t) => {
  const overrides: Cloud = {};
  const writes = cloud(t, overrides);
  await assert.rejects(functionGraphManagement.execute(session, "delete", {}, resource), /trigger/);
  overrides.triggers = [];
  await assert.rejects(functionGraphManagement.execute(session, "delete", {}, resource), /alias/);
  overrides.aliases = [];
  overrides.reserved = { reservedinstances: [{ func_urn: urn, count: 2 }], page_info: { next_marker: 0 }, count: 1 };
  await assert.rejects(functionGraphManagement.execute(session, "delete", {}, resource), /reserved instance/);
  overrides.reserved = { reservedinstances: [], page_info: { next_marker: 0 }, count: 0 };
  await functionGraphManagement.execute(session, "delete", {}, resource);
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/fgs/functions/${baseUrn}`, method: "DELETE" }]);
});

test("FunctionGraph deletion refuses unverifiable dependent data before any write", async (t) => {
  const overrides: Cloud = { triggers: [], aliases: [] };
  const writes = cloud(t, overrides);
  overrides.reserved = { reservedinstances: [{ func_urn: urn, count: 1 }], page_info: { next_marker: 0 }, count: 2 };
  await assert.rejects(functionGraphManagement.execute(session, "delete", {}, resource), /incomplete reserved instance list/);
  overrides.reserved = { reservedinstances: [], page_info: { next_marker: 0 }, count: 0 };
  overrides.versions = { versions: "corrupt" };
  await assert.rejects(functionGraphManagement.execute(session, "delete", {}, resource), /Invalid list response/);
  assert.equal(writes.length, 0);
});

test("FunctionGraph operations revalidate the selected function in the current project and region", async (t) => {
  const overrides: Cloud = {};
  const writes = cloud(t, overrides);
  await assert.rejects(functionGraphManagement.execute(session, "inspect", {}, { id: `function:${baseUrn}:ghost:latest`, name: "ghost" }), /no longer exists/);
  overrides.list = { functions: [{ ...config, func_urn: `urn:fss:eu-west-101:${domain}:function:default:orders:latest` }], next_marker: "", count: 1 };
  await assert.rejects(functionGraphManagement.execute(session, "inspect", {}, { id: `function:urn:fss:eu-west-101:${domain}:function:default:orders:latest`, name: "orders" }), /unverified FunctionGraph inventory/);
  overrides.list = { functions: [{ func_urn: "not-a-urn", func_name: "orders" }], next_marker: "", count: 1 };
  await assert.rejects(functionGraphManagement.execute(session, "inspect", {}, { id: "function:not-a-urn", name: "orders" }), /unverified FunctionGraph inventory/);
  assert.equal(writes.length, 0);
});

test("FunctionGraph rejects unsupported operations and missing selections", async (t) => {
  cloud(t);
  await assert.rejects(functionGraphManagement.execute(session, "invoke", {}, resource), /Unsupported FunctionGraph operation/);
  await assert.rejects(functionGraphManagement.execute(session, "inspect", {}), /Select a FunctionGraph function/);
});

test("FunctionGraph same-region foreign project URNs and malformed identities fail closed", async t => {
  const overrides: Cloud = {}, writes = cloud(t, overrides);
  for (const functions of [[{ ...config, func_urn: urn.replace(domain, "foreign-project") }], [{ func_name: "hidden" }], [config, config]]) {
    overrides.list = { functions, count: functions.length, next_marker: "" };
    await assert.rejects(functionGraphManagement.execute(session, "delete", {}, resource), /unverified FunctionGraph inventory/);
  }
  assert.deepEqual(writes, []);
});

test("nested masked configuration and unavailable environment values prevent partial edits", async t => {
  const overrides: Cloud = {}, writes = cloud(t, overrides);
  overrides.config = { ...config, custom_image: { auth: { password: "********" } } };
  await assert.rejects(functionGraphManagement.execute(session, "update", { description: "Changed", timeout: 3, memorySize: 128 }, resource), /masked/);
  const { user_data: _userData, encrypted_user_data: _encryptedData, ...missing } = config;
  void _userData;void _encryptedData;
  overrides.config = missing;
  await assert.rejects(functionGraphManagement.execute(session, "update", { description: "Changed", timeout: 3, memorySize: 128 }, resource), /environment settings were not returned/);
  assert.deepEqual(writes, []);
});

test("weighted alias routing cannot silently disappear when retargeting", async t => {
  const writes = cloud(t, { aliases: [{ ...aliasRow, additional_version_weights: { "2.0.0": 0.2 } }] });
  await assert.rejects(functionGraphManagement.execute(session, "update-alias", { alias: "live", version: "1.0.0" }, resource), /weighted version routing/);
  assert.deepEqual(writes, []);
});

test("individual version deletion uses the original qualified URN and protects latest and aliases", async t => {
  const overrides: Cloud = { aliases: [], triggers: [], reserved: { reservedinstances: [], count: 0 } }, writes = cloud(t, overrides, { body: {} });
  assert.deepEqual((await functionGraphManagement.options!(session, "delete-version", resource)).versions, [{ value: "1.0.0", label: "1.0.0" }]);
  await assert.rejects(functionGraphManagement.execute(session, "delete-version", { version: "latest" }, resource), /latest version cannot/);
  await assert.rejects(functionGraphManagement.execute(session, "delete-version", { version: "gone" }, resource), /no longer exists/);
  overrides.aliases = [{ ...aliasRow, version: "2.0.0", additional_version_weights: { "1.0.0": 0.1 } }];
  await assert.rejects(functionGraphManagement.execute(session, "delete-version", { version: "1.0.0" }, resource), /Remove aliases/);
  overrides.aliases = [];
  await functionGraphManagement.execute(session, "delete-version", { version: "1.0.0" }, resource);
  assert.deepEqual(writes, [{ path: `/v2/${session.projectId}/fgs/functions/${versionRow.func_urn}`, method: "DELETE" }]);
});

test("malformed reserved capacity and aliases cannot disappear from deletion prerequisites", async t => {
  const overrides: Cloud = { aliases: [], triggers: [] }, writes = cloud(t, overrides);
  for (const row of [{ count: 0 }, { func_urn: urn, count: "unknown" }, { func_urn: urn.replace(domain, "foreign-project"), count: 0 }]) {
    overrides.reserved = { reservedinstances: [row], count: 1 };
    await assert.rejects(functionGraphManagement.execute(session, "delete", {}, resource), /unverified reserved capacity/);
  }
  overrides.reserved = { reservedinstances: [], count: 0 };
  overrides.aliases = [{ name: "hidden", version: "1.0.0" }];
  await assert.rejects(functionGraphManagement.execute(session, "delete", {}, resource), /alias that does not belong/);
  assert.deepEqual(writes, []);
});

test("whole function deletion checks triggers on published versions too", async t => {
  const writes: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    if (init.method) { writes.push(init.method);return Response.json({}); }
    if (path.endsWith("/fgs/functions")) return Response.json({ functions: [config], count: 1 });
    if (path.endsWith("/versions")) return Response.json({ versions: [versionRow], count: 1 });
    if (path.endsWith(`/triggers/${urn}`)) return Response.json([]);
    if (path.endsWith(`/triggers/${versionRow.func_urn}`)) return Response.json([timerTrigger]);
    throw new Error("Unexpected read");
  });
  await assert.rejects(functionGraphManagement.execute(session, "delete", {}, resource), /version still has 1 trigger/);
  assert.deepEqual(writes, []);
});

test("timers default disabled and use the native seconds-first cron format and time zone", async t => {
  const result = { body: { trigger_id: "timer-new", trigger_type_code: "TIMER", trigger_status: "DISABLED", event_data: { name: "weekly", schedule_type: "Cron", schedule: "CRON_TZ=Asia/Shanghai 0 0 12 ? * MON-FRI" } } }, writes = cloud(t, {}, result);
  const base = { name: "weekly", scheduleType: "Cron" };
  for (const schedule of ["60 0 12 * * *", "0 0 24 * * *", "0 0 12 0 * *", "0 0 12 * 13 *", "0 0 12 ? * ?", "CRON_TZ=Invalid/Zone 0 0 12 * * *"]) await assert.rejects(functionGraphManagement.execute(session, "create-timer", { ...base, schedule }, resource), /cron expression/);
  await functionGraphManagement.execute(session, "create-timer", { ...base, schedule: result.body.event_data.schedule }, resource);
  assert.equal((writes[0].body as { trigger_status: string }).trigger_status, "DISABLED");
  assert.equal(functionGraphManagement.operations.find(operation => operation.id === "create-timer")!.fields.find(field => field.key === "timerStatus")!.defaultValue, "DISABLED");
});

test("legacy configuration edits preserve environment values, advanced settings, and concurrency options", async t => {
  const writes: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    if (init?.method === "PUT") { const body = JSON.parse(String(init.body));writes.push(body);return Response.json({ ...config, ...body }); }
    if (path.endsWith("/fgs/functions")) return Response.json({ functions: [config], count: 1 });
    if (path.endsWith("/code")) return Response.json({});
    if (path.endsWith("/config")) return Response.json({ ...config, strategy_config: { concurrency: 1, concurrent_num: 8, other_option: true }, pre_stop_handler: "index.stop" });
    throw new Error("Unexpected read");
  });
  await updateFunctionGraphFunctionConfig(session, urn, { description: "Changed", strategyConcurrency: 2 });
  assert.equal(writes[0].user_data, config.user_data);
  assert.equal(writes[0].encrypted_user_data, config.encrypted_user_data);
  assert.deepEqual(writes[0].strategy_config, { concurrency: 2, concurrent_num: 8, other_option: true });
  assert.equal(writes[0].pre_stop_handler, "index.stop");
  assert.deepEqual(writes[0].func_vpc, config.func_vpc);
  await updateFunctionGraphFunctionConfig(session, urn, { userData: "" });
  assert.equal(writes[1].user_data, "");
});
