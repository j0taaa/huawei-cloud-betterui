import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type SecMasterWorkspace = {
  createdAt: string;
  creatorName: string;
  description: string;
  enterpriseProjectName: string;
  id: string;
  isView: boolean | null;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  regionId: string;
  updatedAt: string;
};

export async function listSecMasterWorkspacesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ workspaces?: unknown[] }>(
    session,
    "secmaster",
    `/v1/${session.projectId}/workspaces?offset=0&limit=100`,
    {
      items: ["workspaces"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.workspaces).map((workspace): SecMasterWorkspace => {
    const item = asRecord(workspace);

    return {
      createdAt: firstString([
        item.create_time,
        item.created_at,
        item.createdAt,
      ]),
      creatorName: firstString([item.creator_name, item.creator_id], "-"),
      description: asString(item.description, ""),
      enterpriseProjectName: firstString(
        [item.enterprise_project_name, item.enterprise_project_id],
        "-",
      ),
      id: firstString([item.id, item.workspace_id]),
      isView: typeof item.is_view === "boolean" ? item.is_view : null,
      name: firstString([item.name, item.workspace_name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      regionId: firstString([item.region_id, session.region]),
      updatedAt: firstString([
        item.update_time,
        item.updated_at,
        item.updatedAt,
      ]),
    };
  });
}

export async function listSecMasterWorkspaces(session: BetterUiSession) {
  return loadAcrossProjects(session, listSecMasterWorkspacesForProject);
}
