import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listDdsInstancesForProject } from "@/lib/huawei/services/dds";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const engineName = "DDS-Community";
const active = ["normal"];
const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const instanceName: ManagementField = { key: "name", label: "Instance name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$", help: "4-64 characters starting with a letter; letters, digits, hyphens, and underscores." };
const passwordField: ManagementField = { key: "password", label: "Administrator password", type: "password", required: true, min: 8, max: 32, help: "8-32 characters combining at least three of lowercase, uppercase, digits, and the special characters ~!@#%^*-_=+?." };
const backupName: ManagementField = { key: "name", label: "Backup name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$" };
const dbUserName: ManagementField = { key: "name", label: "Database user name", required: true, min: 1, max: 64, pattern: "^[A-Za-z0-9_.-]{1,64}$", help: "1-64 letters, digits, hyphens, underscores, or dots." };
const dbNameField: ManagementField = { key: "dbName", label: "User's database", max: 64, pattern: "^[A-Za-z0-9_]{1,64}$", help: "Letters, digits, and underscores. Leave empty to use the default admin database." };
const roleField: ManagementField = { key: "role", label: "Role", type: "select", required: true, choices: [{ value: "read", label: "read" }, { value: "readWrite", label: "readWrite" }], help: "The MongoDB built-in privilege granted on the role database." };
const roleDbField: ManagementField = { key: "roleDb", label: "Role database", max: 64, pattern: "^[A-Za-z0-9_]{1,64}$", help: "The database the role applies to. Defaults to the user's database." };
const userField: ManagementField = { key: "user", label: "Database user", type: "select", source: "dbUsers", required: true };
const maintenanceHours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

