import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import type { ManagementHistoryEntry } from "@/lib/management-contract";
import { CloudLoadError } from "@/lib/huawei/errors";
import { flexusManagement } from "@/lib/huawei/management/adapters/flexus";
import { listFlexusResources, type FlexusResource } from "@/lib/huawei/services/flexus";
import {
  flexusUpdateFingerprint,
  listNativeFlexusLInstances,
  listNativeFlexusXInstances,
  parseFlexusResourceId,
} from "@/lib/huawei/services/flexus-native";
import { project, session as baseSession } from "./fixtures/session";

const session = { ...baseSession, accountToken: "account-token" };
const domainId = "domain-1";
const rmsBase = "https://rms.myhuaweicloud.com";
const hcssBase = "https://hcss.sa-brazil-1.myhuaweicloud.com";
const ecsBase = "https://ecs.sa-brazil-1.myhuaweicloud.com";

const lBundle = {
  id: "bundle-1",
  name: "l-web",
  provider: "hcss",
  type: "l-instance",
  region_id: "sa-brazil-1",
  project_id: "project-1",
  properties: {
    resources: [{ logical_resource_type: "huaweicloudinternal_ecs_instance", physical_resource_id: "server-l-1" }],
    metadata: { charging_mode: "prePaid" },
  },
};

function rmsPage(rows: unknown[], nextMarker: string | null = null) {
  return { resources: rows, page_info: { current_count: rows.length, next_marker: nextMarker } };
}

function lServer(overrides: Record<string, unknown> = {}, metadataOverrides: Record<string, unknown> = {}) {
  return {
    id: "server-l-1",
    name: "l-web",
    status: "SHUTOFF",
    tenant_id: "project-1",
    locked: false,
    "OS-EXT-STS:task_state": null,
    "OS-EXT-AZ:availability_zone": "az-1",
    flavor: { name: "l.instance.2v2g.c7h", vcpus: "2", ram: "2048" },
    description: "",
    hostname: "l-web",
    metadata: { lockSource: "hcss", lockSourceId: "bundle-1", charging_mode: "1", ...metadataOverrides },
    tags: { _sys_type_hcss_l: "1" },
    ...overrides,
  };
}

const xServer = { id: "server-x-1", name: "x-app", status: "ACTIVE", tenant_id: "project-1", flavor: { name: "x1.2u.4g", vcpus: "2", ram: "4096" } };

function xServerDetail(overrides: Record<string, unknown> = {}) {
  return { ...xServer, status: "SHUTOFF", locked: false, "OS-EXT-STS:task_state": null, metadata: {}, ...overrides };
}

const lResource = { id: "l:bundle-1:server-l-1", name: "l-web" };
const xResource = { id: "x:server-x-1", name: "x-app" };

type Capture = { url: string; search: string; method: string; body?: unknown; headers: Record<string, string> };

function mock(t: TestContext, handle: (url: URL, init: RequestInit) => unknown = defaultHandle) {
  const writes: Capture[] = [];
  const reads: Capture[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const capture: Capture = {
      url: `${url.origin}${url.pathname}`,
      search: url.search,
      method: init.method ?? "GET",
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    };
    const isWrite = capture.method !== "GET";
    (isWrite ? writes : reads).push(capture);
    const result = handle(url, init);
    const response = result !== undefined ? result : defaultHandle(url, init);
    if (response === undefined) throw new Error(`Unexpected Flexus ${isWrite ? "write" : "read"} ${url}`);
    return response instanceof Response ? response : Response.json(response);
  });
  return { writes, reads };
}

function defaultHandle(url: URL, init: RequestInit): unknown {
  if (url.origin === "https://iam.example.invalid" && url.pathname === "/v3/auth/tokens") {
    return { token: { domain: { id: domainId }, user: { id: "user-1", domain: { id: domainId } } } };
  }
  if (url.origin === rmsBase && url.pathname === `/v1/resource-manager/domains/${domainId}/all-resources`) return rmsPage([lBundle]);
  if (url.origin === hcssBase && url.pathname === "/v1/project-1/cloudservers/server-l-1") return { server: lServer() };
  if (url.origin === ecsBase && url.pathname === "/v1/project-1/cloudservers/detail") return { servers: [xServer] };
  if (url.origin === ecsBase && url.pathname === "/v1/project-1/cloudservers/server-x-1") return { server: xServerDetail() };
  if (init.method === "POST" && url.pathname.endsWith("/cloudservers/action")) return { job_id: "job-1" };
  if (init.method === "PUT" && url.pathname.endsWith("/os-reset-password")) return {};
  if (init.method === "PUT" && /\/cloudservers\/[^/]+$/.test(url.pathname)) {
    return { server: { id: url.pathname.split("/").at(-1), tenant_id: "project-1" } };
  }
  if (url.pathname.endsWith("/jobs/job-1")) return { status: "SUCCESS", job_id: "job-1", entities: { server_id: "server-l-1" } };
  return undefined;
}

function historyEntry(overrides: Partial<ManagementHistoryEntry> = {}): ManagementHistoryEntry {
  return {
    id: "request-1",
    service: "flexus",
    projectId: session.projectId,
    operation: "Start server",
    resourceId: "l:bundle-1:server-l-1",
    startedAt: "2026-01-01T00:00:00Z",
    state: "submitted",
    jobId: "job-1",
    ...overrides,
  };
}

test("Flexus L inventory proves the account token and domain on the native RMS wire", async t => {
  const { reads } = mock(t);
  const instances = await listNativeFlexusLInstances(session);
  assert.equal(reads[0].url, "https://iam.example.invalid/v3/auth/tokens");
  assert.equal(reads[0].headers["x-subject-token"], "account-token");
  assert.equal(reads[1].url, `${rmsBase}/v1/resource-manager/domains/${domainId}/all-resources`);
  assert.equal(reads[1].headers["x-auth-token"], "account-token");
  const query = new URLSearchParams(reads[1].search);
  assert.equal(query.get("type"), "hcss.l-instance");
  assert.equal(query.get("region_id"), "sa-brazil-1");
  assert.equal(query.get("limit"), "100");
  assert.deepEqual(instances, [
    { bundleId: "bundle-1", serverId: "server-l-1", name: "l-web", projectId: "project-1", region: "sa-brazil-1", chargingMode: "prePaid" },
  ]);
});

