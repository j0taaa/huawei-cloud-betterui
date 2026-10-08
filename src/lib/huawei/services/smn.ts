import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type SmnTopic = {
  createdAt: string;
  displayName: string;
  enterpriseProjectId: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  pushPolicy: string;
  region: string;
  topicUrn: string;
  updatedAt: string;
};

export async function listSmnTopicsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ topics?: unknown[] }>(
    session,
    "smn",
    `/v2/${session.projectId}/notifications/topics?offset=0&limit=100`,
    {
      items: ["topics"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.topics).map((topic): SmnTopic => {
    const item = asRecord(topic);

    return {
      createdAt: firstString([
        item.create_time,
        item.created_at,
        item.createdAt,
      ]),
      displayName: asString(item.display_name, ""),
      enterpriseProjectId: asString(item.enterprise_project_id, "-"),
      id: firstString([item.topic_id, item.topic_urn, item.name]),
      name: firstString([item.name, item.topic_urn]),
      projectId: session.projectId,
      projectName: session.projectName,
      pushPolicy: String(item.push_policy ?? "-"),
      region: session.region,
      topicUrn: asString(item.topic_urn),
      updatedAt: firstString([
        item.update_time,
        item.updated_at,
        item.updatedAt,
      ]),
    };
  });
}

export async function listSmnTopics(session: BetterUiSession) {
  return loadAcrossProjects(session, listSmnTopicsForProject);
}
