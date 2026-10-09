import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { cceManagement } from "@/lib/huawei/management/adapters/cce";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const clusterA = {
  kind: "Cluster", apiVersion: "v3",
  metadata: { name: "cluster-a", uid: "cluster-1", alias: "Cluster A", creationTimestamp: "2026-01-01T00:00:00Z", annotations: { totalNodesNumber: "2", activeNodesNumber: "2" } },
  spec: { type: "VirtualMachine", flavor: "cce.s2.small", version: "v1.30", description: "Main cluster", billingMode: 0, hostNetwork: { vpc: "vpc-1", subnet: "network-1", SecurityGroup: "sg-1" }, containerNetwork: { mode: "overlay_l2", cidrs: [{ cidr: "172.16.0.0/16" }] }, authentication: { mode: "rbac" } },
  status: { phase: "Available", totalNodesNumber: 2, activeNodesNumber: 2 },
};
const clusterEmpty = {
  kind: "Cluster", apiVersion: "v3",
  metadata: { name: "cluster-empty", uid: "cluster-2", creationTimestamp: "2026-01-02T00:00:00Z" },
  spec: { type: "VirtualMachine", flavor: "cce.s1.small", version: "v1.29", billingMode: 0, hostNetwork: { vpc: "vpc-1", subnet: "network-1" }, containerNetwork: { mode: "vpc-router" }, authentication: { mode: "rbac" } },
  status: { phase: "Available", totalNodesNumber: 0 },
};
const clusterGuarded = {
  kind: "Cluster", apiVersion: "v3",
  metadata: { name: "cluster-guarded", uid: "cluster-3", creationTimestamp: "2026-01-03T00:00:00Z" },
  spec: { type: "VirtualMachine", flavor: "cce.s1.small", version: "v1.28", billingMode: 0, hostNetwork: { vpc: "vpc-1", subnet: "network-1" }, containerNetwork: { mode: "overlay_l2" } },
  status: { phase: "Available", totalNodesNumber: 0 },
};
const nodePoolA = { kind: "NodePool", apiVersion: "v3", metadata: { name: "pool-a", uid: "pool-1" }, spec: { type: "vm", initialNodeCount: 2, nodeTemplate: { flavor: "s6.large.2", az: "az-1", os: "Huawei Cloud EulerOS 2.0", login: { sshKey: "key-1" }, rootVolume: { volumetype: "SAS", size: 40 }, dataVolumes: [{ volumetype: "SAS", size: 100 }], billingMode: 0 } }, status: { currentNode: 2, creatingNode: 0, deletingNode: 0, phase: "" } };
const nodePoolB = { kind: "NodePool", apiVersion: "v3", metadata: { name: "pool-b", uid: "pool-2" }, spec: { type: "vm", initialNodeCount: 0, nodeTemplate: { flavor: "s6.medium.2", az: "az-2", login: { sshKey: "key-1" }, rootVolume: { volumetype: "SSD", size: 60 }, dataVolumes: [{ volumetype: "SSD", size: 100 }], billingMode: 0 } }, status: { currentNode: 0, creatingNode: 0, deletingNode: 0, phase: "" } };
const nodePoolGuarded = { kind: "NodePool", apiVersion: "v3", metadata: { name: "pool-c", uid: "pool-3" }, spec: { type: "vm", nodeTemplate: { flavor: "s6.large.2", az: "az-1", login: { sshKey: "key-1" }, rootVolume: { volumetype: "SAS", size: 40 }, dataVolumes: [{ volumetype: "SAS", size: 100 }] } }, status: { currentNode: 1, creatingNode: 0, deletingNode: 0 } };
const addonCoredns = { kind: "Addon", apiVersion: "v3", metadata: { uid: "addon-1", name: "coredns", alias: "CoreDNS" }, spec: { clusterID: "cluster-1", version: "1.13.6", addonTemplateName: "coredns", addonTemplateType: "helm", values: { basic: { cluster_ip: "10.247.3.10" }, custom: { stub_domains: "" }, flavor: { name: 2500, replicas: 2 } } }, status: { status: "running", targetVersions: ["1.14.0"] } };
const addonCustom = { kind: "Addon", apiVersion: "v3", metadata: { uid: "addon-2", name: "custom-addon", alias: "Custom Addon" }, spec: { clusterID: "cluster-1", version: "1.0.0", addonTemplateName: "custom-addon", addonTemplateType: "helm" }, status: { status: "running", targetVersions: [] } };
const corednsTemplate = { kind: "Addon", apiVersion: "v3", metadata: { name: "coredns", alias: "CoreDNS" }, spec: { type: "helm", require: true, description: "DNS server", versions: [{ version: "1.13.6", stable: true, input: { basic: { cluster_ip: "10.247.3.10", swr_addr: "swr.example.invalid:20202" }, parameters: { custom: { stub_domains: "", upstream_nameservers: "" }, flavor1: { name: 2500, replicas: 2 }, flavor2: { name: 5000, replicas: 2 } } } }] } };
const customTemplate = { kind: "Addon", apiVersion: "v3", metadata: { name: "custom-addon", alias: "Custom Addon" }, spec: { type: "helm", require: false, description: "Optional addon", versions: [{ version: "1.0.0", stable: true, input: { basic: { platform: "linux-amd64" }, parameters: { custom: { mode: "simple" } } } }] } };
const metricsTemplate = { kind: "Addon", apiVersion: "v3", metadata: { name: "metrics-server", alias: "Metrics Server" }, spec: { type: "helm", require: false, description: "Metrics addon", versions: [{ version: "1.2.0", stable: true, input: { basic: { platform: "linux-amd64", swr_addr: "swr.example.invalid:20202" }, parameters: { custom: { mode: "standard" }, flavor1: { name: 100, replicas: 2 }, flavor2: { name: 200, replicas: 2 } } } }] } };

