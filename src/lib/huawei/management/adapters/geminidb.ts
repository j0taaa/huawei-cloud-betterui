import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listGeminiDbInstancesForProject } from "@/lib/huawei/services/geminidb";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const deployableModes: Record<string, string> = { cassandra: "Cluster", mongodb: "ReplicaSet" };
const deployableVersions: Record<string, string> = { cassandra: "3.11", mongodb: "4.0" };
const active = ["normal"];
const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const instanceName: ManagementField = { key: "name", label: "Instance name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$", help: "4-64 characters starting with a letter; letters, digits, hyphens, and underscores." };
const passwordField: ManagementField = { key: "password", label: "Administrator password", type: "password", required: true, min: 8, max: 32, help: "8-32 characters combining at least three of lowercase, uppercase, digits, and the special characters ~!@#%^*-_=+?." };
const backupName: ManagementField = { key: "name", label: "Backup name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$" };
const dbUserName: ManagementField = { key: "name", label: "Database user name", required: true, min: 1, max: 36, pattern: "^[A-Za-z][A-Za-z0-9_-]{0,35}$", help: "Up to 36 characters starting with a letter; letters, digits, hyphens, and underscores." };
const redisPasswordField: ManagementField = { key: "password", label: "Database user password", type: "password", required: true, min: 8, max: 32, help: "8-32 characters combining at least three of lowercase, uppercase, digits, and the special characters !@#$%^&*()_+-=." };
const privilegeField: ManagementField = { key: "privilege", label: "Privilege", type: "select", required: true, choices: [{ value: "ReadOnly", label: "ReadOnly" }, { value: "ReadWrite", label: "ReadWrite" }] };
const databasesField: ManagementField = { key: "databases", label: "Authorized databases", type: "list", source: "redisDatabases", required: true, max: 100, help: "At least one database of this Redis instance." };
const userField: ManagementField = { key: "user", label: "Database user", type: "select", source: "dbUsers", required: true };
const maintenanceHours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

