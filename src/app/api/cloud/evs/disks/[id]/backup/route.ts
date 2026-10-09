import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  createCbrCheckpoint,
  getEvsDisk,
  invalidateCloudResult,
  listCbrVaults,
} from "@/lib/huawei-cloud";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
    description?: unknown;
    name?: unknown;
    projectId?: unknown;
    vaultId?: unknown;
  } | null;
  const description = cleanString(body?.description);
  const name = cleanString(body?.name);
  const projectId = cleanString(body?.projectId);
  const vaultId = cleanString(body?.vaultId);

  if (!name || !/^[\p{L}\p{N}_-]{1,64}$/u.test(name)) {
    return NextResponse.json(
      { error: "Backup name must contain 1 to 64 letters, numbers, underscores, or hyphens." },
      { status: 400 },
    );
  }

  if (description.length > 255 || /[<>]/.test(description)) {
    return NextResponse.json(
      { error: "Description must be at most 255 characters and cannot contain angle brackets." },
      { status: 400 },
    );
  }

  if (!vaultId || !projectId) {
    return NextResponse.json({ error: "Project and CBR vault are required." }, { status: 400 });
  }

  try {
    const [disk, vaults] = await Promise.all([
      getEvsDisk(session, id),
      listCbrVaults(session),
    ]);

    if (!disk || disk.projectId !== projectId) {
      return NextResponse.json({ error: "EVS disk was not found in this project." }, { status: 404 });
    }

    const vault = vaults.find(
      (item) => item.id === vaultId && item.projectId === projectId,
    );

    if (!vault) {
      return NextResponse.json({ error: "CBR vault was not found in this project." }, { status: 404 });
    }

    const resource = vault.resources.find((item) => item.id === disk.id);

    if (!resource || resource.type !== "OS::Cinder::Volume") {
      return NextResponse.json(
        { error: "This EVS disk is not associated with the selected disk backup vault." },
        { status: 400 },
      );
    }

    if (!["available", "error"].includes(resource.protectStatus.toLowerCase())) {
      return NextResponse.json(
        { error: `The protected resource is currently ${resource.protectStatus}.` },
        { status: 409 },
      );
    }

    const result = await createCbrCheckpoint(session, {
      description,
      name,
      projectId,
      resourceId: disk.id,
      vaultId,
    });

    await Promise.all([
      invalidateCloudResult(session, "listCbrVaults"),
      invalidateCloudResult(session, `evs-disk-backups:${disk.id}`),
    ]);

    return NextResponse.json({
      checkpointId: result.checkpoint?.id ?? null,
      ok: true,
      status: result.checkpoint?.status ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "CBR backup creation failed." },
      { status: 502 },
    );
  }
}
