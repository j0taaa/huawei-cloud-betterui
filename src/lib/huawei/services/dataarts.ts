import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type DataArtsInstance = {
  chargingMode: string;
  createdAt: string;
  description: string;
  edition: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  version: string;
  workspaceCount: number;
};

export async function listDataArtsInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "dataarts",
    `/v1/${session.projectId}/instances`,
  );

  return asArray(body.instances).map((instance): DataArtsInstance => {
    const item = asRecord(instance);
    const spec = asRecord(item.spec);

    return {
      chargingMode: firstString(
        [item.charging_mode, item.charge_mode, spec.charging_mode],
        "-",
      ),
      createdAt: firstString([
        item.create_time,
        item.created_at,
        item.createdAt,
      ]),
      description: asString(item.description, ""),
      edition: firstString(
        [item.edition, item.instance_type, spec.edition],
        "-",
      ),
      id: firstString([item.id, item.instance_id]),
      name: firstString([item.name, item.instance_name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.status, item.state], "UNKNOWN"),
      version: firstString([item.version, spec.version], "-"),
      workspaceCount: Number(
        item.workspace_count ?? item.workspaces_count ?? 0,
      ),
    };
  });
}

export async function listDataArtsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDataArtsInstancesForProject);
}
