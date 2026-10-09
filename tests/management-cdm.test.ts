import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { cdmManagement } from "@/lib/huawei/management/adapters/cdm";
import { session } from "./fixtures/session";

const clusterId = "cluster-1";
const clusterName = "cdm-migration";
const cluster = { id: clusterId, name: clusterName, status: "200", statusDetail: "Normal", flavorName: "cdm.medium", azName: "sa-brazil-1a", clusterMode: "SINGLE", datastore: { type: "cdm", version: "2.9" }, vpc_id: "vpc-1", subnet_id: "subnet-1", security_group_id: "sg-1", eps_id: "0", isAutoOff: false, isScheduleBootOff: false, publicEndpoint: "", maintainWindow: { day: "Mon", startTime: "02:00", endTime: "06:00" }, instances: [{ id: "i-1", name: "cdm-migration-1", status: "200", flavor: { id: "fb8fe666-6734-4b11-bc6c-43d11db3c745" }, volume: { type: "LOCAL", size: 100 } }] };
const flavorId = "fb8fe666-6734-4b11-bc6c-43d11db3c745";
const job = { name: "sync-orders", job_type: "NORMAL_JOB", "from-connector-name": "generic-jdbc-connector", "to-connector-name": "obs-connector", "from-link-name": "src-jdbc", "to-link-name": "target-obs", status: "SUCCEEDED", enabled: true, rows_read: 120, rows_written: 120, files_read: 0, files_written: 3, "creation-user": "admin", "creation-date": 1767139200000, "update-date": 1767139500000, "from-config-values": { configs: [{ inputs: [{ name: "password", value: "jdbc-secret" }] }] } };
const runningJob = { ...job, name: "loop-files", status: "RUNNING" };
const batchJob = { ...job, name: "whole-db", job_type: "BATCH_JOB", status: "NEVER_EXECUTED" };
const link = { name: "src-jdbc", "connector-name": "generic-jdbc-connector", enabled: true, id: 1, "creation-user": "admin", "creation-date": 1767139200000, "update-user": "admin", "update-date": 1767139200000, "link-config-values": { configs: [{ inputs: [{ name: "password", value: "link-secret" }] }] } };
const resource = { id: clusterId, name: clusterName, status: "200" as const };

