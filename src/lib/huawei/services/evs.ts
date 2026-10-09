import { mapCloudLoad } from "@/lib/huawei/errors";
import { huaweiList } from "@/lib/huawei/http";
import "server-only";

import { randomUUID } from "node:crypto";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  huaweiFetch,
  loadAcrossProjects,
  projectForId,
  sessionProjects,
} from "@/lib/huawei/core";

export type EvsDisk = {
  attachedDevice: string;
  attachedServerId: string;
  availabilityZone: string;
  attachedTo: string;
  createdAt: string;
  description: string;
  id: string;
  isBootable: string;
  isEncrypted: string;
  isShareable: string;
  name: string;
  rawSizeGb: number;
  size: string;
  status: string;
  tags: Array<{ key: string; value: string }>;
  type: string;
  typeLabel: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type EvsMonitoringMetric = {
  datapoints: Array<{ timestamp: string; value: number }>;
  label: string;
  metricName: string;
  namespace: "SYS.EVS";
  unit: string;
};

export type EvsMonitoring = {
  dimensionValue: string;
  metrics: EvsMonitoringMetric[];
  projectId: string;
  region: string;
};

export type EvsSnapshot = {
  createdAt: string;
  description: string;
  diskId: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  rawSizeGb: number;
  region: string;
  size: string;
  status: string;
};

export type CreateEvsDiskInput = {
  availabilityZone: string;
  description?: string;
  isShareable?: boolean;
  name: string;
  projectId?: string;
  snapshotId?: string;
  sizeGb: number;
  volumeType: string;
};

export type UpdateEvsDiskInput = {
  description?: string;
  name: string;
};

export function evsVolumeTypeLabel(type: string) {
  const normalized = type
    .replace(/_for_.+$/i, "")
    .replace(/[-_\s]+/g, "")
    .toUpperCase();
  const labels: Record<string, string> = {
    COH1: "High I/O",
    COP1: "Ultra-high I/O",
    ESSD: "Extreme SSD",
    ESSD2: "Extreme SSD V2",
    GPSSD: "General Purpose SSD",
    GPSSD2: "General Purpose SSD V2",
    SAS: "High I/O",
    SATA: "Common I/O",
    SSD: "Ultra-high I/O",
  };

  return labels[normalized] ?? type.replace(/_/g, " ");
}

function parseEvsTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.flatMap((tag) => {
      if (typeof tag === "string") {
        const [key, ...parts] = tag.split("=");
        return key ? [{ key, value: parts.join("=") || "-" }] : [];
      }

      const item = asRecord(tag);
      const key = firstString([item.key, item.name], "");
      return key ? [{ key, value: firstString([item.value], "-") }] : [];
    });
  }

  return Object.entries(asRecord(value)).map(([key, tagValue]) => ({
    key,
    value: String(tagValue ?? "-"),
  }));
}

export async function listEvsDisksForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{
    cloudvolumes?: unknown[];
    volumes?: unknown[];
  }>(session, "evs", `/v2/${session.projectId}/cloudvolumes/detail?limit=100`, {
    items: ["cloudvolumes", "volumes"],
    kind: "offset",
    parameter: "offset",
    size: 100,
    total: ["total_count", "total", "data.total", "result.total"],
  });

  return asArray(body.cloudvolumes ?? body.volumes).map((volume): EvsDisk => {
    const item = asRecord(volume);
    const attachments = asArray(item.attachments);
    const firstAttachment = asRecord(attachments[0]);
    const type = asString(item.volume_type);
    const attachedServerId = firstString([firstAttachment.server_id], "");
    const attachedDevice = firstString([firstAttachment.device], "");

    return {
      attachedDevice,
      attachedServerId,
      attachedTo: firstString([attachedServerId, attachedDevice]),
      availabilityZone: asString(item.availability_zone),
      createdAt: asString(item.created_at),
      description: asString(item.description, ""),
      id: asString(item.id),
      isBootable: asString(item.bootable, "false"),
      isEncrypted: firstString(
        [asRecord(item.metadata).__system__encrypted, item.encrypted],
        "false",
      ),
      isShareable: String(item.multiattach ?? false),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      rawSizeGb: Number(item.size ?? 0),
      region: session.region,
      size: `${Number(item.size ?? 0)} GB`,
      status: asString(item.status, "UNKNOWN"),
      tags: parseEvsTags(item.tags),
      type,
      typeLabel: evsVolumeTypeLabel(type),
    };
  });
}

