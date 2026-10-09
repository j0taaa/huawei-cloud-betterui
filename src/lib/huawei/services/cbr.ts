import { finishCloudLoad, settledValue } from "@/lib/huawei/errors";
import { huaweiList } from "@/lib/huawei/http";
import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  huaweiFetch,
  loadAcrossProjects,
  projectForId,
} from "@/lib/huawei/core";

export type CbrProtectedResource = {
  extraInfo: Array<{ key: string; value: string }>;
  id: string;
  name: string;
  protectStatus: string;
  sizeGb: number;
  type: string;
};

export type CbrBackup = {
  autoTriggered: boolean;
  createdAt: string;
  expiredAt: string;
  id: string;
  imageType: string;
  incremental: boolean;
  name: string;
  protectedAt: string;
  resourceId: string;
  resourceName: string;
  resourceSizeGb: number;
  resourceType: string;
  status: string;
  vaultId: string;
};

export type CbrVault = {
  allocatedGb: number;
  autoBind: boolean;
  autoExpand: boolean;
  backupCount: number;
  backups: CbrBackup[];
  chargingMode: string;
  cloudType: string;
  consistentLevel: string;
  createdAt: string;
  description: string;
  enterpriseProjectId: string;
  id: string;
  locked: boolean;
  name: string;
  objectType: string;
  policies: Array<{ id: string; name: string }>;
  protectType: string;
  projectId: string;
  projectName: string;
  providerId: string;
  region: string;
  resources: CbrProtectedResource[];
  sizeGb: number;
  smnNotify: boolean;
  specCode: string;
  status: string;
  tags: Array<{ key: string; value: string }>;
  threshold: number | null;
  usedGb: number;
};

export type CbrVaultUpdateInput = {
  autoExpand?: boolean;
  name?: string;
  sizeGb?: number;
  smnNotify?: boolean;
  threshold?: number;
};

export type CreateCbrCheckpointInput = {
  description?: string;
  name: string;
  projectId?: string;
  resourceId: string;
  vaultId: string;
};

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);

  return Number.isFinite(number) ? number : fallback;
}

function compactObjectEntries(value: Record<string, unknown>) {
  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && item !== "")
    .map(([key, item]) => ({ key, value: String(item) }));
}

function mapCbrResource(resource: unknown): CbrProtectedResource {
  const item = asRecord(resource);

  return {
    extraInfo: compactObjectEntries(
      asRecord(item.extra_info ?? item.extraInfo),
    ),
    id: asString(item.id),
    name: firstString([item.name, item.id]),
    protectStatus: firstString([item.protect_status, item.status], "UNKNOWN"),
    sizeGb: asNumber(item.size),
    type: firstString([item.type, item.resource_type]),
  };
}

function mapCbrBackup(backup: unknown): CbrBackup {
  const item = asRecord(backup);
  const extendInfo = asRecord(item.extend_info ?? item.extendInfo);

  return {
    autoTriggered: asBoolean(extendInfo.auto_trigger),
    createdAt: firstString([item.created_at, item.createdAt]),
    expiredAt: firstString([item.expired_at, item.expiredAt]),
    id: asString(item.id),
    imageType: asString(item.image_type, "-"),
    incremental: asBoolean(item.incremental),
    name: firstString([item.name, item.id]),
    protectedAt: firstString([item.protected_at, item.protectedAt]),
    resourceId: asString(item.resource_id),
    resourceName: firstString([item.resource_name, item.resource_id]),
    resourceSizeGb: asNumber(item.resource_size),
    resourceType: asString(item.resource_type, "-"),
    status: asString(item.status, "UNKNOWN"),
    vaultId: asString(item.vault_id),
  };
}

