import { NextResponse } from "next/server";

import { getCurrentSession, type BetterUiSession } from "@/lib/auth-session";
import {
  createObsFolder,
  deleteObsObject,
  downloadObsObject,
  invalidateCloudResult,
  uploadObsObject,
} from "@/lib/huawei-cloud";

function readParam(url: URL, name: string) {
  return url.searchParams.get(name) ?? "";
}

function objectPrefixCacheKeys(bucket: string, key: string) {
  const parts = key.split("/");
  const prefixes = [""];

  for (let index = 0; index < parts.length - 1; index += 1) {
    prefixes.push(`${parts.slice(0, index + 1).join("/")}/`);
  }

  if (key.endsWith("/") && parts.length) {
    prefixes.push(`${parts.join("/")}/`);
  }

  return Array.from(new Set(prefixes)).map(
    (prefix) => `obs-bucket:${bucket}:${prefix}`,
  );
}

async function invalidateObsObjectViews(
  bucket: string,
  key: string,
  session: BetterUiSession,
) {
  await Promise.all([
    ...objectPrefixCacheKeys(bucket, key).map((cacheKey) =>
      invalidateCloudResult(session, cacheKey),
    ),
    invalidateCloudResult(session, `obs-bucket:${bucket}`),
    invalidateCloudResult(session, "listObsBuckets"),
    invalidateCloudResult(session, `obs-object:${bucket}:${key}`),
  ]);
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
    return NextResponse.json(
      { error: "Bucket and object key are required." },
      { status: 400 },
    );
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
        error:
          error instanceof Error
            ? error.message
            : "OBS object download failed.",
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
  const createFolder = formData?.get("createFolder") === "true";

  if (typeof bucket !== "string" || !bucket.trim()) {
    return NextResponse.json({ error: "Bucket is required." }, { status: 400 });
  }

  if (typeof key !== "string" || !key.trim()) {
    return NextResponse.json(
      { error: "Object key is required." },
      { status: 400 },
    );
  }

  if (!createFolder && !(file instanceof File)) {
    return NextResponse.json(
      { error: "Choose a file to upload." },
      { status: 400 },
    );
  }

  try {
    if (createFolder) {
      await createObsFolder(session, bucket, key);
    } else if (file instanceof File) {
      await uploadObsObject(session, bucket, key, file);
    }

    await invalidateObsObjectViews(bucket, key, session);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "OBS object upload failed.",
      },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const bucket = readParam(url, "bucket");
  const key = readParam(url, "key");

  if (!bucket || !key) {
    return NextResponse.json(
      { error: "Bucket and object key are required." },
      { status: 400 },
    );
  }

  try {
    await deleteObsObject(session, bucket, key);
    await invalidateObsObjectViews(bucket, key, session);
    await invalidateCloudResult(session, `obs-object:${bucket}:${key}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "OBS object deletion failed.",
      },
      { status: 502 },
    );
  }
}
