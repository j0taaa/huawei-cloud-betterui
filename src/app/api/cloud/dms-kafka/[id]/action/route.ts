import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  getDmsKafkaInstance,
  invalidateCloudResult,
  runDmsKafkaAction,
  type DmsKafkaAction,
} from "@/lib/huawei-cloud";

const allowedActions = ["restart"] as const;

function canRestart(status: string) {
  return ["running", "faulty"].includes(status.toLowerCase());
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
      { error: "Unsupported DMS Kafka action." },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const instance = await getDmsKafkaInstance(session, id);

    if (!instance) {
      return NextResponse.json(
        { error: "DMS Kafka instance was not found in the signed-in projects." },
        { status: 404 },
      );
    }

    const requestedProjectId =
      typeof body?.projectId === "string" ? body.projectId : undefined;

    if (requestedProjectId && requestedProjectId !== instance.projectId) {
      return NextResponse.json(
        { error: "Project id does not match the target DMS Kafka instance." },
        { status: 400 },
      );
    }

    if (!canRestart(instance.status)) {
      return NextResponse.json(
        {
          error: `Restart is only available when the DMS Kafka status is Running or Faulty. Current status: ${instance.status}.`,
        },
        { status: 409 },
      );
    }

    const result = await runDmsKafkaAction(
      session,
      id,
      action as DmsKafkaAction,
      instance.projectId,
    );
    await Promise.all([
      invalidateCloudResult(session, "listDmsKafkaInstances"),
      invalidateCloudResult(session, `dms-kafka-instance:${id}`),
    ]);

    return NextResponse.json({
      ok: true,
      result: result.results?.[0]?.result ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei DMS Kafka action failed.",
      },
      { status: 502 },
    );
  }
}
