import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createNatGateway,
  invalidateCloudResult,
  type CreateNatGatewayInput,
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
    enterpriseProjectId?: unknown;
    name?: unknown;
    projectId?: unknown;
    routerId?: unknown;
    spec?: unknown;
    subnetId?: unknown;
  } | null;
  const input: CreateNatGatewayInput = {
    description: cleanString(body?.description),
    enterpriseProjectId: cleanString(body?.enterpriseProjectId) || undefined,
    name: cleanString(body?.name),
    projectId: cleanString(body?.projectId) || undefined,
    routerId: cleanString(body?.routerId),
    spec: cleanString(body?.spec),
    subnetId: cleanString(body?.subnetId),
  };

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.name)) {
    return NextResponse.json(
      { error: "Gateway name must be 1-64 letters, numbers, underscores, or hyphens." },
      { status: 400 },
    );
  }

  if (!input.routerId) {
    return NextResponse.json({ error: "VPC ID is required." }, { status: 400 });
  }

  if (!input.subnetId) {
    return NextResponse.json({ error: "Subnet network ID is required." }, { status: 400 });
  }

  if (!["1", "2", "3", "4", "5"].includes(input.spec)) {
    return NextResponse.json(
      { error: "Gateway spec must be one of 1, 2, 3, 4, or 5." },
      { status: 400 },
    );
  }

  if (input.description && /[<>]/.test(input.description)) {
    return NextResponse.json(
      { error: "Description cannot contain angle brackets." },
      { status: 400 },
    );
  }

  try {
    const result = await createNatGateway(session, input);

    await Promise.all([
      invalidateCloudResult(session, "listNatGateways"),
      invalidateCloudResult(session, "listNatSnatRules"),
      invalidateCloudResult(session, "cloud-summary"),
    ]);

    return NextResponse.json({
      gatewayId:
        result.nat_gateway_id ??
        (typeof result.nat_gateway === "object" &&
        result.nat_gateway !== null &&
        "id" in result.nat_gateway
          ? String(result.nat_gateway.id)
          : null),
      ok: true,
      orderId: result.order_id ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei NAT gateway creation failed.",
      },
      { status: 502 },
    );
  }
}
