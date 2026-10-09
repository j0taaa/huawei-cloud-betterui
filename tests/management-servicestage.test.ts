import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { serviceStageManagement } from "@/lib/huawei/management/adapters/servicestage";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const applicationRows = [
  { id: "app-1", name: "Web App", description: "Main application", enterprise_project_id: "0", project_id: "project-1", component_count: 1, creator: "user-1", create_time: 1700000000000, update_time: 1700000000000, labels: [{ key: "team", value: "core" }] },
  { id: "app-2", name: "Empty App", description: "", enterprise_project_id: "0", project_id: "project-1", component_count: 0, creator: "user-1", create_time: 1700000000000, update_time: 1700000000000, labels: [] },
];
const environmentRowsFixture = [
  { id: "env-1", name: "Production", description: "Primary", project_id: "project-1", enterprise_project_id: "0", vpc_id: "vpc-1", deploy_mode: "container", creator: "user-1", create_time: 1700000000000, update_time: 1700000000000, labels: [{ key: "env", value: "prod" }] },
  { id: "env-2", name: "Sandbox", description: "", project_id: "project-1", enterprise_project_id: "0", vpc_id: "vpc-1", deploy_mode: "container", creator: "user-1", create_time: 1700000000000, update_time: 1700000000000, labels: [] },
  { id: "env-3", name: "Virtual Machines", description: "", project_id: "project-1", enterprise_project_id: "0", vpc_id: "vpc-1", deploy_mode: "virtualmachine", creator: "user-1", create_time: 1700000000000, update_time: 1700000000000, labels: [] },
];
const componentFixture = {
  id: "comp-1", name: "api", application_id: "app-1", application_name: "Web App", environment_id: "env-1", environment_name: "Production", version: "1.0.0", platform_type: "cce",
  runtime_stack: { name: "Docker", type: "Docker", version: "1.0", deploy_mode: "container" },
  source: { kind: "image", url: "swr.example/team/api:v1" },
  status: { component_status: "RUNNING", replica: 2, available_replica: 2, last_job_id: "job-old" },
  external_accesses: [{ protocol: "http", address: "elb-1", forward_port: 8080 }],
};
const componentInfoFixture = {
  ...componentFixture, description: "Front door", environment_id: "env-1", application_id: "app-1",
  envs: [{ name: "TOKEN", value: "supersecret" }],
  refer_resources: [{ id: "cluster-1", type: "cce", parameters: { namespace: "web" } }],
};
const recordRows = [
  { instance_id: "i-3", version: "1.0.0", status: "SUCCESS", deploy_type: "container", current_used: true, begin_time: "2026-02-03 00:00:00", end_time: "2026-02-03 00:01:00", jobs: [{ job_id: "job-3", task_names: "raw" }], description: { note: "raw config" } },
  { instance_id: "i-2", version: "0.9.0", status: "SUCCESS", deploy_type: "container", current_used: false, begin_time: "2026-02-02 00:00:00", end_time: "2026-02-02 00:01:00", jobs: [], description: {} },
  { instance_id: "i-1", version: "0.8.0", status: "FAILED", deploy_type: "container", current_used: false, begin_time: "2026-02-01 00:00:00", end_time: "2026-02-01 00:01:00", jobs: [], description: {} },
];
const runtimeStacksFixture = [
  { name: "Docker", type: "Docker", version: "1.0", deploy_mode: "container", status: "Supported" },
  { name: "Java", type: "Java", version: "8", deploy_mode: "container", status: "Supported" },
  { name: "Tomcat", type: "Tomcat", version: "8", deploy_mode: "virtualmachine", status: "Supported" },
];
const clustersFixture = [
  { metadata: { uid: "cluster-1", name: "prod-cluster", creationTimestamp: "2026-01-01T00:00:00Z" }, spec: { type: "VirtualMachine", flavor: "cce.s1.small", version: "v1.30", hostNetwork: { vpc: "vpc-1", subnet: "network-1" }, billingMode: 0, authentication: { mode: "rbac" }, containerNetwork: { mode: "overlay_l2" } }, status: { phase: "Available" } },
  { metadata: { uid: "cluster-2", name: "other-vpc-cluster", creationTimestamp: "2026-01-01T00:00:00Z" }, spec: { type: "VirtualMachine", flavor: "cce.s1.small", version: "v1.30", hostNetwork: { vpc: "vpc-2", subnet: "network-2" }, billingMode: 0, authentication: { mode: "rbac" }, containerNetwork: { mode: "overlay_l2" } }, status: { phase: "Available" } },
  { metadata: { uid: "cluster-3", name: "shared-cluster", creationTimestamp: "2026-01-01T00:00:00Z" }, spec: { type: "VirtualMachine", flavor: "cce.s1.small", version: "v1.30", hostNetwork: { vpc: "vpc-1", subnet: "network-1" }, billingMode: 0, authentication: { mode: "rbac" }, containerNetwork: { mode: "overlay_l2" } }, status: { phase: "Available" } },
];

