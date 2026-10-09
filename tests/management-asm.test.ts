import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { asmManagement } from "@/lib/huawei/management/adapters/asm";
import { endpointEnv, serviceEndpoint } from "@/lib/huawei/endpoints";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const meshId = "mesh-1";
const runningMesh = {
  apiVersion: "v1", kind: "Mesh",
  metadata: { name: "team-mesh", uid: meshId, creationTimestamp: "2026-01-01T00:00:00Z", annotations: { "team.example/credential": "private-token" }, labels: { team: "platform" } },
  spec: {
    type: "InCluster", version: "v1.18.7", ipv6Enable: false,
    extendParams: { clusters: [{ clusterID: "cluster-1", injection: { namespaces: { fieldSelector: { key: "kubernetes.io/metadata.name", operator: "In", values: ["default", "web"] } } }, installation: { nodes: { fieldSelector: { key: "kubernetes.io/hostname", operator: "In", values: ["node-1"] } } } }] },
    config: { proxyConfig: { includeIPRanges: "10.0.0.0/8", excludeOutboundPorts: "8443" }, telemetryConfig: { metrics: { aom: [{ instanceID: "aom-prom-1" }] }, accessLogging: { lts: [{ logGroupID: "group-1", logStreamID: "stream-1" }] }, tracing: { randomSamplingPercentage: 10, defaultProviders: ["zipkin"], extensionProviders: [{ name: "zipkin", zipkin: { service: "http://tracing.internal", port: 9411 } }] } } },
  },
  status: { phase: "Running", updateTimestamp: "2026-01-02T00:00:00Z" },
};
const creatingMesh = { apiVersion: "v1", kind: "Mesh", metadata: { name: "new-mesh", uid: "mesh-2", creationTimestamp: "2026-01-03T00:00:00Z" }, spec: { type: "InCluster", extendParams: { clusters: [{ clusterID: "cluster-1" }] } }, status: { phase: "Creating" } };
const meshes = [runningMesh, creatingMesh];
const cceClusters = { items: [
  { metadata: { uid: "cluster-1", name: "cluster-one", alias: "Production" }, spec: { flavor: "cce.s1.small", version: "v1.30", hostNetwork: {}, containerNetwork: {}, authentication: {} }, status: { phase: "Available" } },
  { metadata: { uid: "cluster-2", name: "cluster-two" }, spec: { flavor: "cce.s1.small", version: "v1.28", hostNetwork: {}, containerNetwork: {}, authentication: {} }, status: { phase: "Unavailable" } },
] };

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v1/project-1/meshes") return { apiVersion: "v1", kind: "Mesh", items: meshes };
  if (path === `/v1/project-1/meshes/${meshId}`) return runningMesh;
  if (path === "/v1/project-1/meshes/mesh-2") return creatingMesh;
  if (path === "/v3/projects/project-1/clusters-to-be-added") return cceClusters;
  if (path === "/api/v3/projects/project-1/clusters/cluster-1/nodes") return { items: [{ metadata: { uid: "node-1", name: "control-plane" }, status: { phase: "Active" } }] };
  throw new Error(`Unexpected GET ${path}`);
}

function mockCloud(t: TestContext) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    writes.push({ path: url.pathname, method: init.method, body });
    if (init.method === "POST") return Response.json({ ...body, metadata: { ...body.metadata, uid: "mesh-new" }, status: { phase: "Creating" } });
    return Response.json({ ...runningMesh, status: { phase: "Deleting", updateTimestamp: "2026-01-04T00:00:00Z" } });
  });
  return writes;
}

const meshResource: ManagementResource = { id: meshId, name: "team-mesh", status: "Running", values: { name: "team-mesh", version: "v1.18.7", type: "InCluster", clusters: 1 } };

test("the asm service key maps to the official regional ASM endpoint", () => {
  assert.equal(endpointEnv.asm, "HUAWEI_ASM_ENDPOINT");
  assert.equal(serviceEndpoint("asm", "sa-brazil-1"), "https://asm.sa-brazil-1.myhuaweicloud.com");
});

test("inventory maps the native mesh list with phase, version, and cluster facts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { const url = new URL(input); reads.push(url.pathname); return Response.json(read(url)); });
  const resources = await asmManagement.inventory(session);
  assert.deepEqual(reads, ["/v1/project-1/meshes"]);
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status, item.values?.version, item.values?.type, item.values?.clusters]), [
    ["mesh-1", "team-mesh", "Running", "v1.18.7", "InCluster", 1],
    ["mesh-2", "new-mesh", "Creating", "", "InCluster", 1],
  ]);
});

