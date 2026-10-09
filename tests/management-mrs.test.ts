import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { mrsManagement } from "@/lib/huawei/management/adapters/mrs";
import { validateManagementValues, type ManagementHistoryEntry, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { session } from "./fixtures/session";
import { HuaweiApiError } from "@/lib/huawei/http";

const clusters = [
  { clusterId: "cluster-1", clusterName: "Analysis One", clusterState: "running", billingType: 12, safeMode: 0, clusterVersion: "MRS 3.1.5", hadoopVersion: "hadoop 3.3.1", masterNodeNum: "2", coreNodeNum: "2", totalNodeNum: "4", vpcId: "vpc-1", azCode: "sa-brazil-1a", componentList: [{ componentName: "Hadoop", componentVersion: "3.3.1" }, { componentName: "Spark", componentVersion: "3.1.1" }] },
  { clusterId: "cluster-kerb", clusterName: "Secure One", clusterState: "running", billingType: 12, safeMode: 1, clusterVersion: "MRS 3.1.5", masterNodeNum: "2", coreNodeNum: "2", totalNodeNum: "4", vpcId: "vpc-1" },
  { clusterId: "cluster-quiet", clusterName: "Quiet One", clusterState: "running", billingType: 12, safeMode: 0, clusterVersion: "MRS 3.1.5", masterNodeNum: "2", coreNodeNum: "2", totalNodeNum: "4", vpcId: "vpc-1" },
  { clusterId: "cluster-pre", clusterName: "Prepaid One", clusterState: "running", billingType: 19, safeMode: 0, clusterVersion: "MRS 3.1.5", masterNodeNum: "2", coreNodeNum: "2", totalNodeNum: "4", vpcId: "vpc-1" },
  { clusterId: "cluster-frozen", clusterName: "Frozen One", clusterState: "frozen", billingType: 12, safeMode: 0, clusterVersion: "MRS 3.1.5", masterNodeNum: "2", coreNodeNum: "2", totalNodeNum: "4", vpcId: "vpc-1" },
  { clusterId: "cluster-starting", clusterName: "Starting One", clusterState: "starting", billingType: 12, safeMode: 0, clusterVersion: "MRS 3.1.5", masterNodeNum: "2", coreNodeNum: "2", totalNodeNum: "4", vpcId: "vpc-1" },
  { clusterId: "cluster-scaling", clusterName: "Scaling One", clusterState: "scaling-out", billingType: 12, safeMode: 0, clusterVersion: "MRS 3.1.5", masterNodeNum: "2", coreNodeNum: "2", totalNodeNum: "4", vpcId: "vpc-1" },
  { clusterId: "cluster-masked", clusterName: "Masked One", clusterState: "running", billingType: 12, safeMode: null, clusterVersion: "MRS 3.1.5", masterNodeNum: "2", coreNodeNum: "2", totalNodeNum: "4", vpcId: "vpc-1" },
  { clusterId: "cluster-weird", clusterName: "Weird One", clusterState: "upgrading", billingType: 12, safeMode: 0, clusterVersion: "MRS 3.1.5", masterNodeNum: "2", coreNodeNum: "2", totalNodeNum: "4", vpcId: "vpc-1" },
];
function detailOf(cluster: Record<string, unknown>) {
  return { ...cluster, stageDesc: "Cluster installation failed: secret internal reason", vpc: "VPC One", subnetName: "Subnet", subnetId: "network-1", internalIp: "192.168.0.10", masterNodeSize: "c3.4xlarge.2.linux.bigdata", coreNodeSize: "c3.2xlarge.2.linux.bigdata", coreDataVolumeType: "SAS", coreDataVolumeSize: 600, coreDataVolumeCount: 2, createAt: "1767000000", updateAt: "1767000100", enterpriseProjectId: "0", nodePublicCertName: "private-key-file", errorInfo: "secret /root/error.log" };
}
const versionList = ["MRS 3.1.5", "MRS 3.2.0", "MRS 3.3.0"];
const masterConstraint = { min_node_num: 2, max_node_num: 2, min_root_disk_size: 100, disk_type_constraint: { SATA: "common IO", SAS: "high IO", SSD: "ultra IO", GPSSD: "general SSD" } };
const coreConstraint = { min_node_num: 2, max_node_num: 500, min_root_disk_size: 100, min_disk_size: 200, min_data_volume_total_size: { SATA: 600, SAS: 600, SSD: 2000, GPSSD: 600 }, disk_type_constraint: { volume_types: "SATA,SAS,SSD,GPSSD" } };
const versionMetadatas: Record<string, unknown> = {
  "MRS 3.1.5": { name: "MRS 3.1.5", status: "normal", cluster_types: ["ANALYSIS", "STREAMING"], components: [
    { name: "Hadoop", version: "3.3.1", available_cluster_types: ["ANALYSIS", "STREAMING"], visible: true },
    { name: "Spark", version: "3.1.1", available_cluster_types: ["ANALYSIS"], visible: true },
    { name: "Kafka", version: "3.0.1", available_cluster_types: ["STREAMING"], visible: true },
    { name: "Ranger", version: "2.1.0", available_cluster_types: ["ANALYSIS"], visible: false },
  ], constraints: { node_constraint: { master: masterConstraint, core: coreConstraint } } },
  "MRS 3.2.0": { name: "MRS 3.2.0", status: "normal", cluster_types: ["STREAMING"], components: [{ name: "Kafka", version: "3.4.0", available_cluster_types: ["STREAMING"], visible: true }] },
  "MRS 3.3.0": { name: "MRS 3.3.0", status: "normal", cluster_types: ["ANALYSIS"], components: [{ name: "Hadoop", version: "3.3.2", available_cluster_types: ["ANALYSIS"], visible: true }], constraints: { node_constraint: {} } },
};
const flavorList = { version_name: "MRS 3.1.5", available_flavors: [
  { az_code: "sa-brazil-1a", az_name: "South America East 1a", master: [{ flavor_name: "c3.4xlarge.2.linux.bigdata" }, { flavor_name: "c3.8xlarge.2.linux.bigdata" }], core: [{ flavor_name: "c3.2xlarge.2.linux.bigdata" }] },
  { az_code: "sa-brazil-1b", az_name: "South America East 1b", master: [{ flavor_name: "c3.4xlarge.2.linux.bigdata" }], core: [{ flavor_name: "ac2.2xlarge.2.linux.bigdata" }] },
] };
const jobs = [
  { job_id: "job-running", job_name: "Nightly ETL", job_type: "MapReduce", job_state: "RUNNING", job_result: "UNDEFINED", submitted_time: 1767000000, finished_time: 0, arguments: "sensitive-job-argument" },
  { job_id: "job-done", job_name: "Import", job_type: "DistCp", job_state: "FINISHED", job_result: "SUCCEEDED", submitted_time: 1767000000, finished_time: 1767000600 },
  { job_id: "job-failed", job_name: "Broken", job_type: "HiveSql", job_state: "FAILED", job_result: "FAILED", submitted_time: 1767000000, finished_time: 1767000600 },
  { job_id: "job-weird", job_name: "Alien", job_type: "Flink", job_state: "RESTARTING", job_result: "STRANGE", submitted_time: 1767000000, finished_time: 0 },
];
const writeResponse = { cluster_id: "cluster-new", result: "succeeded" };

function read(url: URL) {
  const path = decodeURIComponent(url.pathname);
  if (path === "/v1.1/project-1/cluster_infos") return { clusterTotal: clusters.length, clusters };
  const detailMatch = path.match(/^\/v1\.1\/project-1\/cluster_infos\/([^/]+)$/);
  if (detailMatch) {
    const cluster = clusters.find((item) => item.clusterId === detailMatch[1]);
    return { cluster: cluster ? detailOf(cluster) : {} };
  }
  if (path === "/v2/project-1/metadata/versions") return { cluster_versions: versionList };
  const metaMatch = path.match(/^\/v1\.1\/project-1\/metadata\/versions\/(.+)$/);
  if (metaMatch) return versionMetadatas[metaMatch[1]] ?? {};
  const flavorMatch = path.match(/^\/v2\/project-1\/metadata\/version\/(.+)\/available-flavor$/);
  if (flavorMatch) return flavorMatch[1] === "MRS 3.1.5" ? flavorList : { version_name: flavorMatch[1], available_flavors: [] };
  if (path === "/v1/project-1/subnets") return { subnets: [
    { id: "subnet-1", neutron_network_id: "network-1", vpc_id: "vpc-1", name: "Subnet", cidr: "192.168.0.0/24" },
    { id: "subnet-2", vpc_id: "vpc-1", name: "Legacy", cidr: "10.0.0.0/24" },
  ] };
  if (path === "/v3/project-1/vpc/vpcs") return { vpcs: [{ id: "vpc-1", name: "VPC One" }] };
  if (path === "/v3/project-1/vpc/security-groups") return { security_groups: [{ id: "sg-1", name: "Security" }] };
  const jobListMatch = path.match(/^\/v2\/project-1\/clusters\/([^/]+)\/job-executions$/);
  if (jobListMatch) return jobListMatch[1] === "cluster-1" ? { total_record: jobs.length, job_list: jobs } : { total_record: 0, job_list: [] };
  const jobMatch = path.match(/^\/v2\/project-1\/clusters\/([^/]+)\/job-executions\/([^/]+)$/);
  if (jobMatch) return { job_detail: { job_id: jobMatch[2], job_state: "RUNNING", job_result: "UNDEFINED" } };
  throw new Error(`Unexpected GET ${path}`);
}

function mockCloud(t: TestContext, writeResult: Record<string, unknown> = writeResponse) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(read(url));
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    writes.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(writeResult);
  });
  return writes;
}