function read(url: URL) {
  const path = url.pathname;
  if (path === "/api/v3/projects/project-1/clusters") return { items: [clusterA, clusterEmpty, clusterGuarded] };
  if (path === "/api/v3/projects/project-1/clusters/cluster-1") return clusterA;
  if (path === "/api/v3/projects/project-1/clusters/cluster-2") return clusterEmpty;
  if (path === "/api/v3/projects/project-1/clusters/cluster-3") return clusterGuarded;
  if (path === "/api/v3/projects/project-1/clusters/cluster-1/nodepools") return { items: [nodePoolA, nodePoolB] };
  if (path === "/api/v3/projects/project-1/clusters/cluster-2/nodes") return { items: [] };
  if (path === "/api/v3/projects/project-1/clusters/cluster-2/nodepools") return { items: [] };
  if (path === "/api/v3/projects/project-1/clusters/cluster-3/nodepools") return { items: [nodePoolGuarded] };
  if (path === "/api/v3/projects/project-1/clusters/cluster-1/configuration/detail") return { "kube-apiserver": [{ name: "default-not-ready-toleration-seconds", default: 300, validAt: "immediately", empty: true, schema: "kubernetes", type: "int" }] };
  if (path === "/api/v3/addons") return { items: [addonCoredns, addonCustom] };
  if (path === "/api/v3/addons/addon-1") return addonCoredns;
  if (path === "/api/v3/addontemplates") return { items: [corednsTemplate, customTemplate, metricsTemplate] };
  if (path === "/v3/project-1/vpc/vpcs") return { vpcs: [{ id: "vpc-1", name: "Vpc One", cidr: "10.0.0.0/16" }] };
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", name: "Subnet One", cidr: "10.0.1.0/24", vpc_id: "vpc-1", neutron_network_id: "network-1", availability_zone: "az-1" },
    { id: "subnet-2", name: "Subnet Two", cidr: "10.1.1.0/24", vpc_id: "vpc-2", neutron_network_id: "network-2", availability_zone: "az-1" },
  ] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Cce Nodes" }] };
  if (path === "/v1/project-1/cloudservers/flavors") return { flavors: [
    { id: "s6.large.2", name: "s6.large.2", vcpus: "2", ram: 4096, "os-flavor-access:is_public": true },
    { id: "s6.medium.2", name: "s6.medium.2", vcpus: "1", ram: 2048, "os-flavor-access:is_public": true },
  ] };
  if (path === "/v2.1/project-1/os-availability-zone") return { availabilityZoneInfo: [
    { zoneName: "az-1", zoneState: { available: true } },
    { zoneName: "az-2", zoneState: { available: true } },
    { zoneName: "az-3", zoneState: { available: false } },
  ] };
  if (path === "/v2.1/project-1/os-keypairs") return { keypairs: [{ keypair: { name: "key-1" } }] };
  if (path === "/v2/cloudimages") {
    const type = url.searchParams.get("__imagetype");
    return { images: type === "private" ? [{ id: "img-1", name: "Hardened Node", status: "active", __imagetype: "private", __os_type: "Linux", __whole_image: false }] : [] };
  }
  throw new Error(`Unexpected GET ${path}`);
}