function mapCbrVault(vault: unknown, session: HuaweiProjectSession): CbrVault {
  const item = asRecord(vault);
  const billing = asRecord(item.billing);
  const resources = asArray(item.resources).map(mapCbrResource);
  const policies = asArray(item.policies ?? item.policy).map((policy) => {
    const policyItem = asRecord(policy);

    return {
      id: asString(policyItem.id),
      name: firstString([policyItem.name, policyItem.id]),
    };
  });
  const tags = asArray(item.tags).map((tag) => {
    const tagItem = asRecord(tag);

    return {
      key: asString(tagItem.key),
      value: asString(tagItem.value, ""),
    };
  });

  return {
    allocatedGb: asNumber(billing.allocated),
    autoBind: asBoolean(item.auto_bind),
    autoExpand: asBoolean(item.auto_expand),
    backupCount: 0,
    backups: [],
    chargingMode: asString(billing.charging_mode, "-"),
    cloudType: asString(billing.cloud_type, "-"),
    consistentLevel: asString(billing.consistent_level, "-"),
    createdAt: firstString([item.created_at, item.createdAt]),
    description: asString(item.description, ""),
    enterpriseProjectId: asString(item.enterprise_project_id, "-"),
    id: asString(item.id),
    locked: asBoolean(item.locked),
    name: firstString([item.name, item.id]),
    objectType: firstString([billing.object_type, item.object_type]),
    policies,
    protectType: asString(billing.protect_type, "-"),
    projectId: session.projectId,
    projectName: session.projectName,
    providerId: asString(item.provider_id, "-"),
    region: session.region,
    resources,
    sizeGb: asNumber(billing.size),
    smnNotify: asBoolean(item.smn_notify, true),
    specCode: asString(billing.spec_code, "-"),
    status: asString(item.status, "UNKNOWN"),
    tags,
    threshold:
      item.threshold === undefined || item.threshold === null
        ? null
        : asNumber(item.threshold),
    usedGb: asNumber(billing.used),
  };
}

export async function listCbrBackupsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ backups?: unknown[] }>(
    session,
    "cbr",
    `/v3/${session.projectId}/backups?limit=1000&sort=created_at:desc`,
    { items: ["backups"], kind: "offset", parameter: "offset", size: 1000, total: ["count", "total_count"] },
  );

  return asArray(body.backups).map(mapCbrBackup);
}

export async function listCbrBackups(session: BetterUiSession) {
  return loadAcrossProjects(session, listCbrBackupsForProject);
}

export async function listCbrVaultsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ vaults?: unknown[] }>(
    session,
    "cbr",
    `/v3/${session.projectId}/vaults?limit=1000`,
    {
      items: ["vaults"],
      kind: "offset",
      parameter: "offset",
      size: 1000,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  const vaults = asArray(body.vaults).map((vault) =>
    mapCbrVault(vault, session),
  );
  const results = await Promise.allSettled([listCbrBackupsForProject(session)]);
  const backups = settledValue(results[0], []);
  const backupsByVault = new Map<string, CbrBackup[]>();

  for (const backup of backups) {
    backupsByVault.set(backup.vaultId, [
      ...(backupsByVault.get(backup.vaultId) ?? []),
      backup,
    ]);
  }

  return finishCloudLoad(
    results,
    vaults.map((vault) => {
      const vaultBackups = backupsByVault.get(vault.id) ?? [];

      return {
        ...vault,
        backupCount: vaultBackups.length,
        backups: vaultBackups,
      };
    }),
    ["Vault backups"],
  );
}

export async function listCbrVaults(session: BetterUiSession) {
  return loadAcrossProjects(session, listCbrVaultsForProject);
}

export async function getCbrVault(
  session: BetterUiSession,
  vaultId: string,
  projectId?: string,
) {
  const vaults = await listCbrVaults(session);

  return (
    vaults.find((vault) => {
      if (vault.id !== vaultId) {
        return false;
      }

      return projectId ? vault.projectId === projectId : true;
    }) ?? null
  );
}

export async function createCbrCheckpoint(
  session: BetterUiSession,
  input: CreateCbrCheckpointInput,
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<{
    checkpoint?: { id?: string; status?: string };
  }>(project, "cbr", `/v3/${project.projectId}/checkpoints`, {
    body: JSON.stringify({
      checkpoint: {
        parameters: {
          auto_trigger: false,
          description: input.description ?? "",
          incremental: true,
          name: input.name,
          resources: [input.resourceId],
        },
        vault_id: input.vaultId,
      },
    }),
    method: "POST",
  });
}

export async function updateCbrVault(
  session: BetterUiSession,
  vaultId: string,
  input: CbrVaultUpdateInput,
  projectId?: string,
) {
  const project = projectForId(session, projectId);
  const billing =
    input.sizeGb === undefined
      ? undefined
      : {
          size: input.sizeGb,
        };
  const vault = {
    ...(billing ? { billing } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.autoExpand !== undefined
      ? { auto_expand: input.autoExpand }
      : {}),
    ...(input.smnNotify !== undefined ? { smn_notify: input.smnNotify } : {}),
    ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
  };

  const body = await huaweiFetch<{ vault?: unknown }>(
    project,
    "cbr",
    `/v3/${project.projectId}/vaults/${encodeURIComponent(vaultId)}`,
    {
      body: JSON.stringify({ vault }),
      method: "PUT",
    },
  );

  return mapCbrVault(body.vault, project);
}
