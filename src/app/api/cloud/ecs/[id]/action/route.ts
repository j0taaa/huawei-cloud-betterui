import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { NextResponse } from "next/server";
import { recordAcceptedOperation } from "@/lib/huawei/management/accepted-operation";

import { getCurrentSession } from "@/lib/auth-session";
import { getEcsInstance, runEcsAction, invalidateCloudResult } from "@/lib/huawei-cloud";

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
    const instance = await getEcsInstance(session, id);

    if (!instance) {
      return NextResponse.json(
        { error: "ECS instance was not found in the signed-in projects." },
        { status: 404 },
      );
    }

    const requestedProjectId =
      typeof body?.projectId === "string" ? body.projectId : undefined;

    if (requestedProjectId && requestedProjectId !== instance.projectId) {
      return NextResponse.json(
        { error: "Project id does not match the target ECS instance." },
        { status: 400 },
      );
    }

    const status = instance.status.toUpperCase();

    if (action === "start" && status !== "SHUTOFF") {
      return NextResponse.json(
        { error: `Start is only available when the ECS status is SHUTOFF. Current status: ${instance.status}.` },
        { status: 409 },
      );
    }

    if ((action === "stop" || action === "restart") && status !== "ACTIVE") {
      return NextResponse.json(
        { error: `${action === "stop" ? "Stop" : "Restart"} is only available when the ECS status is ACTIVE. Current status: ${instance.status}.` },
        { status: 409 },
      );
    }

    const result = await runEcsAction(
      session,
      id,
      action as (typeof allowedActions)[number],
      instance.projectId,
    );

    const receipt = await recordAcceptedOperation(session, { service: "ecs", operation: action === "start" ? "Start server" : action === "stop" ? "Stop server" : "Soft reboot", projectId: instance.projectId, resourceId: id, resourceName: instance.name, jobId: result.job_id }, () => Promise.all([
      invalidateCloudResult(session, cloudCacheKeys.listEcsInstances),
      invalidateCloudResult(session, cloudCacheKeys.ecs(id)),
      invalidateCloudResult(session, cloudCacheKeys.ecsMonitoring(id)),
      invalidateCloudResult(session, cloudCacheKeys.summary),
    ]));
    return NextResponse.json({ jobId: result.job_id ?? null, ok: true, ...receipt });
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