function writeResponse(url: URL, method: string) {
  const path = url.pathname;
  if (method === "POST" && path === "/api/v3/projects/project-1/clusters") return { metadata: { uid: "cluster-new" }, status: { jobID: "job-create", phase: "Creating" } };
  if (method === "DELETE" && path === "/api/v3/projects/project-1/clusters/cluster-2") return { metadata: { uid: "cluster-2" }, status: { jobID: "job-delete", phase: "Deleting" } };
  if (method === "POST" && path === "/api/v3/projects/project-1/clusters/cluster-1/nodepools") return { metadata: { uid: "pool-new" }, status: { jobId: "job-pool", phase: "" } };
  if (method === "DELETE" && path === "/api/v3/projects/project-1/clusters/cluster-1/nodepools/pool-1") return { status: { phase: "Deleting", jobId: "job-pool-delete" } };
  if (method === "POST" && (path.endsWith("/operation/hibernate") || path.endsWith("/operation/awake"))) return {};
  if (method === "POST" && path === "/api/v3/addons") return { metadata: { uid: "addon-new" }, status: { status: "installing" } };
  if (method === "PUT" && path === "/api/v3/addons/addon-1") return { metadata: { uid: "addon-1" }, status: { status: "upgrading" } };
  if (method === "DELETE" && path === "/api/v3/addons/addon-2") return { metadata: { uid: "addon-2" }, status: { status: "deleting" } };
  return { status: {} };
}

function mockCloud(t: TestContext) {
  const writes: { path: string; search: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    writes.push({ path: url.pathname, search: url.search, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(writeResponse(url, init.method as string));
  });
  return writes;
}

function mockReads(t: TestContext) {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
}

const clusterResource: ManagementResource = { id: "cluster-1", name: "Cluster A", status: "Available", values: { name: "cluster-a", flavor: "cce.s2.small", version: "v1.30", vpcId: "vpc-1", billingMode: "Pay-per-use", nodeCount: 2 } };
const emptyResource: ManagementResource = { id: "cluster-2", name: "cluster-empty", status: "Available", values: { name: "cluster-empty", flavor: "cce.s1.small", version: "v1.29", vpcId: "vpc-1", billingMode: "Pay-per-use", nodeCount: 0 } };
const guardedResource: ManagementResource = { id: "cluster-3", name: "cluster-guarded", status: "Available", values: { name: "cluster-guarded", flavor: "cce.s1.small", version: "v1.28", vpcId: "vpc-1", billingMode: "Pay-per-use", nodeCount: 0 } };
const createValues: ManagementValues = { name: "example-cluster", flavor: "cce.s2.small", networkMode: "overlay_l2", containerCidr: "172.16.0.0/16", vpc: "vpc-1", subnet: "subnet-1", securityGroup: "sg-1", enterpriseProjectId: "0" };

test("inventory maps the canonical cluster list with topology and scale facts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname + new URL(input).search); return Response.json(read(new URL(input))); });
  const resources = await cceManagement.inventory(session);
  assert.ok(reads.some((path) => path.startsWith("/api/v3/projects/project-1/clusters?detail=true")));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status]), [
    ["cluster-1", "Cluster A", "Available"],
    ["cluster-2", "cluster-empty", "Available"],
    ["cluster-3", "cluster-guarded", "Available"],
  ]);
  assert.equal(resources[0].values?.flavor, "cce.s2.small");
  assert.equal(resources[0].values?.vpcId, "vpc-1");
  assert.equal(resources[0].values?.nodeCount, 2);
  assert.equal(resources[0].values?.billingMode, "Pay-per-use");
});

test("create options expose live project networks and documented finite flavors and network modes", async (t) => {
  mockReads(t);
  const choices = await cceManagement.options!(session, "create");
  assert.deepEqual(choices.vpcs.map((choice) => choice.value), ["vpc-1"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1"]);
  const operation = cceManagement.operations.find((item) => item.id === "create")!;
  assert.deepEqual(operation.fields.find((field) => field.key === "flavor")!.choices!.map((choice) => choice.value), ["cce.s1.small", "cce.s1.medium", "cce.s1.large", "cce.s2.small", "cce.s2.medium", "cce.s2.large", "cce.s2.xlarge"]);
  assert.deepEqual(operation.fields.find((field) => field.key === "networkMode")!.choices!.map((choice) => choice.value), ["overlay_l2", "vpc-router"]);
  assert.match(operation.impact!, /billed/);
});

test("create sends the documented private pay-per-use cluster body and maps the create job", async (t) => {
  const writes = mockCloud(t);
  const outcome = await cceManagement.execute(session, "create", { ...createValues, version: "v1.30" });
  assert.equal(outcome.resourceId, "cluster-new");
  assert.equal(outcome.jobId, "job-create");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{
    path: "/api/v3/projects/project-1/clusters", search: "", method: "POST",
    body: { kind: "Cluster", apiVersion: "v3", metadata: { name: "example-cluster" }, spec: { type: "VirtualMachine", flavor: "cce.s2.small", version: "v1.30", hostNetwork: { vpc: "vpc-1", subnet: "network-1", SecurityGroup: "sg-1" }, containerNetwork: { mode: "overlay_l2", cidrs: [{ cidr: "172.16.0.0/16" }] }, authentication: { mode: "rbac" }, billingMode: 0, extendParam: { enterpriseProjectId: "0" } } },
  }]);
});

