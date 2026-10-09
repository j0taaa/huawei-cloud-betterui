import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ManagementHistoryEntry } from "@/lib/management-contract";
import { validateManagementValues } from "@/lib/management-contract";
import { flexusRdsManagement } from "@/lib/huawei/management/adapters/flexus-rds";
import {
  flexusRdsBackupFingerprint,
  flexusRdsPolicyFingerprint,
  getNativeFlexusRdsInstance,
  listNativeFlexusRdsBackups,
  listNativeFlexusRdsInstances,
  parseFlexusRdsResourceId,
} from "@/lib/huawei/services/flexus-rds-native";
import { session } from "./fixtures/session";

const rdsBase = "https://rds.sa-brazil-1.myhuaweicloud.com";
const instanceId = "d8e6ca5a624745bcb546a227aa3ae1cfin01";

const flexusInstance = {
  id: instanceId,
  name: "flexus-mysql-1",
  status: "ACTIVE",
  region: "sa-brazil-1",
  datastore: { type: "MySQL", version: "8.0" },
  charge_info: { charge_mode: "prePaid" },
  volume: { type: "CLOUDSSD", size: 100 },
  group_type: "flexus",
  db_user_name: "root",
  private_ips: ["192.168.0.1"],
};

const manualBackup = { id: "bp-manual-1", name: "manual-full", type: "manual", status: "COMPLETED", begin_time: "2026-01-02T10:00:00Z", size: 2803, instance_id: instanceId };
const autoBackup = { id: "bp-auto-1", name: "auto-full", type: "auto", status: "COMPLETED", begin_time: "2026-01-01T10:00:00Z", instance_id: instanceId };
const buildingBackup = { id: "bp-building-1", name: "building-full", type: "manual", status: "BUILDING", instance_id: instanceId };

const policyBody = { switch_option: true, limit_size: 4000, trigger_threshold: 10, step_percent: 20 };
const backupAck = { backup: { id: "bp-new-1", name: "manual-full-2", instance_id: instanceId, status: "BUILDING", type: "manual" } };

const resource = { id: `rds:${instanceId}`, name: "flexus-mysql-1" };

function instancesPage(rows: unknown[], total?: number) {
  return { instances: rows, total_count: total ?? rows.length };
}

function backupsPage(rows: unknown[], total?: number) {
  return { backups: rows, total_count: total ?? rows.length };
}

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
    if (response === undefined) throw new Error(`Unexpected Flexus RDS ${isWrite ? "write" : "read"} ${url}`);
    return response instanceof Response ? response : Response.json(response);
  });
  return { writes, reads };
}

function defaultHandle(url: URL, init: RequestInit): unknown {
  if (url.origin !== rdsBase) return undefined;
  if (url.pathname === "/v3/project-1/instances") return instancesPage([flexusInstance]);
  if (url.pathname === `/v3/project-1/instances/${instanceId}/action`) return { job_id: "job-1" };
  if (url.pathname === `/v3/project-1/instances/${instanceId}/password`) return {};
  if (url.pathname === `/v3/project-1/instances/${instanceId}/disk-auto-expansion`) return (init.method ?? "GET") === "PUT" ? {} : policyBody;
  if (url.pathname === "/v3/project-1/backups") return (init.method ?? "GET") === "POST" ? backupAck : backupsPage([manualBackup, autoBackup, buildingBackup]);
  if (url.pathname === "/v3/project-1/backups/bp-manual-1" && init.method === "DELETE") return {};
  if (url.pathname === "/v3/project-1/jobs") return { job: { id: "job-1", status: "Completed", instance_id: instanceId } };
  return undefined;
}

function historyEntry(overrides: Partial<ManagementHistoryEntry> = {}): ManagementHistoryEntry {
  return {
    id: "request-1",
    service: "flexus",
    projectId: session.projectId,
    operation: "Reboot instance",
    resourceId: `rds:${instanceId}`,
    startedAt: "2026-01-01T00:00:00Z",
    state: "submitted",
    jobId: "job-1",
    ...overrides,
  };
}

test("Flexus RDS inventory queries the native flexus group on the project token", async t => {
  const { reads } = mock(t);
  const instances = await listNativeFlexusRdsInstances(session);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].url, `${rdsBase}/v3/project-1/instances`);
  assert.equal(reads[0].headers["x-auth-token"], "test-token");
  const query = new URLSearchParams(reads[0].search);
  assert.equal(query.get("datastore_type"), "MySQL");
  assert.equal(query.get("group_type"), "flexus");
  assert.equal(query.get("offset"), "0");
  assert.equal(query.get("limit"), "100");
  assert.deepEqual(instances, [
    { id: instanceId, name: "flexus-mysql-1", status: "ACTIVE", statusKnown: true, region: "sa-brazil-1", engine: "MySQL", version: "8.0", projectId: "project-1", billingVerified: true, volumeGb: 100 },
  ]);
});

