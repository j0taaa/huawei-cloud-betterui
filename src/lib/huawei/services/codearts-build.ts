import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asRecord,
  firstResponseArray,
  firstString,
  timestampMillis,
} from "@/lib/huawei/parsers";
import { loadAcrossCodeArtsProjects } from "@/lib/huawei/codearts-projects";

export type CodeArtsBuildJob = {
  branch: string;
  buildNumber: string;
  buildTime: string;
  creator: string;
  id: string;
  lastBuildAt: string;
  lastBuildStatus: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  repository: string;
  triggerType: string;
};

export async function listCodeArtsBuildJobsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<Record<string, unknown>>(
    session,
    "codeartsbuild",
    `/v1/job/${session.projectId}/list?page_index=0&page_size=100`,
    {
      items: [
        "job_list",
        "jobs",
        "result",
        "job_list.job_list",
        "job_list.jobs",
        "job_list.result",
        "jobs.job_list",
        "jobs.jobs",
        "jobs.result",
        "result.job_list",
        "result.jobs",
        "result.result",
      ],
      kind: "page",
      parameter: "page_index",
      size: 100,
      first: 0,
    },
  );

  return firstResponseArray(body, ["job_list", "jobs", "result"]).map(
    (job): CodeArtsBuildJob => {
      const item = asRecord(job);

      return {
        branch: firstString([item.code_branch, item.branch], "-"),
        buildNumber: firstString([item.build_number, item.build_id], "-"),
        buildTime: String(item.build_time ?? "-"),
        creator: firstString(
          [item.user_name, item.job_creator, item.creator],
          "-",
        ),
        id: firstString([item.id, item.task_id, item.job_id]),
        lastBuildAt: timestampMillis(item.last_build_time),
        lastBuildStatus: firstString(
          [item.last_build_status, item.last_job_running_status, item.status],
          "UNKNOWN",
        ),
        name: firstString([item.job_name, item.name, item.id]),
        projectId: session.projectId,
        projectName: session.projectName,
        region: session.region,
        repository: firstString(
          [item.scm_web_url, item.repo_id, item.source_code],
          "-",
        ),
        triggerType: firstString([item.trigger_type, item.build_type], "-"),
      };
    },
  );
}

export async function listCodeArtsBuildJobs(session: BetterUiSession) {
  return loadAcrossCodeArtsProjects(session, listCodeArtsBuildJobsForProject);
}
