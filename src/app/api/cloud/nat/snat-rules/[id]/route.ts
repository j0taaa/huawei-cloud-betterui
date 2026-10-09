import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteNatSnatRule,
  getNatSnatRule,
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
    confirmId?: unknown;
    gatewayId?: unknown;
    projectId?: unknown;
  } | null;
  const rule = await getNatSnatRule(session, id);

  if (!rule) {
    return NextResponse.json({ error: "SNAT rule was not found." }, { status: 404 });
  }

  if (typeof body?.projectId === "string" && body.projectId && body.projectId !== rule.projectId) {
    return NextResponse.json(
      { error: "Project does not match the selected SNAT rule." },
      { status: 409 },
    );
  }

  if (typeof body?.gatewayId === "string" && body.gatewayId && body.gatewayId !== rule.gatewayId) {
    return NextResponse.json(
      { error: "Gateway does not match the selected SNAT rule." },
      { status: 409 },
    );
  }

  if (typeof body?.confirmId !== "string" || body.confirmId.trim() !== rule.id) {
    return NextResponse.json(
      { error: "Type the SNAT rule ID exactly to confirm deletion." },
      { status: 400 },
    );
  }

  if (rule.status.toUpperCase().startsWith("PENDING")) {
    return NextResponse.json(
      { error: "SNAT rules with pending operations cannot be deleted." },
      { status: 409 },
    );
  }

  try {
    await deleteNatSnatRule(session, id, rule.gatewayId, rule.projectId);

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
          error instanceof Error ? error.message : "Huawei SNAT rule deletion failed.",
      },
      { status: 502 },
    );
  }
}
