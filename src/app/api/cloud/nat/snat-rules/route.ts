import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createNatSnatRule,
  getNatGateway,
  invalidateCloudResult,
  type CreateNatSnatRuleInput,
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
    cidr?: unknown;
    description?: unknown;
    floatingIpId?: unknown;
    gatewayId?: unknown;
    networkId?: unknown;
    projectId?: unknown;
    sourceType?: unknown;
  } | null;
  const input: CreateNatSnatRuleInput = {
    cidr: cleanString(body?.cidr) || undefined,
    description: cleanString(body?.description),
    floatingIpId: cleanString(body?.floatingIpId),
    gatewayId: cleanString(body?.gatewayId),
    networkId: cleanString(body?.networkId) || undefined,
    projectId: cleanString(body?.projectId) || undefined,
    sourceType: Number(body?.sourceType ?? 0),
  };

  if (!input.gatewayId) {
    return NextResponse.json({ error: "NAT gateway is required." }, { status: 400 });
  }

  const gateway = await getNatGateway(session, input.gatewayId);

  if (!gateway) {
    return NextResponse.json({ error: "NAT gateway was not found." }, { status: 404 });
  }

  if (input.projectId && input.projectId !== gateway.projectId) {
    return NextResponse.json(
      { error: "Project does not match the selected NAT gateway." },
      { status: 409 },
    );
  }

  if (gateway.status.toUpperCase() !== "ACTIVE" || !gateway.adminStateUp) {
    return NextResponse.json(
      { error: "SNAT rules can only be created on an active, unfrozen NAT gateway." },
      { status: 409 },
    );
  }

  if (![0, 1].includes(input.sourceType)) {
    return NextResponse.json(
      { error: "Source type must be VPC or Direct Connect/Cloud Connect." },
      { status: 400 },
    );
  }

  if (!input.networkId && !input.cidr) {
    return NextResponse.json(
      { error: "Provide either a subnet network ID or a CIDR block." },
      { status: 400 },
    );
  }

  if (input.sourceType === 1 && input.networkId) {
    return NextResponse.json(
      { error: "Direct Connect/Cloud Connect SNAT rules must use CIDR, not subnet network ID." },
      { status: 400 },
    );
  }

  if (!input.floatingIpId) {
    return NextResponse.json({ error: "EIP ID is required." }, { status: 400 });
  }

  if (input.description && /[<>]/.test(input.description)) {
    return NextResponse.json(
      { error: "Description cannot contain angle brackets." },
      { status: 400 },
    );
  }

  try {
    const result = await createNatSnatRule(session, {
      ...input,
      projectId: gateway.projectId,
    });

    await Promise.all([
      invalidateCloudResult(session, "listNatGateways"),
      invalidateCloudResult(session, "listNatSnatRules"),
      invalidateCloudResult(session, "cloud-summary"),
    ]);

    return NextResponse.json({
      ok: true,
      ruleId:
        typeof result.snat_rule === "object" &&
        result.snat_rule !== null &&
        "id" in result.snat_rule
          ? String(result.snat_rule.id)
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei SNAT rule creation failed.",
      },
      { status: 502 },
    );
  }
}
