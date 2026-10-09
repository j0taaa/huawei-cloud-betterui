import { mapCloudLoad } from "@/lib/huawei/errors";
import { huaweiList, HuaweiApiError } from "@/lib/huawei/http";
import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  huaweiFetch,
  loadAcrossProjects,
  projectForId,
} from "@/lib/huawei/core";
import type { CciNamespace } from "@/lib/huawei/services/cci.types";

type CciListBody = { items?: unknown[] };

function keyValuePairs(value: unknown) {
  return Object.entries(asRecord(value))
    .map(([key, rawValue]) => ({
      key,
      value:
        typeof rawValue === "string"
          ? rawValue
          : JSON.stringify(rawValue ?? ""),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function countByPhase(pods: unknown[], phase: string) {
  return pods.filter(
    (pod) =>
      asString(asRecord(asRecord(pod).status).phase, "").toLowerCase() ===
      phase,
  ).length;
}

export function podContainerSummary(pods: unknown[]) {
  return pods.reduce<{
    containerCount: number;
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
        containerCount: summary.containerCount + containerStatuses.length,
        readyContainers: summary.readyContainers + readyContainers,
        restartCount: summary.restartCount + restartCount,
        runningPods:
          summary.runningPods +
          (String(status.phase ?? "").toLowerCase() === "running" ? 1 : 0),
      };
    },
    { containerCount: 0, readyContainers: 0, restartCount: 0, runningPods: 0 },
  );
}

function listForNamespace(
  session: HuaweiProjectSession,
  namespace: string,
  resource: string,
) {
  return huaweiList<CciListBody>(
    session,
    "cci",
    `/apis/cci/v2/namespaces/${encodeURIComponent(namespace)}/${resource}`,
    {
      items: ["items"],
      kind: "marker",
      parameter: "continue",
      size: 100,
      next: ["metadata.continue"],
    },
  ).then((body) => asArray(body.items)).catch((error: unknown) => {
    // CCI 2.0 has no StatefulSet/Job/CronJob endpoints. Preserve older regions that still expose them.
    if (["statefulsets", "jobs", "cronjobs"].includes(resource) && error instanceof HuaweiApiError && [404, 405].includes(error.status)) return [];
    throw error;
  });
}

function summarizePod(pod: unknown): CciNamespace["pods"][number] {
  const item = asRecord(pod);
  const metadata = asRecord(item.metadata);
  const spec = asRecord(item.spec);
  const status = asRecord(item.status);
  const containerStatuses = asArray(status.containerStatuses);
  const containers = asArray(spec.containers);
  const restartCount = containerStatuses.reduce((total, container) => {
    const item = asRecord(container);
    return total + Number(item.restartCount ?? 0);
  }, 0);
  const readyContainers = containerStatuses.filter(
    (container) => asRecord(container).ready === true,
  ).length;
  const firstContainer = asRecord(containers[0]);

  return {
    containerCount: containerStatuses.length || containers.length,
    createdAt: firstString([metadata.creationTimestamp]),
    image: firstString([firstContainer.image], "-"),
    ip: firstString([status.podIP]),
    name: asString(metadata.name),
    nodeName: firstString([spec.nodeName]),
    phase: asString(status.phase, "UNKNOWN"),
    qosClass: firstString([status.qosClass]),
    readyContainers,
    reason: firstString([status.reason, status.message]),
    restartCount,
    startedAt: firstString([status.startTime]),
  };
}

function workloadStatus(
  kind: string,
  desired: number,
  ready: number,
  status: Record<string, unknown>,
) {
  const succeeded = Number(status.succeeded ?? 0);
  const failed = Number(status.failed ?? 0);

  if (failed > 0) {
    return "Failed";
  }

  if (kind === "Job" && succeeded > 0) {
    return "Complete";
  }

  if (desired > 0 && ready >= desired) {
    return "Ready";
  }

  if (desired === 0) {
    return "Scaled to 0";
  }

  return "Progressing";
}

function summarizeWorkload(
  kind: string,
  workload: unknown,
): CciNamespace["workloads"][number] {
  const item = asRecord(workload);
  const metadata = asRecord(item.metadata);
  const spec = asRecord(item.spec);
  const status = asRecord(item.status);
  const desired = Number(
    spec.replicas ?? spec.parallelism ?? spec.completions ?? status.active ?? 0,
  );
  const ready = Number(
    status.readyReplicas ??
      status.availableReplicas ??
      status.succeeded ??
      status.active ??
      0,
  );
  const available = Number(
    status.availableReplicas ?? status.succeeded ?? ready,
  );
  const updated = Number(status.updatedReplicas ?? ready);

  return {
    available: Number.isFinite(available) ? available : 0,
    createdAt: firstString([metadata.creationTimestamp]),
    desired: Number.isFinite(desired) ? desired : 0,
    kind,
    name: asString(metadata.name),
    ready: Number.isFinite(ready) ? ready : 0,
    status: workloadStatus(kind, desired, ready, status),
    updated: Number.isFinite(updated) ? updated : 0,
  };
}

export async function listCciNamespacesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<CciListBody>(
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
  const resourcesByNamespace = await Promise.all(
    namespaces.map(async (namespace) => {
      const metadata = asRecord(asRecord(namespace).metadata);
      const name = asString(metadata.name, "");

      if (!name) {
        return {
          configMaps: [] as unknown[],
          cronJobs: [] as unknown[],
          deployments: [] as unknown[],
          jobs: [] as unknown[],
          pods: [] as unknown[],
          secrets: [] as unknown[],
          services: [] as unknown[],
          statefulSets: [] as unknown[],
        };
      }

      const [
        pods,
        deployments,
        statefulSets,
        jobs,
        cronJobs,
        services,
        configMaps,
        secrets,
      ] = await Promise.all([
        listForNamespace(session, name, "pods"),
        listForNamespace(session, name, "deployments"),
        listForNamespace(session, name, "statefulsets"),
        listForNamespace(session, name, "jobs"),
        listForNamespace(session, name, "cronjobs"),
        listForNamespace(session, name, "services"),
        listForNamespace(session, name, "configmaps"),
        listForNamespace(session, name, "secrets"),
      ]);

      return {
        configMaps,
        cronJobs,
        deployments,
        jobs,
        pods,
        secrets,
        services,
        statefulSets,
      };
    }),
  );

  return namespaces.map((namespace, index): CciNamespace => {
    const item = asRecord(namespace);
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const resources = resourcesByNamespace[index];
    const pods = resources?.pods ?? [];
    const summary = podContainerSummary(pods);
    const workloads = [
      ...(resources?.deployments ?? []).map((workload) =>
        summarizeWorkload("Deployment", workload),
      ),
      ...(resources?.statefulSets ?? []).map((workload) =>
        summarizeWorkload("StatefulSet", workload),
      ),
      ...(resources?.jobs ?? []).map((workload) =>
        summarizeWorkload("Job", workload),
      ),
      ...(resources?.cronJobs ?? []).map((workload) =>
        summarizeWorkload("CronJob", workload),
      ),
    ];

    return {
      annotations: keyValuePairs(metadata.annotations),
      configMapCount: resources?.configMaps.length ?? 0,
      containerCount: summary.containerCount,
      cronJobCount: resources?.cronJobs.length ?? 0,
      createdAt: firstString([
        metadata.creationTimestamp,
        item.creationTimestamp,
      ]),
      deploymentCount: resources?.deployments.length ?? 0,
      failedPods: countByPhase(pods, "failed"),
      id: firstString([metadata.uid, metadata.name]),
      jobCount: resources?.jobs.length ?? 0,
      labels: keyValuePairs(metadata.labels),
      name: asString(metadata.name),
      pendingPods: countByPhase(pods, "pending"),
      phase: asString(status.phase, "UNKNOWN"),
      podCount: pods.length,
      pods: pods.map(summarizePod),
      projectId: session.projectId,
      projectName: session.projectName,
      readyContainers: summary.readyContainers,
      region: session.region,
      restartCount: summary.restartCount,
      runningPods: summary.runningPods,
      secretCount: resources?.secrets.length ?? 0,
      serviceCount: resources?.services.length ?? 0,
      statefulSetCount: resources?.statefulSets.length ?? 0,
      stoppedPods: countByPhase(pods, "stopped"),
      succeededPods: countByPhase(pods, "succeeded"),
      terminating: typeof metadata.deletionTimestamp === "string",
      unknownPods: countByPhase(pods, "unknown"),
      workloadCount: workloads.length,
      workloads,
    };
  });
}

export async function listCciNamespaces(session: BetterUiSession) {
  return loadAcrossProjects(session, listCciNamespacesForProject);
}

export async function getCciNamespace(session: BetterUiSession, id: string) {
  return mapCloudLoad(
    () => listCciNamespaces(session),
    async (namespaces) => {
      return (
        namespaces.find((namespace) => namespace.id === id) ??
        namespaces.find((namespace) => namespace.name === id) ??
        null
      );
    },
  );
}

export async function deleteCciNamespace(
  session: BetterUiSession,
  id: string,
  projectId?: string,
) {
  const namespace = await getCciNamespace(session, id);

  if (!namespace) {
    throw new Error("CCI namespace was not found.");
  }

  if (projectId && namespace.projectId !== projectId) {
    throw new Error("CCI namespace project did not match the request.");
  }

  if (
    namespace.terminating ||
    namespace.phase.toLowerCase() === "terminating"
  ) {
    throw new Error("CCI namespace is already terminating.");
  }

  if (
    namespace.podCount ||
    namespace.workloadCount ||
    namespace.serviceCount ||
    namespace.configMapCount ||
    namespace.secretCount
  ) {
    throw new Error("Only empty CCI namespaces can be deleted from this UI.");
  }

  const project = projectForId(session, namespace.projectId);

  await huaweiFetch(
    project,
    "cci",
    `/apis/cci/v2/namespaces/${encodeURIComponent(namespace.name)}`,
    { method: "DELETE" },
  );

  return namespace;
}

export type * from "@/lib/huawei/services/cci.types";
