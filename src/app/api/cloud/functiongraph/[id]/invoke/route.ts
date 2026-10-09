import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import { invokeFunctionGraphFunction } from "@/lib/huawei-cloud";

function parseEvent(value: unknown) {
  if (typeof value !== "string") {
    return value ?? {};
  }

  if (!value.trim()) {
    return {};
  }

  return JSON.parse(value) as unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    event?: unknown;
    includeLogs?: unknown;
    projectId?: unknown;
  } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : undefined;

  try {
    const event = parseEvent(body?.event);

    if (JSON.stringify(event).length > 64_000) {
      return NextResponse.json(
        { error: "Invocation event must be 64 KB or smaller." },
        { status: 400 },
      );
    }

    const { id } = await params;
    const result = await invokeFunctionGraphFunction(session, id, {
      event,
      logType: body?.includeLogs === false ? undefined : "tail",
      projectId,
    });
    const decodedLog = result.functionLog
      ? Buffer.from(result.functionLog, "base64").toString("utf8")
      : "";

    return NextResponse.json({
      body: result.body,
      log: decodedLog,
      ok: true,
      requestId: result.requestId,
      status: result.status,
      summary: result.summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof SyntaxError
            ? "Invocation event must be valid JSON."
            : error instanceof Error
              ? error.message
              : "Huawei FunctionGraph invocation failed.",
      },
      { status: error instanceof SyntaxError ? 400 : 502 },
    );
  }
}
