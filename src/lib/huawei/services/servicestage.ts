import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asRecord,
  asString,
  firstResponseArray,
  firstString,
  timestampMillis,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type ServiceStageApplication = {
  componentCount: number;
  createdAt: string;
  creator: string;
  description: string;
  enterpriseProjectId: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  updatedAt: string;
};

export async function listServiceStageApplicationsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<Record<string, unknown>>(
    session,
    "servicestage",
    `/v3/${session.projectId}/cas/applications?limit=100`,
    {
      items: [
        "applications",
        "apps",
        "result",
        "applications.applications",
        "applications.apps",
        "applications.result",
        "apps.applications",
        "apps.apps",
        "apps.result",
        "result.applications",
        "result.apps",
        "result.result",
      ],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return firstResponseArray(body, ["applications", "apps", "result"]).map(
    (application): ServiceStageApplication => {
      const item = asRecord(application);

      return {
        componentCount: Number(
          item.component_count ?? item.components_count ?? 0,
        ),
        createdAt: timestampMillis(item.create_time ?? item.created_at),
        creator: firstString([item.creator, item.creator_name], "-"),
        description: asString(item.description, ""),
        enterpriseProjectId: firstString([item.enterprise_project_id], "-"),
        id: firstString([item.id, item.application_id]),
        name: firstString([item.name, item.application_name, item.id]),
        projectId: session.projectId,
        projectName: session.projectName,
        region: session.region,
        updatedAt: timestampMillis(item.update_time ?? item.updated_at),
      };
    },
  );
}

export async function listServiceStageApplications(session: BetterUiSession) {
  return loadAcrossProjects(session, listServiceStageApplicationsForProject);
}
