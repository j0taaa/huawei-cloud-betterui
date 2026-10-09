import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createSmnTopic,
  invalidateCloudResult,
  type CreateSmnTopicInput,
} from "@/lib/huawei-cloud";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    displayName?: unknown;
    name?: unknown;
    projectId?: unknown;
  } | null;
  const input: CreateSmnTopicInput = {
    displayName: cleanString(body?.displayName),
    name: cleanString(body?.name),
    projectId: cleanString(body?.projectId) || undefined,
  };

  if (!input.name) {
    return NextResponse.json({ error: "Topic name is required." }, { status: 400 });
  }

  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(input.name)) {
    return NextResponse.json(
      {
        error:
          "Topic name must be 1-255 characters and contain only letters, numbers, underscores, and hyphens.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await createSmnTopic(session, input);

    await invalidateCloudResult(session, "listSmnTopics");

    return NextResponse.json({
      ok: true,
      requestId: result.request_id ?? null,
      topicUrn: result.topic_urn ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei SMN topic creation failed.",
      },
      { status: 502 },
    );
  }
}
