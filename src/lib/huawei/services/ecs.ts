import "server-only";

import {
  finishCloudLoad,
  mapCloudLoad,
  settledValue,
} from "@/lib/huawei/errors";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  asString,
  firstIp,
  firstString,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects, sessionProjects } from "@/lib/huawei/projects";
import {
  listEvsDisksForProject,
  listEvsSnapshotsForProject,
} from "@/lib/huawei/services/evs";
import { getImageNameForProject } from "@/lib/huawei/services/ims";

export type EcsInstance = {
  attachedDiskIds: string[];
  availabilityZone: string;
  createdAt: string;
  flavor: string;
  id: string;
  image: string;
  imageId: string;
  imageName: string;
  name: string;
  privateIp: string;
  publicIp: string;
  securityGroups: Array<{
    id: string;
    name: string;
  }>;
  status: string;
  systemDisk: {
    id: string;
    name: string;
    size: string;
    status: string;
    type: string;
  } | null;
  projectId: string;
  projectName: string;
  region: string;
};

export type EcsMonitoringMetric = {
  datapoints: Array<{
    timestamp: string;
    value: number;
  }>;
  label: string;
  metricName: string;
  namespace: string;
  unit: string;
};

export type EcsMonitoring = {
  metrics: EcsMonitoringMetric[];
  projectId: string;
  region: string;
};

export async function listEcsInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ servers?: unknown[] }>(
    session,
    "ecs",
    `/v1/${session.projectId}/cloudservers/detail?limit=100`,
    {
      items: ["servers"],
      kind: "page",
      parameter: "offset",
      size: 100,
      first: 1,
    },
  );

  return asArray(body.servers).map((server): EcsInstance => {
    const item = asRecord(server);
    const flavor = asRecord(item.flavor);
    const image = asRecord(item.image);
    const metadata = asRecord(item.metadata);
    const imageId = asString(image.id, "-");
    const imageName = firstString([image.name, metadata.image_name, imageId]);
    const securityGroups = asArray(item.security_groups).map((group) => {
      const record = asRecord(group);
      const id = firstString([record.id, record.uuid, record.name]);
      const name = firstString([record.name, record.id, record.uuid]);

      return { id, name };
    });

    return {
      attachedDiskIds: asArray(item["os-extended-volumes:volumes_attached"])
        .map((volume) => asRecord(volume).id)
        .filter((volumeId): volumeId is string => typeof volumeId === "string"),
      availabilityZone: firstString([
        item["OS-EXT-AZ:availability_zone"],
        item.availability_zone,
      ]),
      createdAt: asString(item.created, "-"),
      flavor: firstString([flavor.name, flavor.id]),
      id: asString(item.id),
      image: imageName,
      imageId,
      imageName,
      name: asString(item.name),
      privateIp: firstIp(item.addresses, "private"),
      projectId: session.projectId,
      projectName: session.projectName,
      publicIp: firstIp(item.addresses, "public"),
      region: session.region,
      securityGroups,
      status: asString(item.status, "UNKNOWN"),
      systemDisk: null,
    };
  });
}

export async function listEcsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listEcsInstancesForProject);
}

export async function getEcsInstance(session: BetterUiSession, id: string) {
  return mapCloudLoad(
    () => listEcsInstances(session),
    async (instances) => {
      const instance = instances.find((item) => item.id === id) ?? null;

      if (!instance) {
        return null;
      }

      const project =
        sessionProjects(session).find(
          (item) =>
            item.projectId === instance.projectId &&
            item.region === instance.region,
        ) ?? sessionProjects(session)[0];

      const results = await Promise.allSettled([
        getImageNameForProject(project, instance.imageId),
        listEvsDisksForProject(project),
      ]);
      const resolvedImageName = settledValue(results[0], instance.imageName);
      const disks = settledValue(results[1], []);
      const systemDisk =
        disks.find((disk) => instance.attachedDiskIds.includes(disk.id)) ??
        disks.find((disk) => disk.attachedTo === instance.id) ??
        null;

      return finishCloudLoad(
        results,
        {
          ...instance,
          image: resolvedImageName,
          imageName: resolvedImageName,
          systemDisk: systemDisk
            ? {
                id: systemDisk.id,
                name: systemDisk.name,
                size: systemDisk.size,
                status: systemDisk.status,
                type: systemDisk.type,
              }
            : null,
        },
        ["Image", "Disks"],
      );
    },
  );
}

