import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteEvsDisk,
  getEvsDisk,
  invalidateCloudResult,
} from "@/lib/huawei-cloud";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    confirmName?: unknown;
    projectId?: unknown;
  } | null;
  const disk = await getEvsDisk(session, id);

  if (!disk) {
    return NextResponse.json({ error: "EVS disk was not found." }, { status: 404 });
  }

  if (typeof body?.confirmName !== "string" || body.confirmName.trim() !== disk.name) {
    return NextResponse.json(
      { error: "Type the disk name exactly to confirm deletion." },
      { status: 400 },
    );
  }

  if (disk.attachedTo && disk.attachedTo !== "-") {
    return NextResponse.json(
      { error: "Detach this disk before deleting it." },
      { status: 409 },
    );
  }

  if (disk.status.toLowerCase() === "in-use") {
    return NextResponse.json(
      { error: "In-use disks cannot be deleted." },
      { status: 409 },
    );
  }

  try {
    const result = await deleteEvsDisk(
      session,
      id,
      disk.projectId,
    );

    await Promise.all([
      invalidateCloudResult(session, "listEvsDisks"),
      invalidateCloudResult(session, "evs-page-inventory"),
      invalidateCloudResult(session, `evs-disk:${id}`),
      invalidateCloudResult(session, "cloud-summary"),
    ]);

    return NextResponse.json({ jobId: result.job_id ?? null, ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei EVS disk deletion failed.",
      },
      { status: 502 },
    );
  }
}
