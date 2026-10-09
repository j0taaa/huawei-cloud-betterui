import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { HuaweiApiError, huaweiFetch as nativeFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString, timestampMillis, timestampSeconds } from "@/lib/huawei/parsers";
import { listSecurityGroupsForProject, listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";
import { collectList, type Pagination } from "@/lib/huawei/pagination";

async function huaweiFetch<T>(session: BetterUiSession, service: "mrs", path: string, init?: RequestInit): Promise<T> {
  try {
    const body = await nativeFetch<T>(session, service, path, init), row = asRecord(body);
    if ((row.error_code !== undefined && String(row.error_code) !== "0") || (row.errorCode !== undefined && String(row.errorCode) !== "0") || row.result === "failed") throw new HuaweiApiError("Huawei rejected this MRS request.", 502);
    return body;
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected this MRS request (HTTP ${error.status}).`, error.status);
    throw new Error("Huawei returned an unverifiable MRS response. Check native state before retrying.");
  }
}
async function huaweiList<T>(session: BetterUiSession, service: "mrs", path: string, pagination: Pagination): Promise<T> {
  return collectList(async cursor => {
    const url = new URL(path, "https://local.invalid");
    if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor));
    const body = await huaweiFetch<T>(session, service, url.pathname + url.search), row = asRecord(body);
    const items = row[pagination.items[0]], total = row[pagination.total![0]];
    if (!Array.isArray(items) || typeof total !== "number" || !Number.isSafeInteger(total) || total < items.length) throw new Error("Huawei returned an incomplete MRS page or total.");
    return body;
  }, pagination);
}
async function networkCatalog<T>(load: () => Promise<T>): Promise<T> {
  try { return await load(); } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected the MRS network catalog request (HTTP ${error.status}).`, error.status);
    throw new Error("The MRS network catalog could not be verified.");
  }
}

// Bounded typed subset of the native MRS v1.1/v2 contracts (primary sources: the Huawei MRS API
// reference and the official SDK models). Explicit gaps that are deliberately not implemented:
// - Job submission for every native v2 job kind (MapReduce, SparkSubmit, SparkPython, HiveScript,
//   HiveSql, DistCp, SparkScript, SparkSql, Flink): the native v2 job-execution schema only accepts
//   freeform `arguments` with no verifiable per-job-type program or artifact contract, so a typed
//   submission cannot be validated here. Submit jobs from the Huawei console until a per-engine
//   artifact schema is verified.
// - STREAMING/MIXED/CUSTOM cluster types and their templates; task and custom node groups, multi-AZ,
//   expand/shrink and autoscaling policies; custom component configs, external data sources and data
//   connectors, bootstrap scripts, tags, SMN notify, and OBS log dump paths; Kerberos (KERBEROS) job
//   execution which needs Manager authentication, keypair (KEYPAIR) node login, Manager password
//   rotation, IAM user sync, agency mapping, HDFS file browsing, and SQL execution endpoints; prepaid
//   subscription orders and their cancellation workflow (pay-per-use only here); public Manager
//   access through a bound EIP.
const v2 = (s: BetterUiSession) => `/v2/${s.projectId}`;
const v11 = (s: BetterUiSession) => `/v1.1/${s.projectId}`;
const analysisType = "ANALYSIS";
const masterGroup = "master_node_default_group";
const coreGroup = "core_node_analysis_group";
const masterNodeNum = 2;
const running = ["running"];
const deletable = ["running", "failed", "abnormal"];
const clusterStates = ["starting", "running", "terminated", "failed", "abnormal", "terminating", "frozen", "scaling-out", "scaling-in"];
const volumeTypeEnum = ["SATA", "SAS", "SSD", "GPSSD"];
const safeModeChoices: ManagementChoice[] = [{ value: "SIMPLE", label: "SIMPLE · Kerberos disabled" }, { value: "KERBEROS", label: "KERBEROS · Kerberos enabled" }];
const activeJobStates = ["NEW", "NEW_SAVING", "SUBMITTED", "ACCEPTED", "RUNNING"];
const finishedJobResults = ["SUCCEEDED", "FAILED", "KILLED"];
const knownJobStates = [...activeJobStates, "FINISHED", "FAILED", "KILLED"];
const knownJobResults = ["UNDEFINED", ...finishedJobResults];
const createLabel = "Create analysis cluster";
const deleteLabel = "Delete cluster";
const stopJobLabel = "Stop running job";
const deleteJobLabel = "Delete finished job record";
const pollLabels = new Set([createLabel, deleteLabel, stopJobLabel, deleteJobLabel]);
const passwordSpecials = /[!@$%^=\-_\[{}+\]:,.\/?]/;
const passwordCharset = /^[A-Za-z0-9!@$%^=\-_\[{}+\]:,.\/?]+$/;

const clusterName: ManagementField = { key: "name", label: "Cluster name", required: true, min: 1, max: 64, pattern: "^[A-Za-z0-9_-]{1,64}$", help: "1-64 letters, digits, hyphens, and underscores. Cluster names must be unique." };
const managerPassword: ManagementField = { key: "managerPassword", label: "Manager administrator password", type: "password", required: true, min: 8, max: 26, help: "8-26 characters combining uppercase letters, lowercase letters, digits, and the special characters !@$%^-_=+[{}]:,./? with no spaces. It cannot match the user name admin or its reverse." };
const nodeRootPassword: ManagementField = { key: "nodeRootPassword", label: "Node root password", type: "password", required: true, min: 8, max: 26, help: "8-26 characters combining uppercase letters, lowercase letters, digits, and the special characters !@$%^-_=+[{}]:,./? with no spaces. It cannot match the user name root or its reverse." };