function read(url: URL) {
  const path = url.pathname;
  if (path === "/v3/project-1/cas/applications") return { count: applicationRows.length, applications: applicationRows };
  if (path === "/v3/project-1/cas/applications/app-1" || path === "/v3/project-1/cas/applications/app-2") return applicationRows.find((row) => row.id === path.split("/").at(-1));
  if (path === "/v3/project-1/cas/applications/app-1/components") return { count: 1, components: [componentFixture] };
  if (path === "/v3/project-1/cas/applications/app-2/components") return { count: 0, components: [] };
  if (path === "/v3/project-1/cas/applications/app-1/components/comp-1") return componentInfoFixture;
  if (path === "/v3/project-1/cas/applications/app-1/components/comp-1/records") return { count: recordRows.length, records: recordRows };
  if (path === "/v3/project-1/cas/environments") return { count: environmentRowsFixture.length, environments: environmentRowsFixture };
  if (path === "/v3/project-1/cas/environments/env-1" || path === "/v3/project-1/cas/environments/env-2") return { ...environmentRowsFixture.find((row) => row.id === path.split("/").at(-1)), resources: [{ id: "cluster-1", name: "prod-cluster", type: "cce" }] };
  if (path === "/v3/project-1/cas/environments/env-1/resources") return { resources: [{ id: "cluster-1", name: "prod-cluster", type: "cce" }] };
  if (path === "/v3/project-1/cas/components") return { count: 1, components: [componentFixture] };
  if (path === "/v3/project-1/cas/runtimestacks") return { runtime_stacks: runtimeStacksFixture, total: runtimeStacksFixture.length };
  if (path === "/v1/project-1/subnets") return { subnets: [{ id: "subnet-1", vpc_id: "vpc-1", cidr: "10.0.0.0/24", name: "main" }] };
  if (path === "/v3/project-1/elb/listeners") return { listeners: [], page_info: { next_marker: "" } };
  if (path === "/v3/project-1/cas/jobs/job-old") return { job: { job_id: "job-old", execution_status: "SUCCESS" }, tasks: [] };
  if (path === "/v3/project-1/vpc/vpcs") return { vpcs: [{ id: "vpc-1", name: "Main", cidr: "192.168.0.0/16" }, { id: "vpc-2", name: "Other", cidr: "10.0.0.0/16" }] };
  if (path === "/api/v3/projects/project-1/clusters") return { items: clustersFixture };
  if (path === "/v3/manage/repos") return { repos: [{ id: "101", name: "api", namespace_name: "team", num_images: 2 }] };
  if (path === "/v3/manage/namespaces/team/repos/api/tags") return { tags: [{ tag: "v1", digest: "sha256:abc", path: "swr.example/team/api:v1", size: 100 }, { tag: "v2", digest: "sha256:def", path: "swr.example/team/api:v2", size: 100 }] };
  if (path === "/v3/project-1/elb/loadbalancers") return { loadbalancers: [{ id: "elb-1", name: "Public LB", vip_address: "10.1.2.3", vip_subnet_cidr_id: "subnet-1", operating_status: "ONLINE", provisioning_status: "ACTIVE" }] };
  throw new Error(`Unexpected GET ${path}`);
}

function writeResponse(path: string) {
  if (path === "/v3/project-1/cas/applications") return { id: "app-new", name: "Fresh" };
  if (path === "/v3/project-1/cas/environments") return { id: "env-new", name: "Fresh" };
  if (path === "/v3/project-1/cas/applications/app-1/components") return { component_id: "comp-new", job_id: "job-deploy" };
  if (path === "/v3/project-1/cas/applications/app-1/components/comp-1/action") return { job_id: "job-action", result: "success" };
  return {};
}

function mockCloud(t: TestContext, overrides: Record<string, unknown> = {}) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(overrides[url.pathname] ?? read(url));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    writes.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(writeResponse(url.pathname));
  });
  return writes;
}

const applicationResource: ManagementResource = { id: "application:app-1", name: "Web App" };
const emptyApplicationResource: ManagementResource = { id: "application:app-2", name: "Empty App" };
const environmentResource: ManagementResource = { id: "environment:env-1", name: "Production" };
const emptyEnvironmentResource: ManagementResource = { id: "environment:env-2", name: "Sandbox" };
const componentResource: ManagementResource = { id: "component:app-1:comp-1", name: "api", status: "RUNNING" };
const dockerStack = JSON.stringify(["Docker", "Docker", "1.0", "container"]);
const deployValues: ManagementValues = { application: "app-1", name: "api", description: "Front door", environment: "env-1", image: "swr.example/team/api:v1", runtimeStack: dockerStack, version: "1.0.0", replica: 2, requestCpu: 0.5, limitCpu: 1, requestMemory: 1, limitMemory: 2, cluster: "cluster-1", namespace: "web", elb: "elb-1", protocol: "http", port: 8080 };