test("Flexus L inventory rejects sign-ins without an account token", async t => {
  mock(t);
  await assert.rejects(listNativeFlexusLInstances({ ...session, accountToken: undefined }), /account token/);
});

test("Flexus L inventory rejects a token whose user domain differs from the scoped domain", async t => {
  mock(t, url =>
    url.pathname === "/v3/auth/tokens"
      ? { token: { domain: { id: domainId }, user: { id: "user-1", domain: { id: "domain-other" } } } }
      : undefined,
  );
  await assert.rejects(listNativeFlexusLInstances(session), /IAM domain/);
});

test("Flexus L inventory rejects a token for a different current user", async t => {
  mock(t, url =>
    url.pathname === "/v3/auth/tokens"
      ? { token: { domain: { id: domainId }, user: { id: "user-2", domain: { id: domainId } } } }
      : undefined,
  );
  await assert.rejects(listNativeFlexusLInstances(session), /IAM domain/);
});

test("Flexus L inventory rejects project-scoped tokens because the account plane needs an unscoped account token", async t => {
  mock(t, url =>
    url.pathname === "/v3/auth/tokens"
      ? { token: { project: null, domain: { id: domainId }, user: { id: "user-1", domain: { id: domainId } } } }
      : undefined,
  );
  await assert.rejects(listNativeFlexusLInstances(session), /scoped to a project/);
  mock(t, url =>
    url.pathname === "/v3/auth/tokens"
      ? { token: { project: { id: "project-1" }, domain: { id: domainId }, user: { id: "user-1", domain: { id: domainId } } } }
      : undefined,
  );
  await assert.rejects(listNativeFlexusLInstances(session), /scoped to a project/);
});

test("Flexus L inventory requires the native resources array on every page", async t => {
  mock(t, url => (url.pathname.endsWith("/all-resources") ? { page_info: { current_count: 0, next_marker: null } } : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /no Flexus L resource array/);
});

test("Flexus L inventory requires a numeric current_count equal to the page", async t => {
  mock(t, url => (url.pathname.endsWith("/all-resources") ? { resources: [lBundle], page_info: { current_count: 5, next_marker: null } } : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /current_count/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? { resources: [lBundle], page_info: { current_count: "1", next_marker: null } } : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /current_count/);
});

test("Flexus L inventory pages strictly on next_marker without any total and rejects repeated markers", async t => {
  let page = 0;
  const bundle2 = { ...lBundle, id: "bundle-2", name: "l-web-2", properties: { ...lBundle.properties, resources: [{ logical_resource_type: "huaweicloudinternal_ecs_instance", physical_resource_id: "server-l-2" }] } };
  const bundle3 = { ...bundle2, id: "bundle-3", properties: { ...lBundle.properties, resources: [{ logical_resource_type: "huaweicloudinternal_ecs_instance", physical_resource_id: "server-l-3" }] } };
  const { reads } = mock(t, url => {
    if (!url.pathname.endsWith("/all-resources")) return undefined;
    page += 1;
    return page === 1 ? rmsPage([lBundle, bundle2], "m2") : rmsPage([bundle3], null);
  });
  const instances = await listNativeFlexusLInstances(session);
  assert.equal(instances.length, 3);
  assert.equal(page, 2);
  const rmsReads = reads.filter((read) => read.url.includes("/all-resources"));
  assert.equal(new URLSearchParams(rmsReads[0].search).get("marker"), null);
  assert.equal(new URLSearchParams(rmsReads[1].search).get("marker"), "m2");
  let pageAgain = 0;
  mock(t, url => {
    if (!url.pathname.endsWith("/all-resources")) return undefined;
    pageAgain += 1;
    return pageAgain === 1 ? rmsPage([lBundle], "m2") : rmsPage([], "m2");
  });
  await assert.rejects(listNativeFlexusLInstances(session), /repeated a Flexus L pagination marker/);
});

test("Flexus L inventory filters foreign-project bundles instead of failing the regional catalog", async t => {
  const foreign = { ...lBundle, id: "bundle-foreign", project_id: "project-other" };
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([foreign, lBundle]) : undefined));
  const instances = await listNativeFlexusLInstances(session);
  assert.deepEqual(instances.map((instance) => instance.bundleId), ["bundle-1"]);
});

test("Flexus L inventory rejects rows outside the verified provider, type, or region", async t => {
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, provider: "ecs" }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /provider or type/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, type: "l-instance-x" }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /provider or type/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, region_id: "eu-west-101" }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /outside the selected region/);
});

test("Flexus L inventory validates provider and region on foreign-project rows too", async t => {
  const foreign = { ...lBundle, id: "bundle-foreign", project_id: "project-other", region_id: "eu-west-101" };
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([foreign]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /outside the selected region/);
  const foreignProvider = { ...lBundle, id: "bundle-foreign", project_id: "project-other", provider: "ecs" };
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([foreignProvider]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /provider or type/);
});

test("Flexus L inventory rejects catalog, data, and row domain scopes that are not the proven account", async t => {
  mock(t, url => (url.pathname.endsWith("/all-resources") ? { ...rmsPage([lBundle]), domain_id: "domain-other" } : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /account domain/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? { ...rmsPage([lBundle]), domain_id: null } : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /account domain/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? { ...rmsPage([lBundle]), data: { domain_id: "domain-other" } } : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /account domain/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, domain_id: "domain-other" }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /account domain/);
});

test("Flexus L inventory rejects rows without a non-empty native project identity", async t => {
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, project_id: null }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /without a verified project/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, project_id: "" }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /without a verified project/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, project_id: 42 }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /without a verified project/);
});

test("Flexus L inventory rejects coerced identities and names instead of accepting them", async t => {
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, id: 123 }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /identity or name/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, name: null }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /identity or name/);
});

test("Flexus L inventory rejects duplicate bundle identities before the project filter", async t => {
  const foreign = { ...lBundle, project_id: "project-other" };
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([foreign, lBundle]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /duplicate Flexus L bundle identity/);
});

