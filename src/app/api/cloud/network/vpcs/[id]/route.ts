import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteVpc,
  invalidateCloudResult,
  listVpcs,
  updateVpc,
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
    return NextResponse.json({ error: "VPC name is required." }, { status: 400 });
  }

  if (description.includes("<") || description.includes(">")) {
    return NextResponse.json(
      { error: "Description cannot contain angle brackets." },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    await updateVpc(session, id, {
      description,
      name,
      projectId: typeof body?.projectId === "string" ? body.projectId : undefined,
    });
    await invalidateCloudResult(session, "listVpcs");
    await invalidateCloudResult(session, `vpc:${id}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "VPC update failed." },
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
    const item = (await listVpcs(session)).find(
      (vpc) =>
        vpc.id === id &&
        (typeof body?.projectId !== "string" ||
          vpc.projectId === body.projectId),
    );

    if (!item) {
      return NextResponse.json({ error: "VPC not found." }, { status: 404 });
    }

    if (body?.confirmName !== item.name) {
      return NextResponse.json(
        { error: "Type the exact VPC name to confirm deletion." },
        { status: 400 },
      );
    }

    await deleteVpc(session, id, item.projectId);
    await invalidateCloudResult(session, "listVpcs");
    await invalidateCloudResult(session, "listSubnets");
    await invalidateCloudResult(session, `vpc:${id}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "VPC deletion failed." },
      { status: 502 },
    );
  }
}