test("Flexus RDS inventory pages strictly on offset with a stable native total", async t => {
  const clones = Array.from({ length: 99 }, (_, index) => ({ ...flexusInstance, id: `${instanceId}-c${index}`, name: `flexus-mysql-1-${index}` }));
  let page = 0;
  const { reads } = mock(t, url => {
    if (url.pathname !== "/v3/project-1/instances") return undefined;
    page += 1;
    return page === 1 ? instancesPage([flexusInstance, ...clones], 101) : instancesPage([{ ...flexusInstance, id: `${instanceId}-last`, name: "flexus-mysql-last" }], 101);
  });
  const instances = await listNativeFlexusRdsInstances(session);
  assert.equal(instances.length, 101);
  assert.equal(page, 2);
  const offsets = reads.map((read) => new URLSearchParams(read.search).get("offset"));
  assert.deepEqual(offsets, ["0", "100"]);
  let unstablePage = 0;
  mock(t, url => {
    if (url.pathname !== "/v3/project-1/instances") return undefined;
    unstablePage += 1;
    return unstablePage === 1 ? instancesPage([flexusInstance, ...clones], 101) : instancesPage([{ ...flexusInstance, id: `${instanceId}-last` }], 102);
  });
  await assert.rejects(listNativeFlexusRdsInstances(session), /unstable/);
});

test("Flexus RDS inventory fails closed on missing arrays, totals, dupes, and malformed pages", async t => {
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? { total_count: 1 } : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /no Flexus RDS instances array/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? { instances: [flexusInstance] } : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /total_count/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? { instances: [flexusInstance], total_count: "1" } : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /total_count/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([flexusInstance], 1.5) : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /total_count/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([flexusInstance, flexusInstance], 2) : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /duplicate Flexus RDS instance identity/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([flexusInstance], 101) : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /truncated/);
  const clones = Array.from({ length: 99 }, (_, index) => ({ ...flexusInstance, id: `${instanceId}-c${index}` }));
  let emptyPage = 0;
  mock(t, url => {
    if (url.pathname !== "/v3/project-1/instances") return undefined;
    emptyPage += 1;
    return emptyPage === 1 ? instancesPage([flexusInstance, ...clones], 101) : instancesPage([], 101);
  });
  await assert.rejects(listNativeFlexusRdsInstances(session), /incomplete/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([flexusInstance, ...clones], 50) : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /incomplete/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([...clones, flexusInstance, flexusInstance], 102) : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /oversized/);
});

test("Flexus RDS inventory rejects rows outside the verified native shape", async t => {
  const rejectRow = async (row: unknown, pattern: RegExp) => {
    mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([row]) : undefined));
    await assert.rejects(listNativeFlexusRdsInstances(session), pattern);
  };
  await rejectRow({ ...flexusInstance, region: "eu-west-101" }, /outside the selected region/);
  const { region: omittedRegion, ...withoutRegion } = flexusInstance;
  void omittedRegion;
  await rejectRow(withoutRegion, /outside the selected region/);
  await rejectRow({ ...flexusInstance, datastore: { type: "PostgreSQL", version: "12" } }, /MySQL engine and version/);
  await rejectRow({ ...flexusInstance, datastore: { type: "MySQL" } }, /MySQL engine and version/);
  await rejectRow({ ...flexusInstance, id: 123 }, /identity, name, or status/);
  const { status: omittedStatus, ...withoutStatus } = flexusInstance;
  void omittedStatus;
  await rejectRow(withoutStatus, /identity, name, or status/);
  await rejectRow({ ...flexusInstance, group_type: "ECS" }, /flexus group/);
  await rejectRow({ ...flexusInstance, is_flexus: false }, /flexus group/);
  await rejectRow({ ...flexusInstance, project_id: "project-other" }, /exactly selected project/);
  await rejectRow({ ...flexusInstance, project_id: null }, /exactly selected project/);
  await rejectRow({ ...flexusInstance, charge_info: { charge_mode: "postPaid" } }, /charging mode/);
  await rejectRow({ ...flexusInstance, volume: { type: "CLOUDSSD", size: "100" } }, /native storage size/);
});

test("Unknown native instance statuses project a static Unknown and never surface raw values", async t => {
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([{ ...flexusInstance, status: "WEIRD_RDS_STATE" }]) : undefined));
  const inventory = await flexusRdsManagement.inventory(session);
  assert.equal(inventory[0].status, "Unknown");
  assert.ok(!JSON.stringify(inventory).includes("WEIRD_RDS_STATE"));
  let failure: unknown;
  try {
    await flexusRdsManagement.execute(session, "reboot-rds", {}, resource);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /not a verified native state/);
  assert.ok(!failure.message.includes("WEIRD_RDS_STATE"));
});

test("The exact identity read filters by the original id without fuzzy matching", async t => {
  const { reads } = mock(t);
  const instance = await getNativeFlexusRdsInstance(session, instanceId);
  assert.equal(instance.id, instanceId);
  const query = new URLSearchParams(reads[0].search);
  assert.equal(query.get("id"), instanceId);
  assert.ok(!query.get("id")!.includes("*"));
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([{ ...flexusInstance, id: "other-instance-in01" }]) : undefined));
  await assert.rejects(getNativeFlexusRdsInstance(session, instanceId), /different instance than the exact native identity/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([]) : undefined));
  await assert.rejects(getNativeFlexusRdsInstance(session, instanceId), /no longer in the selected project/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([flexusInstance, flexusInstance], 2) : undefined));
  await assert.rejects(getNativeFlexusRdsInstance(session, instanceId), /duplicate/);
});

