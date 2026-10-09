import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createDnsZone,
  invalidateCloudResult,
  type CreateDnsZoneInput,
} from "@/lib/huawei-cloud";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    description?: unknown;
    email?: unknown;
    name?: unknown;
    projectId?: unknown;
    ttl?: unknown;
  } | null;
  const ttl = Number(body?.ttl ?? 300);
  const input: CreateDnsZoneInput = {
    description: cleanString(body?.description) || undefined,
    email: cleanString(body?.email) || undefined,
    name: cleanString(body?.name),
    projectId: cleanString(body?.projectId) || undefined,
    ttl: Number.isFinite(ttl) ? ttl : undefined,
  };

  if (!input.name) {
    return NextResponse.json({ error: "Zone name is required." }, { status: 400 });
  }

  if (
    input.name.length > 254 ||
    !/^(?=.{1,254}\.?$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\.?$/.test(
      input.name,
    )
  ) {
    return NextResponse.json(
      { error: "Enter a valid DNS zone name, for example example.com." },
      { status: 400 },
    );
  }

  if (input.description && input.description.length > 255) {
    return NextResponse.json(
      { error: "Description must be 255 characters or fewer." },
      { status: 400 },
    );
  }

  if (input.ttl && (input.ttl < 1 || input.ttl > 2_147_483_647)) {
    return NextResponse.json(
      { error: "TTL must be between 1 and 2147483647 seconds." },
      { status: 400 },
    );
  }

  try {
    const result = await createDnsZone(session, input);

    await invalidateCloudResult(session, "listDnsZones");

    return NextResponse.json({
      id: typeof result.id === "string" ? result.id : null,
      ok: true,
      status: typeof result.status === "string" ? result.status : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei DNS zone creation failed.",
      },
      { status: 502 },
    );
  }
}