function assertPassword(value: string) {
  if (value.length < 8 || value.length > 32) throw new ManagementInputError("The password must be 8 to 32 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and special characters.");
  if (!/^[A-Za-z0-9~!@#%^*\-_=?+]+$/.test(value)) throw new ManagementInputError("The password uses characters outside the supported DDS set (~!@#%^*-_=+?).");
}

function storageEngineFor(version: string) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 4 || (major === 4 && minor >= 2) ? "rocksDB" : "wiredTiger";
}

function gigabytes(display: string) {
  const size = Number(display.replace(" GB", ""));
  return Number.isFinite(size) && size > 0 ? size : 0;
}

async function instanceRecord(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dds", `/v3/${session.projectId}/instances?${new URLSearchParams({ id, limit: "1" })}`);
  const record = asRecord(asArray(body.instances)[0]);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("The instance was not found in this project.", 404);
  return record;
}

async function versionRows(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dds", `/v3/${session.projectId}/datastores/${engineName}/versions`);
  return asArray(body.versions).map(String).filter(Boolean);
}

async function flavorRows(session: BetterUiSession): Promise<Array<{ type: string; vcpus: string; ramGb: number; specCode: string; azStatus: Record<string, string>; engineVersions: string[] }>> {
  const body = await huaweiList<Record<string, unknown>>(session, "dds", `/v3.1/${session.projectId}/flavors?${new URLSearchParams({ engine_name: engineName, limit: "100" })}`, { items: ["flavors"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return asArray(body.flavors).map(asRecord).flatMap((flavor) => {
    const specCode = String(flavor.spec_code ?? "");
    if (!specCode) return [];
    const az = flavor.az_status;
    const azStatus = Array.isArray(az) ? Object.fromEntries(az.map((zone): [string, string] => [String(zone), "normal"])) : asRecord(az) as Record<string, string>;
    const ram = Number(flavor.ram) || 0;
    return [{ type: String(flavor.type ?? ""), vcpus: String(flavor.vcpus ?? "-"), ramGb: ram >= 1024 ? ram / 1024 : ram, specCode, azStatus, engineVersions: asArray(flavor.engine_versions).map(String) }];
  });
}

async function storageRows(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dds", `/v3/${session.projectId}/storage-type?${new URLSearchParams({ engine_name: engineName })}`);
  return asArray(body.storage_type).map(asRecord).map((storage) => ({ name: String(storage.name ?? ""), azStatus: asRecord(storage.az_status) }));
}

async function backupRows(session: BetterUiSession, instanceId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "dds", `/v3/${session.projectId}/backups?${new URLSearchParams({ instance_id: instanceId, offset: "0", limit: "100" })}`, { items: ["backups"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return asArray(body.backups).map(asRecord).filter(row => row.instance_id === instanceId);
}

type DbUserRow = { user: string; db: string; roles: string[] };

function parseUserPage(raw: unknown) {
  const parsed: unknown = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(parsed)) throw new Error("Huawei returned an invalid database user list.");
  return parsed.map(asRecord).map((user) => ({
    user: firstString([user.user, user.name], ""),
    db: firstString([user.db], "admin"),
    roles: asArray(user.roles).map(asRecord).map((role) => `${firstString([role.role], "-")}@${firstString([role.db], "-")}`),
  })).filter((user) => user.user);
}

async function dbUserRows(session: BetterUiSession, instanceId: string) {
  const path = `/v3/${session.projectId}/instances/${encodeURIComponent(instanceId)}/db-user/detail`;
  const users: DbUserRow[] = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const body = await huaweiFetch<Record<string, unknown>>(session, "dds", `${path}?${new URLSearchParams({ offset: String(offset), limit: "100" })}`);
    const page = parseUserPage(body.users);
    const total = Number(body.total_count);
    if (!Number.isSafeInteger(total) || total < 0 || page.length > 100) throw new Error("Huawei returned an invalid database user count.");
    if (!page.length && offset < total) throw new Error("Huawei returned an incomplete database user list.");
    users.push(...page);
    if (offset + page.length >= total) return users;
  }
  throw new Error("The database user list exceeds the supported page limit. No user mutation was performed.");
}

function modeOf(record: Record<string, unknown>) {
  return firstString([record.mode], "");
}

function assertPayPerUse(record: Record<string, unknown>) {
  if (String(record.pay_mode) !== "0") throw new ManagementInputError("This operation supports pay-per-use instances only. Prepaid instances require a subscription order workflow.", 409);
}

function assertReplicaOrSingle(record: Record<string, unknown>) {
  if (!["ReplicaSet", "Single"].includes(modeOf(record))) throw new ManagementInputError("This operation supports ReplicaSet and Single instances only.", 409);
}

function currentSpec(record: Record<string, unknown>) {
  const group = asRecord(asArray(record.groups)[0]);
  const node = asRecord(asArray(group.nodes)[0]);
  return firstString([node.spec_code, record.flavor_ref], "");
}

function compatibleFlavor(record: Record<string, unknown>, flavor: Awaited<ReturnType<typeof flavorRows>>[number]) {
  const version = firstString([asRecord(record.datastore).version], "");
  const nodes = asArray(record.groups).map(asRecord).flatMap(group => asArray(group.nodes).map(asRecord));
  const zones = [...new Set(nodes.map(node => firstString([node.availability_zone], "")))];
  return Boolean(version && zones.length && zones.every(zone => zone && flavor.azStatus[zone] === "normal") && flavor.engineVersions.includes(version));
}

function currentSize(record: Record<string, unknown>) {
  const group = asRecord(asArray(record.groups)[0]);
  const volume = asRecord(group.volume);
  return Number(volume.size) || 0;
}

function parseOffering(value: unknown) {
  let offering: unknown;
  try { offering = JSON.parse(String(value)); } catch { return []; }
  return Array.isArray(offering) ? offering : [];
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create instance", kind: "create", description: "Create one private pay-per-use MongoDB replica set (three nodes) or single-node instance from live versions, specifications, storage, zone, and network choices.", impact: "Compute and storage are billed hourly while the instance exists. The instance is private with SSL enabled; no public IP is attached and no subscription order is created.", fields: [
    instanceName,
    { key: "offering", label: "Version, mode, and specification", type: "select", source: "offerings", required: true, help: "Replica set and single-node specifications currently on sale in this region." },
    { key: "storageType", label: "Storage type", type: "select", source: "storageTypes", required: true },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC. DDS uses the subnet's network ID." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    { key: "diskSize", label: "Storage capacity (GB)", type: "number", required: true, min: 10, max: 2000, defaultValue: 10, help: "A multiple of 10 GB: 10-2000 GB for replica sets and 10-1000 GB for single nodes." },
    passwordField,
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "rename", label: "Rename instance", kind: "update", description: "Change the instance name without restarting it.", fields: [instanceName] },
  { id: "restart", label: "Restart instance", kind: "action", description: "Restart the whole instance.", fields: [], allowedStatuses: active, confirmation: true, impact: "Connections are closed and the instance is unavailable until the restart completes." },
  { id: "resize-flavor", label: "Change specification", kind: "action", description: "Move a pay-per-use ReplicaSet or Single instance to another on-sale specification.", fields: [{ key: "offering", label: "New specification", type: "select", source: "resizeOfferings", required: true }], allowedStatuses: active, confirmation: true, impact: "The instance restarts on the new specification and connections are closed until the change completes. The new specification is billed immediately." },
  { id: "resize-storage", label: "Expand storage", kind: "action", description: "Increase the storage capacity of a pay-per-use ReplicaSet or Single instance.", fields: [{ key: "size", label: "New storage capacity (GB)", type: "number", required: true, min: 10, max: 5000, help: "A multiple of 10 GB that exceeds the current capacity: up to 5000 GB for replica sets and 1000 GB for single nodes." }], allowedStatuses: active, confirmation: true, impact: "The expanded storage is billed immediately and cannot be reduced." },
  { id: "delete", label: "Delete instance", kind: "delete", description: "Permanently delete a pay-per-use instance and its data. Existing backups remain until their retention expires.", fields: [], confirmation: true, impact: "The instance and all stored data are permanently removed. Retained backups continue to incur storage charges." },
  { id: "backups", label: "View backups", kind: "inspect", description: "List automatic and manual backups of this instance.", fields: [] },
  { id: "create-backup", label: "Create manual backup", kind: "action", description: "Start a full manual backup of the instance.", fields: [backupName, { key: "description", label: "Description", type: "textarea", max: 256, help: "Up to 256 characters; the characters > ! < \" & ' = are not accepted." }], allowedStatuses: active, impact: "Backup storage is billed while the backup is retained." },
  { id: "delete-backup", label: "Delete manual backup", kind: "action", description: "Permanently delete one completed manual backup of this instance.", fields: [{ key: "backup", label: "Manual backup", type: "select", source: "backups", required: true }], confirmation: true, impact: "The backup is permanently removed and can no longer be restored." },
  { id: "backup-policy", label: "View backup policy", kind: "inspect", description: "Show the automatic backup retention, window, weekdays, and incremental backup setting.", fields: [] },
  { id: "retention", label: "Set backup retention", kind: "update", description: "Replace the automatic backup policy's retention, UTC window, and weekdays. The incremental backup setting is left unchanged.", fields: [
    { key: "keepDays", label: "Retention (days)", type: "number", required: true, min: 1, max: 732, defaultValue: 7, help: "1-732 days. Retention under 7 days requires daily backups; disabling automatic backups is not offered." },
    { key: "backupWindow", label: "Backup window (UTC)", type: "select", source: "backupWindows", required: true },
    { key: "weekdays", label: "Backup weekdays", type: "list", source: "weekdays", required: true, max: 7 },
  ], allowedStatuses: active, confirmation: true, impact: "Automatic backups outside the new retention are removed. Reducing retention can permanently delete older backups." },
  { id: "topology", label: "View topology", kind: "inspect", description: "Show node roles, zones, addresses, and the replica set name used in connection strings.", fields: [] },
  { id: "db-users", label: "View database users", kind: "inspect", description: "List database users and their roles. Passwords are never returned.", fields: [], allowedStatuses: active },
  { id: "create-db-user", label: "Create database user", kind: "action", description: "Create one database account with a password and a read or readWrite role.", fields: [dbUserName, { ...passwordField, label: "Database user password" }, dbNameField, roleField, roleDbField], allowedStatuses: active },
  { id: "delete-db-user", label: "Delete database user", kind: "action", description: "Remove one non-administrator database account.", fields: [userField], confirmation: true, impact: "Applications using these credentials lose access immediately." },
  { id: "reset-password", label: "Reset database password", kind: "action", description: "Set a new password for the administrator or another database account.", fields: [userField, { ...passwordField, label: "New password" }], allowedStatuses: active, confirmation: true, impact: "Applications using the old password lose access immediately." },
  { id: "maintenance-window", label: "Set maintenance window", kind: "update", description: "Set the UTC whole-hour window during which maintenance operations run.", fields: [
    { key: "start", label: "Maintenance window start (UTC)", type: "select", required: true, choices: maintenanceHours.map((hour) => ({ value: hour, label: hour })) },
    { key: "end", label: "Maintenance window end (UTC)", type: "select", required: true, choices: maintenanceHours.map((hour) => ({ value: hour, label: hour })) },
  ], allowedStatuses: active, impact: "Maintenance operations such as version upgrades run during this window." },
  { id: "security-group", label: "Change security group", kind: "update", description: "Move the instance to another security group in this project.", fields: [{ key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true }], allowedStatuses: active, confirmation: true, impact: "Network access rules change immediately. Clients blocked by the new group lose connectivity." },
];

export const ddsManagement: ManagementAdapter = {
  title: "Document Database Service",
  operations,
  inventory: async (session) => (await listDdsInstancesForProject(session)).map((item) => ({
    id: item.id, name: item.name, status: item.status,
    values: { name: item.name, mode: item.mode, version: item.datastore.split(" ")[1] ?? "", size: gigabytes(item.groups[0]?.storage ?? "-"), storageType: item.groups[0]?.storageType ?? item.storageType, projectId: item.projectId },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [versions, flavors, storages, subnets, groups] = await Promise.all([versionRows(session), flavorRows(session), storageRows(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      const offerings = flavors.flatMap((flavor) => {
        const mode = flavor.type === "replica" ? "ReplicaSet" : flavor.type === "single" ? "Single" : "";
        if (!mode) return [];
        return flavor.engineVersions.filter((version) => versions.includes(version)).map((version) => ({
          value: JSON.stringify([mode, version, flavor.specCode]),
          label: `MongoDB ${version} · ${mode === "ReplicaSet" ? "Replica set" : "Single node"} · ${flavor.specCode} · ${flavor.vcpus} vCPU · ${flavor.ramGb} GB RAM`,
        }));
      });
      const zones = [...new Set(flavors.flatMap((flavor) => Object.entries(flavor.azStatus).filter(([, status]) => status === "normal").map(([zone]) => zone)))];
      return {
        offerings,
        storageTypes: storages.map((storage) => storage.name).filter(Boolean).map((name) => ({ value: name, label: name })),
        zones: zones.map((zone) => ({ value: zone, label: zone })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
      };
    }
    if (operation === "retention") return {
      backupWindows: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00-${String((hour + 1) % 24).padStart(2, "0")}:00`).map((value) => ({ value, label: `${value} UTC` })),
      weekdays: weekdayNames.map((name, index) => ({ value: String(index + 1), label: name })),
    };
    if (!resource) return {};
    if (operation === "delete-backup") {
      const rows = await backupRows(session, resource.id);
      return { backups: rows.filter((row) => String(row.type) === "Manual" && String(row.status) === "COMPLETED" && row.deletable !== false && row.is_instance_restoring !== true).map((row) => ({ value: firstString([row.id], ""), label: `${firstString([row.name], "-")} · ${firstString([row.begin_time], "-")}` })) };
    }
    if (operation === "delete-db-user" || operation === "reset-password") {
      const [rows, record] = await Promise.all([dbUserRows(session, resource.id), instanceRecord(session, resource.id)]);
      const admin = firstString([record.db_user_name], "rwuser");
      return { dbUsers: rows.filter((row) => operation === "reset-password" || row.user !== admin).map((row) => ({ value: JSON.stringify([row.user, row.db]), label: `${row.user} @ ${row.db}` })) };
    }
    if (operation === "resize-flavor") {
      const record = await instanceRecord(session, resource.id);
      if (!["ReplicaSet", "Single"].includes(modeOf(record))) return {};
      const flavors = await flavorRows(session);
      const flavorType = modeOf(record) === "Single" ? "single" : "replica";
      return { resizeOfferings: flavors.filter((flavor) => flavor.type === flavorType && flavor.specCode !== currentSpec(record) && compatibleFlavor(record, flavor)).map((flavor) => ({ value: flavor.specCode, label: `${flavor.specCode} · ${flavor.vcpus} vCPU · ${flavor.ramGb} GB RAM` })) };
    }
    if (operation === "security-group") {
      const groups = await listSecurityGroupsForProject(session);
      return { securityGroups: groups.map((group) => ({ value: group.id, label: group.name })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    const response = await huaweiFetch<Record<string, unknown>>(session, "dds", `/v3/${session.projectId}/jobs?${new URLSearchParams({ id: entry.jobId! })}`);
    const job = asRecord(response.job);
    if (!entry.jobId || job.id !== entry.jobId) throw new ManagementInputError("Huawei returned a different DDS job.");
    const status = String(job.status ?? "").toLowerCase();
    const resourceId = firstString([asRecord(job.instance).id], "") || undefined;
    if (entry.resourceId && resourceId !== entry.resourceId) throw new ManagementInputError("The DDS job does not belong to the selected instance.");
    if (status === "completed") return { state: "succeeded", message: "The DDS cloud job completed successfully.", resourceId };
    if (status === "failed") return { state: "failed", message: "The DDS cloud job failed. Review the instance status before retrying." };
    return { state: "submitted", message: "The DDS cloud job is still processing." };
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listDdsInstances, cloudCacheKeys.summary, ...(resource ? [cloudCacheKeys.dds(resource.id)] : [])],
  execute: async (session, operation, values, resource) => {
    const base = `/v3/${session.projectId}`;
    if (operation === "create") {
      const [mode, version, specCode] = parseOffering(values.offering).map(String);
      if (!["ReplicaSet", "Single"].includes(mode) || !version || !specCode) throw new ManagementInputError("Select an available version, mode, and specification.");
      const diskSize = Number(values.diskSize);
      const maxDisk = mode === "Single" ? 1000 : 2000;
      if (diskSize < 10 || diskSize > maxDisk || diskSize % 10) throw new ManagementInputError(`Storage must be between 10 and ${maxDisk} GB in multiples of 10 GB for ${mode === "Single" ? "single-node" : "replica set"} instances.`);
      assertPassword(String(values.password));
      const [versions, flavors, storages, subnets, groups] = await Promise.all([versionRows(session), flavorRows(session), storageRows(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      if (!versions.includes(version)) throw new ManagementInputError("The selected database version is no longer available.");
      const flavorType = mode === "ReplicaSet" ? "replica" : "single";
      const flavor = flavors.find((item) => item.specCode === specCode && item.type === flavorType && item.engineVersions.includes(version));
      if (!flavor) throw new ManagementInputError("The selected version or specification is no longer available.");
      const zone = String(values.zone);
      if (flavor.azStatus[zone] !== "normal") throw new ManagementInputError("The selected specification is not on sale in this availability zone.");
      const storage = storages.find((item) => item.name === values.storageType);
      if (!storage) throw new ManagementInputError("The selected storage type is unavailable.");
      if (String(storage.azStatus[zone] ?? "") !== "normal") throw new ManagementInputError("The selected storage type is not on sale in this availability zone.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (["", "-"].includes(subnet.neutronNetworkId)) throw new ManagementInputError("The selected subnet does not expose the network ID that DDS requires.");
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/instances`, { method: "POST", body: JSON.stringify({
        name: values.name,
        datastore: { type: engineName, version, storage_engine: storageEngineFor(version) },
        region: session.region,
        availability_zone: zone,
        vpc_id: subnet.vpcId,
        subnet_id: subnet.neutronNetworkId,
        security_group_id: values.securityGroup,
        password: values.password,
        mode,
        flavor: [{ type: flavorType, num: mode === "ReplicaSet" ? "3" : "1", storage: storage.name, size: String(diskSize), spec_code: specCode }],
        ssl_option: "1",
        charge_info: { charge_mode: "postPaid" },
        enterprise_project_id: values.enterpriseProjectId ?? "0",
      }) });
      return { message: "Instance creation submitted. The instance is private with SSL enabled; no public IP is attached.", resourceId: firstString([response.id], "") || undefined, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    const instance = resource!;
    if (operation === "rename") {
      await huaweiFetch(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/modify-name`, { method: "PUT", body: JSON.stringify({ new_instance_name: values.name }) });
      return { message: "Instance renamed.", resourceId: instance.id };
    }
    if (operation === "restart") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/restart`, { method: "POST", body: JSON.stringify({ target_id: instance.id }) });
      return { message: "Instance restart submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "resize-flavor") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      assertReplicaOrSingle(record);
      const specCode = String(values.offering);
      const flavorType = modeOf(record) === "Single" ? "single" : "replica";
      if (specCode === currentSpec(record)) throw new ManagementInputError("The new specification must differ from the current one.", 409);
      const flavors = await flavorRows(session);
      if (!flavors.some((flavor) => flavor.specCode === specCode && flavor.type === flavorType && compatibleFlavor(record, flavor))) throw new ManagementInputError("The selected specification is no longer available for this instance.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/resize`, { method: "POST", body: JSON.stringify({ resize: { target_spec_code: specCode, target_id: instance.id } }) });
      return { message: "Specification change submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "resize-storage") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      assertReplicaOrSingle(record);
      const size = Number(values.size);
      const max = modeOf(record) === "Single" ? 1000 : 5000;
      if (size < 10 || size > max || size % 10) throw new ManagementInputError(`The new capacity must be between 10 and ${max} GB in multiples of 10 GB.`);
      const current = currentSize(record);
      if (!current) throw new ManagementInputError("The instance's current storage could not be loaded. Retry the operation.");
      if (size <= current) throw new ManagementInputError(`The new capacity must exceed the current ${current} GB storage.`);
      const response = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/enlarge-volume`, { method: "POST", body: JSON.stringify({ volume: { size: String(size) } }) });
      return { message: "Storage expansion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      const response = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}`, { method: "DELETE" });
      return { message: "Instance deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "backups") {
      const rows = await backupRows(session, instance.id);
      return { message: `${rows.length} backups loaded.`, facts: rows.map((row) => ({ label: `${firstString([row.name], "-")} · ${firstString([row.type], "-")} · ${firstString([row.status], "-")}`, value: `${firstString([row.begin_time], "-")} · ${Number(row.size) || 0} KB · ${firstString([row.id], "-")}` })) };
    }
    if (operation === "create-backup") {
      const description = String(values.description ?? "").trim();
      if (/[><!"'&=]/.test(description)) throw new ManagementInputError("The description cannot contain the characters > ! < \" & ' =.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/backups`, { method: "POST", body: JSON.stringify({ backup: { instance_id: instance.id, name: values.name, ...(description ? { description } : {}) } }) });
      return { message: "Manual backup creation submitted.", resourceId: firstString([response.backup_id], "") || undefined, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete-backup") {
      const rows = await backupRows(session, instance.id);
      const backup = rows.find((row) => firstString([row.id], "") === values.backup);
      if (!backup) throw new ManagementInputError("Select a manual backup of this instance.", 404);
      if (String(backup.type) !== "Manual") throw new ManagementInputError("Only manual backups can be deleted.", 409);
      if (String(backup.status) !== "COMPLETED") throw new ManagementInputError("Only completed backups can be deleted.", 409);
      if (backup.deletable === false || backup.is_instance_restoring === true) throw new ManagementInputError("This backup is protected or currently used by a restore.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/backups/${encodeURIComponent(String(values.backup))}`, { method: "DELETE" });
      return { message: "Manual backup deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "backup-policy") {
      const body = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/backups/policy`);
      const policy = asRecord(body.backup_policy);
      const days = firstString([policy.period], "").split(",").map((day) => weekdayNames[Number(day) - 1] ?? day).filter(Boolean).join(", ");
      return { message: "Backup policy loaded.", facts: [
        { label: "Retention", value: `${policy.keep_days ?? "-"} days` },
        { label: "Backup window (UTC)", value: firstString([policy.start_time], "-") },
        { label: "Backup weekdays", value: days || "Not set" },
        { label: "Incremental backup", value: policy.enable_incremental_backup === true ? "Enabled" : "Disabled" },
      ] };
    }
    if (operation === "retention") {
      const keepDays = Number(values.keepDays);
      if (keepDays < 1 || keepDays > 732) throw new ManagementInputError("Retention must be 1 to 732 days.");
      const weekdays = values.weekdays as string[];
      if (!weekdays.length || weekdays.some((day) => !/^[1-7]$/.test(day))) throw new ManagementInputError("Select at least one backup weekday.");
      if (keepDays < 7 && weekdays.length < 7) throw new ManagementInputError("Retention under 7 days requires daily backups. Select every weekday.");
      await huaweiFetch(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/backups/policy`, { method: "PUT", body: JSON.stringify({ backup_policy: { keep_days: keepDays, start_time: values.backupWindow, period: [...weekdays].sort((a, b) => Number(a) - Number(b)).join(",") } }) });
      return { message: "Backup retention policy updated.", resourceId: instance.id };
    }
    if (operation === "topology") {
      const record = await instanceRecord(session, instance.id);
      const facts = asArray(record.groups).map(asRecord).flatMap((group) => asArray(group.nodes).map(asRecord).map((node) => ({
        label: `${firstString([node.name], "-")} · ${firstString([node.role], "-")}`,
        value: [firstString([node.status], ""), firstString([node.availability_zone], ""), firstString([node.private_ip], "")].filter(Boolean).join(" · ") || "No details reported",
      })));
      if (modeOf(record) === "ReplicaSet") {
        const body = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/replica-set/name`);
        facts.push({ label: "Replica set name", value: firstString([body.name], "-") });
      }
      return { message: `${facts.length} topology entries loaded.`, facts };
    }
    if (operation === "db-users") {
      const rows = await dbUserRows(session, instance.id);
      return { message: `${rows.length} database users loaded.`, facts: rows.map((row) => ({ label: `${row.user} @ ${row.db}`, value: row.roles.length ? row.roles.join(", ") : "No roles reported" })) };
    }
    if (operation === "create-db-user") {
      const record = await instanceRecord(session, instance.id);
      const admin = firstString([record.db_user_name], "rwuser");
      const name = String(values.name);
      if (name === admin) throw new ManagementInputError("The built-in administrator account cannot be recreated.", 409);
      assertPassword(String(values.password));
      const dbName = String(values.dbName ?? "").trim();
      const roleDb = String(values.roleDb ?? "").trim();
      if (dbName && !/^[A-Za-z0-9_]{1,64}$/.test(dbName)) throw new ManagementInputError("Database names are 1-64 letters, digits, or underscores.");
      if (roleDb && !/^[A-Za-z0-9_]{1,64}$/.test(roleDb)) throw new ManagementInputError("Role database names are 1-64 letters, digits, or underscores.");
      const rows = await dbUserRows(session, instance.id);
      if (rows.some((row) => row.user === name && row.db === (dbName || "admin"))) throw new ManagementInputError("A database user with this name already exists in the selected database.", 409);
      await huaweiFetch(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/db-user`, { method: "POST", body: JSON.stringify({
        user_name: name,
        user_pwd: values.password,
        ...(dbName ? { db_name: dbName } : {}),
        roles: [{ role_name: values.role, role_db_name: roleDb || dbName || "admin" }],
      }) });
      return { message: "Database user creation accepted.", resourceId: instance.id };
    }
    if (operation === "delete-db-user") {
      const record = await instanceRecord(session, instance.id);
      const admin = firstString([record.db_user_name], "rwuser");
      const [name, db] = parseOffering(values.user).map(String);
      if (!name || !db) throw new ManagementInputError("Select a database user of this instance.");
      if (name === admin) throw new ManagementInputError("The built-in administrator account cannot be deleted.", 409);
      const rows = await dbUserRows(session, instance.id);
      if (!rows.some((row) => row.user === name && row.db === db)) throw new ManagementInputError("The selected database user was not found on this instance.", 404);
      await huaweiFetch(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/db-user`, { method: "DELETE", body: JSON.stringify({ user_name: name, db_name: db }) });
      return { message: "Database user deletion accepted.", resourceId: instance.id };
    }
    if (operation === "reset-password") {
      const [name, db] = parseOffering(values.user).map(String);
      if (!name || !db) throw new ManagementInputError("Select a database user of this instance.");
      assertPassword(String(values.password));
      const rows = await dbUserRows(session, instance.id);
      if (!rows.some((row) => row.user === name && row.db === db)) throw new ManagementInputError("The selected database user was not found on this instance.", 404);
      await huaweiFetch(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/reset-password`, { method: "PUT", body: JSON.stringify({ user_name: name, user_pwd: values.password, db_name: db }) });
      return { message: "Password reset accepted.", resourceId: instance.id };
    }
    if (operation === "maintenance-window") {
      const start = String(values.start);
      const end = String(values.end);
      if (start === end) throw new ManagementInputError("The maintenance window start and end must be different whole hours.");
      await huaweiFetch(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/maintenance-window`, { method: "PUT", body: JSON.stringify({ start_time: start, end_time: end }) });
      return { message: "Maintenance window updated.", resourceId: instance.id };
    }
    if (operation === "security-group") {
      const groups = await listSecurityGroupsForProject(session);
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const record = await instanceRecord(session, instance.id);
      if (firstString([record.security_group_id], "") === values.securityGroup) throw new ManagementInputError("The instance already uses this security group.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "dds", `${base}/instances/${encodeURIComponent(instance.id)}/modify-security-group`, { method: "POST", body: JSON.stringify({ security_group_id: values.securityGroup }) });
      return { message: "Security group change submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported DDS operation.");
  },
};
