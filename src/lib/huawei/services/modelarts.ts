import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { notebooks as nativeNotebooks } from "@/lib/huawei/services/modelarts-native";
import { asRecord, firstString } from "@/lib/huawei/parsers";
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
  const rows = await nativeNotebooks(session);
  return rows.map(
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
        storage: typeof volume.capacity === "number" && Number.isSafeInteger(volume.capacity) && volume.capacity >= 0 ? `${volume.capacity} GB` : "-",
        workspaceId: String(item.workspace_id ?? "-"),
      };
    },
  );
}

export async function listModelArtsNotebooks(session: BetterUiSession) {
  return loadAcrossProjects(session, listModelArtsNotebooksForProject);
}
