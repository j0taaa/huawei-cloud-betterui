import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listTaurusDbInstancesForProject } from "@/lib/huawei/services/taurusdb";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const engineName = "gaussdb-mysql";
const modes = ["Cluster", "StandSingle"] as const;
type Mode = (typeof modes)[number];
const active = ["ACTIVE"];
const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const systemDatabases = ["mysql", "sys", "information_schema", "performance_schema"];
const instanceName: ManagementField = { key: "name", label: "Instance name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$", help: "4-64 characters starting with a letter; letters, digits, hyphens, and underscores." };
const passwordField: ManagementField = { key: "password", label: "Administrator password", type: "password", required: true, min: 8, max: 32, help: "8-32 characters combining at least three of lowercase, uppercase, digits, and the special characters ~!@#$%^*-_=+?,()&." };
const backupName: ManagementField = { key: "name", label: "Backup name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$" };
const databaseName: ManagementField = { key: "name", label: "Database name", required: true, min: 1, max: 64, pattern: "^[A-Za-z0-9_-]{1,64}$", help: "1-64 letters, digits, underscores, or hyphens; at most 10 hyphens in total." };
const dbUserName: ManagementField = { key: "name", label: "Database user name", required: true, min: 1, max: 32, pattern: "^[A-Za-z0-9_]{1,32}$", help: "1-32 letters, digits, or underscores." };
const commentField: ManagementField = { key: "comment", label: "Comment", type: "textarea", max: 512, help: "Up to 512 characters; the characters > ! < \\ \" ' = & and line breaks are not accepted." };
const maintenanceStarts = Array.from({ length: 20 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

function assertPassword(value: string, account?: string) {
  if (value.length < 8 || value.length > 32) throw new ManagementInputError("The password must be 8 to 32 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and special characters.");
  if (!/^[A-Za-z0-9~!@#$%^*\-_=+?,()&]+$/.test(value)) throw new ManagementInputError("The password uses characters outside the supported TaurusDB set (~!@#$%^*-_=+?,()&).");
  if (account && value === account) throw new ManagementInputError("The password cannot match the database user name.");
}

function assertComment(value: string) {
  if (/[<>!"'=&\\\r\n]/.test(value)) throw new ManagementInputError("The comment cannot contain the characters > ! < \\ \" ' = & or line breaks.");
}

function assertActive(record: Record<string, unknown>) {
  if (firstString([record.status], "") !== "ACTIVE") throw new ManagementInputError(`This operation is unavailable while the instance status is ${firstString([record.status], "UNKNOWN")}.`, 409);
}

function assertPayPerUse(record: Record<string, unknown>) {
  if (firstString([asRecord(record.charge_info).charge_mode], "") !== "postPaid") throw new ManagementInputError("This operation supports pay-per-use instances only. Prepaid instances require a subscription order workflow.", 409);
}

function gigabytes(display: string) {
  const size = Number(display.replace(" GB", ""));
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function parseOffering(value: unknown) {
  let offering: unknown;
  try { offering = JSON.parse(String(value)); } catch { return []; }
  return Array.isArray(offering) ? offering : [];
}

async function instanceRecord(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `/v3.1/${session.projectId}/instances?${new URLSearchParams({ id, limit: "1" })}`);
  const record = asRecord(asArray(body.instances)[0]);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("The instance was not found in this project.", 404);
  return record;
}

async function instanceDetail(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `/v3.1/${session.projectId}/instances/${encodeURIComponent(id)}`);
  const detail = asRecord(body.instance);
  if (firstString([detail.id], "") !== id) throw new ManagementInputError("Huawei returned a different TaurusDB instance.", 409);
  return detail;
}

async function versionRows(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `/v3/${session.projectId}/datastores/${engineName}`);
  return asArray(body.datastores).map(asRecord).map((row) => firstString([row.version], "")).filter(Boolean);
}

type FlavorRow = { specCode: string; vcpus: string; ramGb: number; version: string; mode: string; azStatus: Record<string, string> };

async function flavorRows(session: BetterUiSession, azMode: "single" | "multi" = "single"): Promise<FlavorRow[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `/v3/${session.projectId}/flavors/${engineName}?${new URLSearchParams({ availability_zone_mode: azMode })}`);
  return asArray(body.flavors).map(asRecord).flatMap((row) => {
    const specCode = firstString([row.spec_code], "");
    const version = firstString([row.version_name], "");
    const mode = firstString([row.instance_mode], "");
    if (!specCode || !version || !modes.includes(mode as Mode)) return [];
    return [{ specCode, vcpus: firstString([row.vcpus], "-"), ramGb: Number(row.ram) || 0, version, mode, azStatus: asRecord(row.az_status) as Record<string, string> }];
  });
}

async function backupRows(session: BetterUiSession, instanceId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "taurusdb", `/v3/${session.projectId}/backups?${new URLSearchParams({ instance_id: instanceId, offset: "0", limit: "100" })}`, { items: ["backups"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return asArray(body.backups).map(asRecord).filter((row) => firstString([row.instance_id], "") === instanceId);
}

async function databaseRows(session: BetterUiSession, instanceId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "taurusdb", `/v3/${session.projectId}/instances/${encodeURIComponent(instanceId)}/databases?${new URLSearchParams({ offset: "0", limit: "100" })}`, { items: ["databases"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return asArray(body.databases).map(asRecord);
}

async function charsetRows(session: BetterUiSession, instanceId: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `/v3/${session.projectId}/instances/${encodeURIComponent(instanceId)}/databases/charsets`);
  return asArray(body.charsets).map(String).filter(Boolean);
}

async function dbUserRows(session: BetterUiSession, instanceId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "taurusdb", `/v3/${session.projectId}/instances/${encodeURIComponent(instanceId)}/db-users?${new URLSearchParams({ offset: "0", limit: "100" })}`, { items: ["users"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return asArray(body.users).map(asRecord);
}

function nodeZones(detail: Record<string, unknown>) {
  return [...new Set(asArray(detail.nodes).map(asRecord).map((node) => firstString([node.az_code], "")))];
}

function compatibleFlavor(record: Record<string, unknown>, detail: Record<string, unknown>, flavor: FlavorRow) {
  const version = firstString([asRecord(record.datastore).version], "");
  const zones = nodeZones(detail);
  return Boolean(version && zones.length && firstString([record.type], "") === flavor.mode && zones.every((zone) => flavor.azStatus[zone] === "normal") && flavor.version === version);
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create instance", kind: "create", description: "Create one private pay-per-use TaurusDB instance from live versions, on-sale specifications, availability zones, and project networks. Storage scales automatically with data volume.", impact: "Compute is billed hourly while the instance exists and storage is billed by usage. No public IP is attached; applications connect through the selected subnet.", fields: [
    instanceName,
    { key: "offering", label: "Version, mode, and specification", type: "select", source: "offerings", required: true, help: "Single-AZ specifications currently on sale in this region." },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC. TaurusDB uses the subnet's network ID." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    passwordField,
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "rename", label: "Rename instance", kind: "update", description: "Change the instance name without restarting it.", fields: [instanceName] },
  { id: "restart", label: "Restart instance", kind: "action", description: "Restart the database engine.", fields: [], allowedStatuses: active, confirmation: true, impact: "Connections are closed and the instance is unavailable until the restart completes." },
  { id: "resize-flavor", label: "Change specification", kind: "action", description: "Move a pay-per-use instance to another on-sale specification compatible with its version and availability zones.", fields: [{ key: "offering", label: "New specification", type: "select", source: "resizeOfferings", required: true }], allowedStatuses: active, confirmation: true, impact: "The instance restarts on the new specification and connections are closed until the change completes. The new specification is billed immediately." },
  { id: "resize-storage", label: "Expand storage", kind: "action", description: "Raise the instance's storage capacity floor. TaurusDB storage also scales automatically with data volume.", fields: [{ key: "size", label: "New storage capacity (GB)", type: "number", required: true, min: 20, max: 128000, help: "A multiple of 10 GB that exceeds the current capacity, up to 128000 GB." }], allowedStatuses: active, confirmation: true, impact: "The expanded storage is billed immediately and cannot be reduced." },
  { id: "delete", label: "Delete instance", kind: "delete", description: "Permanently delete a pay-per-use instance and its data. Existing backups remain until their retention expires.", fields: [], confirmation: true, impact: "The instance and all stored data are permanently removed. Retained backups continue to incur storage charges." },
  { id: "topology", label: "View topology", kind: "inspect", description: "Show node roles, zones, addresses, and maintenance details of the live instance.", fields: [] },
  { id: "backups", label: "View backups", kind: "inspect", description: "List automatic and manual backups of this instance.", fields: [] },
  { id: "create-backup", label: "Create manual backup", kind: "action", description: "Start a full manual backup of the instance.", fields: [backupName, { key: "description", label: "Description", type: "textarea", max: 256, help: "Up to 256 characters; the characters > ! < \\ \" & ' = are not accepted." }], allowedStatuses: active, impact: "Backup storage is billed while the backup is retained." },
  { id: "delete-backup", label: "Delete manual backup", kind: "action", description: "Permanently delete one completed manual backup of this instance.", fields: [{ key: "backup", label: "Manual backup", type: "select", source: "backups", required: true }], confirmation: true, impact: "The backup is permanently removed and can no longer be restored." },
  { id: "backup-policy", label: "View backup policy", kind: "inspect", description: "Show the automatic backup retention, UTC window, and weekdays.", fields: [] },
  { id: "retention", label: "Set backup retention", kind: "update", description: "Replace the automatic backup policy's retention, UTC window, and weekdays.", fields: [
    { key: "keepDays", label: "Retention (days)", type: "number", required: true, min: 1, max: 732, defaultValue: 7 },
    { key: "backupWindow", label: "Backup window (UTC)", type: "select", source: "backupWindows", required: true },
    { key: "weekdays", label: "Backup weekdays", type: "list", source: "weekdays", required: true, max: 7 },
  ], allowedStatuses: active, confirmation: true, impact: "Automatic backups outside the new retention are removed. Reducing retention can permanently delete older backups." },
  { id: "databases", label: "View databases", kind: "inspect", description: "List databases on this instance.", fields: [], allowedStatuses: active },
  { id: "create-database", label: "Create database", kind: "action", description: "Create one database with an explicit character set.", fields: [databaseName, { key: "characterSet", label: "Character set", type: "select", source: "characterSets", required: true }, commentField], allowedStatuses: active },
  { id: "delete-database", label: "Delete database", kind: "action", description: "Permanently delete one non-system database.", fields: [{ key: "database", label: "Database", type: "select", source: "databases", required: true }], allowedStatuses: active, confirmation: true, impact: "The database and all data in it are permanently removed." },
  { id: "db-users", label: "View database users", kind: "inspect", description: "List database users and their host restrictions. Passwords are never returned.", fields: [], allowedStatuses: active },
  { id: "create-db-user", label: "Create database user", kind: "action", description: "Create one database account with a password and optional host restrictions.", fields: [dbUserName, { ...passwordField, label: "Database user password", help: "8-32 characters with at least three character groups; it cannot match the user name." }, { key: "hosts", label: "Allowed hosts", type: "list", max: 50, help: "One per line: % or IPv4 addresses with an optional trailing % suffix. Leave empty to allow all hosts." }, commentField], allowedStatuses: active },
  { id: "delete-db-user", label: "Delete database user", kind: "action", description: "Remove one non-administrator database account.", fields: [{ key: "user", label: "Database user", type: "select", source: "dbUsers", required: true }], allowedStatuses: active, confirmation: true, impact: "Applications using these credentials lose access immediately." },
  { id: "reset-db-password", label: "Reset database user password", kind: "action", description: "Set a new password for one non-administrator database account.", fields: [{ key: "user", label: "Database user", type: "select", source: "dbUsers", required: true }, { ...passwordField, label: "New password" }], allowedStatuses: active, confirmation: true, impact: "Applications using the old password lose access immediately." },
  { id: "reset-admin-password", label: "Reset administrator password", kind: "action", description: "Set a new password for the instance's administrator account.", fields: [{ ...passwordField, label: "New administrator password" }], allowedStatuses: active, confirmation: true, impact: "Applications using the old password lose access immediately." },
  { id: "security-group", label: "Change security group", kind: "update", description: "Move the instance to another security group in this project.", fields: [{ key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true }], allowedStatuses: active, confirmation: true, impact: "Network access rules change immediately. Clients blocked by the new group lose connectivity." },
  { id: "maintenance-window", label: "Set maintenance window", kind: "update", description: "Set the four-hour UTC whole-hour window during which maintenance operations run.", fields: [
    { key: "start", label: "Maintenance window start (UTC)", type: "select", required: true, choices: maintenanceStarts.map((hour) => ({ value: hour, label: hour })) },
  ], allowedStatuses: active, impact: "Maintenance operations such as version upgrades run during this window." },
];

export const taurusdbManagement: ManagementAdapter = {
  title: "TaurusDB",
  operations,
  inventory: async (session) => (await listTaurusDbInstancesForProject(session)).map((item) => ({
    id: item.id, name: item.name, status: item.status,
    values: { name: item.name, version: item.datastore.split(" ")[1] ?? "", flavor: item.flavor, size: gigabytes(item.storage), chargeMode: item.chargeMode, projectId: item.projectId },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [versions, flavors, subnets, groups] = await Promise.all([versionRows(session), flavorRows(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      const offerings = flavors.filter((flavor) => versions.includes(flavor.version)).map((flavor) => ({
        value: JSON.stringify([flavor.version, flavor.mode, flavor.specCode]),
        label: `${engineName} ${flavor.version} · ${flavor.mode === "Cluster" ? "Cluster (no read replicas)" : "Single node"} · ${flavor.specCode} · ${flavor.vcpus} vCPU · ${flavor.ramGb} GB RAM`,
      }));
      const zones = [...new Set(flavors.flatMap((flavor) => Object.entries(flavor.azStatus).filter(([, status]) => status === "normal").map(([zone]) => zone)))];
      return {
        offerings,
        zones: zones.map((zone) => ({ value: zone, label: zone })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
      };
    }
    if (operation === "retention") return {
      backupWindows: Array.from({ length: 23 }, (_, hour) => `${String(hour).padStart(2, "0")}:00-${String(hour + 1).padStart(2, "0")}:00`).map((value) => ({ value, label: `${value} UTC` })),
      weekdays: weekdayNames.map((name, index) => ({ value: String(index + 1), label: name })),
    };
    if (!resource) return {};
    if (operation === "delete-backup") {
      const rows = await backupRows(session, resource.id);
      return { backups: rows.filter((row) => String(row.type).toLowerCase() === "manual" && String(row.status).toUpperCase() === "COMPLETED").map((row) => ({ value: firstString([row.id], ""), label: `${firstString([row.name], "-")} · ${firstString([row.begin_time], "-")}` })) };
    }
    if (operation === "create-database") return { characterSets: (await charsetRows(session, resource.id)).map((name) => ({ value: name, label: name })) };
    if (operation === "delete-database") {
      const rows = await databaseRows(session, resource.id);
      return { databases: rows.map((row) => firstString([row.name], "")).filter(Boolean).filter((name) => !systemDatabases.includes(name.toLowerCase())).map((name) => ({ value: name, label: name })) };
    }
    if (operation === "delete-db-user" || operation === "reset-db-password") {
      const [rows, record] = await Promise.all([dbUserRows(session, resource.id), instanceRecord(session, resource.id)]);
      const admin = firstString([record.db_user_name], "");
      return { dbUsers: rows.filter((row) => firstString([row.name], "") !== admin).map((row) => ({ value: JSON.stringify([firstString([row.name], ""), firstString([row.host], "%")]), label: `${firstString([row.name], "-")} @ ${firstString([row.host], "-")}` })) };
    }
    if (operation === "resize-flavor") {
      const [record, detail] = await Promise.all([instanceRecord(session, resource.id), instanceDetail(session, resource.id)]);
      if (firstString([record.status], "") !== "ACTIVE") return {};
      const currentSpec = firstString([record.flavor_ref], "");
      const flavors = await flavorRows(session, nodeZones(detail).length > 1 ? "multi" : "single");
      return { resizeOfferings: flavors.filter((flavor) => flavor.specCode !== currentSpec && compatibleFlavor(record, detail, flavor)).map((flavor) => ({ value: flavor.specCode, label: `${flavor.specCode} · ${flavor.vcpus} vCPU · ${flavor.ramGb} GB RAM` })) };
    }
    if (operation === "security-group") {
      const groups = await listSecurityGroupsForProject(session);
      return { securityGroups: groups.map((group) => ({ value: group.id, label: group.name })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    if (!entry.jobId) throw new ManagementInputError("This operation has no TaurusDB cloud job to track.");
    const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `/v3/${session.projectId}/jobs?${new URLSearchParams({ id: entry.jobId })}`);
    const job = asRecord(response.job);
    if (firstString([job.id], "") !== entry.jobId) throw new ManagementInputError("Huawei returned a different TaurusDB job.");
    const status = firstString([job.status], "").toLowerCase();
    const resourceId = firstString([asRecord(job.instance).id], "") || undefined;
    if (entry.resourceId && resourceId && resourceId !== entry.resourceId) throw new ManagementInputError("The TaurusDB job does not belong to the selected instance.");
    if (status === "completed") return { state: "succeeded", message: "The TaurusDB cloud job completed successfully.", resourceId };
    if (status === "failed") return { state: "failed", message: firstString([job.fail_reason], "The TaurusDB cloud job failed. Review the instance status before retrying.") };
    return { state: "submitted", message: `The TaurusDB cloud job is ${status || "still processing"}.` };
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listTaurusDbInstances, cloudCacheKeys.summary, ...(resource ? [cloudCacheKeys.taurusDb(resource.id)] : [])],
  execute: async (session, operation, values, resource) => {
    const base = `/v3/${session.projectId}`;
    if (operation === "create") {
      const [version, mode, specCode] = parseOffering(values.offering).map(String);
      if (!version || !modes.includes(mode as Mode) || !specCode) throw new ManagementInputError("Select an available version, mode, and specification.");
      assertPassword(String(values.password));
      const [versions, flavors, subnets, groups] = await Promise.all([versionRows(session), flavorRows(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      if (!versions.includes(version)) throw new ManagementInputError("The selected database version is no longer available.");
      const flavor = flavors.find((item) => item.specCode === specCode && item.version === version && item.mode === mode);
      if (!flavor) throw new ManagementInputError("The selected version, mode, or specification is no longer available.");
      const zone = String(values.zone);
      if (flavor.azStatus[zone] !== "normal") throw new ManagementInputError("The selected specification is not on sale in this availability zone.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (["", "-"].includes(subnet.neutronNetworkId)) throw new ManagementInputError("The selected subnet does not expose the network ID that TaurusDB requires.");
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances`, { method: "POST", body: JSON.stringify({
        name: values.name,
        datastore: { type: engineName, version },
        mode,
        flavor_ref: specCode,
        region: session.region,
        vpc_id: subnet.vpcId,
        subnet_id: subnet.neutronNetworkId,
        security_group_id: values.securityGroup,
        password: values.password,
        availability_zone_mode: "single",
        master_availability_zone: zone,
        slave_count: 0,
        charge_info: { charge_mode: "postPaid" },
        enterprise_project_id: values.enterpriseProjectId ?? "0",
      }) });
      if (!asRecord(response.instance).id) throw new Error("Huawei returned no new instance ID. Check instances before retrying creation.");
      return { message: "Instance creation submitted. The instance is private and its storage scales with data volume; no public IP is attached.", resourceId: firstString([asRecord(response.instance).id], "") || undefined, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    const instance = resource!;
    if (operation === "rename") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/name`, { method: "PUT", body: JSON.stringify({ name: values.name }) });
      return { message: "Instance rename submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "restart") {
      const record = await instanceRecord(session, instance.id);
      assertActive(record);
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/restart`, { method: "POST", body: JSON.stringify({}) });
      return { message: "Instance restart submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "resize-flavor") {
      const [record, detail] = await Promise.all([instanceRecord(session, instance.id), instanceDetail(session, instance.id)]);
      assertPayPerUse(record);
      assertActive(record);
      const specCode = String(values.offering);
      if (specCode === firstString([record.flavor_ref], "")) throw new ManagementInputError("The new specification must differ from the current one.", 409);
      const flavors = await flavorRows(session, nodeZones(detail).length > 1 ? "multi" : "single");
      if (!flavors.some((flavor) => flavor.specCode === specCode && compatibleFlavor(record, detail, flavor))) throw new ManagementInputError("The selected specification is no longer available for this instance.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/action`, { method: "POST", body: JSON.stringify({ resize_flavor: { spec_code: specCode } }) });
      return { message: "Specification change submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "resize-storage") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      assertActive(record);
      const size = Number(values.size);
      if (size < 20 || size > 128000 || size % 10) throw new ManagementInputError("The new capacity must be between 20 and 128000 GB in multiples of 10 GB.");
      const current = Number(asRecord(record.volume).size) || 0;
      if (!current) throw new ManagementInputError("The instance's current storage could not be loaded. Retry the operation.");
      if (size <= current) throw new ManagementInputError(`The new capacity must exceed the current ${current} GB storage.`);
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/volume/extend`, { method: "POST", body: JSON.stringify({ size }) });
      const target = Number(response.size) || size;
      return { message: `Storage expansion accepted. The capacity scales toward ${target} GB.`, resourceId: instance.id, asynchronous: true };
    }
    if (operation === "delete") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}`, { method: "DELETE" });
      return { message: "Instance deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "topology") {
      const detail = await instanceDetail(session, instance.id);
      const facts = asArray(detail.nodes).map(asRecord).map((node) => ({
        label: `${firstString([node.name], "-")} · ${firstString([node.type], "-")}`,
        value: [firstString([node.status], ""), firstString([node.az_code], ""), asArray(node.private_read_ips).map(String).join(", ")].filter(Boolean).join(" · ") || "No details reported",
      }));
      facts.push(
        { label: "Availability zone mode", value: firstString([detail.az_mode], "-") },
        { label: "Primary availability zone", value: firstString([detail.master_az_code], "-") },
        { label: "Maintenance window", value: firstString([detail.maintenance_window], "-") },
        { label: "Port", value: firstString([detail.port], "-") },
        { label: "Time zone", value: firstString([detail.time_zone], "-") },
      );
      return { message: `${asArray(detail.nodes).length} topology entries loaded.`, facts };
    }
    if (operation === "backups") {
      const rows = await backupRows(session, instance.id);
      return { message: `${rows.length} backups loaded.`, facts: rows.map((row) => ({ label: `${firstString([row.name], "-")} · ${firstString([row.type], "-")} · ${firstString([row.status], "-")}`, value: `${firstString([row.begin_time], "-")} · ${Number(row.size) || 0} MB · ${firstString([row.id], "-")}` })) };
    }
    if (operation === "create-backup") {
      const record = await instanceRecord(session, instance.id);
      assertActive(record);
      const description = String(values.description ?? "").trim();
      if (/[><!"'&=\\]/.test(description)) throw new ManagementInputError("The description cannot contain the characters > ! < \\ \" & ' =.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/backups/create`, { method: "POST", body: JSON.stringify({ instance_id: instance.id, name: values.name, ...(description ? { description } : {}) }) });
      return { message: "Manual backup creation submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete-backup") {
      const rows = await backupRows(session, instance.id);
      const backup = rows.find((row) => firstString([row.id], "") === values.backup);
      if (!backup) throw new ManagementInputError("Select a manual backup of this instance.", 404);
      if (String(backup.type).toLowerCase() !== "manual") throw new ManagementInputError("Only manual backups can be deleted.", 409);
      if (String(backup.status).toUpperCase() !== "COMPLETED") throw new ManagementInputError("Only completed backups can be deleted.", 409);
      await huaweiFetch(session, "taurusdb", `${base}/backups/${encodeURIComponent(String(values.backup))}`, { method: "DELETE" });
      return { message: "Manual backup deletion accepted.", resourceId: instance.id };
    }
    if (operation === "backup-policy") {
      const body = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/backups/policy`);
      const policy = asRecord(body.backup_policy);
      const days = firstString([policy.period], "").split(",").map((day) => weekdayNames[Number(day) - 1] ?? day).filter(Boolean).join(", ");
      return { message: "Backup policy loaded.", facts: [
        { label: "Retention", value: `${policy.keep_days ?? "-"} days` },
        { label: "Backup window (UTC)", value: firstString([policy.start_time], "-") },
        { label: "Backup weekdays", value: days || "Not set" },
      ] };
    }
    if (operation === "retention") {
      const record = await instanceRecord(session, instance.id);
      assertActive(record);
      const keepDays = Number(values.keepDays);
      if (keepDays < 1 || keepDays > 732) throw new ManagementInputError("Retention must be 1 to 732 days.");
      const weekdays = values.weekdays as string[];
      if (!weekdays.length || weekdays.some((day) => !/^[1-7]$/.test(day))) throw new ManagementInputError("Select at least one backup weekday.");
      await huaweiFetch(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/backups/policy/update`, { method: "PUT", body: JSON.stringify({ backup_policy: { keep_days: keepDays, start_time: values.backupWindow, period: [...weekdays].sort((a, b) => Number(a) - Number(b)).join(",") } }) });
      return { message: "Backup retention policy updated.", resourceId: instance.id };
    }
    if (operation === "databases") {
      const rows = await databaseRows(session, instance.id);
      return { message: `${rows.length} databases loaded.`, facts: rows.map((row) => ({ label: firstString([row.name], "-"), value: [firstString([row.charset], ""), firstString([row.comment], "")].filter(Boolean).join(" · ") || "No character set reported" })) };
    }
    if (operation === "create-database") {
      const record = await instanceRecord(session, instance.id);
      assertActive(record);
      const name = String(values.name);
      if ((name.match(/-/g)?.length ?? 0) > 10) throw new ManagementInputError("Database names can contain at most 10 hyphens in total.");
      const comment = String(values.comment ?? "").trim();
      if (comment) assertComment(comment);
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/databases`, { method: "POST", body: JSON.stringify({ databases: [{ name, character_set: values.characterSet, ...(comment ? { comment } : {}) }] }) });
      return { message: "Database creation submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete-database") {
      const record = await instanceRecord(session, instance.id);
      assertActive(record);
      const name = String(values.database);
      if (systemDatabases.includes(name.toLowerCase())) throw new ManagementInputError("System databases cannot be deleted.", 409);
      const rows = await databaseRows(session, instance.id);
      if (!rows.some((row) => firstString([row.name], "") === name)) throw new ManagementInputError("The selected database was not found on this instance.", 404);
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/databases`, { method: "DELETE", body: JSON.stringify({ databases: [name] }) });
      return { message: "Database deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "db-users") {
      const rows = await dbUserRows(session, instance.id);
      return { message: `${rows.length} database users loaded.`, facts: rows.map((row) => ({ label: `${firstString([row.name], "-")} @ ${firstString([row.host], "-")}`, value: [firstString([row.comment], ""), asArray(row.databases).map(asRecord).map((database) => firstString([database.name], "")).filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No restrictions reported" })) };
    }
    if (operation === "create-db-user") {
      const record = await instanceRecord(session, instance.id);
      assertActive(record);
      const name = String(values.name);
      assertPassword(String(values.password), name);
      const hosts = values.hosts as string[] | undefined;
      if (hosts?.length) for (const host of hosts) { const parts = host.split("."); const wildcard = parts.at(-1) === "%"; const octets = wildcard ? parts.slice(0, -1) : parts; if (host !== "%" && ((!wildcard && parts.length !== 4) || (wildcard && (parts.length < 2 || parts.length > 4)) || octets.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255))) throw new ManagementInputError("Host entries must be % or IPv4 addresses with an optional trailing % component."); }
      const comment = String(values.comment ?? "").trim();
      if (comment) assertComment(comment);
      const rows = await dbUserRows(session, instance.id);
      const requestedHosts = hosts?.length ? hosts : ["%"];
      if (requestedHosts.some((host) => rows.some((row) => firstString([row.name], "") === name && firstString([row.host], "%") === host))) throw new ManagementInputError("A database user with this name and host already exists on this instance.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/db-users`, { method: "POST", body: JSON.stringify({ users: [{ name, password: values.password, ...(hosts?.length ? { hosts } : {}), ...(comment ? { comment } : {}) }] }) });
      return { message: "Database user creation submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete-db-user") {
      const [record, rows] = await Promise.all([instanceRecord(session, instance.id), dbUserRows(session, instance.id)]);
      assertActive(record);
      const [name, host] = parseOffering(values.user).map(String);
      if (!name || !host) throw new ManagementInputError("Select a database user of this instance.");
      if (name === firstString([record.db_user_name], "")) throw new ManagementInputError("The built-in administrator account cannot be deleted.", 409);
      if (!rows.some((row) => firstString([row.name], "") === name && firstString([row.host], "%") === host)) throw new ManagementInputError("The selected database user was not found on this instance.", 404);
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/db-users`, { method: "DELETE", body: JSON.stringify({ users: [{ name, host }] }) });
      return { message: "Database user deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "reset-db-password") {
      const rows = await dbUserRows(session, instance.id);
      const [name, host] = parseOffering(values.user).map(String);
      if (!name || !host) throw new ManagementInputError("Select a database user of this instance.");
      if (!rows.some((row) => firstString([row.name], "") === name && firstString([row.host], "%") === host)) throw new ManagementInputError("The selected database user was not found on this instance.", 404);
      assertPassword(String(values.password), name);
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/db-users/password`, { method: "PUT", body: JSON.stringify({ users: [{ name, host, password: values.password }] }) });
      return { message: "Database user password reset submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "reset-admin-password") {
      const record = await instanceRecord(session, instance.id);
      assertActive(record);
      assertPassword(String(values.password));
      await huaweiFetch(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/password`, { method: "POST", body: JSON.stringify({ password: values.password }) });
      return { message: "Administrator password reset accepted.", resourceId: instance.id };
    }
    if (operation === "security-group") {
      const [record, groups] = await Promise.all([instanceRecord(session, instance.id), listSecurityGroupsForProject(session)]);
      assertActive(record);
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      if (firstString([record.security_group_id], "") === values.securityGroup) throw new ManagementInputError("The instance already uses this security group.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/security-group`, { method: "PUT", body: JSON.stringify({ security_group_id: values.securityGroup }) });
      return { message: "Security group change submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "maintenance-window") {
      const record = await instanceRecord(session, instance.id);
      assertActive(record);
      const start = String(values.start);
      const startHour = maintenanceStarts.indexOf(start);
      if (startHour < 0) throw new ManagementInputError("Select a whole-hour UTC start between 00:00 and 19:00.");
      const end = `${String(startHour + 4).padStart(2, "0")}:00`;
      await huaweiFetch(session, "taurusdb", `${base}/instances/${encodeURIComponent(instance.id)}/ops-window`, { method: "PUT", body: JSON.stringify({ start_time: start, end_time: end }) });
      return { message: `Maintenance window updated to ${start}-${end} UTC.`, resourceId: instance.id };
    }
    throw new ManagementInputError("Unsupported TaurusDB operation.");
  },
};
