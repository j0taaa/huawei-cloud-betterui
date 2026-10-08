import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asRecord,
  firstResponseArray,
  firstString,
  timestampMillis,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CodeArtsPipelineItem = {
  creator: string;
  executor: string;
  groupName: string;
  id: string;
  latestRunAt: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  source: string;
  status: string;
};

export async function listCodeArtsPipelinesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<Record<string, unknown>>(
    session,
    "codeartspipeline",
    `/v5/${session.projectId}/api/pipelines/list`,
    {
      items: [
        "pipelines",
        "pipeline_list",
        "items",
        "result",
        "pipelines.pipelines",
        "pipelines.pipeline_list",
        "pipelines.items",
        "pipelines.result",
        "pipeline_list.pipelines",
        "pipeline_list.pipeline_list",
        "pipeline_list.items",
        "pipeline_list.result",
        "items.pipelines",
        "items.pipeline_list",
        "items.items",
        "items.result",
        "result.pipelines",
        "result.pipeline_list",
        "result.items",
        "result.result",
      ],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
      inBody: true,
    },
    {
      body: JSON.stringify({
        limit: 100,
        offset: 0,
        project_id: session.projectId,
      }),
      method: "POST",
    },
  );

  return firstResponseArray(body, [
    "pipelines",
    "pipeline_list",
    "items",
    "result",
  ]).map((pipeline): CodeArtsPipelineItem => {
    const item = asRecord(pipeline);

    return {
      creator: firstString(
        [item.creator_name, item.creator, item.create_user],
        "-",
      ),
      executor: firstString(
        [item.executor_name, item.executor, item.last_executor],
        "-",
      ),
      groupName: firstString([item.group_name, item.pipeline_group_name], "-"),
      id: firstString([item.pipeline_id, item.id]),
      latestRunAt: timestampMillis(
        item.latest_run_time ?? item.update_time ?? item.updated_at,
      ),
      name: firstString([item.name, item.pipeline_name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      source: firstString(
        [item.source, item.trigger_type, item.manifest_version],
        "-",
      ),
      status: firstString(
        [item.status, item.latest_run_status, item.run_status],
        "UNKNOWN",
      ),
    };
  });
}

export async function listCodeArtsPipelines(session: BetterUiSession) {
  return loadAcrossProjects(session, listCodeArtsPipelinesForProject);
}