const analysisResource: ManagementResource = { id: "cluster-1", name: "Analysis One", status: "running", values: { safeMode: "SIMPLE", billingType: "12" } };
const kerberosResource: ManagementResource = { id: "cluster-kerb", name: "Secure One", status: "running", values: { safeMode: "KERBEROS" } };
const quietResource: ManagementResource = { id: "cluster-quiet", name: "Quiet One", status: "running", values: { safeMode: "SIMPLE", billingType: "12" } };
const prepaidResource: ManagementResource = { id: "cluster-pre", name: "Prepaid One", status: "running", values: { billingType: "19" } };
const frozenResource: ManagementResource = { id: "cluster-frozen", name: "Frozen One", status: "frozen", values: {} };
const startingResource: ManagementResource = { id: "cluster-starting", name: "Starting One", status: "starting", values: {} };
const scalingResource: ManagementResource = { id: "cluster-scaling", name: "Scaling One", status: "scaling-out", values: {} };
const maskedResource: ManagementResource = { id: "cluster-masked", name: "Masked One", status: "running", values: {} };
const createValues: ManagementValues = { name: "Nightly", version: "MRS 3.1.5", components: ["Hadoop", "Spark"], zone: "sa-brazil-1a", masterSpec: "c3.4xlarge.2.linux.bigdata", coreSpec: "c3.2xlarge.2.linux.bigdata", coreNodes: 2, subnet: "subnet-1", securityGroup: "sg-1", rootVolumeType: "SAS", rootVolumeSize: 600, dataVolumeType: "SAS", dataVolumeSize: 600, dataVolumeCount: 2, safeMode: "SIMPLE", managerPassword: "Man4ger!Pass", nodeRootPassword: "R00t!Passw0rd", enterpriseProjectId: "0" };

