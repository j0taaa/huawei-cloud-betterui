import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  getGeminiDbInstance,
  invalidateCloudResult,
  runGeminiDbAction,
} from "@/lib/huawei-cloud";

const allowedActions = ["restart"] as const;

function canRestart(status: string) {
  return status.toLowerCase() === "normal";
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
    action?: unknown;
    projectId?: unknown;
  } | null;
  const action = body?.action;

  if (!allowedActions.includes(action as (typeof allowedActions)[number])) {
    return NextResponse.json(
      { error: "Unsupported GeminiDB action." },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const instance = await getGeminiDbInstance(session, id);

    if (!instance) {
      return NextResponse.json(
        { error: "GeminiDB instance was not found in the signed-in projects." },
        { status: 404 },
      );
    }

    const requestedProjectId =
      typeof body?.projectId === "string" ? body.projectId : undefined;

    if (requestedProjectId && requestedProjectId !== instance.projectId) {
      return NextResponse.json(
        { error: "Project id does not match the target GeminiDB instance." },
        { status: 400 },
      );
    }

    if (!canRestart(instance.status)) {
      return NextResponse.json(
        {
          error: `Restart is only available when the GeminiDB status is normal. Current status: ${instance.status}.`,
        },
        { status: 409 },
      );
    }

    const result = await runGeminiDbAction(
      session,
      id,
      action as (typeof allowedActions)[number],
      instance.projectId,
    );
    await Promise.all([
      invalidateCloudResult(session, "listGeminiDbInstances"),
      invalidateCloudResult(session, `geminidb-instance:${id}`),
    ]);

    return NextResponse.json({ jobId: result.job_id ?? null, ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei GeminiDB action failed.",
      },
      { status: 502 },
    );
  }
}