test("Adapter inventory projects the public rds identity with typed engine and billing", async t => {
  mock(t);
  const inventory = await flexusRdsManagement.inventory(session);
  assert.deepEqual(inventory, [{ id: `rds:${instanceId}`, name: "flexus-mysql-1", status: "ACTIVE", values: { engine: "MySQL", version: "8.0", chargeMode: "prePaid" } }]);
  const { charge_info: omittedBilling, ...withoutBilling } = flexusInstance;
  void omittedBilling;
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([withoutBilling]) : undefined));
  const unverified = await flexusRdsManagement.inventory(session);
  assert.equal(unverified[0].values?.chargeMode, "unverified");
});

test("The adapter is project-scoped, exposes only rds resources, and never creates or deletes instances", () => {
  assert.equal(flexusRdsManagement.accountWide, undefined);
  assert.deepEqual(flexusRdsManagement.operations.map((operation) => operation.id), [
    "inspect-rds",
    "reboot-rds",
    "reset-rds-password",
    "rds-backups",
    "create-rds-backup",
    "delete-rds-backup",
    "rds-storage-policy",
    "update-rds-storage-policy",
  ]);
  for (const operation of flexusRdsManagement.operations) {
    assert.deepEqual(operation.resourcePrefixes, ["rds:"], `${operation.id} must be scoped to rds resources`);
    assert.ok(!["create", "delete"].includes(operation.kind), `${operation.id} must not create or delete instances`);
  }
  assert.ok(!flexusRdsManagement.operations.some((operation) => ["create-rds", "delete-rds", "upgrade-rds-minor-version"].includes(operation.id)));
});

test("Inspect shows typed native facts only", async t => {
  mock(t);
  const outcome = await flexusRdsManagement.execute(session, "inspect-rds", {}, resource);
  const facts = Object.fromEntries(outcome.facts!.map((fact) => [fact.label, fact.value]));
  assert.deepEqual(facts, {
    "Instance ID": instanceId,
    "Native name": "flexus-mysql-1",
    "Status": "ACTIVE",
    "Engine": "MySQL 8.0",
    "Region": "sa-brazil-1",
    "Charge mode": "prePaid",
    "Storage": "100 GB",
  });
  assert.ok(!JSON.stringify(outcome).includes("192.168.0.1"));
  assert.ok(!JSON.stringify(outcome).includes("root"));
});

test("Mutations require the fresh native name and the verified ACTIVE prepaid state", async t => {
  const { writes } = mock(t);
  await assert.rejects(flexusRdsManagement.execute(session, "reboot-rds", {}, { id: resource.id, name: "stale-name" }), /not fresh/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([{ ...flexusInstance, status: "REBOOTING" }]) : undefined));
  await assert.rejects(flexusRdsManagement.execute(session, "reboot-rds", {}, resource), /status is REBOOTING/);
  const { charge_info: omittedBilling, ...withoutBilling } = flexusInstance;
  void omittedBilling;
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([withoutBilling]) : undefined));
  await assert.rejects(flexusRdsManagement.execute(session, "reboot-rds", {}, resource), /billing state is unverified/);
  assert.equal(writes.length, 0);
});

test("Reboot submits the native restart action and keeps the original job", async t => {
  const { writes } = mock(t);
  const outcome = await flexusRdsManagement.execute(session, "reboot-rds", {}, resource);
  assert.equal(writes[0].url, `${rdsBase}/v3/project-1/instances/${instanceId}/action`);
  assert.equal(writes[0].method, "POST");
  assert.deepEqual(writes[0].body, { restart: {} });
  assert.deepEqual({ jobId: outcome.jobId, asynchronous: outcome.asynchronous, resourceId: outcome.resourceId }, {
    jobId: "job-1",
    asynchronous: true,
    resourceId: `rds:${instanceId}`,
  });
  mock(t, (url, init) => (init.method === "POST" && url.pathname.endsWith("/action") ? {} : undefined));
  await assert.rejects(flexusRdsManagement.execute(session, "reboot-rds", {}, resource), /no verifiable job/);
  mock(t, (url, init) => (init.method === "POST" && url.pathname.endsWith("/action") ? { job_id: "job-1", instance_id: "other-instance" } : undefined));
  await assert.rejects(flexusRdsManagement.execute(session, "reboot-rds", {}, resource), /different Flexus RDS instance/);
});

test("Reset root password enforces the native rules and never echoes the secret", async t => {
  const { writes } = mock(t);
  for (const password of ["short1!", "alllowercase1", "NewPassw0rd;", "NewPassw0rd!NewPassw0rd!NewPassw0rd!123"]) {
    await assert.rejects(flexusRdsManagement.execute(session, "reset-rds-password", { password }, resource), /password/i);
  }
  assert.equal(writes.length, 0);
  const outcome = await flexusRdsManagement.execute(session, "reset-rds-password", { password: "NewPassw0rd!" }, resource);
  assert.equal(writes[0].url, `${rdsBase}/v3/project-1/instances/${instanceId}/password`);
  assert.equal(writes[0].method, "POST");
  assert.deepEqual(writes[0].body, { db_user_pwd: "NewPassw0rd!" });
  assert.equal(outcome.asynchronous, true);
  assert.equal(outcome.jobId, undefined);
  assert.ok(!("jobId" in outcome));
  assert.match(outcome.message, /pending manual verification/);
  assert.ok(!JSON.stringify(outcome).includes("NewPassw0rd!"));
});