test("inventory maps native application, environment, and component envelopes", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname + new URL(input).search); return Response.json(read(new URL(input))); });
  const resources = await serviceStageManagement.inventory(session);
  assert.ok(reads.some((path) => path === "/v3/project-1/cas/applications?limit=100&offset=0"));
  assert.ok(reads.some((path) => path === "/v3/project-1/cas/environments?limit=100&offset=0"));
  assert.ok(reads.some((path) => path === "/v3/project-1/cas/components?limit=100&offset=0"));
  assert.deepEqual(resources.map((resource) => [resource.id, resource.name, resource.status ?? "-"]), [
    ["application:app-1", "Web App", "-"],
    ["application:app-2", "Empty App", "-"],
    ["environment:env-1", "Production", "-"],
    ["environment:env-2", "Sandbox", "-"],
    ["environment:env-3", "Virtual Machines", "-"],
    ["component:app-1:comp-1", "api", "RUNNING"],
  ]);
  const component = resources.find((resource) => resource.id === "component:app-1:comp-1")!;
  assert.equal(component.values?.applicationId, "app-1");
  assert.equal(component.values?.environmentId, "env-1");
  assert.equal(component.values?.runtimeStack, "Docker Docker 1.0");
  assert.equal(component.values?.replica, 2);
  const environment = resources.find((resource) => resource.id === "environment:env-1")!;
  assert.equal(environment.values?.deployMode, "container");
  assert.equal(environment.values?.vpcId, "vpc-1");
});

test("environment inventory walks native offset pages until the reported count", async (t) => {
  const offsets: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v3/project-1/cas/environments") {
      offsets.push(url.searchParams.get("offset") ?? "none");
      return Response.json({ count: 2, environments: url.searchParams.get("offset") === "0" ? [environmentRowsFixture[0]] : [environmentRowsFixture[1]] });
    }
    if (url.pathname === "/v3/project-1/cas/applications") return Response.json({ count: 0, applications: [] });
    if (url.pathname === "/v3/project-1/cas/components") return Response.json({ count: 0, components: [] });
    throw new Error(`Unexpected GET ${url.pathname}`);
  });
  const resources = await serviceStageManagement.inventory(session);
  const environments = resources.filter((resource) => resource.id.startsWith("environment:"));
  assert.deepEqual(offsets, ["0", "1"]);
  assert.deepEqual(environments.map((environment) => environment.id), ["environment:env-1", "environment:env-2"]);
});

test("create-application posts the documented body and returns the prefixed resource ID", async (t) => {
  const writes = mockCloud(t);
  const outcome = await serviceStageManagement.execute(session, "create-application", { name: "Fresh", description: "New grouping", enterpriseProjectId: "0" });
  assert.equal(outcome.resourceId, "application:app-new");
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v3/project-1/cas/applications", method: "POST", body: { name: "Fresh", description: "New grouping", enterprise_project_id: "0" } }]);
});

test("update-application preserves the enterprise project and labels from the current detail", async (t) => {
  const writes = mockCloud(t);
  const outcome = await serviceStageManagement.execute(session, "update-application", { name: "Renamed", description: "Updated" }, applicationResource);
  assert.equal(outcome.resourceId, "application:app-1");
  assert.deepEqual(writes, [{ path: "/v3/project-1/cas/applications/app-1", method: "PUT", body: { name: "Renamed", description: "Updated", enterprise_project_id: "0", labels: [{ key: "team", value: "core" }] } }]);
});

test("delete-application refuses applications with components and deletes empty ones", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(serviceStageManagement.execute(session, "delete-application", {}, applicationResource), /Delete the application's components first/);
  assert.equal(writes.length, 0);
  const outcome = await serviceStageManagement.execute(session, "delete-application", {}, emptyApplicationResource);
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(writes, [{ path: "/v3/project-1/cas/applications/app-2", method: "DELETE", body: undefined }]);
  const operation = serviceStageManagement.operations.find((item) => item.id === "delete-application")!;
  assert.equal(operation.confirmation, true);
  assert.ok(operation.impact);
});

test("create-environment validates live deploy modes and VPC membership before the write", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(serviceStageManagement.execute(session, "create-environment", { name: "Fresh", deployMode: "FORGED", vpc: "vpc-1" }), /no longer offered/);
  await assert.rejects(serviceStageManagement.execute(session, "create-environment", { name: "Fresh", deployMode: "container", vpc: "forged-vpc" }), /no longer available/);
  assert.equal(writes.length, 0);
  const outcome = await serviceStageManagement.execute(session, "create-environment", { name: "Fresh", description: "Scope", deployMode: "container", vpc: "vpc-1", enterpriseProjectId: "0" });
  assert.equal(outcome.resourceId, "environment:env-new");
  assert.deepEqual(writes, [{ path: "/v3/project-1/cas/environments", method: "POST", body: { name: "Fresh", description: "Scope", enterprise_project_id: "0", vpc_id: "vpc-1", deploy_mode: "container" } }]);
  const choices = await serviceStageManagement.options!(session, "create-environment");
  assert.deepEqual(choices.deployModes.map((choice) => choice.value), ["container", "virtualmachine"]);
  assert.deepEqual(choices.vpcs.map((choice) => choice.value), ["vpc-1", "vpc-2"]);
});

