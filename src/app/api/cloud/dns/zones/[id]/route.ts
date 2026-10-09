import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import { deleteDnsZone, invalidateCloudResult, listDnsZones } from "@/lib/huawei-cloud";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const zoneId = decodeURIComponent(id);
  const body = (await request.json().catch(() => null)) as {
    confirmName?: unknown;
  } | null;
  const zone = (await listDnsZones(session)).find((item) => item.id === zoneId);

  if (!zone) {
    return NextResponse.json({ error: "DNS zone was not found." }, { status: 404 });
  }

  if (typeof body?.confirmName !== "string" || body.confirmName.trim() !== zone.name) {
    return NextResponse.json(
      { error: "Type the zone name exactly to confirm deletion." },
      { status: 400 },
    );
  }

  try {
    const result = await deleteDnsZone(session, zoneId, zone.projectId);

    await invalidateCloudResult(session, "listDnsZones");

    return NextResponse.json({
      id: typeof result.id === "string" ? result.id : zoneId,
      ok: true,
      status: typeof result.status === "string" ? result.status : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei DNS zone deletion failed.",
      },
      { status: 502 },
    );
  }
}
