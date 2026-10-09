import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteSfsAccessRule,
  getSfsShare,
  invalidateCloudResult,
  listSfsAccessRules,
} from "@/lib/huawei-cloud";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id, ruleId } = await params;
  const body = (await request.json().catch(() => null)) as {
    projectId?: unknown;
  } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : undefined;
  const share = await getSfsShare(session, id, projectId);

  if (!share) {
    return NextResponse.json(
      { error: "SFS file system was not found." },
      { status: 404 },
    );
  }

  const rules = await listSfsAccessRules(session, id, share.projectId);

  if (!rules.some((rule) => rule.id === ruleId)) {
    return NextResponse.json(
      { error: "SFS access rule was not found." },
      { status: 404 },
    );
  }

  try {
    await deleteSfsAccessRule(session, id, ruleId, share.projectId);

    await invalidateCloudResult(session, `sfs-access-rules:${id}:${share.projectId}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei SFS access rule deletion failed.",
      },
      { status: 502 },
    );
  }
}