test("update-environment preserves labels and attach-cluster preserves existing resources", async (t) => {
  const writes = mockCloud(t);
  await serviceStageManagement.execute(session, "update-environment", { name: "Renamed" }, environmentResource);
  await assert.rejects(serviceStageManagement.execute(session, "attach-cluster", { cluster: "cluster-1" }, environmentResource), /already attached/);
  await assert.rejects(serviceStageManagement.execute(session, "attach-cluster", { cluster: "cluster-2" }, environmentResource), /different VPC/);
  await assert.rejects(serviceStageManagement.execute(session, "attach-cluster", { cluster: "forged" }, environmentResource), /no longer available/);
  await serviceStageManagement.execute(session, "attach-cluster", { cluster: "cluster-3" }, environmentResource);
  assert.deepEqual(writes, [
    { path: "/v3/project-1/cas/environments/env-1", method: "PUT", body: { name: "Renamed", description: "Primary", enterprise_project_id: "0", labels: [{ key: "env", value: "prod" }] } },
    { path: "/v3/project-1/cas/environments/env-1/resources", method: "PUT", body: { resources: [{ id: "cluster-1", name: "prod-cluster", type: "cce" }, { id: "cluster-3", name: "shared-cluster", type: "cce" }] } },
  ]);
});

test("delete-environment refuses environments with deployed components and deletes empty ones", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(serviceStageManagement.execute(session, "delete-environment", {}, environmentResource), /Delete the components deployed in this environment first/);
  assert.equal(writes.length, 0);
  await serviceStageManagement.execute(session, "delete-environment", {}, emptyEnvironmentResource);
  assert.deepEqual(writes, [{ path: "/v3/project-1/cas/environments/env-2", method: "DELETE", body: undefined }]);
});

test("create-component sends the documented deployment payload from revalidated live choices", async (t) => {
  const writes = mockCloud(t);
  const outcome = await serviceStageManagement.execute(session, "create-component", deployValues);
  assert.equal(outcome.resourceId, "component:app-1:comp-new");
  assert.equal(outcome.jobId, "job-deploy");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/cas/applications/app-1/components", method: "POST", body: {
    name: "api", description: "Front door",
    runtime_stack: { name: "Docker", type: "Docker", version: "1.0", deploy_mode: "container" },
    source: { kind: "image", url: "swr.example/team/api:v1" },
    environment_id: "env-1", replica: 2,
    request_cpu: 0.5, request_memory: 1, limit_cpu: 1, limit_memory: 2,
    version: "1.0.0",
    refer_resources: [{ id: "cluster-1", type: "cce", parameters: { namespace: "web" } }, { id: "elb-1", type: "elb" }],
    external_accesses: [{ protocol: "http", address: "10.1.2.3", forward_port: 8080 }],
  } }]);
});

