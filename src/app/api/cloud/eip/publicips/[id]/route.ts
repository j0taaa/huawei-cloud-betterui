import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import { invalidateCloudResult, listEips, releaseEip } from "@/lib/huawei-cloud";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const publicIpId = decodeURIComponent(id);
  const body = (await request.json().catch(() => null)) as {
    confirmName?: unknown;
    projectId?: unknown;
  } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : undefined;
  const eip = (await listEips(session)).find(
    (item) => item.id === publicIpId && (!projectId || item.projectId === projectId),
  );

  if (!eip) {
    return NextResponse.json({ error: "EIP was not found." }, { status: 404 });
  }

  if (
    eip.status.toUpperCase() !== "DOWN" ||
    eip.portId ||
    eip.associatedInstanceId
  ) {
    return NextResponse.json(
      { error: "Only unbound EIPs in DOWN status can be released." },
      { status: 409 },
    );
  }

  const confirmation = typeof body?.confirmName === "string" ? body.confirmName.trim() : "";

  if (confirmation !== eip.name && confirmation !== eip.ipAddress) {
    return NextResponse.json(
      { error: "Type the EIP name or public IP exactly to confirm release." },
      { status: 400 },
    );
  }

  try {
    await releaseEip(session, publicIpId, eip.projectId);
    await invalidateCloudResult(session, "listEips");

    return NextResponse.json({ id: publicIpId, ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Huawei EIP release failed." },
      { status: 502 },
    );
  }
}
