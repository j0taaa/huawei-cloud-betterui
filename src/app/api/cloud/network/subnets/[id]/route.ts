import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteSubnet,
  invalidateCloudResult,
  listSubnets,
  updateSubnet,
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
    name?: unknown;
    projectId?: unknown;
    vpcId?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json(
      { error: "Subnet name is required." },
      { status: 400 },
    );
  }

  if (typeof body?.vpcId !== "string" || !body.vpcId.trim()) {
    return NextResponse.json({ error: "VPC id is required." }, { status: 400 });
  }

  try {
    const { id } = await params;
    await updateSubnet(session, id, {
      name,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      vpcId: body.vpcId,
    });
    await invalidateCloudResult(session, "listSubnets");
    await invalidateCloudResult(session, `subnet:${id}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Subnet update failed." },
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
    vpcId?: unknown;
  } | null;

  try {
    const { id } = await params;
    const item = (await listSubnets(session)).find(
      (subnet) =>
        subnet.id === id &&
        (typeof body?.projectId !== "string" ||
          subnet.projectId === body.projectId),
    );

    if (!item) {
      return NextResponse.json({ error: "Subnet not found." }, { status: 404 });
    }

    if (body?.confirmName !== item.name) {
      return NextResponse.json(
        { error: "Type the exact subnet name to confirm deletion." },
        { status: 400 },
      );
    }

    await deleteSubnet(session, id, {
      projectId: item.projectId,
      vpcId: item.vpcId,
    });
    await invalidateCloudResult(session, "listSubnets");
    await invalidateCloudResult(session, `subnet:${id}`);
    await invalidateCloudResult(session, `vpc:${item.vpcId}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Subnet deletion failed.",
      },
      { status: 502 },
    );
  }
}