test("create-component rejects stale or forged selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const deployWithoutAccess: ManagementValues = { ...deployValues };
  delete deployWithoutAccess.elb;
  delete deployWithoutAccess.port;
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...deployValues, application: "app-x" }, /application no longer exists/],
    [{ ...deployValues, environment: "env-x" }, /environment no longer exists/],
    [{ ...deployValues, environment: "env-3" }, /does not match the environment's deployment mode/],
    [{ ...deployValues, image: "swr.example/team/api:v9" }, /SWR image is no longer available/],
    [{ ...deployValues, runtimeStack: JSON.stringify(["Docker", "Docker", "9.9", "container"]) }, /runtime stack is no longer available/],
    [{ ...deployValues, runtimeStack: JSON.stringify(["Java", "Java", "8", "container"]) }, /Only Docker runtime stacks/],
    [{ ...deployValues, runtimeStack: "not-json" }, /Select an available container runtime stack/],
    [{ ...deployValues, cluster: "cluster-x" }, /cluster is no longer available/],
    [{ ...deployValues, cluster: "cluster-2" }, /different VPC than this environment/],
    [{ ...deployValues, cluster: "cluster-3" }, /not attached to this environment/],
    [{ ...deployValues, elb: "elb-x" }, /load balancer is no longer available/],
    [{ ...deployWithoutAccess, port: 8080 }, /Select a load balancer/],
    [{ ...deployWithoutAccess, elb: "elb-1" }, /Enter the external access port/],
    [{ ...deployValues, requestCpu: 2 }, /must not exceed/],
    [{ ...deployValues, requestMemory: 4 }, /must not exceed/],
    [{ ...deployValues, replica: 0 }, /whole number from 1 to 100/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(serviceStageManagement.execute(session, "create-component", values), expression);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live component deployment choices", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = serviceStageManagement.operations.find((item) => item.id === "create-component")!;
  const choices = await serviceStageManagement.options!(session, "create-component");
  assert.deepEqual(choices.applications.map((choice) => choice.value), ["app-1", "app-2"]);
  assert.deepEqual(choices.environments.map((choice) => choice.value), ["env-1", "env-2", "env-3"]);
  assert.deepEqual(choices.runtimeStacks.map((choice) => choice.value), [dockerStack]);
  assert.ok(choices.runtimeStacks.every((choice) => !choice.value.includes("Java")));
  assert.deepEqual(choices.clusters.map((choice) => choice.value), ["cluster-1", "cluster-2", "cluster-3"]);
  assert.deepEqual(choices.elbs.map((choice) => choice.value), ["elb-1"]);
  assert.deepEqual(choices.images.map((choice) => choice.value), ["swr.example/team/api:v1", "swr.example/team/api:v2"]);
  const values = validateManagementValues(operation, deployValues, choices);
  assert.equal(values.name, "api");
  assert.throws(() => validateManagementValues(operation, { ...deployValues, application: "forged" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...deployValues, image: "swr.example/team/api:v9" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...deployValues, version: "1.0" }, choices), /invalid format/);
  assert.throws(() => validateManagementValues(operation, { ...deployValues, replica: 0 }, choices), /at least 1/);
  assert.throws(() => validateManagementValues(operation, { ...deployValues, requestCpu: "0.5" }, choices), /finite number/);
});

test("component actions use the native action endpoint and guard replica changes", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(serviceStageManagement.execute(session, "scale", { replica: 2 }, componentResource), /already runs 2 replica/);
  await assert.rejects(serviceStageManagement.execute(session, "scale", { replica: 0 }, componentResource), /whole number from 1 to 100/);
  assert.equal(writes.length, 0);
  for (const [operation, action] of [["stop", "stop"], ["restart", "restart"]] as const) {
    const outcome = await serviceStageManagement.execute(session, operation, {}, componentResource);
    assert.equal(outcome.jobId, "job-action");
    assert.equal(outcome.asynchronous, true);
    assert.equal(outcome.resourceId, "component:app-1:comp-1");
    assert.equal(writes.at(-1)?.path, "/v3/project-1/cas/applications/app-1/components/comp-1/action");
    assert.deepEqual(writes.at(-1)?.body, { action });
  }
  const scaled = await serviceStageManagement.execute(session, "scale", { replica: 3 }, componentResource);
  assert.equal(scaled.jobId, "job-action");
  assert.deepEqual(writes.at(-1), { path: "/v3/project-1/cas/applications/app-1/components/comp-1/action", method: "POST", body: { action: "scale", parameters: { replica: 3 } } });
  const stopOperation = serviceStageManagement.operations.find((item) => item.id === "stop")!;
  assert.equal(stopOperation.confirmation, true);
  assert.ok(stopOperation.impact);
  assert.deepEqual(stopOperation.allowedStatuses, ["RUNNING"]);
});

test("rollback revalidates historical records and refuses the current or failed versions", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(serviceStageManagement.execute(session, "rollback", { version: "1.0.0" }, componentResource), /current version/);
  await assert.rejects(serviceStageManagement.execute(session, "rollback", { version: "0.8.0" }, componentResource), /Only successful historical versions/);
  await assert.rejects(serviceStageManagement.execute(session, "rollback", { version: "ghost" }, componentResource), /was not found/);
  assert.equal(writes.length, 0);
  const outcome = await serviceStageManagement.execute(session, "rollback", { version: "0.9.0" }, componentResource);
  assert.equal(outcome.jobId, "job-action");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v3/project-1/cas/applications/app-1/components/comp-1/action", method: "POST", body: { action: "rollback", parameters: { version: "0.9.0" } } }]);
  const choices = await serviceStageManagement.options!(session, "rollback", componentResource);
  assert.deepEqual(choices.rollbackVersions.map((choice) => choice.value), ["0.9.0"]);
});

test("inspect-component reports configuration without exposing environment variable values", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const outcome = await serviceStageManagement.execute(session, "inspect-component", {}, componentResource);
  assert.ok(outcome.facts!.some((fact) => fact.label === "Environment variables" && fact.value === "1 configured (values are never displayed)"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Source" && fact.value === "image · swr.example/team/api:v1"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Referenced cce" && fact.value === "cluster-1"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "External access · http" && fact.value === "elb-1:8080"));
  assert.ok(!JSON.stringify(outcome).includes("supersecret"));
});

