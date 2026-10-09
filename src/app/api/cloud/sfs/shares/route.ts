import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createSfsShare,
  invalidateCloudResult,
  type CreateSfsShareInput,
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
    availabilityZone?: unknown;
    description?: unknown;
    enterpriseProjectId?: unknown;
    isPublic?: unknown;
    name?: unknown;
    projectId?: unknown;
    shareType?: unknown;
    sizeGb?: unknown;
  } | null;
  const sizeGb = Number(body?.sizeGb ?? 1);
  const input: CreateSfsShareInput = {
    availabilityZone: cleanString(body?.availabilityZone) || undefined,
    description: cleanString(body?.description) || undefined,
    enterpriseProjectId: cleanString(body?.enterpriseProjectId) || undefined,
    isPublic: body?.isPublic === true,
    name: cleanString(body?.name),
    projectId: cleanString(body?.projectId) || undefined,
    shareType: cleanString(body?.shareType) || undefined,
    sizeGb,
  };

  if (!input.name) {
    return NextResponse.json(
      { error: "File system name is required." },
      { status: 400 },
    );
  }

  if (!/^[A-Za-z0-9_-]{1,255}$/.test(input.name)) {
    return NextResponse.json(
      {
        error:
          "Name must be 1-255 characters and contain only letters, digits, hyphens, and underscores.",
      },
      { status: 400 },
    );
  }

  if (
    input.description &&
    !/^[A-Za-z0-9_-]{1,255}$/.test(input.description)
  ) {
    return NextResponse.json(
      {
        error:
          "Description must be 255 characters or fewer and contain only letters, digits, hyphens, and underscores.",
      },
      { status: 400 },
    );
  }

  if (!Number.isInteger(sizeGb) || sizeGb < 1) {
    return NextResponse.json(
      { error: "Size must be a whole number of GiB greater than zero." },
      { status: 400 },
    );
  }

  try {
    const result = await createSfsShare(session, input);

    await invalidateCloudResult(session, "listSfsShares");

    return NextResponse.json({
      id:
        typeof result.share === "object" &&
        result.share &&
        "id" in result.share &&
        typeof result.share.id === "string"
          ? result.share.id
          : null,
      ok: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei SFS file system creation failed.",
      },
      { status: 502 },
    );
  }
}