test("create without optional fields omits them from the native body", async (t) => {
  const writes = mockCloud(t);
  await cceManagement.execute(session, "create", { name: "example-cluster", flavor: "cce.s1.small", networkMode: "overlay_l2", vpc: "vpc-1", subnet: "subnet-1", enterpriseProjectId: "0" });
  const spec = (writes[0].body as { spec: Record<string, unknown> }).spec;
  assert.equal("version" in spec, false);
  assert.equal("SecurityGroup" in (spec.hostNetwork as object), false);
  assert.equal("cidrs" in (spec.containerNetwork as object), false);
});

test("create rejects forged or cross-field-invalid selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, vpc: "vpc-9" }, /VPC is no longer available/],
    [{ ...createValues, subnet: "subnet-2" }, /belongs to the selected VPC/],
    [{ ...createValues, securityGroup: "sg-9" }, /security group is no longer available/],
    [{ ...createValues, flavor: "cce.turbo.large" }, /documented cluster flavor/],
    [{ ...createValues, networkMode: "eni" }, /documented container network mode/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(cceManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("the cluster form contract whitelists live networks and enforces documented formats", async (t) => {
  mockReads(t);
  const operation = cceManagement.operations.find((item) => item.id === "create")!;
  const choices = await cceManagement.options!(session, "create");
  const values = validateManagementValues(operation, createValues, choices);
  assert.equal(values.name, "example-cluster");
  assert.throws(() => validateManagementValues(operation, { ...createValues, vpc: "vpc-9" }, choices), /not available for this project/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, version: "1.30" }, choices), /invalid format/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, containerCidr: "172.16.0.0/24" }, choices), /invalid format/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, name: "abc" }, choices), /invalid format/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, name: "cluster-" }, choices), /invalid format/);
});

test("rename edits only writable native fields and sources the current description from the cloud", async (t) => {
  const writes = mockCloud(t);
  const renamed = await cceManagement.execute(session, "rename", { alias: "renamed-cluster", description: "New description" }, clusterResource);
  assert.equal(renamed.asynchronous, undefined);
  const aliasOnly = await cceManagement.execute(session, "rename", { alias: "only-alias" }, clusterResource);
  assert.equal(aliasOnly.asynchronous, undefined);
  await assert.rejects(cceManagement.execute(session, "rename", {}, clusterResource), /Enter a new display name or description/);
  assert.deepEqual(writes, [
    { path: "/api/v3/projects/project-1/clusters/cluster-1", search: "", method: "PUT", body: { spec: { description: "New description" }, metadata: { alias: "renamed-cluster" } } },
    { path: "/api/v3/projects/project-1/clusters/cluster-1", search: "", method: "PUT", body: { spec: { description: "Main cluster" }, metadata: { alias: "only-alias" } } },
  ]);
  const operation = cceManagement.operations.find((item) => item.id === "rename")!;
  assert.deepEqual(operation.allowedStatuses, ["Available", "ScalingUp", "ScalingDown"]);
  assert.throws(() => validateManagementValues(operation, { alias: "ok", description: "bad <chars>" }, {}), /invalid format/);
});

test("inspect loads native cluster configuration and component parameters", async (t) => {
  mockReads(t);
  const outcome = await cceManagement.execute(session, "inspect", {}, clusterResource);
  assert.match(outcome.message, /1 configurable component package/);
  assert.ok(outcome.facts!.some((fact) => fact.label === "Host network" && fact.value.includes("VPC vpc-1") && fact.value.includes("subnet network-1") && fact.value.includes("sg-1")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Component · kube-apiserver" && fact.value.includes("default-not-ready-toleration-seconds")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Container network" && fact.value.includes("overlay_l2") && fact.value.includes("172.16.0.0/16")));
});