function assertMrsPassword(value: string, account: string, label: string) {
  if (value.length < 8 || value.length > 26) throw new ManagementInputError(`${label} must be 8 to 26 characters long.`);
  if (/\s/.test(value)) throw new ManagementInputError(`${label} cannot contain spaces.`);
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, passwordSpecials].filter((expression) => expression.test(value)).length;
  if (groups < 4) throw new ManagementInputError(`${label} must combine uppercase letters, lowercase letters, digits, and the supported special characters (!@$%^-_=+[{}]:,./?).`);
  if (!passwordCharset.test(value)) throw new ManagementInputError(`${label} uses characters outside the supported MRS set.`);
  const lowered = value.toLowerCase();
  if (lowered === account || lowered === [...account].reverse().join("")) throw new ManagementInputError(`${label} cannot match the user name or its reverse.`);
}

// The native v1 contract reports safe_mode as an integer: 0 SIMPLE, 1 KERBEROS. Missing, empty, or
// masked values must never coerce to SIMPLE; anything but the exact native 0/1 stays unknown.
function safeModeOf(record: Record<string, unknown>) {
  const modes = [record.safeMode, record.safe_mode].filter(value => value !== undefined);
  const mode = modes[0];
  if (modes.some(value => value !== mode)) return "";
  return mode === 0 ? "SIMPLE" : mode === 1 ? "KERBEROS" : "";
}

// The verified native v1 billingType is numeric and 12 means pay-per-use; no string value is
// accepted as a pay-per-use signal.
function isPayPerUse(record: Record<string, unknown>) {
  const modes = [record.billingType, record.billing_type].filter(value => value !== undefined);
  return !!modes.length && modes.every(value => value === 12);
}

function billingTypeOf(record: Record<string, unknown>) {
  const raw = record.billingType ?? record.billing_type;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "";
}

function billingLabel(record: Record<string, unknown>) {
  const billing = billingTypeOf(record);
  return isPayPerUse(record) ? "Pay-per-use (billingType 12)" : billing ? `billingType ${billing}` : "Unknown";
}

function clusterStateOf(record: Record<string, unknown>) {
  const state = firstString([record.clusterState, record.cluster_state, record.status], "");
  return clusterStates.includes(state) ? state : "unknown";
}

function clusterNameOf(record: Record<string, unknown>) {
  return firstString([record.clusterName, record.cluster_name], "");
}

function clusterIdOf(record: Record<string, unknown>) {
  return firstString([record.clusterId, record.cluster_id], "");
}

// The native payloads do not always carry a project id; when one is present it must match the
// selected project or the record is treated as out of scope.
function assertProjectScope(session: BetterUiSession, record: Record<string, unknown>, label: string) {
  if (["projectId", "project_id"].some(key => Object.hasOwn(record, key) && record[key] !== session.projectId)) throw new ManagementInputError(`Huawei returned ${label} from a different project.`, 404);
}

async function clusterRows(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "mrs", `${v11(session)}/cluster_infos?pageSize=100&currentPage=1&clusterState=existing`, { items: ["clusters"], kind: "page", parameter: "currentPage", size: 100, first: 1, total: ["clusterTotal"] });
  const seen = new Set<string>();
  return asArray(body.clusters).map(asRecord).map((row) => {
    const id = clusterIdOf(row);
    const name = clusterNameOf(row);
    if (!id || !name) throw new Error("Huawei returned an MRS cluster without a verifiable identity.");
    if (seen.has(id)) throw new Error(`Huawei returned duplicate MRS cluster ${id}.`);
    seen.add(id);
    assertProjectScope(session, row, "an MRS cluster");
    return row;
  });
}

