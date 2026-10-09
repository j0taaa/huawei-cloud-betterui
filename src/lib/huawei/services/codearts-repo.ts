import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiArrayList } from "@/lib/huawei/http";
import {
  asRecord,
  firstString,
} from "@/lib/huawei/parsers";
import { loadAcrossCodeArtsProjects } from "@/lib/huawei/codearts-projects";

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
  const repositories = await huaweiArrayList<Record<string, unknown>>(
    session,
    "codeartsrepo",
    `/v4/projects/${session.projectId}/repositories?offset=0&limit=100&order_by=updated_at&sort=desc`,
    {
      kind: "offset",
      parameter: "offset",
      size: 100,
    },
  );

  return repositories.map((repository): CodeArtsRepository => {
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
  return loadAcrossCodeArtsProjects(session, listCodeArtsRepositoriesForProject);
}