test("hibernate and awake call their native operation routes without a body", async (t) => {
  const writes = mockCloud(t);
  const hibernated = await cceManagement.execute(session, "hibernate", {}, clusterResource);
  assert.equal(hibernated.asynchronous, true);
  assert.match(hibernated.message, /Hibernation state/);
  const awoken = await cceManagement.execute(session, "awake", {}, { ...clusterResource, status: "Hibernation" });
  assert.equal(awoken.asynchronous, true);
  assert.match(awoken.message, /Available state/);
  assert.deepEqual(writes, [
    { path: "/api/v3/projects/project-1/clusters/cluster-1/operation/hibernate", search: "", method: "POST", body: undefined },
    { path: "/api/v3/projects/project-1/clusters/cluster-1/operation/awake", search: "", method: "POST", body: undefined },
  ]);
  const hibernate = cceManagement.operations.find((item) => item.id === "hibernate")!;
  const awake = cceManagement.operations.find((item) => item.id === "awake")!;
  assert.deepEqual(hibernate.allowedStatuses, ["Available"]);
  assert.deepEqual(awake.allowedStatuses, ["Hibernation"]);
  assert.equal(hibernate.confirmation, true);
  assert.ok(hibernate.impact && awake.impact);
});

test("cluster deletion is empty-only and preserves attached persistent data with explicit flags", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cceManagement.execute(session, "delete", {}, clusterResource), /still has nodes/);
  await assert.rejects(cceManagement.execute(session, "delete", {}, guardedResource), /node pool in this cluster still has nodes/);
  assert.equal(writes.length, 0);
  const outcome = await cceManagement.execute(session, "delete", {}, emptyResource);
  assert.equal(outcome.jobId, "job-delete");
  assert.equal(outcome.asynchronous, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "DELETE");
  assert.equal(writes[0].path, "/api/v3/projects/project-1/clusters/cluster-2");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(writes[0].search)), {
    delete_efs: "false", delete_eni: "false", delete_evs: "false", delete_net: "false", delete_obs: "false", delete_sfs: "false", delete_sfs30: "false",
    lts_reclaim_policy: "Retain", ondemand_node_policy: "retain", periodic_node_policy: "retain",
  });
  const operation = cceManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(operation.confirmation, true);
  assert.match(operation.impact!, /preserve/);
  assert.match(operation.impact!, /continue to incur charges/);
});

test("node pool listing shows native flavor, image, key, and node counts", async (t) => {
  mockReads(t);
  const outcome = await cceManagement.execute(session, "nodepools", {}, clusterResource);
  assert.equal(outcome.message, "2 node pools loaded.");
  assert.ok(outcome.facts!.some((fact) => fact.label === "pool-a · pool-1" && fact.value.includes("s6.large.2") && fact.value.includes("Huawei Cloud EulerOS 2.0") && fact.value.includes("key key-1") && fact.value.includes("2 current")));
});

test("node pool create options come from live ECS and IMS sources inside the cluster VPC", async (t) => {
  mockReads(t);
  const choices = await cceManagement.options!(session, "create-nodepool", clusterResource);
  assert.deepEqual(choices.flavors.map((choice) => choice.value), ["s6.large.2", "s6.medium.2"]);
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["az-1", "az-2"]);
  assert.deepEqual(choices.keys.map((choice) => choice.value), ["key-1"]);
  assert.deepEqual(choices.images.map((choice) => choice.value), ["img-1"]);
  assert.deepEqual(choices.nodepoolSubnets.map((choice) => choice.value), ["network-1"]);
});

test("node pool create sends the documented pay-per-use SSH-key body and maps its job", async (t) => {
  const writes = mockCloud(t);
  const outcome = await cceManagement.execute(session, "create-nodepool", { name: "pool-one", flavor: "s6.large.2", zone: "az-1", key: "key-1", initialNodeCount: 2, rootDiskType: "SAS", rootDiskSize: 40, dataDiskType: "SAS", dataDiskSize: 100, subnet: "network-1" }, clusterResource);
  assert.equal(outcome.jobId, "job-pool");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{
    path: "/api/v3/projects/project-1/clusters/cluster-1/nodepools", search: "", method: "POST",
    body: { kind: "NodePool", apiVersion: "v3", metadata: { name: "pool-one" }, spec: { type: "vm", initialNodeCount: 2, nodeTemplate: { flavor: "s6.large.2", az: "az-1", os: "Huawei Cloud EulerOS 2.0", login: { sshKey: "key-1" }, rootVolume: { volumetype: "SAS", size: 40 }, dataVolumes: [{ volumetype: "SAS", size: 100 }], billingMode: 0, nodeNicSpec: { primaryNic: { subnetId: "network-1" } } } } },
  }]);
  const template = ((writes[0].body as { spec: { nodeTemplate: Record<string, unknown> } }).spec).nodeTemplate;
  assert.equal("userPassword" in template, false);
});

