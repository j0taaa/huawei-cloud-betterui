import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteSmnTopic,
  invalidateCloudResult,
  listSmnTopics,
} from "@/lib/huawei-cloud";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ topicUrn: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { topicUrn } = await params;
  const decodedTopicUrn = decodeURIComponent(topicUrn);
  const body = (await request.json().catch(() => null)) as {
    confirmName?: unknown;
    projectId?: unknown;
  } | null;
  const topic = (await listSmnTopics(session)).find(
    (item) => item.topicUrn === decodedTopicUrn,
  );

  if (!topic) {
    return NextResponse.json({ error: "SMN topic was not found." }, { status: 404 });
  }

  if (typeof body?.confirmName !== "string" || body.confirmName.trim() !== topic.name) {
    return NextResponse.json(
      { error: "Type the topic name exactly to confirm deletion." },
      { status: 400 },
    );
  }

  try {
    const result = await deleteSmnTopic(
      session,
      decodedTopicUrn,
      typeof body.projectId === "string" ? body.projectId : topic.projectId,
    );

    await invalidateCloudResult(session, "listSmnTopics");

    return NextResponse.json({
      ok: true,
      requestId: result.request_id ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei SMN topic deletion failed.",
      },
      { status: 502 },
    );
  }
}