test("component records show deployment history without raw job payloads", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const outcome = await serviceStageManagement.execute(session, "component-records", {}, componentResource);
  assert.equal(outcome.message, "3 deployment records loaded.");
  assert.ok(outcome.facts!.some((fact) => fact.label === "0.9.0 · SUCCESS" && fact.value.includes("container")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "1.0.0 · SUCCESS · current"));
  assert.ok(!JSON.stringify(outcome).includes("raw config"));
  assert.ok(!JSON.stringify(outcome).includes("job-3"));
});

test("delete-component uses the native method and is restricted to settled states", async (t) => {
  const writes = mockCloud(t);
  const outcome = await serviceStageManagement.execute(session, "delete-component", {}, componentResource);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, componentResource.id);
  assert.deepEqual(writes, [{ path: "/v3/project-1/cas/applications/app-1/components/comp-1", method: "DELETE", body: undefined }]);
  const operation = serviceStageManagement.operations.find((item) => item.id === "delete-component")!;
  assert.deepEqual(operation.allowedStatuses, ["RUNNING", "FAILED", "DOWN"]);
  assert.equal(operation.confirmation, true);
  assert.ok(operation.impact);
});

test("poll maps native job states, preserves the original task identity, and never surfaces raw task messages", async (t) => {
  const replies = [
    { task_count: 1, job: { job_id: "job-deploy", execution_status: "PROCESSING", job_type: "deploy" }, tasks: [{ task_id: "t-1", task_name: "Deploy", task_status: "PROCESSING", messages: "internal details" }] },
    { task_count: 1, job: { job_id: "job-deploy", execution_status: "SUCCESS", job_type: "deploy" }, tasks: [{ task_id: "t-1", task_name: "Deploy", task_status: "SUCCESS" }] },
    { task_count: 1, job: { job_id: "job-deploy", execution_status: "ERROR", job_type: "deploy" }, tasks: [{ task_id: "t-1", task_name: "Deploy", task_status: "ERROR", messages: "secret log details" }] },
    { task_count: 0, job: { job_id: "other-job", execution_status: "SUCCESS" }, tasks: [] },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname, "/v3/project-1/cas/jobs/job-deploy"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "servicestage", operation: "Deploy container component", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-deploy" };
  const processing = await serviceStageManagement.poll!(session, entry);
  assert.equal(processing.state, "submitted");
  const succeeded = await serviceStageManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  const failed = await serviceStageManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /ServiceStage job failed/);
  assert.ok(!failed.message!.includes("secret log details"));
  await assert.rejects(serviceStageManagement.poll!(session, entry), /different ServiceStage job/);
});

test("component identity requires a verified parent and current project membership", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(serviceStageManagement.execute(session, "stop", {}, { id: "component:app-1", name: "api" }), /Select a current ServiceStage component/);
  await assert.rejects(serviceStageManagement.execute(session, "stop", {}, { id: "component:app-1:ghost", name: "api" }), /no longer exists in this project/);
  await assert.rejects(serviceStageManagement.execute(session, "stop", {}, { id: "component:app-2:comp-1", name: "api" }), /different application/);
  assert.equal(writes.length, 0);
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(serviceStageManagement.execute(session, "resize", {}, componentResource), /Unsupported ServiceStage operation/);
  await assert.rejects(serviceStageManagement.execute(session, "update-application", { name: "X" }, environmentResource), /Select a current ServiceStage application/);
  assert.equal(writes.length, 0);
});

test("billing and availability impacts are explicit on mutating operations", () => {
  for (const id of ["create-environment", "attach-cluster", "create-component", "stop", "restart", "scale", "rollback", "delete-component", "delete-application", "delete-environment"]) {
    const operation = serviceStageManagement.operations.find((item) => item.id === id)!;
    assert.ok(operation.impact, `${id} must declare an impact`);
  }
  for (const id of ["attach-cluster", "stop", "restart", "scale", "rollback", "delete-component", "delete-application", "delete-environment"]) {
    const operation = serviceStageManagement.operations.find((item) => item.id === id)!;
    assert.equal(operation.confirmation, true, `${id} must require confirmation`);
  }
  const deploy = serviceStageManagement.operations.find((item) => item.id === "create-component")!;
  assert.match(deploy.impact!, /billed/);
  assert.match(deploy.description, /Environment variables.*not configured/);
  const createApplication = serviceStageManagement.operations.find((item) => item.id === "create-application")!;
  assert.match(createApplication.description, /no billed workload/);
});

const componentPath = "/v3/project-1/cas/applications/app-1/components/comp-1";
const environmentPath = "/v3/project-1/cas/environments/env-1";

test("start rechecks the current stopped state rather than trusting a selected row", async t => {
  const writes = mockCloud(t, { [componentPath]: { ...componentInfoFixture, status: { ...componentFixture.status, component_status: "DOWN" } } });
  const outcome = await serviceStageManagement.execute(session, "start", {}, componentResource);
  assert.equal(outcome.jobId, "job-action");
  assert.deepEqual(writes[0].body, { action: "start" });
});