test("inventory fails closed when the native list envelope is malformed", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ apiVersion: "v1", kind: "Mesh" }));
  await assert.rejects(asmManagement.inventory(session), /no mesh list envelope/);
});

test("create options list only Available CCE clusters from this project", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await asmManagement.options!(session, "create");
  assert.deepEqual(choices.clusters, [{ value: "cluster-1", label: "Production · v1.30 · cce.s1.small" }]);
  assert.deepEqual(await asmManagement.options!(session, "inspect"), {});
});

test("create sends the documented InCluster mesh body and reports the native phase", async (t) => {
  const writes = mockCloud(t);
  const outcome = await asmManagement.execute(session, "create", { name: "app-mesh", clusters: ["cluster-1"], nodes: [JSON.stringify(["cluster-1", "node-1"])], ipv6Enable: true });
  assert.deepEqual(writes, [{ path: "/v1/project-1/meshes", method: "POST", body: { apiVersion: "v1", kind: "Mesh", metadata: { name: "app-mesh" }, spec: { type: "InCluster", extendParams: { clusters: [{ clusterID: "cluster-1", installation: { nodes: { fieldSelector: { key: "UID", operator: "In", values: ["node-1"] } } } }] }, ipv6Enable: true } } }]);
  assert.equal(outcome.resourceId, "mesh-new");
  assert.equal(outcome.jobId, "mesh-new");
  assert.equal(outcome.asynchronous, true);
  assert.match(outcome.message, /Creating/);
  await asmManagement.execute(session, "create", { name: "solo-mesh", clusters: ["cluster-1"], nodes: [JSON.stringify(["cluster-1", "node-1"])] });
  assert.deepEqual(writes[1].body, { apiVersion: "v1", kind: "Mesh", metadata: { name: "solo-mesh" }, spec: { type: "InCluster", extendParams: { clusters: [{ clusterID: "cluster-1", installation: { nodes: { fieldSelector: { key: "UID", operator: "In", values: ["node-1"] } } } }] } } });
});

test("create rejects forged or unavailable clusters and malformed names before any write", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ name: "app-mesh", clusters: ["cluster-2"] }, /Available CCE cluster/],
    [{ name: "app-mesh", clusters: ["forged"] }, /Available CCE cluster/],
    [{ name: "app-mesh" }, /at least one available CCE cluster/],
    [{ name: "Bad_Name", clusters: ["cluster-1"], nodes: [JSON.stringify(["cluster-1", "node-1"])] }, /Mesh names are 4-64/],
    [{ name: "ab", clusters: ["cluster-1"], nodes: [JSON.stringify(["cluster-1", "node-1"])] }, /Mesh names are 4-64/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(asmManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live cluster and node choices and enforces mesh names", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = asmManagement.operations.find((item) => item.id === "create")!;
  const choices = await asmManagement.options!(session, "create");
  const values = validateManagementValues(operation, { name: "app-mesh", clusters: ["cluster-1"], nodes: [JSON.stringify(["cluster-1", "node-1"])] }, choices);
  assert.equal(values.name, "app-mesh");
  assert.throws(() => validateManagementValues(operation, { name: "app-mesh", clusters: ["forged"] }, choices), /unavailable selection/);
  assert.throws(() => validateManagementValues(operation, { name: "Bad", clusters: ["cluster-1"], nodes: [JSON.stringify(["cluster-1", "node-1"])] }, choices), /invalid format/);
  assert.throws(() => validateManagementValues(operation, { name: "app-mesh", clusters: ["cluster-1"], nodes: ["forged"] }, choices), /unavailable selection/);
});

test("inspect reports typed native facts and never returns private annotation values", async (t) => {
  mockCloud(t);
  const outcome = await asmManagement.execute(session, "inspect", {}, meshResource);
  const facts = Object.fromEntries(outcome.facts!.map((fact) => [fact.label, fact.value]));
  assert.equal(facts["Phase"], "Running");
  assert.equal(facts["Type and version"], "InCluster · v1.18.7");
  assert.equal(facts["Member clusters"], "1");
  assert.equal(facts["Cluster 1 · cluster-1"], "sidecar injection kubernetes.io/metadata.name In [default, web] · control plane nodes kubernetes.io/hostname In [node-1]");
  assert.equal(facts["Outbound interception"], "ranges 10.0.0.0/8 · excluded ranges none · intercept ports all · excluded ports 8443");
  assert.equal(facts["Metrics AOM instances"], "aom-prom-1");
  assert.equal(facts["Access logging LTS streams"], "group-1/stream-1");
  assert.equal(facts["Tracing sampling"], "10%");
  assert.equal(facts["Tracing extension providers"], "zipkin → http://tracing.internal:9411");
  assert.equal(facts["Annotations and labels"], "1 annotation(s) · 1 label(s)");
  assert.ok(!JSON.stringify(outcome).includes("private-token"));
  assert.ok(!JSON.stringify(outcome).includes("team.example/credential"));
});

