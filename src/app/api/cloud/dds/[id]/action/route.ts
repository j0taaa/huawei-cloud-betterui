import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { invalidateCloudResult } from "@/lib/huawei/result";
import { NextResponse } from "next/server";
import { recordAcceptedOperation } from "@/lib/huawei/management/accepted-operation";

import { getCurrentSession } from "@/lib/auth-session";
import { huaweiFetch, projectForId } from "@/lib/huawei-cloud/core";

const allowedActions = ["restart"] as const;

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
      { error: "Unsupported DDS action." },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const project = projectForId(
      session,
      typeof body?.projectId === "string" ? body.projectId : undefined,
    );
    const result = await huaweiFetch<{ job_id?: string }>(
      project,
      "dds",
      `/v3/${project.projectId}/instances/${id}/restart`,
      { method: "POST" },
    );

    const receipt = await recordAcceptedOperation(session, { service: "dds", operation: "Restart instance", projectId: project.projectId, resourceId: id, jobId: result.job_id }, () => Promise.all([
      invalidateCloudResult(session, cloudCacheKeys.listDdsInstances),
      invalidateCloudResult(session, cloudCacheKeys.dds(id)),
    ]));
    return NextResponse.json({ jobId: result.job_id ?? null, ok: true, ...receipt });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei DDS action failed.",
      },
      { status: 502 },
    );
  }
}