test("every component mutation rejects an unknown or busy detail status", async t => {
  const writes = mockCloud(t, { [componentPath]: { ...componentInfoFixture, status: { ...componentFixture.status, component_status: "DEPLOYING" } } });
  for (const [operation, values] of [["restart", {}], ["stop", {}], ["scale", { replica: 3 }], ["rollback", { version: "0.9.0" }], ["delete-component", {}]] as [string, ManagementValues][]) await assert.rejects(serviceStageManagement.execute(session, operation, values, componentResource), /status DEPLOYING/);
  assert.deepEqual(writes, []);
});

test("settled component states cannot hide an active or unrelated native deployment job", async t => {
  const replies: Record<string, unknown> = { "/v3/project-1/cas/jobs/job-old": { job: { job_id: "job-old", execution_status: "PROCESSING" } } };
  const writes = mockCloud(t, replies);
  await assert.rejects(serviceStageManagement.execute(session, "delete-component", {}, componentResource), /active or unverified deployment/);
  replies["/v3/project-1/cas/jobs/job-old"] = { job: { job_id: "foreign-job", execution_status: "SUCCESS" } };
  await assert.rejects(serviceStageManagement.execute(session, "restart", {}, componentResource), /active or unverified deployment/);
  assert.deepEqual(writes, []);
});

test("component detail must retain the application and environment from complete live inventory", async t => {
  const writes = mockCloud(t, { [componentPath]: { ...componentInfoFixture, environment_id: "env-foreign" } });
  await assert.rejects(serviceStageManagement.execute(session, "restart", {}, componentResource), /different application or environment/);
  assert.deepEqual(writes, []);
});

test("the current runtime_stacks envelope filters disabled and deprecated stacks", async t => {
  mockCloud(t, { "/v3/project-1/cas/runtimestacks": { runtime_stacks: [{ ...runtimeStacksFixture[0], status: "Disable" }, { ...runtimeStacksFixture[1], status: "Deprecated" }], total: 2 } });
  assert.deepEqual((await serviceStageManagement.options!(session, "create-component")).runtimeStacks, []);
  await assert.rejects(serviceStageManagement.execute(session, "create-component", deployValues), /runtime stack is no longer available/);
});

test("environment updates refuse variable settings that cannot safely round-trip", async t => {
  const writes = mockCloud(t, { [environmentPath]: { ...environmentRowsFixture[0], configuration: { envs: [{ name: "API_KEY", value: "********" }] } } });
  await assert.rejects(serviceStageManagement.execute(session, "update-environment", { name: "new-name" }, environmentResource), /cannot be safely round-tripped/);
  assert.deepEqual(writes, []);
});

test("resource attachments cannot discard existing Kubernetes credentials or resource parameters", async t => {
  const writes = mockCloud(t, { [environmentPath + "/resources"]: { resources: [{ id: "custom-1", type: "custom_k8s", name: "private", parameters: { kube_config: "private-cluster-token" } }] } });
  await assert.rejects(serviceStageManagement.execute(session, "attach-cluster", { cluster: "cluster-3" }, environmentResource), error => {
    assert.match(String(error), /cannot be safely preserved/);
    assert.ok(!String(error).includes("private-cluster-token"));return true;
  });
  assert.deepEqual(writes, []);
});

test("malformed component rows cannot disappear from environment deletion guards", async t => {
  const writes = mockCloud(t, { "/v3/project-1/cas/components": { components: [{ ...componentFixture, id: "" }], count: 1 } });
  await assert.rejects(serviceStageManagement.execute(session, "delete-environment", {}, emptyEnvironmentResource), /unverified ServiceStage inventory/);
  assert.deepEqual(writes, []);
});

test("component provisioning requires a currently available CCE cluster", async t => {
  const writes = mockCloud(t, { "/api/v3/projects/project-1/clusters": { items: [{ ...clustersFixture[0], status: { phase: "Upgrading" } }] } });
  await assert.rejects(serviceStageManagement.execute(session, "create-component", deployValues), /not currently Available/);
  assert.deepEqual(writes, []);
});

test("external access preserves owned ELB identity and refuses occupied ports or another VPC", async t => {
  const replies: Record<string, unknown> = { "/v3/project-1/elb/listeners": { listeners: [{ id: "listener-1", protocol_port: 8080 }], page_info: { next_marker: "" } } };
  const writes = mockCloud(t, replies);
  await assert.rejects(serviceStageManagement.execute(session, "create-component", deployValues), /port is already occupied/);
  replies["/v3/project-1/elb/listeners"] = { listeners: [], page_info: { next_marker: "" } };
  replies["/v1/project-1/subnets"] = { subnets: [{ id: "subnet-1", vpc_id: "vpc-foreign", name: "foreign", cidr: "10.0.0.0/24" }] };
  await assert.rejects(serviceStageManagement.execute(session, "create-component", deployValues), /does not belong to this environment VPC/);
  assert.deepEqual(writes, []);
});