test("Flexus L inventory requires exactly one native ECS linkage with a typed server identity", async t => {
  mock(t, url =>
    url.pathname.endsWith("/all-resources")
      ? rmsPage([{ ...lBundle, properties: { resources: [{ logical_resource_type: "other-resource", physical_resource_id: "x" }] } }])
      : undefined,
  );
  await assert.rejects(listNativeFlexusLInstances(session), /native server identity/);
  mock(t, url =>
    url.pathname.endsWith("/all-resources")
      ? rmsPage([
          {
            ...lBundle,
            properties: {
              resources: [
                { logical_resource_type: "huaweicloudinternal_ecs_instance", physical_resource_id: "server-l-1" },
                { logical_resource_type: "huaweicloudinternal_ecs_instance", physical_resource_id: "server-l-9" },
              ],
            },
          },
        ])
      : undefined,
  );
  await assert.rejects(listNativeFlexusLInstances(session), /ambiguous native server identity/);
  mock(t, url =>
    url.pathname.endsWith("/all-resources")
      ? rmsPage([
          {
            ...lBundle,
            properties: { resources: [{ logical_resource_type: "huaweicloudinternal_ecs_instance", physical_resource_id: null }] },
          },
        ])
      : undefined,
  );
  await assert.rejects(listNativeFlexusLInstances(session), /native server identity/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, properties: { resources: "not-an-array" } }]) : undefined));
  await assert.rejects(listNativeFlexusLInstances(session), /native resources array/);
});

test("Flexus L inventory rejects unexpected charging modes and keeps absent ones unverified", async t => {
  mock(t, url =>
    url.pathname.endsWith("/all-resources")
      ? rmsPage([{ ...lBundle, properties: { ...lBundle.properties, metadata: { charging_mode: "postPaid" } } }])
      : undefined,
  );
  await assert.rejects(listNativeFlexusLInstances(session), /unexpected charging mode/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, properties: { resources: lBundle.properties.resources } }]) : undefined));
  const inventory = await flexusManagement.inventory(session);
  const lInstance = inventory.find((resource) => resource.id === "l:bundle-1:server-l-1");
  assert.equal(lInstance?.values?.chargeMode, "unverified");
});

test("Flexus L inventory blocks provided null charging modes instead of converting them to unverified", async t => {
  mock(t, url =>
    url.pathname.endsWith("/all-resources")
      ? rmsPage([{ ...lBundle, properties: { ...lBundle.properties, metadata: { charging_mode: null } } }])
      : undefined,
  );
  await assert.rejects(listNativeFlexusLInstances(session), /unexpected charging mode/);
});

test("Flexus adapter inventory keeps L and X resources with their original native identities", async t => {
  mock(t);
  const inventory = await flexusManagement.inventory(session);
  const lInstance = inventory.find((resource) => resource.id === "l:bundle-1:server-l-1");
  const xInstance = inventory.find((resource) => resource.id === "x:server-x-1");
  assert.ok(lInstance && !("status" in lInstance));
  assert.deepEqual(lInstance?.values, { kind: "L", bundleId: "bundle-1", serverId: "server-l-1", chargeMode: "prePaid" });
  assert.equal(xInstance?.status, "ACTIVE");
  assert.deepEqual(xInstance?.values, { kind: "X", serverId: "server-x-1", flavor: "x1.2u.4g", vcpus: 2, ramGb: 4 });
});

test("Flexus X inventory keeps only documented x1/x1e flavor grammar offerings", async t => {
  const performance = { id: "server-x-2", name: "x-app-2", status: "ACTIVE", tenant_id: "project-1", flavor: { name: "x1e.4u.8g", vcpus: "4", ram: "8192" } };
  const plainEcs = { id: "server-ecs-1", name: "plain-ecs", status: "ACTIVE", tenant_id: "project-1", flavor: { name: "c7.large.2", vcpus: "2", ram: "4096" } };
  const odd = { id: "server-x-3", name: "odd", status: "ACTIVE", tenant_id: "project-1", flavor: { name: "x9.1u.1g", vcpus: "1", ram: "1024" } };
  mock(t, url => (url.pathname.endsWith("/cloudservers/detail") ? { servers: [xServer, performance, plainEcs, odd] } : undefined));
  const instances = await listNativeFlexusXInstances(session);
  assert.deepEqual(instances.map((instance) => instance.serverId), ["server-x-1", "server-x-2"]);
  assert.deepEqual(instances.map((instance) => instance.flavor), ["x1.2u.4g", "x1e.4u.8g"]);
});

test("Flexus X inventory rejects servers outside the exactly selected project", async t => {
  mock(t, url => (url.pathname.endsWith("/cloudservers/detail") ? { servers: [{ ...xServer, tenant_id: "project-other" }] } : undefined));
  await assert.rejects(listNativeFlexusXInstances(session), /outside the exactly selected project/);
});

test("Flexus X inventory rejects offerings whose native CPU and RAM do not correspond", async t => {
  mock(t, url => (url.pathname.endsWith("/cloudservers/detail") ? { servers: [{ ...xServer, flavor: { name: "x1.2u.4g", vcpus: "4", ram: "4096" } }] } : undefined));
  await assert.rejects(listNativeFlexusXInstances(session), /do not correspond/);
  mock(t, url => (url.pathname.endsWith("/cloudservers/detail") ? { servers: [{ ...xServer, flavor: { name: "x1.2u.4g" } }] } : undefined));
  await assert.rejects(listNativeFlexusXInstances(session), /native CPU and RAM numbers/);
});

test("Flexus X inventory maps unknown statuses to a static Unknown instead of the raw value", async t => {
  mock(t, url => (url.pathname.endsWith("/cloudservers/detail") ? { servers: [{ ...xServer, status: "WEIRD_X_STATE" }] } : undefined));
  const instances = await listNativeFlexusXInstances(session);
  assert.equal(instances[0].status, "Unknown");
  assert.ok(!JSON.stringify(instances).includes("WEIRD_X_STATE"));
});

test("Flexus L inspect shows typed facts only and verifies the fresh bundle lock", async t => {
  mock(t, url =>
    url.pathname === "/v1/project-1/cloudservers/server-l-1"
      ? { server: lServer({}, { charging_mode: "1", admin_pass: "secret-credential-value" }) }
      : undefined,
  );
  const outcome = await flexusManagement.execute(session, "inspect", {}, lResource);
  const facts = Object.fromEntries(outcome.facts!.map((fact) => [fact.label, fact.value]));
  assert.equal(facts["Flexus L bundle"], "bundle-1");
  assert.equal(facts["Bundle lock"], "hcss · verified");
  assert.equal(facts["Charge mode"], "prePaid");
  assert.equal(facts["Status"], "SHUTOFF");
  assert.ok(!JSON.stringify(outcome).includes("secret-credential-value"));
});

