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
import { HuaweiApiError, huaweiAccountFetch, parseError } from "@/lib/huawei/http";

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
  currentPrefix: string;
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

/** Bucket names form part of the signed request authority, never an arbitrary URL. */
export function assertObsBucket(bucket: string) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || /\.\.|\.-|-\./.test(bucket) || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
    throw new Error("Invalid OBS bucket name.");
  }
}

export function obsHost(region: string, bucket?: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(region)) throw new Error("Invalid OBS region.");
  if (bucket !== undefined) assertObsBucket(bucket);
  const configured = process.env.HUAWEI_OBS_ENDPOINT || `obs.${region}.myhuaweicloud.com`;
  let endpoint: URL;
  try { endpoint = new URL(configured.includes("://") ? configured : `https://${configured}`); }
  catch { throw new Error("Invalid OBS endpoint configuration."); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || !/^[a-z0-9.-]+$/i.test(endpoint.hostname)) throw new Error("Invalid OBS endpoint configuration.");
  return `${bucket ? `${bucket}.` : ""}${endpoint.host}`;
}

async function obsSignedFetch(url: string, init: RequestInit) {
  let response: Response;
  // A redirect must never carry signed credentials to another destination.
  try { response = await fetch(url, { ...init, redirect: "error" }); }
  catch { throw new Error("OBS could not be reached. Check the current object or bucket state before retrying."); }
  if (!response.ok) throw new HuaweiApiError(await parseError(response), response.status);
  return response;
}

async function obsResponseText(response: Response) {
  try { return await response.text(); }
  catch { throw new Error("OBS response could not be read. Check the current object or bucket state before retrying."); }
}

function obsSuppliedHeaders(supplied?: HeadersInit) {
  const headers = new Headers(supplied);
  for (const name of ["authorization", "date", "host", "x-obs-security-token", "x-auth-token", "cookie", "content-type", "content-length", "connection", "transfer-encoding"]) {
    if (headers.has(name)) throw new Error("OBS authentication and transport headers cannot be overridden.");
  }
  return headers;
}

export async function createObsCredential(session: BetterUiSession): Promise<ObsCredential> {
  const body = await huaweiAccountFetch<unknown>(session, "/v3.0/OS-CREDENTIAL/securitytokens", {
    method: "POST",
    body: JSON.stringify({ auth: { identity: { methods: ["token"], token: { duration_seconds: 3600 } } } }),
  });
  const result = asRecord(body);
  if (["error", "error_code", "error_msg"].some(key => Object.hasOwn(result, key))) throw new Error("IAM did not return verified temporary OBS credentials.");
  const credential = asRecord(result.credential);
  const access = firstString([credential.access, credential.access_key, credential.ak], "");
  const secret = firstString([credential.secret, credential.secret_key, credential.sk], "");
  const securityToken = firstString([credential.securitytoken, credential.security_token, credential.token], "");
  if (!access || !secret || !securityToken) throw new Error("IAM did not return temporary OBS credentials.");
  return { access, secret, securityToken };
}

export function obsAuthorization({
  bucket,
  contentType = "",
  credential,
  date,
  method,
  objectKey,
  requestHeaders,
  subresource,
}: {
  bucket?: string;
  contentType?: string;
  credential: ObsCredential;
  date: string;
  method: "GET" | "PUT" | "DELETE";
  objectKey?: string;
  requestHeaders?: HeadersInit;
  subresource?: string;
}) {
  const signedHeaders = new Headers(requestHeaders);
  signedHeaders.set("x-obs-security-token", credential.securityToken);
  const canonicalHeaders = [...signedHeaders.entries()].filter(([name]) => name.startsWith("x-obs-")).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => `${name}:${value.trim()}\n`).join("");
  const canonicalResource = bucket
    ? `/${bucket}/${objectKey ? encodeObsObjectKey(objectKey) : ""}${subresource ? `?${subresource}` : ""}`
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
  if (!key) throw new Error("Object key is required.");
  // WHATWG URLs normalize even percent-encoded dot segments. Refuse to address a different object.
  if (key.split("/").some(part => part === "." || part === "..")) throw new Error("OBS object keys containing dot segments cannot be safely addressed by this transport.");
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
  if (!pathAndQuery.startsWith("/") || pathAndQuery.startsWith("//") || new URL(`https://${host}${pathAndQuery}`).host !== host) throw new Error("Invalid OBS request path.");
  const response = await obsSignedFetch(`https://${host}${pathAndQuery}`, {
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
  return obsResponseText(response);
}

export async function findObsBucketRegion(
  session: BetterUiSession,
  credential: ObsCredential,
  bucket: string,
) {
  obsHost(session.region, bucket);
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
  method: "GET" | "PUT" | "DELETE";
  region: string;
  requestHeaders?: HeadersInit;
}) {
  const host = obsHost(region, bucket);
  const encodedKey = encodeObsObjectKey(key);
  const supplied = obsSuppliedHeaders(requestHeaders);
  const date = new Date().toUTCString();
  const headers: HeadersInit = {
    Authorization: obsAuthorization({
      bucket,
      contentType,
      credential,
      date,
      method,
      objectKey: key,
      requestHeaders: supplied,
    }),
    Date: date,
    "x-obs-security-token": credential.securityToken,
  };

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  for (const [name, value] of supplied.entries()) {
    headers[name] = value;
  }

  return obsSignedFetch(
    `https://${host}/${encodedKey}`,
    {
      body,
      cache: "no-store",
      headers,
      method,
    },
  );
}

