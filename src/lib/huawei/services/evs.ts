import "server-only";

import { mapCloudLoad } from "@/lib/huawei/errors";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects, projectForId } from "@/lib/huawei/projects";

export type EvsDisk = {
  availabilityZone: string;
  attachedTo: string;
  createdAt: string;
  id: string;
  name: string;
  size: string;
  status: string;
  type: string;
  projectId: string;
  projectName: string;
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
  region: string;
  size: string;
  status: string;
};

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
    return {
      attachedTo: firstString([
        firstAttachment.server_id,
        firstAttachment.device,
      ]),
      availabilityZone: asString(item.availability_zone),
      createdAt: asString(item.created_at),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      size: `${Number(item.size ?? 0)} GB`,
      status: asString(item.status, "UNKNOWN"),
      type: asString(item.volume_type),
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

export function parseEvsSnapshot(
  snapshot: unknown,
  session: HuaweiProjectSession,
): EvsSnapshot {
  const item = asRecord(snapshot);

  return {
    createdAt: firstString([item.created_at, item.createdAt]),
    description: asString(item.description, ""),
    diskId: firstString([item.volume_id, item.volumeId, item.volume_id_v2]),
    id: asString(item.id),
    name: firstString([item.name, item.id]),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    size: `${Number(item.size ?? 0)} GB`,
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
    snapshots?: unknown[];
    cloudsnapshots?: unknown[];
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

  return huaweiFetch<{ snapshot?: { id?: string }; id?: string }>(
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