test("Reset root password keeps only a typed optional native job echo", async t => {
  mock(t, (url, init) => (init.method === "POST" && url.pathname.endsWith("/password") ? { job_id: "job-9" } : undefined));
  const withJob = await flexusRdsManagement.execute(session, "reset-rds-password", { password: "NewPassw0rd!" }, resource);
  assert.equal(withJob.jobId, "job-9");
  assert.equal(withJob.asynchronous, true);
  for (const jobEcho of [null, 42, "", "x".repeat(65)]) {
    mock(t, (url, init) => (init.method === "POST" && url.pathname.endsWith("/password") ? { job_id: jobEcho } : undefined));
    const outcome = await flexusRdsManagement.execute(session, "reset-rds-password", { password: "NewPassw0rd!" }, resource);
    assert.equal(outcome.jobId, undefined, `job echo ${String(jobEcho)} must not become a job`);
    assert.match(outcome.message, /pending manual verification/);
  }
});

test("The backup list is strict about parents, identities, and statuses", async t => {
  const { reads } = mock(t);
  const outcome = await flexusRdsManagement.execute(session, "rds-backups", {}, resource);
  const query = new URLSearchParams(reads[1].search);
  assert.equal(reads[1].url, `${rdsBase}/v3/project-1/backups`);
  assert.equal(query.get("instance_id"), instanceId);
  assert.equal(query.get("offset"), "0");
  assert.equal(query.get("limit"), "100");
  assert.equal(outcome.message, "3 backups loaded.");
  assert.ok(outcome.facts!.some((fact) => fact.label === "manual-full · manual · COMPLETED"));
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([{ ...manualBackup, instance_id: "other-instance" }]) : undefined));
  await assert.rejects(listNativeFlexusRdsBackups(session, instanceId), /outside the requested instance/);
  const { instance_id: omittedParent, ...withoutParent } = manualBackup;
  void omittedParent;
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([withoutParent]) : undefined));
  await assert.rejects(listNativeFlexusRdsBackups(session, instanceId), /outside the requested instance/);
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([manualBackup, manualBackup], 2) : undefined));
  await assert.rejects(listNativeFlexusRdsBackups(session, instanceId), /duplicate Flexus RDS backup identity/);
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([{ ...manualBackup, status: "WEIRD_BACKUP" }]) : undefined));
  const weird = await flexusRdsManagement.execute(session, "rds-backups", {}, resource);
  assert.ok(weird.facts!.some((fact) => fact.label.startsWith("manual-full · manual · Unknown")));
  assert.ok(!JSON.stringify(weird).includes("WEIRD_BACKUP"));
});

test("Manual backup creation validates the documented name and description rules", async t => {
  const operation = flexusRdsManagement.operations.find((item) => item.id === "create-rds-backup")!;
  assert.throws(() => validateManagementValues(operation, { name: "1abc" }), /invalid format/);
  assert.throws(() => validateManagementValues(operation, { name: "abc" }), /invalid format/);
  assert.throws(() => validateManagementValues(operation, {}), /Backup name is required/);
  const { writes } = mock(t);
  await assert.rejects(
    flexusRdsManagement.execute(session, "create-rds-backup", { name: "manual-full-2", description: "bad > chars" }, resource),
    /description cannot contain/,
  );
  assert.equal(writes.length, 0);
});

test("Manual backup creation requires a verifiable typed acknowledgement", async t => {
  const { writes } = mock(t);
  const outcome = await flexusRdsManagement.execute(session, "create-rds-backup", { name: "manual-full-2" }, resource);
  assert.equal(writes[0].url, `${rdsBase}/v3/project-1/backups`);
  assert.equal(writes[0].method, "POST");
  assert.deepEqual(writes[0].body, { instance_id: instanceId, name: "manual-full-2" });
  assert.deepEqual({ resourceId: outcome.resourceId, observationId: outcome.observationId, asynchronous: outcome.asynchronous }, {
    resourceId: `rds:${instanceId}`,
    observationId: "bp-new-1",
    asynchronous: true,
  });
  assert.deepEqual(outcome.verification, flexusRdsBackupFingerprint("bp-new-1"));
  const withDescription = await flexusRdsManagement.execute(session, "create-rds-backup", { name: "manual-full-2", description: "manual backup" }, resource);
  assert.deepEqual(writes[1].body, { instance_id: instanceId, name: "manual-full-2", description: "manual backup" });
  assert.equal(withDescription.observationId, "bp-new-1");
  for (const ack of [
    {},
    { backup: { id: "bp-new-1", instance_id: "other-instance", name: "manual-full-2", status: "BUILDING" } },
    { backup: { id: "bp-new-1", instance_id: instanceId, name: "other-name", status: "BUILDING" } },
    { backup: { id: "bp-new-1", instance_id: instanceId, name: "manual-full-2", status: "WEIRD" } },
    { backup: { id: "bp-new-1", instance_id: instanceId, name: "manual-full-2", status: "BUILDING", type: "auto" } },
  ]) {
    mock(t, (url, init) => (init.method === "POST" && url.pathname === "/v3/project-1/backups" ? ack : undefined));
    await assert.rejects(
      flexusRdsManagement.execute(session, "create-rds-backup", { name: "manual-full-2" }, resource),
      /unverifiable manual backup acknowledgement/,
    );
  }
});

