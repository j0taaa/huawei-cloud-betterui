import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createEip,
  invalidateCloudResult,
  type CreateEipInput,
} from "@/lib/huawei-cloud";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    alias?: unknown;
    bandwidthChargeMode?: unknown;
    bandwidthName?: unknown;
    bandwidthSize?: unknown;
    enterpriseProjectId?: unknown;
    ipAddress?: unknown;
    portId?: unknown;
    projectId?: unknown;
    shareType?: unknown;
    sharedBandwidthId?: unknown;
    type?: unknown;
  } | null;
  const shareType = cleanEnum(body?.shareType, ["PER", "WHOLE"] as const, "PER");
  const bandwidthSize = Number(body?.bandwidthSize ?? 5);
  const input: CreateEipInput = {
    alias: cleanString(body?.alias) || undefined,
    bandwidthChargeMode: cleanEnum(
      body?.bandwidthChargeMode,
      ["bandwidth", "traffic"] as const,
      "traffic",
    ),
    bandwidthName: cleanString(body?.bandwidthName) || undefined,
    bandwidthSize: Number.isFinite(bandwidthSize) ? bandwidthSize : undefined,
    enterpriseProjectId: cleanString(body?.enterpriseProjectId) || undefined,
    ipAddress: cleanString(body?.ipAddress) || undefined,
    ipVersion: 4,
    portId: cleanString(body?.portId) || undefined,
    projectId: cleanString(body?.projectId) || undefined,
    shareType,
    sharedBandwidthId: cleanString(body?.sharedBandwidthId) || undefined,
    type: cleanEnum(body?.type, ["5_bgp", "5_sbgp"] as const, "5_bgp"),
  };

  if (input.alias && !/^[A-Za-z0-9_.-]{1,64}$/.test(input.alias)) {
    return NextResponse.json(
      { error: "EIP name can contain 1 to 64 letters, digits, underscores, hyphens, and periods." },
      { status: 400 },
    );
  }

  if (input.ipAddress && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(input.ipAddress)) {
    return NextResponse.json(
      { error: "Specific IP address must be a valid IPv4 address." },
      { status: 400 },
    );
  }

  if (shareType === "PER") {
    const dedicatedBandwidthSize = input.bandwidthSize;

    if (!input.bandwidthName) {
      return NextResponse.json(
        { error: "Dedicated bandwidth name is required." },
        { status: 400 },
      );
    }

    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(input.bandwidthName)) {
      return NextResponse.json(
        { error: "Bandwidth name can contain 1 to 64 letters, digits, underscores, hyphens, and periods." },
        { status: 400 },
      );
    }

    if (
      dedicatedBandwidthSize === undefined ||
      !Number.isInteger(dedicatedBandwidthSize) ||
      dedicatedBandwidthSize < 1 ||
      dedicatedBandwidthSize > 300
    ) {
      return NextResponse.json(
        { error: "Bandwidth size must be an integer from 1 to 300 Mbit/s." },
        { status: 400 },
      );
    }
  }

  if (shareType === "WHOLE" && !input.sharedBandwidthId) {
    return NextResponse.json(
      { error: "Shared bandwidth ID is required." },
      { status: 400 },
    );
  }

  try {
    const result = await createEip(session, input);
    const publicip = result.publicip ?? {};

    await invalidateCloudResult(session, "listEips");

    return NextResponse.json({
      id: typeof publicip.id === "string" ? publicip.id : null,
      ipAddress:
        typeof publicip.public_ip_address === "string"
          ? publicip.public_ip_address
          : null,
      ok: true,
      status: typeof publicip.status === "string" ? publicip.status : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Huawei EIP assignment failed." },
      { status: 502 },
    );
  }
}
