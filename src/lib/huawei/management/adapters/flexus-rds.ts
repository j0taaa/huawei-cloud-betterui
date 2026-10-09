import "server-only";

import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementOutcome } from "@/lib/management-contract";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import {
  assertNativeFlexusRdsInstanceMutable,
  assertNativeFlexusRdsPassword,
  createNativeFlexusRdsBackup,
  deleteNativeFlexusRdsBackup,
  flexusRdsBackupFingerprint,
  flexusRdsPolicyFingerprint,
  getNativeFlexusRdsInstance,
  getNativeFlexusRdsStoragePolicy,
  listNativeFlexusRdsBackups,
  listNativeFlexusRdsInstances,
  parseFlexusRdsResourceId,
  pollNativeFlexusRdsJob,
  rebootNativeFlexusRdsInstance,
  resetNativeFlexusRdsRootPassword,
  updateNativeFlexusRdsStoragePolicy,
  type NativeFlexusRdsInstance,
  type NativeFlexusRdsPolicyPatch,
} from "@/lib/huawei/services/flexus-rds-native";
import type { ManagementAdapter } from "../types";

/*
 * Standalone native Flexus RDS management slice; root composes these operations into the Flexus
 * adapter, pages, registry, and cache. Every mutation rechecks the exact native instance identity
 * and its fresh native name, requires the whitelisted ACTIVE status plus the verified prepaid
 * billing state, and keeps the original rds:{nativeID} resource identity in every outcome.
 * Explicit gaps left for root coverage: minor version upgrades, instance creation (the live Flexus
 * catalog and prepaid unpaid ordering are unverified, and the native charge mode is prePaid only),
 * and instance deletion (prepaid subscription cancellation has no verified native contract), so
 * no create or delete instance operation is exposed and the generic pay-per-use RDS create/delete
 * is never reused for Flexus.
 */

const rdsPrefixes = ["rds:"];

const passwordField: ManagementField = {
  key: "password",
  label: "New root password",
  type: "password",
  required: true,
  min: 8,
  max: 32,
  help: "8-32 characters combining at least three of lowercase, uppercase, digits, and the special characters ~!@#$%^*-_=+?,()&",
};
const backupNameField: ManagementField = {
  key: "name",
  label: "Backup name",
  required: true,
  min: 4,
  max: 64,
  pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$",
  help: "4-64 characters starting with a letter; only letters, digits, hyphens, and underscores.",
};
const backupDescriptionField: ManagementField = {
  key: "description",
  label: "Description",
  type: "textarea",
  max: 256,
  allowEmpty: true,
  help: "Up to 256 characters; cannot contain the characters > ! < \" & ' =.",
};
const backupConfirmationField: ManagementField = {
  key: "backupName",
  label: "Backup name confirmation",
  required: true,
  min: 4,
  max: 64,
  help: "Type the selected backup's current name exactly; this confirmation is separate from the instance confirmation.",
};
const policySwitchField: ManagementField = {
  key: "switch_option",
  label: "Enable storage autoscaling",
  type: "boolean",
  required: true,
  help: "Enable or disable automatic storage expansion for this instance.",
};
const policyLimitField: ManagementField = {
  key: "limit_size",
  label: "Upper limit (GB)",
  type: "number",
  min: 40,
  max: 4000,
  help: "40-4000 GB. Required when enabling; must be no less than the instance's current storage.",
};
const policyThresholdField: ManagementField = {
  key: "trigger_threshold",
  label: "Trigger threshold",
  type: "select",
  choices: [
    { value: "10", label: "10 GB or 10%" },
    { value: "15", label: "15 GB or 15%" },
    { value: "20", label: "20 GB or 20%" },
  ],
  help: "Available storage at or below this threshold triggers autoscaling. Required when enabling.",
};
const policyStepField: ManagementField = {
  key: "step_percent",
  label: "Autoscaling increment (%)",
  type: "number",
  min: 5,
  max: 50,
  help: "5-50% of the allocated storage per expansion; 20% is used when left empty.",
};

