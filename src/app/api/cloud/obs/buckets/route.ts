import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  deleteEmptyObsBucket,
  invalidateCloudResult,
} from "@/lib/huawei-cloud";

function readParam(url: URL, name: string) {
  return url.searchParams.get(name)?.trim() ?? "";
}

export async function DELETE(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const bucket = readParam(url, "bucket");

  if (!bucket) {
    return NextResponse.json({ error: "Bucket is required." }, { status: 400 });
  }

  try {
    await deleteEmptyObsBucket(session, bucket);
    await invalidateCloudResult(session, `obs-bucket:${bucket}:`);
    await invalidateCloudResult(session, `obs-bucket:${bucket}`);
    await invalidateCloudResult(session, "listObsBuckets");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "OBS bucket deletion failed.",
      },
      { status: 502 },
    );
  }
}