test("The manual backup observer confirms only the original backup identity", async t => {
  const entry = historyEntry({ operation: "Create manual backup", observationId: "bp-new-1", verification: flexusRdsBackupFingerprint("bp-new-1") });
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([{ ...manualBackup, id: "bp-new-1", name: "manual-full-2", status: "COMPLETED" }]) : undefined));
  assert.equal((await flexusRdsManagement.poll!(session, entry)).state, "succeeded");
  mock(t);
  assert.deepEqual(await flexusRdsManagement.poll!(session, historyEntry({ operation: "Create manual backup", observationId: "bp-building-1", verification: flexusRdsBackupFingerprint("bp-building-1") })), {
    state: "submitted",
    message: "The manual backup is still building.",
    observedTask: "BUILDING",
  });
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([{ ...manualBackup, id: "bp-new-1", status: "FAILED" }]) : undefined));
  assert.equal((await flexusRdsManagement.poll!(session, entry)).state, "failed");
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([{ ...manualBackup, id: "bp-new-1", status: "DELETING" }]) : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /unverified state/);
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([]) : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /no longer observable/);
  mock(t);
  await assert.rejects(
    flexusRdsManagement.poll!(session, historyEntry({ operation: "Create manual backup", observationId: "bp-new-1", verification: undefined })),
    /no verifiable original backup observation/,
  );
  await assert.rejects(flexusRdsManagement.poll!(session, historyEntry({ operation: "Delete instance" })), /not a polled Flexus RDS operation/);
});

test("Delete manual backup eligibility and the separate typed backup confirmation", async t => {
  mock(t);
  const choices = await flexusRdsManagement.options!(session, "delete-rds-backup", resource);
  assert.deepEqual(choices.backups?.map((choice) => choice.value), ["bp-manual-1"]);
  const { writes } = mock(t);
  await assert.rejects(flexusRdsManagement.execute(session, "delete-rds-backup", { backup: "bp-auto-1", backupName: "auto-full" }, resource), /Only manual backups/);
  await assert.rejects(flexusRdsManagement.execute(session, "delete-rds-backup", { backup: "bp-building-1", backupName: "building-full" }, resource), /Only completed backups/);
  await assert.rejects(flexusRdsManagement.execute(session, "delete-rds-backup", { backup: "bp-manual-1", backupName: "wrong-name" }, resource), /does not match/);
  await assert.rejects(flexusRdsManagement.execute(session, "delete-rds-backup", { backup: "bp-missing-1", backupName: "manual-full" }, resource), /Select a manual backup/);
  assert.equal(writes.length, 0);
});

test("Delete manual backup verifies the fresh readback before reporting deletion", async t => {
  let deleted = false;
  const { writes } = mock(t, (url, init) => {
    if (url.pathname === "/v3/project-1/backups" && (init.method ?? "GET") === "GET") {
      return deleted ? backupsPage([autoBackup, buildingBackup]) : backupsPage([manualBackup, autoBackup, buildingBackup]);
    }
    if (url.pathname === "/v3/project-1/backups/bp-manual-1" && init.method === "DELETE") {
      deleted = true;
      return {};
    }
    return undefined;
  });
  const verified = await flexusRdsManagement.execute(session, "delete-rds-backup", { backup: "bp-manual-1", backupName: "manual-full" }, resource);
  assert.equal(writes[0].method, "DELETE");
  assert.equal(writes[0].url, `${rdsBase}/v3/project-1/backups/bp-manual-1`);
  assert.equal(verified.asynchronous, undefined);
  assert.match(verified.message, /verified gone/);
  mock(t);
  const pending = await flexusRdsManagement.execute(session, "delete-rds-backup", { backup: "bp-manual-1", backupName: "manual-full" }, resource);
  assert.equal(pending.asynchronous, true);
  assert.equal(pending.observationId, "bp-manual-1");
  assert.deepEqual(pending.verification, flexusRdsBackupFingerprint("bp-manual-1"));
  assert.match(pending.message, /stays pending/);
});

test("The deletion observer confirms only when the original backup is gone", async t => {
  const entry = historyEntry({ operation: "Delete manual backup", observationId: "bp-manual-1", verification: flexusRdsBackupFingerprint("bp-manual-1") });
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([autoBackup, buildingBackup]) : undefined));
  assert.deepEqual(await flexusRdsManagement.poll!(session, entry), { state: "succeeded", message: "The manual backup was deleted.", resourceId: `rds:${instanceId}` });
  mock(t, url => (url.pathname === "/v3/project-1/backups" ? backupsPage([{ ...manualBackup, status: "DELETING" }]) : undefined));
  assert.deepEqual(await flexusRdsManagement.poll!(session, entry), {
    state: "submitted",
    message: "The manual backup is still being deleted.",
    observedTask: "DELETING",
  });
  mock(t);
  const pending = await flexusRdsManagement.poll!(session, entry);
  assert.equal(pending.state, "submitted");
  assert.match(pending.message ?? "", /not visible on the fresh backup list/);
});

