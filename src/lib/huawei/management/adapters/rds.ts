import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { getRdsInstanceForProject, listRdsInstancesForProject, runRdsAction } from "@/lib/huawei/services/rds";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const engines = ["MySQL", "PostgreSQL"] as const;
type Engine = (typeof engines)[number];
const instanceName: ManagementField = { key: "name", label: "Instance name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$", help: "4-64 characters starting with a letter." };
const passwordField: ManagementField = { key: "password", label: "Administrator password", type: "password", required: true, min: 8, max: 32, help: "8-32 characters combining at least three of lowercase, uppercase, digits, and the special characters ~!@#%^*-_=+?." };
const backupName: ManagementField = { key: "name", label: "Backup name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$" };
const databaseName: ManagementField = { key: "name", label: "Database name", required: true, min: 1, max: 64, pattern: "^[A-Za-z0-9_-]{1,64}$" };
const dbUserName: ManagementField = { key: "name", label: "Database user name", required: true, min: 1, max: 63, pattern: "^[A-Za-z0-9_-]{1,63}$" };
const commentField: ManagementField = { key: "comment", label: "Comment", type: "textarea", max: 512 };
const active = ["ACTIVE"];
const protectedUsers = ["root", "rdsadmin", "rdsbackup", "rdsrepl", "rdsmetric", "rdsproxy", "rdsddm", "rdsdisaster"];
const systemDatabases: Record<Engine, string[]> = { MySQL: ["mysql", "sys", "information_schema", "performance_schema", "rdsadmin"], PostgreSQL: ["postgres", "template0", "template1", "rdsadmin"] };
const characterSets: Record<Engine, ManagementChoice[]> = {
  MySQL: ["utf8mb4", "utf8", "gbk", "latin1"].map((value) => ({ value, label: value })),
  PostgreSQL: ["UTF8", "GBK", "LATIN1", "SQL_ASCII"].map((value) => ({ value, label: value })),
};
// Huawei documents one special-character set per engine and operation kind; anything else is rejected before a request is sent.
const passwordCharset: Record<Engine, Record<"instance" | "user", RegExp>> = {
  MySQL: { instance: /^[A-Za-z0-9~!@#$%^*\-_=?+]+$/, user: /^[A-Za-z0-9~!@#$%^*\-_=?+(),&]+$/ },
  PostgreSQL: { instance: /^[A-Za-z0-9~!@#%^*\-_=?+]+$/, user: /^[A-Za-z0-9~!@#%^*\-_=?+,]+$/ },
};

function assertPassword(value: string, engine: Engine, kind: "instance" | "user", account?: string) {
  if (value.length < 8 || value.length > 32) throw new ManagementInputError("The password must be 8 to 32 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and special characters.");
  if (!passwordCharset[engine][kind].test(value)) throw new ManagementInputError(`The password uses characters outside the supported ${engine} set.`);
  if (account && (value === account || value === [...account].reverse().join(""))) throw new ManagementInputError("The password cannot match the account name or its reverse.");
}

function engineOf(resource: ManagementResource): Engine {
  const engine = String(resource.values?.engine ?? "");
  if (!engines.includes(engine as Engine)) throw new ManagementInputError("This operation supports MySQL and PostgreSQL instances only.", 409);
  return engine as Engine;
}

function gigabytes(display: string) {
  const size = Number(display.replace(" GB", ""));
  return Number.isFinite(size) && size > 0 ? size : 0;
}

async function flavorRows(session: BetterUiSession, engine: Engine) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "rds", `/v3/${session.projectId}/flavors/${engine}`);
  return asArray(body.flavors).map(asRecord).filter((flavor) => flavor.instance_mode === "single").flatMap((flavor) => asArray(flavor.version_name).map((version) => ({
    engine, version: String(version), specCode: String(flavor.spec_code ?? ""), vcpus: String(flavor.vcpus ?? "-"), ram: Number(flavor.ram) || 0,
    azStatus: asRecord(flavor.az_status), azDesc: asRecord(flavor.az_desc),
  })));
}

async function storageRows(session: BetterUiSession, engine: Engine) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "rds", `/v3/${session.projectId}/storage-type/${engine}`);
  return asArray(body.storage_type).map(asRecord).map((storage) => ({ engine, name: String(storage.name ?? ""), azStatus: asRecord(storage.az_status) }));
}