function read(url: URL) {
  const path = url.pathname;
  if (path === `/v1.1/${session.projectId}/clusters`) return { clusters: [cluster] };
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}`) return cluster;
  if (path === `/v1.1/${session.projectId}/datastores`) return { datastores: [{ id: "cdm", name: "cdm", defaultVersion: "2.9", versions: [{ id: "2.9", name: "2.9", active: "1" }] }] };
  if (path === `/v1.1/${session.projectId}/datastores/cdm/flavors`) return { id: "cdm", dbname: "cdm", versions: [{ id: "2.9", name: "2.9", flavors: [{ cpu: 4, ram: 8, name: "cdm.medium", region: "all", typename: "cdm.medium", cluster_mode: "SINGLE", status: "normal", str_id: flavorId }] }] };
  if (path === `/v1.1/${session.projectId}/regions/${session.region}/availability_zones`) return { regionId: session.region, defaultAZ: "sa-brazil-1a", availableZones: [{ availableZoneId: "sa-brazil-1a", availableZoneName: "AZ one", availableZoneCode: "sa-brazil-1a", azStatus: "Available" }, { availableZoneId: "sa-brazil-1b", availableZoneName: "AZ two", availableZoneCode: "sa-brazil-1b", azStatus: "disable" }] };
  if (path === `/v1/${session.projectId}/subnets`) return { subnets: [{ id: "subnet-1", name: "App subnet", cidr: "192.168.0.0/24", vpc_id: "vpc-1", neutron_network_id: "network-1", status: "ACTIVE" }] };
  if (path === `/v3/${session.projectId}/vpc/security-groups`) return { security_groups: [{ id: "sg-1", name: "cdm-access" }] };
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/job/all`) {
    const jobType = url.searchParams.get("jobType");
    if (jobType === "NORMAL_JOB") return { total: 2, jobs: [job, runningJob], page_no: 1, page_size: 100 };
    if (jobType === "BATCH_JOB") return { total: 1, jobs: [batchJob], page_no: 1, page_size: 100 };
    return { total: 0, jobs: [], page_no: 1, page_size: 100 };
  }
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/job/sync-orders`) return { total: 0, jobs: [job] };
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/job/loop-files`) return { total: 0, jobs: [runningJob] };
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/job/loop-files/status`) return { submissions: [{ "job-name": "loop-files", status: "RUNNING", "submission-id": 10 }] };
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/job/sync-orders/status`) return { submissions: [{ "job-name": "sync-orders", status: "SUCCEEDED", progress: 1, "submission-id": 9, "execute-date": 1767139500000 }] };
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/submissions`) return { submissions: [{ "job-name": "sync-orders", status: "SUCCEEDED", "submission-id": 9, "execute-date": 1767139500000 }], total: 1, page_no: 1, page_size: 10 };
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/link/src-jdbc`) return { links: [link] };
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/link/target-obs`) return { links: [{ name: "target-obs", "connector-name": "obs-connector", enabled: true }] };
  if (path === `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/link/unused-obs`) return { links: [{ name: "unused-obs", "connector-name": "obs-connector", enabled: true }] };
  throw new Error(`Unexpected GET ${path}`);
}

function mock(t: TestContext, change: (url: URL) => unknown = () => undefined, result: Record<string, unknown> = { jobId: "task-1" }) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method) {
      writes.push({ path: url.pathname, method: init.method, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return Response.json(result);
    }
    const own = change(url);
    if (own instanceof Response) return own;
    if (own !== undefined) return Response.json(own);
    return Response.json(read(url));
  });
  return writes;
}

function entry(operation: string, jobId?: string) {
  return { id: "request", service: "cdm", operation, resourceId: clusterId, resourceName: clusterName, projectId: session.projectId, startedAt: new Date().toISOString(), state: "submitted" as const, jobId };
}

test("CDM inventory exposes raw native cluster statuses for state guards", async t => {
  mock(t);
  const resources = await cdmManagement.inventory(session);
  assert.equal(resources.length, 1);
  assert.equal(resources[0].id, clusterId);
  assert.equal(resources[0].status, "200");
  assert.equal(resources[0].values?.version, "2.9");
  assert.deepEqual(cdmManagement.invalidationKeys(resource), ["listCdmClusters", "cloud-summary"]);
});

test("CDM create options come from the live version, flavor, AZ, and network catalogs", async t => {
  mock(t);
  const choices = await cdmManagement.options!(session, "create");
  assert.deepEqual(choices.offerings, [{ value: JSON.stringify(["cdm", "2.9", flavorId]), label: "CDM 2.9 · cdm.medium · 4 vCPU · 8 GB RAM" }]);
  assert.deepEqual(choices.zones, [{ value: "sa-brazil-1a", label: "AZ one · sa-brazil-1a" }]);
  assert.deepEqual(choices.subnets, [{ value: "subnet-1", label: "App subnet · 192.168.0.0/24 · vpc-1" }]);
  assert.deepEqual(choices.securityGroups, [{ value: "sg-1", label: "cdm-access" }]);
});

test("CDM create fails closed when the native catalog is empty", async t => {
  const writes = mock(t, url => url.pathname.endsWith("/datastores") ? { datastores: [] } : undefined);
  const choices = await cdmManagement.options!(session, "create");
  assert.deepEqual(choices.offerings, []);
  await assert.rejects(cdmManagement.execute(session, "create", { name: "cdm-fresh", offering: JSON.stringify(["cdm", "2.9", flavorId]), zone: "sa-brazil-1a", subnet: "subnet-1", securityGroup: "sg-1" }), /no longer available/);
  assert.equal(writes.length, 0);
});

test("CDM create posts the native pay-per-use cluster body using the subnet ID", async t => {
  const writes = mock(t, undefined, { id: "new-cluster", task: { id: "task-9", name: "Creating" } });
  const result = await cdmManagement.execute(session, "create", { name: "cdm-fresh", offering: JSON.stringify(["cdm", "2.9", flavorId]), zone: "sa-brazil-1a", subnet: "subnet-1", securityGroup: "sg-1", enterpriseProjectId: "0" });
  assert.deepEqual(writes, [{ path: `/v1.1/${session.projectId}/clusters`, method: "POST", body: { cluster: { name: "cdm-fresh", vpcId: "vpc-1", instances: [{ availability_zone: "sa-brazil-1a", nics: [{ securityGroupId: "sg-1", "net-id": "subnet-1" }], flavorRef: flavorId, type: "cdm" }], datastore: { type: "cdm", version: "2.9" }, sys_tags: [{ key: "_sys_enterprise_project_id", value: "0" }] } } }]);
  assert.equal(result.resourceId, "new-cluster");
  assert.equal(result.jobId, "task-9");
  assert.equal(result.asynchronous, true);
  assert.match(result.message, /pay-per-use/);
});

test("CDM create re-verifies live catalogs and rejects stale selections", async t => {
  const writes = mock(t);
  const base = { name: "cdm-fresh", zone: "sa-brazil-1a", subnet: "subnet-1", securityGroup: "sg-1" };
  await assert.rejects(cdmManagement.execute(session, "create", { ...base, offering: JSON.stringify(["cdm", "9.9", flavorId]) }), /no longer available/);
  await assert.rejects(cdmManagement.execute(session, "create", { ...base, offering: JSON.stringify(["cdm", "2.9", "deadbeef-0000-0000-0000-000000000000"]) }), /no longer available/);
  await assert.rejects(cdmManagement.execute(session, "create", { ...base, offering: JSON.stringify(["cdm", "2.9", flavorId]), zone: "sa-brazil-1z" }), /availability zone/);
  await assert.rejects(cdmManagement.execute(session, "create", { ...base, offering: JSON.stringify(["cdm", "2.9", flavorId]), subnet: "foreign" }), /subnet/);
  await assert.rejects(cdmManagement.execute(session, "create", { ...base, offering: JSON.stringify(["cdm", "2.9", flavorId]), securityGroup: "foreign" }), /security group/);
  assert.equal(writes.length, 0);
});

test("CDM restart, start, and stop respect fresh native cluster states", async t => {
  const writes = mock(t, url => url.pathname.endsWith(`/clusters/${clusterId}`) ? { ...cluster, status: "900" } : undefined);
  await assert.rejects(cdmManagement.execute(session, "restart", { restartMode: "IMMEDIATELY" }, resource), /unavailable while the cluster status is 900/);
  await assert.rejects(cdmManagement.execute(session, "stop", { stopMode: "IMMEDIATELY" }, resource), /unavailable while the cluster status is 900/);
  const started = await cdmManagement.execute(session, "start", {}, resource);
  assert.deepEqual(writes, [{ path: `/v1.1/${session.projectId}/clusters/${clusterId}/action`, method: "POST", body: { start: {} } }]);
  assert.equal(started.asynchronous, true);
  assert.match(started.message, /billing resumes/);
});

test("CDM restart and stop post the documented native action bodies", async t => {
  const writes = mock(t, undefined, { jobId: ["task-2"] });
  await cdmManagement.execute(session, "restart", { restartMode: "FORCELY" }, resource);
  await cdmManagement.execute(session, "stop", { stopMode: "GRACEFULLY", delayTime: -1 }, resource);
  assert.deepEqual(writes.map(write => write.body), [
    { restart: { restartMode: "FORCELY", restartLevel: "SERVICE", type: "cdm", instance: "", group: "" } },
    { stop: { stopMode: "GRACEFULLY", delayTime: -1 } },
  ]);
  assert.equal(writes.every(write => write.path === `/v1.1/${session.projectId}/clusters/${clusterId}/action`), true);
  await assert.rejects(cdmManagement.execute(session, "stop", { stopMode: "GRACEFULLY", delayTime: 0 }, resource), /shutdown delay/);
  await assert.rejects(cdmManagement.execute(session, "stop", { stopMode: "GRACEFULLY" }, resource), /shutdown delay/);
});

test("CDM modify updates native settings with mutual exclusion and contact validation", async t => {
  const writes = mock(t);
  await assert.rejects(cdmManagement.execute(session, "modify", { autoOff: true, scheduleBootOff: true, autoRemind: false }, resource), /cannot be enabled at the same time/);
  await assert.rejects(cdmManagement.execute(session, "modify", { autoOff: false, scheduleBootOff: true, autoRemind: false }, resource), /requires both/);
  await assert.rejects(cdmManagement.execute(session, "modify", { autoOff: false, scheduleBootOff: false, autoRemind: true }, resource), /phone number or an email/);
  assert.equal(writes.length, 0);
  await cdmManagement.execute(session, "modify", { autoOff: false, scheduleBootOff: true, scheduleBootTime: "01:00:00", scheduleOffTime: "05:00:00", autoRemind: true, email: "ops@example.com" }, resource);
  assert.deepEqual(writes, [{ path: `/v1.1/${session.projectId}/cluster/modify/${clusterId}`, method: "POST", body: { autoOff: false, scheduleBootOff: true, scheduleBootTime: "01:00:00", scheduleOffTime: "05:00:00", autoRemind: true, email: "ops@example.com" } }]);
});

test("CDM cluster deletion is blocked by state, remaining jobs, and reports the connection gap", async t => {
  const transitional = mock(t, url => url.pathname.endsWith(`/clusters/${clusterId}`) ? { ...cluster, status: "100" } : undefined);
  await assert.rejects(cdmManagement.execute(session, "delete", {}, resource), /unavailable while the cluster status is 100/);
  assert.equal(transitional.length, 0);
  const writes = mock(t);
  await assert.rejects(cdmManagement.execute(session, "delete", {}, resource), /still has 3 migration job/);
  assert.ok(cdmManagement.operations.find(operation => operation.id === "delete")!.impact!.includes("cannot enumerate connections"));
  assert.equal(writes.length, 0);
});

test("CDM cluster deletion submits the native delete once every job is gone", async t => {
  const writes = mock(t, url => url.pathname.endsWith("/cdm/job/all") ? { total: 0, jobs: [], page_no: Number(url.searchParams.get("page_no")) || 1, page_size: 100 } : undefined, { jobId: "task-3" });
  const result = await cdmManagement.execute(session, "delete", {}, resource);
  assert.deepEqual(writes, [{ path: `/v1.1/${session.projectId}/clusters/${clusterId}`, method: "DELETE" }]);
  assert.equal(result.jobId, "task-3");
  assert.equal(result.asynchronous, true);
});

test("CDM cluster inspection reports topology, config, and resources", async t => {
  mock(t);
  const outcome = await cdmManagement.execute(session, "inspect", {}, resource);
  const text = JSON.stringify(outcome);
  assert.ok(outcome.facts!.some(fact => fact.label === "Subnet" && fact.value === "subnet-1"));
  assert.ok(outcome.facts!.some(fact => fact.label.startsWith("Node cdm-migration-1")));
  assert.ok(outcome.facts!.some(fact => fact.label === "Public endpoint" && fact.value === "Not bound"));
  assert.ok(!text.includes("manageIp"));
});

test("CDM job listing covers every native job type without connection secrets", async t => {
  mock(t);
  const outcome = await cdmManagement.execute(session, "jobs", {}, resource);
  assert.match(outcome.message, /3 migration jobs loaded/);
  assert.ok(outcome.facts!.some(fact => fact.label.includes("whole-db") && fact.label.includes("BATCH_JOB")));
  assert.ok(outcome.facts!.some(fact => fact.label.includes("loop-files") && fact.value.includes("RUNNING")));
  assert.ok(!JSON.stringify(outcome).includes("jdbc-secret"));
});

test("CDM job listing paginates each native job type until the reported total", async t => {
  const pages = new Set<string>();
  const many = Array.from({ length: 150 }, (_, index) => ({ ...job, name: `copy-${index}` }));
  mock(t, url => {
    if (url.pathname.endsWith("/cdm/job/all") && url.searchParams.get("jobType") === "NORMAL_JOB") {
      const pageNo = Number(url.searchParams.get("page_no")) || 1;
      pages.add(`normal-${pageNo}`);
      return { total: 152, jobs: [...many, job, runningJob].slice((pageNo - 1) * 100, pageNo * 100), page_no: pageNo, page_size: 100 };
    }
    return undefined;
  });
  const outcome = await cdmManagement.execute(session, "jobs", {}, resource);
  assert.deepEqual([...pages].sort(), ["normal-1", "normal-2"]);
  assert.match(outcome.message, /153 migration jobs loaded/);
  assert.ok(!JSON.stringify(outcome).includes("jdbc-secret"));
});

test("CDM job inspection shows native progress without job configuration secrets", async t => {
  mock(t);
  const outcome = await cdmManagement.execute(session, "job", { job: "sync-orders" }, resource);
  assert.ok(!JSON.stringify(outcome).includes("jdbc-secret"));
  assert.ok(outcome.facts!.some(fact => fact.label === "Latest run" && fact.value.includes("SUCCEEDED")));
  assert.ok(outcome.facts!.some(fact => fact.label === "From" && fact.value.includes("src-jdbc")));
});

test("CDM job history reports the native single page and its limit", async t => {
  mock(t);
  const outcome = await cdmManagement.execute(session, "job-history", { job: "sync-orders" }, resource);
  assert.match(outcome.message, /1 job runs loaded\.$/);
  mock(t, url => url.pathname.endsWith("/cdm/submissions") ? { submissions: Array.from({ length: 10 }, (_, index) => ({ "job-name": "sync-orders", status: "SUCCEEDED", "submission-id": index })), total: 12, page_no: 1, page_size: 10 } : undefined);
  const limited = await cdmManagement.execute(session, "job-history", { job: "sync-orders" }, resource);
  assert.match(limited.message, /latest 10 of 12 runs and exposes no paging parameters/);
});

test("CDM job start enforces fresh running states and posts the native variables body", async t => {
  const writes = mock(t, undefined, { submissions: [{ "job-name": "sync-orders", "submission-id": 42, status: "BOOTING" }] });
  const choices = await cdmManagement.options!(session, "start-job", resource);
  assert.deepEqual(choices.jobs.map(choice => choice.value), ["sync-orders", "whole-db"]);
  await assert.rejects(cdmManagement.execute(session, "start-job", { job: "loop-files" }, resource), /currently RUNNING/);
  const started = await cdmManagement.execute(session, "start-job", { job: "sync-orders" }, resource);
  assert.deepEqual(writes, [{ path: `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/job/sync-orders/start`, method: "PUT", body: { variables: {} } }]);
  assert.equal(started.jobId, JSON.stringify({ name: "sync-orders", submission: 42 }));
  assert.equal(started.asynchronous, true);
  assert.match(started.message, /submission 42/);
});

test("CDM job stop targets only running jobs and honors native validation results", async t => {
  const writes = mock(t, undefined, { "validation-result": [] });
  const options = await cdmManagement.options!(session, "stop-job", resource);
  assert.deepEqual(options.jobs.map(choice => choice.value), ["loop-files"]);
  await assert.rejects(cdmManagement.execute(session, "stop-job", { job: "sync-orders" }, resource), /not running/);
  const stopped = await cdmManagement.execute(session, "stop-job", { job: "loop-files" }, resource);
  assert.deepEqual(writes, [{ path: `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/job/loop-files/stop`, method: "PUT" }]);
  assert.equal(stopped.jobId, JSON.stringify({ name: "loop-files", submission: 10 }));
  assert.equal(stopped.asynchronous, true);
  const rejecting = mock(t, undefined, { "validation-result": [{ message: "job not stoppable", status: "ERROR" }] });
  await assert.rejects(cdmManagement.execute(session, "stop-job", { job: "loop-files" }, resource), /Huawei rejected stopping/);
  assert.equal(rejecting.length, 1);
});

test("CDM job deletion refuses running jobs and deletes verified definitions", async t => {
  const writes = mock(t);
  await assert.rejects(cdmManagement.execute(session, "delete-job", { job: "loop-files" }, resource), /currently RUNNING/);
  await cdmManagement.execute(session, "delete-job", { job: "sync-orders" }, resource);
  assert.deepEqual(writes, [{ path: `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/job/sync-orders`, method: "DELETE" }]);
});

test("CDM connection inspection never exposes link configuration secrets", async t => {
  mock(t);
  const outcome = await cdmManagement.execute(session, "link", { linkName: "src-jdbc" }, resource);
  assert.ok(!JSON.stringify(outcome).includes("link-secret"));
  assert.ok(outcome.facts!.some(fact => fact.label === "Connector" && fact.value === "generic-jdbc-connector"));
});

test("CDM connection deletion blocks referenced and missing connections", async t => {
  const writes = mock(t);
  await assert.rejects(cdmManagement.execute(session, "delete-link", { linkName: "src-jdbc" }, resource), /still use this connection/);
  await assert.rejects(cdmManagement.execute(session, "delete-link", { linkName: "target-obs" }, resource), /still use this connection/);
  assert.equal(writes.length, 0);
  const missing = mock(t, url => url.pathname.endsWith("/cdm/link/missing-link") ? new Response("{}", { status: 404 }) : undefined);
  await assert.rejects(cdmManagement.execute(session, "delete-link", { linkName: "missing-link" }, resource), /not found/);
  assert.equal(missing.length, 0);
});

test("CDM deletes unreferenced connections through the native route", async t => {
  const writes = mock(t);
  await cdmManagement.execute(session, "delete-link", { linkName: "unused-obs" }, resource);
  assert.deepEqual(writes, [{ path: `/v1.1/${session.projectId}/clusters/${clusterId}/cdm/link/unused-obs`, method: "DELETE" }]);
});

test("CDM cluster polls follow native status codes", async t => {
  let status = "100";
  mock(t, url => url.pathname.endsWith(`/clusters/${clusterId}`) ? { ...cluster, status } : undefined);
  const creating = entry("Create cluster", "task-9");
  assert.equal((await cdmManagement.poll!(session, creating)).state, "submitted");
  status = "200";
  assert.equal((await cdmManagement.poll!(session, creating)).state, "succeeded");
  status = "303";
  const failed = await cdmManagement.poll!(session, creating);
  assert.equal(failed.state, "failed");
  assert.match(failed.message!, /failure status 303/);
  status = "910";
  assert.equal((await cdmManagement.poll!(session, entry("Stop cluster", "task-2"))).state, "submitted");
  status = "900";
  assert.equal((await cdmManagement.poll!(session, entry("Stop cluster", "task-2"))).state, "succeeded");
  status = "920";
  assert.equal((await cdmManagement.poll!(session, entry("Start cluster", "task-2"))).state, "submitted");
  status = "200";
  assert.equal((await cdmManagement.poll!(session, entry("Start cluster", "task-2"))).state, "succeeded");
  status = "500";
  assert.equal((await cdmManagement.poll!(session, entry("Restart cluster", "task-2"))).state, "submitted");
  status = "200";
  assert.equal((await cdmManagement.poll!(session, entry("Restart cluster", "task-2"))).state, "submitted");
});

test("CDM delete poll succeeds only when the cluster is gone", async t => {
  let missing = false;
  mock(t, url => missing && url.pathname.endsWith(`/clusters/${clusterId}`) ? new Response("{}", { status: 404 }) : undefined);
  const deleting = entry("Delete cluster", "task-3");
  assert.equal((await cdmManagement.poll!(session, deleting)).state, "submitted");
  missing = true;
  assert.equal((await cdmManagement.poll!(session, deleting)).state, "succeeded");
});

test("CDM job polling follows its saved run, refuses newer runs, and leaves unknown results pending", async t => {
  let status = "RUNNING", number = 42, name = "sync-orders";
  mock(t, url => url.pathname.endsWith("/cdm/submissions") ? { submissions: [{ "job-name": name, status, "submission-id": number }] } : undefined);
  const reference = JSON.stringify({ name: "sync-orders", submission: 42 });
  const starting = entry("Start job", reference);
  assert.equal((await cdmManagement.poll!(session, starting)).state, "submitted");
  status = "SUCCEEDED"; assert.equal((await cdmManagement.poll!(session, starting)).state, "succeeded");
  status = "FAILED"; assert.equal((await cdmManagement.poll!(session, starting)).state, "failed");
  number = 43; assert.equal((await cdmManagement.poll!(session, starting)).state, "submitted");
  number = 42; name = "foreign"; assert.equal((await cdmManagement.poll!(session, starting)).state, "submitted");
  name = "sync-orders"; status = "UNKNOWN";
  assert.equal((await cdmManagement.poll!(session, entry("Stop job", reference))).state, "submitted");
  status = "FAILED"; assert.equal((await cdmManagement.poll!(session, entry("Stop job", reference))).state, "succeeded");
});

test("CDM operations document native limitations and billing impacts", () => {
  assert.equal(cdmManagement.title, "Cloud Data Migration");
  const create = cdmManagement.operations.find(operation => operation.id === "create")!;
  assert.match(create.description, /pay-per-use/);
  assert.match(create.description, /no prepaid billing mode/);
  const remove = cdmManagement.operations.find(operation => operation.id === "delete")!;
  assert.match(remove.description, /billing mode is not exposed|does not expose the cluster billing mode/);
  const stop = cdmManagement.operations.find(operation => operation.id === "stop")!;
  assert.match(stop.impact!, /billing stops/);
  const start = cdmManagement.operations.find(operation => operation.id === "start")!;
  assert.match(start.impact!, /billing resumes/);
  assert.ok(!cdmManagement.operations.some(operation => ["create-link", "create-job", "update-link", "update-job", "quotas"].includes(operation.id)));
  const linkOperation = cdmManagement.operations.find(operation => operation.id === "link")!;
  assert.match(linkOperation.description, /no connection listing route/);
  const modify = cdmManagement.operations.find(operation => operation.id === "modify")!;
  assert.match(modify.description, /no cluster rename or description editing/);
});

test("CDM creation refuses deprecated flavors, inactive versions, and unavailable or unverified zones", async t => {
  let kind = "flavor";
  const writes = mock(t, url => {
    const normal = read(url);
    if (kind === "flavor" && url.pathname.endsWith("/flavors")) return { id: "cdm", dbname: "cdm", versions: [{ id: "2.9", name: "2.9", flavors: [{ str_id: flavorId, status: "abandon", region: "all" }] }] };
    if (kind === "version" && url.pathname.endsWith("/datastores")) return { datastores: [{ id: "cdm", name: "cdm", versions: [{ name: "2.9", active: "0" }] }] };
    if (kind === "zone" && url.pathname.endsWith("/availability_zones")) return { availableZones: [{ availableZoneCode: "sa-brazil-1a" }] };
    return normal;
  });
  const values = { name: "cdm-fresh", offering: JSON.stringify(["cdm", "2.9", flavorId]), zone: "sa-brazil-1a", subnet: "subnet-1", securityGroup: "sg-1" };
  for (kind of ["flavor", "version", "zone"]) await assert.rejects(cdmManagement.execute(session, "create", values), /no longer available/);
  assert.equal(writes.length, 0);
});
test("CDM job writes reject unknown idle states and unverified native submission identity", async t => {
  const writes = mock(t, url => url.pathname.endsWith("/cdm/job/sync-orders") ? { jobs: [{ ...job, status: "UNKNOWN" }] } : undefined);
  await assert.rejects(cdmManagement.execute(session, "start-job", { job: job.name }, resource), /idle state is unverified/);
  await assert.rejects(cdmManagement.execute(session, "delete-job", { job: job.name }, resource), /idle state is unverified/);
  assert.equal(writes.length, 0);
  mock(t, undefined, { submissions: [{ "job-name": job.name, status: "BOOTING" }] });
  await assert.rejects(cdmManagement.execute(session, "start-job", { job: job.name }, resource), /no verifiable submission/);
});
test("CDM rejects repeated job pages before allowing cluster or connection deletion", async t => {
  const writes = mock(t, url => url.pathname.endsWith("/cdm/job/all") ? { jobs: [job], total: 10 } : undefined);
  await assert.rejects(cdmManagement.execute(session, "delete-link", { linkName: "unused-obs" }, resource), /repeated a CDM job page/);
  assert.equal(writes.length, 0);
});

test("CDM deletion polling cannot interpret a mismatched returned cluster as successful deletion", async t => {
  mock(t, url => url.pathname.endsWith(`/clusters/${clusterId}`) ? { ...cluster, id: "foreign-cluster" } : undefined);
  await assert.rejects(cdmManagement.poll!(session, entry("Delete cluster", "task-9")), /different or unverified CDM cluster/);
});
test("CDM creation accepts the documented bare version array and rejects a foreign flavor catalog", async t => {
  mock(t, url => url.pathname.endsWith("/datastores") ? (read(url) as { datastores: unknown[] }).datastores : undefined);
  assert.equal((await cdmManagement.options!(session, "create")).offerings.length, 1);
  const writes = mock(t, url => url.pathname.endsWith("/flavors") ? { id: "foreign", dbname: "cdm", versions: [] } : undefined);
  await assert.rejects(cdmManagement.execute(session, "create", { name: "cdm-fresh", offering: JSON.stringify(["cdm", "2.9", flavorId]), zone: "sa-brazil-1a", subnet: "subnet-1", securityGroup: "sg-1" }), /no verified CDM flavor catalog/);
  assert.equal(writes.length, 0);
});
test("CDM job creation-time identity is retained when the native response omits its optional submission ID", async t => {
  mock(t, undefined, { submissions: [{ "job-name": job.name, "creation-date": 1767139500000, status: "BOOTING" }] });
  const result = await cdmManagement.execute(session, "start-job", { job: job.name }, resource);
  assert.equal(result.jobId, JSON.stringify({ name: job.name, created: 1767139500000 }));
});