test("The storage policy read validates the documented boolean and ranges", async t => {
  mock(t);
  const outcome = await flexusRdsManagement.execute(session, "rds-storage-policy", {}, resource);
  const facts = Object.fromEntries(outcome.facts!.map((fact) => [fact.label, fact.value]));
  assert.deepEqual(facts, { Autoscaling: "enabled", "Upper limit": "4000 GB", "Trigger threshold": "10 GB or 10%", Increment: "20%" });
  const { switch_option: omittedSwitch, ...withoutSwitch } = policyBody;
  void omittedSwitch;
  mock(t, url => (url.pathname.endsWith("/disk-auto-expansion") ? withoutSwitch : undefined));
  await assert.rejects(flexusRdsManagement.execute(session, "rds-storage-policy", {}, resource), /verified switch/);
  mock(t, url => (url.pathname.endsWith("/disk-auto-expansion") ? { ...policyBody, switch_option: "true" } : undefined));
  await assert.rejects(flexusRdsManagement.execute(session, "rds-storage-policy", {}, resource), /verified switch/);
  for (const [key, value] of [["limit_size", 4001], ["trigger_threshold", 12], ["step_percent", 51]] as const) {
    mock(t, url => (url.pathname.endsWith("/disk-auto-expansion") ? { ...policyBody, [key]: value } : undefined));
    await assert.rejects(flexusRdsManagement.execute(session, "rds-storage-policy", {}, resource), /unverified dimension/);
  }
});

test("The storage policy update validates the enabling requirements against current storage", async t => {
  const { writes } = mock(t);
  await assert.rejects(flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: true, trigger_threshold: "10" }, resource), /upper limit/);
  await assert.rejects(flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: true, limit_size: 4000 }, resource), /trigger threshold/);
  await assert.rejects(flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: true, limit_size: 90, trigger_threshold: "10" }, resource), /no less than the current 100 GB/);
  await assert.rejects(flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: true, limit_size: 4000, trigger_threshold: "12" }, resource), /trigger threshold/);
  await assert.rejects(
    flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: true, limit_size: 4000, trigger_threshold: "10", step_percent: 51 }, resource),
    /increment must be 5-50%/,
  );
  const { volume: omittedVolume, ...withoutVolume } = flexusInstance;
  void omittedVolume;
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? instancesPage([withoutVolume]) : undefined));
  await assert.rejects(
    flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: true, limit_size: 4000, trigger_threshold: "10" }, resource),
    /current storage could not be verified/,
  );
  assert.equal(writes.length, 0);
});

test("The storage policy update sends typed dimensions and verifies the fresh readback", async t => {
  const { writes } = mock(t);
  const outcome = await flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: true, limit_size: 4000, trigger_threshold: "10" }, resource);
  assert.equal(writes[0].method, "PUT");
  assert.equal(writes[0].url, `${rdsBase}/v3/project-1/instances/${instanceId}/disk-auto-expansion`);
  assert.deepEqual(writes[0].body, { switch_option: true, limit_size: 4000, trigger_threshold: 10 });
  assert.equal(outcome.asynchronous, undefined);
  assert.deepEqual(outcome.verification, flexusRdsPolicyFingerprint({ switch_option: true, limit_size: 4000, trigger_threshold: 10 }));
  assert.match(outcome.message, /verified on the fresh policy/);
  mock(t, url => (url.pathname.endsWith("/disk-auto-expansion") ? { ...policyBody, limit_size: 2000 } : undefined));
  const pending = await flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: true, limit_size: 4000, trigger_threshold: "10" }, resource);
  assert.equal(pending.asynchronous, true);
  assert.equal(pending.observationId, instanceId);
  assert.match(pending.message, /stays pending/);
  const { writes: disableWrites } = mock(t, (url, init) => ((init.method ?? "GET") === "GET" && url.pathname.endsWith("/disk-auto-expansion") ? { switch_option: false } : undefined));
  const disabled = await flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: false }, resource);
  assert.deepEqual(disableWrites[0].body, { switch_option: false });
  assert.equal(disabled.asynchronous, undefined);
  assert.deepEqual(disabled.verification, flexusRdsPolicyFingerprint({ switch_option: false }));
});

test("The policy observer confirms only on the matching fresh fingerprint", async t => {
  const verification = flexusRdsPolicyFingerprint({ switch_option: true, limit_size: 4000, trigger_threshold: 10 });
  const entry = historyEntry({ operation: "Configure storage autoscaling policy", observationId: instanceId, verification });
  mock(t);
  assert.deepEqual(await flexusRdsManagement.poll!(session, entry), {
    state: "succeeded",
    message: "The storage autoscaling policy now matches the requested change.",
    resourceId: `rds:${instanceId}`,
  });
  mock(t, url => (url.pathname.endsWith("/disk-auto-expansion") ? { ...policyBody, limit_size: 2000 } : undefined));
  const pending = await flexusRdsManagement.poll!(session, entry);
  assert.equal(pending.state, "submitted");
  assert.match(pending.message ?? "", /not visible on the fresh policy/);
  await assert.rejects(
    flexusRdsManagement.poll!(session, historyEntry({ operation: "Configure storage autoscaling policy", observationId: "other-job", verification })),
    /not a pending Flexus RDS policy observation/,
  );
  await assert.rejects(
    flexusRdsManagement.poll!(session, historyEntry({ operation: "Configure storage autoscaling policy", observationId: instanceId, verification: { fields: ["bogus"], digest: "x" } })),
    /no verifiable policy fingerprint/,
  );
});

