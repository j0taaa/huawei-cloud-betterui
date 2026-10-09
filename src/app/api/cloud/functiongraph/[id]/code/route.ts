import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  getFunctionGraphFunctionCode,
  invalidateCloudResult,
  updateFunctionGraphFunctionCode,
} from "@/lib/huawei-cloud";

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
  const projectId = searchParams.get("projectId") ?? undefined;

  try {
    return NextResponse.json(
      await getFunctionGraphFunctionCode(session, id, projectId),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph code loading failed.",
      },
      { status: 502 },
    );
  }
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    codeFilename?: unknown;
    codePayload?: unknown;
    codeType?: unknown;
    projectId?: unknown;
  } | null;
  const codePayload = cleanString(body?.codePayload);
  const codeType = cleanString(body?.codeType);
  const projectId = cleanString(body?.projectId) || undefined;

  if (!codePayload) {
    return NextResponse.json(
      { error: "Function code payload is required." },
      { status: 400 },
    );
  }

  if (codePayload.length > 8_000_000) {
    return NextResponse.json(
      { error: "Function code payload must be 8 MB or smaller." },
      { status: 400 },
    );
  }

  if (codeType && codeType !== "inline" && codeType !== "zip") {
    return NextResponse.json(
      { error: "Function code type must be inline or zip." },
      { status: 400 },
    );
  }

  try {
    const code = await updateFunctionGraphFunctionCode(session, id, {
      codeFilename: cleanString(body?.codeFilename) || undefined,
      codePayload,
      codeType: codeType === "inline" || codeType === "zip" ? codeType : "zip",
      projectId,
    });

    await Promise.all([
      invalidateCloudResult(session, cloudCacheKeys.functionGraphCode(id)),
      invalidateCloudResult(session, "listFunctionGraphFunctions"),
    ]);

    return NextResponse.json({ code, ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph code update failed.",
      },
      { status: 502 },
    );
  }
}