test("MRS errors retain HTTP status and redact private HTTP, business, and invalid JSON payloads", async (t) => {
  for (const response of [Response.json({ error_msg: "secret-db-key" }, { status: 403 }), Response.json({ error_code: "MRS.1", error_msg: "secret-db-key" }), new Response("secret-db-key")]) {
    t.mock.method(globalThis, "fetch", async () => response.clone());
    await assert.rejects(mrsManagement.inventory(session), (error: Error) => {
      assert.doesNotMatch(error.message, /secret-db-key/);
      if (response.status === 403) assert.equal((error as HuaweiApiError).status, 403);
      return true;
    });
  }
});

test("MRS mutations reject malformed optional owner fields and conflicting native aliases", async (t) => {
  let patch: Record<string, unknown> = {}, writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return Response.json({}); }
    const url = new URL(input), body = read(url);
    return Response.json(url.pathname.endsWith("/cluster-quiet") ? { cluster: { ...detailOf(clusters[2]), ...patch } } : body);
  });
  for (const project_id of [null, "", 1, "foreign"]) {
    patch = { project_id };
    await assert.rejects(mrsManagement.execute(session, "delete", {}, quietResource), /different project/);
  }
  patch = { billing_type: 19 };
  await assert.rejects(mrsManagement.execute(session, "delete", {}, quietResource), /billing mode could not be verified/);
  patch = { safe_mode: 1 };
  await assert.rejects(mrsManagement.execute(session, "stop-job", { job: "job-running" }, quietResource), /mode could not be verified/);
  assert.equal(writes, 0);
});

test("MRS deletion blocks unknown and contradictory job completion on every deletable cluster state", async (t) => {
  let job_state = "RESTARTING", job_result = "SUCCEEDED", clusterState = "running", writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return Response.json({}); }
    const url = new URL(input);
    if (url.pathname.endsWith("/cluster-quiet")) return Response.json({ cluster: { ...detailOf(clusters[2]), clusterState } });
    if (url.pathname.endsWith("/job-executions")) return Response.json({ total_record: 1, job_list: [{ job_id: "job-x", job_state, job_result }] });
    return Response.json(read(url));
  });
  await assert.rejects(mrsManagement.execute(session, "delete", {}, quietResource), /unverified completion/);
  job_state = "RUNNING";
  await assert.rejects(mrsManagement.execute(session, "delete", {}, quietResource), /running job/);
  job_state = "FINISHED"; job_result = "UNDEFINED"; clusterState = "failed";
  await assert.rejects(mrsManagement.execute(session, "delete", {}, quietResource), /unverified completion/);
  assert.equal(writes, 0);
});

test("MRS job parents must match when provided and pagination requires a verified total", async (t) => {
  let patch: Record<string, unknown> = {}, total: unknown = 1;
  t.mock.method(globalThis, "fetch", async () => Response.json({ total_record: total, job_list: [{ job_id: "job-x", ...patch }] }));
  for (const cluster_id of [null, "", 1, "foreign"]) {
    patch = { cluster_id };
    await assert.rejects(mrsManagement.execute(session, "jobs", {}, analysisResource), /different cluster/);
  }
  patch = {};
  for (total of [undefined, null, "1", -1]) await assert.rejects(mrsManagement.execute(session, "jobs", {}, analysisResource), /incomplete MRS page/);
});

test("MRS current component dependencies and Kerberos exclusions block invalid deployments", async (t) => {
  let exclude = false, writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return Response.json(writeResponse); }
    const url = new URL(input), body = read(url);
    if (decodeURIComponent(url.pathname).endsWith("/metadata/versions/MRS 3.1.5")) {
      const meta = structuredClone(body) as Record<string, unknown>;
      (meta.components as Record<string, unknown>[])[1].depend_on = ["Hadoop"];
      if (exclude) (meta.constraints as Record<string, unknown>).safe_mode_kerberos_exclude_components = ["Spark"];
      return Response.json(meta);
    }
    return Response.json(body);
  });
  await assert.rejects(mrsManagement.execute(session, "create", { ...createValues, components: ["Spark"] }), /every native dependency/);
  exclude = true;
  await assert.rejects(mrsManagement.execute(session, "create", { ...createValues, safeMode: "KERBEROS" }), /not offered in Kerberos/);
  assert.equal(writes, 0);
});

test("MRS rename checks fresh name uniqueness before writing", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "rename", { name: "Secure One" }, analysisResource), /name already exists/);
  assert.equal(writes.length, 0);
});

test("MRS business failures on job deletion cannot produce a success or leak native failure details", async (t) => {
  const writes = mockCloud(t, { error_code: "MRS.123", error_msg: "private-failure-key" });
  await assert.rejects(mrsManagement.execute(session, "delete-job", { job: "job-done" }, analysisResource), (error: Error) => {
    assert.doesNotMatch(error.message, /private-failure-key/);
    assert.equal((error as HuaweiApiError).status, 502);
    return true;
  });
  assert.equal(writes.length, 1);
});

test("MRS stopped-job observation waits for a known terminal state with the original identity", async (t) => {
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "mrs", operation: "Stop running job", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-running", resourceId: "cluster-1" };
  t.mock.method(globalThis, "fetch", async () => Response.json({ job_detail: { job_id: "job-running", job_state: "RUNNING", job_result: "KILLED" } }));
  assert.equal((await mrsManagement.poll!(session, entry)).state, "submitted");
});

