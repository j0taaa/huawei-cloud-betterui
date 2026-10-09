import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { HuaweiApiError, huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listCdmClustersForProject } from "@/lib/huawei/services/cdm";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

/**
 * CDM management adapter over the official huaweicloudsdkcdm v1.1 routes.
 *
 * Explicit SDK gaps kept visible instead of invented:
 * - No cluster rename or description route exists; the modify route only manages the native
 *   auto-off, scheduled startup/shutdown, and job failure notification settings.
 * - No connection listing route exists; connections are addressed by exact name only, and the
 *   jobs that reference a connection are the only native membership signal.
 * - No link or job creation/update is offered: the SDK exposes generic config containers but no
 *   per-connector input schema, so no verified structured fields could be built without
 *   inventing connector configuration.
 * - No cluster task-status route exists; asynchronous cluster operations are polled through the
 *   native cluster status codes (100 creating, 200 normal, 300/303 failed, 500 restarting,
 *   800 frozen, 900 stopped, 910 stopping, 920 starting).
 * - No quota route and no billing-mode field exist; clusters created through the public API are
 *   pay-per-use and deletion cannot verify prepaid console subscriptions.
 * - Job execution history returns one native page and its request model exposes no paging
 *   parameters, so only the returned page is shown.
 */

const active = ["200"];
const stopped = ["900"];
const stable = ["200", "300", "303", "900"];
const deletable = ["200", "300", "303", "900"];
const jobTypes = ["NORMAL_JOB", "BATCH_JOB", "SCENARIO_JOB"];
const runningJobStatuses = ["RUNNING", "BOOTING", "PENDING"];
const idleJobStatuses = ["NEW", "NEVER_EXECUTED", "SUCCEEDED", "FAILED", "FAILURE_ON_SUBMIT", "STOPPED"];
const statusNames: Record<string, string> = { "100": "creating", "200": "running", "300": "failed", "303": "failed to create", "500": "restarting", "800": "frozen", "900": "stopped", "910": "stopping", "920": "starting" };
const schedulePattern = "^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$";