test("HTTP 200 native errors and transport failures do not leak private deployment payloads", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_code: "SVCSTG.123", error_msg: "private-image-password" }));
  await assert.rejects(serviceStageManagement.execute(session, "create-application", { name: "Fresh" }), error => { assert.match(String(error), /Huawei rejected this ServiceStage request/);assert.ok(!String(error).includes("private-image-password"));return true; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_msg: "private-image-password" }, { status: 503 }));
  await assert.rejects(serviceStageManagement.inventory(session), error => { assert.equal((error as { status: number }).status, 503);assert.ok(!String(error).includes("private-image-password"));return true; });
});

test("inspection omits credential-bearing image addresses and job failure task names", async t => {
  mockCloud(t, { [componentPath]: { ...componentInfoFixture, source: { kind: "image", url: "https://user:private-password@registry.example/image?token=private-token" } } });
  assert.ok(!JSON.stringify(await serviceStageManagement.execute(session, "inspect-component", {}, componentResource)).includes("private-password"));
  t.mock.method(globalThis, "fetch", async () => Response.json({ job: { job_id: "job-deploy", execution_status: "ERROR" }, tasks: [{ task_name: "private-password", messages: "private-token" }] }));
  const outcome = await serviceStageManagement.poll!(session, { id: randomUUID(), service: "servicestage", operation: "Deploy container component", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-deploy", resourceId: "component:app-1:comp-1" });
  assert.equal(outcome.state, "failed");assert.ok(!JSON.stringify(outcome).includes("private-password"));
});

test("deletion without a native job observes the original component and only completes after a native 404", async t => {
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "servicestage", operation: "Delete component", startedAt: new Date().toISOString(), state: "submitted", jobId: componentResource.id, resourceId: componentResource.id, resourceName: componentResource.name };
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(String(input)).pathname, componentPath);return Response.json(componentInfoFixture); });
  assert.equal((await serviceStageManagement.poll!(session, entry)).state, "submitted");
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_msg: "absent" }, { status: 404 }));
  assert.equal((await serviceStageManagement.poll!(session, entry)).state, "succeeded");
  await assert.rejects(serviceStageManagement.poll!(session, { ...entry, resourceId: "component:app-2:foreign" }), /different component identity/);
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 403 }));
  await assert.rejects(serviceStageManagement.poll!(session, entry), error => (error as { status: number }).status === 403);
});

test("resource attachment preserves aliases while rejecting malformed existing resource rows", async t => {
  const replies: Record<string, unknown> = { [environmentPath + "/resources"]: { resources: [{ id: "cluster-1", name: "prod", type: "cce", alias: "primary" }] } };
  const writes = mockCloud(t, replies);
  await serviceStageManagement.execute(session, "attach-cluster", { cluster: "cluster-3" }, environmentResource);
  assert.deepEqual((writes[0].body as { resources: unknown[] }).resources[0], { id: "cluster-1", name: "prod", type: "cce", alias: "primary" });
  replies[environmentPath + "/resources"] = { resources: [{ id: "", type: "cce" }] };
  await assert.rejects(serviceStageManagement.execute(session, "attach-cluster", { cluster: "cluster-3" }, environmentResource), /unverified ServiceStage inventory/);
  assert.equal(writes.length, 1);
});

test("incomplete runtime catalogs and unknown environment enterprise scope fail closed", async t => {
  const replies: Record<string, unknown> = { "/v3/project-1/cas/runtimestacks": { runtime_stacks: runtimeStacksFixture, total: runtimeStacksFixture.length + 1 } };
  const writes = mockCloud(t, replies);
  await assert.rejects(serviceStageManagement.execute(session, "create-component", deployValues), /incomplete ServiceStage runtime/);
  replies[environmentPath] = { ...environmentRowsFixture[0], enterprise_project_id: undefined };
  await assert.rejects(serviceStageManagement.execute(session, "update-environment", { name: "new-name" }, environmentResource), /enterprise project could not be preserved/);
  assert.deepEqual(writes, []);
});

test("malformed environment settings and resource parameters never become empty updates", async t => {
  const replies: Record<string, unknown> = { [environmentPath]: { ...environmentRowsFixture[0], configuration: "private-setting" } };
  const writes = mockCloud(t, replies);
  await assert.rejects(serviceStageManagement.execute(session, "update-environment", { name: "new-name" }, environmentResource), /cannot be safely round-tripped/);
  replies[environmentPath] = environmentRowsFixture[0];
  replies[environmentPath + "/resources"] = { resources: [{ id: "cluster-1", name: "prod", type: "cce", parameters: ["private-setting"] }] };
  await assert.rejects(serviceStageManagement.execute(session, "attach-cluster", { cluster: "cluster-3" }, environmentResource), /cannot be safely preserved/);
  assert.deepEqual(writes, []);
});