test("inventory maps the canonical cluster list with strict billing, mode, and state facts", async (t) => {
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { reads.push(new URL(input).pathname + new URL(input).search); return Response.json(read(new URL(input))); });
  const resources = await mrsManagement.inventory(session);
  assert.ok(reads.some((path) => path.startsWith("/v1.1/project-1/cluster_infos?") && path.includes("clusterState=existing")));
  assert.deepEqual(resources.map((item) => [item.id, item.name, item.status, item.values?.billingType, item.values?.safeMode]), [
    ["cluster-1", "Analysis One", "running", "12", "SIMPLE"],
    ["cluster-kerb", "Secure One", "running", "12", "KERBEROS"],
    ["cluster-quiet", "Quiet One", "running", "12", "SIMPLE"],
    ["cluster-pre", "Prepaid One", "running", "19", "SIMPLE"],
    ["cluster-frozen", "Frozen One", "frozen", "12", "SIMPLE"],
    ["cluster-starting", "Starting One", "starting", "12", "SIMPLE"],
    ["cluster-scaling", "Scaling One", "scaling-out", "12", "SIMPLE"],
    ["cluster-masked", "Masked One", "running", "12", ""],
    ["cluster-weird", "Weird One", "unknown", "12", "SIMPLE"],
  ]);
});

test("inventory fails closed on malformed, duplicate, or foreign-project cluster rows", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ clusterTotal: 1, clusters: [{ clusterName: "No Identity" }] }));
  await assert.rejects(mrsManagement.inventory(session), /verifiable identity/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ clusterTotal: 2, clusters: [{ clusterId: "cluster-1", clusterName: "One" }, { clusterId: "cluster-1", clusterName: "Two" }] }));
  await assert.rejects(mrsManagement.inventory(session), /duplicate MRS cluster/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ clusterTotal: 1, clusters: [{ clusterId: "cluster-1", clusterName: "One", project_id: "other-project" }] }));
  await assert.rejects(mrsManagement.inventory(session), /different project/);
});

test("a missing or masked native safe mode never coerces to SIMPLE for job writes", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "stop-job", { job: "job-running" }, maskedResource), /could not be verified as SIMPLE/);
  await assert.rejects(mrsManagement.execute(session, "delete-job", { job: "job-done" }, maskedResource), /could not be verified as SIMPLE/);
  assert.equal(writes.length, 0);
});

test("create options whitelist live analysis versions, components, zones, specifications, and disk types", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const choices = await mrsManagement.options!(session, "create");
  assert.deepEqual(choices.versions.map((choice) => choice.value), ["MRS 3.1.5"]);
  assert.deepEqual(choices.components.map((choice) => choice.value), ["Hadoop", "Spark"]);
  assert.deepEqual(choices.zones.map((choice) => choice.value), ["sa-brazil-1a", "sa-brazil-1b"]);
  assert.deepEqual(choices.masterSpecs.map((choice) => choice.value), ["c3.4xlarge.2.linux.bigdata", "c3.8xlarge.2.linux.bigdata"]);
  assert.deepEqual(choices.coreSpecs.map((choice) => choice.value), ["c3.2xlarge.2.linux.bigdata", "ac2.2xlarge.2.linux.bigdata"]);
  assert.deepEqual(choices.rootVolumeTypes.map((choice) => choice.value), ["SATA", "SAS", "SSD", "GPSSD"]);
  assert.deepEqual(choices.dataVolumeTypes.map((choice) => choice.value), ["SATA", "SAS", "SSD", "GPSSD"]);
  assert.deepEqual(choices.subnets.map((choice) => choice.value), ["subnet-1", "subnet-2"]);
  assert.deepEqual(choices.securityGroups.map((choice) => choice.value), ["sg-1"]);
});

test("create options fail closed on unverifiable disk catalogs and never hide 403/5xx as empty offerings", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    const path = decodeURIComponent(url.pathname);
    if (path === "/v2/project-1/metadata/versions") return Response.json({ cluster_versions: ["MRS 3.9.9"] });
    if (path === "/v1.1/project-1/metadata/versions/MRS 3.9.9") return Response.json({ cluster_types: ["ANALYSIS"], components: [{ name: "Hadoop", version: "3.3.2", available_cluster_types: ["ANALYSIS"], visible: true }], constraints: { node_constraint: { master: { disk_type_constraint: { ESSED: "unknown-token" } }, core: { disk_type_constraint: { ESSED: "unknown-token" } } } } });
    return Response.json(read(url));
  });
  await assert.rejects(mrsManagement.options!(session, "create"), /documented volume type set/);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (decodeURIComponent(url.pathname).startsWith("/v1.1/project-1/metadata/versions/")) return Response.json({ error_msg: "permission denied" }, { status: 403 });
    return Response.json(read(url));
  });
  await assert.rejects(mrsManagement.options!(session, "create"), /403/);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (decodeURIComponent(url.pathname).includes("/available-flavor")) return Response.json({ error_msg: "server error" }, { status: 500 });
    return Response.json(read(url));
  });
  await assert.rejects(mrsManagement.options!(session, "create"), /500/);
});