const operations: ManagementOperation[] = [
  {
    id: "inspect-rds",
    label: "Inspect instance",
    kind: "inspect",
    description: "Load the instance's verified native identity, state, engine, and billing. Raw metadata, unknown statuses, and secrets are never shown.",
    fields: [],
    resourcePrefixes: rdsPrefixes,
  },
  {
    id: "reboot-rds",
    label: "Reboot instance",
    kind: "action",
    description: "Restart the database engine through the native reboot action and follow its native job.",
    fields: [],
    confirmation: true,
    allowedStatuses: ["ACTIVE"],
    resourcePrefixes: rdsPrefixes,
    impact: "Connections are closed and the instance is unavailable until the reboot completes.",
  },
  {
    id: "reset-rds-password",
    label: "Reset root password",
    kind: "action",
    description:
      "Replace the root password through the native reset. The native acknowledgement carries no job, so the reset stays pending manual verification unless Huawei provides a native job.",
    fields: [passwordField],
    confirmation: true,
    allowedStatuses: ["ACTIVE"],
    resourcePrefixes: rdsPrefixes,
    impact: "The root password is replaced. Sessions and integrations using the old password stop working; connect with the new password to verify it.",
  },
  {
    id: "rds-backups",
    label: "View backups",
    kind: "inspect",
    description: "List the instance's native backups with their documented types and statuses.",
    fields: [],
    resourcePrefixes: rdsPrefixes,
  },
  {
    id: "create-rds-backup",
    label: "Create manual backup",
    kind: "action",
    description:
      "Start a full manual backup. The acknowledgement carries the original native backup identity and no job, so the backup is followed through that identity until it completes.",
    fields: [backupNameField, backupDescriptionField],
    allowedStatuses: ["ACTIVE"],
    resourcePrefixes: rdsPrefixes,
    impact: "Backup storage is billed while the backup is retained.",
  },
  {
    id: "delete-rds-backup",
    label: "Delete manual backup",
    kind: "action",
    description:
      "Permanently delete one completed manual backup after confirming its fresh native name. The empty native acknowledgement is never proof of deletion; the fresh backup list is read back before the deletion is reported.",
    fields: [
      { key: "backup", label: "Manual backup", type: "select", source: "backups", required: true },
      backupConfirmationField,
    ],
    confirmation: true,
    allowedStatuses: ["ACTIVE"],
    resourcePrefixes: rdsPrefixes,
    impact: "The backup is permanently removed and can no longer be restored.",
  },
  {
    id: "rds-storage-policy",
    label: "View storage autoscaling policy",
    kind: "inspect",
    description: "Load the instance's native disk autoscaling policy: switch, upper limit, trigger threshold, and increment.",
    fields: [],
    resourcePrefixes: rdsPrefixes,
  },
  {
    id: "update-rds-storage-policy",
    label: "Configure storage autoscaling policy",
    kind: "update",
    description:
      "Enable or disable automatic storage expansion and set its documented dimensions. The change is verified against a fresh policy readback and stays pending with its fingerprint until the readback matches.",
    fields: [policySwitchField, policyLimitField, policyThresholdField, policyStepField],
    confirmation: true,
    allowedStatuses: ["ACTIVE"],
    resourcePrefixes: rdsPrefixes,
    impact: "Automatic expansion is billed with the new storage. Autoscaling requires a non-negative account balance and is unavailable while the instance is rebooting or upgrading.",
  },
];

function inspectOutcome(instance: NativeFlexusRdsInstance): ManagementOutcome {
  const facts = [
    { label: "Instance ID", value: instance.id },
    { label: "Native name", value: instance.name },
    { label: "Status", value: instance.status },
    { label: "Engine", value: `${instance.engine} ${instance.version}` },
    { label: "Region", value: instance.region },
    { label: "Charge mode", value: instance.billingVerified ? "prePaid" : "unverified" },
    ...(instance.volumeGb !== null ? [{ label: "Storage", value: `${instance.volumeGb} GB` }] : []),
  ];
  return { message: `Native details loaded for ${instance.name}.`, facts };
}

function backupLabel(backup: { name: string; type: string; status: string; beginTime: string | null; id: string; sizeKb: number | null }) {
  return {
    label: `${backup.name} · ${backup.type} · ${backup.status}`,
    value: `${backup.beginTime ?? "no start time reported"} · ${backup.id}${backup.sizeKb !== null ? ` · ${backup.sizeKb} KB` : ""}`,
  };
}