function assertAdminPassword(value: string) {
  if (value.length < 8 || value.length > 32) throw new ManagementInputError("The password must be 8 to 32 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and special characters.");
  if (!/^[A-Za-z0-9~!@#%^*\-_=?+]+$/.test(value)) throw new ManagementInputError("The password uses characters outside the supported GeminiDB set (~!@#%^*-_=+?).");
}

function assertRedisPassword(value: string) {
  if (value.length < 8 || value.length > 32) throw new ManagementInputError("The password must be 8 to 32 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and special characters.");
  if (!/^[A-Za-z0-9!@#$%^&*()_+\-=]+$/.test(value)) throw new ManagementInputError("The password uses characters outside the supported GeminiDB Redis account set (!@#$%^&*()_+-=).");
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
  const body = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `/v3/${session.projectId}/instances?${new URLSearchParams({ id, limit: "1" })}`);
  const record = asRecord(asArray(body.instances)[0]);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("The instance was not found in this project.", 404);
  return record;
}

async function versionRows(session: BetterUiSession, engine: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `/v3/${session.projectId}/datastores/${encodeURIComponent(engine)}/versions`);
  return asArray(body.versions).map(String).filter(Boolean);
}

type FlavorRow = { engineName: string; engineVersion: string; vcpus: string; ramGb: number; specCode: string; azStatus: Record<string, string> };

async function flavorRows(session: BetterUiSession, engine: string): Promise<FlavorRow[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `/v3/${session.projectId}/flavors?${new URLSearchParams({ region: session.region, engine_name: engine })}`);
  return asArray(body.flavors).map(asRecord).flatMap((flavor) => {
    const specCode = String(flavor.spec_code ?? "");
    if (!specCode) return [];
    const ram = Number(flavor.ram) || 0;
    return [{
      engineName: String(flavor.engine_name ?? engine),
      engineVersion: String(flavor.engine_version ?? ""),
      vcpus: String(flavor.vcpus ?? "-"),
      ramGb: ram / 1024,
      specCode,
      azStatus: asRecord(flavor.az_status) as Record<string, string>,
    }];
  });
}

async function backupRows(session: BetterUiSession, instanceId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "geminidb", `/v4/${session.projectId}/backups?${new URLSearchParams({ instance_id: instanceId, offset: "0", limit: "100" })}`, { items: ["backups"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return asArray(body.backups).map(asRecord).filter((row) => firstString([row.instance_id], "") === instanceId);
}

type DbUserRow = { name: string; type: string; privilege: string; databases: string[] };

async function dbUserRows(session: BetterUiSession, instanceId: string) {
  const path = `/v3/${session.projectId}/redis/instances/${encodeURIComponent(instanceId)}/db-users`;
  const users: DbUserRow[] = [];
  for (let offset = 0; offset < 10000;) {
    const body = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${path}?${new URLSearchParams({ offset: String(offset), limit: "100" })}`);
    const page = asArray(body.users).map(asRecord).map((user) => ({
      name: firstString([user.name], ""),
      type: firstString([user.type], ""),
      privilege: firstString([user.privilege], "-"),
      databases: asArray(user.databases).map(String),
    })).filter((user) => user.name);
    const total = Number(body.total_count);
    if (!Number.isSafeInteger(total) || total < 0 || page.length > 100) throw new Error("Huawei returned an invalid database user count.");
    if (!page.length && offset < total) throw new Error("Huawei returned an incomplete database user list.");
    if (page.some(user => users.some(existing => existing.name === user.name))) throw new Error("Huawei repeated a database user; the inventory may be incomplete.");
    users.push(...page);
    if (offset + page.length >= total) return users;
    offset += page.length;
  }
  throw new Error("The database user list exceeds the supported page limit. No user mutation was performed.");
}

async function redisDatabaseRows(session: BetterUiSession, instanceId: string) {
  const path = `/v3/${session.projectId}/redis/instances/${encodeURIComponent(instanceId)}/databases`;
  const databases: string[] = [];
  for (let offset = 0; offset < 10000;) {
    const body = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${path}?${new URLSearchParams({ offset: String(offset), limit: "100" })}`);
    const page = asArray(body.databases).map(String).filter(Boolean);
    const total = Number(body.total_count);
    if (!Number.isSafeInteger(total) || total < 0 || page.length > 100) throw new Error("Huawei returned an invalid database list.");
    if (!page.length && offset < total) throw new Error("Huawei returned an incomplete database list.");
    if (page.some(database => databases.includes(database))) throw new Error("Huawei repeated a database; the inventory may be incomplete.");
    databases.push(...page);
    if (offset + page.length >= total) return databases;
    offset += page.length;
  }
  throw new Error("The database list exceeds the supported page limit. No user mutation was performed.");
}

async function availableFlavorRows(session: BetterUiSession, instanceId: string) {
  const path = `/v3/${session.projectId}/instances/${encodeURIComponent(instanceId)}/available-flavors`;
  const flavors: FlavorRow[] = [];
  let currentSpecCode = "";
  for (let offset = 0; offset < 10000;) {
    const body = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${path}?${new URLSearchParams({ offset: String(offset), limit: "100" })}`);
    if (body.instance_id !== instanceId) throw new ManagementInputError("Huawei returned specifications for a different GeminiDB instance.");
    const optional = asRecord(body.optional_flavors);
    const page = asArray(optional.list).map(asRecord).flatMap((flavor) => {
      const specCode = String(flavor.spec_code ?? "");
      if (!specCode || flavor.region_status !== "normal") return [];
      const ram = Number(flavor.ram) || 0;
      return [{ engineName: "", engineVersion: "", vcpus: String(flavor.vcpus ?? "-"), ramGb: ram, specCode, azStatus: asRecord(flavor.az_status) as Record<string, string> }];
    });
    if (!currentSpecCode) currentSpecCode = firstString([asRecord(body.current_flavor).spec_code], "");
    const total = Number(optional.total_count);
    if (!Number.isSafeInteger(total) || total < 0 || page.length > 100) throw new Error("Huawei returned an invalid specification list.");
    if (!page.length && offset < total) throw new Error("Huawei returned an incomplete specification list.");
    if (page.some(flavor => flavors.some(existing => existing.specCode === flavor.specCode))) throw new Error("Huawei repeated a specification; the inventory may be incomplete.");
    flavors.push(...page);
    if (offset + page.length >= total) return { currentSpecCode, flavors };
    offset += page.length;
  }
  throw new Error("The specification list exceeds the supported page limit. No mutation was performed.");
}

function engineOf(record: Record<string, unknown>) {
  return firstString([asRecord(record.datastore).type, record.datastore_type], "");
}

function assertPayPerUse(record: Record<string, unknown>) {
  if (String(record.pay_mode) !== "0") throw new ManagementInputError("This operation supports pay-per-use instances only. Prepaid instances require a subscription order workflow.", 409);
}

function assertRedisEngine(record: Record<string, unknown>) {
  if (engineOf(record) !== "redis") throw new ManagementInputError("Database user management is available for GeminiDB Redis instances only.", 409);
}

function currentSpec(record: Record<string, unknown>) {
  const group = asRecord(asArray(record.groups)[0]);
  const node = asRecord(asArray(group.nodes)[0]);
  return firstString([node.spec_code], "");
}

function currentSize(record: Record<string, unknown>) {
  const group = asRecord(asArray(record.groups)[0]);
  const volume = asRecord(group.volume);
  return Number(volume.size) || 0;
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create instance", kind: "create", description: "Create one private pay-per-use GeminiDB Cassandra cluster or GeminiDB Mongo replica set from live versions, specifications, and availability zone offers.", impact: "Compute and storage are billed hourly while the instance exists. The instance is private with SSL enabled; no public IP is attached and no subscription order is created.", fields: [
    instanceName,
    { key: "offering", label: "Engine, version, and specification", type: "select", source: "offerings", required: true, help: "Cassandra cluster and Mongo replica set specifications currently on sale in this region." },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC. GeminiDB uses the subnet's network ID." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    { key: "nodes", label: "Node count", type: "number", required: true, min: 3, max: 60, defaultValue: 3, help: "GeminiDB Cassandra clusters use 3 to 60 nodes; GeminiDB Mongo replica sets always use three." },
    { key: "diskSize", label: "Storage capacity (GB)", type: "number", required: true, min: 100, max: 10000, defaultValue: 100, help: "At least 100 GB. The maximum depends on the selected specification and is enforced by Huawei Cloud." },
    passwordField,
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "rename", label: "Rename instance", kind: "update", description: "Change the instance name without restarting it.", fields: [instanceName] },
  { id: "restart", label: "Restart instance", kind: "action", description: "Restart the whole instance.", fields: [], allowedStatuses: active, confirmation: true, impact: "Connections are closed and the instance is unavailable until the restart completes." },
  { id: "resize-flavor", label: "Change specification", kind: "action", description: "Move a pay-per-use instance to another specification that Huawei Cloud offers for it.", fields: [{ key: "offering", label: "New specification", type: "select", source: "resizeOfferings", required: true }], allowedStatuses: active, confirmation: true, impact: "The instance restarts on the new specification and connections are closed until the change completes. The new specification is billed immediately." },
  { id: "resize-storage", label: "Expand storage", kind: "action", description: "Increase the storage capacity of a pay-per-use instance.", fields: [{ key: "size", label: "New storage capacity (GB)", type: "number", required: true, min: 10, max: 10000, help: "An integer greater than the current capacity. The maximum depends on the specification and is enforced by Huawei Cloud." }], allowedStatuses: active, confirmation: true, impact: "The expanded storage is billed immediately and cannot be reduced." },
  { id: "delete", label: "Delete instance", kind: "delete", description: "Permanently delete a pay-per-use instance and its data. Existing backups remain until their retention expires.", fields: [], confirmation: true, impact: "The instance and all stored data are permanently removed. Retained backups continue to incur storage charges." },
  { id: "backups", label: "View backups", kind: "inspect", description: "List automatic and manual backups of this instance.", fields: [] },
  { id: "create-backup", label: "Create manual backup", kind: "action", description: "Start a full manual backup of the instance.", fields: [backupName, { key: "description", label: "Description", type: "textarea", max: 256, help: "Up to 256 characters; the characters > ! < \" & ' = are not accepted." }], allowedStatuses: active, impact: "Backup storage is billed while the backup is retained." },
  { id: "delete-backup", label: "Delete manual backup", kind: "action", description: "Permanently delete one completed manual backup of this instance.", fields: [{ key: "backup", label: "Manual backup", type: "select", source: "backups", required: true }], confirmation: true, impact: "The backup is permanently removed and can no longer be restored." },
  { id: "backup-policy", label: "View backup policy", kind: "inspect", description: "Show the automatic backup retention, UTC window, and weekdays.", fields: [] },
  { id: "retention", label: "Set backup retention", kind: "update", description: "Replace the automatic backup policy's retention, UTC window, and weekdays.", fields: [
    { key: "keepDays", label: "Retention (days)", type: "number", required: true, min: 1, max: 35, defaultValue: 7, help: "1-35 days. Retention under 7 days requires daily backups; disabling automatic backups is not offered." },
    { key: "backupWindow", label: "Backup window (UTC)", type: "select", source: "backupWindows", required: true },
    { key: "weekdays", label: "Backup weekdays", type: "list", source: "weekdays", required: true, max: 7 },
  ], allowedStatuses: active, confirmation: true, impact: "Automatic backups outside the new retention are removed. Reducing retention can permanently delete older backups." },
  { id: "topology", label: "View topology", kind: "inspect", description: "Show node roles, zones, addresses, specifications, and group storage.", fields: [] },
  { id: "db-users", label: "View database users", kind: "inspect", description: "List GeminiDB Redis accounts and their privileges. Passwords are never returned.", fields: [], allowedStatuses: active },
  { id: "create-db-user", label: "Create database user", kind: "action", description: "Create one GeminiDB Redis account with a password, a read or readWrite privilege, and authorized databases.", fields: [dbUserName, redisPasswordField, privilegeField, databasesField], allowedStatuses: active },
  { id: "delete-db-user", label: "Delete database user", kind: "action", description: "Remove one non-administrator GeminiDB Redis account.", fields: [userField], confirmation: true, impact: "Applications using these credentials lose access immediately." },
  { id: "reset-db-user-password", label: "Reset database user password", kind: "action", description: "Set a new password for one GeminiDB Redis account.", fields: [userField, { ...redisPasswordField, label: "New password" }], allowedStatuses: active, confirmation: true, impact: "Applications using the old password lose access immediately." },
  { id: "reset-password", label: "Reset administrator password", kind: "action", description: "Set a new password for the instance administrator account.", fields: [{ ...passwordField, label: "New administrator password" }], allowedStatuses: active, confirmation: true, impact: "Applications using the old password lose access immediately." },
  { id: "maintenance-window", label: "Set maintenance window", kind: "update", description: "Set the UTC whole hour at which the four-hour maintenance window starts.", fields: [
    { key: "start", label: "Maintenance window start (UTC)", type: "select", required: true, choices: maintenanceHours.map((hour) => ({ value: hour, label: hour })) },
  ], allowedStatuses: active, impact: "Maintenance operations run during this window." },
  { id: "security-group", label: "Change security group", kind: "update", description: "Move the instance to another security group in this project.", fields: [{ key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true }], allowedStatuses: active, confirmation: true, impact: "Network access rules change immediately. Clients blocked by the new group lose connectivity." },
];

export const geminidbManagement: ManagementAdapter = {
  title: "GeminiDB",
  operations,
  inventory: async (session) => (await listGeminiDbInstancesForProject(session)).map((item) => ({
    id: item.id, name: item.name, status: item.status,
    values: { name: item.name, engine: item.apiType, mode: item.mode, version: item.datastore.split(" ")[1] ?? "", size: gigabytes(item.storage), projectId: item.projectId },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [cassandraVersions, mongoVersions, cassandraFlavors, mongoFlavors, subnets, groups] = await Promise.all([
        versionRows(session, "cassandra"), versionRows(session, "mongodb"),
        flavorRows(session, "cassandra"), flavorRows(session, "mongodb"),
        listSubnetsForProject(session), listSecurityGroupsForProject(session),
      ]);
      const byEngine: Array<[string, string[], FlavorRow[], string]> = [
        ["cassandra", cassandraVersions, cassandraFlavors, "Cluster"],
        ["mongodb", mongoVersions, mongoFlavors, "Replica set"],
      ];
      const offerings = byEngine.flatMap(([engine, versions, flavors, modeLabel]) =>
        flavors.flatMap((flavor) => versions.filter((version) => flavor.engineName === engine && version === flavor.engineVersion && version === deployableVersions[engine]).map((version) => ({
          value: JSON.stringify([engine, version, flavor.specCode]),
          label: `GeminiDB ${engine === "cassandra" ? "Cassandra" : "Mongo"} ${version} · ${modeLabel} · ${flavor.specCode} · ${flavor.vcpus} vCPU · ${flavor.ramGb} GB RAM`,
        }))));
      const zones = [...new Set([...cassandraFlavors, ...mongoFlavors].flatMap((flavor) => Object.entries(flavor.azStatus).filter(([, status]) => status === "normal").map(([zone]) => zone)))];
      return {
        offerings,
        zones: zones.map((zone) => ({ value: zone, label: zone })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
      };
    }
    if (operation === "retention") return {
      backupWindows: Array.from({ length: 48 }, (_, index) => {
        const hour = Math.floor(index / 2);
        const minute = index % 2 ? "30" : "00";
        const start = `${String(hour).padStart(2, "0")}:${minute}`;
        const end = `${String((hour + 1) % 24).padStart(2, "0")}:${minute}`;
        return { value: `${start}-${end}`, label: `${start}-${end} UTC` };
      }),
      weekdays: weekdayNames.map((name, index) => ({ value: String(index + 1), label: name })),
    };
    if (!resource) return {};
    if (operation === "delete-backup") {
      const rows = await backupRows(session, resource.id);
      return { backups: rows.filter((row) => String(row.type) === "Manual" && String(row.status) === "COMPLETED").map((row) => ({ value: firstString([row.id], ""), label: `${firstString([row.name], "-")} · ${firstString([row.begin_time], "-")}` })) };
    }
    if (operation === "delete-db-user" || operation === "reset-db-user-password") {
      const record = await instanceRecord(session, resource.id);
      if (engineOf(record) !== "redis") return {};
      const rows = await dbUserRows(session, resource.id);
      return { dbUsers: rows.filter((row) => operation === "reset-db-user-password" || row.type === "acluser").map((row) => ({ value: row.name, label: `${row.name} · ${row.type} · ${row.privilege}` })) };
    }
    if (operation === "create-db-user") {
      const record = await instanceRecord(session, resource.id);
      if (engineOf(record) !== "redis") return {};
      const databases = await redisDatabaseRows(session, resource.id);
      return { redisDatabases: databases.map((database) => ({ value: database, label: database })) };
    }
    if (operation === "resize-flavor") {
      const { currentSpecCode, flavors } = await availableFlavorRows(session, resource.id);
      return { resizeOfferings: flavors.filter((flavor) => flavor.specCode !== currentSpecCode).map((flavor) => ({ value: flavor.specCode, label: `${flavor.specCode} · ${flavor.vcpus} vCPU · ${flavor.ramGb} GB RAM` })) };
    }
    if (operation === "security-group") {
      const groups = await listSecurityGroupsForProject(session);
      return { securityGroups: groups.map((group) => ({ value: group.id, label: group.name })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `/v3/${session.projectId}/jobs?${new URLSearchParams({ id: entry.jobId! })}`);
    const job = asArray(response.jobs).map(asRecord).find((row) => firstString([row.id], "") === entry.jobId);
    if (!entry.jobId || !job) throw new ManagementInputError("Huawei did not return the stored GeminiDB job.");
    const status = String(job.status ?? "").toLowerCase();
    const resourceId = firstString([asRecord(job.instance).id], "") || undefined;
    if (entry.resourceId && resourceId && resourceId !== entry.resourceId) throw new ManagementInputError("The GeminiDB job does not belong to the selected instance.");
    if (status === "completed") return { state: "succeeded", message: "The GeminiDB cloud job completed successfully.", resourceId };
    if (status === "failed") return { state: "failed", message: "The GeminiDB cloud job failed. Review the instance status before retrying." };
    return { state: "submitted", message: "The GeminiDB cloud job is still processing." };
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listGeminiDbInstances, cloudCacheKeys.summary, ...(resource ? [`geminidb-instance:${resource.id}`] : [])],
  execute: async (session, operation, values, resource) => {
    const base = `/v3/${session.projectId}`;
    if (operation === "create") {
      const [engine, version, specCode] = parseOffering(values.offering).map(String);
      const mode = deployableModes[engine];
      if (!mode || version !== deployableVersions[engine] || !specCode) throw new ManagementInputError("Select an available engine, version, and specification.");
      const nodes = Number(values.nodes);
      if (engine === "mongodb" ? nodes !== 3 : (nodes < 3 || nodes > 60)) throw new ManagementInputError(engine === "mongodb" ? "GeminiDB Mongo replica sets use exactly three nodes." : "GeminiDB Cassandra clusters use 3 to 60 nodes.");
      const diskSize = Number(values.diskSize);
      if (diskSize < 100 || diskSize > 10000) throw new ManagementInputError("Storage must be at least 100 GB; the maximum depends on the selected specification.");
      assertAdminPassword(String(values.password));
      const [versions, flavors, subnets, groups] = await Promise.all([versionRows(session, engine), flavorRows(session, engine), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      if (!versions.includes(version)) throw new ManagementInputError("The selected database version is no longer available.");
      const flavor = flavors.find((item) => item.specCode === specCode && item.engineName === engine && item.engineVersion === version);
      if (!flavor) throw new ManagementInputError("The selected version or specification is no longer available.");
      const zone = String(values.zone);
      if (flavor.azStatus[zone] !== "normal") throw new ManagementInputError("The selected specification is not on sale in this availability zone.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (["", "-"].includes(subnet.neutronNetworkId)) throw new ManagementInputError("The selected subnet does not expose the network ID that GeminiDB requires.");
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${base}/instances`, { method: "POST", body: JSON.stringify({
        name: values.name,
        datastore: { type: engine, version, storage_engine: "rocksDB" },
        region: session.region,
        availability_zone: zone,
        vpc_id: subnet.vpcId,
        subnet_id: subnet.neutronNetworkId,
        security_group_id: values.securityGroup,
        password: values.password,
        mode,
        flavor: [{ num: String(nodes), storage: "ULTRAHIGH", size: String(diskSize), spec_code: specCode }],
        ssl_option: "1",
        charge_info: { charge_mode: "postPaid" },
        enterprise_project_id: values.enterpriseProjectId ?? "0",
      }) });
      if (!response.id) throw new Error("Huawei returned no new instance ID. Check instances before retrying creation.");
      return { message: "Instance creation submitted. The instance is private with SSL enabled; no public IP is attached.", resourceId: firstString([response.id], "") || undefined, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    const instance = resource!;
    if (operation === "rename") {
      await huaweiFetch(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/name`, { method: "PUT", body: JSON.stringify({ name: values.name }) });
      return { message: "Instance renamed.", resourceId: instance.id };
    }
    if (operation === "restart") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/restart`, { method: "POST", body: JSON.stringify({}) });
      return { message: "Instance restart submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "resize-flavor") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      const specCode = String(values.offering);
      const { currentSpecCode, flavors } = await availableFlavorRows(session, instance.id);
      const current = currentSpecCode || currentSpec(record);
      if (specCode === current) throw new ManagementInputError("The new specification must differ from the current one.", 409);
      const selected = flavors.find(flavor => flavor.specCode === specCode);
      if (!selected) throw new ManagementInputError("The selected specification is no longer available for this instance.");
      const zones = asArray(record.groups).map(asRecord).flatMap(group => asArray(group.nodes).map(asRecord).map(node => String(node.availability_zone ?? "")));
      if (!zones.length || zones.some(zone => !zone || selected.azStatus[zone] !== "normal")) throw new ManagementInputError("The selected specification must be on sale in every current node availability zone.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/resize`, { method: "PUT", body: JSON.stringify({ resize: { target_spec_code: specCode } }) });
      return { message: "Specification change submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "resize-storage") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      const size = Number(values.size);
      if (!Number.isSafeInteger(size) || size < 10 || size > 10000) throw new ManagementInputError("The new capacity must be a whole number of GB within the supported bounds.");
      const current = currentSize(record);
      if (!current) throw new ManagementInputError("The instance's current storage could not be loaded. Retry the operation.");
      if (size <= current) throw new ManagementInputError(`The new capacity must exceed the current ${current} GB storage.`);
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/extend-volume`, { method: "POST", body: JSON.stringify({ size }) });
      return { message: "Storage expansion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete") {
      const record = await instanceRecord(session, instance.id);
      assertPayPerUse(record);
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}`, { method: "DELETE" });
      return { message: "Instance deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "backups") {
      const rows = await backupRows(session, instance.id);
      return { message: `${rows.length} backups loaded.`, facts: rows.map((row) => ({ label: `${firstString([row.name], "-")} · ${firstString([row.type], "-")} · ${firstString([row.status], "-")}`, value: `${firstString([row.begin_time], "-")} · ${Number(row.size) || 0} KB · ${firstString([row.id], "-")}` })) };
    }
    if (operation === "create-backup") {
      const description = String(values.description ?? "").trim();
      if (/[><!"'&=]/.test(description)) throw new ManagementInputError("The description cannot contain the characters > ! < \" & ' =.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/backups`, { method: "POST", body: JSON.stringify({ name: values.name, ...(description ? { description } : {}) }) });
      return { message: "Manual backup creation submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete-backup") {
      const rows = await backupRows(session, instance.id);
      const backup = rows.find((row) => firstString([row.id], "") === values.backup);
      if (!backup) throw new ManagementInputError("Select a manual backup of this instance.", 404);
      if (String(backup.type) !== "Manual") throw new ManagementInputError("Only manual backups can be deleted.", 409);
      if (String(backup.status) !== "COMPLETED") throw new ManagementInputError("Only completed backups can be deleted.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${base}/backups/${encodeURIComponent(String(values.backup))}`, { method: "DELETE" });
      return { message: "Manual backup deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "backup-policy") {
      const body = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/backups/policy`);
      const policy = asRecord(body.backup_policy);
      const keepDays = Number(policy.keep_days);
      const days = firstString([policy.period], "").split(",").map((day) => weekdayNames[Number(day) - 1] ?? day).filter(Boolean).join(", ");
      return { message: "Backup policy loaded.", facts: [
        { label: "Retention", value: keepDays > 0 ? `${keepDays} days` : "Automatic backups disabled" },
        { label: "Backup window (UTC)", value: firstString([policy.start_time], "-") },
        { label: "Backup weekdays", value: days || "Not set" },
      ] };
    }
    if (operation === "retention") {
      const keepDays = Number(values.keepDays);
      if (keepDays < 1 || keepDays > 35) throw new ManagementInputError("Retention must be 1 to 35 days.");
      const weekdays = values.weekdays as string[];
      if (!weekdays.length || weekdays.some((day) => !/^[1-7]$/.test(day))) throw new ManagementInputError("Select at least one backup weekday.");
      if (keepDays < 7 && weekdays.length < 7) throw new ManagementInputError("Retention under 7 days requires daily backups. Select every weekday.");
      await huaweiFetch(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/backups/policy`, { method: "PUT", body: JSON.stringify({ backup_policy: { keep_days: keepDays, start_time: values.backupWindow, period: [...weekdays].sort((a, b) => Number(a) - Number(b)).join(",") } }) });
      return { message: "Backup retention policy updated.", resourceId: instance.id };
    }
    if (operation === "topology") {
      const record = await instanceRecord(session, instance.id);
      const facts = asArray(record.groups).map(asRecord).flatMap((group) => {
        const volume = asRecord(group.volume);
        const nodes = asArray(group.nodes).map(asRecord).map((node) => ({
          label: [firstString([node.name], ""), firstString([node.role], "")].filter(Boolean).join(" · ") || firstString([node.id], "-"),
          value: [firstString([node.status], ""), firstString([node.availability_zone], ""), firstString([node.private_ip], ""), firstString([node.spec_code], "")].filter(Boolean).join(" · ") || "No details reported",
        }));
        const size = firstString([volume.size], "");
        const used = firstString([volume.used], "");
        if (size) nodes.push({ label: `Group ${firstString([group.id], "-")} storage`, value: [`${size} GB`, used ? `${used} GB used` : ""].filter(Boolean).join(" · ") });
        return nodes;
      });
      return { message: `${facts.length} topology entries loaded.`, facts };
    }
    if (operation === "db-users") {
      const record = await instanceRecord(session, instance.id);
      assertRedisEngine(record);
      const rows = await dbUserRows(session, instance.id);
      return { message: `${rows.length} database users loaded.`, facts: rows.map((row) => ({ label: `${row.name} · ${row.type}`, value: [row.privilege, row.databases.length ? `databases: ${row.databases.join(", ")}` : ""].filter(Boolean).join(" · ") || "No privileges reported" })) };
    }
    if (operation === "create-db-user") {
      const record = await instanceRecord(session, instance.id);
      assertRedisEngine(record);
      const name = String(values.name);
      assertRedisPassword(String(values.password));
      if (!["ReadOnly", "ReadWrite"].includes(String(values.privilege))) throw new ManagementInputError("Select a privilege for the database user.");
      const databases = values.databases as string[];
      if (!databases.length) throw new ManagementInputError("Select at least one database for the database user.");
      const [rows, liveDatabases] = await Promise.all([dbUserRows(session, instance.id), redisDatabaseRows(session, instance.id)]);
      if (rows.some((row) => row.name === name)) throw new ManagementInputError("A database user with this name already exists on this instance.", 409);
      if (databases.some((database) => !liveDatabases.includes(database))) throw new ManagementInputError("One of the selected databases is no longer available on this instance.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `/v3/${session.projectId}/redis/instances/${encodeURIComponent(instance.id)}/db-users`, { method: "POST", body: JSON.stringify({ users: [{ name, password: values.password, databases, privilege: values.privilege }] }) });
      return { message: "Database user creation submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete-db-user") {
      const record = await instanceRecord(session, instance.id);
      assertRedisEngine(record);
      const name = String(values.user);
      const rows = await dbUserRows(session, instance.id);
      const user = rows.find((row) => row.name === name);
      if (!user) throw new ManagementInputError("The selected database user was not found on this instance.", 404);
      if (user.type !== "acluser" || user.name === record.db_user_name) throw new ManagementInputError("Only a verified custom ACL account can be deleted; the built-in administrator account is protected.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `/v3/${session.projectId}/redis/instances/${encodeURIComponent(instance.id)}/db-users`, { method: "DELETE", body: JSON.stringify({ names: [name] }) });
      return { message: "Database user deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "reset-db-user-password") {
      const record = await instanceRecord(session, instance.id);
      assertRedisEngine(record);
      const name = String(values.user);
      assertRedisPassword(String(values.password));
      const rows = await dbUserRows(session, instance.id);
      if (!rows.some((row) => row.name === name)) throw new ManagementInputError("The selected database user was not found on this instance.", 404);
      await huaweiFetch(session, "geminidb", `/v3/${session.projectId}/redis/instances/${encodeURIComponent(instance.id)}/db-users/password`, { method: "PUT", body: JSON.stringify({ name, password: values.password }) });
      return { message: "Database user password reset accepted.", resourceId: instance.id };
    }
    if (operation === "reset-password") {
      await instanceRecord(session, instance.id);
      assertAdminPassword(String(values.password));
      await huaweiFetch(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/password`, { method: "PUT", body: JSON.stringify({ password: values.password }) });
      return { message: "Administrator password reset accepted.", resourceId: instance.id };
    }
    if (operation === "maintenance-window") {
      const start = String(values.start);
      if (!maintenanceHours.includes(start)) throw new ManagementInputError("Select a UTC whole hour for the maintenance window.");
      await huaweiFetch(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/maintenance-window`, { method: "PUT", body: JSON.stringify({ start_time: start }) });
      return { message: "Maintenance window updated.", resourceId: instance.id };
    }
    if (operation === "security-group") {
      const groups = await listSecurityGroupsForProject(session);
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const record = await instanceRecord(session, instance.id);
      if (firstString([record.security_group_id], "") === values.securityGroup) throw new ManagementInputError("The instance already uses this security group.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "geminidb", `${base}/instances/${encodeURIComponent(instance.id)}/security-group`, { method: "PUT", body: JSON.stringify({ security_group_id: values.securityGroup }) });
      return { message: "Security group change submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported GeminiDB operation.");
  },
};