test("create sends the documented v2 pay-per-use payload with failure-log collection off by default", async (t) => {
  const writes = mockCloud(t);
  const outcome = await mrsManagement.execute(session, "create", createValues);
  assert.equal(outcome.resourceId, "cluster-new");
  assert.equal(outcome.jobId, "cluster-new");
  assert.equal(outcome.asynchronous, true);
  assert.deepEqual(writes, [{ path: "/v2/project-1/clusters", method: "POST", body: {
    cluster_version: "MRS 3.1.5",
    cluster_name: "Nightly",
    cluster_type: "ANALYSIS",
    charge_info: { charge_mode: "postPaid" },
    region: "sa-brazil-1",
    vpc_name: "VPC One",
    subnet_id: "network-1",
    subnet_name: "Subnet",
    components: "Hadoop,Spark",
    availability_zone: "sa-brazil-1a",
    security_groups_id: "sg-1",
    safe_mode: "SIMPLE",
    manager_admin_password: "Man4ger!Pass",
    login_mode: "PASSWORD",
    node_root_password: "R00t!Passw0rd",
    enterprise_project_id: "0",
    log_collection: 0,
    node_groups: [
      { group_name: "master_node_default_group", node_num: 2, node_size: "c3.4xlarge.2.linux.bigdata", root_volume: { type: "SAS", size: 600 }, data_volume_count: 0 },
      { group_name: "core_node_analysis_group", node_num: 2, node_size: "c3.2xlarge.2.linux.bigdata", root_volume: { type: "SAS", size: 600 }, data_volume: { type: "SAS", size: 600 }, data_volume_count: 2 },
    ],
  } }]);
});

test("create only opts in to failure-log collection with an explicit boolean opt-in", async (t) => {
  const writes = mockCloud(t);
  await mrsManagement.execute(session, "create", { ...createValues, logCollection: true });
  assert.equal((writes[0].body as { log_collection: number }).log_collection, 1);
});

test("create rejects forged or unavailable selections before any cloud mutation", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, version: "MRS 3.2.0" }, /no longer available for analysis clusters/],
    [{ ...createValues, version: "forged" }, /no longer available for analysis clusters/],
    [{ ...createValues, version: "MRS 3.3.0" }, /verifiable disk type catalog/],
    [{ ...createValues, components: ["Kafka"] }, /not offered for the selected cluster version/],
    [{ ...createValues, components: ["Ranger"] }, /not offered for the selected cluster version/],
    [{ ...createValues, components: [] }, /not offered for the selected cluster version/],
    [{ ...createValues, rootVolumeType: "NVMe" }, /root disk type is not offered/],
    [{ ...createValues, dataVolumeType: "NVMe" }, /data disk type is not offered/],
    [{ ...createValues, zone: "sa-brazil-9" }, /availability zone is no longer available/],
    [{ ...createValues, zone: "sa-brazil-1b", masterSpec: "c3.8xlarge.2.linux.bigdata" }, /Master specification is not on sale/],
    [{ ...createValues, zone: "sa-brazil-1b", coreSpec: "c3.2xlarge.2.linux.bigdata" }, /Core specification is not on sale/],
    [{ ...createValues, subnet: "forged-subnet" }, /subnet is no longer available/],
    [{ ...createValues, subnet: "subnet-2" }, /network ID/],
    [{ ...createValues, securityGroup: "forged-group" }, /security group is no longer available/],
    [{ ...createValues, managerPassword: "alllowercase9" }, /must combine/],
    [{ ...createValues, managerPassword: "Str0ng Pass1" }, /cannot contain spaces/],
    [{ ...createValues, managerPassword: "Str0ng~Pass1" }, /must combine/],
    [{ ...createValues, managerPassword: "Str0ng!Pass~1" }, /outside the supported MRS set/],
    [{ ...createValues, nodeRootPassword: "weakpassword" }, /must combine/],
    [{ ...createValues, name: "Analysis One" }, /already exists/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(mrsManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("create validates the documented numeric bounds directly in execute", async (t) => {
  const writes = mockCloud(t);
  const rejects: [ManagementValues, RegExp][] = [
    [{ ...createValues, coreNodes: 0 }, /whole number between 1 and 500/],
    [{ ...createValues, coreNodes: 501 }, /whole number between 1 and 500/],
    [{ ...createValues, rootVolumeSize: 9 }, /whole number between 10 and 32768/],
    [{ ...createValues, rootVolumeSize: 32769 }, /whole number between 10 and 32768/],
    [{ ...createValues, dataVolumeSize: 50 }, /whole number between 100 and 32000/],
    [{ ...createValues, dataVolumeCount: 0 }, /whole number between 1 and 10/],
    [{ ...createValues, dataVolumeCount: 11 }, /whole number between 1 and 10/],
  ];
  for (const [values, expression] of rejects) await assert.rejects(mrsManagement.execute(session, "create", values), expression);
  assert.equal(writes.length, 0);
});

test("create enforces the live node and disk constraints of the selected version", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "create", { ...createValues, coreNodes: 1 }), /Core node count must be at least 2/);
  await assert.rejects(mrsManagement.execute(session, "create", { ...createValues, rootVolumeSize: 60 }), /root disk size must be at least 100 GB/);
  await assert.rejects(mrsManagement.execute(session, "create", { ...createValues, dataVolumeSize: 150 }), /data disk size must be at least 200 GB/);
  await assert.rejects(mrsManagement.execute(session, "create", { ...createValues, dataVolumeType: "SSD", dataVolumeSize: 600, dataVolumeCount: 2 }), /total Core data disk capacity for SSD must be at least 2000 GB/);
  assert.equal(writes.length, 0);
  const accepted = mockCloud(t);
  await mrsManagement.execute(session, "create", { ...createValues, dataVolumeType: "SSD", dataVolumeSize: 1000, dataVolumeCount: 2 });
  assert.equal(accepted.length, 1);
});

test("create fails closed when the subnet's VPC cannot be verified in the project", async (t) => {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(url.pathname === "/v3/project-1/vpc/vpcs" ? { vpcs: [] } : read(url));
    writes.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(writeResponse);
  });
  await assert.rejects(mrsManagement.execute(session, "create", createValues), /VPC could not be verified/);
  assert.equal(writes.length, 0);
});

