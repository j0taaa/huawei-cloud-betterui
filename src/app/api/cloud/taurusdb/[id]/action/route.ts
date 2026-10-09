import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { invalidateCloudResult } from "@/lib/huawei/result";
import { NextResponse } from "next/server";
import { recordAcceptedOperation } from "@/lib/huawei/management/accepted-operation";
import { projectForId } from "@/lib/huawei/projects";

import { getCurrentSession } from "@/lib/auth-session";
import { runTaurusDbAction } from "@/lib/huawei-cloud";

const allowedActions = ["reboot"] as const;

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
      { error: "Unsupported TaurusDB action." },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const project = projectForId(session, typeof body?.projectId === "string" ? body.projectId : undefined);
    const result = await runTaurusDbAction(
      session,
      id,
      action as (typeof allowedActions)[number],
      typeof body?.projectId === "string" ? body.projectId : undefined,
    );

    const receipt = await recordAcceptedOperation(session, { service: "taurusdb", operation: "Reboot instance", projectId: project.projectId, resourceId: id, jobId: result.job_id }, () => Promise.all([
      invalidateCloudResult(session, cloudCacheKeys.listTaurusDbInstances),
      invalidateCloudResult(session, cloudCacheKeys.taurusDb(id)),
    ]));
    return NextResponse.json({ jobId: result.job_id ?? null, ok: true, ...receipt });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei TaurusDB action failed.",
      },
      { status: 502 },
    );
  }
}
