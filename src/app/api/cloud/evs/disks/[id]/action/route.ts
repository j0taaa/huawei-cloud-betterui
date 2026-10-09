import { NextResponse } from "next/server";
import { recordAcceptedOperation } from "@/lib/huawei/management/accepted-operation";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";

import { getCurrentSession } from "@/lib/auth-session";
import {
  attachEvsDiskToEcs,
  detachEvsDiskFromEcs,
  extendEvsDisk,
  getEvsDisk,
  invalidateCloudResult,
  updateEvsDisk,
} from "@/lib/huawei-cloud";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function invalidateDisk(session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>, diskId: string) {
  await Promise.all([
    invalidateCloudResult(session, "listEvsDisks"),
    invalidateCloudResult(session, "evs-page-inventory"),
    invalidateCloudResult(session, `evs-disk:${diskId}`),
    invalidateCloudResult(session, "cloud-summary"),
  ]);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    description?: unknown;
    device?: unknown;
    force?: unknown;
    name?: unknown;
    newSizeGb?: unknown;
    serverId?: unknown;
  } | null;
  const disk = await getEvsDisk(session, id);

  if (!disk) {
    return NextResponse.json({ error: "EVS disk was not found." }, { status: 404 });
  }

  try {
    if (body?.action === "update") {
      const name = cleanString(body.name);

      if (!name) {
        return NextResponse.json({ error: "Disk name is required." }, { status: 400 });
      }

      await updateEvsDisk(
        session,
        id,
        {
          description: cleanString(body.description),
          name,
        },
        disk.projectId,
      );
      const receipt = await recordAcceptedOperation(session, { service: "evs", operation: "Edit disk", projectId: disk.projectId, resourceId: id, resourceName: disk.name }, () => invalidateDisk(session, id));

      return NextResponse.json({ ok: true, ...receipt });
    }

    if (body?.action === "extend") {
      const newSizeGb = Number(body.newSizeGb);

      if (!Number.isInteger(newSizeGb) || newSizeGb <= disk.rawSizeGb || newSizeGb > 32768) {
        return NextResponse.json(
          { error: `New size must be a whole number greater than ${disk.rawSizeGb} GB and not more than 32768 GB.` },
          { status: 400 },
        );
      }

      const result = await extendEvsDisk(session, id, newSizeGb, disk.projectId);
      const receipt = await recordAcceptedOperation(session, { service: "evs", operation: "Expand disk", projectId: disk.projectId, resourceId: id, resourceName: disk.name, jobId: result.job_id }, () => invalidateDisk(session, id));

      return NextResponse.json({ jobId: result.job_id ?? null, ok: true, ...receipt });
    }

    if (body?.action === "attach") {
      const serverId = cleanString(body.serverId);
      const device = cleanString(body.device) || "/dev/sdb";

      if (!serverId) {
        return NextResponse.json({ error: "ECS instance is required." }, { status: 400 });
      }

      if (disk.attachedServerId) {
        return NextResponse.json({ error: "This disk is already attached." }, { status: 409 });
      }

      const result = await attachEvsDiskToEcs(
        session,
        id,
        serverId,
        device,
        disk.type,
        disk.projectId,
      );
      const receipt = await recordAcceptedOperation(session, { service: "evs", operation: "Attach disk", projectId: disk.projectId, resourceId: id, resourceName: disk.name, jobId: result.job_id }, () => Promise.all([invalidateDisk(session, id), invalidateCloudResult(session, cloudCacheKeys.ecs(serverId)), invalidateCloudResult(session, cloudCacheKeys.listEcsInstances)]));

      return NextResponse.json({ jobId: result.job_id ?? null, ok: true, ...receipt });
    }

    if (body?.action === "detach") {
      const serverId = cleanString(body.serverId) || disk.attachedServerId;

      if (!serverId) {
        return NextResponse.json({ error: "This disk is not attached." }, { status: 409 });
      }

      const result = await detachEvsDiskFromEcs(
        session,
        id,
        serverId,
        body.force === true,
        disk.projectId,
      );
      const receipt = await recordAcceptedOperation(session, { service: "evs", operation: "Detach data disk", projectId: disk.projectId, resourceId: id, resourceName: disk.name, jobId: result.job_id }, () => Promise.all([invalidateDisk(session, id), invalidateCloudResult(session, cloudCacheKeys.ecs(serverId)), invalidateCloudResult(session, cloudCacheKeys.listEcsInstances)]));

      return NextResponse.json({ jobId: result.job_id ?? null, ok: true, ...receipt });
    }

    return NextResponse.json({ error: "Unsupported EVS disk action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei EVS disk action failed.",
      },
      { status: 502 },
    );
  }
}
