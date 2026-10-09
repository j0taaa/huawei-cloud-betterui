import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type LtsLogGroup = {
  alias: string;
  createdAt: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  tags: number;
  ttlDays: string;
};

export async function listLtsLogGroupsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiFetch<{
    log_groups?: unknown[];
    groups?: unknown[];
  }>(session, "lts", `/v2/${session.projectId}/groups`);

  return asArray(body.log_groups ?? body.groups).map((group): LtsLogGroup => {
    const item = asRecord(group);

    return {
      alias: firstString([item.log_group_name_alias, item.alias], ""),
      createdAt: firstString([
        item.creation_time,
        item.created_at,
        item.createdAt,
      ]),
      id: firstString([item.log_group_id, item.id]),
      name: firstString([item.log_group_name, item.name]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      tags: asArray(item.tag).length || asArray(item.tags).length,
      ttlDays: firstString([item.ttl_in_days === undefined ? undefined : String(item.ttl_in_days), item.ttl === undefined ? undefined : String(item.ttl)], "-"),
    };
  });
}

export async function listLtsLogGroups(session: BetterUiSession) {
  return loadAcrossProjects(session, listLtsLogGroupsForProject);
}
