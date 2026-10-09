import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteSfsShare,
  getSfsShare,
  invalidateCloudResult,
} from "@/lib/huawei-cloud";

const deletableStatuses = new Set(["available", "unavailable", "error"]);

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
  const projectId = typeof body?.projectId === "string" ? body.projectId : undefined;
  const share = await getSfsShare(session, id, projectId);

  if (!share) {
    return NextResponse.json(
      { error: "SFS file system was not found." },
      { status: 404 },
    );
  }

  if (
    typeof body?.confirmName !== "string" ||
    body.confirmName.trim() !== share.name
  ) {
    return NextResponse.json(
      { error: "Type the file system name exactly to confirm deletion." },
      { status: 400 },
    );
  }

  if (!deletableStatuses.has(share.status.toLowerCase())) {
    return NextResponse.json(
      {
        error: `Only Available, Unavailable, or Creation failed file systems can be deleted. Current status: ${share.status}.`,
      },
      { status: 409 },
    );
  }

  try {
    await deleteSfsShare(session, id, share.projectId);

    await Promise.all([
      invalidateCloudResult(session, "listSfsShares"),
      invalidateCloudResult(session, `sfs-access-rules:${id}:${share.projectId}`),
      invalidateCloudResult(session, "cloud-summary"),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei SFS file system deletion failed.",
      },
      { status: 502 },
    );
  }
}
