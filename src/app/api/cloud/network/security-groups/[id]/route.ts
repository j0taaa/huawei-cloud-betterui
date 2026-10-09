import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteSecurityGroup,
  invalidateCloudResult,
  listSecurityGroups,
  updateSecurityGroup,
} from "@/lib/huawei-cloud";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    description?: unknown;
    name?: unknown;
    projectId?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";

  if (!name) {
    return NextResponse.json(
      { error: "Security group name is required." },
      { status: 400 },
    );
  }

  if (description.includes("<") || description.includes(">")) {
    return NextResponse.json(
      { error: "Description cannot contain angle brackets." },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    await updateSecurityGroup(session, id, {
      description,
      name,
      projectId: typeof body?.projectId === "string" ? body.projectId : undefined,
    });
    await invalidateCloudResult(session, "listSecurityGroups");
    await invalidateCloudResult(session, `security-group:${id}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Security group update failed.",
      },
      { status: 502 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    confirmName?: unknown;
    projectId?: unknown;
  } | null;

  try {
    const { id } = await params;
    const item = (await listSecurityGroups(session)).find(
      (group) =>
        group.id === id &&
        (typeof body?.projectId !== "string" ||
          group.projectId === body.projectId),
    );

    if (!item) {
      return NextResponse.json(
        { error: "Security group not found." },
        { status: 404 },
      );
    }

    if (body?.confirmName !== item.name) {
      return NextResponse.json(
        { error: "Type the exact security group name to confirm deletion." },
        { status: 400 },
      );
    }

    await deleteSecurityGroup(session, id, item.projectId);
    await invalidateCloudResult(session, "listSecurityGroups");
    await invalidateCloudResult(session, `security-group:${id}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Security group deletion failed.",
      },
      { status: 502 },
    );
  }
}