test("the form contract whitelists live disk types and enforces documented storage bounds", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const operation = mrsManagement.operations.find((item) => item.id === "create")!;
  const choices = await mrsManagement.options!(session, "create");
  const values = validateManagementValues(operation, createValues, choices);
  assert.equal(values.name, "Nightly");
  assert.throws(() => validateManagementValues(operation, { ...createValues, version: "MRS 3.2.0" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, components: ["Kafka"] }, choices), /unavailable selection/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, rootVolumeType: "NVMe" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, dataVolumeType: "NVMe" }, choices), /not available/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, logCollection: "yes" }, choices), /enabled or disabled/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, rootVolumeSize: 9 }, choices), /at least 10/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, dataVolumeSize: 50 }, choices), /at least 100/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, dataVolumeCount: 11 }, choices), /no more than 10/);
  assert.throws(() => validateManagementValues(operation, { ...createValues, coreNodes: 501 }, choices), /no more than 500/);
  assert.equal(operation.fields.find((field) => field.key === "logCollection")!.defaultValue, false);
});

test("inspection shows typed cluster facts and never exposes key files, native failure text, or raw errors", async (t) => {
  mockCloud(t);
  const outcome = await mrsManagement.execute(session, "inspect", {}, analysisResource);
  assert.equal(outcome.message, "Current MRS cluster configuration.");
  assert.ok(outcome.facts!.some((fact) => fact.label === "State" && fact.value === "running"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Billing mode" && fact.value === "Pay-per-use (billingType 12)"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Cluster mode" && fact.value === "SIMPLE"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Nodes" && fact.value === "4 total · 2 Master · 2 Core"));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Components" && fact.value === "Hadoop 3.3.1, Spark 3.1.1"));
  assert.ok(!JSON.stringify(outcome).includes("private-key-file"));
  assert.ok(!JSON.stringify(outcome).includes("error.log"));
  assert.ok(!JSON.stringify(outcome).includes("secret internal reason"));
});

test("inspection fails closed when the native record belongs to a different project", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    const path = decodeURIComponent(url.pathname);
    if (path === "/v1.1/project-1/cluster_infos/cluster-1") return Response.json({ cluster: { ...detailOf(clusters[0]), project_id: "other-project" } });
    return Response.json(read(url));
  });
  await assert.rejects(mrsManagement.execute(session, "inspect", {}, analysisResource), /different project/);
});

test("rename uses the native v2 cluster-name contract and verifies the native result", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "rename", { name: "Renamed" }, frozenResource), /not running/);
  assert.equal(writes.length, 0);
  const outcome = await mrsManagement.execute(session, "rename", { name: "Renamed" }, analysisResource);
  assert.equal(outcome.message, "Cluster renamed.");
  assert.deepEqual(writes, [{ path: "/v2/project-1/clusters/cluster-1/cluster-name", method: "PUT", body: { cluster_name: "Renamed" } }]);
});

test("rename fails closed on a native failed or unverified result", async (t) => {
  for (const result of ["failed", ""]) {
    const writes = mockCloud(t, { ...writeResponse, result });
    await assert.rejects(mrsManagement.execute(session, "rename", { name: "Renamed" }, analysisResource), result === "failed" ? /rejected this MRS request/ : /did not confirm/);
    assert.equal(writes.length, 1);
  }
});

test("delete refuses prepaid, string-only billing, busy states, and stale names before the native deletion", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "delete", {}, prepaidResource), /pay-per-use clusters only/);
  await assert.rejects(mrsManagement.execute(session, "delete", {}, frozenResource), /unavailable while the cluster state is frozen/);
  await assert.rejects(mrsManagement.execute(session, "delete", {}, startingResource), /unavailable while the cluster state is starting/);
  await assert.rejects(mrsManagement.execute(session, "delete", {}, scalingResource), /unavailable while the cluster state is scaling-out/);
  await assert.rejects(mrsManagement.execute(session, "delete", {}, { ...quietResource, name: "Stale Name" }), /current name does not match/);
  assert.equal(writes.length, 0);
});

test("delete fails closed when the live billing mode is missing or not the verified numeric pay-per-use value", async (t) => {
  for (const billingType of [undefined, "12"]) {
    const writes: { path: string; method: string; body?: unknown }[] = [];
    t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
      const url = new URL(input);
      if (!init.method) return Response.json(decodeURIComponent(url.pathname) === "/v1.1/project-1/cluster_infos/cluster-quiet" ? { cluster: { ...detailOf(clusters[2]), billingType } } : read(url));
      writes.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json(writeResponse);
    });
    await assert.rejects(mrsManagement.execute(session, "delete", {}, quietResource), /could not be verified as pay-per-use/);
    assert.equal(writes.length, 0);
  }
});

test("delete never quietly interrupts running jobs and observes removal from the native cluster ID", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "delete", {}, analysisResource), /still has 1 running job/);
  assert.equal(writes.length, 0);
  const outcome = await mrsManagement.execute(session, "delete", {}, quietResource);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, "cluster-quiet");
  await mrsManagement.execute(session, "delete", {}, kerberosResource);
  assert.deepEqual(writes, [
    { path: "/v1.1/project-1/clusters/cluster-quiet", method: "DELETE", body: undefined },
    { path: "/v1.1/project-1/clusters/cluster-kerb", method: "DELETE", body: undefined },
  ]);
  const deleteOperation = mrsManagement.operations.find((item) => item.id === "delete")!;
  assert.equal(deleteOperation.confirmation, true);
  assert.ok(deleteOperation.impact);
});

