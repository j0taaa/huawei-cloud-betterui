import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  addFunctionGraphFunctionDependency,
  invalidateCloudResult,
} from "@/lib/huawei-cloud";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
  const body = (await request.json().catch(() => null)) as {
    dependencyName?: unknown;
    manifestType?: unknown;
    projectId?: unknown;
    version?: unknown;
  } | null;
  const dependencyName = cleanString(body?.dependencyName);
  const manifestType = cleanString(body?.manifestType);
  const projectId = cleanString(body?.projectId) || undefined;

  if (!dependencyName) {
    return NextResponse.json(
      { error: "Dependency name is required." },
      { status: 400 },
    );
  }

  if (
    manifestType &&
    manifestType !== "package.json" &&
    manifestType !== "requirements.txt"
  ) {
    return NextResponse.json(
      {
        error: "Dependency manifest must be requirements.txt or package.json.",
      },
      { status: 400 },
    );
  }

  try {
    const code = await addFunctionGraphFunctionDependency(session, id, {
      dependencyName,
      manifestType:
        manifestType === "package.json" || manifestType === "requirements.txt"
          ? manifestType
          : undefined,
      projectId,
      version: cleanString(body?.version),
    });

    await Promise.all([
      invalidateCloudResult(session, "functiongraph-code-dependencies"),
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
            : "Huawei FunctionGraph dependency update failed.",
      },
      { status: 502 },
    );
  }
}