test("inspect and delete refuse meshes missing from the current project list", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(asmManagement.execute(session, "inspect", {}, { id: "mesh-gone", name: "gone" }), /no longer exists/);
  await assert.rejects(asmManagement.execute(session, "delete", {}, { id: "mesh-gone", name: "gone" }), /no longer exists/);
  assert.equal(writes.length, 0);
});

test("a detail response from a different mesh is refused", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v1/project-1/meshes") return Response.json({ items: meshes });
    return Response.json({ ...runningMesh, metadata: { ...runningMesh.metadata, uid: "other" } });
  });
  await assert.rejects(asmManagement.execute(session, "inspect", {}, meshResource), /different mesh/);
});

test("delete requires the Running state, exact-name confirmation, and a stated impact", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(asmManagement.execute(session, "delete", {}, { id: "mesh-2", name: "new-mesh", status: "Creating" }), /Running state/);
  assert.equal(writes.length, 0);
  const operation = asmManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(operation.confirmation, true);
  assert.ok(operation.impact);
  assert.deepEqual(operation.allowedStatuses, ["Running"]);
});

test("delete uses the native route and reports the native Deleting phase", async (t) => {
  const writes = mockCloud(t);
  const outcome = await asmManagement.execute(session, "delete", {}, meshResource);
  assert.deepEqual(writes, [{ path: "/v1/project-1/meshes/mesh-1", method: "DELETE", body: undefined }]);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, meshId);
  assert.match(outcome.message, /Deleting/);
});

test("delete refuses an unverified deletion response", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    return Response.json({ ...runningMesh, metadata: { ...runningMesh.metadata, uid: "other" }, status: { phase: "Deleting" } });
  });
  await assert.rejects(asmManagement.execute(session, "delete", {}, meshResource), /unverified deletion/);
});

test("poll observes the mesh's native phase without inventing completion", async (t) => {
  const phases = ["Creating", "Running", "CreateFailed", "Upgrading"];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    assert.equal(new URL(input).pathname, "/v1/project-1/meshes/mesh-new");
    return Response.json({ apiVersion: "v1", kind: "Mesh", metadata: { name: "app-mesh", uid: "mesh-new" }, status: { phase: phases[index++] } });
  });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "asm", operation: "Create mesh", startedAt: new Date().toISOString(), state: "submitted", jobId: "mesh-new", resourceId: "mesh-new" };
  assert.match((await asmManagement.poll!(session, entry)).message!, /Creating/);
  const succeeded = await asmManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "mesh-new");
  assert.equal((await asmManagement.poll!(session, entry)).state, "failed");
  const upgrading = await asmManagement.poll!(session, entry);
  assert.equal(upgrading.state, "submitted");
  assert.match(upgrading.message!, /Upgrading/);
});

test("delete polling maps Deleting, DeleteFailed, and removal from the list", async (t) => {
  const replies = [Response.json({ ...runningMesh, status: { phase: "Deleting" } }), Response.json({ ...runningMesh, status: { phase: "DeleteFailed" } }), new Response(null, { status: 404 })];
  let index = 0;
  t.mock.method(globalThis, "fetch", async () => replies[index++]);
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "asm", operation: "Delete mesh", startedAt: new Date().toISOString(), state: "submitted", jobId: meshId, resourceId: meshId };
  assert.match((await asmManagement.poll!(session, entry)).message!, /Deleting/);
  assert.equal((await asmManagement.poll!(session, entry)).state, "failed");
  const gone = await asmManagement.poll!(session, entry);
  assert.equal(gone.state, "succeeded");
});