test("Job polls verify every provided echo exactly, including null", async t => {
  const entry = historyEntry();
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-other", status: "Completed", instance_id: instanceId } } : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /different job/);
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: null, status: "Completed", instance_id: instanceId } } : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /different job/);
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "Completed", instance_id: "other-instance" } } : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /different instance/);
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "Completed", instance_id: null } } : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /different instance/);
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "Completed" }, project_id: "project-other" } : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /exactly selected project/);
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "Completed" }, project_id: null } : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /exactly selected project/);
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "Completed", entities: { resource_ids: ["other-instance"] } } } : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /different instance/);
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "Completed", entities: { resource_ids: [] } } } : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /different instance/);
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "Completed", entities: { resource_ids: [instanceId] } } } : undefined));
  assert.equal((await flexusRdsManagement.poll!(session, entry)).state, "succeeded");
});

test("Job polls map whitelisted native statuses and never surface raw failure text", async t => {
  const entry = historyEntry();
  const { reads } = mock(t);
  assert.deepEqual(await flexusRdsManagement.poll!(session, entry), {
    state: "succeeded",
    message: "The Flexus RDS cloud job completed successfully.",
    resourceId: `rds:${instanceId}`,
  });
  assert.equal(new URLSearchParams(reads[0].search).get("id"), "job-1");
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "Failed", fail_reason: "raw-disk-failure-secret", instance_id: instanceId } } : undefined));
  const failed = await flexusRdsManagement.poll!(session, entry);
  assert.equal(failed.state, "failed");
  assert.ok(!JSON.stringify(failed).includes("raw-disk-failure-secret"));
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "Running", instance_id: instanceId } } : undefined));
  assert.deepEqual(await flexusRdsManagement.poll!(session, entry), {
    state: "submitted",
    message: "The Flexus RDS cloud job is running.",
    observedTask: "Running",
  });
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", status: "WEIRD_JOB_STATE", instance_id: instanceId } } : undefined));
  let failure: unknown;
  try {
    await flexusRdsManagement.poll!(session, entry);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /unverified Flexus RDS job status/);
  assert.ok(!failure.message.includes("WEIRD_JOB_STATE"));
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? { job: { id: "job-1", instance_id: instanceId } } : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /without a verified status/);
  mock(t, url => (url.pathname === "/v3/project-1/jobs" ? {} : undefined));
  await assert.rejects(flexusRdsManagement.poll!(session, entry), /no verified job object/);
});

test("Job polls stay in the original project and operation scope", async t => {
  mock(t);
  await assert.rejects(flexusRdsManagement.poll!(session, historyEntry({ projectId: "project-other" })), /different project/);
  await assert.rejects(flexusRdsManagement.poll!(session, historyEntry({ resourceId: "x:server-x-1" })), /original native identity/);
  await assert.rejects(flexusRdsManagement.poll!(session, historyEntry({ operation: "Delete instance" })), /not a polled Flexus RDS operation/);
  await assert.rejects(flexusRdsManagement.poll!(session, historyEntry({ jobId: undefined })), /no native job/);
  const manual = await flexusRdsManagement.poll!(session, historyEntry({ operation: "Reset root password", jobId: undefined }));
  assert.equal(manual.state, "submitted");
  assert.match(manual.message ?? "", /pending manual verification/);
});

test("Business failures inside native bodies are rejected even when null", async t => {
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? { ...instancesPage([flexusInstance]), error_msg: null } : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /response body/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? { ...instancesPage([flexusInstance]), error_code: null } : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /response body/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? { ...instancesPage([flexusInstance]), error: null } : undefined));
  await assert.rejects(listNativeFlexusRdsInstances(session), /response body/);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? { ...instancesPage([flexusInstance]), error_code: 0 } : undefined));
  assert.equal((await listNativeFlexusRdsInstances(session)).length, 1);
  mock(t, url => (url.pathname === "/v3/project-1/instances" ? { ...instancesPage([flexusInstance]), error_code: "0" } : undefined));
  assert.equal((await listNativeFlexusRdsInstances(session)).length, 1);
  mock(t, (url, init) => (init.method === "POST" && url.pathname.endsWith("/action") ? { job_id: "job-1", error_code: "DBS.280001" } : undefined));
  await assert.rejects(flexusRdsManagement.execute(session, "reboot-rds", {}, resource), /business failure/);
});

test("The console never couples Flexus RDS to account, RMS, or ECS planes", async t => {
  const { writes, reads } = mock(t);
  await flexusRdsManagement.inventory(session);
  await flexusRdsManagement.execute(session, "inspect-rds", {}, resource);
  await flexusRdsManagement.execute(session, "reboot-rds", {}, resource);
  for (const capture of [...reads, ...writes]) {
    assert.ok(capture.url.startsWith(rdsBase), `unexpected plane ${capture.url}`);
  }
  assert.ok(reads.every((read) => !read.url.includes("iam.example.invalid")));
  assert.equal(parseFlexusRdsResourceId(`rds:${instanceId}`), instanceId);
  assert.throws(() => parseFlexusRdsResourceId("l:bundle-1:server-1"), /original native identity/);
  assert.throws(() => parseFlexusRdsResourceId(undefined), /Select a Flexus RDS instance/);
});

