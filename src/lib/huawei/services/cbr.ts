import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  formatBytes,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CbrVault = {
  allocated: string;
  autoBind: string;
  createdAt: string;
  id: string;
  name: string;
  objectType: string;
  projectId: string;
  projectName: string;
  providerId: string;
  region: string;
  resources: number;
  size: string;
  status: string;
};

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

  return asArray(body.vaults).map((vault): CbrVault => {
    const item = asRecord(vault);
    const billing = asRecord(item.billing);
    const resources = asArray(item.resources);

    return {
      allocated: formatBytes(billing.allocated),
      autoBind: String(item.auto_bind ?? "-"),
      createdAt: firstString([item.created_at, item.createdAt]),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      objectType: firstString([billing.object_type, item.object_type]),
      projectId: session.projectId,
      projectName: session.projectName,
      providerId: asString(item.provider_id, "-"),
      region: session.region,
      resources: resources.length,
      size: formatBytes(billing.size),
      status: asString(item.status, "UNKNOWN"),
    };
  });
}

export async function listCbrVaults(session: BetterUiSession) {
  return loadAcrossProjects(session, listCbrVaultsForProject);
}