test("cluster polls observe the native cluster ID and map known states, absence, and foreign identities", async (t) => {
  const replies = [
    { cluster: { clusterId: "cluster-new", clusterName: "Nightly", clusterState: "starting" } },
    { cluster: { clusterId: "cluster-new", clusterName: "Nightly", clusterState: "running" } },
    { cluster: {} },
    { cluster: { clusterId: "cluster-new", clusterName: "Nightly", clusterState: "failed" } },
    { cluster: { clusterId: "cluster-new", clusterName: "Nightly", clusterState: "upgrading" } },
    { cluster: { clusterId: "other-cluster", clusterName: "Foreign", clusterState: "running" } },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname, "/v1.1/project-1/cluster_infos/cluster-new"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "mrs", operation: "Create analysis cluster", startedAt: new Date().toISOString(), state: "submitted", jobId: "cluster-new", resourceId: "cluster-new" };
  assert.equal((await mrsManagement.poll!(session, entry)).state, "submitted");
  assert.equal((await mrsManagement.poll!(session, entry)).state, "succeeded");
  await assert.rejects(mrsManagement.poll!(session, entry), /verifiable identity/);
  assert.equal((await mrsManagement.poll!(session, entry)).state, "failed");
  assert.equal((await mrsManagement.poll!(session, entry)).state, "submitted");
  await assert.rejects(mrsManagement.poll!(session, entry), /different MRS cluster/);
  await assert.rejects(mrsManagement.poll!(session, { ...entry, jobId: undefined }), /missing its cluster or job reference/);
  await assert.rejects(mrsManagement.poll!(session, { ...entry, jobId: "tampered" }), /inconsistent/);
});

test("cluster deletion polls stay submitted until the native cluster is verifiably gone", async (t) => {
  const replies = [
    { cluster: { clusterId: "cluster-quiet", clusterName: "Quiet One", clusterState: "terminating" } },
    { cluster: { clusterId: "cluster-quiet", clusterName: "Quiet One", clusterState: "running" } },
    { cluster: {} },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json(replies[index++]));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "mrs", operation: "Delete cluster", startedAt: new Date().toISOString(), state: "submitted", jobId: "cluster-quiet", resourceId: "cluster-quiet" };
  assert.equal((await mrsManagement.poll!(session, entry)).state, "submitted");
  assert.equal((await mrsManagement.poll!(session, entry)).state, "submitted");
  await assert.rejects(mrsManagement.poll!(session, entry), /verifiable identity/);
});

test("cluster deletion polls treat a native 404 as removal", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_msg: "not found" }, { status: 404 }));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "mrs", operation: "Delete cluster", startedAt: new Date().toISOString(), state: "submitted", jobId: "cluster-quiet", resourceId: "cluster-quiet" };
  assert.equal((await mrsManagement.poll!(session, entry)).state, "succeeded");
});

test("job listing reports known native states, normalizes unknown ones, and never shows private payloads", async (t) => {
  mockCloud(t);
  const outcome = await mrsManagement.execute(session, "jobs", {}, analysisResource);
  assert.equal(outcome.message, "4 job executions loaded.");
  assert.ok(outcome.facts!.some((fact) => fact.label === "Nightly ETL · MapReduce · RUNNING" && fact.value.includes("Result UNDEFINED") && fact.value.includes("id job-running")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Import · DistCp · FINISHED" && fact.value.includes("Result SUCCEEDED")));
  assert.ok(outcome.facts!.some((fact) => fact.label === "Alien · Flink · unknown" && fact.value.includes("Result unknown")));
  assert.ok(!JSON.stringify(outcome).includes("sensitive-job-argument"));
});

test("job lists fail closed when a native row belongs to a different cluster", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ total_record: 1, job_list: [{ job_id: "job-x", job_name: "X", job_type: "MapReduce", job_state: "RUNNING", job_result: "UNDEFINED", cluster_id: "other-cluster" }] }));
  await assert.rejects(mrsManagement.execute(session, "jobs", {}, analysisResource), /different cluster/);
});

test("job pagination completes every native page and malformed job rows fail closed", async (t) => {
  const offsets: string[] = [];
  let malformed = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const offset = new URL(input).searchParams.get("offset") ?? "1";
    offsets.push(offset);
    if (malformed) return Response.json({ total_record: 1, job_list: [{ job_name: "Ghost" }] });
    return Response.json({ total_record: 101, job_list: Array.from({ length: offset === "1" ? 100 : 1 }, (_, i) => ({ job_id: `job-${Number(offset) + i}`, job_name: `Job ${Number(offset) + i}`, job_type: "MapReduce", job_state: "FINISHED", job_result: "SUCCEEDED" })) });
  });
  const result = await mrsManagement.execute(session, "jobs", {}, analysisResource);
  assert.equal(result.facts?.length, 101);
  assert.deepEqual(offsets, ["1", "101"]);
  malformed = true;
  await assert.rejects(mrsManagement.execute(session, "jobs", {}, analysisResource), /verifiable identity/);
});

