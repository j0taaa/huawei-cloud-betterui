import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "./http";
import { asArray, asRecord } from "./parsers";
import { finishCloudLoad, settledValue } from "./errors";
import { sessionProjects } from "./projects";

export type CodeArtsProject = { id: string; name: string };

/** CodeArts projects are developer workspaces, separate from IAM regional projects. */
export async function listCodeArtsProjects(scope: HuaweiProjectSession): Promise<CodeArtsProject[]> {
  const body = await huaweiList<Record<string, unknown>>(scope, "projectman", "/v4/projects?offset=0&limit=100", {
    items: ["projects"], kind: "offset", parameter: "offset", size: 100, total: ["total"],
  });
  return asArray(body.projects).map(row => {
    const project = asRecord(row);
    if (typeof project.project_id !== "string" || !/^[a-f0-9]{32}$/i.test(project.project_id) || typeof project.project_name !== "string" || !project.project_name)
      throw new Error("Huawei returned a CodeArts project without a verified workspace ID and name.");
    return { id: project.project_id, name: project.project_name };
  });
}

/** Load each region once, then preserve successful developer workspaces on partial errors. */
export async function loadAcrossCodeArtsProjects<T>(session: BetterUiSession, loader: (workspace: HuaweiProjectSession) => Promise<T[]>): Promise<T[]> {
  const scopes = new Map<string, HuaweiProjectSession>();
  for (const scope of sessionProjects(session)) {
    if (!scopes.has(scope.region) || scope.projectId === session.projectId) scopes.set(scope.region, scope);
  }
  const regions = [...scopes.values()];
  const results = await Promise.allSettled(regions.map(async scope => {
    const projects = await listCodeArtsProjects(scope);
    const loads = await Promise.allSettled(projects.map(project => loader({ ...scope, projectId: project.id, projectName: project.name })));
    return finishCloudLoad(loads, loads.flatMap(load => settledValue(load, [])), projects.map(project => project.name));
  }));
  return finishCloudLoad(results, results.flatMap(result => settledValue(result, [])), regions.map(region => region.region));
}
