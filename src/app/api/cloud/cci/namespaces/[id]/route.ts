import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteCciNamespace,
  getCciNamespace,
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
  const namespace = await getCciNamespace(session, id);

  if (!namespace) {
    return NextResponse.json(
      { error: "CCI namespace was not found." },
      { status: 404 },
    );
  }

  if (
    typeof body?.confirmName !== "string" ||
    body.confirmName.trim() !== namespace.name
  ) {
    return NextResponse.json(
      { error: "Type the namespace name exactly to confirm deletion." },
      { status: 400 },
    );
  }

  try {
    await deleteCciNamespace(
      session,
      id,
      typeof body?.projectId === "string" ? body.projectId : namespace.projectId,
    );

    await Promise.all([
      invalidateCloudResult(session, "listCciNamespaces"),
      invalidateCloudResult(session, `cci-namespace:${id}`),
      invalidateCloudResult(session, "cloud-summary"),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei CCI namespace deletion failed.",
      },
      { status: 502 },
    );
  }
}
