import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString, formatBytes } from "@/lib/huawei/parsers";
import { listDcsRedisInstancesForProject } from "@/lib/huawei/services/dcs";
import { listSubnetsForProject, listSecurityGroupsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const name: ManagementField = { key: "name", label: "Instance name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$" };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", allowEmpty: true, max: 1024 };
const password: ManagementField = { key: "password", label: "Password", type: "password", min: 8, max: 32, help: "Required unless password-free access is enabled. Use 8-32 characters with at least three of uppercase letters, lowercase letters, numbers, and punctuation." };
const backup: ManagementField = { key: "backup", label: "Backup", type: "select", source: "backups", required: true };
const remark: ManagementField = { key: "remark", label: "Remark", max: 200 };
const running = ["RUNNING"];
const operations: ManagementOperation[] = [
  { id: "create", label: "Create instance", kind: "create", description: "Provision a pay-per-use Redis instance from the live flavor catalog and this project's network.", impact: "The instance is billed while it exists. Confirm the region, capacity, and network before submitting. Password-free access lets any client allowed by the security group use the cache without authenticating.", fields: [name, description,
    { key: "offering", label: "Version, specification, and capacity", type: "select", source: "offerings", required: true, max: 512 },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "noPasswordAccess", label: "Allow access without a password", type: "boolean", defaultValue: false },
    password,
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "update", label: "Edit instance", kind: "update", description: "Change the instance name and description.", fields: [name, description], allowedStatuses: running },
  { id: "restart", label: "Restart instance", kind: "action", description: "Restart the Redis service.", fields: [], allowedStatuses: running, confirmation: true, impact: "Client connections are dropped while the instance restarts." },
  { id: "delete", label: "Delete instance", kind: "delete", description: "Permanently remove the instance and its data.", fields: [], confirmation: true, impact: "The instance and all cached data are permanently deleted." },
  { id: "expand-capacity", label: "Expand capacity", kind: "action", description: "Increase instance memory capacity using the resize catalog for this instance.", allowedStatuses: running, impact: "The larger capacity is billed and cannot be reduced through this operation.", fields: [{ key: "offering", label: "New specification and capacity", type: "select", source: "resizeOfferings", required: true, max: 512 }] },
  { id: "backups", label: "View backups", kind: "inspect", description: "List backup records for the instance.", fields: [] },
  { id: "create-backup", label: "Create backup", kind: "action", description: "Start a manual backup of the instance.", allowedStatuses: running, fields: [remark] },
  { id: "delete-backup", label: "Delete backup", kind: "action", description: "Delete one stored backup file.", allowedStatuses: running, fields: [backup], confirmation: true, impact: "The backup file is permanently removed and can no longer be restored." },
  { id: "restore-backup", label: "Restore backup", kind: "action", description: "Overwrite instance data with a stored backup.", allowedStatuses: running, fields: [{ ...backup, source: "restorableBackups" }, remark], confirmation: true, impact: "Current instance data is replaced by the backup content. Clients lose connectivity during the restore." },
  { id: "configure-backup-policy", label: "Configure backup retention", kind: "update", description: "Schedule automatic backups and how long they are retained.", allowedStatuses: running, impact: "Reducing retention can permanently remove older backups.", fields: [
    { key: "saveDays", label: "Retention days", type: "number", required: true, min: 1, max: 7 },
    { key: "backupAt", label: "Backup weekdays", type: "list", source: "weekdays", required: true, max: 7 },
    { key: "beginAt", label: "Backup start hour (UTC)", type: "select", required: true, choices: Array.from({ length: 24 }, (_, hour) => ({ value: `${String(hour).padStart(2, "0")}:00-${String(hour + 1).padStart(2, "0")}:00`, label: `${String(hour).padStart(2, "0")}:00 UTC` })) },
    { key: "timezoneOffset", label: "Timezone offset", max: 5, defaultValue: "+0000", help: "Legacy timezone metadata (for example -0300). Backup start hour is UTC; current APIs ignore this metadata." },
  ] },
];

type Offering = { value: string; label: string; specCode: string; engineVersion: string; capacity: string; azCodes: string[] };
function instancePath(session: BetterUiSession, resource?: ManagementResource) { return `/v2/${session.projectId}/instances/${encodeURIComponent(resource!.id)}`; }
function choice(value: string, label = value) { return { value, label }; }

async function flavors(session: BetterUiSession, query = "") {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dcs", `/v2/${session.projectId}/flavors${query}`);
  return asArray(body.flavors).map(asRecord);
}
/** Only Redis 4.0+ hourly flavors are creatable through the v2 pay-per-use contract. */
function catalog(records: Record<string, unknown>[]): Offering[] {
  return records.flatMap((flavor) => {
    if (String(flavor.engine).toLowerCase() !== "redis") return [];
    const engineVersion = firstString([flavor.engine_version], "");
    const major = Number(engineVersion.match(/^(\d+)/)?.[1]);
    if (!(major >= 4)) return [];
    if (!asArray(flavor.billing_mode).some((mode) => String(mode).toLowerCase() === "hourly")) return [];
    return asArray(flavor.capacity).map((capacity) => {
      const text = String(capacity);
      const zones = asArray(flavor.flavors_available_zones).map(asRecord).find((entry) => String(entry.capacity) === text);
      return {
        value: JSON.stringify([String(flavor.spec_code), engineVersion, text]),
        label: `${flavor.spec_code} · Redis ${engineVersion} · ${text} GB · ${firstString([flavor.cache_mode], "")}`,
        specCode: String(flavor.spec_code),
        engineVersion,
        capacity: text,
        azCodes: asArray(zones?.az_codes).map(String),
      };
    });
  });
}
async function zones(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dcs", "/v2/available-zones");
  return asArray(body.available_zones).map(asRecord).filter((zone) => String(zone.resource_availability) === "true").map((zone) => choice(String(zone.code), firstString([zone.name, zone.code])));
}
async function backups(session: BetterUiSession, resource: ManagementResource) {
  const body = await huaweiList<Record<string, unknown>>(session, "dcs", `${instancePath(session, resource)}/backups?limit=100&offset=0`, { items: ["backup_record_response"], kind: "offset", parameter: "offset", size: 100, total: ["total_num"] });
  return asArray(body.backup_record_response).map(asRecord).filter(item => !item.instance_id || item.instance_id === resource.id);
}
function backupId(item: Record<string, unknown>) { return firstString([item.backup_id, item.id], ""); }
function restorable(item: Record<string, unknown>) { return item.is_support_restore === true || String(item.is_support_restore).toLowerCase() === "true"; }
function backupChoices(records: Record<string, unknown>[]) {
  return records.map((item) => ({ value: backupId(item), label: `${firstString([item.backup_name, item.backup_id], "Backup")} · ${firstString([item.status], "")}` })).filter((item) => !!item.value);
}
function assertPassword(value: string) {
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("Password must include at least three character groups.");
}
function assertResults(response: Record<string, unknown>, id: string) {
  const results = asArray(response.results).map(asRecord);
  const own = results.find((result) => firstString([result.instance], "") === id);
  if (!own || own.result !== "success") throw new Error(firstString([own?.error_msg, own?.message], "Huawei rejected the DCS Redis operation."));
}

export const dcsManagement: ManagementAdapter = {
  title: "DCS Redis",
  operations,
  inventory: async (session) => (await listDcsRedisInstancesForProject(session)).map((item) => ({ id: item.id, name: item.name, status: item.status, values: { name: item.name, description: item.description === "-" ? "" : item.description, capacityGb: item.capacityGb, specCode: item.resourceSpecCode, chargingMode: item.chargingMode, projectId: item.projectId } })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [records, zoneList, subnets, groups] = await Promise.all([flavors(session), zones(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      return { offerings: catalog(records).map(({ value, label }) => ({ value, label })), zones: zoneList, subnets: subnets.map((subnet) => choice(subnet.id, `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}`)), securityGroups: groups.map((group) => choice(group.id, group.name)) };
    }
    if (!resource) return {};
    if (operation === "expand-capacity") return { resizeOfferings: catalog(await flavors(session, `?instance_id=${encodeURIComponent(resource.id)}`)).map(({ value, label }) => ({ value, label })) };
    if (["delete-backup", "restore-backup"].includes(operation)) {
      const records = await backups(session, resource);
      return { backups: backupChoices(records), restorableBackups: backupChoices(records.filter(restorable)) };
    }
    if (operation === "configure-backup-policy") return { weekdays: [1, 2, 3, 4, 5, 6, 7].map((day) => choice(String(day), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day - 1])) };
    return {};
  },
  invalidationKeys: () => [cloudCacheKeys.listDcsRedisInstances, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    const base = `/v2/${session.projectId}/instances`;
    if (operation === "create") {
      const [records, subnets] = await Promise.all([flavors(session), listSubnetsForProject(session)]);
      const offering = catalog(records).find((item) => item.value === values.offering);
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!offering || !subnet) throw new ManagementInputError("The selected flavor or subnet is no longer available.");
      if (!(await zones(session)).some((zone) => zone.value === values.zone)) throw new ManagementInputError("The selected availability zone is no longer available.");
      if (offering.azCodes.length && !offering.azCodes.includes(String(values.zone))) throw new ManagementInputError("The selected capacity is unavailable in this availability zone.");
      const noPassword = values.noPasswordAccess === true;
      if (!noPassword) {
        if (!values.password) throw new ManagementInputError("Password is required unless password-free access is enabled.");
        assertPassword(String(values.password));
      }
      const response = await huaweiFetch<Record<string, unknown>>(session, "dcs", base, { method: "POST", body: JSON.stringify({
        name: values.name, engine: "Redis", engine_version: offering.engineVersion, capacity: Number(offering.capacity), spec_code: offering.specCode,
        az_codes: [values.zone], vpc_id: subnet.vpcId, subnet_id: subnet.neutronNetworkId || subnet.id, security_group_id: values.securityGroup,
        description: values.description ?? "", instance_num: 1, enable_publicip: false, no_password_access: noPassword,
        ...(noPassword ? {} : { password: values.password }),
        enterprise_project_id: values.enterpriseProjectId ?? "0", bss_param: { charging_mode: "postPaid" },
      }) });
      const instances = asArray(response.instances).map(asRecord);
      return { message: "Instance creation submitted.", resourceId: firstString([asRecord(instances[0]).instance_id], "") || undefined, asynchronous: true };
    }
    const path = instancePath(session, resource);
    if (operation === "update") {
      await huaweiFetch(session, "dcs", path, { method: "PUT", body: JSON.stringify({ name: values.name, description: values.description ?? "" }) });
      return { message: "Instance details updated.", resourceId: resource!.id };
    }
    if (operation === "restart") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "dcs", `${base}/status`, { method: "PUT", body: JSON.stringify({ action: "restart", instances: [resource!.id] }) });
      assertResults(response, resource!.id);
      return { message: "Instance restart submitted.", resourceId: resource!.id, asynchronous: true };
    }
    if (operation === "delete") {
      if (resource?.values?.chargingMode !== "Pay-per-use") throw new ManagementInputError("Use the subscription cancellation workflow for prepaid instances. This deletion supports pay-per-use instances only.");
      await huaweiFetch(session, "dcs", path, { method: "DELETE" });
      return { message: "Instance deletion submitted.", resourceId: resource!.id, asynchronous: true };
    }
    if (operation === "expand-capacity") {
      if (resource?.values?.chargingMode !== "Pay-per-use") throw new ManagementInputError("This expansion supports pay-per-use instances only. Prepaid changes require a subscription order.");
      const offering = catalog(await flavors(session, `?instance_id=${encodeURIComponent(resource!.id)}`)).find((item) => item.value === values.offering);
      if (!offering) throw new ManagementInputError("The selected capacity is no longer available for this instance.");
      if (!(Number(offering.capacity) > Number(resource?.values?.capacityGb ?? 0))) throw new ManagementInputError("Choose a capacity larger than the current one; capacity cannot shrink.");
      await huaweiFetch(session, "dcs", `${path}/resize`, { method: "POST", body: JSON.stringify({ spec_code: offering.specCode, new_capacity: Number(offering.capacity), execute_immediately: true, bss_param: { charging_mode: "postPaid" } }) });
      return { message: "Capacity expansion submitted.", resourceId: resource!.id, asynchronous: true };
    }
    if (operation === "backups") {
      const records = await backups(session, resource!);
      return { message: `${records.length} backups loaded.`, facts: records.map((item) => ({ label: firstString([item.backup_name, item.backup_id], "Backup"), value: [firstString([item.status], ""), item.size !== undefined ? formatBytes(item.size) : "", firstString([item.created_at], "")].filter(Boolean).join(" · ") || firstString([item.backup_id], "Stored") })) };
    }
    if (operation === "create-backup") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "dcs", `${path}/backups`, { method: "POST", body: JSON.stringify({ remark: values.remark ?? "" }) });
      return { message: "Backup creation submitted.", resourceId: firstString([response.backup_id], "") || resource!.id, asynchronous: true };
    }
    if (operation === "delete-backup") {
      if (!(await backups(session, resource!)).some((item) => backupId(item) === values.backup)) throw new ManagementInputError("The selected backup is not in this instance.", 404);
      await huaweiFetch(session, "dcs", `${path}/backups/${encodeURIComponent(String(values.backup))}`, { method: "DELETE" });
      return { message: "Backup deletion submitted.", resourceId: resource!.id, asynchronous: true };
    }
    if (operation === "restore-backup") {
      const backup = (await backups(session, resource!)).find((item) => backupId(item) === values.backup);
      if (!backup) throw new ManagementInputError("The selected backup is not in this instance.", 404);
      if (!restorable(backup)) throw new ManagementInputError("The selected backup cannot be restored to this instance.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "dcs", `${path}/restores`, { method: "POST", body: JSON.stringify({ backup_id: values.backup, remark: values.remark ?? "" }) });
      return { message: "Restore submitted.", resourceId: resource!.id, asynchronous: true, facts: [{ label: "Restore record", value: firstString([response.restore_id], "-") }] };
    }
    if (operation === "configure-backup-policy") {
      const offset = values.timezoneOffset !== undefined ? Number(values.timezoneOffset) : NaN;
      if (values.timezoneOffset !== undefined && (!/^[+-]\d{4}$/.test(String(values.timezoneOffset)) || !Number.isFinite(offset) || Math.abs(offset) > 1200 || Math.abs(offset) % 100 >= 60 || Math.floor(Math.abs(offset) / 100) === 12 && Math.abs(offset) % 100 !== 0)) throw new ManagementInputError("Timezone offset must be a number between -1200 and +1200.");
      await huaweiFetch(session, "dcs", path, { method: "PUT", body: JSON.stringify({ instance_backup_policy: {
        backup_type: "auto", save_days: values.saveDays,
        periodical_backup_plan: { ...(values.timezoneOffset !== undefined ? { timezone_offset: values.timezoneOffset } : {}), backup_at: (values.backupAt as string[]).map(Number), period_type: "weekly", begin_at: values.beginAt },
      } }) });
      return { message: "Backup retention policy updated.", resourceId: resource!.id };
    }
    throw new ManagementInputError("Unsupported DCS Redis operation.");
  },
};