async function backupRows(session: BetterUiSession, instanceId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "rds", `/v3/${session.projectId}/backups?${new URLSearchParams({ instance_id: instanceId, offset: "0", limit: "100" })}`, { items: ["backups"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return asArray(body.backups).map(asRecord).filter(row => !row.instance_id || row.instance_id === instanceId);
}

async function childRows(session: BetterUiSession, instanceId: string, family: "database" | "db_user") {
  const items = family === "database" ? "databases" : "users";
  const body = await huaweiList<Record<string, unknown>>(session, "rds", `/v3/${session.projectId}/instances/${encodeURIComponent(instanceId)}/${family}/detail?${new URLSearchParams({ page: "1", limit: "100" })}`, { items: [items], kind: "page", parameter: "page", first: 1, size: 100, total: ["total_count"] });
  return asArray(body[items]).map(asRecord);
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create instance", kind: "create", description: "Create one private pay-per-use single-node MySQL or PostgreSQL instance from live engine, version, flavor, storage, zone, and network choices.", impact: "Compute and storage are billed hourly while the instance exists. No public IP is attached; applications connect through the selected subnet.", fields: [
    instanceName,
    { key: "offering", label: "Engine, version, and flavor", type: "select", source: "offerings", required: true, help: "Single-node flavors currently on sale in this region." },
    { key: "storageType", label: "Storage type", type: "select", source: "storageTypes", required: true },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    { key: "diskSize", label: "Disk capacity (GB)", type: "number", required: true, min: 40, max: 4000, defaultValue: 40, help: "40-4000 GB in multiples of 10 GB." },
    passwordField,
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "rename", label: "Rename instance", kind: "update", description: "Change the instance name without restarting it.", fields: [instanceName] },
  { id: "reboot", label: "Reboot instance", kind: "action", description: "Restart the database engine.", fields: [], allowedStatuses: active, confirmation: true, impact: "Connections are closed and the instance is unavailable until the reboot completes." },
  { id: "resize-storage", label: "Expand storage", kind: "action", description: "Increase the instance's disk capacity.", fields: [{ key: "size", label: "New disk capacity (GB)", type: "number", required: true, min: 40, max: 4000, help: "The new total must exceed the current disk by at least 10 GB and be a multiple of 10." }], allowedStatuses: active, confirmation: true, impact: "The expanded storage is billed immediately and cannot be reduced." },
  { id: "delete", label: "Delete instance", kind: "delete", description: "Permanently delete the instance and its data. Existing backups remain until their retention expires.", fields: [], confirmation: true, impact: "The instance and all stored data are permanently removed. Retained backups continue to incur storage charges." },
  { id: "backups", label: "View backups", kind: "inspect", description: "List manual and automatic backups of this instance.", fields: [] },
  { id: "create-backup", label: "Create manual backup", kind: "action", description: "Start a full manual backup of the instance.", fields: [backupName, { key: "description", label: "Description", type: "textarea", max: 256 }], allowedStatuses: active, impact: "Backup storage is billed while the backup is retained." },
  { id: "delete-backup", label: "Delete manual backup", kind: "action", description: "Permanently delete one completed manual backup of this instance.", fields: [{ key: "backup", label: "Manual backup", type: "select", source: "backups", required: true }], confirmation: true, impact: "The backup is permanently removed and can no longer be restored." },
  { id: "retention", label: "Set backup retention", kind: "update", description: "Replace the automatic backup policy's retention, UTC window, and weekdays.", fields: [
    { key: "keepDays", label: "Retention (days)", type: "number", required: true, min: 1, max: 3660, defaultValue: 7 },
    { key: "backupWindow", label: "Backup window (UTC)", type: "select", source: "backupWindows", required: true },
    { key: "weekdays", label: "Backup weekdays", type: "list", source: "weekdays", required: true, max: 7 },
  ], allowedStatuses: active, confirmation: true, impact: "Automatic backups outside the new retention are removed. Reducing retention can permanently delete older backups." },
  { id: "databases", label: "View databases", kind: "inspect", description: "List databases on this instance.", fields: [], allowedStatuses: active },
  { id: "create-database", label: "Create database", kind: "action", description: "Create one database with an explicit character set.", fields: [databaseName, { key: "characterSet", label: "Character set", type: "select", source: "characterSets", required: true }, commentField], allowedStatuses: active },
  { id: "delete-database", label: "Delete database", kind: "action", description: "Permanently delete one non-system database.", fields: [{ key: "database", label: "Database", type: "select", source: "databases", required: true }], confirmation: true, impact: "The database and all data in it are permanently removed." },
  { id: "db-users", label: "View database users", kind: "inspect", description: "List database users. Passwords are never returned.", fields: [], allowedStatuses: active },
  { id: "create-db-user", label: "Create database user", kind: "action", description: "Create one database account with a password.", fields: [dbUserName, { ...passwordField, label: "Database user password", help: "8-32 characters with at least three character groups; it cannot match the user name or its reverse." }, { key: "hosts", label: "Allowed hosts (MySQL only)", type: "list", max: 10, help: "One per line: % or IPv4 addresses with an optional % suffix. Leave empty to allow all hosts." }, commentField], allowedStatuses: active },
  { id: "delete-db-user", label: "Delete database user", kind: "action", description: "Remove one non-system database account.", fields: [{ key: "user", label: "Database user", type: "select", source: "dbUsers", required: true }], confirmation: true, impact: "Applications using these credentials lose access immediately." },
];

export const rdsManagement: ManagementAdapter = {
  title: "Relational Database Service",
  operations,
  inventory: async (session) => (await listRdsInstancesForProject(session)).map((item) => ({
    id: item.id, name: item.name, status: item.status,
    values: { name: item.name, engine: engines.find((engine) => item.datastore.startsWith(engine)) ?? "", version: item.datastore.split(" ")[1] ?? "", size: gigabytes(item.storage), storageType: item.storageType, chargeMode: item.chargeMode, projectId: item.projectId },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [mysqlFlavors, postgresqlFlavors, mysqlStorage, postgresqlStorage, subnets, groups] = await Promise.all([
        flavorRows(session, "MySQL"), flavorRows(session, "PostgreSQL"), storageRows(session, "MySQL"), storageRows(session, "PostgreSQL"), listSubnetsForProject(session), listSecurityGroupsForProject(session),
      ]);
      const flavors = [...mysqlFlavors, ...postgresqlFlavors];
      const zones = [...new Set(flavors.flatMap((flavor) => Object.entries(flavor.azStatus).filter(([, status]) => status === "normal").map(([zone]) => zone)))];
      return {
        offerings: flavors.map((flavor) => ({ value: JSON.stringify([flavor.engine, flavor.version, flavor.specCode]), label: `${flavor.engine} ${flavor.version} · ${flavor.specCode} · ${flavor.vcpus} vCPU · ${flavor.ram / 1024} GB RAM` })),
        storageTypes: [...new Set([...mysqlStorage, ...postgresqlStorage].map((storage) => storage.name))].filter(Boolean).map((name) => ({ value: name, label: name })),
        zones: zones.map((zone) => ({ value: zone, label: firstString([flavors.find((flavor) => flavor.azDesc[zone])?.azDesc[zone]], zone) })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
      };
    }
    if (operation === "retention") return {
      backupWindows: Array.from({ length: 23 }, (_, hour) => `${String(hour).padStart(2, "0")}:00-${String(hour + 1).padStart(2, "0")}:00`).map((value) => ({ value, label: value })),
      weekdays: [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"], ["6", "Saturday"], ["7", "Sunday"]].map(([value, label]) => ({ value, label })),
    };
    if (!resource || !engines.includes(String(resource.values?.engine ?? "") as Engine)) return {};
    if (operation === "delete-backup") {
      const rows = await backupRows(session, resource.id);
      return { backups: rows.filter((row) => String(row.type).toLowerCase() === "manual" && String(row.status).toUpperCase() === "COMPLETED").map((row) => ({ value: firstString([row.id], ""), label: `${firstString([row.name], "-")} · ${firstString([row.begin_time, row.created], "-")}` })) };
    }
    if (operation === "create-database") return { characterSets: characterSets[resource.values?.engine as Engine] };
    if (operation === "delete-database") {
      const rows = await childRows(session, resource.id, "database");
      return { databases: rows.map((row) => firstString([row.name], "")).filter(Boolean).filter((name) => !systemDatabases[resource.values?.engine as Engine].includes(name.toLowerCase())).map((name) => ({ value: name, label: name })) };
    }
    if (operation === "delete-db-user") {
      const rows = await childRows(session, resource.id, "db_user");
      return { dbUsers: rows.map((row) => firstString([row.name], "")).filter(Boolean).filter((name) => !protectedUsers.includes(name.toLowerCase())).map((name) => ({ value: name, label: name })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    const response = await huaweiFetch<Record<string, unknown>>(session, "rds", `/v3/${session.projectId}/jobs?${new URLSearchParams({ id: entry.jobId! })}`);
    const job = asRecord(response.job);
    const status = String(job.status ?? "").toLowerCase();
    const resourceId = firstString([asArray(asRecord(job.entities).resource_ids)[0]], "") || undefined;
    if (status === "completed") return { state: "succeeded", message: "The RDS cloud job completed successfully.", resourceId };
    if (status === "failed") return { state: "failed", message: "The RDS cloud job failed. Review the instance status before retrying." };
    return { state: "submitted", message: "The RDS cloud job is still processing." };
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listRdsInstances, cloudCacheKeys.summary, ...(resource ? [cloudCacheKeys.rds(resource.id)] : [])],
  execute: async (session, operation, values, resource) => {
    const base = `/v3/${session.projectId}`;
    if (operation === "create") {
      let offering: unknown;
      try { offering = JSON.parse(String(values.offering)); } catch { throw new ManagementInputError("Select an available engine, version, and flavor."); }
      const [engine, version, specCode] = Array.isArray(offering) ? offering : [];
      if (!engines.includes(engine as Engine) || typeof version !== "string" || !version || typeof specCode !== "string" || !specCode) throw new ManagementInputError("Select an available engine, version, and flavor.");
      const diskSize = Number(values.diskSize);
      if (diskSize < 40 || diskSize > 4000 || diskSize % 10) throw new ManagementInputError("Disk capacity must be between 40 and 4000 GB in multiples of 10 GB.");
      assertPassword(String(values.password), engine as Engine, "instance");
      const [flavors, storages, subnets, groups] = await Promise.all([flavorRows(session, engine as Engine), storageRows(session, engine as Engine), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      const flavor = flavors.find((item) => item.specCode === specCode && item.version === version);
      if (!flavor) throw new ManagementInputError("The selected engine, version, or flavor is no longer available.");
      const storage = storages.find((item) => item.name === values.storageType);
      if (!storage) throw new ManagementInputError("The selected storage type is unavailable for this engine.");
      const zone = String(values.zone);
      if (flavor.azStatus[zone] !== "normal") throw new ManagementInputError("The selected flavor is not on sale in this availability zone.");
      if (String(storage.azStatus[zone] ?? "") !== "normal") throw new ManagementInputError("The selected storage type is not on sale in this availability zone.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "rds", `${base}/instances`, { method: "POST", body: JSON.stringify({
        name: values.name,
        datastore: { type: engine, version },
        flavor_ref: specCode,
        volume: { type: storage.name, size: diskSize },
        region: session.region,
        availability_zone: zone,
        vpc_id: subnet.vpcId,
        subnet_id: subnet.neutronNetworkId || subnet.id,
        security_group_id: values.securityGroup,
        password: values.password,
        charge_info: { charge_mode: "postPaid" },
        enterprise_project_id: values.enterpriseProjectId ?? "0",
      }) });
      return { message: "Instance creation submitted. The instance is private; attach a public IP separately if needed.", resourceId: firstString([asRecord(response.instance).id], "") || undefined, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    const instance = resource!;
    if (operation === "rename") {
      await huaweiFetch(session, "rds", `${base}/instances/${encodeURIComponent(instance.id)}/name`, { method: "PUT", body: JSON.stringify({ name: values.name }) });
      return { message: "Instance renamed.", resourceId: instance.id };
    }
    if (operation === "reboot") {
      const response = await runRdsAction(session, instance.id, "reboot", session.projectId);
      return { message: "Instance reboot submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "resize-storage") {
      if (!["postPaid", "Pay-per-use"].includes(String(instance.values?.chargeMode))) throw new ManagementInputError("Prepaid instance changes require a subscription order. This expansion supports pay-per-use instances only.");
      const size = Number(values.size);
      if (size < 40 || size > 4000 || size % 10) throw new ManagementInputError("The new capacity must be between 40 and 4000 GB in multiples of 10 GB.");
      const detail = await getRdsInstanceForProject(session, instance.id);
      const current = detail ? gigabytes(detail.storage) : 0;
      if (!detail || !current) throw new ManagementInputError("The instance's current storage could not be loaded. Retry the operation.");
      if (size <= current || size - current < 10) throw new ManagementInputError(`The new capacity must exceed the current ${current} GB disk by at least 10 GB.`);
      const response = await huaweiFetch<Record<string, unknown>>(session, "rds", `${base}/instances/${encodeURIComponent(instance.id)}/action`, { method: "POST", body: JSON.stringify({ enlarge_volume: { size } }) });
      return { message: "Storage expansion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete") {
      if (!["postPaid", "Pay-per-use"].includes(String(instance.values?.chargeMode))) throw new ManagementInputError("Use subscription cancellation for prepaid instances. This deletion supports pay-per-use instances only.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "rds", `${base}/instances/${encodeURIComponent(instance.id)}`, { method: "DELETE" });
      return { message: "Instance deletion submitted.", resourceId: instance.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "backups") {
      const rows = await backupRows(session, instance.id);
      return { message: `${rows.length} backups loaded.`, facts: rows.map((row) => ({ label: `${firstString([row.name], "-")} · ${firstString([row.type], "-")} · ${firstString([row.status], "-")}`, value: `${firstString([row.begin_time, row.created, row.start_time], "-")} · ${firstString([row.id], "-")}` })) };
    }
    if (operation === "create-backup") {
      const description = String(values.description ?? "").trim();
      if (/[><!"'&=]/.test(description)) throw new ManagementInputError("The description cannot contain the characters > < ! \" ' & =.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "rds", `${base}/backups`, { method: "POST", body: JSON.stringify({ instance_id: instance.id, name: values.name, ...(description ? { description } : {}) }) });
      return { message: "Manual backup creation submitted.", resourceId: firstString([asRecord(response.backup).id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete-backup") {
      const rows = await backupRows(session, instance.id);
      const backup = rows.find((row) => firstString([row.id], "") === values.backup);
      if (!backup) throw new ManagementInputError("Select a manual backup of this instance.", 404);
      if (String(backup.type).toLowerCase() !== "manual") throw new ManagementInputError("Only manual backups can be deleted.", 409);
      if (String(backup.status).toUpperCase() !== "COMPLETED") throw new ManagementInputError("Only completed backups can be deleted.", 409);
      await huaweiFetch(session, "rds", `${base}/backups/${encodeURIComponent(String(values.backup))}`, { method: "DELETE" });
      return { message: "Manual backup deletion accepted.", resourceId: instance.id };
    }
    if (operation === "retention") {
      const engine = engineOf(instance);
      const keepDays = Number(values.keepDays);
      if (keepDays < 1 || keepDays > 3660 || (engine === "MySQL" && keepDays > 732)) throw new ManagementInputError("Retention must be 1-732 days on MySQL and 1-3660 days on PostgreSQL.");
      const weekdays = values.weekdays as string[];
      if (!weekdays.length || weekdays.some((day) => !/^[1-7]$/.test(day))) throw new ManagementInputError("Select at least one backup weekday.");
      await huaweiFetch(session, "rds", `${base}/instances/${encodeURIComponent(instance.id)}/backups/policy`, { method: "PUT", body: JSON.stringify({ backup_policy: { keep_days: keepDays, start_time: values.backupWindow, period: weekdays.join(",") } }) });
      return { message: "Backup retention policy updated.", resourceId: instance.id };
    }
    if (operation === "databases") {
      const rows = await childRows(session, instance.id, "database");
      return { message: `${rows.length} databases loaded.`, facts: rows.map((row) => ({ label: firstString([row.name], "-"), value: [firstString([row.character_set], ""), firstString([row.owner], ""), firstString([row.comment], "")].filter(Boolean).join(" · ") || "No character set reported" })) };
    }
    if (operation === "create-database") {
      const engine = engineOf(instance);
      const name = String(values.name);
      if (engine === "PostgreSQL" && (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name) || /^pg/i.test(name))) throw new ManagementInputError("PostgreSQL database names are up to 63 letters, digits, or underscores, cannot start with pg or a digit, and cannot match template databases.");
      const comment = String(values.comment ?? "").trim();
      await huaweiFetch(session, "rds", `${base}/instances/${encodeURIComponent(instance.id)}/database`, { method: "POST", body: JSON.stringify({ name, character_set: values.characterSet, ...(comment ? { comment } : {}) }) });
      return { message: "Database creation accepted.", resourceId: instance.id };
    }
    if (operation === "delete-database") {
      const engine = engineOf(instance);
      const name = String(values.database);
      if (systemDatabases[engine].includes(name.toLowerCase())) throw new ManagementInputError("System databases cannot be deleted.", 409);
      const rows = await childRows(session, instance.id, "database");
      if (!rows.some((row) => firstString([row.name], "") === name)) throw new ManagementInputError("The selected database was not found on this instance.", 404);
      await huaweiFetch(session, "rds", `${base}/instances/${encodeURIComponent(instance.id)}/database/${encodeURIComponent(name)}`, { method: "DELETE" });
      return { message: "Database deletion accepted.", resourceId: instance.id };
    }
    if (operation === "db-users") {
      const rows = await childRows(session, instance.id, "db_user");
      return { message: `${rows.length} database users loaded.`, facts: rows.map((row) => ({ label: firstString([row.name], "-"), value: [asArray(row.hosts).map(String).join(", "), asArray(row.databases).map(asRecord).map((database) => firstString([database.name], "")).filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No host or database restrictions reported" })) };
    }
    if (operation === "create-db-user") {
      const engine = engineOf(instance);
      const name = String(values.name);
      if (engine === "MySQL" && name.length > 32) throw new ManagementInputError("MySQL database user names are up to 32 characters.");
      if (engine === "PostgreSQL" && (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name) || /^pg/i.test(name))) throw new ManagementInputError("PostgreSQL database user names are up to 63 letters, digits, or underscores and cannot start with pg or a digit.");
      if (protectedUsers.includes(name.toLowerCase())) throw new ManagementInputError("Protected database user names cannot be created.", 409);
      assertPassword(String(values.password), engine, "user", name);
      const hosts = values.hosts as string[] | undefined;
      if (hosts?.length && engine === "PostgreSQL") throw new ManagementInputError("Host restrictions apply to MySQL instances only.");
      if (hosts?.length) for (const host of hosts) { const parts = host.split("."); const wildcard = parts.at(-1) === "%"; const octets = wildcard ? parts.slice(0, -1) : parts; if (host !== "%" && ((!wildcard && parts.length !== 4) || (wildcard && (parts.length < 2 || parts.length > 4)) || octets.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255))) throw new ManagementInputError("Host entries must be % or IPv4 addresses with an optional trailing % component."); }
      const comment = String(values.comment ?? "").trim();
      await huaweiFetch(session, "rds", `${base}/instances/${encodeURIComponent(instance.id)}/db_user`, { method: "POST", body: JSON.stringify({ name, password: values.password, ...(hosts?.length ? { hosts } : {}), ...(comment ? { comment } : {}) }) });
      return { message: "Database user creation accepted.", resourceId: instance.id };
    }
    if (operation === "delete-db-user") {
      await engineOf(instance);
      const name = String(values.user);
      if (protectedUsers.includes(name.toLowerCase())) throw new ManagementInputError("Protected database users cannot be deleted.", 409);
      const rows = await childRows(session, instance.id, "db_user");
      if (!rows.some((row) => firstString([row.name], "") === name)) throw new ManagementInputError("The selected database user was not found on this instance.", 404);
      await huaweiFetch(session, "rds", `${base}/instances/${encodeURIComponent(instance.id)}/db_user/${encodeURIComponent(name)}`, { method: "DELETE" });
      return { message: "Database user deletion accepted.", resourceId: instance.id };
    }
    throw new ManagementInputError("Unsupported RDS operation.");
  },
};