test("Flexus L inspect rejects a server whose lock source does not match the bundle", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({}, { lockSourceId: "bundle-other" }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "inspect", {}, lResource), /lock source does not match/);
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({}, { lockSource: "ecs" }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "inspect", {}, lResource), /lock source does not match/);
});

test("Flexus L server charging mode must be the native string 1 without number coercion", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({}, { charging_mode: 1 }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "inspect", {}, lResource), /unexpected charging mode/);
});

test("Flexus inspect rejects servers outside the selected project or with a different identity", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ tenant_id: "project-other" }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "inspect", {}, lResource), /outside the exactly selected project/);
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ id: "server-other" }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "inspect", {}, lResource), /different server/);
});

test("Unknown native statuses never become a default writable state", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ status: "WEIRD_STATE" }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /not a verified native state/);
});

test("Unknown native statuses and raw task states never surface in facts or errors", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ status: "WEIRD_STATE" }) } : undefined));
  const outcome = await flexusManagement.execute(session, "inspect", {}, lResource);
  const facts = Object.fromEntries(outcome.facts!.map((fact) => [fact.label, fact.value]));
  assert.equal(facts["Status"], "Unknown");
  assert.ok(!JSON.stringify(outcome).includes("WEIRD_STATE"));
  let failure: unknown;
  try {
    await flexusManagement.execute(session, "start", {}, lResource);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.ok(!failure.message.includes("WEIRD_STATE"));
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ "OS-EXT-STS:task_state": "spooling" }) } : undefined));
  const tasked = await flexusManagement.execute(session, "inspect", {}, lResource);
  const taskedFacts = Object.fromEntries(tasked.facts!.map((fact) => [fact.label, fact.value]));
  assert.equal(taskedFacts["Current task"], "active");
  assert.ok(!JSON.stringify(tasked).includes("spooling"));
});

test("Flexus writes require a verified idle null task state", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ "OS-EXT-STS:task_state": "rebooting" }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /native task/);
  const { ["OS-EXT-STS:task_state"]: removedTaskState, ...withoutTaskState } = lServer();
  void removedTaskState;
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: withoutTaskState } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /native task/);
});

test("Flexus writes reject malformed task states, not only running ones", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ "OS-EXT-STS:task_state": "" }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /native task/);
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ "OS-EXT-STS:task_state": false }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /native task/);
});

test("Flexus writes require an explicit native boolean lock false", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: { ...lServer(), locked: undefined } } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /lock state is unverified/);
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ locked: 0 }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /lock state is unverified/);
});

test("Documented OTHER_SVC_LOCK entries do not block power operations while unknown ones do", async t => {
  const { writes } = mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({}, { OTHER_SVC_LOCK: "delete,resize" }) } : undefined));
  const outcome = await flexusManagement.execute(session, "start", {}, lResource);
  assert.equal(outcome.jobId, "job-1");
  assert.equal(writes.length, 1);
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({}, { OTHER_SVC_LOCK: "mysterylock" }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /cannot interpret/);
});

test("Raw service locks never become public facts and unknown locks stay unnamed", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({}, { OTHER_SVC_LOCK: "delete,resize" }) } : undefined));
  const outcome = await flexusManagement.execute(session, "inspect", {}, lResource);
  assert.ok(!outcome.facts!.some((fact) => fact.label === "Service locks"));
  assert.ok(!JSON.stringify(outcome).includes("delete,resize"));
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({}, { OTHER_SVC_LOCK: "mysterylock" }) } : undefined));
  let failure: unknown;
  try {
    await flexusManagement.execute(session, "start", {}, lResource);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.ok(!failure.message.includes("mysterylock"));
});

test("Frozen and locked Flexus servers refuse power changes", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ status: "FROZEN" }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /frozen/);
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ locked: true }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /locked/);
});

test("Flexus management is project-scoped, not account-wide", () => {
  assert.equal(flexusManagement.accountWide, undefined);
});

test("Flexus L mutations refresh the RMS bundle linkage and the fresh bundle name", async t => {
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, name: "bundle-renamed" }]) : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /not fresh/);
  mock(t, url =>
    url.pathname.endsWith("/all-resources")
      ? rmsPage([
          {
            ...lBundle,
            properties: { ...lBundle.properties, resources: [{ logical_resource_type: "huaweicloudinternal_ecs_instance", physical_resource_id: "server-l-2" }] },
          },
        ])
      : undefined,
  );
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /no longer links/);
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([]) : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /no longer in the selected project/);
});

test("Flexus L resource name is the product bundle name, distinct from the native server name", async t => {
  mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, name: "bundle-l-web" }]) : undefined));
  const { writes } = mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, name: "bundle-l-web" }]) : undefined));
  const outcome = await flexusManagement.execute(session, "start", {}, { id: "l:bundle-1:server-l-1", name: "bundle-l-web" });
  assert.equal(outcome.jobId, "job-1");
  assert.equal(writes.length, 1);
  await assert.rejects(flexusManagement.execute(session, "start", {}, { id: "l:bundle-1:server-l-1", name: "l-web" }), /not fresh/);
  const { writes: updateWrites } = mock(t, url => (url.pathname.endsWith("/all-resources") ? rmsPage([{ ...lBundle, name: "bundle-l-web" }]) : undefined));
  const updated = await flexusManagement.execute(
    session,
    "update-server",
    { currentName: "l-web", name: "l-web-2" },
    { id: "l:bundle-1:server-l-1", name: "bundle-l-web" },
  );
  assert.equal(updateWrites[0].method, "PUT");
  assert.equal(updated.jobId, "server-l-1");
});

test("Flexus X mutations require the fresh native server name", async t => {
  mock(t);
  await assert.rejects(flexusManagement.execute(session, "start", {}, { id: "x:server-x-1", name: "stale-name" }), /not fresh/);
});

