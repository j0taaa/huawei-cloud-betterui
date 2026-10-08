import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type ModelArtsNotebook = {
  createdAt: string;
  flavor: string;
  id: string;
  image: string;
  name: string;
  pool: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  workspaceId: string;
};

export async function listModelArtsNotebooksForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ data?: unknown[]; notebooks?: unknown[] }>(
    session,
    "modelarts",
    `/v1/${session.projectId}/notebooks/all?limit=50`,
    {
      items: ["data", "notebooks"],
      kind: "offset",
      parameter: "offset",
      size: 50,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.data ?? body.notebooks).map(
    (notebook): ModelArtsNotebook => {
      const item = asRecord(notebook);
      const flavor = asRecord(item.flavor);
      const image = asRecord(item.image);
      const volume = asRecord(item.volume);
      const resourcePool = asRecord(item.pool ?? item.resource_pool);

      return {
        createdAt: firstString([
          item.created_at,
          item.create_time,
          item.createdAt,
        ]),
        flavor: firstString(
          [item.flavor, flavor.name, flavor.code, item.flavor_id],
          "-",
        ),
        id: firstString([item.id, item.instance_id, item.notebook_id]),
        image: firstString([item.image_name, image.name, image.id], "-"),
        name: firstString([item.name, item.instance_name, item.id]),
        pool: firstString(
          [resourcePool.name, item.pool_name, item.resource_pool_name],
          "default",
        ),
        projectId: session.projectId,
        projectName: session.projectName,
        region: session.region,
        status: firstString([item.status, item.state], "UNKNOWN"),
        storage: firstString([volume.size, item.volume_size], "-"),
        workspaceId: String(item.workspace_id ?? "-"),
      };
    },
  );
}

export async function listModelArtsNotebooks(session: BetterUiSession) {
  return loadAcrossProjects(session, listModelArtsNotebooksForProject);
}
