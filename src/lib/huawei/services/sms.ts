import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type SmsMigrationTask = {
  createdAt: string;
  id: string;
  name: string;
  progress: string;
  projectId: string;
  projectName: string;
  region: string;
  sourceServer: string;
  sourceServerId: string;
  state: string;
  syncSpeed: string;
  targetServer: string;
  targetServerId: string;
};

export async function listSmsTasksForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ tasks?: unknown[] }>(
    session,
    "sms",
    "/v3/tasks?limit=100&offset=0",
    {
      items: ["tasks"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.tasks).map((task): SmsMigrationTask => {
    const item = asRecord(task);
    const source = asRecord(item.source_server);
    const target = asRecord(item.target_server);

    return {
      createdAt: firstString([
        item.create_time,
        item.created_at,
        item.createdAt,
      ]),
      id: firstString([item.id, item.task_id]),
      name: firstString([item.name, item.task_name, item.id]),
      progress: String(item.migration_progress ?? item.progress ?? "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      sourceServer: firstString([source.name, item.source_server_name], "-"),
      sourceServerId: firstString([item.source_server_id, source.id], "-"),
      state: firstString([item.state, item.status], "UNKNOWN"),
      syncSpeed: firstString([item.migration_speed, item.sync_speed], "-"),
      targetServer: firstString([target.name, item.target_server_name], "-"),
      targetServerId: firstString([item.target_server_id, target.id], "-"),
    };
  });
}

export async function listSmsTasks(session: BetterUiSession) {
  return loadAcrossProjects(session, listSmsTasksForProject);
}
