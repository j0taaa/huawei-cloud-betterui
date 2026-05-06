import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import { runEcsAction } from "@/lib/huawei-cloud";

const allowedActions = ["restart", "start", "stop"] as const;

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
      { error: "Unsupported ECS action." },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const result = await runEcsAction(
      session,
      id,
      action as (typeof allowedActions)[number],
      typeof body?.projectId === "string" ? body.projectId : undefined,
    );

    return NextResponse.json({ jobId: result.job_id ?? null, ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei ECS action failed.",
      },
      { status: 502 },
    );
  }
}
