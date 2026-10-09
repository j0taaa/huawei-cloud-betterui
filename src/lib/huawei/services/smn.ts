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
import type { SmnTopic } from "@/lib/huawei/services/smn.types";

export type CreateSmnTopicInput = {
  displayName?: string;
  name: string;
  projectId?: string;
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

export async function createSmnTopic(
  session: BetterUiSession,
  input: CreateSmnTopicInput,
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<{ request_id?: string; topic_urn?: string }>(
    project,
    "smn",
    `/v2/${project.projectId}/notifications/topics`,
    {
      body: JSON.stringify({
        display_name: input.displayName ?? "",
        name: input.name,
      }),
      method: "POST",
    },
  );
}

export async function deleteSmnTopic(
  session: BetterUiSession,
  topicUrn: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<{ request_id?: string }>(
    project,
    "smn",
    `/v2/${project.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}`,
    { method: "DELETE" },
  );
}

export type * from "@/lib/huawei/services/smn.types";