export async function getEvsDisk(session: BetterUiSession, id: string) {
  return mapCloudLoad(
    () => listEvsDisks(session),
    (disks) => disks.find((disk) => disk.id === id) ?? null,
  );
}

export async function listEvsDisks(session: BetterUiSession) {
  return loadAcrossProjects(session, listEvsDisksForProject);
}

export async function getEvsMonitoring(
  session: BetterUiSession,
  diskId: string,
) {
  const disk = await getEvsDisk(session, diskId);

  if (!disk) return null;

  const project =
    sessionProjects(session).find(
      (item) =>
        item.projectId === disk.projectId && item.region === disk.region,
    ) ?? sessionProjects(session)[0];
  const deviceName =
    disk.attachedDevice.split("/").filter(Boolean).at(-1) ?? "";
  const dimensionValue =
    disk.attachedServerId && deviceName
      ? `${disk.attachedServerId}-${deviceName}`
      : "";
  const definitions = [
    {
      label: "Read bandwidth",
      metricName: "disk_device_read_bytes_rate",
      unit: "B/s",
    },
    {
      label: "Write bandwidth",
      metricName: "disk_device_write_bytes_rate",
      unit: "B/s",
    },
    {
      label: "Read IOPS",
      metricName: "disk_device_read_requests_rate",
      unit: "requests/s",
    },
    {
      label: "Write IOPS",
      metricName: "disk_device_write_requests_rate",
      unit: "requests/s",
    },
  ] as const;

  if (!dimensionValue) {
    return {
      dimensionValue,
      metrics: definitions.map((definition) => ({
        ...definition,
        datapoints: [],
        namespace: "SYS.EVS" as const,
      })),
      projectId: disk.projectId,
      region: disk.region,
    } satisfies EvsMonitoring;
  }

  const to = Date.now();
  const from = to - 6 * 60 * 60 * 1000;
  const body = await huaweiFetch<{ metrics?: unknown[] }>(
    project,
    "ces",
    `/V1.0/${project.projectId}/batch-query-metric-data`,
    {
      body: JSON.stringify({
        filter: "average",
        from,
        metrics: definitions.map((definition) => ({
          dimensions: [{ name: "disk_name", value: dimensionValue }],
          metric_name: definition.metricName,
          namespace: "SYS.EVS",
        })),
        period: "300",
        to,
      }),
      method: "POST",
    },
  );
  const datapointsByName = new Map<string, EvsMonitoringMetric["datapoints"]>(
    asArray(body.metrics).map((metric) => {
      const item = asRecord(metric);
      const datapoints = asArray(item.datapoints)
        .flatMap((point) => {
          const record = asRecord(point);
          const value = Number(
            record.average ?? record.value ?? record.max ?? record.min,
          );
          const timestamp = Number(record.timestamp);

          return Number.isFinite(value) && Number.isFinite(timestamp)
            ? [{ timestamp: new Date(timestamp).toISOString(), value }]
            : [];
        })
        .sort(
          (left, right) =>
            new Date(left.timestamp).getTime() -
            new Date(right.timestamp).getTime(),
        );

      return [asString(item.metric_name), datapoints];
    }),
  );

  return {
    dimensionValue,
    metrics: definitions.map((definition) => ({
      ...definition,
      datapoints: datapointsByName.get(definition.metricName) ?? [],
      namespace: "SYS.EVS" as const,
    })),
    projectId: disk.projectId,
    region: disk.region,
  } satisfies EvsMonitoring;
}

export async function createEvsDisk(
  session: BetterUiSession,
  input: CreateEvsDiskInput,
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<{
    job_id?: string;
    volume?: { id?: string };
    volume_ids?: string[];
  }>(project, "evs", `/v2.1/${project.projectId}/cloudvolumes`, {
    body: JSON.stringify({
      bssParam: {
        chargingMode: "postPaid",
      },
      volume: {
        availability_zone: input.availabilityZone,
        description: input.description ?? "",
        multiattach: input.isShareable ?? false,
        name: input.name,
        snapshot_id: input.snapshotId,
        size: input.sizeGb,
        volume_type: input.volumeType,
      },
    }),
    headers: {
      "X-Client-Token": randomUUID(),
    },
    method: "POST",
  });
}

export async function updateEvsDisk(
  session: BetterUiSession,
  diskId: string,
  input: UpdateEvsDiskInput,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<{ volume?: unknown }>(
    project,
    "evs",
    `/v2/${project.projectId}/cloudvolumes/${diskId}`,
    {
      body: JSON.stringify({
        volume: {
          description: input.description ?? "",
          name: input.name,
        },
      }),
      method: "PUT",
    },
  );
}