/** Bucket configuration uses OBS subresource signing, separate from object keys. */
export async function obsBucketConfigurationRequest(session: BetterUiSession, bucket: string, method: "GET" | "PUT" | "DELETE", subresource?: "acl" | "versioning" | "lifecycle" | "cors" | "policy" | "storageClass", body?: string, requestHeaders?: HeadersInit) {
  const host = obsHost(session.region, bucket);
  const supplied = obsSuppliedHeaders(requestHeaders);
  const credential = await createObsCredential(session);
  const date = new Date().toUTCString();
  const contentType = body === undefined ? "" : subresource === "policy" ? "application/json" : "application/xml";
  const headers = supplied;
  headers.set("Date", date);
  headers.set("x-obs-security-token", credential.securityToken);
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Authorization", obsAuthorization({ bucket, contentType, credential, date, method, requestHeaders: headers, subresource }));
  const response = await obsSignedFetch(`https://${host}/${subresource ? `?${subresource}` : ""}`, { method, body, headers, cache: "no-store" });
  return obsResponseText(response);
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
  obsHost(session.region);
  const credential = await createObsCredential(session);
  const xml = await obsFetchXml(credential, session.region, "/");
  return parseObsBuckets(xml);
}

export async function getObsBucket(
  session: BetterUiSession,
  name: string,
  prefix = "",
) {
  const currentPrefix = normalizeObsPrefix(prefix);
  const bucketName = name;
  obsHost(session.region, bucketName);
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
    query.set("delimiter", "/");
    if (currentPrefix) query.set("prefix", currentPrefix);
    if (marker) query.set("marker", marker);
    const xml = await obsFetchXml(
      credential,
      region,
      `/?${query}`,
      bucket.name,
    );
    const data = parseObsObjects(xml);
    objectData.objects.push(
      ...data.objects.filter(
        (object) =>
          !(
            currentPrefix &&
            object.key === currentPrefix &&
            object.sizeBytes === 0
          ),
      ),
    );
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
    currentPrefix,
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
  obsHost(session.region, bucketName);
  encodeObsObjectKey(key);
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
  obsHost(session.region, bucketName);
  encodeObsObjectKey(key);
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

  if (previewKind !== "text") void response.body?.cancel().catch(() => undefined);

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
  obsHost(session.region, bucketName);
  encodeObsObjectKey(key);
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
  void response.body?.cancel().catch(() => undefined);

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
  } catch {
    throw new Error("OBS preview could not be read.");
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function normalizeObsPrefix(prefix: string) {
  return prefix;
}

function normalizeObsFolderKey(key: string) {
  const folderKey = normalizeObsPrefix(key);

  if (!folderKey) {
    throw new Error("Folder name is required.");
  }

  return folderKey.endsWith("/") ? folderKey : `${folderKey}/`;
}

async function obsBucketRequest({
  bucket,
  method,
  region,
  session,
}: {
  bucket: string;
  method: "DELETE";
  region: string;
  session: BetterUiSession;
}) {
  const credential = await createObsCredential(session);
  const date = new Date().toUTCString();

  return obsSignedFetch(`https://${obsHost(region, bucket)}/`, {
    cache: "no-store",
    headers: {
      Authorization: obsAuthorization({
        bucket,
        credential,
        date,
        method,
      }),
      Date: date,
      "x-obs-security-token": credential.securityToken,
    },
    method,
  });
}

export async function createObsFolder(
  session: BetterUiSession,
  bucket: string,
  key: string,
) {
  const bucketName = bucket;
  obsHost(session.region, bucketName);
  const objectKey = normalizeObsFolderKey(key);
  encodeObsObjectKey(objectKey);
  const credential = await createObsCredential(session);
  const region = await findObsBucketRegion(session, credential, bucketName);
  const response = await obsObjectRequest({
    body: "",
    bucket: bucketName,
    contentType: "application/x-directory",
    key: objectKey,
    method: "PUT",
    region,
    credential,
  });
  void response.body?.cancel().catch(() => undefined);

  return objectKey;
}

export async function deleteObsObject(
  session: BetterUiSession,
  bucket: string,
  key: string,
) {
  const bucketName = bucket;
  obsHost(session.region, bucketName);
  encodeObsObjectKey(key);
  const objectKey = key;

  if (!objectKey.trim()) {
    throw new Error("Object key is required.");
  }

  const credential = await createObsCredential(session);
  const region = await findObsBucketRegion(session, credential, bucketName);
  const response = await obsObjectRequest({
    bucket: bucketName,
    key: objectKey,
    method: "DELETE",
    region,
    credential,
  });
  void response.body?.cancel().catch(() => undefined);

}

export async function deleteEmptyObsBucket(
  session: BetterUiSession,
  bucket: string,
) {
  const bucketName = bucket;
  obsHost(session.region, bucketName);
  const detail = await getObsBucket(session, bucketName);

  if (!detail) {
    throw new Error("Bucket was not found.");
  }

  if (
    detail.objects.length ||
    detail.commonPrefixes.length ||
    detail.isTruncated
  ) {
    throw new Error("Only empty buckets can be deleted.");
  }

  const region =
    detail.location && detail.location !== "-"
      ? detail.location
      : session.region;
  const response = await obsBucketRequest({
    bucket: bucketName,
    method: "DELETE",
    region,
    session,
  });
  void response.body?.cancel().catch(() => undefined);

}
