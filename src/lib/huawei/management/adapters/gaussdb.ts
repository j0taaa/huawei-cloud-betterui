import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listGaussDbInstancesForProject } from "@/lib/huawei/services/gaussdb";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

// Verified against the cached huaweicloudsdkgaussdbforopengauss v3 SDK: the gaussdb service key
// resolves to the gaussdb-opengauss endpoint, provisioning uses the v3.2 deployment API, and
// mutations return v3 job IDs that the native jobs endpoint can poll.
const engineName = "GaussDB";
const haMode = "centralization_standard";
const instanceMode = "enterprise";
const active = ["ACTIVE"];
const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const systemUsers = ["rdsadmin", "rdsmetric", "rdsbackup", "rdsrepl"];
const instanceName: ManagementField = { key: "name", label: "Instance name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$", help: "4-64 characters starting with a letter; letters, digits, hyphens, and underscores." };
const passwordField: ManagementField = { key: "password", label: "Administrator password", type: "password", required: true, min: 8, max: 32, help: "8-32 characters combining at least three of lowercase, uppercase, digits, and the special characters ~!@#%^*-_=+?,." };
const backupName: ManagementField = { key: "name", label: "Backup name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$", help: "4-64 characters starting with a letter; letters, digits, hyphens, and underscores." };
const dbUserName: ManagementField = { key: "name", label: "Database user name", required: true, min: 1, max: 63, pattern: "^[A-Za-z_][A-Za-z0-9_]{0,62}$", help: "1-63 letters, digits, or underscores, starting with a letter or underscore; it cannot start with pg and cannot match system users." };

function assertPassword(value: string, account?: string) {
  if (value.length < 8 || value.length > 32) throw new ManagementInputError("The password must be 8 to 32 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and special characters.");
  if (!/^[A-Za-z0-9~!@#%^*\-_=?+,]+$/.test(value)) throw new ManagementInputError("The password uses characters outside the supported GaussDB set (~!@#%^*-_=+?,).");
  if (account && (value === account || value === [...account].reverse().join(""))) throw new ManagementInputError("The password cannot match the account name or its reverse.");
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
  const body = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `/v3/${session.projectId}/instances?${new URLSearchParams({ id, limit: "1" })}`);
  const record = asRecord(asArray(body.instances)[0]);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("The instance was not found in this project.", 404);
  return record;
}

async function versionRows(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "gaussdb", `/v3.2/${session.projectId}/datastore/versions?${new URLSearchParams({ limit: "100" })}`, { items: ["database_versions"], kind: "offset", parameter: "offset", size: 100, total: ["total"] });
  return asArray(body.database_versions).map(asRecord).map((row) => firstString([row.software_version], "")).filter(Boolean);
}

type FlavorRow = { version: string; specCode: string; vcpus: string; ramGb: string; groupType: string; azStatus: Record<string, string> };

async function flavorRows(session: BetterUiSession, version: string): Promise<FlavorRow[]> {
  const body = await huaweiList<Record<string, unknown>>(session, "gaussdb", `/v3.2/${session.projectId}/flavors?${new URLSearchParams({ version, ha_mode: haMode, limit: "100" })}`, { items: ["flavors"], kind: "offset", parameter: "offset", size: 100, total: ["total"] });
  return asArray(body.flavors).map(asRecord).flatMap((flavor) => {
    const specCode = firstString([flavor.spec_code], "");
    if (!specCode) return [];
    return [{ version, specCode, vcpus: firstString([flavor.vcpus], "-"), ramGb: firstString([flavor.ram], "-"), groupType: firstString([flavor.group_type], ""), azStatus: asRecord(flavor.az_status) as Record<string, string> }];
  });
}

type StorageRow = { name: string; azStatus: Record<string, string>; groupTypes: string[] };

async function storageRows(session: BetterUiSession, version: string): Promise<StorageRow[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `/v3/${session.projectId}/storage-type?${new URLSearchParams({ version, ha_mode: haMode })}`);
  return asArray(body.storage_type).map(asRecord).flatMap((storage) => {
    const name = firstString([storage.name], "");
    if (!name) return [];
    return [{ name, azStatus: asRecord(storage.az_status) as Record<string, string>, groupTypes: asArray(storage.support_compute_group_type).map(String) }];
  });
}