// Returns the fresh native cluster record, or null when the cluster is verifiably absent. A record
// carrying a different identity is never treated as the requested cluster.
async function findCluster(session: BetterUiSession, id: string) {
  let body: Record<string, unknown>;
  try {
    body = await huaweiFetch<Record<string, unknown>>(session, "mrs", `${v11(session)}/cluster_infos/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof HuaweiApiError && error.status === 404) return null;
    throw error;
  }
  const record = asRecord(body.cluster);
  const actual = clusterIdOf(record);
  if (!actual) throw new Error("Huawei returned an MRS detail without a verifiable identity.");
  if (actual !== id) throw new ManagementInputError("Huawei returned a different MRS cluster.", 404);
  assertProjectScope(session, record, "an MRS cluster");
  return record;
}

async function clusterRecord(session: BetterUiSession, id: string) {
  const record = await findCluster(session, id);
  if (!record) throw new ManagementInputError("The MRS cluster was not found in this project.", 404);
  return record;
}

async function versionNames(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "mrs", `${v2(session)}/metadata/versions`);
  if (!Array.isArray(body.cluster_versions)) throw new Error("Huawei returned an invalid MRS version catalog.");
  if (body.cluster_versions.some(value => typeof value !== "string" || !value.trim())) throw new Error("Huawei returned an invalid MRS version identity.");
  const names = body.cluster_versions as string[];
  if (!names.length) throw new Error("Huawei reported no MRS versions; typed cluster creation is unavailable.");
  if (new Set(names).size !== names.length) throw new Error("Huawei returned duplicate MRS versions.");
  return names;
}

type VersionComponent = { name: string; version: string; analysis: boolean; visible: boolean; dependencies: string[] };
type DiskConstraint = { minNodeNum?: number; maxNodeNum?: number; minRootDiskSize?: number; minDiskSize?: number; minDataVolumeTotalSize: Record<string, number>; diskTypes: string[] };
type VersionMeta = { name: string; components: VersionComponent[]; kerberosExcluded: string[]; master: DiskConstraint | null; core: DiskConstraint | null };

function inVolumeEnumOrder(types: Iterable<string>) {
  const offered = new Set(types);
  return volumeTypeEnum.filter((type) => offered.has(type));
}

// The live per-node-group disk catalog. Only tokens from the documented native volume type value
// space can be submitted; a catalog that offers nothing recognizable blocks typed creation.
function diskTypesOf(constraint: Record<string, unknown>) {
  const tokens = new Set<string>();
  for (const [key, value] of Object.entries(asRecord(constraint.disk_type_constraint))) {
    for (const piece of String(key).split(",")) {
      const token = piece.trim();
      if (token) tokens.add(token);
    }
    if (typeof value === "string") for (const piece of value.split(",")) {
      const token = piece.trim();
      if (token) tokens.add(token);
    }
  }
  const offered = inVolumeEnumOrder(tokens);
  if (!offered.length && tokens.size) throw new Error("Huawei reported MRS disk types outside the documented volume type set; typed cluster creation is unavailable.");
  return offered;
}

function diskConstraintOf(raw: unknown): DiskConstraint {
  const record = asRecord(raw);
  const positive = (value: unknown) => {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("Huawei returned an invalid MRS disk constraint.");
    return value;
  };
  const minDataVolumeTotalSize: Record<string, number> = {};
  for (const [key, value] of Object.entries(asRecord(record.min_data_volume_total_size))) {
    const amount = positive(value);
    if (amount !== undefined) minDataVolumeTotalSize[key] = amount;
  }
  return { minNodeNum: positive(record.min_node_num), maxNodeNum: positive(record.max_node_num), minRootDiskSize: positive(record.min_root_disk_size), minDiskSize: positive(record.min_disk_size), minDataVolumeTotalSize, diskTypes: diskTypesOf(record) };
}

async function versionMeta(session: BetterUiSession, name: string): Promise<VersionMeta | null> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "mrs", `${v11(session)}/metadata/versions/${encodeURIComponent(name)}`);
  if (Object.hasOwn(body, "name") && body.name !== name) throw new Error("Huawei returned a different MRS version.");
  const stringList = (value: unknown, label: string, optional = false): string[] => {
    if (optional && value === undefined) return [];
    if (!Array.isArray(value) || value.some(value => typeof value !== "string" || !value.trim()) || new Set(value).size !== value.length) throw new Error(`Huawei returned invalid MRS ${label}.`);
    return value as string[];
  };
  if (!stringList(body.cluster_types, "cluster types").includes(analysisType)) return null;
  if (!Array.isArray(body.components)) throw new Error("Huawei returned an invalid MRS component catalog.");
  const seen = new Set<string>();
  const components = body.components.map(asRecord).map(component => {
    if (typeof component.name !== "string" || !component.name || seen.has(component.name)) throw new Error("Huawei returned an invalid or duplicate MRS component identity.");
    seen.add(component.name);
    return { name: component.name, version: firstString([component.version], ""), analysis: stringList(component.available_cluster_types, "component cluster types").includes(analysisType), visible: component.visible === true, dependencies: stringList(component.depend_on, "component dependencies", true) };
  });
  if (!components.length) return null;
  const constraints = asRecord(body.constraints), nodeConstraints = asRecord(constraints.node_constraint);
  return { name, components, kerberosExcluded: stringList(constraints.safe_mode_kerberos_exclude_components, "Kerberos exclusions", true), master: diskConstraintOf(nodeConstraints.master), core: diskConstraintOf(nodeConstraints.core) };
}

// Only a 404 legitimately means "this version is not offered"; permission and server failures are
// never hidden as empty catalogs.
async function offeredVersion(session: BetterUiSession, name: string) {
  try {
    return await versionMeta(session, name);
  } catch (error) {
    if (error instanceof HuaweiApiError && error.status === 404) return null;
    throw error;
  }
}

function hasDiskCatalog(meta: VersionMeta) {
  return !!meta.master?.diskTypes.length && !!meta.core?.diskTypes.length;
}

function rootVolumeTypesOf(meta: VersionMeta) {
  return inVolumeEnumOrder([...(meta.master?.diskTypes ?? [])].filter((type) => meta.core?.diskTypes.includes(type)));
}

type AzFlavor = { azCode: string; azName: string; master: string[]; core: string[] };

async function flavorRows(session: BetterUiSession, version: string): Promise<AzFlavor[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "mrs", `${v2(session)}/metadata/version/${encodeURIComponent(version)}/available-flavor`);
  if (!Array.isArray(body.available_flavors)) throw new Error("Huawei returned an invalid MRS flavor catalog.");
  const zones = new Set<string>();
  return body.available_flavors.map(asRecord).map((row) => {
    const azCode = firstString([row.az_code], "");
    if (!azCode) throw new Error("Huawei returned an MRS flavor row without an availability zone.");
    if (zones.has(azCode)) throw new Error(`Huawei returned duplicate MRS flavors for ${azCode}.`);
    zones.add(azCode);
    const names = (value: unknown) => {
      const seen = new Set<string>();
      const list = asArray(value).map(asRecord).map((flavor) => {
        const name = firstString([flavor.flavor_name], "");
        if (!name) throw new Error(`Huawei returned an MRS flavor without a specification for ${azCode}.`);
        if (seen.has(name)) throw new Error(`Huawei returned duplicate MRS specification ${name}.`);
        seen.add(name);
        return name;
      });
      if (!list.length) throw new Error(`Huawei returned no MRS ${value === row.master ? "Master" : "Core"} specifications for ${azCode}.`);
      return list;
    };
    return { azCode, azName: firstString([row.az_name], ""), master: names(row.master), core: names(row.core) };
  });
}

type JobRow = { id: string; name: string; type: string; state: string; result: string; submitted: unknown; finished: unknown };

async function jobRows(session: BetterUiSession, clusterId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "mrs", `${v2(session)}/clusters/${encodeURIComponent(clusterId)}/job-executions?limit=100`, { items: ["job_list"], kind: "offset", parameter: "offset", size: 100, first: 1, total: ["total_record"] });
  const seen = new Set<string>();
  return asArray(body.job_list).map(asRecord).map((row) => {
    const job: JobRow = {
      id: firstString([row.job_id], ""),
      name: firstString([row.job_name], ""),
      type: firstString([row.job_type], ""),
      state: firstString([row.job_state], ""),
      result: firstString([row.job_result], ""),
      submitted: row.submitted_time,
      finished: row.finished_time,
    };
    if (!job.id) throw new Error("Huawei returned an MRS job without a verifiable identity.");
    if (seen.has(job.id)) throw new Error(`Huawei returned duplicate MRS job ${job.id}.`);
    seen.add(job.id);
    if (["cluster_id", "clusterId"].some(key => Object.hasOwn(row, key) && row[key] !== clusterId)) throw new Error("Huawei returned an MRS job from a different cluster.");
    assertProjectScope(session, row, "an MRS job");
    return job;
  });
}

// Returns the fresh native job detail, or null when the job record is verifiably absent. Records
// carrying a different job or cluster identity are never treated as the requested job.
async function findJob(session: BetterUiSession, clusterId: string, jobId: string) {
  let body: Record<string, unknown>;
  try {
    body = await huaweiFetch<Record<string, unknown>>(session, "mrs", `${v2(session)}/clusters/${encodeURIComponent(clusterId)}/job-executions/${encodeURIComponent(jobId)}`);
  } catch (error) {
    if (error instanceof HuaweiApiError && error.status === 404) return null;
    throw error;
  }
  const detail = asRecord(body.job_detail);
  const actual = firstString([detail.job_id], "");
  if (!actual) throw new Error("Huawei returned an MRS detail without a verifiable identity.");
  if (actual !== jobId) throw new ManagementInputError("Huawei returned a different MRS job.", 404);
  if (["cluster_id", "clusterId"].some(key => Object.hasOwn(detail, key) && detail[key] !== clusterId)) throw new ManagementInputError("The MRS job belongs to a different cluster.", 404);
  assertProjectScope(session, detail, "an MRS job");
  return detail;
}

function isFinishedJob(job: JobRow) {
  return ["FINISHED", "FAILED", "KILLED"].includes(job.state) && finishedJobResults.includes(job.result);
}

function jobTime(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || !Number.isFinite(new Date(number > 1e12 ? number : number * 1000).getTime())) return "-";
  return number > 1e12 ? timestampMillis(number) : timestampSeconds(number);
}

function displayJobState(value: string) {
  return knownJobStates.includes(value) ? value : "unknown";
}

function displayJobResult(value: string) {
  return knownJobResults.includes(value) ? value : "unknown";
}

// Job writes require a running cluster whose native safe mode is exactly SIMPLE; Kerberos clusters
// need Manager-authenticated job execution and an unverified mode never passes as SIMPLE.
function assertJobCluster(record: Record<string, unknown>) {
  const state = clusterStateOf(record);
  if (state !== "running") throw new ManagementInputError("Job operations support running clusters only.", 409);
  const mode = safeModeOf(record);
  if (mode === "KERBEROS") throw new ManagementInputError("Job operations here support non-Kerberos (SIMPLE) clusters only. Kerberos clusters require Manager-authenticated job execution.", 409);
  if (mode !== "SIMPLE") throw new ManagementInputError("The cluster's mode could not be verified as SIMPLE; job operations are unavailable.", 409);
}

function wholeNumber(value: unknown, min: number, max: number, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new ManagementInputError(`${label} must be a whole number between ${min} and ${max}.`);
  return number;
}

const operations: ManagementOperation[] = [
  { id: "create", label: createLabel, kind: "create", description: "Deploy one private pay-per-use MRS analysis cluster with a two-node Master group and one analysis Core group, from live versions, components, zones, specifications, disk types, and owned networks.", impact: "Master and Core nodes with their disks are billed hourly while the cluster exists. The cluster is private: no public IP is bound and Manager is reachable only inside the selected subnet. Failure-log collection is off by default; enabling it makes MRS create an OBS bucket for failure logs that incurs storage charges until the bucket is deleted.", fields: [
    clusterName,
    { key: "version", label: "Cluster version", type: "select", source: "versions", required: true, help: "MRS versions currently offered in this region that support analysis clusters and expose a verifiable disk catalog." },
    { key: "components", label: "Components", type: "list", source: "components", required: true, max: 30, help: "Components offered by current MRS versions. The selection is verified against the selected version before submission." },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "masterSpec", label: "Master node specification", type: "select", source: "masterSpecs", required: true, help: "MRS deploys a fixed two-node Master group for high availability; the count is not selectable." },
    { key: "coreSpec", label: "Core node specification", type: "select", source: "coreSpecs", required: true },
    { key: "coreNodes", label: "Core node count", type: "number", required: true, min: 1, max: 500, defaultValue: 2 },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC. MRS uses the subnet's network ID." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true, help: "An owned security group. MRS requires it to allow management-plane access; cluster creation fails otherwise." },
    { key: "rootVolumeType", label: "Root disk type", type: "select", source: "rootVolumeTypes", required: true, help: "Disk types offered by the selected version's live node constraints." },
    { key: "rootVolumeSize", label: "Root disk size (GB)", type: "number", required: true, min: 10, max: 32768 },
    { key: "dataVolumeType", label: "Core data disk type", type: "select", source: "dataVolumeTypes", required: true, help: "Disk types offered by the selected version's live Core node constraints." },
    { key: "dataVolumeSize", label: "Core data disk size (GB)", type: "number", required: true, min: 100, max: 32000 },
    { key: "dataVolumeCount", label: "Core data disk count", type: "number", required: true, min: 1, max: 10 },
    { key: "safeMode", label: "Cluster mode", type: "select", required: true, choices: safeModeChoices, help: "Kerberos clusters cannot run job operations through this workflow; they require Manager-authenticated job execution." },
    managerPassword,
    nodeRootPassword,
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
    { key: "logCollection", label: "Collect failure logs into an MRS-created OBS bucket", type: "boolean", defaultValue: false, help: "Off by default. Enabling it makes MRS create an OBS bucket in this project for failure logs; the bucket and stored logs incur OBS storage charges until deleted." },
  ] },
  { id: "inspect", label: "Inspect cluster", kind: "inspect", description: "Show the cluster's current state, node and storage topology, components, networks, and billing mode. Node key file names, native failure descriptions, and raw cloud errors are never displayed.", fields: [] },
  { id: "rename", label: "Rename cluster", kind: "update", description: "Change the cluster name without restarting it.", fields: [clusterName], allowedStatuses: running },
  { id: "delete", label: deleteLabel, kind: "delete", description: "Permanently delete a pay-per-use cluster that is not busy and has no running jobs.", fields: [], allowedStatuses: deletable, confirmation: true, impact: "The cluster and all data on its nodes are permanently destroyed. Billing stops once deletion completes. Failure-log OBS buckets and other external resources are preserved and continue to incur charges. Prepaid clusters require the subscription cancellation workflow instead. Clusters with running jobs must have every job stopped first." },
  { id: "jobs", label: "View jobs", kind: "inspect", description: "List the cluster's job executions with their native states and results. Program arguments and properties are never displayed.", fields: [] },
  { id: "stop-job", label: stopJobLabel, kind: "action", description: "Terminate one job that is still running on a running non-Kerberos cluster.", fields: [{ key: "job", label: "Running job", type: "select", source: "stoppableJobs", required: true }], allowedStatuses: running, confirmation: true, impact: "The job is terminated. Partial outputs may remain in the cluster or in object storage, and the job record ends in the KILLED state." },
  { id: "delete-job", label: deleteJobLabel, kind: "action", description: "Permanently remove the execution record of one finished job on a running non-Kerberos cluster.", fields: [{ key: "job", label: "Finished job", type: "select", source: "finishedJobs", required: true }], allowedStatuses: running, confirmation: true, impact: "The job's execution record is permanently removed from the cluster's job history. Job outputs and cluster data are not affected." },
];

export const mrsManagement: ManagementAdapter = {
  title: "MapReduce Service",
  operations,
  inventory: async (session) => (await clusterRows(session)).map((row) => ({
    id: clusterIdOf(row),
    name: clusterNameOf(row),
    status: clusterStateOf(row),
    values: {
      billingType: billingTypeOf(row),
      safeMode: safeModeOf(row),
      version: firstString([row.clusterVersion, row.hadoopVersion], ""),
      masterNodes: Number(row.masterNodeNum) || 0,
      coreNodes: Number(row.coreNodeNum) || 0,
      vpcId: firstString([row.vpcId, row.vpc_id], ""),
      azCode: firstString([row.azCode, row.az_code], ""),
    },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [names, subnets, groups] = await Promise.all([versionNames(session), networkCatalog(() => listSubnetsForProject(session)), networkCatalog(() => listSecurityGroupsForProject(session))]);
      const metas = (await Promise.all(names.map((name) => offeredVersion(session, name)))).filter((meta): meta is VersionMeta => !!meta && hasDiskCatalog(meta));
      const flavorSets = await Promise.all(metas.map((meta) => flavorRows(session, meta.name)));
      const offered = metas.map((meta, index) => ({ meta, flavors: flavorSets[index] })).filter((pair) => pair.flavors.length);
      const zones = new Map<string, string>();
      const masterSpecs = new Set<string>();
      const coreSpecs = new Set<string>();
      const rootVolumeTypes = new Set<string>();
      const dataVolumeTypes = new Set<string>();
      for (const { meta, flavors } of offered) {
        for (const row of flavors) {
          if (!zones.has(row.azCode)) zones.set(row.azCode, row.azName);
          for (const spec of row.master) masterSpecs.add(spec);
          for (const spec of row.core) coreSpecs.add(spec);
        }
        for (const type of rootVolumeTypesOf(meta)) rootVolumeTypes.add(type);
        for (const type of meta.core!.diskTypes) dataVolumeTypes.add(type);
      }
      const components = new Map<string, string>();
      for (const { meta } of offered) for (const component of meta.components) if (component.visible && component.analysis && !components.has(component.name)) components.set(component.name, component.version);
      return {
        versions: offered.map(({ meta }) => ({ value: meta.name, label: `${meta.name} · Analysis cluster` })),
        components: [...components.entries()].map(([name, version]) => ({ value: name, label: version && version !== "-" ? `${name} ${version}` : name })),
        zones: [...zones.entries()].map(([code, name]) => ({ value: code, label: name && name !== code ? `${code} · ${name}` : code })),
        masterSpecs: [...masterSpecs].map((spec) => ({ value: spec, label: spec })),
        coreSpecs: [...coreSpecs].map((spec) => ({ value: spec, label: spec })),
        rootVolumeTypes: inVolumeEnumOrder(rootVolumeTypes).map((type) => ({ value: type, label: type })),
        dataVolumeTypes: inVolumeEnumOrder(dataVolumeTypes).map((type) => ({ value: type, label: type })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
      };
    }
    if (!resource) return {};
    if (operation === "stop-job" || operation === "delete-job") {
      const rows = await jobRows(session, resource.id);
      return {
        stoppableJobs: rows.filter((job) => activeJobStates.includes(job.state) && job.result === "UNDEFINED").map((job) => ({ value: job.id, label: `${job.name} · ${job.type} · ${job.state}` })),
        finishedJobs: rows.filter(isFinishedJob).map((job) => ({ value: job.id, label: `${job.name} · ${job.type} · ${job.result}` })),
      };
    }
    return {};
  },
  poll: async (session, entry) => {
    if (!pollLabels.has(entry.operation)) throw new ManagementInputError("Unsupported MRS operation poll.");
    if (!entry.resourceId || !entry.jobId) throw new ManagementInputError("The MRS operation poll is missing its cluster or job reference.");
    if ((entry.operation === createLabel || entry.operation === deleteLabel) && entry.jobId !== entry.resourceId) throw new ManagementInputError("The MRS cluster poll reference is inconsistent.");
    if (entry.operation === createLabel || entry.operation === deleteLabel) {
      const record = await findCluster(session, entry.resourceId);
      const state = record ? clusterStateOf(record) : "";
      if (entry.operation === deleteLabel) {
        if (!record || state === "terminated") return { state: "succeeded", message: "The MRS cluster was deleted.", resourceId: entry.resourceId };
        return { state: "submitted", message: state === "terminating" ? "The MRS cluster is being deleted." : "The MRS cluster deletion is still processing.", resourceId: entry.resourceId };
      }
      if (!record) return { state: "failed", message: "Huawei did not report the new MRS cluster. Check the cluster list before retrying.", resourceId: entry.resourceId };
      if (state === "running") return { state: "succeeded", message: "The MRS cluster is running.", resourceId: entry.resourceId };
      if (["failed", "abnormal", "terminating", "terminated", "frozen"].includes(state)) return { state: "failed", message: `The MRS cluster is in the ${state} state. Review the cluster before retrying.`, resourceId: entry.resourceId };
      return { state: "submitted", message: state === "starting" ? "The MRS cluster is starting." : "The MRS cluster is still deploying.", resourceId: entry.resourceId };
    }
    const detail = await findJob(session, entry.resourceId, entry.jobId);
    if (entry.operation === deleteJobLabel) {
      if (!detail) return { state: "succeeded", message: "The MRS job record was deleted.", resourceId: entry.resourceId };
      return { state: "submitted", message: "The MRS job record deletion is still processing.", resourceId: entry.resourceId };
    }
    if (!detail) return { state: "failed", message: "The MRS job record could not be found; the termination could not be verified. Check the job list.", resourceId: entry.resourceId };
    const result = firstString([detail.job_result], "");
    if (!["FINISHED", "FAILED", "KILLED"].includes(String(detail.job_state))) return { state: "submitted", message: "The MRS job termination has no verified terminal state yet.", resourceId: entry.resourceId };
    if (result === "KILLED") return { state: "succeeded", message: "The MRS job was terminated.", resourceId: entry.resourceId };
    if (result === "SUCCEEDED" || result === "FAILED") return { state: "failed", message: `The MRS job finished with the ${result} result before the termination took effect.`, resourceId: entry.resourceId };
    return { state: "submitted", message: "The MRS job termination is still processing.", resourceId: entry.resourceId };
  },
  invalidationKeys: () => [cloudCacheKeys.listMrsClusters, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      const version = String(values.version);
      const names = await versionNames(session);
      if (!names.includes(version)) throw new ManagementInputError("The selected cluster version is no longer available for analysis clusters.");
      const meta = await offeredVersion(session, version);
      if (!meta) throw new ManagementInputError("The selected cluster version is no longer available for analysis clusters.");
      if (!hasDiskCatalog(meta)) throw new ManagementInputError("The selected cluster version does not expose a verifiable disk type catalog; typed cluster creation is unsupported for it.", 409);
      const components = values.components as string[];
      const offeredComponents = new Map(meta.components.filter((component) => component.visible && component.analysis).map((component) => [component.name, component]));
      if (!Array.isArray(components) || !components.length || new Set(components).size !== components.length || components.some((name) => !offeredComponents.has(name))) throw new ManagementInputError("The component selection is not offered for the selected cluster version.");
      if (components.some(name => offeredComponents.get(name)!.dependencies.some(dependency => !components.includes(dependency)))) throw new ManagementInputError("Select every native dependency required by the chosen components.");
      if (values.safeMode === "KERBEROS" && components.some(name => meta.kerberosExcluded.includes(name))) throw new ManagementInputError("The selected components are not offered in Kerberos mode.");
      if (!["SIMPLE", "KERBEROS"].includes(String(values.safeMode))) throw new ManagementInputError("Select a verified cluster mode.");
      const rootVolumeTypes = rootVolumeTypesOf(meta);
      if (!rootVolumeTypes.length) throw new ManagementInputError("The selected cluster version does not offer a root disk type for every node group; typed cluster creation is unsupported for it.", 409);
      if (!rootVolumeTypes.includes(String(values.rootVolumeType))) throw new ManagementInputError("The selected root disk type is not offered for the selected cluster version.");
      if (!meta.core!.diskTypes.includes(String(values.dataVolumeType))) throw new ManagementInputError("The selected Core data disk type is not offered for the selected cluster version.");
      const flavors = await flavorRows(session, version);
      const zone = flavors.find((row) => row.azCode === values.zone);
      if (!zone) throw new ManagementInputError("The selected availability zone is no longer available for this cluster version.");
      if (!zone.master.includes(String(values.masterSpec))) throw new ManagementInputError("The selected Master specification is not on sale in this availability zone.");
      if (!zone.core.includes(String(values.coreSpec))) throw new ManagementInputError("The selected Core specification is not on sale in this availability zone.");
      const coreNodes = wholeNumber(values.coreNodes, 1, 500, "Core node count");
      if (meta.core!.minNodeNum !== undefined && coreNodes < meta.core!.minNodeNum) throw new ManagementInputError(`The Core node count must be at least ${meta.core!.minNodeNum} for this cluster version.`);
      if (meta.core!.maxNodeNum !== undefined && coreNodes > meta.core!.maxNodeNum) throw new ManagementInputError(`The Core node count must not exceed ${meta.core!.maxNodeNum} for this cluster version.`);
      if (meta.master!.minNodeNum !== undefined && masterNodeNum < meta.master!.minNodeNum) throw new ManagementInputError("The fixed two-node Master group is below this version's minimum Master node count; typed cluster creation is unsupported for it.", 409);
      if (meta.master!.maxNodeNum !== undefined && masterNodeNum > meta.master!.maxNodeNum) throw new ManagementInputError("The fixed two-node Master group exceeds this version's maximum Master node count; typed cluster creation is unsupported for it.", 409);
      const rootVolumeSize = wholeNumber(values.rootVolumeSize, 10, 32768, "Root disk size");
      const minRootDiskSize = Math.max(meta.master!.minRootDiskSize ?? 0, meta.core!.minRootDiskSize ?? 0);
      if (minRootDiskSize > 0 && rootVolumeSize < minRootDiskSize) throw new ManagementInputError(`The root disk size must be at least ${minRootDiskSize} GB for this cluster version.`);
      const dataVolumeType = String(values.dataVolumeType);
      const dataVolumeSize = wholeNumber(values.dataVolumeSize, 100, 32000, "Core data disk size");
      if (meta.core!.minDiskSize !== undefined && dataVolumeSize < meta.core!.minDiskSize) throw new ManagementInputError(`The Core data disk size must be at least ${meta.core!.minDiskSize} GB for this cluster version.`);
      const dataVolumeCount = wholeNumber(values.dataVolumeCount, 1, 10, "Core data disk count");
      const minDataVolumeTotal = meta.core!.minDataVolumeTotalSize[dataVolumeType];
      if (minDataVolumeTotal !== undefined && dataVolumeSize * dataVolumeCount < minDataVolumeTotal) throw new ManagementInputError(`The total Core data disk capacity for ${dataVolumeType} must be at least ${minDataVolumeTotal} GB for this cluster version.`);
      const [subnets, groups] = await Promise.all([networkCatalog(() => listSubnetsForProject(session)), networkCatalog(() => listSecurityGroupsForProject(session))]);
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (["", "-"].includes(subnet.neutronNetworkId)) throw new ManagementInputError("The selected subnet does not expose the network ID that MRS requires.");
      const vpc = (await networkCatalog(() => listVpcsForProject(session))).find((item) => item.id === subnet.vpcId);
      if (!vpc || !vpc.name) throw new ManagementInputError("The subnet's VPC could not be verified in this project.");
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      assertMrsPassword(String(values.managerPassword), "admin", "The Manager administrator password");
      assertMrsPassword(String(values.nodeRootPassword), "root", "The node root password");
      if ((await clusterRows(session)).some((row) => clusterNameOf(row) === values.name)) throw new ManagementInputError("A cluster with this name already exists. Cluster names must be unique.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "mrs", `${v2(session)}/clusters`, { method: "POST", body: JSON.stringify({
        cluster_version: version,
        cluster_name: values.name,
        cluster_type: analysisType,
        charge_info: { charge_mode: "postPaid" },
        region: session.region,
        vpc_name: vpc.name,
        subnet_id: subnet.neutronNetworkId,
        subnet_name: subnet.name,
        components: components.join(","),
        availability_zone: values.zone,
        security_groups_id: values.securityGroup,
        safe_mode: values.safeMode,
        manager_admin_password: values.managerPassword,
        login_mode: "PASSWORD",
        node_root_password: values.nodeRootPassword,
        enterprise_project_id: values.enterpriseProjectId ?? "0",
        log_collection: values.logCollection === true ? 1 : 0,
        node_groups: [
          { group_name: masterGroup, node_num: masterNodeNum, node_size: values.masterSpec, root_volume: { type: values.rootVolumeType, size: rootVolumeSize }, data_volume_count: 0 },
          { group_name: coreGroup, node_num: coreNodes, node_size: values.coreSpec, root_volume: { type: values.rootVolumeType, size: rootVolumeSize }, data_volume: { type: dataVolumeType, size: dataVolumeSize }, data_volume_count: dataVolumeCount },
        ],
      }) });
      const clusterId = firstString([response.cluster_id], "");
      if (!clusterId) throw new Error("Huawei returned no MRS cluster ID. Check the cluster list before retrying.");
      return { message: "Cluster creation submitted. Deployment can take many minutes. Refresh operation history to check the original native cluster until it reaches a verified running state.", resourceId: clusterId, jobId: clusterId, asynchronous: true };
    }
    const cluster = resource!;
    if (operation === "inspect") {
      const record = await clusterRecord(session, cluster.id);
      const components = asArray(record.componentList).map(asRecord).map((component) => {
        const name = firstString([component.componentName, component.name], "");
        const version = firstString([component.componentVersion, component.version], "");
        return name ? (version && version !== "-" ? `${name} ${version}` : name) : "";
      }).filter(Boolean);
      const facts = [
        { label: "State", value: clusterStateOf(record) },
        { label: "Cluster version", value: firstString([record.clusterVersion, record.hadoopVersion], "-") },
        { label: "Billing mode", value: billingLabel(record) },
        { label: "Cluster mode", value: safeModeOf(record) || "Unknown" },
        { label: "Availability zone", value: firstString([record.azCode, record.az_code], "-") },
        { label: "VPC", value: [firstString([record.vpc], ""), firstString([record.vpcId, record.vpc_id], "")].filter(Boolean).join(" · ") || "-" },
        { label: "Subnet", value: [firstString([record.subnetName], ""), firstString([record.subnetId, record.subnet_id], "")].filter(Boolean).join(" · ") || "-" },
        { label: "Nodes", value: `${Number(record.totalNodeNum) || 0} total · ${Number(record.masterNodeNum) || 0} Master · ${Number(record.coreNodeNum) || 0} Core` },
        { label: "Master specification", value: firstString([record.masterNodeSize], "-") },
        { label: "Core specification", value: firstString([record.coreNodeSize], "-") },
        { label: "Core data disks", value: `${Number(record.coreDataVolumeCount) || 0} × ${Number(record.coreDataVolumeSize) || 0} GB ${firstString([record.coreDataVolumeType], "")}`.trim() },
        { label: "Manager private IP", value: firstString([record.internalIp], "Not reported") },
        ...(firstString([record.externalIp], "") ? [{ label: "Public IP", value: firstString([record.externalIp], "-") }] : []),
        { label: "Components", value: components.join(", ") || "-" },
        { label: "Created", value: timestampSeconds(record.createAt) },
        { label: "Updated", value: timestampSeconds(record.updateAt) },
        { label: "Enterprise project", value: firstString([record.enterpriseProjectId], "-") },
      ];
      return { message: "Current MRS cluster configuration.", facts };
    }
    if (operation === "rename") {
      const record = await clusterRecord(session, cluster.id);
      if (clusterStateOf(record) !== "running") throw new ManagementInputError("The cluster is not running. Renaming supports running clusters only.", 409);
      if ((await clusterRows(session)).some(row => clusterIdOf(row) !== cluster.id && clusterNameOf(row) === values.name)) throw new ManagementInputError("A cluster with this name already exists.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "mrs", `${v2(session)}/clusters/${encodeURIComponent(cluster.id)}/cluster-name`, { method: "PUT", body: JSON.stringify({ cluster_name: values.name }) });
      const result = firstString([response.result], "");
      if (result === "failed") throw new ManagementInputError("Huawei rejected the cluster rename.", 409);
      if (result !== "succeeded") throw new Error("Huawei did not confirm the MRS rename. Check the cluster name before retrying.");
      return { message: "Cluster renamed.", resourceId: cluster.id };
    }
    if (operation === "delete") {
      const record = await clusterRecord(session, cluster.id);
      const state = clusterStateOf(record);
      if (!deletable.includes(state)) throw new ManagementInputError(`This operation is unavailable while the cluster state is ${state}.`, 409);
      if (!isPayPerUse(record)) throw new ManagementInputError("This deletion supports pay-per-use clusters only and the cluster's billing mode could not be verified as pay-per-use (billingType 12). Prepaid clusters require the subscription cancellation workflow.", 409);
      if (clusterNameOf(record) !== cluster.name) throw new ManagementInputError("The cluster's current name does not match the selected resource. Refresh the inventory and confirm the exact name again.", 409);
      {
        const jobs = await jobRows(session, cluster.id);
        const active = jobs.filter(job => activeJobStates.includes(job.state));
        if (active.length) throw new ManagementInputError(`The cluster still has ${active.length} running job${active.length === 1 ? "" : "s"}. Stop every running job before deleting the cluster; deletion never interrupts them quietly.`, 409);
        if (jobs.some(job => !isFinishedJob(job))) throw new ManagementInputError("The cluster has jobs with unverified completion state. Review every job before deleting it.", 409);
      }
      await huaweiFetch(session, "mrs", `${v11(session)}/clusters/${encodeURIComponent(cluster.id)}`, { method: "DELETE" });
      return { message: "Cluster deletion submitted. The cluster and all data on its nodes are destroyed once deletion completes; the operation history verifies removal from the native cluster ID.", resourceId: cluster.id, jobId: cluster.id, asynchronous: true };
    }
    if (operation === "jobs") {
      const rows = await jobRows(session, cluster.id);
      return { message: `${rows.length} job executions loaded.`, facts: rows.map((job) => ({ label: `${job.name} · ${job.type} · ${displayJobState(job.state)}`, value: `Result ${displayJobResult(job.result)} · submitted ${jobTime(job.submitted)} · finished ${Number(job.finished) > 0 ? jobTime(job.finished) : "-"} · id ${job.id}` })) };
    }
    if (operation === "stop-job") {
      const record = await clusterRecord(session, cluster.id);
      assertJobCluster(record);
      const job = (await jobRows(session, cluster.id)).find((item) => item.id === values.job);
      if (!job) throw new ManagementInputError("Select a job of this cluster.", 404);
      if (!activeJobStates.includes(job.state) || job.result !== "UNDEFINED") throw new ManagementInputError("Only jobs that are still running can be stopped.", 409);
      await huaweiFetch(session, "mrs", `${v2(session)}/clusters/${encodeURIComponent(cluster.id)}/job-executions/${encodeURIComponent(String(values.job))}/kill`, { method: "POST" });
      return { message: "Job termination requested. The operation history verifies that the job record reaches the KILLED state.", resourceId: cluster.id, jobId: job.id, asynchronous: true };
    }
    if (operation === "delete-job") {
      const record = await clusterRecord(session, cluster.id);
      assertJobCluster(record);
      const job = (await jobRows(session, cluster.id)).find((item) => item.id === values.job);
      if (!job) throw new ManagementInputError("Select a job of this cluster.", 404);
      if (!isFinishedJob(job)) throw new ManagementInputError("Only finished jobs can have their records deleted. Stop the job first.", 409);
      await huaweiFetch(session, "mrs", `${v2(session)}/clusters/${encodeURIComponent(cluster.id)}/job-executions/batch-delete`, { method: "POST", body: JSON.stringify({ job_id_list: [values.job] }) });
      return { message: "Job record deletion accepted. The operation history verifies that the record is removed from the cluster's job history.", resourceId: cluster.id, jobId: job.id, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported MRS operation.");
  },
};
