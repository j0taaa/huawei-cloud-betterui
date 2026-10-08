import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type DrsJob = {
  createdAt: string;
  destination: string;
  direction: string;
  engineType: string;
  id: string;
  jobType: string;
  name: string;
  networkType: string;
  projectId: string;
  projectName: string;
  region: string;
  source: string;
  status: string;
};

export async function listDrsJobsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ jobs?: unknown[] }>(
    session,
    "drs",
    `/v5/${session.projectId}/jobs?limit=100`,
    {
      items: ["jobs"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.jobs).map((job): DrsJob => {
    const item = asRecord(job);
    const sourceEndpoint = asRecord(item.source_endpoint ?? item.source);
    const targetEndpoint = asRecord(
      item.target_endpoint ?? item.destination ?? item.target,
    );

    return {
      createdAt: firstString([
        item.created_at,
        item.create_time,
        item.createdAt,
      ]),
      destination: firstString(
        [
          targetEndpoint.db_type,
          targetEndpoint.endpoint_type,
          targetEndpoint.name,
          item.target_db_type,
        ],
        "-",
      ),
      direction: firstString([item.db_use_type, item.direction], "-"),
      engineType: firstString(
        [item.engine_type, item.engine, item.migration_type],
        "-",
      ),
      id: firstString([item.id, item.job_id]),
      jobType: firstString([item.job_type, item.type], "-"),
      name: firstString([item.name, item.job_name, item.id]),
      networkType: firstString([item.net_type, item.network_type], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      source: firstString(
        [
          sourceEndpoint.db_type,
          sourceEndpoint.endpoint_type,
          sourceEndpoint.name,
          item.source_db_type,
        ],
        "-",
      ),
      status: firstString([item.status, item.job_status], "UNKNOWN"),
    };
  });
}

export async function listDrsJobs(session: BetterUiSession) {
  return loadAcrossProjects(session, listDrsJobsForProject);
}
