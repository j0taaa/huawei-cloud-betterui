import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import { getFunctionGraphLogs } from "@/lib/huawei-cloud";

const timeframes: Record<string, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

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
  const timeframe = searchParams.get("timeframe") ?? "1h";
  const projectId = searchParams.get("projectId") ?? undefined;
  const keywords = searchParams.get("keywords") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? 50);
  const duration = timeframes[timeframe];

  if (!duration) {
    return NextResponse.json({ error: "Choose a supported timeframe." }, { status: 400 });
  }

  try {
    const now = Date.now();
    const logs = await getFunctionGraphLogs(session, id, {
      endTime: now,
      keywords,
      limit: Number.isFinite(limit) ? limit : 50,
      projectId,
      startTime: now - duration,
    });

    if (!logs) {
      return NextResponse.json(
        { error: "FunctionGraph function was not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ logs });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph logs loading failed.",
      },
      { status: 502 },
    );
  }
}