test("Flexus start submits the native os-start action and keeps the original job", async t => {
  const { writes } = mock(t);
  const outcome = await flexusManagement.execute(session, "start", {}, lResource);
  assert.equal(writes[0].url, `${hcssBase}/v1/project-1/cloudservers/action`);
  assert.equal(writes[0].method, "POST");
  assert.deepEqual(writes[0].body, { "os-start": { servers: [{ id: "server-l-1" }] } });
  assert.deepEqual({ jobId: outcome.jobId, asynchronous: outcome.asynchronous, resourceId: outcome.resourceId }, {
    jobId: "job-1",
    asynchronous: true,
    resourceId: "l:bundle-1:server-l-1",
  });
});

test("Flexus stop and soft reboot use SOFT types and require a fresh ACTIVE state", async t => {
  const { writes } = mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ status: "ACTIVE" }) } : undefined));
  const stop = await flexusManagement.execute(session, "stop", {}, lResource);
  assert.deepEqual(writes[0].body, { "os-stop": { servers: [{ id: "server-l-1" }], type: "SOFT" } });
  assert.equal(stop.jobId, "job-1");
  await flexusManagement.execute(session, "soft-reboot", {}, lResource);
  assert.deepEqual(writes[1].body, { reboot: { servers: [{ id: "server-l-1" }], type: "SOFT" } });
  mock(t);
  await assert.rejects(flexusManagement.execute(session, "stop", {}, lResource), /status is SHUTOFF/);
});

test("Flexus X power changes go to the native ECS endpoint", async t => {
  const { writes } = mock(t);
  const outcome = await flexusManagement.execute(session, "start", {}, xResource);
  assert.equal(writes[0].url, `${ecsBase}/v1/project-1/cloudservers/action`);
  assert.deepEqual(writes[0].body, { "os-start": { servers: [{ id: "server-x-1" }] } });
  assert.deepEqual({ jobId: outcome.jobId, resourceId: outcome.resourceId }, { jobId: "job-1", resourceId: "x:server-x-1" });
});

test("Flexus X management blocks on missing or coerced native dimensions", async t => {
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-x-1" ? { server: xServerDetail({ flavor: { name: "x1.2u.4g" } }) } : undefined));
  await assert.rejects(flexusManagement.execute(session, "inspect", {}, xResource), /native CPU and RAM numbers/);
  mock(t, url =>
    url.pathname === "/v1/project-1/cloudservers/server-x-1" ? { server: xServerDetail({ flavor: { name: "x1.2u.4g", vcpus: false, ram: 4096 } }) } : undefined,
  );
  await assert.rejects(flexusManagement.execute(session, "inspect", {}, xResource), /native CPU and RAM numbers/);
});

test("Power actions without a verifiable job id stay uncertain", async t => {
  mock(t, (url, init) => (init.method === "POST" && url.pathname.endsWith("/cloudservers/action") ? {} : undefined));
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /no verifiable job/);
});

test("Flexus metadata updates require the fresh native name confirmation", async t => {
  const { writes } = mock(t);
  await assert.rejects(flexusManagement.execute(session, "update-server", { currentName: "wrong-name", name: "l-web-2" }, lResource), /fresh native name/);
  assert.equal(writes.length, 0);
});

test("Flexus metadata updates send typed fields only and fingerprint them without raw storage", async t => {
  const { writes } = mock(t);
  const outcome = await flexusManagement.execute(session, "update-server", { currentName: "l-web", name: "l-web-2", description: "notes-123" }, lResource);
  assert.equal(writes[0].url, `${hcssBase}/v1/project-1/cloudservers/server-l-1`);
  assert.equal(writes[0].method, "PUT");
  assert.deepEqual(writes[0].body, { server: { name: "l-web-2", description: "notes-123" } });
  const digest = createHash("sha256").update(JSON.stringify([["description", "notes-123"], ["name", "l-web-2"]])).digest("hex");
  assert.deepEqual(outcome.verification, { fields: ["description", "name"], digest });
  assert.ok(!JSON.stringify(outcome).includes("notes-123"));
});

test("Flexus metadata updates reject angle brackets and empty patches", async t => {
  const { writes } = mock(t);
  await assert.rejects(
    flexusManagement.execute(session, "update-server", { currentName: "l-web", description: "<bad>" }, lResource),
    /characters < or >/,
  );
  await assert.rejects(flexusManagement.execute(session, "update-server", { currentName: "l-web" }, lResource), /Enter a new server name/);
  assert.equal(writes.length, 0);
});

test("Flexus metadata updates verify optional acknowledged server and project echoes exactly", async t => {
  mock(t, (url, init) =>
    init.method === "PUT" && /\/cloudservers\/[^/]+$/.test(url.pathname) ? { server: { id: "server-other", tenant_id: "project-1" } } : undefined,
  );
  await assert.rejects(flexusManagement.execute(session, "update-server", { currentName: "l-web", name: "l-web-2" }, lResource), /different server or project/);
  mock(t, (url, init) =>
    init.method === "PUT" && /\/cloudservers\/[^/]+$/.test(url.pathname) ? { server: { id: "server-l-1", tenant_id: null } } : undefined,
  );
  await assert.rejects(flexusManagement.execute(session, "update-server", { currentName: "l-web", name: "l-web-2" }, lResource), /different server or project/);
  mock(t, (url, init) =>
    init.method === "PUT" && /\/cloudservers\/[^/]+$/.test(url.pathname) ? { server: { id: null, tenant_id: "project-1" } } : undefined,
  );
  await assert.rejects(flexusManagement.execute(session, "update-server", { currentName: "l-web", name: "l-web-2" }, lResource), /different server or project/);
  const { writes } = mock(t, (url, init) => (init.method === "PUT" && /\/cloudservers\/[^/]+$/.test(url.pathname) ? {} : undefined));
  const outcome = await flexusManagement.execute(session, "update-server", { currentName: "l-web", name: "l-web-2" }, lResource);
  assert.equal(writes.length, 1);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, "server-l-1");
});

