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

export type CodeArtsDeployApplication = {
  createdAt: string;
  creator: string;
  description: string;
  groupName: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  updatedAt: string;
};

export async function listCodeArtsDeployApplicationsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<Record<string, unknown>>(
    session,
    "codeartsdeploy",
    "/v1/applications/list",
    {
      items: [
        "applications",
        "app_list",
        "records",
        "result",
        "applications.applications",
        "applications.app_list",
        "applications.records",
        "applications.result",
        "app_list.applications",
        "app_list.app_list",
        "app_list.records",
        "app_list.result",
        "records.applications",
        "records.app_list",
        "records.records",
        "records.result",
        "result.applications",
        "result.app_list",
        "result.records",
        "result.result",
      ],
      kind: "page",
      parameter: "page",
      size: 100,
      first: 1,
      inBody: true,
    },
    {
      body: JSON.stringify({
        page: 1,
        project_id: session.projectId,
        size: 100,
      }),
      method: "POST",
    },
  );

  return firstResponseArray(body, [
    "applications",
    "app_list",
    "records",
    "result",
  ]).map((application): CodeArtsDeployApplication => {
    const item = asRecord(application);

    return {
      createdAt: timestampMillis(item.create_time ?? item.created_at),
      creator: firstString(
        [item.creator, item.creator_name, item.user_name],
        "-",
      ),
      description: asString(item.description, ""),
      groupName: firstString(
        [item.group_name, item.application_group_name],
        "-",
      ),
      id: firstString([item.id, item.application_id, item.app_id]),
      name: firstString([
        item.name,
        item.application_name,
        item.app_name,
        item.id,
      ]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.status, item.application_status], "UNKNOWN"),
      updatedAt: timestampMillis(item.update_time ?? item.updated_at),
    };
  });
}

export async function listCodeArtsDeployApplications(session: BetterUiSession) {
  return loadAcrossProjects(session, listCodeArtsDeployApplicationsForProject);
}
