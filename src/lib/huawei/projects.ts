import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { getSessionProjects } from "@/lib/auth-session";
import { CloudLoadError, errorMessage } from "./errors";

export function sessionProjects(session: BetterUiSession) {
  return getSessionProjects(session);
}

export async function loadAcrossProjects<T>(
  session: BetterUiSession,
  loader: (project: HuaweiProjectSession) => Promise<T[]>,
) {
  const projects = sessionProjects(session).filter(
    (project) => project.projectName !== "MOS" && project.region !== "MOS",
  );
  const results = await Promise.allSettled(projects.map(loader));
  const data = results.flatMap((result) =>
    result.status === "fulfilled"
      ? result.value
      : result.reason instanceof CloudLoadError &&
          Array.isArray(result.reason.partialData)
        ? (result.reason.partialData as T[])
        : [],
  );
  const errors = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            projectId: projects[index].projectId,
            projectName: projects[index].projectName,
            region: projects[index].region,
            message: errorMessage(result.reason),
          },
        ]
      : [],
  );
  if (errors.length)
    throw new CloudLoadError(
      errors
        .map(
          (error) => `${error.projectName} (${error.region}): ${error.message}`,
        )
        .join("; "),
      data,
      errors,
    );
  return data;
}

export function projectForId(session: BetterUiSession, projectId?: string) {
  if (projectId !== undefined) {
    const project = sessionProjects(session).find(
      (project) => project.projectId === projectId,
    );
    if (!project)
      throw new Error("The selected project is not part of this session.");
    return project;
  }
  return (
    sessionProjects(session).find(
      (project) => project.projectId === projectId,
    ) ??
    sessionProjects(session).find(
      (project) => project.projectId === session.projectId,
    ) ??
    sessionProjects(session)[0]
  );
}