test("Flexus metadata updates succeed only on a matching fresh readback", async t => {
  let applied = false;
  const { writes } = mock(t, (url, init) => {
    if (url.pathname === "/v1/project-1/cloudservers/server-l-1" && (init.method ?? "GET") === "GET") {
      return { server: applied ? lServer({ name: "l-web-2", description: "notes-123" }) : lServer() };
    }
    if (init.method === "PUT" && /\/cloudservers\/[^/]+$/.test(url.pathname)) {
      applied = true;
      return { server: { id: "server-l-1", tenant_id: "project-1" } };
    }
    return undefined;
  });
  const outcome = await flexusManagement.execute(session, "update-server", { currentName: "l-web", name: "l-web-2", description: "notes-123" }, lResource);
  assert.equal(writes[0].method, "PUT");
  assert.equal(outcome.asynchronous, undefined);
  assert.equal(outcome.jobId, undefined);
  assert.match(outcome.message, /verified on the fresh server state/);
  assert.deepEqual(outcome.verification, flexusUpdateFingerprint({ name: "l-web-2", description: "notes-123" }));
});

test("Flexus metadata updates stay pending with the original server id as observer when the readback is stale", async t => {
  const { writes } = mock(t);
  const outcome = await flexusManagement.execute(session, "update-server", { currentName: "l-web", name: "l-web-2" }, lResource);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, "server-l-1");
  assert.match(outcome.message, /not visible on the fresh server state/);
  assert.deepEqual(outcome.verification, flexusUpdateFingerprint({ name: "l-web-2" }));
  assert.equal(writes.filter((write) => write.method === "PUT").length, 1);
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ description: 42 }) } : undefined));
  const unverifiedDescription = await flexusManagement.execute(session, "update-server", { currentName: "l-web", description: "notes" }, lResource);
  assert.equal(unverifiedDescription.asynchronous, true);
  assert.equal(unverifiedDescription.jobId, "server-l-1");
});

test("Flexus metadata updates send only requested fields and clear descriptions natively", async t => {
  let applied = false;
  const { writes } = mock(t, (url, init) => {
    if (url.pathname === "/v1/project-1/cloudservers/server-l-1" && (init.method ?? "GET") === "GET") {
      return { server: applied ? lServer({ description: "notes-only" }) : lServer() };
    }
    if (init.method === "PUT" && /\/cloudservers\/[^/]+$/.test(url.pathname)) {
      applied = true;
      return { server: { id: "server-l-1", tenant_id: "project-1" } };
    }
    return undefined;
  });
  const described = await flexusManagement.execute(session, "update-server", { currentName: "l-web", description: "notes-only" }, lResource);
  assert.deepEqual(writes[0].body, { server: { description: "notes-only" } });
  assert.equal(described.asynchronous, undefined);
  assert.deepEqual(described.verification, flexusUpdateFingerprint({ description: "notes-only" }));
  const { writes: clearWrites } = mock(t);
  const cleared = await flexusManagement.execute(session, "update-server", { currentName: "l-web", description: "" }, lResource);
  assert.deepEqual(clearWrites[0].body, { server: { description: "" } });
  assert.equal(cleared.asynchronous, undefined);
  assert.deepEqual(cleared.verification, flexusUpdateFingerprint({ description: "" }));
});

test("Flexus rename observer poll confirms the change only on the matching current fingerprint", async t => {
  const verification = flexusUpdateFingerprint({ name: "l-web-2", description: "notes-123" });
  const entry = historyEntry({ operation: "Rename or describe server", jobId: "server-l-1", verification });
  mock(t, url => (url.pathname === "/v1/project-1/cloudservers/server-l-1" ? { server: lServer({ name: "l-web-2", description: "notes-123" }) } : undefined));
  const succeeded = await flexusManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "l:bundle-1:server-l-1");
  const { reads } = mock(t);
  const pending = await flexusManagement.poll!(session, entry);
  assert.equal(pending.state, "submitted");
  assert.match(pending.message ?? "", /not visible on the fresh server state/);
  assert.ok(reads.every((read) => !read.url.includes("/jobs/")));
  mock(t);
  await assert.rejects(
    flexusManagement.poll!(session, historyEntry({ operation: "Rename or describe server", jobId: "job-1", verification })),
    /not a pending Flexus rename observation/,
  );
  await assert.rejects(
    flexusManagement.poll!(session, historyEntry({ operation: "Rename or describe server", jobId: "server-l-1" })),
    /fingerprint/,
  );
});

test("Flexus password resets enforce the native rules and never echo the secret", async t => {
  const { writes } = mock(t);
  for (const password of ["short1!", "alllowercase1", "Rootpassw0rd", "Adm1npassw0rd"]) {
    await assert.rejects(flexusManagement.execute(session, "reset-password", { password }, lResource), /password/i);
  }
  assert.equal(writes.length, 0);
  const outcome = await flexusManagement.execute(session, "reset-password", { password: "NewPassw0rd!" }, lResource);
  assert.equal(writes[0].url, `${hcssBase}/v1/project-1/cloudservers/server-l-1/os-reset-password`);
  assert.equal(writes[0].method, "PUT");
  assert.deepEqual(writes[0].body, { "reset-password": { new_password: "NewPassw0rd!", is_check_password: true } });
  assert.ok(!JSON.stringify(outcome).includes("NewPassw0rd!"));
});

test("Flexus password resets without a native job stay pending manual and never succeed", async t => {
  const { writes } = mock(t);
  const outcome = await flexusManagement.execute(session, "reset-password", { password: "NewPassw0rd!" }, lResource);
  assert.equal(writes.length, 1);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, undefined);
  assert.ok(!("jobId" in outcome));
  assert.match(outcome.message, /pending manual verification/);
});

test("Flexus password resets treat malformed job echoes as no verifiable job", async t => {
  for (const jobEcho of [null, 42, "", "x".repeat(65)]) {
    mock(t, (url, init) => (init.method === "PUT" && url.pathname.endsWith("/os-reset-password") ? { job_id: jobEcho } : undefined));
    const outcome = await flexusManagement.execute(session, "reset-password", { password: "NewPassw0rd!" }, lResource);
    assert.equal(outcome.asynchronous, true);
    assert.equal(outcome.jobId, undefined, `job echo ${String(jobEcho)} must not become a job`);
    assert.match(outcome.message, /pending manual verification/);
  }
});

