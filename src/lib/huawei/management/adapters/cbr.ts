import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { createCbrCheckpoint, listCbrBackupsForProject, listCbrVaultsForProject, updateCbrVault } from "@/lib/huawei/services/cbr";
import { listEcsInstancesForProject } from "@/lib/huawei/services/ecs";
import { listEvsDisksForProject } from "@/lib/huawei/services/evs";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

const name = { key: "name", label: "Name", required: true, max: 64, pattern: "^[A-Za-z0-9_-]{1,64}$" };
const capacity = { key: "size", label: "Vault capacity (GB)", type: "number" as const, required: true, min: 10, max: 10485760, defaultValue: 100 };
const policyFields: ManagementField[] = [name, { key: "hour", label: "Daily backup hour (UTC)", type: "number", required: true, min: 0, max: 23, defaultValue: 0 }, { key: "retention", label: "Backup retention (days)", type: "number", required: true, min: 1, max: 99999, defaultValue: 30 }, { key: "enabled", label: "Enabled", type: "boolean", required: true, defaultValue: true }];
const vaultPrefix = ["vault:"], policyPrefix = ["policy:"];
async function policies(session: BetterUiSession) {
  const result = await huaweiList<Record<string, unknown>>(session, "cbr", `/v3/${session.projectId}/policies?limit=1000`, { items: ["policies"], kind: "offset", parameter: "offset", size: 1000, total: ["count", "total_count"] });
  return asArray(result.policies).map(asRecord);
}
export const cbrManagement: ManagementAdapter = {
  title: "Cloud Backup and Recovery",
  operations: [
    { id: "create-vault", label: "Create backup vault", kind: "create", description: "Create a pay-per-use vault for crash-consistent server or disk backups. Attach resources after creation.", fields: [name, capacity, { key: "type", label: "Protected resource type", type: "select", required: true, defaultValue: "server", choices: [{ value: "server", label: "Cloud servers" }, { value: "disk", label: "EVS disks" }] }, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }], impact: "Vault capacity is billed until released. Resources and a backup policy must be attached before automatic backups begin." },
    { id: "update-vault", label: "Configure vault", kind: "update", resourcePrefixes: vaultPrefix, description: "Rename or expand the vault and configure capacity notifications.", fields: [name, capacity, { key: "autoExpand", label: "Automatic expansion", type: "boolean", required: true }, { key: "notify", label: "Capacity notifications", type: "boolean", required: true }, { key: "threshold", label: "Notification threshold (%)", type: "number", required: true, min: 1, max: 100, defaultValue: 80 }], impact: "Larger capacity and automatic expansion increase storage charges." },
    { id: "delete-vault", label: "Delete empty vault", kind: "delete", resourcePrefixes: vaultPrefix, description: "Delete an unlocked vault after detaching resources and deleting its backups.", fields: [], confirmation: true, impact: "The vault configuration is permanently removed." },
    { id: "attach", label: "Protect resources", kind: "action", resourcePrefixes: vaultPrefix, description: "Attach current servers or disks matching the vault type.", fields: [{ key: "resources", label: "Resources", type: "list", required: true, source: "resources", max: 255 }], impact: "Attached resources become eligible for vault backups and consume vault capacity." },
    { id: "detach", label: "Stop protecting resources", kind: "action", resourcePrefixes: vaultPrefix, description: "Detach protected resources while retaining existing backups.", fields: [{ key: "resources", label: "Protected resources", type: "list", required: true, source: "attached", max: 255 }], confirmation: true, impact: "New backups of these resources stop until they are attached to a vault again." },
    { id: "backup", label: "Create resource backup", kind: "action", resourcePrefixes: vaultPrefix, description: "Create a manual backup of one resource currently attached to this vault.", fields: [name, { key: "resource", label: "Protected resource", type: "select", required: true, source: "attached" }], impact: "This operation writes backup data and consumes vault capacity." },
    { id: "backups", label: "View vault backups", kind: "inspect", resourcePrefixes: vaultPrefix, description: "List all backups in this vault.", fields: [] },
    { id: "delete-backup", label: "Delete backup", kind: "action", resourcePrefixes: vaultPrefix, description: "Permanently delete one available backup in this vault.", fields: [{ key: "backup", label: "Backup", type: "select", required: true, source: "backups" }], confirmation: true, impact: "The deleted recovery point cannot be restored." },
    { id: "create-policy", label: "Create daily backup policy", kind: "create", description: "Create a daily schedule using UTC and a retention period.", fields: policyFields, impact: "Enabled schedules create backups and remove expired recovery points automatically." },
    { id: "update-policy", label: "Configure daily backup policy", kind: "update", resourcePrefixes: policyPrefix, description: "Replace this backup policy's schedule with one daily UTC schedule and the selected retention period.", fields: policyFields, confirmation: true, impact: "Every vault using this policy adopts the new schedule. Older backups can be removed when retention is reduced." },
    { id: "delete-policy", label: "Delete backup policy", kind: "delete", resourcePrefixes: policyPrefix, description: "Delete this backup policy after detaching it from vaults.", fields: [], confirmation: true, impact: "Vaults using this policy stop creating scheduled backups." },
    { id: "attach-policy", label: "Attach backup policy", kind: "action", resourcePrefixes: vaultPrefix, description: "Associate an existing backup policy with the vault.", fields: [{ key: "policy", label: "Backup policy", type: "select", source: "policies", required: true }], impact: "The policy's schedule and retention apply to this vault's resources." },
    { id: "detach-policy", label: "Detach backup policy", kind: "action", resourcePrefixes: vaultPrefix, description: "Remove a policy association from the vault.", fields: [{ key: "policy", label: "Attached policy", type: "select", source: "attachedPolicies", required: true }], confirmation: true, impact: "Automatic backups from this policy stop for this vault." },
  ],
  inventory: async (session) => {
    const [vaults, schedules] = await Promise.all([listCbrVaultsForProject(session), policies(session)]);
    return [...vaults.map((vault) => ({ id: `vault:${vault.id}`, name: vault.name, status: vault.status, values: { name: vault.name, size: vault.sizeGb, type: vault.objectType, autoExpand: vault.autoExpand, notify: vault.smnNotify, threshold: vault.threshold ?? 80, locked: vault.locked } })), ...schedules.filter((policy) => policy.operation_type === "backup").map((policy) => ({ id: `policy:${policy.id}`, name: String(policy.name), values: { name: String(policy.name), enabled: policy.enabled === true, retention: Number(asRecord(policy.operation_definition).retention_duration_days) || 30 } }))];
  },
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (!resource?.id.startsWith("vault:")) return {};
    const vault = (await listCbrVaultsForProject(session)).find((vault) => `vault:${vault.id}` === resource.id);
    if (!vault) return {};
    if (["backup", "detach"].includes(operation)) return { attached: vault.resources.map((item) => ({ value: item.id, label: `${item.name} · ${item.type}` })) };
    if (operation === "delete-backup") return { backups: (await listCbrBackupsForProject(session)).filter((backup) => backup.vaultId === vault.id && backup.status.toLowerCase() === "available").map((backup) => ({ value: backup.id, label: `${backup.name} · ${backup.resourceName} · ${backup.createdAt}` })) };
    if (operation === "attach-policy") return { policies: (await policies(session)).filter((policy) => policy.operation_type === "backup").map((policy) => ({ value: String(policy.id), label: String(policy.name) })) };
    if (operation === "detach-policy") return { attachedPolicies: vault.policies.map((policy) => ({ value: policy.id, label: policy.name })) };
    if (operation === "attach") {
      if (!["server", "disk"].includes(vault.objectType)) throw new ManagementInputError("This workflow attaches servers or disks; this vault protects another resource type.", 409);
      const items = vault.objectType === "server" ? await listEcsInstancesForProject(session) : await listEvsDisksForProject(session);
      return { resources: items.filter((item) => !vault.resources.some((attached) => attached.id === item.id)).map((item) => ({ value: item.id, label: item.name })) };
    }
    return {};
  },
  invalidationKeys: () => [cloudCacheKeys.listCbrVaults],
  poll: async (session, entry) => {
    const response = await huaweiFetch<{ checkpoint?: unknown }>(session, "cbr", `/v3/${session.projectId}/checkpoints/${encodeURIComponent(entry.jobId!)}`);
    const checkpoint = asRecord(response.checkpoint);
    const status = String(checkpoint.status).toLowerCase();
    return { state: status === "available" ? "succeeded" : ["error", "error-deleting", "error-restoring"].includes(status) ? "failed" : "submitted", message: status === "available" ? "The backup checkpoint completed successfully." : status.startsWith("error") ? "The backup checkpoint failed. Review CBR task details before retrying." : `The backup checkpoint is ${status || "processing"}.` };
  },
  execute: async (session, operation, values, resource) => {
    const base = `/v3/${session.projectId}`;
    if (operation === "create-vault") {
      const result = await huaweiFetch<{ vault?: unknown }>(session, "cbr", `${base}/vaults`, { method: "POST", body: JSON.stringify({ vault: { name: values.name, billing: { cloud_type: "public", consistent_level: "crash_consistent", object_type: values.type, protect_type: "backup", size: values.size, charging_mode: "post_paid" }, resources: [], enterprise_project_id: values.enterpriseProjectId ?? "0", auto_bind: false, auto_expand: false } }) });
      return { message: "Backup vault creation submitted.", resourceId: firstString([asRecord(result.vault).id], "") || undefined, asynchronous: true };
    }
    if (["create-policy", "update-policy", "delete-policy"].includes(operation)) {
      const policyId = resource?.id.slice(7);
      if (operation === "delete-policy") { await huaweiFetch(session, "cbr", `${base}/policies/${encodeURIComponent(policyId!)}`, { method: "DELETE" }); return { message: "Backup policy deleted." }; }
      const policy = { name: values.name, enabled: values.enabled, ...(operation === "create-policy" ? { operation_type: "backup" } : {}), operation_definition: { retention_duration_days: values.retention }, trigger: { properties: { pattern: [`FREQ=DAILY;INTERVAL=1;BYHOUR=${values.hour};BYMINUTE=00`] } } };
      const result = await huaweiFetch<{ policy?: unknown }>(session, "cbr", `${base}/policies${operation === "update-policy" ? `/${encodeURIComponent(policyId!)}` : ""}`, { method: operation === "create-policy" ? "POST" : "PUT", body: JSON.stringify({ policy }) });
      return { message: "Backup policy saved.", resourceId: firstString([asRecord(result.policy).id, policyId], "") || undefined };
    }
    const vault = (await listCbrVaultsForProject(session)).find((item) => `vault:${item.id}` === resource?.id);
    if (!vault) throw new ManagementInputError("The vault no longer exists in this project.", 404);
    const path = `${base}/vaults/${encodeURIComponent(vault.id)}`;
    if (operation === "backups") return { message: `${vault.backupCount} backups loaded.`, facts: vault.backups.map((backup) => ({ label: `${backup.name} · ${backup.resourceName}`, value: `${backup.status} · ${backup.createdAt} · ${backup.id}` })) };
    if (vault.locked) throw new ManagementInputError("This vault is locked by its owning service.", 409);
    if (operation === "delete-vault") {
      if (vault.backupCount || vault.resources.length) throw new ManagementInputError("Delete backups and detach resources before deleting this vault.", 409);
      await huaweiFetch(session, "cbr", path, { method: "DELETE" });
    } else if (operation === "update-vault") {
      if (Number(values.size) < vault.sizeGb) throw new ManagementInputError("This workflow only expands vault capacity.");
      await updateCbrVault(session, vault.id, { name: String(values.name), sizeGb: Number(values.size), autoExpand: values.autoExpand === true, smnNotify: values.notify === true, threshold: Number(values.threshold) }, session.projectId);
    } else if (operation === "attach" || operation === "detach") {
      const ids = values.resources as string[];
      if (operation === "detach" && ids.some((id) => !vault.resources.some((item) => item.id === id))) throw new ManagementInputError("Select resources currently attached to this vault.");
      await huaweiFetch(session, "cbr", `${path}/${operation === "attach" ? "addresources" : "removeresources"}`, { method: "POST", body: JSON.stringify(operation === "attach" ? { resources: ids.map((id) => ({ id, type: vault.objectType === "server" ? "OS::Nova::Server" : "OS::Cinder::Volume" })) } : { resource_ids: ids }) });
    } else if (operation === "backup") {
      if (!vault.resources.some((item) => item.id === values.resource)) throw new ManagementInputError("Select a resource attached to this vault.");
      const result = await createCbrCheckpoint(session, { name: String(values.name), resourceId: String(values.resource), vaultId: vault.id, projectId: session.projectId });
      return { message: "Backup checkpoint submitted.", jobId: result.checkpoint?.id, asynchronous: true };
    } else if (operation === "delete-backup") {
      const backup = (await listCbrBackupsForProject(session)).find((item) => item.id === values.backup && item.vaultId === vault.id);
      if (!backup || backup.status.toLowerCase() !== "available") throw new ManagementInputError("Select an available backup from this vault.", 409);
      await huaweiFetch(session, "cbr", `${base}/backups/${encodeURIComponent(backup.id)}`, { method: "DELETE" });
    } else if (operation === "attach-policy" || operation === "detach-policy") {
      if (operation === "detach-policy" && !vault.policies.some((policy) => policy.id === values.policy)) throw new ManagementInputError("This policy is not attached to the selected vault.", 404);
      await huaweiFetch(session, "cbr", `${path}/${operation === "attach-policy" ? "associatepolicy" : "dissociatepolicy"}`, { method: "POST", body: JSON.stringify({ policy_id: values.policy }) });
    } else throw new ManagementInputError("Unsupported backup operation.");
    return { message: "Backup operation accepted.", asynchronous: true };
  },
};