export async function extendEvsDisk(
  session: BetterUiSession,
  diskId: string,
  newSizeGb: number,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<{ job_id?: string }>(
    project,
    "evs",
    `/v2.1/${project.projectId}/cloudvolumes/${diskId}/action`,
    {
      body: JSON.stringify({
        "os-extend": {
          new_size: newSizeGb,
        },
      }),
      method: "POST",
    },
  );
}

export async function attachEvsDiskToEcs(
  session: BetterUiSession,
  diskId: string,
  serverId: string,
  device: string,
  volumeType: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<{ job_id?: string }>(
    project,
    "ecs",
    `/v1/${project.projectId}/cloudservers/${serverId}/attachvolume`,
    {
      body: JSON.stringify({
        dry_run: false,
        volumeAttachment: {
          device,
          volumeId: diskId,
          volume_type: volumeType,
        },
      }),
      method: "POST",
    },
  );
}

export async function detachEvsDiskFromEcs(
  session: BetterUiSession,
  diskId: string,
  serverId: string,
  force: boolean,
  projectId?: string,
) {
  const project = projectForId(session, projectId);
  const query = new URLSearchParams({ delete_flag: force ? "1" : "0" });

  return huaweiFetch<{ job_id?: string }>(
    project,
    "ecs",
    `/v1/${project.projectId}/cloudservers/${serverId}/detachvolume/${diskId}?${query.toString()}`,
    { method: "DELETE" },
  );
}

export async function deleteEvsDisk(
  session: BetterUiSession,
  diskId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<{ job_id?: string }>(
    project,
    "evs",
    `/v2/${project.projectId}/cloudvolumes/${diskId}`,
    { method: "DELETE" },
  );
}

export function parseEvsSnapshot(
  snapshot: unknown,
  session: HuaweiProjectSession,
): EvsSnapshot {
  const item = asRecord(snapshot);
  const rawSizeGb = Number(item.size ?? 0);

  return {
    createdAt: firstString([item.created_at, item.createdAt]),
    description: asString(item.description, ""),
    diskId: firstString([item.volume_id, item.volumeId, item.volume_id_v2]),
    id: asString(item.id),
    name: firstString([item.name, item.id]),
    projectId: session.projectId,
    projectName: session.projectName,
    rawSizeGb,
    region: session.region,
    size: `${rawSizeGb} GB`,
    status: asString(item.status, "UNKNOWN"),
  };
}

export async function listEvsSnapshotsForProject(
  session: HuaweiProjectSession,
  diskId?: string,
) {
  const query = new URLSearchParams({ limit: "100" });

  if (diskId) {
    query.set("volume_id", diskId);
  }

  const body = await huaweiList<{
    cloudsnapshots?: unknown[];
    snapshots?: unknown[];
  }>(
    session,
    "evs",
    `/v2/${session.projectId}/cloudsnapshots/detail?${query.toString()}`,
    {
      items: ["cloudsnapshots", "snapshots"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.cloudsnapshots ?? body.snapshots).map((snapshot) =>
    parseEvsSnapshot(snapshot, session),
  );
}

export async function listEvsSnapshots(session: BetterUiSession) {
  return loadAcrossProjects(session, listEvsSnapshotsForProject);
}

export async function createEvsSnapshot(
  session: BetterUiSession,
  diskId: string,
  name: string,
  description: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<{ id?: string; snapshot?: { id?: string } }>(
    project,
    "evs",
    `/v2/${project.projectId}/cloudsnapshots`,
    {
      body: JSON.stringify({
        snapshot: {
          description,
          force: true,
          name,
          volume_id: diskId,
        },
      }),
      method: "POST",
    },
  );
}

export async function deleteEvsSnapshot(
  session: BetterUiSession,
  snapshotId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "evs",
    `/v2/${project.projectId}/cloudsnapshots/${snapshotId}`,
    { method: "DELETE" },
  );
}

export async function rollbackEvsSnapshot(
  session: BetterUiSession,
  snapshotId: string,
  diskId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<{ job_id?: string }>(
    project,
    "evs",
    `/v2/${project.projectId}/cloudsnapshots/${snapshotId}/rollback`,
    {
      body: JSON.stringify({
        rollback: {
          volume_id: diskId,
        },
      }),
      method: "POST",
    },
  );
}
