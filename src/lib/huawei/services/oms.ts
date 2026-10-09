import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  firstString,
  formatBytes,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type OmsMigrationTask = {
  completedSize: string;
  destination: string;
  failedObjects: number;
  id: string;
  name: string;
  progress: string;
  projectId: string;
  projectName: string;
  region: string;
  source: string;
  sourceCloud: string;
  status: string;
  taskType: string;
  totalSize: string;
};

export async function listOmsMigrationTasksForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ tasks?: unknown[] }>(
    session,
    "oms",
    `/v2/${session.projectId}/tasks?offset=0&limit=100`,
    {
      items: ["tasks"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["count", "total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.tasks).map((task): OmsMigrationTask => {
    const item = asRecord(task);
    const source = asRecord(item.src_node);
    const destination = asRecord(item.dst_node);

    return {
      completedSize: formatBytes(item.complete_size),
      destination: firstString([destination.bucket, destination.region], "-"),
      failedObjects: Number(item.failed_num ?? 0),
      id: String(item.id ?? item.task_id ?? item.name ?? ""),
      name: firstString([item.name, item.description, item.id]),
      progress: String(item.progress ?? "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      source: firstString([source.bucket, source.region], "-"),
      sourceCloud: firstString([source.cloud_type, item.src_cloud_type], "-"),
      status: String(item.status ?? "UNKNOWN"),
      taskType: firstString([item.task_type, item.group_type], "-"),
      totalSize: formatBytes(item.total_size),
    };
  });
}

export async function listOmsMigrationTasks(session: BetterUiSession) {
  return loadAcrossProjects(session, listOmsMigrationTasksForProject);
}