test("stopping targets only running jobs on verified SIMPLE clusters through the native kill route", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "stop-job", { job: "job-done" }, analysisResource), /still running/);
  await assert.rejects(mrsManagement.execute(session, "stop-job", { job: "forged-job" }, analysisResource), /Select a job of this cluster/);
  await assert.rejects(mrsManagement.execute(session, "stop-job", { job: "job-running" }, kerberosResource), /SIMPLE/);
  await assert.rejects(mrsManagement.execute(session, "stop-job", { job: "job-running" }, frozenResource), /running clusters only/);
  assert.equal(writes.length, 0);
  const outcome = await mrsManagement.execute(session, "stop-job", { job: "job-running" }, analysisResource);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, "job-running");
  assert.equal(outcome.resourceId, "cluster-1");
  assert.deepEqual(writes, [{ path: "/v2/project-1/clusters/cluster-1/job-executions/job-running/kill", method: "POST", body: undefined }]);
  const choices = await mrsManagement.options!(session, "stop-job", analysisResource);
  assert.deepEqual(choices.stoppableJobs.map((choice) => choice.value), ["job-running"]);
  assert.deepEqual((await mrsManagement.options!(session, "delete-job", analysisResource)).finishedJobs.map((choice) => choice.value), ["job-done", "job-failed"]);
  assert.deepEqual(await mrsManagement.options!(session, "stop-job"), {});
});

test("stop-job polls map KILLED to success only for the stop label and keep unknown states submitted", async (t) => {
  const replies = [
    { job_detail: { job_id: "job-running", job_state: "RUNNING", job_result: "UNDEFINED" } },
    { job_detail: { job_id: "job-running", job_state: "KILLED", job_result: "KILLED" } },
    { job_detail: { job_id: "job-running", job_state: "RESTARTING", job_result: "STRANGE" } },
    { job_detail: {} },
    { job_detail: { job_id: "other-job", job_state: "RUNNING", job_result: "UNDEFINED" } },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => { assert.equal(new URL(input).pathname, "/v2/project-1/clusters/cluster-1/job-executions/job-running"); return Response.json(replies[index++]); });
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "mrs", operation: "Stop running job", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-running", resourceId: "cluster-1" };
  assert.equal((await mrsManagement.poll!(session, entry)).state, "submitted");
  const killed = await mrsManagement.poll!(session, entry);
  assert.equal(killed.state, "succeeded");
  assert.match(killed.message!, /terminated/);
  assert.equal((await mrsManagement.poll!(session, entry)).state, "submitted");
  await assert.rejects(mrsManagement.poll!(session, entry), /verifiable identity/);
  await assert.rejects(mrsManagement.poll!(session, entry), /different MRS job/);
});

test("stop-job polls report a job that finished on its own before the termination took effect", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ job_detail: { job_id: "job-running", job_state: "FINISHED", job_result: "SUCCEEDED" } }));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "mrs", operation: "Stop running job", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-running", resourceId: "cluster-1" };
  const outcome = await mrsManagement.poll!(session, entry);
  assert.equal(outcome.state, "failed");
  assert.match(outcome.message!, /SUCCEEDED result before the termination/);
});

test("job record deletion removes only finished jobs through the native batch-delete route", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "delete-job", { job: "job-running" }, analysisResource), /Only finished jobs/);
  await assert.rejects(mrsManagement.execute(session, "delete-job", { job: "forged-job" }, analysisResource), /Select a job of this cluster/);
  await assert.rejects(mrsManagement.execute(session, "delete-job", { job: "job-done" }, kerberosResource), /SIMPLE/);
  assert.equal(writes.length, 0);
  const outcome = await mrsManagement.execute(session, "delete-job", { job: "job-done" }, analysisResource);
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, "job-done");
  assert.deepEqual(writes, [{ path: "/v2/project-1/clusters/cluster-1/job-executions/batch-delete", method: "POST", body: { job_id_list: ["job-done"] } }]);
});

test("delete-job polls complete only when the original record is verifiably gone", async (t) => {
  const replies = [
    { job_detail: { job_id: "job-done", job_state: "FINISHED", job_result: "SUCCEEDED" } },
    { job_detail: {} },
  ];
  let index = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json(replies[index++]));
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "mrs", operation: "Delete finished job record", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-done", resourceId: "cluster-1" };
  assert.equal((await mrsManagement.poll!(session, entry)).state, "submitted");
  await assert.rejects(mrsManagement.poll!(session, entry), /verifiable identity/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_msg: "private failure" }, { status: 404 }));
  assert.equal((await mrsManagement.poll!(session, entry)).state, "succeeded");
});

test("job submission stays an explicit gap: no submit-job operation exists and polls whitelist labels", async (t) => {
  assert.deepEqual(mrsManagement.operations.map((operation) => operation.id), ["create", "inspect", "rename", "delete", "jobs", "stop-job", "delete-job"]);
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "submit-job", { jobType: "MapReduce", jobName: "Nightly_ETL" }, analysisResource), /Unsupported MRS operation/);
  assert.equal(writes.length, 0);
  const entry: ManagementHistoryEntry = { id: randomUUID(), service: "mrs", operation: "Submit data processing job", startedAt: new Date().toISOString(), state: "submitted", jobId: "job-running", resourceId: "cluster-1" };
  await assert.rejects(mrsManagement.poll!(session, entry), /Unsupported MRS operation poll/);
});

test("outcomes and rejection errors never expose passwords", async (t) => {
  const writes = mockCloud(t);
  const weak = "alllowercase9";
  await assert.rejects(mrsManagement.execute(session, "create", { ...createValues, managerPassword: weak }), (error: Error) => !error.message.includes(weak));
  const secret = "Man4ger!Pass";
  const outcome = await mrsManagement.execute(session, "create", { ...createValues, managerPassword: secret });
  assert.ok(!JSON.stringify(outcome).includes(secret));
  assert.equal(writes.length, 1);
  assert.equal((writes[0].body as { manager_admin_password: string }).manager_admin_password, secret);
});

test("unsupported operations fail closed without touching the cloud", async (t) => {
  const writes = mockCloud(t);
  await assert.rejects(mrsManagement.execute(session, "expand", {}, analysisResource), /Unsupported MRS operation/);
  assert.equal(writes.length, 0);
});
