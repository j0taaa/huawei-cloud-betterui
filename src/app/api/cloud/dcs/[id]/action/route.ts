import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  getDcsRedisInstance,
  invalidateCloudResult,
  runDcsRedisAction,
  type DcsAction,
} from "@/lib/huawei-cloud";

const allowedActions = ["flush", "restart", "soft_restart"] as const;

function canRunAction(status: string) {
  return ["running", "normal", "available"].includes(status.toLowerCase());
}

function canFlush(engineVersion: string) {
  const major = Number(engineVersion.match(/\d+/)?.[0] ?? 0);

  return major >= 4;
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
      { error: "Unsupported DCS action." },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const instance = await getDcsRedisInstance(session, id);

    if (!instance) {
      return NextResponse.json(
        { error: "DCS instance was not found in the signed-in projects." },
        { status: 404 },
      );
    }

    const requestedProjectId =
      typeof body?.projectId === "string" ? body.projectId : undefined;

    if (requestedProjectId && requestedProjectId !== instance.projectId) {
      return NextResponse.json(
        { error: "Project id does not match the target DCS instance." },
        { status: 400 },
      );
    }

    if (!canRunAction(instance.status)) {
      return NextResponse.json(
        {
          error: `Action is only available when the DCS status is RUNNING. Current status: ${instance.status}.`,
        },
        { status: 409 },
      );
    }

    if (action === "flush" && !canFlush(instance.engineVersion)) {
      return NextResponse.json(
        {
          error: `Flush is only available for DCS Redis 4.0 and later. Current version: ${instance.engineVersion}.`,
        },
        { status: 409 },
      );
    }

    const result = await runDcsRedisAction(
      session,
      id,
      action as DcsAction,
      instance.projectId,
    );
    await Promise.all([
      invalidateCloudResult(session, "listDcsRedisInstances"),
      invalidateCloudResult(session, `dcs-instance:${id}`),
    ]);

    return NextResponse.json({
      ok: true,
      result: result.results?.[0]?.result ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei DCS action failed.",
      },
      { status: 502 },
    );
  }
}