export const flexusRdsManagement: ManagementAdapter = {
  title: "Flexus RDS",
  operations,
  inventory: async (session) =>
    (await listNativeFlexusRdsInstances(session)).map((instance) => ({
      id: `rds:${instance.id}`,
      name: instance.name,
      status: instance.status,
      values: { engine: instance.engine, version: instance.version, chargeMode: instance.billingVerified ? "prePaid" : "unverified" },
    })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "delete-rds-backup" && resource) {
      const backups = await listNativeFlexusRdsBackups(session, parseFlexusRdsResourceId(resource.id));
      return {
        backups: backups
          .filter((backup) => backup.type === "manual" && backup.status === "COMPLETED")
          .map((backup) => ({ value: backup.id, label: `${backup.name} · ${backup.beginTime ?? "no start time reported"}` })),
      };
    }
    return {};
  },
  poll: async (session, entry) => pollNativeFlexusRdsJob(session, entry),
  invalidationKeys: (resource) => [
    cloudCacheKeys.listRdsInstances,
    cloudCacheKeys.summary,
    ...(resource ? [cloudCacheKeys.rds(parseFlexusRdsResourceId(resource.id))] : []),
  ],
  execute: async (session, operation, values, resource): Promise<ManagementOutcome> => {
    const instanceId = parseFlexusRdsResourceId(resource?.id);
    const mutation = !["inspect-rds", "rds-backups", "rds-storage-policy"].includes(operation);
    const selectedName = typeof resource?.name === "string" ? resource.name : "";
    if (mutation && !selectedName) throw new ManagementInputError("Select the Flexus RDS instance again to load its fresh native name.", 409);
    const instance = await getNativeFlexusRdsInstance(session, instanceId);
    if (mutation) {
      if (selectedName !== instance.name) {
        throw new ManagementInputError("The selected Flexus RDS instance name is not fresh. Refresh the inventory and try again.", 409);
      }
      assertNativeFlexusRdsInstanceMutable(instance);
    }
    if (operation === "inspect-rds") return inspectOutcome(instance);
    if (operation === "rds-backups") {
      const backups = await listNativeFlexusRdsBackups(session, instanceId);
      return { message: `${backups.length} backups loaded.`, facts: backups.map(backupLabel) };
    }
    if (operation === "reboot-rds") {
      const jobId = await rebootNativeFlexusRdsInstance(session, instanceId);
      return { message: "Instance reboot submitted as a native Flexus RDS job.", resourceId: resource!.id, jobId, asynchronous: true };
    }
    if (operation === "reset-rds-password") {
      const password = String(values.password);
      assertNativeFlexusRdsPassword(password);
      const jobId = await resetNativeFlexusRdsRootPassword(session, instanceId, password);
      return {
        message: jobId
          ? "Root password reset accepted. The reset is running as a native cloud job; connect with the new password once it completes."
          : "Root password reset accepted with no native job. It is pending manual verification; connect with the new password to confirm it.",
        resourceId: resource!.id,
        asynchronous: true,
        ...(jobId ? { jobId } : {}),
      };
    }
    if (operation === "create-rds-backup") {
      const name = String(values.name);
      const description = String(values.description ?? "").trim();
      if (/[><!"'&=]/.test(description)) throw new ManagementInputError("The description cannot contain the characters > ! < \" & ' =.");
      const backup = await createNativeFlexusRdsBackup(session, instanceId, name, description || undefined);
      return {
        message: "Manual backup creation accepted. The original backup is followed until it completes on the instance.",
        resourceId: resource!.id,
        observationId: backup.id,
        asynchronous: true,
        verification: flexusRdsBackupFingerprint(backup.id),
      };
    }
    if (operation === "delete-rds-backup") {
      const backups = await listNativeFlexusRdsBackups(session, instanceId);
      const backup = backups.find((item) => item.id === String(values.backup));
      if (!backup) throw new ManagementInputError("Select a manual backup of this instance.", 404);
      if (backup.type !== "manual") throw new ManagementInputError("Only manual backups can be deleted.", 409);
      if (backup.status !== "COMPLETED") throw new ManagementInputError("Only completed backups can be deleted.", 409);
      if (String(values.backupName) !== backup.name) {
        throw new ManagementInputError("The typed backup name does not match the backup's fresh native name. Refresh the form and try again.", 409);
      }
      await deleteNativeFlexusRdsBackup(session, backup.id);
      let readback;
      try { readback = await listNativeFlexusRdsBackups(session, instanceId); }
      catch { return { message: "Manual backup deletion accepted. The current backup list could not be verified; check operation history before retrying.", resourceId: resource!.id, observationId: backup.id, asynchronous: true, verification: flexusRdsBackupFingerprint(backup.id) }; }
      if (!readback.some((item) => item.id === backup.id)) {
        return { message: "Manual backup deleted and verified gone from the fresh backup list.", resourceId: resource!.id };
      }
      return {
        message: "Manual backup deletion accepted; the backup is still on the fresh backup list and stays pending.",
        resourceId: resource!.id,
        observationId: backup.id,
        asynchronous: true,
        verification: flexusRdsBackupFingerprint(backup.id),
      };
    }
    if (operation === "rds-storage-policy") {
      const policy = await getNativeFlexusRdsStoragePolicy(session, instanceId);
      const facts = [
        { label: "Autoscaling", value: policy.switchOption ? "enabled" : "disabled" },
        ...(policy.limitSizeGb !== null ? [{ label: "Upper limit", value: `${policy.limitSizeGb} GB` }] : []),
        ...(policy.triggerThreshold !== null ? [{ label: "Trigger threshold", value: `${policy.triggerThreshold} GB or ${policy.triggerThreshold}%` }] : []),
        ...(policy.stepPercent !== null ? [{ label: "Increment", value: `${policy.stepPercent}%` }] : []),
      ];
      return { message: `Storage autoscaling policy loaded for ${instance.name}.`, facts };
    }
    if (operation === "update-rds-storage-policy") {
      const patch: NativeFlexusRdsPolicyPatch = { switch_option: values.switch_option === true };
      if (values.switch_option === true) {
        if (values.limit_size === undefined) throw new ManagementInputError("Enter the autoscaling upper limit.");
        if (values.trigger_threshold === undefined) throw new ManagementInputError("Select the autoscaling trigger threshold.");
        const limitSize = Number(values.limit_size);
        const threshold = Number(values.trigger_threshold);
        if (![10, 15, 20].includes(threshold)) throw new ManagementInputError("Select the autoscaling trigger threshold.");
        if (instance.volumeGb === null) {
          throw new ManagementInputError("The instance's current storage could not be verified; the autoscaling limit cannot be checked.", 409);
        }
        if (limitSize < instance.volumeGb) {
          throw new ManagementInputError(`The autoscaling upper limit must be no less than the current ${instance.volumeGb} GB storage.`, 409);
        }
        patch.limit_size = limitSize;
        patch.trigger_threshold = threshold;
        if (values.step_percent !== undefined) {
          const stepPercent = Number(values.step_percent);
          if (!Number.isSafeInteger(stepPercent) || stepPercent < 5 || stepPercent > 50) {
            throw new ManagementInputError("The autoscaling increment must be 5-50%.");
          }
          patch.step_percent = stepPercent;
        }
      }
      await updateNativeFlexusRdsStoragePolicy(session, instanceId, patch);
      const verification = flexusRdsPolicyFingerprint(patch);
      let policy;
      try { policy = await getNativeFlexusRdsStoragePolicy(session, instanceId); }
      catch { return { message: "Storage autoscaling policy accepted. The current policy could not be verified; check operation history before retrying.", resourceId: resource!.id, observationId: instanceId, asynchronous: true, verification }; }
      const current: Record<string, boolean | number> = {};
      let verifiable = true;
      for (const field of verification.fields) {
        if (field === "switch_option") current.switch_option = policy.switchOption;
        else if (field === "limit_size") {
          if (policy.limitSizeGb === null) verifiable = false;
          else current.limit_size = policy.limitSizeGb;
        } else if (field === "trigger_threshold") {
          if (policy.triggerThreshold === null) verifiable = false;
          else current.trigger_threshold = policy.triggerThreshold;
        } else {
          if (policy.stepPercent === null) verifiable = false;
          else current.step_percent = policy.stepPercent;
        }
      }
      if (verifiable && flexusRdsPolicyFingerprint(current).digest === verification.digest) {
        return { message: "Storage autoscaling policy updated and verified on the fresh policy.", resourceId: resource!.id, verification };
      }
      return {
        message: "Storage autoscaling policy accepted; the change is not visible on the fresh policy yet and stays pending.",
        resourceId: resource!.id,
        observationId: instanceId,
        asynchronous: true,
        verification,
      };
    }
    throw new ManagementInputError("Unsupported Flexus RDS operation.");
  },
};