test("poll refuses a mesh identity that does not match the observed operation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...runningMesh, metadata: { ...runningMesh.metadata, uid: "other" } }));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "asm", operation: "Create mesh", startedAt: new Date().toISOString(), state: "submitted", jobId: "mesh-new" };
  await assert.rejects(asmManagement.poll!(session, entry), /different mesh/);
  await assert.rejects(asmManagement.poll!(session, { ...entry, jobId: undefined }), /no verified mesh/);
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(asmManagement.execute(session, "upgrade", {}, meshResource), /Unsupported ASM operation/);
  assert.equal(writes.length, 0);
});

test("mesh inventory cannot hide missing or duplicate native identities", async t => {
  for (const items of [[{ ...runningMesh, metadata: { name: "broken" } }], [runningMesh, runningMesh]]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ items }));
    await assert.rejects(asmManagement.inventory(session), /unverified mesh inventory/);
  }
});

test("creation requires distinct current nodes from every selected cluster", async t => {
  const writes = mockCloud(t);
  for (const nodes of [[], [JSON.stringify(["cluster-2", "node-1"])], [JSON.stringify(["cluster-1", "gone"])], [JSON.stringify(["cluster-1", "node-1"]), '["cluster-1", "node-1"]']]) {
    await assert.rejects(asmManagement.execute(session, "create", { name: "app-mesh", clusters: ["cluster-1"], nodes }), /control-plane node|selected cluster/);
  }
  await assert.rejects(asmManagement.execute(session, "create", { name: "app-mesh", clusters: ["cluster-1", "cluster-1"], nodes: [JSON.stringify(["cluster-1", "node-1"])] }), /cluster only once/);
  assert.deepEqual(writes, []);
});

test("control-plane nodes are refreshed before creation and marker pages retain native identities", async t => {
  const reads: string[] = [], writes: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);reads.push(url.pathname + url.search);
    if (init.method) { writes.push(init.method);return Response.json({}); }
    if (url.pathname.endsWith("/nodes")) return Response.json(url.searchParams.get("marker") ? { items: [{ metadata: { uid: "node-2", name: "second" }, status: { phase: "Active" } }] } : { items: [{ metadata: { uid: "node-1", name: "first" }, status: { phase: "Installing" } }], pageInfo: { nextMarker: "next-original" } });
    return Response.json(read(url));
  });
  const choices = await asmManagement.options!(session, "create");
  assert.deepEqual(choices.nodes.map(choice => choice.value), [JSON.stringify(["cluster-1", "node-2"])]);
  assert.ok(reads.some(path => path.includes("marker=next-original")));
  await assert.rejects(asmManagement.execute(session, "create", { name: "app-mesh", clusters: ["cluster-1"], nodes: [JSON.stringify(["cluster-1", "node-1"])] }), /currently Ready/);
  assert.deepEqual(writes, []);
});

test("native transport errors, HTTP 200 errors, unknown phases, and credential destinations stay private", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_msg: "private-password" }, { status: 403 }));
  await assert.rejects(asmManagement.inventory(session), error => { assert.equal((error as { status: number }).status, 403);assert.ok(!String(error).includes("private-password"));return true; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ errorCode: "ASM.1", errorMsg: "private-password" }));
  await assert.rejects(asmManagement.inventory(session), error => !String(error).includes("private-password"));
  const privateMesh = { ...runningMesh, status: { phase: "private-password" }, spec: { ...runningMesh.spec, config: { telemetryConfig: { tracing: { extensionProviders: [{ name: "zipkin", zipkin: { service: "https://user:private-password@trace.example?token=private-token", port: 9411 } }] } } } } };
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(new URL(input).pathname.endsWith(meshId) ? privateMesh : { items: [privateMesh] }));
  const result = await asmManagement.execute(session, "inspect", {}, meshResource);
  assert.ok(!JSON.stringify(result.facts!.find(fact => fact.label === "Tracing extension providers")).includes("private-password"));
  const outcome = await asmManagement.poll!(session, { id: randomUUID(), service: "asm", operation: "Create mesh", state: "submitted", startedAt: new Date().toISOString(), jobId: meshId, resourceId: meshId });
  assert.equal(outcome.state, "submitted");assert.ok(!JSON.stringify(outcome).includes("private-password"));
});

test("deletion history cannot substitute a different original mesh identity", async t => {
  mockCloud(t);
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "asm", operation: "Delete mesh", state: "submitted", startedAt: new Date().toISOString(), jobId: meshId, resourceId: "foreign" };
  await assert.rejects(asmManagement.poll!(session, entry), /different mesh identity/);
  await assert.rejects(asmManagement.poll!(session, { ...entry, resourceId: meshId, resourceName: "foreign-name" }), /different mesh name/);
});
