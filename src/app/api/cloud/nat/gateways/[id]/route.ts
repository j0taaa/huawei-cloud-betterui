import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteNatGateway,
  getNatGateway,
  listNatSnatRules,
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
  const gateway = await getNatGateway(session, id);

  if (!gateway) {
    return NextResponse.json({ error: "NAT gateway was not found." }, { status: 404 });
  }

  if (typeof body?.projectId === "string" && body.projectId && body.projectId !== gateway.projectId) {
    return NextResponse.json(
      { error: "Project does not match the selected NAT gateway." },
      { status: 409 },
    );
  }

  if (typeof body?.confirmName !== "string" || body.confirmName.trim() !== gateway.name) {
    return NextResponse.json(
      { error: "Type the NAT gateway name exactly to confirm deletion." },
      { status: 400 },
    );
  }

  if (gateway.status.toUpperCase().startsWith("PENDING")) {
    return NextResponse.json(
      { error: "NAT gateways with pending operations cannot be deleted." },
      { status: 409 },
    );
  }

  const linkedRules = (await listNatSnatRules(session)).filter(
    (rule) => rule.gatewayId === gateway.id,
  );

  if (linkedRules.length > 0) {
    return NextResponse.json(
      { error: "Delete SNAT rules attached to this gateway before deleting it." },
      { status: 409 },
    );
  }

  try {
    await deleteNatGateway(session, id, gateway.projectId);

    await Promise.all([
      invalidateCloudResult(session, "listNatGateways"),
      invalidateCloudResult(session, "listNatSnatRules"),
      invalidateCloudResult(session, "cloud-summary"),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei NAT gateway deletion failed.",
      },
      { status: 502 },
    );
  }
}