test("node pool create with a private IMS image uses NodeImageID and omits the public OS", async (t) => {
  const writes = mockCloud(t);
  await cceManagement.execute(session, "create-nodepool", { name: "pool-image", flavor: "s6.large.2", zone: "az-1", key: "key-1", image: "img-1", initialNodeCount: 1, rootDiskType: "SSD", rootDiskSize: 60, dataDiskType: "SSD", dataDiskSize: 100 }, clusterResource);
  const template = ((writes[0].body as { spec: { nodeTemplate: Record<string, unknown> } }).spec).nodeTemplate;
  assert.equal("os" in template, false);
  assert.deepEqual(template.extendParam, { "alpha.cce/NodeImageID": "img-1" });
  assert.equal("nodeNicSpec" in template, false);
});

test("node pool create rejects forged or foreign selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const base: ManagementValues = { name: "pool-one", flavor: "s6.large.2", zone: "az-1", key: "key-1", initialNodeCount: 1, rootDiskType: "SAS", rootDiskSize: 40, dataDiskType: "SAS", dataDiskSize: 100 };
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...base, flavor: "forged-flavor" }, /flavor is no longer available/],
    [{ ...base, zone: "az-9" }, /availability zone is no longer available/],
    [{ ...base, key: "forged-key" }, /SSH key pair is no longer available/],
    [{ ...base, image: "img-9" }, /private image is no longer available/],
    [{ ...base, subnet: "network-2" }, /cluster's VPC/],
    [{ ...base, rootDiskType: "SATA" }, /documented disk type/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(cceManagement.execute(session, "create-nodepool", values, clusterResource), expression);
  assert.equal(writes.length, 0);
  const operation = cceManagement.operations.find((item) => item.id === "create-nodepool")!;
  assert.match(operation.impact!, /billed/);
});

test("node pool scale sends the required initialNodeCount and revalidates pool ownership", async (t) => {
  const writes = mockCloud(t);
  const outcome = await cceManagement.execute(session, "update-nodepool", { nodepool: "pool-1", initialNodeCount: 3 }, clusterResource);
  assert.equal(outcome.asynchronous, true);
  await assert.rejects(cceManagement.execute(session, "update-nodepool", { nodepool: "pool-9", initialNodeCount: 3 }, clusterResource), /no longer belongs to this cluster/);
  assert.deepEqual(writes, [{ path: "/api/v3/projects/project-1/clusters/cluster-1/nodepools/pool-1", search: "", method: "PUT", body: { spec: { initialNodeCount: 3 } } }]);
  const choices = await cceManagement.options!(session, "update-nodepool", clusterResource);
  assert.deepEqual(choices.nodepools.map((choice) => choice.value), ["pool-1", "pool-2"]);
});

test("node pool deletion maps its native job and declares eviction impact", async (t) => {
  const writes = mockCloud(t);
  const outcome = await cceManagement.execute(session, "delete-nodepool", { nodepool: "pool-1" }, clusterResource);
  assert.equal(outcome.jobId, "job-pool-delete");
  assert.equal(outcome.asynchronous, true);
  await assert.rejects(cceManagement.execute(session, "delete-nodepool", { nodepool: "pool-9" }, clusterResource), /no longer belongs/);
  assert.deepEqual(writes, [{ path: "/api/v3/projects/project-1/clusters/cluster-1/nodepools/pool-1", search: "", method: "DELETE", body: undefined }]);
  const operation = cceManagement.operations.find((item) => item.id === "delete-nodepool")!;
  assert.equal(operation.confirmation, true);
  assert.match(operation.impact!, /evicted/);
});

test("addon and template listings expose native states and published versions", async (t) => {
  mockReads(t);
  const addons = await cceManagement.execute(session, "addons", {}, clusterResource);
  assert.equal(addons.message, "2 installed addons loaded.");
  assert.ok(addons.facts!.some((fact) => fact.label === "CoreDNS · coredns" && fact.value.includes("v1.13.6") && fact.value.includes("running")));
  const templates = await cceManagement.execute(session, "addon-templates", {}, clusterResource);
  assert.equal(templates.message, "3 addon templates loaded.");
  assert.ok(templates.facts!.some((fact) => fact.label === "CoreDNS · coredns · helm · required" && fact.value.includes("1 version(s)")));
  assert.ok(templates.facts!.some((fact) => fact.label === "Metrics Server · metrics-server · helm" && fact.value.includes("1 version(s), 1 stable")));
});