test("Flexus password resets keep a typed native job and poll it while manual entries stay pending", async t => {
  mock(t, (url, init) => (init.method === "PUT" && url.pathname.endsWith("/os-reset-password") ? { job_id: "job-9" } : undefined));
  const outcome = await flexusManagement.execute(session, "reset-password", { password: "NewPassw0rd!" }, lResource);
  assert.equal(outcome.jobId, "job-9");
  assert.equal(outcome.asynchronous, true);
  mock(t, url => (url.pathname.endsWith("/jobs/job-9") ? { status: "SUCCESS", job_id: "job-9", entities: { server_id: "server-l-1" } } : undefined));
  const polled = await flexusManagement.poll!(session, historyEntry({ operation: "Reset administrator password", jobId: "job-9" }));
  assert.equal(polled.state, "succeeded");
  mock(t);
  const manual = await flexusManagement.poll!(session, historyEntry({ operation: "Reset administrator password", jobId: undefined }));
  assert.equal(manual.state, "submitted");
  assert.match(manual.message ?? "", /pending manual verification/);
});

test("Flexus X password resets use the native ECS endpoint and stay pending manual without a job", async t => {
  const { writes } = mock(t);
  const outcome = await flexusManagement.execute(session, "reset-password", { password: "NewPassw0rd!" }, xResource);
  assert.equal(writes[0].url, `${ecsBase}/v1/project-1/cloudservers/server-x-1/os-reset-password`);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, undefined);
});

test("Flexus poll accepts only whitelisted operation labels with a native job or observer", async t => {
  mock(t);
  await assert.rejects(
    flexusManagement.poll!(session, historyEntry({ operation: "Rename or describe server" })),
    /not a pending Flexus rename observation/,
  );
  await assert.rejects(flexusManagement.poll!(session, historyEntry({ operation: "Delete server" })), /not a polled Flexus operation/);
  await assert.rejects(flexusManagement.poll!(session, historyEntry({ jobId: undefined })), /no native job/);
  await assert.rejects(flexusManagement.poll!(session, historyEntry({ resourceId: "ecs:server-1" })), /Flexus L or Flexus X resource/);
});

test("Flexus poll rejects entries outside the selected session project", async t => {
  mock(t);
  await assert.rejects(flexusManagement.poll!(session, historyEntry({ projectId: "project-other" })), /different project/);
  await assert.rejects(
    flexusManagement.poll!(
      session,
      historyEntry({ operation: "Rename or describe server", projectId: "project-other", jobId: "server-l-1", verification: flexusUpdateFingerprint({ name: "l-web-2" }) }),
    ),
    /different project/,
  );
});

test("Flexus poll reports native job states without raw failure text", async t => {
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "SUCCESS", job_id: "job-1", entities: { server_id: "server-l-1" } } : undefined));
  const succeeded = await flexusManagement.poll!(session, historyEntry());
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "l:bundle-1:server-l-1");
  mock(t, url =>
    url.pathname.endsWith("/jobs/job-1")
      ? { status: "FAIL", job_id: "job-1", error_code: "E.123", fail_reason: "raw-disk-failure-secret", entities: { server_id: "server-l-1" } }
      : undefined,
  );
  const failed = await flexusManagement.poll!(session, historyEntry());
  assert.equal(failed.state, "failed");
  assert.ok(!JSON.stringify(failed).includes("raw-disk-failure-secret"));
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-1" } : undefined));
  const running = await flexusManagement.poll!(session, historyEntry());
  assert.equal(running.state, "submitted");
  assert.equal(running.observedTask, "RUNNING");
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "INIT", job_id: "job-1" } : undefined));
  assert.equal((await flexusManagement.poll!(session, historyEntry())).state, "submitted");
});

test("Flexus poll verifies the echoed job id and member ids in the original scope", async t => {
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-other" } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /different job/);
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "SUCCESS", job_id: "job-1", entities: { server_id: "server-other" } } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /different server/);
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "WEIRD", job_id: "job-1" } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /unverified Flexus job status/);
});

test("Flexus poll requires every provided job identity to match exactly, including null", async t => {
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: null } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /different job/);
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-1", project_id: "project-other" } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /outside the exactly selected project/);
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-1", project_id: null } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /outside the exactly selected project/);
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-1", domain_id: "domain-other" } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /account domain/);
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-1", domain_id: domainId } : undefined));
  assert.equal((await flexusManagement.poll!(session, historyEntry())).state, "submitted");
});

test("Flexus poll never filters malformed member identities or sub-job lists", async t => {
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-1", entities: { server_id: null } } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /different server/);
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-1", entities: { sub_jobs: "weird" } } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /sub-job/);
  mock(t, url =>
    url.pathname.endsWith("/jobs/job-1")
      ? { status: "RUNNING", job_id: "job-1", sub_jobs: [{ entities: { server_id: "server-other" } }] }
      : undefined,
  );
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /different server/);
  mock(t, url =>
    url.pathname.endsWith("/jobs/job-1")
      ? { status: "RUNNING", job_id: "job-1", sub_jobs: [{ entities: { server_id: "server-l-1" } }] }
      : undefined,
  );
  assert.equal((await flexusManagement.poll!(session, historyEntry())).state, "submitted");
});

test("Flexus poll rejects business failures inside a job body that is not an actual failed job", async t => {
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-1", error_code: null } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /response body/);
  mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "RUNNING", job_id: "job-1", error_msg: "" } : undefined));
  await assert.rejects(flexusManagement.poll!(session, historyEntry()), /response body/);
});

test("Flexus X poll reads the ECS job of the changed X server", async t => {
  const { reads } = mock(t, url => (url.pathname.endsWith("/jobs/job-1") ? { status: "SUCCESS", job_id: "job-1", entities: { server_id: "server-x-1" } } : undefined));
  const outcome = await flexusManagement.poll!(session, historyEntry({ operation: "Stop server", resourceId: "x:server-x-1" }));
  assert.equal(outcome.state, "succeeded");
  assert.equal(outcome.resourceId, "x:server-x-1");
  assert.ok(reads.some((read) => read.url === `${ecsBase}/v1/project-1/jobs/job-1`));
});

