import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteFunctionGraphFunction,
  getFunctionGraphFunction,
  invalidateCloudResult,
} from "@/lib/huawei-cloud";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    confirmName?: unknown;
    projectId?: unknown;
  } | null;
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    return NextResponse.json(
      { error: "FunctionGraph function was not found." },
      { status: 404 },
    );
  }

  const projectId =
    typeof body?.projectId === "string" ? body.projectId : undefined;

  if (projectId && projectId !== fn.projectId) {
    return NextResponse.json(
      { error: "Project id does not match the target FunctionGraph function." },
      { status: 400 },
    );
  }

  if (
    typeof body?.confirmName !== "string" ||
    body.confirmName.trim() !== fn.name
  ) {
    return NextResponse.json(
      { error: "Type the function name exactly to confirm deletion." },
      { status: 400 },
    );
  }

  try {
    await deleteFunctionGraphFunction(session, id, fn.projectId);
    await Promise.all([
      invalidateCloudResult(session, "listFunctionGraphFunctions"),
      invalidateCloudResult(session, cloudCacheKeys.functionGraph(id)),
      invalidateCloudResult(session, cloudCacheKeys.functionGraphCode(id)),
      invalidateCloudResult(session, cloudCacheKeys.functionGraphTriggers),
    ]);

    return NextResponse.json({
      id: fn.id,
      name: fn.name,
      ok: true,
      urn: fn.urn,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei FunctionGraph deletion failed.",
      },
      { status: 502 },
    );
  }
}
