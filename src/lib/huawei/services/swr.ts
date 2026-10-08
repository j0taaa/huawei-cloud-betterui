import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { getSessionProjects } from "@/lib/auth-session";
import {
  finishCloudLoad,
  mapCloudLoad,
  settledValue,
} from "@/lib/huawei/errors";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { loadAcrossProjects, projectForId } from "@/lib/huawei/projects";

export type SwrRepository = {
  id: string;
  repositoryId: string;
  name: string;
  namespace: string;
  description: string;
  category: string;
  isPublic: boolean;
  size: number;
  imageCount: number;
  downloads: number;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type SwrTag = {
  name: string;
  digest: string;
  size: number;
  pullPath: string;
  createdAt: string;
  updatedAt: string;
};

export type SwrRepositoryDetail = { repository: SwrRepository; tags: SwrTag[] };

export async function listSwrRepositoriesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ repos: unknown[] }>(
    session,
    "swr",
    "/v3/manage/repos?limit=100",
    {
      items: ["repos"],
      kind: "marker",
      parameter: "marker",
      size: 100,
      next: ["nextMarker"],
    },
  );
  return body.repos.map((value): SwrRepository => {
    const item = asRecord(value);
    const name = asString(item.name);
    const namespace = asString(item.namespace_name);
    // Names can contain '/', and numeric IDs can repeat in different regions.
    const id = Buffer.from(
      JSON.stringify([session.region, namespace, name]),
    ).toString("base64url");
    return {
      id,
      repositoryId: String(item.id ?? "-"),
      name,
      namespace,
      description: asString(item.description, ""),
      category: asString(item.category),
      isPublic: item.is_public === true,
      size: Number(item.size ?? 0),
      imageCount: Number(item.num_images ?? 0),
      downloads: Number(item.num_download ?? 0),
      createdAt: asString(item.created_at, ""),
      updatedAt: asString(item.updated_at, ""),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
    };
  });
}

export function listSwrRepositories(session: BetterUiSession) {
  // Basic-edition repositories belong to the account/region, not each IAM subproject.
  const projects = getSessionProjects(session);
  const regionalProjects = projects.filter(
    (project, index) =>
      projects.findIndex((candidate) => candidate.region === project.region) ===
      index,
  );
  return loadAcrossProjects(
    { ...session, projects: regionalProjects },
    listSwrRepositoriesForProject,
  );
}

export async function listSwrTagsForProject(
  session: HuaweiProjectSession,
  namespace: string,
  repository: string,
) {
  // SWR requires nested repository names to use '$' in the API path.
  const name = encodeURIComponent(repository.replaceAll("/", "$"));
  const body = await huaweiList<{ tags: unknown[] }>(
    session,
    "swr",
    `/v3/manage/namespaces/${encodeURIComponent(namespace)}/repos/${name}/tags?limit=100`,
    {
      items: ["tags"],
      kind: "marker",
      parameter: "marker",
      size: 100,
      next: ["nextMarker"],
      hasMore: "has_more",
    },
  );
  return asArray(body.tags).map((value): SwrTag => {
    const item = asRecord(value);
    return {
      name: asString(item.tag),
      digest: asString(item.digest),
      size: Number(item.size ?? 0),
      pullPath: asString(item.path, ""),
      createdAt: asString(item.created, ""),
      updatedAt: asString(item.updated, ""),
    };
  });
}

export function getSwrRepository(
  session: BetterUiSession,
  id: string,
): Promise<SwrRepositoryDetail | null> {
  return mapCloudLoad(
    () => listSwrRepositories(session),
    async (repositories) => {
      const repository = repositories.find((item) => item.id === id);
      if (!repository) return null;
      const results = await Promise.allSettled([
        listSwrTagsForProject(
          projectForId(session, repository.projectId),
          repository.namespace,
          repository.name,
        ),
      ]);
      return finishCloudLoad(
        results,
        { repository, tags: settledValue(results[0], []) },
        ["Image tags"],
      );
    },
  );
}