test("addon install builds values only from the template's published parameters", async (t) => {
  const writes = mockCloud(t);
  const choices = await cceManagement.options!(session, "create-addon", clusterResource);
  assert.deepEqual(choices.addonOfferings.map((choice) => choice.value), [JSON.stringify(["metrics-server", "1.2.0", "flavor1"]), JSON.stringify(["metrics-server", "1.2.0", "flavor2"])]);
  const outcome = await cceManagement.execute(session, "create-addon", { offering: JSON.stringify(["metrics-server", "1.2.0", "flavor1"]) }, clusterResource);
  assert.equal(outcome.resourceId, "addon-new");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{
    path: "/api/v3/addons", search: "", method: "POST",
    body: { kind: "Addon", apiVersion: "v3", metadata: { annotations: { "addon.install/type": "install" } }, spec: { clusterID: "cluster-1", addonTemplateName: "metrics-server", version: "1.2.0", values: { basic: { platform: "linux-amd64", swr_addr: "swr.example.invalid:20202" }, custom: { mode: "standard" }, flavor: { name: 100, replicas: 2 } } } },
  }]);
});

test("addon install rejects forged offerings and templates that are already installed", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cceManagement.execute(session, "create-addon", { offering: JSON.stringify(["ghost-addon", "1.0.0", ""]) }, clusterResource), /no longer available/);
  await assert.rejects(cceManagement.execute(session, "create-addon", { offering: JSON.stringify(["coredns", "1.13.6", "flavor1"]) }, clusterResource), /already installed/);
  await assert.rejects(cceManagement.execute(session, "create-addon", { offering: JSON.stringify(["metrics-server", "9.9.9", ""]) }, clusterResource), /no longer available/);
  await assert.rejects(cceManagement.execute(session, "create-addon", { offering: "{not-json" }, clusterResource), /Select an available addon template/);
  assert.equal(writes.length, 0);
});

test("addon upgrade resubmits the cloud's current install parameters with the upgrade annotation", async (t) => {
  const writes = mockCloud(t);
  const choices = await cceManagement.options!(session, "update-addon", clusterResource);
  assert.deepEqual(choices.addonUpgrades.map((choice) => choice.value), [JSON.stringify(["addon-1", "1.14.0"])]);
  const outcome = await cceManagement.execute(session, "update-addon", { upgrade: JSON.stringify(["addon-1", "1.14.0"]) }, clusterResource);
  assert.equal(outcome.resourceId, "addon-1");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{
    path: "/api/v3/addons/addon-1", search: "", method: "PUT",
    body: { kind: "Addon", apiVersion: "v3", metadata: { annotations: { "addon.upgrade/type": "upgrade" } }, spec: { clusterID: "cluster-1", addonTemplateName: "coredns", version: "1.14.0", values: { basic: { cluster_ip: "10.247.3.10" }, custom: { stub_domains: "" }, flavor: { name: 2500, replicas: 2 } } } },
  }]);
});

test("addon upgrade rejects foreign addons and unoffered target versions", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(cceManagement.execute(session, "update-addon", { upgrade: JSON.stringify(["addon-9", "1.14.0"]) }, clusterResource), /no longer belongs to this cluster/);
  await assert.rejects(cceManagement.execute(session, "update-addon", { upgrade: JSON.stringify(["addon-1", "9.9.9"]) }, clusterResource), /no longer offered/);
  assert.equal(writes.length, 0);
});

test("addon deletion only removes non-required addons of the owning cluster", async (t) => {
  const writes = mockCloud(t);
  const choices = await cceManagement.options!(session, "delete-addon", clusterResource);
  assert.deepEqual(choices.addons.map((choice) => choice.value), ["addon-2"]);
  const outcome = await cceManagement.execute(session, "delete-addon", { addon: "addon-2" }, clusterResource);
  assert.equal(outcome.asynchronous, true);
  await assert.rejects(cceManagement.execute(session, "delete-addon", { addon: "addon-1" }, clusterResource), /Required system addons/);
  await assert.rejects(cceManagement.execute(session, "delete-addon", { addon: "addon-9" }, clusterResource), /no longer belongs/);
  assert.deepEqual(writes, [{ path: "/api/v3/addons/addon-2", search: "?cluster_id=cluster-1", method: "DELETE", body: undefined }]);
  const operation = cceManagement.operations.find((item) => item.id === "delete-addon")!;
  assert.equal(operation.confirmation, true);
});

