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
  const projects = sessionProjects(session);
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
          `${projects[index].projectName} (${projects[index].region}): ${errorMessage(result.reason)}`,
        ]
      : [],
  );
  if (errors.length) throw new CloudLoadError(errors.join("; "), data);
  return data;
}

export function projectForId(session: BetterUiSession, projectId?: string) {
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
