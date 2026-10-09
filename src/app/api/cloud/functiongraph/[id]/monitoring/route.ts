import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import { getFunctionGraphMonitoring } from "@/lib/huawei-cloud";

const timeframes = new Set(["1h", "6h", "24h", "7d", "30d"]);

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
  const timeframe = searchParams.get("timeframe") ?? "6h";

  if (!timeframes.has(timeframe)) {
    return NextResponse.json({ error: "Choose a supported timeframe." }, { status: 400 });
  }

  try {
    const monitoring = await getFunctionGraphMonitoring(session, id, timeframe);

    if (!monitoring) {
      return NextResponse.json(
        { error: "FunctionGraph function was not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ monitoring });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph monitoring loading failed.",
      },
      { status: 502 },
    );
  }
}