export type EcsMetricCandidate = {
  dimensions?: Array<{ name: string; value: string }>;
  metricName: string;
  namespace: string;
  unit: string;
};

export function metricKey(candidate: EcsMetricCandidate): string {
  return `${candidate.namespace}:${candidate.metricName}`;
}

export async function getCesMetricBatch(
  session: HuaweiProjectSession,
  instanceId: string,
  candidates: EcsMetricCandidate[],
) {
  const to = Date.now();
  const from = to - 6 * 60 * 60 * 1000;

  const body = await huaweiFetch<{ metrics?: unknown[] }>(
    session,
    "ces",
    `/V1.0/${session.projectId}/batch-query-metric-data`,
    {
      body: JSON.stringify({
        filter: "average",
        from,
        metrics: candidates.map((candidate) => ({
          dimensions: candidate.dimensions ?? [
            { name: "instance_id", value: instanceId },
          ],
          metric_name: candidate.metricName,
          namespace: candidate.namespace,
        })),
        period: "300",
        to,
      }),
      method: "POST",
    },
  );

  return new Map<string, EcsMonitoringMetric["datapoints"]>(
    asArray(body.metrics).map((metric) => {
      const item = asRecord(metric);
      const metricName = asString(item.metric_name);
      const namespace = asString(item.namespace);
      const datapoints = asArray(item.datapoints)
        .map((point) => {
          const datapoint = asRecord(point);
          const average = Number(
            datapoint.average ??
              datapoint.value ??
              datapoint.max ??
              datapoint.min,
          );
          const timestamp = Number(datapoint.timestamp);

          if (!Number.isFinite(average) || !Number.isFinite(timestamp)) {
            return null;
          }

          return {
            timestamp: new Date(timestamp).toISOString(),
            value: average,
          };
        })
        .filter(
          (point): point is { timestamp: string; value: number } =>
            point !== null,
        )
        .sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

      return [`${namespace}:${metricName}`, datapoints] as const;
    }),
  );
}

export async function listCesMetricsForInstance(
  session: HuaweiProjectSession,
  instanceId: string,
) {
  const namespaces = ["SYS.ECS", "AGT.ECS"];
  const results = await Promise.allSettled(
    namespaces.map(async (namespace) => {
      const query = new URLSearchParams({ namespace });
      const body = await huaweiFetch<{ metrics?: unknown[] }>(
        session,
        "ces",
        `/V1.0/${session.projectId}/metrics?${query.toString()}`,
      );

      return asArray(body.metrics).flatMap((metric) => {
        const item = asRecord(metric);
        const dimensions = asArray(item.dimensions)
          .map((dimension) => {
            const record = asRecord(dimension);
            const name = asString(record.name, "");
            const value = asString(record.value, "");

            return name && value ? { name, value } : null;
          })
          .filter(
            (dimension): dimension is { name: string; value: string } =>
              dimension !== null,
          );

        if (!dimensions.some((dimension) => dimension.value === instanceId)) {
          return [];
        }

        return [
          {
            dimensions,
            metricName: asString(item.metric_name, ""),
            namespace: asString(item.namespace, namespace),
            unit: asString(item.unit, ""),
          },
        ];
      });
    }),
  );

  return finishCloudLoad(
    results,
    results.flatMap((result) => settledValue(result, [])),
    namespaces,
  );
}

export function candidatesForNames(
  discoveredMetrics: EcsMetricCandidate[],
  fallbackCandidates: EcsMetricCandidate[],
) {
  const fallbackByKey = new Map(
    fallbackCandidates.map((candidate) => [metricKey(candidate), candidate]),
  );
  const discovered = discoveredMetrics.flatMap((metric) => {
    const fallback = fallbackByKey.get(metricKey(metric));

    return fallback
      ? [
          {
            ...metric,
            unit: metric.unit || fallback.unit,
          },
        ]
      : [];
  });

  return [...discovered, ...fallbackCandidates];
}

