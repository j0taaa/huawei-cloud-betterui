import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asRecord,
  firstResponseArray,
  firstString,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CodeArtsRepository = {
  createdAt: string;
  defaultBranch: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  sshUrl: string;
  visibility: string;
  webUrl: string;
};

export async function listCodeArtsRepositoriesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<Record<string, unknown>>(
    session,
    "codeartsrepo",
    `/v4/projects/${session.projectId}/repositories?offset=0&limit=100&order_by=updated_at&sort=desc`,
    {
      items: [
        "repositories",
        "repository_list",
        "result",
        "repositories.repositories",
        "repositories.repository_list",
        "repositories.result",
        "repository_list.repositories",
        "repository_list.repository_list",
        "repository_list.result",
        "result.repositories",
        "result.repository_list",
        "result.result",
      ],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return firstResponseArray(body, [
    "repositories",
    "repository_list",
    "result",
  ]).map((repository): CodeArtsRepository => {
    const item = asRecord(repository);

    return {
      createdAt: firstString([item.created_at, item.createdAt]),
      defaultBranch: firstString(
        [item.default_branch, item.defaultBranch],
        "-",
      ),
      id: String(item.id ?? item.repository_id ?? item.uuid ?? item.name ?? ""),
      name: firstString([
        item.name,
        item.repository_name,
        item.path_with_namespace,
        item.id,
      ]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      sshUrl: firstString(
        [item.ssh_url_to_repo, item.ssh_url, item.sshUrl],
        "-",
      ),
      visibility: firstString(
        [item.visibility, item.repository_type, item.private],
        "-",
      ),
      webUrl: firstString(
        [item.web_url, item.http_url_to_repo, item.https_url, item.url],
        "-",
      ),
    };
  });
}

export async function listCodeArtsRepositories(session: BetterUiSession) {
  return loadAcrossProjects(session, listCodeArtsRepositoriesForProject);
}
