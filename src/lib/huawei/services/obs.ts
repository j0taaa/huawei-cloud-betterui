import "server-only";

import type { BetterUiSession } from "@/lib/auth-session";
import {
  asRecord,
  firstString,
  formatBytes,
  xmlBlocks,
  xmlTag,
} from "@/lib/huawei/parsers";
import { createHmac } from "node:crypto";

export type ObsBucket = {
  createdAt: string;
  location: string;
  name: string;
  objectCount: number | null;
  size: string;
  storageClass: string;
  type: string;
};

export type ObsObject = {
  etag: string;
  key: string;
  lastModified: string;
  owner: string;
  size: string;
  sizeBytes: number;
  storageClass: string;
};

export type ObsBucketDetail = ObsBucket & {
  commonPrefixes: string[];
  isTruncated: boolean;
  objects: ObsObject[];
};

export type ObsObjectDetail = ObsObject & {
  bucket: string;
  contentLength: string;
  contentType: string;
  previewKind: "audio" | "image" | "pdf" | "text" | "unsupported" | "video";
  previewText: string;
};

export type ObsCredential = {
  access: string;
  secret: string;
  securityToken: string;
};

export function obsHost(region: string, bucket?: string) {
  const endpoint = (
    process.env.HUAWEI_OBS_ENDPOINT || `obs.${region}.myhuaweicloud.com`
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  return bucket ? `${bucket}.${endpoint}` : endpoint;
}

export async function createObsCredential(
  session: BetterUiSession,
): Promise<ObsCredential> {
  const response = await fetch(
    `${session.iamEndpoint}/v3.0/OS-CREDENTIAL/securitytokens`,
    {
      body: JSON.stringify({
        auth: {
          identity: {
            methods: ["token"],
            token: {
              duration_seconds: 3600,
            },
          },
        },
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json;charset=utf8",
        "X-Auth-Token": session.token,
      },
      method: "POST",
    },
  );
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const credential = asRecord(asRecord(body).credential);
  const access = firstString(
    [credential.access, credential.access_key, credential.ak],
    "",
  );
  const secret = firstString(
    [credential.secret, credential.secret_key, credential.sk],
    "",
  );
  const securityToken = firstString(
    [credential.securitytoken, credential.security_token, credential.token],
    "",
  );

  if (!access || !secret || !securityToken) {
    throw new Error("IAM did not return temporary OBS credentials.");
  }

  return { access, secret, securityToken };
}

export function obsAuthorization({
  bucket,
  contentType = "",
  credential,
  date,
  method,
  objectKey,
}: {
  bucket?: string;
  contentType?: string;
  credential: ObsCredential;
  date: string;
  method: "GET" | "PUT";
  objectKey?: string;
}) {
  const canonicalHeaders = `x-obs-security-token:${credential.securityToken}\n`;
  const canonicalResource = bucket
    ? `/${bucket}/${objectKey ? encodeObsObjectKey(objectKey) : ""}`
    : "/";
  const stringToSign = [
    method,
    "",
    contentType,
    date,
    `${canonicalHeaders}${canonicalResource}`,
  ].join("\n");
  const signature = createHmac("sha1", credential.secret)
    .update(stringToSign)
    .digest("base64");

  return `OBS ${credential.access}:${signature}`;
}

export function encodeObsObjectKey(key: string) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export async function obsFetchXml(
  credential: ObsCredential,
  region: string,
  pathAndQuery: string,
  bucket?: string,
) {
  const date = new Date().toUTCString();
  const host = obsHost(region, bucket);
  const response = await fetch(`https://${host}${pathAndQuery}`, {
    cache: "no-store",
    headers: {
      Authorization: obsAuthorization({
        bucket,
        credential,
        date,
        method: "GET",
      }),
      Date: date,
      "x-obs-security-token": credential.securityToken,
    },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `${response.status} ${xmlTag(body, "Message", response.statusText)}`,
    );
  }

  return body;
}

export async function findObsBucketRegion(
  session: BetterUiSession,
  credential: ObsCredential,
  bucket: string,
) {
  const buckets = parseObsBuckets(
    await obsFetchXml(credential, session.region, "/"),
  );
  const match = buckets.find((item) => item.name === bucket);
  return match?.location && match.location !== "-"
    ? match.location
    : session.region;
}

export async function obsObjectRequest({
  body,
  bucket,
  contentType = "",
  credential,
  key,
  method,
  region,
  requestHeaders,
}: {
  body?: BodyInit;
  bucket: string;
  contentType?: string;
  credential: ObsCredential;
  key: string;
  method: "GET" | "PUT";
  region: string;
  requestHeaders?: HeadersInit;
}) {
  const date = new Date().toUTCString();
  const headers: HeadersInit = {
    Authorization: obsAuthorization({
      bucket,
      contentType,
      credential,
      date,
      method,
      objectKey: key,
    }),
    Date: date,
    "x-obs-security-token": credential.securityToken,
  };

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  for (const [name, value] of Object.entries(requestHeaders ?? {})) {
    headers[name] = value;
  }

  return fetch(
    `https://${obsHost(region, bucket)}/${encodeObsObjectKey(key)}`,
    {
      body,
      cache: "no-store",
      headers,
      method,
    },
  );
}

export function parseObsBuckets(xml: string): ObsBucket[] {
  return xmlBlocks(xml, "Bucket")
    .map((bucket) => {
      const location = xmlTag(bucket, "Location", "-");
      return {
        createdAt: xmlTag(bucket, "CreationDate", "-"),
        location,
        name: xmlTag(bucket, "Name"),
        objectCount: null,
        size: "-",
        storageClass: xmlTag(bucket, "StorageClass", "-"),
        type: xmlTag(bucket, "BucketType", "-"),
      };
    })
    .filter((bucket) => bucket.name);
}

export function parseObsObjects(
  xml: string,
): Pick<ObsBucketDetail, "commonPrefixes" | "isTruncated" | "objects"> {
  const decodeKey = (value: string) =>
    xmlTag(xml, "EncodingType") === "url" ? decodeURIComponent(value) : value;
  const objects = xmlBlocks(xml, "Contents")
    .map((object): ObsObject => {
      const sizeBytes = Number(xmlTag(object, "Size", "0"));
      return {
        etag: xmlTag(object, "ETag", "-").replace(/^"|"$/g, ""),
        key: decodeKey(xmlTag(object, "Key")),
        lastModified: xmlTag(object, "LastModified", "-"),
        owner: xmlTag(
          xmlTag(object, "Owner"),
          "DisplayName",
          xmlTag(xmlTag(object, "Owner"), "ID", "-"),
        ),
        size: formatBytes(sizeBytes),
        sizeBytes,
        storageClass: xmlTag(object, "StorageClass", "-"),
      };
    })
    .filter((object) => object.key);

  return {
    commonPrefixes: xmlBlocks(xml, "CommonPrefixes")
      .map((prefix) => decodeKey(xmlTag(prefix, "Prefix")))
      .filter(Boolean),
    isTruncated: xmlTag(xml, "IsTruncated", "false") === "true",
    objects,
  };
}

export function isTextPreviewType(contentType: string, key: string) {
  const type = contentType.toLowerCase();
  const lowerKey = key.toLowerCase();
  const filename = lowerKey.split("/").filter(Boolean).at(-1) ?? lowerKey;

  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("xml") ||
    type.includes("yaml") ||
    type.includes("javascript") ||
    [
      ".bash",
      ".c",
      ".cjs",
      ".conf",
      ".cpp",
      ".cs",
      ".css",
      ".csv",
      ".env",
      ".go",
      ".h",
      ".hpp",
      ".htm",
      ".html",
      ".ini",
      ".java",
      ".js",
      ".json",
      ".jsx",
      ".kt",
      ".log",
      ".lua",
      ".mjs",
      ".md",
      ".php",
      ".pl",
      ".properties",
      ".ps1",
      ".py",
      ".rb",
      ".rs",
      ".sh",
      ".sql",
      ".svelte",
      ".swift",
      ".toml",
      ".ts",
      ".tsx",
      ".txt",
      ".vue",
      ".xml",
      ".yaml",
      ".yml",
      ".zsh",
    ].some((extension) => lowerKey.endsWith(extension)) ||
    [
      ".dockerignore",
      ".gitignore",
      ".npmrc",
      ".nvmrc",
      "dockerfile",
      "makefile",
    ].includes(filename)
  );
}

export function isImagePreviewType(contentType: string, key: string) {
  const type = contentType.toLowerCase();
  const lowerKey = key.toLowerCase();

  return (
    type.startsWith("image/") ||
    [".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"].some(
      (extension) => lowerKey.endsWith(extension),
    )
  );
}

export function isPdfPreviewType(contentType: string, key: string) {
  return (
    contentType.toLowerCase().includes("pdf") ||
    key.toLowerCase().endsWith(".pdf")
  );
}

export function isAudioPreviewType(contentType: string, key: string) {
  const type = contentType.toLowerCase();
  const lowerKey = key.toLowerCase();

  return (
    type.startsWith("audio/") ||
    [
      ".aac",
      ".flac",
      ".m4a",
      ".mp3",
      ".oga",
      ".ogg",
      ".opus",
      ".wav",
      ".weba",
    ].some((extension) => lowerKey.endsWith(extension))
  );
}

export function isVideoPreviewType(contentType: string, key: string) {
  const type = contentType.toLowerCase();
  const lowerKey = key.toLowerCase();

  return (
    type.startsWith("video/") ||
    [".m4v", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm"].some(
      (extension) => lowerKey.endsWith(extension),
    )
  );
}

export function getObsPreviewKind(
  contentType: string,
  key: string,
): ObsObjectDetail["previewKind"] {
  if (isImagePreviewType(contentType, key)) {
    return "image";
  }

  if (isPdfPreviewType(contentType, key)) {
    return "pdf";
  }

  if (isAudioPreviewType(contentType, key)) {
    return "audio";
  }

  if (isVideoPreviewType(contentType, key)) {
    return "video";
  }

  if (isTextPreviewType(contentType, key)) {
    return "text";
  }

  return "unsupported";
}

export async function listObsBuckets(session: BetterUiSession) {
  const credential = await createObsCredential(session);
  const xml = await obsFetchXml(credential, session.region, "/");
  return parseObsBuckets(xml);
}

export async function getObsBucket(session: BetterUiSession, name: string) {
  const bucketName = name;
  const credential = await createObsCredential(session);
  const buckets = parseObsBuckets(
    await obsFetchXml(credential, session.region, "/"),
  );
  const bucket = buckets.find((item) => item.name === bucketName);

  if (!bucket) {
    return null;
  }

  const region =
    bucket.location && bucket.location !== "-"
      ? bucket.location
      : session.region;
  const objectData: Pick<
    ObsBucketDetail,
    "objects" | "commonPrefixes" | "isTruncated"
  > = {
    objects: [],
    commonPrefixes: [],
    isTruncated: false,
  };
  const seen = new Set<string>();
  let marker = "";
  for (let page = 0; ; page++) {
    if (page >= 1000) throw new Error("OBS inventory exceeded 1000 pages.");
    const query = new URLSearchParams({
      "max-keys": "1000",
      "encoding-type": "url",
    });
    if (marker) query.set("marker", marker);
    const xml = await obsFetchXml(
      credential,
      region,
      `/?${query}`,
      bucket.name,
    );
    const data = parseObsObjects(xml);
    objectData.objects.push(...data.objects);
    objectData.commonPrefixes.push(...data.commonPrefixes);
    if (!data.isTruncated) break;
    const rawMarker = xmlTag(xml, "NextMarker");
    const next = rawMarker
      ? xmlTag(xml, "EncodingType") === "url"
        ? decodeURIComponent(rawMarker)
        : rawMarker
      : data.objects.at(-1)?.key;
    if (!next || next === marker || seen.has(next))
      throw new Error(
        "OBS repeated its pagination marker; inventory may be incomplete.",
      );
    seen.add(next);
    marker = next;
  }
  const sizeBytes = objectData.objects.reduce(
    (sum, object) => sum + object.sizeBytes,
    0,
  );

  return {
    ...bucket,
    ...objectData,
    objectCount: objectData.objects.length,
    size: formatBytes(sizeBytes),
  };
}

export async function downloadObsObject(
  session: BetterUiSession,
  bucket: string,
  key: string,
) {
  const bucketName = bucket;
  const objectKey = key;
  const credential = await createObsCredential(session);
  const region = await findObsBucketRegion(session, credential, bucketName);
  const response = await obsObjectRequest({
    bucket: bucketName,
    key: objectKey,
    method: "GET",
    region,
    credential,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${response.status} ${xmlTag(body, "Message", response.statusText)}`,
    );
  }

  return {
    body: response.body,
    contentLength: response.headers.get("content-length"),
    contentType:
      response.headers.get("content-type") ?? "application/octet-stream",
    filename:
      objectKey.split("/").filter(Boolean).at(-1) || objectKey || "download",
  };
}

export async function getObsObjectDetail(
  session: BetterUiSession,
  bucket: string,
  key: string,
) {
  const bucketName = bucket;
  const objectKey = key;
  const credential = await createObsCredential(session);
  const region = await findObsBucketRegion(session, credential, bucketName);
  const response = await obsObjectRequest({
    bucket: bucketName,
    key: objectKey,
    method: "GET",
    region,
    requestHeaders: {
      Range: "bytes=0-65535",
    },
    credential,
  });

  if (!response.ok && response.status !== 206) {
    const body = await response.text().catch(() => "");

    throw new Error(
      `${response.status} ${xmlTag(body, "Message", response.statusText)}`,
    );
  }

  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";
  const contentRange = response.headers.get("content-range") ?? "";
  const contentLength =
    contentRange.match(/\/(\d+)$/)?.[1] ??
    response.headers.get("content-length") ??
    "0";
  const previewKind = getObsPreviewKind(contentType, objectKey);
  const previewText =
    previewKind === "text" ? await readObsPreview(response) : "";

  if (previewKind !== "text") await response.body?.cancel();

  return {
    bucket: bucketName,
    contentLength: formatBytes(contentLength),
    contentType,
    etag: response.headers.get("etag")?.replace(/^"|"$/g, "") ?? "-",
    key: objectKey,
    lastModified: response.headers.get("last-modified") ?? "-",
    owner: "-",
    previewKind,
    previewText,
    size: formatBytes(contentLength),
    sizeBytes: Number(contentLength),
    storageClass: response.headers.get("x-obs-storage-class") ?? "-",
  } satisfies ObsObjectDetail;
}

export async function uploadObsObject(
  session: BetterUiSession,
  bucket: string,
  key: string,
  file: File,
) {
  const bucketName = bucket;
  const objectKey = key;

  if (!objectKey) {
    throw new Error("Object key is required.");
  }

  const credential = await createObsCredential(session);
  const region = await findObsBucketRegion(session, credential, bucketName);
  const response = await obsObjectRequest({
    body: file,
    bucket: bucketName,
    contentType: file.type || "application/octet-stream",
    key: objectKey,
    method: "PUT",
    region,
    credential,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${response.status} ${xmlTag(body, "Message", response.statusText)}`,
    );
  }
}

/** Enforce the preview bound even if the object server ignores the Range header. */
export async function readObsPreview(response: Response, maxBytes = 65_536) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, maxBytes - length);
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
