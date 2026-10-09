import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createFunctionGraphTrigger,
  invalidateCloudResult,
  listFunctionGraphTriggers,
} from "@/lib/huawei-cloud";

const triggerTypes = new Set([
  "TIMER",
  "APIG",
  "CTS",
  "DDS",
  "DMS",
  "DIS",
  "LTS",
  "OBS",
  "SMN",
  "KAFKA",
  "RABBITMQ",
  "DEDICATEDGATEWAY",
  "OPENSOURCEKAFKA",
  "APIC",
  "GAUSSMONGO",
  "EVENTGRID",
  "IOTDA",
]);
const triggerStatuses = new Set(["ACTIVE", "DISABLED"]);

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseEventData(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return {};
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);

  try {
    return NextResponse.json({
      triggers: await listFunctionGraphTriggers(
        session,
        id,
        searchParams.get("projectId") ?? undefined,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph trigger loading failed.",
      },
      { status: 502 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const triggerTypeCode = cleanString(body?.triggerTypeCode).toUpperCase();
  const triggerStatus =
    cleanString(body?.triggerStatus).toUpperCase() || "ACTIVE";
  const eventTypeCode = cleanString(body?.eventTypeCode);
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

  if (!triggerTypes.has(triggerTypeCode)) {
    return NextResponse.json(
      { error: "Choose a supported trigger type." },
      { status: 400 },
    );
  }

  if (!triggerStatuses.has(triggerStatus)) {
    return NextResponse.json(
      { error: "Choose a supported trigger status." },
      { status: 400 },
    );
  }

  try {
    const trigger = await createFunctionGraphTrigger(session, id, {
      eventData,
      eventTypeCode,
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
            : "Huawei FunctionGraph trigger creation failed.",
      },
      { status: 502 },
    );
  }
}
