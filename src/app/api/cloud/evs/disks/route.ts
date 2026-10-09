import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createEvsDisk,
  invalidateCloudResult,
  listEvsSnapshots,
  type CreateEvsDiskInput,
} from "@/lib/huawei-cloud";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    availabilityZone?: unknown;
    description?: unknown;
    isShareable?: unknown;
    name?: unknown;
    projectId?: unknown;
    sizeGb?: unknown;
    snapshotId?: unknown;
    volumeType?: unknown;
  } | null;
  const input: CreateEvsDiskInput = {
    availabilityZone: cleanString(body?.availabilityZone),
    description: cleanString(body?.description),
    isShareable: body?.isShareable === true,
    name: cleanString(body?.name),
    projectId: cleanString(body?.projectId) || undefined,
    sizeGb: Number(body?.sizeGb),
    snapshotId: cleanString(body?.snapshotId) || undefined,
    volumeType: cleanString(body?.volumeType),
  };

  if (!input.name) {
    return NextResponse.json({ error: "Disk name is required." }, { status: 400 });
  }

  if (!input.availabilityZone) {
    return NextResponse.json(
      { error: "Availability zone is required." },
      { status: 400 },
    );
  }

  if (!input.volumeType) {
    return NextResponse.json({ error: "Disk type is required." }, { status: 400 });
  }

  if (!Number.isInteger(input.sizeGb) || input.sizeGb < 10 || input.sizeGb > 32768) {
    return NextResponse.json(
      { error: "Disk size must be a whole number from 10 to 32768 GB." },
      { status: 400 },
    );
  }

  if (input.snapshotId) {
    const snapshots = await listEvsSnapshots(session);
    const snapshot = snapshots.find((item) => item.id === input.snapshotId);

    if (!snapshot) {
      return NextResponse.json({ error: "EVS snapshot was not found." }, { status: 404 });
    }

    if (input.projectId && input.projectId !== snapshot.projectId) {
      return NextResponse.json(
        { error: "Snapshot project does not match the selected project." },
        { status: 400 },
      );
    }

    if (input.sizeGb < snapshot.rawSizeGb) {
      return NextResponse.json(
        { error: `Disk size must be at least ${snapshot.rawSizeGb} GB for this snapshot.` },
        { status: 400 },
      );
    }

    input.projectId = snapshot.projectId;
  }

  try {
    const result = await createEvsDisk(session, input);

    await Promise.all([
      invalidateCloudResult(session, "listEvsDisks"),
      invalidateCloudResult(session, "evs-page-inventory"),
      invalidateCloudResult(session, "evs-snapshot-inventory"),
      invalidateCloudResult(session, "cloud-summary"),
    ]);

    return NextResponse.json({
      jobId: result.job_id ?? null,
      ok: true,
      volumeId: result.volume?.id ?? result.volume_ids?.[0] ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei EVS disk creation failed.",
      },
      { status: 502 },
    );
  }
}
