import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asRecord,
  asArray,
  firstString,
  timestampMillis,
} from "@/lib/huawei/parsers";
import { loadAcrossCodeArtsProjects } from "@/lib/huawei/codearts-projects";

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
      items: ["pipelines"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total"],
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

  return asArray(body.pipelines).map((pipeline): CodeArtsPipelineItem => {
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
        asRecord(item.latest_run).start_time ?? item.update_time,
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
        [asRecord(item.latest_run).status],
        "NOT_RUN",
      ),
    };
  });
}

export async function listCodeArtsPipelines(session: BetterUiSession) {
  return loadAcrossCodeArtsProjects(session, listCodeArtsPipelinesForProject);
}