test("job polling maps native CCE job phases and resource IDs", async (t) => {
  const replies = [
    { metadata: { uid: "job-1" }, spec: { resourceID: "cluster-new" }, status: { phase: "Success" } },
    { metadata: { uid: "job-1" }, status: { phase: "Failed", reason: "Insufficient quota" } },
    { metadata: { uid: "job-1" }, status: { phase: "Running" } },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname, "/api/v3/projects/project-1/jobs/job-1"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "cce", operation: "Create cluster", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-1" };
  const succeeded = await cceManagement.poll!(session, entry);
  assert.equal(succeeded.state, "succeeded");
  assert.equal(succeeded.resourceId, "cluster-new");
  const failed = await cceManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /Insufficient quota/);
  const running = await cceManagement.poll!(session, entry);
  assert.equal(running.state, "submitted");
});

test("operations revalidate cluster ownership and fail closed for unknown clusters", async (t) => {
  const writes = mockCloud(t);
  const ghost: ManagementResource = { id: "cluster-9", name: "Ghost", status: "Available" };
  await assert.rejects(cceManagement.execute(session, "nodepools", {}, ghost), /no longer exists in this project/);
  await assert.rejects(cceManagement.execute(session, "delete", {}, ghost), /no longer exists in this project/);
  await assert.rejects(cceManagement.execute(session, "create-addon", { offering: JSON.stringify(["custom-addon", "1.0.0", ""]) }, ghost), /no longer exists in this project/);
  assert.equal(writes.length, 0);
});

test("invalidation keys use the canonical cluster cache keys", () => {
  assert.deepEqual(cceManagement.invalidationKeys(clusterResource), ["listCceClusters", "cloud-summary", "cce-cluster:cluster-1"]);
  assert.deepEqual(cceManagement.invalidationKeys(), ["listCceClusters", "cloud-summary"]);
});

test("every operation declares billing or data-loss impact for mutations and unique identifiers", () => {
  const ids = new Set(cceManagement.operations.map((operation) => operation.id));
  assert.equal(ids.size, cceManagement.operations.length);
  for (const operation of cceManagement.operations) {
    if (operation.kind === "create" || operation.kind === "delete") assert.ok(operation.impact, `${operation.id} must declare impact`);
    if (operation.kind === "delete") assert.equal(operation.confirmation, true, `${operation.id} must require confirmation`);
  }
});

test("CCE rejects unknown node counters and prepaid deletion before any write", async (t) => {
  let prepaid = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.ok(!init.method); const url = new URL(input);
    if (url.pathname === "/api/v3/projects/project-1/clusters/cluster-2") return Response.json({ ...clusterEmpty, spec: { ...clusterEmpty.spec, billingMode: prepaid ? 1 : 0 }, status: prepaid ? clusterEmpty.status : {} });
    return Response.json(read(url));
  });
  await assert.rejects(cceManagement.execute(session, "delete", {}, emptyResource), /node count could not be verified/);
  prepaid = true; await assert.rejects(cceManagement.execute(session, "delete", {}, emptyResource), /Only pay-per-use/);
});

test("CCE verifies live nodes before deleting a cluster whose counters say empty", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.ok(!init.method); const url = new URL(input);
    return Response.json(url.pathname.endsWith("/nodes") ? { items: [{ metadata: { uid: "orphan-node" } }] } : read(url));
  });
  await assert.rejects(cceManagement.execute(session, "delete", {}, emptyResource), /still has nodes/);
});

test("CCE excludes foreign addon records even when the native filter is ignored", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.ok(!init.method); const url = new URL(input);
    if (url.pathname === "/api/v3/addons") return Response.json({ items: [{ ...addonCustom, spec: { ...addonCustom.spec, clusterID: "other-cluster" } }] });
    return Response.json(read(url));
  });
  assert.deepEqual((await cceManagement.options!(session, "delete-addon", clusterResource)).addons, []);
  await assert.rejects(cceManagement.execute(session, "delete-addon", { addon: "addon-2" }, clusterResource), /no longer belongs/);
});

test("CCE rejects mismatched native job identities and cluster ownership", async (t) => {
  let foreignJob = true;
  t.mock.method(globalThis, "fetch", async () => Response.json({ metadata: { uid: foreignJob ? "other-job" : "job-1" }, spec: { clusterUID: "other-cluster", resourceID: "other-nodepool" }, status: { phase: "Success" } }));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "cce", operation: "Create node pool", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-1", resourceId: "cluster-1" };
  await assert.rejects(cceManagement.poll!(session, entry), /different CCE job/);
  foreignJob = false; await assert.rejects(cceManagement.poll!(session, entry), /does not belong/);
});