test("native documented job instance identities cannot disagree with optional aliases", async t => {
  for (const instance of [{ id: "foreign" }, { id: null }, null, { id: instanceId, project_id: "foreign" }]) {
    mock(t, url => url.pathname.endsWith("/jobs") ? { job: { id: "job-1", status: "Completed", instance, instance_id: instanceId } } : undefined);
    await assert.rejects(flexusRdsManagement.poll!(session, historyEntry()), /different instance|selected project/);
    t.mock.restoreAll();
  }
  mock(t, url => url.pathname.endsWith("/jobs") ? { job: { id: "job-1", status: "Completed", instance: { id: instanceId } } } : undefined);
  assert.equal((await flexusRdsManagement.poll!(session, historyEntry())).state, "succeeded");
  t.mock.restoreAll();
  mock(t, url => url.pathname.endsWith("/jobs") ? { job: { status: "Completed", instance: { id: instanceId } } } : undefined);
  await assert.rejects(flexusRdsManagement.poll!(session, historyEntry()), /different job/);
});

test("every provided backup project and acknowledgement identity is checked independently", async t => {
  mock(t, url => url.pathname.endsWith("/backups") ? backupsPage([{ ...manualBackup, project_id: "foreign" }]) : undefined);
  await assert.rejects(listNativeFlexusRdsBackups(session, instanceId), /selected project/);
  t.mock.restoreAll();
  mock(t, (url, init) => url.pathname.endsWith("/backups") && init.method === "POST" ? { backup: { ...backupAck.backup, tenant_id: null } } : undefined);
  await assert.rejects(flexusRdsManagement.execute(session, "create-rds-backup", { name: "manual-full-2" }, resource), /selected project/);
  t.mock.restoreAll();
  mock(t, (url, init) => init.method === "DELETE" ? { id: manualBackup.id, backup_id: "foreign" } : undefined);
  await assert.rejects(flexusRdsManagement.execute(session, "delete-rds-backup", { backup: manualBackup.id, backupName: manualBackup.name }, resource), /different Flexus RDS backup/);
});

test("failed post-acceptance readback preserves backup and policy receipts without invented jobs", async t => {
  let accepted = false;
  mock(t, (url, init) => {
    if (init.method === "DELETE") { accepted = true; return {}; }
    if (accepted && url.pathname.endsWith("/backups")) return new Response("PRIVATE-READBACK", { status: 500 });
    return undefined;
  });
  const deletion = await flexusRdsManagement.execute(session, "delete-rds-backup", { backup: manualBackup.id, backupName: manualBackup.name }, resource);
  assert.equal(deletion.asynchronous, true);
  assert.equal(deletion.observationId, manualBackup.id);
  assert.equal(deletion.jobId, undefined);
  assert.ok(!deletion.message.includes("PRIVATE"));
  t.mock.restoreAll();
  accepted = false;
  mock(t, (url, init) => {
    if (init.method === "PUT") { accepted = true; return {}; }
    if (accepted && url.pathname.endsWith("/disk-auto-expansion")) return new Response("PRIVATE-POLICY", { status: 403 });
    return undefined;
  });
  const policy = await flexusRdsManagement.execute(session, "update-rds-storage-policy", { switch_option: false }, resource);
  assert.equal(policy.asynchronous, true);
  assert.equal(policy.observationId, instanceId);
  assert.equal(policy.jobId, undefined);
  assert.ok(policy.verification);
  assert.ok(!policy.message.includes("PRIVATE"));
});

test("composed Flexus management keeps RDS usable when both server permission planes fail", async t => {
  const { getManagementContext, runManagementOperation } = await import("@/lib/huawei/management");
  const { listManagementHistory } = await import("@/lib/huawei/management/history");
  const { randomUUID } = await import("node:crypto");
  const identity = { ...session, userId: `flexus-rds-${randomUUID()}` };
  const { writes } = mock(t, (url, init) => {
    if (url.origin !== rdsBase) return new Response("PRIVATE-SERVER-DENIAL", { status: 403 });
    return defaultHandle(url, init);
  });
  const context = await getManagementContext(identity, "flexus", session.projectId, "reboot-rds", resource.id);
  assert.deepEqual(context.resources.map(item => item.id), [resource.id]);
  assert.ok(context.warnings?.some(warning => warning.includes("Flexus L")));
  assert.ok(context.warnings?.some(warning => warning.includes("Flexus X")));
  const requestId = randomUUID();
  const input = { requestId, operation: "reboot-rds", projectId: session.projectId, resourceId: resource.id, confirmName: resource.name, acknowledgedImpact: true, values: {} };
  const outcome = await runManagementOperation(identity, "flexus", input);
  assert.equal(outcome.jobId, "job-1");
  assert.equal(outcome.asynchronous, true);
  assert.equal(writes.filter(write => write.method === "POST").length, 1);
  assert.equal((await runManagementOperation(identity, "flexus", input)).replayed, true);
  assert.equal(writes.filter(write => write.method === "POST").length, 1);
  const saved = (await listManagementHistory(identity, "flexus")).find(entry => entry.id === requestId)!;
  assert.equal(saved.projectId, session.projectId);
  assert.equal(saved.resourceId, resource.id);
  assert.equal(saved.jobId, "job-1");
});
