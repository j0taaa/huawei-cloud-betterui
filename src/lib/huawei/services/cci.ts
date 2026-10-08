import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CciNamespace = {
  createdAt: string;
  id: string;
  name: string;
  phase: string;
  podCount: number;
  projectId: string;
  projectName: string;
  readyContainers: number;
  region: string;
  restartCount: number;
  runningPods: number;
};

export function podContainerSummary(pods: unknown[]) {
  return pods.reduce<{
    readyContainers: number;
    restartCount: number;
    runningPods: number;
  }>(
    (summary, pod) => {
      const status = asRecord(asRecord(pod).status);
      const containerStatuses = asArray(status.containerStatuses);
      const restartCount = containerStatuses.reduce((total, container) => {
        const item = asRecord(container);
        return total + Number(item.restartCount ?? 0);
      }, 0);
      const readyContainers = containerStatuses.filter(
        (container) => asRecord(container).ready === true,
      ).length;

      return {
        readyContainers: summary.readyContainers + readyContainers,
        restartCount: summary.restartCount + restartCount,
        runningPods:
          summary.runningPods +
          (String(status.phase ?? "").toLowerCase() === "running" ? 1 : 0),
      };
    },
    { readyContainers: 0, restartCount: 0, runningPods: 0 },
  );
}

export async function listCciNamespacesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ items?: unknown[] }>(
    session,
    "cci",
    "/apis/cci/v2/namespaces",
    {
      items: ["items"],
      kind: "marker",
      parameter: "continue",
      size: 100,
      next: ["metadata.continue"],
    },
  );

  const namespaces = asArray(body.items);
  const podsByNamespace = await Promise.all(
    namespaces.map(async (namespace) => {
      const metadata = asRecord(asRecord(namespace).metadata);
      const name = asString(metadata.name, "");

      if (!name) {
        return [] as unknown[];
      }

      const podBody = await huaweiList<{ items?: unknown[] }>(
        session,
        "cci",
        `/apis/cci/v2/namespaces/${encodeURIComponent(name)}/pods`,
        {
          items: ["items"],
          kind: "marker",
          parameter: "continue",
          size: 100,
          next: ["metadata.continue"],
        },
      );

      return asArray(podBody.items);
    }),
  );

  return namespaces.map((namespace, index): CciNamespace => {
    const item = asRecord(namespace);
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const pods = podsByNamespace[index] ?? [];
    const summary = podContainerSummary(pods);

    return {
      createdAt: firstString([
        metadata.creationTimestamp,
        item.creationTimestamp,
      ]),
      id: firstString([metadata.uid, metadata.name]),
      name: asString(metadata.name),
      phase: asString(status.phase, "UNKNOWN"),
      podCount: pods.length,
      projectId: session.projectId,
      projectName: session.projectName,
      readyContainers: summary.readyContainers,
      region: session.region,
      restartCount: summary.restartCount,
      runningPods: summary.runningPods,
    };
  });
}

export async function listCciNamespaces(session: BetterUiSession) {
  return loadAcrossProjects(session, listCciNamespacesForProject);
}