test("Flexus resource ids retain the parent bundle identity for L and the server identity for X", () => {
  assert.deepEqual(parseFlexusResourceId("l:bundle-1:server-l-1"), { kind: "l", bundleId: "bundle-1", serverId: "server-l-1" });
  assert.deepEqual(parseFlexusResourceId("x:server-x-1"), { kind: "x", serverId: "server-x-1" });
  for (const malformed of ["l:bundle-1", "x:", "ecs:server-1", "", undefined]) {
    assert.throws(() => parseFlexusResourceId(malformed), /Flexus/);
  }
});

const project2 = { ...project, projectId: "project-2", projectName: "sa-brazil-1_team-2" };
const twoProjectSession = { ...session, projects: [project, project2] };
const bundle2 = {
  ...lBundle,
  id: "bundle-2",
  project_id: "project-2",
  properties: { ...lBundle.properties, resources: [{ logical_resource_type: "huaweicloudinternal_ecs_instance", physical_resource_id: "server-l-2" }] },
};
const xServer2 = { id: "server-x-2", name: "x-app-2", status: "ACTIVE", tenant_id: "project-2", flavor: { name: "x1.2u.4g", vcpus: "2", ram: "4096" } };

function expectedFlexusResource(overrides: Partial<FlexusResource>): FlexusResource {
  return {
    createdAt: "-",
    id: "",
    name: "",
    privateIp: "-",
    projectId: "",
    projectName: "",
    publicIp: "-",
    region: "sa-brazil-1",
    signal: "",
    sourceService: "ECS",
    status: "-",
    ...overrides,
  };
}

test("Main Flexus inventory is the native L and X catalog across session projects", async t => {
  mock(t, url => {
    if (url.pathname.endsWith("/all-resources")) return rmsPage([lBundle, bundle2]);
    if (url.pathname === "/v1/project-2/cloudservers/detail") return { servers: [xServer2] };
    return undefined;
  });
  const resources = await listFlexusResources(twoProjectSession);
  assert.deepEqual(resources, [
    expectedFlexusResource({ id: "l:bundle-1:server-l-1", name: "l-web", projectId: "project-1", projectName: "sa-brazil-1_team", signal: "L" }),
    expectedFlexusResource({ id: "x:server-x-1", name: "x-app", projectId: "project-1", projectName: "sa-brazil-1_team", signal: "X", status: "ACTIVE" }),
    expectedFlexusResource({ id: "l:bundle-2:server-l-2", name: "l-web", projectId: "project-2", projectName: "sa-brazil-1_team-2", signal: "L" }),
    expectedFlexusResource({ id: "x:server-x-2", name: "x-app-2", projectId: "project-2", projectName: "sa-brazil-1_team-2", signal: "X", status: "ACTIVE" }),
  ]);
});

test("Main Flexus inventory keeps partial results visible with their per-plane errors", async t => {
  mock(t, url => {
    if (url.pathname === "/v1/project-2/cloudservers/detail") return new Response("unavailable", { status: 500 });
    if (url.pathname.endsWith("/all-resources")) return rmsPage([lBundle, bundle2]);
    return undefined;
  });
  let failure: unknown;
  try {
    await listFlexusResources(twoProjectSession);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof CloudLoadError);
  const partial = (failure as CloudLoadError<FlexusResource[]>).partialData;
  assert.deepEqual(partial?.map((resource) => resource.id), ["l:bundle-1:server-l-1", "x:server-x-1", "l:bundle-2:server-l-2"]);
  assert.match((failure as Error).message, /Flexus X in sa-brazil-1_team-2 \(sa-brazil-1\)/);
  assert.match((failure as Error).message, /HTTP 500/);
});

test("Main Flexus inventory uses no name or datastore heuristics", async t => {
  const trap = { id: "server-trap", name: "flexus-heuristic-trap", status: "ACTIVE", tenant_id: "project-1", flavor: { name: "c7.large.2", vcpus: "2", ram: "4096" } };
  const { reads } = mock(t, url => (url.pathname.endsWith("/cloudservers/detail") ? { servers: [trap] } : undefined));
  const resources = await listFlexusResources(session);
  assert.deepEqual(resources, [expectedFlexusResource({ id: "l:bundle-1:server-l-1", name: "l-web", projectId: "project-1", projectName: "sa-brazil-1_team", signal: "L" })]);
  assert.ok(reads.every((read) => !read.url.includes("rds")));
  const source = readFileSync(fileURLToPath(new URL("../src/lib/huawei/services/flexus.ts", import.meta.url)), "utf8");
  assert.match(source, /flexus-native/);
  assert.doesNotMatch(source, /listEcsInstances|listRdsInstances|huawei\/services\/ecs"|huawei\/services\/rds"/);
});

test("Flexus resource reads reject provided project echoes even when native server identity matches", async t => {
  for (const body of [{ project_id: "foreign", server: lServer() }, { data: { project_id: null }, server: lServer() }, { server: lServer({ project_id: "foreign" }) }]) {
    const { writes } = mock(t, url => url.pathname.endsWith("/cloudservers/server-l-1") ? body : undefined);
    await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /selected project/); assert.equal(writes.length, 0); t.mock.restoreAll();
  }
});
test("Flexus L missing native subscription metadata blocks mutations", async t => {
  const server = lServer(); delete (server.metadata as Record<string, unknown>).charging_mode;
  const { writes } = mock(t, url => url.pathname.endsWith("/cloudservers/server-l-1") ? { server } : undefined);
  await assert.rejects(flexusManagement.execute(session, "start", {}, lResource), /charging mode/); assert.equal(writes.length, 0);
});
test("Flexus saved job scope cannot fall back to a selected project", async t => {
  const { reads, writes } = mock(t);
  await assert.rejects(flexusManagement.poll!(session, historyEntry({ projectId: undefined })), /different project/); assert.equal(reads.length + writes.length, 0);
});
test("Flexus job completion validates both domain aliases and child project identities", async t => {
  for (const body of [{ status: "SUCCESS", domain_id: "domain-1", domainId: "foreign" }, { status: "SUCCESS", server_id: null }, { status: "SUCCESS", entities: { sub_jobs: [{ project_id: "foreign", entities: { server_id: "server-l-1" } }] } }]) {
    mock(t, url => url.pathname.endsWith("/jobs/job-1") ? body : undefined);
    await assert.rejects(flexusManagement.poll!(session, historyEntry()), /account domain|different server|selected project/); t.mock.restoreAll();
  }
});