const clusterName: ManagementField = { key: "name", label: "Cluster name", required: true, min: 1, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$", help: "1-64 characters starting with a letter; letters, digits, hyphens, and underscores." };
const jobField: ManagementField = { key: "job", label: "Migration job", type: "select", source: "jobs", required: true };
const linkNameField: ManagementField = { key: "linkName", label: "Connection name", required: true, min: 1, max: 128, pattern: "^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", help: "The exact connection name. The CDM API exposes no connection listing, so the name must match exactly." };

type DatastoreRow = { id: string; versions: string[] };
type FlavorRow = { datastoreId: string; versionName: string; versionId: string; name: string; strId: string; cpu: number; ram: number };

function parseSelection(value: unknown) {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { return []; }
  return Array.isArray(parsed) ? parsed : [];
}

function epoch(value: unknown) {
  const time = Number(value);
  const date = new Date(time);
  return Number.isFinite(time) && time > 0 && Number.isFinite(date.getTime()) ? date.toISOString() : "-";
}

function identifier(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function clusterRecord(session: BetterUiSession, id: string) {
  let body: Record<string, unknown>;
  try {
    body = await huaweiFetch<Record<string, unknown>>(session, "cdm", `/v1.1/${session.projectId}/clusters/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof HuaweiApiError && error.status === 404) throw new ManagementInputError("The CDM cluster was not found in this project.", 404);
    throw error;
  }
  const record = asRecord(body);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("Huawei returned a different or unverified CDM cluster identity.", 409);
  return record;
}

async function datastoreRows(session: BetterUiSession): Promise<DatastoreRow[]> {
  const body = await huaweiFetch<unknown>(session, "cdm", `/v1.1/${session.projectId}/datastores`);
  const rows = Array.isArray(body) ? body : asRecord(body).datastores;
  if (!Array.isArray(rows)) throw new Error("Huawei returned no verifiable CDM version catalog.");
  return rows.map(asRecord).flatMap((datastore) => {
    const id = firstString([datastore.id], "");
    if (!id || datastore.name !== "cdm") return [];
    return [{ id, versions: asArray(datastore.versions).map(asRecord).flatMap((version) => {
      const name = firstString([version.name], "");
      return name && String(version.active) === "1" ? [name] : [];
    }) }];
  });
}

async function flavorRows(session: BetterUiSession, datastores: DatastoreRow[]): Promise<FlavorRow[]> {
  const rows: FlavorRow[] = [];
  for (const datastore of datastores) {
    const body = await huaweiFetch<Record<string, unknown>>(session, "cdm", `/v1.1/${session.projectId}/datastores/${encodeURIComponent(datastore.id)}/flavors`);
    if (body.id !== datastore.id || body.dbname !== "cdm" || !Array.isArray(body.versions)) throw new Error("Huawei returned no verified CDM flavor catalog for this datastore.");
    for (const version of asArray(body.versions).map(asRecord)) {
      const versionName = firstString([version.name], "");
      const versionId = firstString([version.id], "");
      for (const flavor of asArray(version.flavors).map(asRecord)) {
        const strId = firstString([flavor.str_id], "");
        if (!strId || flavor.status !== "normal" || (flavor.region !== session.region && flavor.region !== "all")) continue;
        rows.push({ datastoreId: datastore.id, versionName, versionId, name: firstString([flavor.name], ""), strId, cpu: count(flavor.cpu), ram: count(flavor.ram) });
      }
    }
  }
  return rows;
}

async function zoneRows(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "cdm", `/v1.1/${session.projectId}/regions/${encodeURIComponent(session.region)}/availability_zones`);
  return asArray(body.availableZones).map(asRecord).flatMap((zone) => {
    const code = firstString([zone.availableZoneCode, zone.availableZoneId], "");
    const status = firstString([zone.azStatus], "");
    if (!code || status.toLowerCase() !== "available") return [];
    return [{ code, name: firstString([zone.availableZoneName], "") }];
  });
}

async function jobTypeRows(session: BetterUiSession, clusterId: string, jobType: string) {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let pageNo = 1; pageNo <= 1000; pageNo++) {
    const body = await huaweiFetch<Record<string, unknown>>(session, "cdm", `/v1.1/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/cdm/job/all?${new URLSearchParams({ jobType, page_no: String(pageNo), page_size: "100" })}`);
    if (!Array.isArray(body.jobs)) throw new Error("Huawei returned no verifiable CDM job list.");
    const page = body.jobs.map(asRecord);
    const fingerprint = JSON.stringify(page);
    if (page.length && seen.has(fingerprint)) throw new Error("Huawei repeated a CDM job page. No job mutation was performed.");
    seen.add(fingerprint);
    const total = Number(body.total);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("Huawei returned an invalid CDM job count. No job mutation was performed.");
    if (page.length > 100) throw new Error("Huawei returned an oversized CDM job page. No job mutation was performed.");
    rows.push(...page);
    if (rows.length >= total) return rows;
    if (!page.length) throw new Error("Huawei returned an incomplete CDM job list. No job mutation was performed.");
  }
  throw new Error("The CDM job list exceeds the supported page limit. No job mutation was performed.");
}

async function jobRows(session: BetterUiSession, clusterId: string) {
  const rows: Record<string, unknown>[] = [];
  for (const jobType of jobTypes) rows.push(...await jobTypeRows(session, clusterId, jobType));
  return rows;
}

async function jobRecord(session: BetterUiSession, clusterId: string, name: string) {
  const matching = (await jobRows(session, clusterId)).filter(row => row.name === name);
  if (matching.length !== 1 || !jobTypes.includes(String(matching[0].job_type))) throw new ManagementInputError("The migration job could not be uniquely verified on this cluster.", 404);
  let body: Record<string, unknown>;
  try {
    body = await huaweiFetch<Record<string, unknown>>(session, "cdm", `/v1.1/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/cdm/job/${encodeURIComponent(name)}?jobType=${encodeURIComponent(String(matching[0].job_type))}`);
  } catch (error) {
    if (error instanceof HuaweiApiError && error.status === 404) throw new ManagementInputError("The migration job was not found on this cluster.", 404);
    throw error;
  }
  const record = asRecord(asArray(body.jobs)[0]);
  if (firstString([record.name], "") !== name || record.job_type !== matching[0].job_type) throw new ManagementInputError("The migration job was not found on this cluster.", 404);
  return record;
}

async function linkRecord(session: BetterUiSession, clusterId: string, name: string) {
  let body: Record<string, unknown>;
  try {
    body = await huaweiFetch<Record<string, unknown>>(session, "cdm", `/v1.1/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/cdm/link/${encodeURIComponent(name)}`);
  } catch (error) {
    if (error instanceof HuaweiApiError && error.status === 404) throw new ManagementInputError("The connection was not found on this cluster.", 404);
    throw error;
  }
  const record = asRecord(asArray(body.links)[0]);
  if (firstString([record.name], "") !== name) throw new ManagementInputError("The connection was not found on this cluster.", 404);
  return record;
}

async function jobStatusRows(session: BetterUiSession, clusterId: string, name: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "cdm", `/v1.1/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/cdm/job/${encodeURIComponent(name)}/status`);
  return asArray(body.submissions).map(asRecord);
}

async function jobHistoryRows(session: BetterUiSession, clusterId: string, name: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "cdm", `/v1.1/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/cdm/submissions?${new URLSearchParams({ jname: name })}`);
  if (!Array.isArray(body.submissions)) throw new Error("Huawei returned no verifiable CDM run history.");
  return { rows: body.submissions.map(asRecord).filter(row => row["job-name"] === name), total: Number(body.total) };
}

function assertClusterState(record: Record<string, unknown>, allowed: string[]) {
  const status = String(record.status ?? "");
  if (!allowed.includes(status)) throw new ManagementInputError(`This operation is unavailable while the cluster status is ${status || "unknown"}.`, 409);
}

function jobStatus(record: Record<string, unknown>) {
  return firstString([record.status], "UNKNOWN");
}

function jobSummary(row: Record<string, unknown>) {
  return {
    name: firstString([row.name], ""),
    type: firstString([row.job_type], "NORMAL_JOB"),
    fromConnector: firstString([row["from-connector-name"]], ""),
    fromLink: firstString([row["from-link-name"]], ""),
    toConnector: firstString([row["to-connector-name"]], ""),
    toLink: firstString([row["to-link-name"]], ""),
    status: jobStatus(row),
    enabled: row.enabled === true,
    rowsRead: count(row.rows_read),
    rowsWritten: count(row.rows_written),
    filesRead: count(row.files_read),
    filesWritten: count(row.files_written),
    created: epoch(row["creation-date"]),
    updated: epoch(row["update-date"]),
  };
}

function jobIdOf(body: Record<string, unknown>) {
  const value = body.jobId;
  if (typeof value === "string" && value.trim()) return value;
  const first = asArray(value)[0];
  return typeof first === "string" || typeof first === "number" ? String(first) : "";
}

function validRunNumber(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function runReference(run: Record<string, unknown>, name: string) {
  if (run["job-name"] !== name) throw new Error("Huawei returned no verified migration job name for this run.");
  const submission = run["submission-id"], created = run["creation-date"];
  if (!validRunNumber(submission) && !validRunNumber(created)) throw new Error("Huawei returned no verifiable submission ID or creation time for this migration run.");
  return JSON.stringify({ name, ...(validRunNumber(submission) ? { submission } : { created }) });
}

function clusterFacts(record: Record<string, unknown>) {
  const facts: Array<{ label: string; value: string }> = [
    { label: "Status", value: [firstString([record.status], "-"), firstString([record.statusDetail], "")].filter(Boolean).join(" · ") },
    { label: "Version", value: firstString([asRecord(record.datastore).version], "-") },
    { label: "Specification", value: firstString([record.flavorName], "-") },
    { label: "Cluster mode", value: firstString([record.clusterMode], "-") },
    { label: "Availability zone", value: firstString([record.azName], "-") },
    { label: "VPC", value: firstString([record.vpc_id], "-") },
    { label: "Subnet", value: firstString([record.subnet_id], "-") },
    { label: "Security group", value: firstString([record.security_group_id], "-") },
    { label: "Enterprise project", value: firstString([record.eps_id], "-") },
    { label: "Automatic shutdown", value: record.isAutoOff === true ? "Enabled" : "Disabled" },
    { label: "Scheduled startup/shutdown", value: record.isScheduleBootOff === true ? "Enabled" : "Disabled" },
    { label: "Public endpoint", value: firstString([record.publicEndpoint], "") ? "Bound" : "Not bound" },
  ];
  const window = asRecord(record.maintainWindow);
  const maintain = [firstString([window.day], ""), [firstString([window.startTime], ""), firstString([window.endTime], "")].filter(Boolean).join("-")].filter(Boolean).join(" · ");
  facts.push({ label: "Maintenance window", value: maintain || "Not set" });
  const keep = count(record.bakKeepDay);
  if (keep > 0) facts.push({ label: "Backup retention", value: `${keep} days` });
  const task = asRecord(record.task);
  const taskName = firstString([task.name], "");
  if (taskName) facts.push({ label: "Current task", value: [taskName, firstString([task.description], "")].filter(Boolean).join(" · ") });
  for (const instance of asArray(record.instances).map(asRecord)) {
    const role = firstString([instance.role], "");
    facts.push({ label: `Node ${firstString([instance.name], "-")}${role ? ` · ${role}` : ""}`, value: [
      firstString([instance.status], "-"),
      `flavor ${firstString([asRecord(instance.flavor).id], "-")}`,
      `${firstString([asRecord(instance.volume).type], "-")} disk ${count(asRecord(instance.volume).size)} GB`,
    ].join(" · ") });
  }
  return facts;
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create cluster", kind: "create", description: "Create one private pay-per-use CDM cluster from the live version, specification, availability zone, and network catalogs. The CDM API exposes no prepaid billing mode for cluster creation.", impact: "The cluster is billed hourly while it runs; compute stops billing only when the cluster is stopped and storage keeps billing until deletion. The cluster is created inside the selected VPC/subnet without a public IP.", fields: [
    clusterName,
    { key: "offering", label: "Version and specification", type: "select", source: "offerings", required: true, help: "CDM versions and specifications currently returned by the native datastore and flavor catalogs." },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true, help: "Only availability zones reported as available by the CDM API are offered." },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "CDM uses the subnet ID for the cluster NIC; the selected subnet determines the VPC." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "modify", label: "Change cluster settings", kind: "update", description: "Update the native automatic shutdown, scheduled startup/shutdown, and job failure notification settings. The CDM API exposes no cluster rename or description editing.", fields: [
    { key: "autoOff", label: "Automatic shutdown", type: "boolean", required: true, help: "Shuts the cluster down automatically after 15 idle minutes. It cannot be combined with scheduled startup/shutdown." },
    { key: "scheduleBootOff", label: "Scheduled startup/shutdown", type: "boolean", required: true, help: "Runs the cluster daily between the scheduled times. It cannot be combined with automatic shutdown." },
    { key: "scheduleBootTime", label: "Scheduled power-on time (HH:mm:ss)", pattern: schedulePattern, max: 8 },
    { key: "scheduleOffTime", label: "Scheduled power-off time (HH:mm:ss)", pattern: schedulePattern, max: 8 },
    { key: "autoRemind", label: "Job failure notifications", type: "boolean", required: true },
    { key: "phoneNum", label: "Notification phone number", pattern: "^\\+?[0-9]{5,20}$", help: "Used when job failure notifications are enabled." },
    { key: "email", label: "Notification email", max: 254, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", help: "Used when job failure notifications are enabled." },
  ], allowedStatuses: ["200", "900"], confirmation: true, impact: "These settings control when the cluster runs and is billed. Scheduled shutdown does not wait for unfinished jobs." },
  { id: "restart", label: "Restart cluster", kind: "action", description: "Restart the CDM cluster service through the native cluster action route.", fields: [
    { key: "restartMode", label: "Restart mode", type: "select", required: true, defaultValue: "IMMEDIATELY", choices: [
      { value: "IMMEDIATELY", label: "Immediately" },
      { value: "SOFTLY", label: "Normal" },
      { value: "FORCELY", label: "Force (interrupts processes and reboots the VM)" },
    ] },
  ], allowedStatuses: active, confirmation: true, impact: "Running migration jobs are interrupted and connections close until the cluster is running again. Force restarts also reboot the cluster VM." },
  { id: "start", label: "Start cluster", kind: "action", description: "Start a stopped CDM cluster.", fields: [], allowedStatuses: stopped, confirmation: true, impact: "Compute billing resumes immediately." },
  { id: "stop", label: "Stop cluster", kind: "action", description: "Stop a running CDM cluster.", fields: [
    { key: "stopMode", label: "Stop mode", type: "select", required: true, defaultValue: "GRACEFULLY", choices: [
      { value: "GRACEFULLY", label: "Gracefully (wait for jobs)" },
      { value: "IMMEDIATELY", label: "Immediately" },
    ] },
    { key: "delayTime", label: "Graceful stop delay (seconds)", type: "number", min: -1, max: 86400, help: "Only used for a graceful stop: -1 waits for all running jobs; 1-86400 waits that many seconds and stops accepting new jobs." },
  ], allowedStatuses: active, confirmation: true, impact: "Compute billing stops while storage continues to be billed. Jobs still running after the delay are stopped and unfinished migrations stay incomplete." },
  { id: "delete", label: "Delete cluster", kind: "delete", description: "Permanently delete a pay-per-use CDM cluster after its migration jobs are removed. The CDM API does not expose the cluster billing mode, so prepaid console subscriptions cannot be verified here.", fields: [], allowedStatuses: deletable, confirmation: true, impact: "The cluster, its nodes, all its job definitions, and its connections are permanently destroyed. The CDM API cannot enumerate connections, so every remaining connection is destroyed with the cluster." },
  { id: "inspect", label: "Inspect cluster", kind: "inspect", description: "Show the cluster topology, network configuration, node resources, and the current native task. Node IP addresses and endpoint values are not returned.", fields: [], allowedStatuses: stable },
  { id: "jobs", label: "List migration jobs", kind: "inspect", description: "List every native job type (table/file, whole database, and scenario migrations) with nonsecret metadata only.", fields: [], allowedStatuses: active },
  { id: "job", label: "Inspect job", kind: "inspect", description: "Show one job's nonsecret metadata and its latest native run status and progress. Connection parameters and job configuration values are never returned.", fields: [jobField], allowedStatuses: active },
  { id: "job-history", label: "View job runs", kind: "inspect", description: "Show the native execution history of one job. The CDM API returns a single history page and exposes no paging request parameters.", fields: [jobField], allowedStatuses: active },
  { id: "start-job", label: "Start job", kind: "action", description: "Start one stopped migration job. Creating or editing jobs is not offered because the CDM SDK exposes no connector configuration schema.", fields: [jobField], allowedStatuses: active, confirmation: true, impact: "The job moves data between its configured connections. A failed run can leave partial data at the destination." },
  { id: "stop-job", label: "Stop job", kind: "action", description: "Stop one running migration job.", fields: [jobField], allowedStatuses: active, confirmation: true, impact: "The run is interrupted. Data already moved stays at the destination and the migration remains incomplete." },
  { id: "delete-job", label: "Delete job", kind: "action", description: "Permanently delete one stopped migration job definition.", fields: [jobField], allowedStatuses: active, confirmation: true, impact: "The job definition is permanently removed. Already migrated data is not affected." },
  { id: "link", label: "Inspect connection", kind: "inspect", description: "Show one connection's nonsecret metadata by its exact name. The CDM SDK exposes no connection listing route, and credentials or connection parameters are never returned.", fields: [linkNameField], allowedStatuses: active },
  { id: "delete-link", label: "Delete connection", kind: "action", description: "Permanently delete one connection that no migration job references. The CDM SDK exposes no connection listing route, so the exact connection name is required.", fields: [linkNameField], allowedStatuses: active, confirmation: true, impact: "The connection definition is permanently removed. Jobs referencing it can no longer run." },
];

export const cdmManagement: ManagementAdapter = {
  title: "Cloud Data Migration",
  operations,
  inventory: async (session) => (await listCdmClustersForProject(session)).map((item) => ({
    id: item.id, name: item.name, status: item.status,
    values: { flavor: item.flavor, version: item.version, mode: item.mode, nodes: item.nodeCount, projectId: item.projectId },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [datastores, zones, subnets, groups] = await Promise.all([datastoreRows(session), zoneRows(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      const flavors = await flavorRows(session, datastores);
      const offerings = datastores.flatMap((datastore) => datastore.versions.flatMap((version) => flavors.filter((flavor) => flavor.datastoreId === datastore.id && (flavor.versionName === version || flavor.versionId === version)).map((flavor) => ({
        value: JSON.stringify([datastore.id, version, flavor.strId]),
        label: `CDM ${version} · ${flavor.name || flavor.strId} · ${flavor.cpu} vCPU · ${flavor.ram} GB RAM`,
      }))));
      return {
        offerings,
        zones: zones.map((zone) => ({ value: zone.code, label: zone.name && zone.name !== zone.code ? `${zone.name} · ${zone.code}` : zone.code })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
      };
    }
    if (!resource) return {};
    if (["job", "job-history", "start-job", "stop-job", "delete-job"].includes(operation)) {
      const cluster = await clusterRecord(session, resource.id);
      assertClusterState(cluster, active);
      const rows = await jobRows(session, resource.id);
      const jobs = [...new Map(rows.map(jobSummary).filter((job) => job.name).map((job) => [job.name, job])).values()];
      const filtered = jobs.filter((job) => {
        if (operation === "stop-job") return runningJobStatuses.includes(job.status);
        if (operation === "start-job") return job.enabled && idleJobStatuses.includes(job.status);
        if (operation === "delete-job") return idleJobStatuses.includes(job.status);
        return true;
      });
      return { jobs: filtered.map((job) => ({ value: job.name, label: `${job.name} · ${job.type} · ${job.status}` })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    if (entry.operation === "Start job" || entry.operation === "Stop job") {
      if (!entry.resourceId || !entry.jobId) throw new ManagementInputError("The CDM job poll is missing its cluster or job reference.");
      let saved: Record<string, unknown>;
      try { saved = asRecord(JSON.parse(entry.jobId)); } catch { throw new ManagementInputError("This request has no verified CDM run identity."); }
      if (typeof saved.name !== "string" || (!validRunNumber(saved.submission) && !validRunNumber(saved.created))) throw new ManagementInputError("This request has no verified CDM run identity.");
      await clusterRecord(session, entry.resourceId);
      const history = await jobHistoryRows(session, entry.resourceId, saved.name);
      const latest = history.rows.find(row => row["job-name"] === saved.name && (validRunNumber(saved.submission) ? row["submission-id"] === saved.submission : row["creation-date"] === saved.created));
      if (!latest) return { state: "submitted", message: "The saved migration run is not present in the returned history page. Check its original run in CDM; a newer run is not used as its result." };
      const status = String(latest.status ?? "");
      if (entry.operation === "Start job") {
        if (status === "SUCCEEDED") return { state: "succeeded", message: "The requested migration run completed successfully.", resourceId: entry.resourceId };
        if (["FAILED", "FAILURE_ON_SUBMIT", "STOPPED"].includes(status)) return { state: "failed", message: "The requested migration run failed or was stopped. Inspect its diagnostics in CDM.", resourceId: entry.resourceId };
      } else if (["SUCCEEDED", "FAILED", "FAILURE_ON_SUBMIT", "STOPPED"].includes(status)) return { state: "succeeded", message: "The requested migration run is no longer running.", resourceId: entry.resourceId };
      return { state: "submitted", message: `The requested migration run is ${status || "unverified"}.` };
    }
    if (!entry.resourceId) throw new ManagementInputError("The CDM cluster poll is missing its cluster reference.");
    let record: Record<string, unknown>;
    try {
      record = await clusterRecord(session, entry.resourceId);
    } catch (error) {
      if (error instanceof ManagementInputError && error.status === 404 && entry.operation === "Delete cluster") return { state: "succeeded", message: "The CDM cluster was deleted.", resourceId: entry.resourceId };
      throw error;
    }
    const status = String(record.status ?? "");
    if (["300", "303"].includes(status)) {
      return { state: "failed", message: `The cluster reported failure status ${status}. Review the cluster in CDM before retrying.`, resourceId: entry.resourceId };
    }
    if (entry.operation === "Restart cluster" && status === "200") return { state: "submitted", message: "The cluster is currently running. CDM exposes no cluster task-status API here, so this observation cannot independently confirm that the requested restart finished." };
    if (entry.operation === "Create cluster" || entry.operation === "Restart cluster" || entry.operation === "Start cluster") {
      if (status === "200") return { state: "succeeded", message: "The CDM cluster is running.", resourceId: entry.resourceId };
      return { state: "submitted", message: `The cluster is ${statusNames[status] ?? `in status ${status || "unknown"}`}.` };
    }
    if (entry.operation === "Stop cluster") {
      if (status === "900") return { state: "succeeded", message: "The CDM cluster is stopped.", resourceId: entry.resourceId };
      return { state: "submitted", message: `The cluster is ${statusNames[status] ?? `in status ${status || "unknown"}`}.` };
    }
    if (entry.operation === "Delete cluster") return { state: "submitted", message: "The cluster still exists; deletion is in progress." };
    throw new ManagementInputError("Unsupported CDM poll operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listCdmClusters, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    const base = `/v1.1/${session.projectId}`;
    if (operation === "create") {
      const [datastoreId, version, strId] = parseSelection(values.offering).map(String);
      if (!datastoreId || !version || !strId) throw new ManagementInputError("Select an available CDM version and specification.");
      const [datastores, zones, subnets, groups] = await Promise.all([datastoreRows(session), zoneRows(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      const datastore = datastores.find((item) => item.id === datastoreId);
      if (!datastore || !datastore.versions.includes(version)) throw new ManagementInputError("The selected CDM version is no longer available.");
      const flavors = await flavorRows(session, datastores);
      const flavor = flavors.find((item) => item.datastoreId === datastoreId && item.strId === strId && (item.versionName === version || item.versionId === version));
      if (!flavor) throw new ManagementInputError("The selected CDM specification is no longer available for this version.");
      const zone = zones.find((item) => item.code === values.zone);
      if (!zone) throw new ManagementInputError("The selected availability zone is no longer available for CDM clusters.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "cdm", `${base}/clusters`, { method: "POST", body: JSON.stringify({
        cluster: {
          name: values.name,
          vpcId: subnet.vpcId,
          instances: [{ availability_zone: zone.code, nics: [{ securityGroupId: String(values.securityGroup), "net-id": subnet.id }], flavorRef: flavor.strId, type: "cdm" }],
          datastore: { type: "cdm", version },
          sys_tags: [{ key: "_sys_enterprise_project_id", value: String(values.enterpriseProjectId ?? "0") }],
        },
      }) });
      if (typeof response.id !== "string" || !response.id) throw new Error("Huawei returned no verifiable CDM cluster ID after creation.");
      return { message: "Cluster creation submitted. The cluster is private and pay-per-use; no public IP is attached.", resourceId: firstString([response.id], "") || undefined, jobId: firstString([asRecord(response.task).id], "") || undefined, asynchronous: true };
    }
    if (!resource) throw new ManagementInputError("Select a CDM cluster.");
    const cluster = resource;
    if (operation === "modify") {
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, ["200", "900"]);
      const autoOff = values.autoOff === true;
      const scheduleBootOff = values.scheduleBootOff === true;
      const autoRemind = values.autoRemind === true;
      if (autoOff && scheduleBootOff) throw new ManagementInputError("Automatic shutdown and scheduled startup/shutdown cannot be enabled at the same time.");
      if (scheduleBootOff && (![values.scheduleBootTime, values.scheduleOffTime].every(value => typeof value === "string" && new RegExp(schedulePattern).test(value)))) throw new ManagementInputError("Scheduled startup/shutdown requires both power-on and power-off times in HH:mm:ss format.");
      const phone = String(values.phoneNum ?? "").trim();
      const email = String(values.email ?? "").trim();
      if (autoRemind && !phone && !email) throw new ManagementInputError("Provide a phone number or an email address for job failure notifications.");
      await huaweiFetch(session, "cdm", `${base}/cluster/modify/${encodeURIComponent(cluster.id)}`, { method: "POST", headers: { "X-Language": "en-us" }, body: JSON.stringify({
        autoOff,
        scheduleBootOff,
        ...(scheduleBootOff ? { scheduleBootTime: String(values.scheduleBootTime), scheduleOffTime: String(values.scheduleOffTime) } : {}),
        autoRemind,
        ...(phone ? { phoneNum: phone } : {}),
        ...(email ? { email } : {}),
      }) });
      return { message: "Cluster settings update accepted. Verify the applied schedule in CDM before relying on it.", resourceId: cluster.id };
    }
    if (operation === "restart") {
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      const response = await huaweiFetch<Record<string, unknown>>(session, "cdm", `${base}/clusters/${encodeURIComponent(cluster.id)}/action`, { method: "POST", body: JSON.stringify({ restart: { restartMode: String(values.restartMode), restartLevel: "SERVICE", type: "cdm", instance: "", group: "" } }) });
      return { message: "Cluster restart submitted. Running jobs are interrupted until the cluster is running again.", resourceId: cluster.id, jobId: jobIdOf(response) || undefined, asynchronous: true };
    }
    if (operation === "start") {
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, stopped);
      const response = await huaweiFetch<Record<string, unknown>>(session, "cdm", `${base}/clusters/${encodeURIComponent(cluster.id)}/action`, { method: "POST", body: JSON.stringify({ start: {} }) });
      return { message: "Cluster start submitted. Compute billing resumes.", resourceId: cluster.id, jobId: jobIdOf(response) || undefined, asynchronous: true };
    }
    if (operation === "stop") {
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      const stopMode = String(values.stopMode);
      if (stopMode === "GRACEFULLY") {
        if (typeof values.delayTime !== "number") throw new ManagementInputError("A graceful stop requires the shutdown delay.");
        if (!Number.isSafeInteger(values.delayTime) || (values.delayTime !== -1 && (values.delayTime < 1 || values.delayTime > 86400))) throw new ManagementInputError("The shutdown delay must be -1 to wait for all jobs or 1-86400 seconds.");
      }
      const response = await huaweiFetch<Record<string, unknown>>(session, "cdm", `${base}/clusters/${encodeURIComponent(cluster.id)}/action`, { method: "POST", body: JSON.stringify({ stop: stopMode === "GRACEFULLY" ? { stopMode, delayTime: values.delayTime as number } : { stopMode } }) });
      return { message: "Cluster stop submitted. Compute billing stops; storage continues to be billed.", resourceId: cluster.id, jobId: jobIdOf(response) || undefined, asynchronous: true };
    }
    if (operation === "delete") {
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, deletable);
      const jobs = await jobRows(session, cluster.id);
      if (jobs.length) throw new ManagementInputError(`The cluster still has ${jobs.length} migration job(s). Delete them before deleting the cluster; the CDM API cannot enumerate connections, which are destroyed with the cluster.`, 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "cdm", `${base}/clusters/${encodeURIComponent(cluster.id)}`, { method: "DELETE" });
      return { message: "Cluster deletion submitted. The cluster, its jobs, and its connections are permanently removed.", resourceId: cluster.id, jobId: jobIdOf(response) || undefined, asynchronous: true };
    }
    if (operation === "inspect") {
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, stable);
      const facts = clusterFacts(record);
      return { message: `${facts.length} cluster details loaded.`, facts };
    }
    if (operation === "jobs") {
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      const rows = await jobRows(session, cluster.id);
      const facts = rows.map((row) => {
        const job = jobSummary(row);
        return { label: `${job.name} · ${job.type}`, value: [
          job.status,
          job.fromLink ? `from ${job.fromLink}${job.fromConnector ? ` (${job.fromConnector})` : ""}` : "",
          job.toLink ? `to ${job.toLink}${job.toConnector ? ` (${job.toConnector})` : ""}` : "",
          `${job.rowsRead} rows read · ${job.rowsWritten} rows written · ${job.filesRead} files read · ${job.filesWritten} files written`,
        ].filter(Boolean).join(" · ") };
      });
      return { message: `${rows.length} migration jobs loaded.`, facts };
    }
    if (operation === "job") {
      const name = String(values.job);
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      const job = await jobRecord(session, cluster.id, name);
      const submissions = await jobStatusRows(session, cluster.id, name);
      const latest = asRecord(submissions[0]);
      const summary = jobSummary(job);
      return { message: "Job details loaded.", facts: [
        { label: "Name", value: summary.name },
        { label: "Type", value: summary.type },
        { label: "From", value: [summary.fromLink, summary.fromConnector].filter(Boolean).join(" · ") || "-" },
        { label: "To", value: [summary.toLink, summary.toConnector].filter(Boolean).join(" · ") || "-" },
        { label: "Enabled", value: summary.enabled ? "Yes" : "No" },
        { label: "Status", value: summary.status },
        { label: "Latest run", value: [identifier(latest.status, "No run reported"), identifier(latest.progress, "") ? `progress ${identifier(latest.progress)}` : ""].filter(Boolean).join(" · ") },
        { label: "Rows", value: `${summary.rowsRead} read · ${summary.rowsWritten} written` },
        { label: "Files", value: `${summary.filesRead} read · ${summary.filesWritten} written` },
        { label: "Created", value: `${summary.created}` },
        { label: "Updated", value: `${summary.updated}` },
      ] };
    }
    if (operation === "job-history") {
      const name = String(values.job);
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      await jobRecord(session, cluster.id, name);
      const history = await jobHistoryRows(session, cluster.id, name);
      const facts = history.rows.map((row, index) => {
        const status = firstString([row.status], "UNKNOWN");
        const failure = status === "FAILED" ? "Failed; inspect native diagnostics in CDM." : "";
        return { label: `Run ${identifier(row["submission-id"], String(index + 1))} · ${status}`, value: [epoch(row["execute-date"]), failure].filter(Boolean).join(" · ") || "No details reported" };
      });
      const total = Number.isSafeInteger(history.total) && history.total >= 0 ? history.total : history.rows.length;
      return { message: `${history.rows.length} job runs loaded${total > history.rows.length ? ` (the CDM API returned the latest ${history.rows.length} of ${total} runs and exposes no paging parameters)` : "."}`, facts };
    }
    if (operation === "start-job") {
      const name = String(values.job);
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      const job = await jobRecord(session, cluster.id, name);
      if (job.enabled !== true) throw new ManagementInputError("The migration job is disabled. The CDM SDK exposes no job enable route.", 409);
      if (!idleJobStatuses.includes(jobStatus(job))) throw new ManagementInputError(`The migration job is currently ${jobStatus(job)} or its idle state is unverified.`, 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "cdm", `${base}/clusters/${encodeURIComponent(cluster.id)}/cdm/job/${encodeURIComponent(name)}/start`, { method: "PUT", body: JSON.stringify({ variables: {} }) });
      const submission = asRecord(asArray(response.submissions)[0]);
      const reference = runReference(submission, name);
      if (["FAILED", "FAILURE_ON_SUBMIT"].includes(String(submission.status))) throw new ManagementInputError("Huawei rejected starting this migration job.", 409);
      return { message: `Job start submitted (native submission ${identifier(submission["submission-id"], "creation time " + String(submission["creation-date"]))}).`, resourceId: cluster.id, jobId: reference, asynchronous: true };
    }
    if (operation === "stop-job") {
      const name = String(values.job);
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      const job = await jobRecord(session, cluster.id, name);
      if (!runningJobStatuses.includes(jobStatus(job))) throw new ManagementInputError(`The migration job is not running (status ${jobStatus(job)}).`, 409);
      const currentRun = asRecord((await jobStatusRows(session, cluster.id, name))[0]);
      const reference = runReference(currentRun, name);
      if (!runningJobStatuses.includes(String(currentRun.status))) throw new ManagementInputError("The current migration run is already finished or unverified.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "cdm", `${base}/clusters/${encodeURIComponent(cluster.id)}/cdm/job/${encodeURIComponent(name)}/stop`, { method: "PUT" });
      const validations = asArray(response["validation-result"]).map(asRecord);
      if (validations.some((row) => String(row.status ?? "").toUpperCase() === "ERROR")) throw new ManagementInputError("Huawei rejected stopping this migration job. Review its native run status.", 409);
      return { message: "Job stop submitted.", resourceId: cluster.id, jobId: reference, asynchronous: true };
    }
    if (operation === "delete-job") {
      const name = String(values.job);
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      const job = await jobRecord(session, cluster.id, name);
      if (!idleJobStatuses.includes(jobStatus(job))) throw new ManagementInputError(`The migration job is currently ${jobStatus(job)} or its idle state is unverified and cannot be deleted.`, 409);
      await huaweiFetch(session, "cdm", `${base}/clusters/${encodeURIComponent(cluster.id)}/cdm/job/${encodeURIComponent(name)}`, { method: "DELETE" });
      return { message: "Migration job deleted.", resourceId: cluster.id };
    }
    if (operation === "link") {
      const name = String(values.linkName);
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      const link = await linkRecord(session, cluster.id, name);
      return { message: "Connection details loaded.", facts: [
        { label: "Name", value: firstString([link.name], "-") },
        { label: "Connector", value: firstString([link["connector-name"]], "-") },
        { label: "Enabled", value: link.enabled === false ? "No" : "Yes" },
        { label: "Created", value: `${firstString([link["creation-user"]], "-")} · ${epoch(link["creation-date"])}` },
        { label: "Updated", value: `${firstString([link["update-user"]], "-")} · ${epoch(link["update-date"])}` },
      ] };
    }
    if (operation === "delete-link") {
      const name = String(values.linkName);
      const record = await clusterRecord(session, cluster.id);
      assertClusterState(record, active);
      await linkRecord(session, cluster.id, name);
      const jobs = await jobRows(session, cluster.id);
      if (jobs.some(row => typeof row["from-link-name"] !== "string" || typeof row["to-link-name"] !== "string")) throw new ManagementInputError("Huawei returned jobs without verified connection references; connection deletion is blocked.", 409);
      const referenced = jobs.filter((row) => firstString([row["from-link-name"]], "") === name || firstString([row["to-link-name"]], "") === name);
      if (referenced.length) throw new ManagementInputError(`${referenced.length} migration job(s) still use this connection. Delete those jobs first; the CDM API exposes no job re-pointing route.`, 409);
      await huaweiFetch(session, "cdm", `${base}/clusters/${encodeURIComponent(cluster.id)}/cdm/link/${encodeURIComponent(name)}`, { method: "DELETE" });
      return { message: "Connection deleted.", resourceId: cluster.id };
    }
    throw new ManagementInputError("Unsupported CDM operation.");
  },
};
