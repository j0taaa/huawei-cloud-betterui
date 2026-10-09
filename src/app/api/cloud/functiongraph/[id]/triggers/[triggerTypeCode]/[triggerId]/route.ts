import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteFunctionGraphTrigger,
  invalidateCloudResult,
  updateFunctionGraphTrigger,
} from "@/lib/huawei-cloud";

const triggerStatuses = new Set(["ACTIVE", "DISABLED"]);

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseEventData(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Event data must contain valid JSON.");
  }
}

export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; triggerId: string; triggerTypeCode: string }>;
  },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id, triggerId, triggerTypeCode } = await params;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const triggerStatus = cleanString(body?.triggerStatus).toUpperCase();
  const projectId = cleanString(body?.projectId) || undefined;
  let eventData: unknown;

  try {
    eventData = parseEventData(body?.eventData);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid trigger event data.",
      },
      { status: 400 },
    );
  }

  if (triggerStatus && !triggerStatuses.has(triggerStatus)) {
    return NextResponse.json(
      { error: "Choose a supported trigger status." },
      { status: 400 },
    );
  }

  try {
    const trigger = await updateFunctionGraphTrigger(session, id, triggerId, {
      eventData,
      projectId,
      triggerStatus,
      triggerTypeCode,
    });

    await Promise.all([
      invalidateCloudResult(session, cloudCacheKeys.functionGraphCode(id)),
      invalidateCloudResult(session, cloudCacheKeys.functionGraphTriggers),
    ]);

    return NextResponse.json({ ok: true, trigger });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph trigger update failed.",
      },
      { status: 502 },
    );
  }
}

export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; triggerId: string; triggerTypeCode: string }>;
  },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id, triggerId, triggerTypeCode } = await params;
  const body = (await request.json().catch(() => null)) as {
    projectId?: unknown;
  } | null;
  const projectId = cleanString(body?.projectId) || undefined;

  try {
    await deleteFunctionGraphTrigger(
      session,
      id,
      triggerId,
      triggerTypeCode,
      projectId,
    );
    await Promise.all([
      invalidateCloudResult(session, cloudCacheKeys.functionGraphCode(id)),
      invalidateCloudResult(session, cloudCacheKeys.functionGraphTriggers),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph trigger deletion failed.",
      },
      { status: 502 },
    );
  }
}
