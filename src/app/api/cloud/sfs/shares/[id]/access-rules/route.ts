import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createSfsAccessRule,
  getSfsShare,
  invalidateCloudResult,
  listSfsAccessRules,
} from "@/lib/huawei-cloud";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  const share = await getSfsShare(session, id, projectId);

  if (!share) {
    return NextResponse.json(
      { error: "SFS file system was not found." },
      { status: 404 },
    );
  }

  try {
    const rules = await listSfsAccessRules(session, id, share.projectId);

    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei SFS access rule query failed.",
      },
      { status: 502 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    accessLevel?: unknown;
    accessTo?: unknown;
    projectId?: unknown;
  } | null;
  const projectId = cleanString(body?.projectId) || undefined;
  const share = await getSfsShare(session, id, projectId);
  const accessLevel = cleanString(body?.accessLevel);
  const accessTo = cleanString(body?.accessTo);

  if (!share) {
    return NextResponse.json(
      { error: "SFS file system was not found." },
      { status: 404 },
    );
  }

  if (!["ro", "rw"].includes(accessLevel)) {
    return NextResponse.json(
      { error: "Access level must be ro or rw." },
      { status: 400 },
    );
  }

  if (!accessTo) {
    return NextResponse.json(
      { error: "Access target is required." },
      { status: 400 },
    );
  }

  if (!/^[A-Za-z0-9-]+(?:#[0-9./]+#[01]#[A-Za-z_,]+)?$/.test(accessTo)) {
    return NextResponse.json(
      {
        error:
          "Enter a VPC ID, or a VPC/IP ACL expression such as vpc-id#192.168.1.0/24#1#all_squash,root_squash.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await createSfsAccessRule(session, {
      accessLevel: accessLevel as "ro" | "rw",
      accessTo,
      projectId: share.projectId,
      shareId: id,
    });

    await invalidateCloudResult(session, `sfs-access-rules:${id}:${share.projectId}`);

    return NextResponse.json({ access: result.access ?? null, ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Huawei SFS access rule creation failed.",
      },
      { status: 502 },
    );
  }
}