export async function getEcsMonitoring(session: BetterUiSession, id: string) {
  const instance = await getEcsInstance(session, id).catch((error: unknown) => {
    throw new Error(
      error instanceof Error ? error.message : "ECS detail load failed.",
    );
  });

  if (!instance) {
    return null;
  }

  const project =
    sessionProjects(session).find(
      (item) =>
        item.projectId === instance.projectId &&
        item.region === instance.region,
    ) ?? sessionProjects(session)[0];

  return mapCloudLoad(
    () => listCesMetricsForInstance(project, id),
    async (discoveredMetrics) => {
      const metricDefinitions: Array<{
        candidates: EcsMetricCandidate[];
        label: string;
      }> = [
        {
          candidates: candidatesForNames(discoveredMetrics, [
            { metricName: "cpu_util", namespace: "SYS.ECS", unit: "%" },
          ]),
          label: "CPU usage",
        },
        {
          candidates: candidatesForNames(discoveredMetrics, [
            { metricName: "mem_util", namespace: "SYS.ECS", unit: "%" },
            { metricName: "mem_usedPercent", namespace: "AGT.ECS", unit: "%" },
            { metricName: "mem_util", namespace: "AGT.ECS", unit: "%" },
          ]),
          label: "Memory usage",
        },
        {
          candidates: candidatesForNames(discoveredMetrics, [
            {
              metricName: "network_incoming_bytes_aggregate_rate",
              namespace: "SYS.ECS",
              unit: "B/s",
            },
            {
              metricName: "network_incoming_bytes_rate_inband",
              namespace: "SYS.ECS",
              unit: "B/s",
            },
            { metricName: "net_bitSent", namespace: "AGT.ECS", unit: "bit/s" },
          ]),
          label: "Network in",
        },
        {
          candidates: candidatesForNames(discoveredMetrics, [
            {
              metricName: "network_outgoing_bytes_aggregate_rate",
              namespace: "SYS.ECS",
              unit: "B/s",
            },
            {
              metricName: "network_outgoing_bytes_rate_inband",
              namespace: "SYS.ECS",
              unit: "B/s",
            },
            { metricName: "net_bitRecv", namespace: "AGT.ECS", unit: "bit/s" },
          ]),
          label: "Network out",
        },
      ];
      const candidates = metricDefinitions.flatMap(
        (metric) => metric.candidates,
      );
      const datapointsByMetric = await getCesMetricBatch(
        project,
        id,
        candidates,
      );
      const metrics = metricDefinitions.map((definition) => {
        const selectedCandidate =
          definition.candidates.find(
            (candidate) =>
              (datapointsByMetric.get(metricKey(candidate)) ?? []).length > 0,
          ) ?? definition.candidates[0];

        return {
          datapoints:
            datapointsByMetric.get(metricKey(selectedCandidate)) ?? [],
          label: definition.label,
          metricName: selectedCandidate.metricName,
          namespace: selectedCandidate.namespace,
          unit: selectedCandidate.unit,
        };
      });

      return {
        metrics,
        projectId: instance.projectId,
        region: instance.region,
      };
    },
  );
}

export async function runEcsAction(
  session: BetterUiSession,
  id: string,
  action: "restart" | "start" | "stop",
  projectId?: string,
) {
  const project =
    sessionProjects(session).find((item) => item.projectId === projectId) ??
    sessionProjects(session).find(
      (item) => item.projectId === session.projectId,
    ) ??
    sessionProjects(session)[0];

  const payload =
    action === "start"
      ? { "os-start": { servers: [{ id }] } }
      : action === "stop"
        ? { "os-stop": { servers: [{ id }], type: "SOFT" } }
        : { reboot: { servers: [{ id }], type: "SOFT" } };

  return huaweiFetch<{ job_id?: string }>(
    project,
    "ecs",
    `/v1/${project.projectId}/cloudservers/action`,
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
  );
}

export async function getEcsSnapshots(session: BetterUiSession, id: string) {
  const instance = await getEcsInstance(session, id).catch((error: unknown) => {
    throw new Error(
      error instanceof Error ? error.message : "ECS detail load failed.",
    );
  });

  if (!instance) {
    return null;
  }

  const diskIds = new Set([
    ...(instance.systemDisk?.id ? [instance.systemDisk.id] : []),
    ...instance.attachedDiskIds,
  ]);

  if (!diskIds.size) {
    return [];
  }

  const project =
    sessionProjects(session).find(
      (item) =>
        item.projectId === instance.projectId &&
        item.region === instance.region,
    ) ?? sessionProjects(session)[0];
  const snapshots = (
    await Promise.all(
      Array.from(diskIds).map((diskId) =>
        listEvsSnapshotsForProject(project, diskId),
      ),
    )
  ).flat();

  return snapshots.filter((snapshot) => diskIds.has(snapshot.diskId));
}
