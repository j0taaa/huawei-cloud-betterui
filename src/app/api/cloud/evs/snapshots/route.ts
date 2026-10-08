import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createEvsSnapshot,
  deleteEvsSnapshot,
  invalidateCloudResult,
} from "@/lib/huawei-cloud";

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    description?: unknown;
    diskId?: unknown;
    ecsId?: unknown;
    name?: unknown;
    projectId?: unknown;
  } | null;

  if (typeof body?.diskId !== "string" || !body.diskId.trim()) {
    return NextResponse.json({ error: "Disk id is required." }, { status: 400 });
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Snapshot name is required." }, { status: 400 });
  }

  try {
    const result = await createEvsSnapshot(
      session,
      body.diskId,
      body.name.trim(),
      typeof body.description === "string" ? body.description.trim() : "",
      typeof body.projectId === "string" ? body.projectId : undefined,
    );

    if (typeof body.ecsId === "string") {
      await invalidateCloudResult(session, cloudCacheKeys.ecsSnapshots(body.ecsId));
    }

    return NextResponse.json({
      id: result.snapshot?.id ?? result.id ?? null,
      ok: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei EVS snapshot creation failed.",
      },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    ecsId?: unknown;
    projectId?: unknown;
    snapshotId?: unknown;
  } | null;

  if (typeof body?.snapshotId !== "string" || !body.snapshotId.trim()) {
    return NextResponse.json({ error: "Snapshot id is required." }, { status: 400 });
  }

  try {
    await deleteEvsSnapshot(
      session,
      body.snapshotId,
      typeof body.projectId === "string" ? body.projectId : undefined,
    );

    if (typeof body.ecsId === "string") {
      await invalidateCloudResult(session, cloudCacheKeys.ecsSnapshots(body.ecsId));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei EVS snapshot deletion failed.",
      },
      { status: 502 },
    );
  }
}