// The provider may ignore the instance filter, so ownership is re-checked against the parent ID.
async function backupRows(session: BetterUiSession, instanceId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "gaussdb", `/v3.2/${session.projectId}/backups?${new URLSearchParams({ instance_id: instanceId, limit: "100" })}`, { items: ["backups"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return asArray(body.backups).map(asRecord).filter((row) => firstString([row.instance_id], "") === instanceId);
}

async function dbUserRows(session: BetterUiSession, instanceId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "gaussdb", `/v3/${session.projectId}/instances/${encodeURIComponent(instanceId)}/db-users?${new URLSearchParams({ limit: "100" })}`, { items: ["users"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return asArray(body.users).map(asRecord).filter((row) => firstString([row.name], ""));
}

function assertPayPerUse(record: Record<string, unknown>) {
  if (firstString([asRecord(record.charge_info).charge_mode], "") !== "postPaid") throw new ManagementInputError("This operation supports pay-per-use instances only. Prepaid instances require a subscription order workflow.", 409);
}

// Distributed (sharded) and basic/ecology edition workflows are explicit gaps of this draft.
function assertCentralizedEnterprise(record: Record<string, unknown>) {
  if (firstString([record.type], "") !== "Ha") throw new ManagementInputError("This operation supports centralized instances only. Distributed instance workflows are not part of this draft.", 409);
  const mode = firstString([record.instance_mode], "");
  if (mode !== instanceMode) throw new ManagementInputError(mode ? `This operation supports enterprise edition instances only; this instance reports the ${mode} edition.` : "The instance edition could not be verified, so this operation is unavailable.", 409);
}

function recordVersion(record: Record<string, unknown>) {
  return firstString([asRecord(record.datastore).version], "");
}

function recordZones(record: Record<string, unknown>) {
  return [...new Set(asArray(record.nodes).map(asRecord).map((node) => firstString([node.availability_zone], "")))];
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create instance", kind: "create", description: "Create one private pay-per-use centralized enterprise edition GaussDB instance from live version, specification, storage, zone, and network choices.", impact: "Compute and storage are billed hourly while the instance exists. No public IP is attached; applications connect through the selected subnet.", fields: [
    instanceName,
    { key: "offering", label: "Version and specification", type: "select", source: "offerings", required: true, help: "Centralized specifications currently on sale in this region." },
    { key: "storageType", label: "Storage type", type: "select", source: "storageTypes", required: true },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true, help: "All three nodes deploy in the selected zone." },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC. GaussDB uses the subnet's network ID." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    { key: "diskSize", label: "Disk capacity (GB)", type: "number", required: true, min: 40, max: 16384, defaultValue: 40, help: "40-16384 GB in multiples of 40 GB." },
    passwordField,
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "rename", label: "Rename instance", kind: "update", description: "Change the instance name without restarting it.", fields: [instanceName] },
  { id: "restart", label: "Restart instance", kind: "action", description: "Restart the database engine.", fields: [], allowedStatuses: active, confirmation: true, impact: "Connections are closed and the instance is unavailable until the restart completes." },
  { id: "resize-flavor", label: "Change specification", kind: "action", description: "Move a pay-per-use centralized enterprise edition instance to another on-sale specification.", fields: [{ key: "offering", label: "New specification", type: "select", source: "resizeOfferings", required: true }], allowedStatuses: active, confirmation: true, impact: "The instance restarts on the new specification and connections are closed until the change completes. The new specification is billed immediately." },
  { id: "resize-storage", label: "Expand storage", kind: "action", description: "Increase the disk capacity of a pay-per-use centralized enterprise edition instance.", fields: [{ key: "size", label: "New disk capacity (GB)", type: "number", required: true, min: 40, max: 16384, help: "A multiple of 40 GB between 40 and 16384 GB that exceeds the current capacity." }], allowedStatuses: active, confirmation: true, impact: "The expanded storage is billed immediately and cannot be reduced." },
  { id: "delete", label: "Delete instance", kind: "delete", description: "Permanently delete a pay-per-use instance and its data. Existing backups remain until their retention expires.", fields: [], confirmation: true, impact: "The instance and all stored data are permanently removed. Retained backups continue to incur storage charges." },
  { id: "backups", label: "View backups", kind: "inspect", description: "List manual and automatic backups of this instance.", fields: [] },
  { id: "create-backup", label: "Create manual backup", kind: "action", description: "Start a full manual backup of the instance.", fields: [backupName, { key: "description", label: "Description", type: "textarea", max: 256, help: "Up to 256 characters; the characters > ! < \" & ' = are not accepted." }], allowedStatuses: active, impact: "Backup storage is billed while the backup is retained." },
  { id: "delete-backup", label: "Delete manual backup", kind: "action", description: "Permanently delete one completed manual backup of this instance.", fields: [{ key: "backup", label: "Manual backup", type: "select", source: "backups", required: true }], confirmation: true, impact: "The backup is permanently removed and can no longer be restored." },
  { id: "backup-policy", label: "View backup policy", kind: "inspect", description: "Show the automatic backup retention, UTC window, and weekdays.", fields: [] },
  { id: "retention", label: "Set backup retention", kind: "update", description: "Replace the automatic backup policy's retention, UTC window, and weekdays. Other policy settings keep their current values.", fields: [
    { key: "keepDays", label: "Retention (days)", type: "number", required: true, min: 1, max: 732, defaultValue: 7 },
    { key: "backupWindow", label: "Backup window (UTC)", type: "select", source: "backupWindows", required: true },
    { key: "weekdays", label: "Backup weekdays", type: "list", source: "weekdays", required: true, max: 7 },
  ], allowedStatuses: active, confirmation: true, impact: "Automatic backups outside the new retention are removed. Reducing retention can permanently delete older backups." },
  { id: "topology", label: "View topology", kind: "inspect", description: "Show the live node and component roles, zones, and statuses.", fields: [] },
  { id: "db-users", label: "View database users", kind: "inspect", description: "List database users and their attributes. Passwords are never returned.", fields: [], allowedStatuses: active },
  { id: "create-db-user", label: "Create database user", kind: "action", description: "Create one database account with a password.", fields: [dbUserName, { ...passwordField, label: "Database user password", help: "8-32 characters with at least three character groups; it cannot match the user name or its reverse." }], allowedStatuses: active },
  { id: "reset-db-user-password", label: "Reset database user password", kind: "action", description: "Set a new password for one database account of this instance.", fields: [{ key: "user", label: "Database user", type: "select", source: "dbUsers", required: true }, { ...passwordField, label: "New password", help: "8-32 characters with at least three character groups; it cannot match the user name or its reverse." }], allowedStatuses: active, confirmation: true, impact: "Applications using the old password lose access immediately." },
  { id: "reset-password", label: "Reset administrator password", kind: "action", description: "Set a new password for the instance's administrator account.", fields: [{ ...passwordField, label: "New administrator password" }], allowedStatuses: active, confirmation: true, impact: "Applications using the old password lose access immediately." },
];

export const gaussdbManagement: ManagementAdapter = {
  title: "GaussDB",
  operations,
  inventory: async (session) => (await listGaussDbInstancesForProject(session)).map((item) => ({
    id: item.id, name: item.name, status: item.status,
    values: { name: item.name, version: item.datastore.split(" ")[1] ?? "", size: gigabytes(item.storage), storageType: item.storageType, chargeMode: item.chargeMode, type: item.type, mode: item.mode, projectId: item.projectId },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const versions = await versionRows(session);
      // Query flavors and storage per live version so every offered version/spec pair and
      // version/storage pair comes from the provider instead of being assembled locally.
      const [flavorPages, storagePages, subnets, groups] = await Promise.all([
        Promise.allSettled(versions.map((version) => flavorRows(session, version))),
        Promise.allSettled(versions.map((version) => storageRows(session, version))),
        listSubnetsForProject(session),
        listSecurityGroupsForProject(session),
      ]);
      for (const page of [...flavorPages, ...storagePages]) if (page.status === "rejected") throw page.reason;
      const flavors = flavorPages.flatMap((page) => (page.status === "fulfilled" ? page.value : []));
      const storages = storagePages.flatMap((page) => (page.status === "fulfilled" ? page.value : []));
      const zones = [...new Set(flavors.flatMap((flavor) => Object.entries(flavor.azStatus).filter(([, status]) => status === "normal").map(([zone]) => zone)))];
      return {
        offerings: flavors.map((flavor) => ({ value: JSON.stringify([flavor.version, flavor.specCode]), label: `${engineName} ${flavor.version} · ${flavor.specCode} · ${flavor.vcpus} vCPU · ${flavor.ramGb} GB RAM` })),
        storageTypes: [...new Set(storages.map((storage) => storage.name))].map((name) => ({ value: name, label: name })),
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
    if (operation === "reset-db-user-password") {
      const rows = await dbUserRows(session, resource.id);
      return { dbUsers: rows.map((row) => ({ value: firstString([row.name], ""), label: firstString([row.name], "-") })) };
    }
    if (operation === "resize-flavor") {
      const record = await instanceRecord(session, resource.id);
      assertPayPerUse(record);
      assertCentralizedEnterprise(record);
      const version = recordVersion(record);
      const current = firstString([record.flavor_ref], "");
      const zones = recordZones(record);
      if (!version || !zones.length) return {};
      const flavors = await flavorRows(session, version);
      return { resizeOfferings: flavors.filter((flavor) => flavor.specCode !== current && zones.every((zone) => flavor.azStatus[zone] === "normal")).map((flavor) => ({ value: flavor.specCode, label: `${flavor.specCode} · ${flavor.vcpus} vCPU · ${flavor.ramGb} GB RAM` })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    const response = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `/v3/${session.projectId}/jobs?${new URLSearchParams({ id: entry.jobId! })}`);
    const job = asRecord(response.job);
    const jobId = firstString([job.id], "");
    if (!entry.jobId || jobId !== entry.jobId) throw new ManagementInputError("Huawei returned a different GaussDB job.");
    const status = String(job.status ?? "").toLowerCase();
    const resourceId = firstString([asRecord(job.instance).id], "") || undefined;
    if (entry.resourceId && resourceId && entry.resourceId !== resourceId) throw new ManagementInputError("The GaussDB job does not belong to the selected instance.");
    if (status === "completed") return { state: "succeeded", message: "The GaussDB cloud job completed successfully.", resourceId };
    if (status === "failed") return { state: "failed", message: "The GaussDB cloud job failed. Review the instance status before retrying." };
    return { state: "submitted", message: "The GaussDB cloud job is still processing." };
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listGaussDbInstances, cloudCacheKeys.summary, ...(resource ? [cloudCacheKeys.gaussDb(resource.id)] : [])],
  execute: async (session, operation, values, resource) => {
    const base = `/v3/${session.projectId}`;
    if (operation === "create") {
      const [version, specCode] = parseOffering(values.offering).map(String);
      if (!version || !specCode) throw new ManagementInputError("Select an available version and specification.");
      const diskSize = Number(values.diskSize);
      if (diskSize < 40 || diskSize > 16384 || diskSize % 40) throw new ManagementInputError("Disk capacity must be between 40 and 16384 GB in multiples of 40 GB.");
      assertPassword(String(values.password));
      const versions = await versionRows(session);
      if (!versions.includes(version)) throw new ManagementInputError("The selected database version is no longer available.");
      const [flavors, storages, subnets, groups] = await Promise.all([flavorRows(session, version), storageRows(session, version), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      const flavor = flavors.find((item) => item.specCode === specCode);
      if (!flavor) throw new ManagementInputError("The selected version or specification is no longer available.");
      const storage = storages.find((item) => item.name === values.storageType);
      if (!storage) throw new ManagementInputError("The selected storage type is unavailable for this version.");
      const zone = String(values.zone);
      if (flavor.azStatus[zone] !== "normal") throw new ManagementInputError("The selected specification is not on sale in the availability zone.");
      if (String(storage.azStatus[zone] ?? "") !== "normal") throw new ManagementInputError("The selected storage type is not on sale in the availability zone.");
      if (storage.groupTypes.length && (!flavor.groupType || !storage.groupTypes.includes(flavor.groupType))) throw new ManagementInputError("The selected storage type does not support this specification's performance type.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (["", "-"].includes(subnet.neutronNetworkId)) throw new ManagementInputError("The selected subnet does not expose the network ID that GaussDB requires.");
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `/v3.2/${session.projectId}/instances`, { method: "POST", body: JSON.stringify({
        name: values.name,
        datastore: { type: engineName, version },
        ha: { mode: haMode, replication_mode: "sync", instance_mode: instanceMode },
        flavor_ref: specCode,
        volume: { type: storage.name, size: diskSize },
        region: session.region,
        availability_zone: [zone, zone, zone].join(","),
        vpc_id: subnet.vpcId,
        subnet_id: subnet.neutronNetworkId,
        security_group_id: values.securityGroup,
        password: values.password,
        charge_info: { charge_mode: "postPaid" },
        enterprise_project_id: values.enterpriseProjectId ?? "0",
      }) });
      if (!asRecord(response.instance).id) throw new Error("Huawei returned no new instance ID. Check instances before retrying creation.");
      return { message: "Instance creation submitted. The instance is private; attach a public IP separately if needed.", resourceId: firstString([asRecord(response.instance).id], "") || undefined, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    const instance = resource!;
    if (operation === "rename") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/name`, { method: "PUT", body: JSON.stringify({ name: values.name }) });
      return { message: "Instance rename submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "restart") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/restart`, { method: "POST" });
      return { message: "Instance restart submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "resize-flavor") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      assertCentralizedEnterprise(record);
      const specCode = String(values.offering);
      const current = firstString([record.flavor_ref], "");
      if (specCode === current) throw new ManagementInputError("The new specification must differ from the current one.", 409);
      const version = recordVersion(record);
      const zones = recordZones(record);
      if (!zones.length || zones.some(zone => !zone)) throw new ManagementInputError("The current node availability zones could not be verified.");
      const flavors = version ? await flavorRows(session, version) : [];
      if (!flavors.some((flavor) => flavor.specCode === specCode && zones.every((zone) => flavor.azStatus[zone] === "normal"))) throw new ManagementInputError("The selected specification is no longer available for this instance.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/flavor`, { method: "PUT", body: JSON.stringify({ flavor_ref: specCode }) });
      return { message: "Specification change submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "resize-storage") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      assertCentralizedEnterprise(record);
      const size = Number(values.size);
      if (size < 40 || size > 16384 || size % 40) throw new ManagementInputError("The new capacity must be between 40 and 16384 GB in multiples of 40 GB.");
      const current = Number(asRecord(record.volume).size) || 0;
      if (!current) throw new ManagementInputError("The instance's current storage could not be loaded. Retry the operation.");
      if (size <= current) throw new ManagementInputError(`The new capacity must exceed the current ${current} GB disk.`);
      const response = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/action`, { method: "POST", body: JSON.stringify({ enlarge_volume: { size } }) });
      return { message: "Storage expansion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      const response = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}`, { method: "DELETE" });
      return { message: "Instance deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "backups") {
      const rows = await backupRows(session, instance.id);
      return { message: `${rows.length} backups loaded.`, facts: rows.map((row) => ({ label: `${firstString([row.name], "-")} · ${firstString([row.type], "-")} · ${firstString([row.status], "-")}`, value: `${firstString([row.begin_time], "-")} · ${Number(row.size) || 0} MB · ${firstString([row.id], "-")}` })) };
    }
    if (operation === "create-backup") {
      const description = String(values.description ?? "").trim();
      if (/[><!"'&=]/.test(description)) throw new ManagementInputError("The description cannot contain the characters > ! < \" & ' =.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `${base}/backups`, { method: "POST", body: JSON.stringify({ instance_id: instance.id, name: values.name, ...(description ? { description } : {}) }) });
      return { message: "Manual backup creation submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete-backup") {
      const rows = await backupRows(session, instance.id);
      const backup = rows.find((row) => firstString([row.id], "") === values.backup);
      if (!backup) throw new ManagementInputError("Select a manual backup of this instance.", 404);
      if (String(backup.type).toLowerCase() !== "manual") throw new ManagementInputError("Only manual backups can be deleted.", 409);
      if (String(backup.status).toUpperCase() !== "COMPLETED") throw new ManagementInputError("Only completed backups can be deleted.", 409);
      await huaweiFetch(session, "gaussdb", `${base}/backups/${encodeURIComponent(String(values.backup))}`, { method: "DELETE" });
      return { message: "Manual backup deletion accepted.", resourceId: instance.id };
    }
    if (operation === "backup-policy") {
      const body = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/backups/policy`);
      const policy = asRecord(body.backup_policy);
      const days = firstString([policy.period], "").split(",").map((day) => weekdayNames[Number(day) - 1] ?? day).filter(Boolean).join(", ");
      return { message: "Backup policy loaded.", facts: [
        { label: "Retention", value: `${policy.keep_days ?? "-"} days` },
        { label: "Backup window (UTC)", value: firstString([policy.start_time], "-") },
        { label: "Backup weekdays", value: days || "Not set" },
      ] };
    }
    if (operation === "retention") {
      const keepDays = Number(values.keepDays);
      if (keepDays < 1 || keepDays > 732) throw new ManagementInputError("Retention must be 1 to 732 days.");
      const weekdays = values.weekdays as string[];
      if (!weekdays.length || weekdays.some((day) => !/^[1-7]$/.test(day))) throw new ManagementInputError("Select at least one backup weekday.");
      const body = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/backups/policy`);
      const policy = asRecord(body.backup_policy);
      // Preserve the provider's differential-backup and speed-limit settings; only the
      // retention, window, and weekdays are replaced by this operation.
      const preserved: Record<string, unknown> = {};
      const differential = Number(policy.differential_period);
      if (Number.isFinite(differential) && differential > 0) preserved.differential_period = String(differential);
      for (const key of ["rate_limit", "prefetch_block", "file_split_size", "enable_standby_backup"] as const) {
        if (policy[key] !== undefined && policy[key] !== null) preserved[key] = policy[key];
      }
      await huaweiFetch(session, "gaussdb", `/v3.1/${session.projectId}/instances/${encodeURIComponent(instance.id)}/backups/policy`, { method: "PUT", body: JSON.stringify({ backup_policy: { keep_days: keepDays, start_time: values.backupWindow, period: [...weekdays].sort((a, b) => Number(a) - Number(b)).join(","), ...preserved } }) });
      return { message: "Backup retention policy updated.", resourceId: instance.id };
    }
    if (operation === "topology") {
      const body = await huaweiFetch<Record<string, unknown>>(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/components`);
      const facts = asArray(body.nodes).map(asRecord).flatMap((node) => {
        const head = { label: `${firstString([node.name], "-")} · ${firstString([node.status], "-")}`, value: [firstString([node.availability_zone_id], ""), firstString([node.description], "")].filter(Boolean).join(" · ") || "No zone reported" };
        const components = asArray(node.components).map(asRecord).map((component) => ({
          label: `  ${[firstString([component.type], ""), firstString([component.role], "")].filter(Boolean).join(" · ")} · ${firstString([component.status], "-")}`,
          value: firstString([component.id], "-"),
        }));
        return [head, ...components];
      });
      return { message: `${asArray(body.nodes).length} nodes loaded.`, facts };
    }
    if (operation === "db-users") {
      const rows = await dbUserRows(session, instance.id);
      return { message: `${rows.length} database users loaded.`, facts: rows.map((row) => {
        const attribute = asRecord(row.attribute);
        const privileges = [["rolsuper", "superuser"], ["rolcreatedb", "create database"], ["rolcreaterole", "create role"], ["rolreplication", "replication"]].filter(([key]) => attribute[key] === true).map(([, label]) => label);
        return { label: firstString([row.name], "-"), value: [[row.lock_status === true ? "locked" : "unlocked"], firstString([row.memberof], ""), privileges.join(", ")].filter(Boolean).join(" · ") || "No attributes reported" };
      }) };
    }
    if (operation === "create-db-user") {
      const name = String(values.name);
      if (/^pg/i.test(name)) throw new ManagementInputError("Database user names cannot start with pg.");
      if (systemUsers.includes(name.toLowerCase())) throw new ManagementInputError("Database user names cannot match GaussDB system users.", 409);
      assertPassword(String(values.password), name);
      const rows = await dbUserRows(session, instance.id);
      if (rows.some((row) => firstString([row.name], "") === name)) throw new ManagementInputError("A database user with this name already exists on this instance.", 409);
      await huaweiFetch(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/db-user`, { method: "POST", body: JSON.stringify({ name, password: values.password }) });
      return { message: "Database user creation accepted.", resourceId: instance.id };
    }
    if (operation === "reset-db-user-password") {
      const name = String(values.user);
      assertPassword(String(values.password), name);
      const rows = await dbUserRows(session, instance.id);
      if (!rows.some((row) => firstString([row.name], "") === name)) throw new ManagementInputError("The selected database user was not found on this instance.", 404);
      await huaweiFetch(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/db-user/password`, { method: "PUT", body: JSON.stringify({ name, password: values.password }) });
      return { message: "Database user password reset accepted.", resourceId: instance.id };
    }
    if (operation === "reset-password") {
      assertPassword(String(values.password));
      await huaweiFetch(session, "gaussdb", `${base}/instances/${encodeURIComponent(instance.id)}/password`, { method: "POST", body: JSON.stringify({ password: values.password }) });
      return { message: "Administrator password reset accepted.", resourceId: instance.id };
    }
    throw new ManagementInputError("Unsupported GaussDB operation.");
  },
};
