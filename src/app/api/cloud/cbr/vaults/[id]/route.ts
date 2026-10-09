import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import { getCbrVault, invalidateCloudResult, updateCbrVault } from "@/lib/huawei-cloud";

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number = Number(value);

  return Number.isInteger(number) ? number : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    autoExpand?: unknown;
    name?: unknown;
    projectId?: unknown;
    sizeGb?: unknown;
    smnNotify?: unknown;
    threshold?: unknown;
  } | null;

  if (!body || typeof body.projectId !== "string") {
    return NextResponse.json(
      { error: "Project id is required for CBR vault updates." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const vault = await getCbrVault(session, id, body.projectId);

  if (!vault) {
    return NextResponse.json(
      { error: "CBR vault was not found in the signed-in projects." },
      { status: 404 },
    );
  }

  if (vault.status.toLowerCase() !== "available") {
    return NextResponse.json(
      {
        error: `Vault settings can be changed only when the vault is available. Current status: ${vault.status}.`,
      },
      { status: 409 },
    );
  }

  const sizeGb = optionalInteger(body.sizeGb);
  const threshold = optionalInteger(body.threshold);

  if (sizeGb === null || (sizeGb !== undefined && sizeGb < 10)) {
    return NextResponse.json(
      { error: "Vault size must be an integer of at least 10 GB." },
      { status: 400 },
    );
  }

  if (sizeGb !== undefined && sizeGb < vault.allocatedGb) {
    return NextResponse.json(
      {
        error: `Vault size cannot be lower than allocated capacity (${vault.allocatedGb} GB).`,
      },
      { status: 400 },
    );
  }

  if (threshold === null || (threshold !== undefined && (threshold < 1 || threshold > 100))) {
    return NextResponse.json(
      { error: "Notification threshold must be an integer from 1 to 100." },
      { status: 400 },
    );
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : undefined;

  if (name && !/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    return NextResponse.json(
      {
        error:
          "Vault name can contain up to 64 letters, digits, underscores, or hyphens.",
      },
      { status: 400 },
    );
  }

  try {
    const updated = await updateCbrVault(
      session,
      id,
      {
        autoExpand: optionalBoolean(body.autoExpand),
        name,
        sizeGb,
        smnNotify: optionalBoolean(body.smnNotify),
        threshold: threshold ?? undefined,
      },
      vault.projectId,
    );

    await invalidateCloudResult(session, "listCbrVaults");

    return NextResponse.json({ ok: true, vault: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Huawei CBR vault update failed.",
      },
      { status: 502 },
    );
  }
}
