import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteImage,
  getImage,
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
  const projectId = typeof body?.projectId === "string" ? body.projectId : undefined;
  const image = await getImage(session, id, projectId);

  if (!image) {
    return NextResponse.json({ error: "IMS image was not found." }, { status: 404 });
  }

  if (typeof body?.confirmName !== "string" || body.confirmName.trim() !== image.name) {
    return NextResponse.json(
      { error: "Type the image name exactly to confirm deletion." },
      { status: 400 },
    );
  }

  if (image.isProtected) {
    return NextResponse.json(
      { error: "Protected images cannot be deleted from this UI." },
      { status: 409 },
    );
  }

  if (
    image.imageType.toLowerCase() !== "private" &&
    image.visibility.toLowerCase() !== "private"
  ) {
    return NextResponse.json(
      { error: "Only private images can be deleted from this UI." },
      { status: 409 },
    );
  }

  try {
    await deleteImage(session, id, image.projectId);

    await Promise.all([
      invalidateCloudResult(session, "listImages"),
      invalidateCloudResult(session, `ims-image:${id}:${image.projectId}`),
      invalidateCloudResult(session, "cloud-summary"),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei IMS image deletion failed.",
      },
      { status: 502 },
    );
  }
}
