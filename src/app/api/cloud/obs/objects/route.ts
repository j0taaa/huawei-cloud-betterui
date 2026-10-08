import { cloudCacheKeys } from "@/lib/huawei/cache-keys";

import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  downloadObsObject,
  invalidateCloudResult,
  uploadObsObject,
} from "@/lib/huawei-cloud";

function readParam(url: URL, name: string) {
  return url.searchParams.get(name) ?? "";
}

export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const bucket = readParam(url, "bucket");
  const key = readParam(url, "key");

  if (!bucket || !key) {
    return NextResponse.json({ error: "Bucket and object key are required." }, { status: 400 });
  }

  try {
    const object = await downloadObsObject(session, bucket, key);
    const headers = new Headers({
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(object.filename)}`,
      "Content-Type": object.contentType,
    });

    if (object.contentLength) {
      headers.set("Content-Length", object.contentLength);
    }

    return new Response(object.body, { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "OBS object download failed.",
      },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const bucket = formData?.get("bucket");
  const key = formData?.get("key");
  const file = formData?.get("file");

  if (typeof bucket !== "string" || !bucket.trim()) {
    return NextResponse.json({ error: "Bucket is required." }, { status: 400 });
  }

  if (typeof key !== "string" || !key) {
    return NextResponse.json({ error: "Object key is required." }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }

  try {
    await uploadObsObject(session, bucket, key, file);
    await invalidateCloudResult(session, cloudCacheKeys.obsBucket(bucket));
    await invalidateCloudResult(session, cloudCacheKeys.listObsBuckets);

    await invalidateCloudResult(session, cloudCacheKeys.obsObject(bucket, key));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "OBS object upload failed.",
      },
      { status: 502 },
    );
  }
}
