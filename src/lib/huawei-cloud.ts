import "server-only";

import { createHmac, createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getCurrentSession,
  getSessionProjects,
  type BetterUiSession,
  type HuaweiProjectSession,
} from "@/lib/auth-session";

type ServiceKey =
  | "cce"
  | "ces"
  | "ecs"
  | "elb"
  | "evs"
  | "fg"
  | "ims"
  | "rds"
  | "vpc";

export type CloudResult<T> =
  | {
      data: T;
      error: null;
      isCached: boolean;
      isRefreshing: boolean;
      updatedAt: string;
    }
  | {
      data: T;
      error: string;
      isCached: boolean;
      isRefreshing: boolean;
      updatedAt: string;
    };

export type CloudSummary = {
  cceClusters: number;
  ecsInstances: number;
  ecsRunning: number;
  elbLoadBalancers: number;
  errors: string[];
  evsDisks: number;
  rdsInstances: number;
  securityGroups: number;
  subnets: number;
  vpcs: number;
};

export type EcsInstance = {
  attachedDiskIds: string[];
  availabilityZone: string;
  createdAt: string;
  flavor: string;
  id: string;
  image: string;
  imageId: string;
  imageName: string;
  name: string;
  privateIp: string;
  publicIp: string;
  securityGroups: Array<{
    id: string;
    name: string;
  }>;
  status: string;
  systemDisk: {
    id: string;
    name: string;
    size: string;
    status: string;
    type: string;
  } | null;
  projectId: string;
  projectName: string;
  region: string;
};

export type EcsMonitoringMetric = {
  datapoints: Array<{
    timestamp: string;
    value: number;
  }>;
  label: string;
  metricName: string;
  namespace: string;
  unit: string;
};

export type EcsMonitoring = {
  metrics: EcsMonitoringMetric[];
  projectId: string;
  region: string;
};

export type EvsDisk = {
  availabilityZone: string;
  attachedTo: string;
  createdAt: string;
  id: string;
  name: string;
  size: string;
  status: string;
  type: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type EvsSnapshot = {
  createdAt: string;
  description: string;
  diskId: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  size: string;
  status: string;
};

export type VpcItem = {
  cidr: string;
  id: string;
  name: string;
  status: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type SubnetItem = {
  cidr: string;
  gateway: string;
  id: string;
  name: string;
  status: string;
  vpcId: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type SecurityGroupItem = {
  description: string;
  id: string;
  name: string;
  rules: number;
  projectId: string;
  projectName: string;
  region: string;
};

export type ElbItem = {
  id: string;
  name: string;
  operatingStatus: string;
  provisioningStatus: string;
  vipAddress: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type CceCluster = {
  id: string;
  name: string;
  status: string;
  type: string;
  version: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type RdsInstance = {
  datastore: string;
  id: string;
  name: string;
  privateIp: string;
  status: string;
  type: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type FunctionGraphFunction = {
  codeFile: string;
  codeLink: string;
  codeSize: string;
  codeText: string;
  codeType: string;
  cpu: string;
  description: string;
  digest: string;
  handler: string;
  id: string;
  lastModified: string;
  memorySize: string;
  name: string;
  packageName: string;
  projectId: string;
  projectName: string;
  region: string;
  runtime: string;
  timeout: string;
  urn: string;
  version: string;
};

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

const emptySummary: CloudSummary = {
  cceClusters: 0,
  ecsInstances: 0,
  ecsRunning: 0,
  elbLoadBalancers: 0,
  errors: [],
  evsDisks: 0,
  rdsInstances: 0,
  securityGroups: 0,
  subnets: 0,
  vpcs: 0,
};

const endpointEnv: Record<ServiceKey, string> = {
  cce: "HUAWEI_CCE_ENDPOINT",
  ces: "HUAWEI_CES_ENDPOINT",
  ecs: "HUAWEI_ECS_ENDPOINT",
  elb: "HUAWEI_ELB_ENDPOINT",
  evs: "HUAWEI_EVS_ENDPOINT",
  fg: "HUAWEI_FUNCTIONGRAPH_ENDPOINT",
  ims: "HUAWEI_IMS_ENDPOINT",
  rds: "HUAWEI_RDS_ENDPOINT",
  vpc: "HUAWEI_VPC_ENDPOINT",
};

const cloudCacheDir = path.join(
  process.cwd(),
  ".next",
  "cache",
  "huawei-cloud-data",
);
const staleAfterMs = 15_000;

const globalCloudCache = globalThis as typeof globalThis & {
  __betterUiCloudRefreshes?: Map<string, Promise<void>>;
  __betterUiCloudRefreshAttempts?: Map<string, number>;
};

const activeRefreshes =
  globalCloudCache.__betterUiCloudRefreshes ?? new Map<string, Promise<void>>();
const refreshAttempts =
  globalCloudCache.__betterUiCloudRefreshAttempts ?? new Map<string, number>();

globalCloudCache.__betterUiCloudRefreshes = activeRefreshes;
globalCloudCache.__betterUiCloudRefreshAttempts = refreshAttempts;

type StoredCloudResult<T> = {
  data: T;
  updatedAt: string;
};

function serviceEndpoint(service: ServiceKey, region: string) {
  const defaultService = service === "fg" ? "functiongraph" : service;

  return (
    process.env[endpointEnv[service]] ??
    `https://${defaultService}.${region}.myhuaweicloud.com`
  ).replace(/\/+$/, "");
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function firstString(values: unknown[], fallback = "-") {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return fallback;
}

function numberWithUnit(value: unknown, unit: string) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? `${number} ${unit}` : "-";
}

function formatBytes(value: unknown) {
  const bytes = Number(value ?? 0);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** exponent;

  return `${amount.toFixed(amount >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function xmlDecode(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function xmlTag(source: string, tag: string, fallback = "") {
  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1] ? xmlDecode(match[1]) : fallback;
}

function xmlBlocks(source: string, tag: string) {
  return Array.from(source.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))).map(
    (match) => match[1] ?? "",
  );
}

function firstIp(addresses: unknown, kind: "private" | "public") {
  const pools = Object.values(asRecord(addresses));

  for (const pool of pools) {
    for (const address of asArray(pool)) {
      const item = asRecord(address);
      const osType = item["OS-EXT-IPS:type"];
      const ip = item.addr;

      if (
        typeof ip === "string" &&
        ((kind === "private" && osType === "fixed") ||
          (kind === "public" && osType === "floating"))
      ) {
        return ip;
      }
    }
  }

  return "-";
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Huawei Cloud API request failed.";
}

function cacheFilePath(key: string) {
  const digest = createHash("sha256").update(key).digest("hex");

  return path.join(cloudCacheDir, `${digest}.json`);
}

function sessionCacheScope(session: BetterUiSession) {
  return JSON.stringify({
    accountName: session.accountName,
    projectId: session.projectId,
    projects: sessionProjects(session).map((project) => ({
      projectId: project.projectId,
      region: project.region,
    })),
    region: session.region,
    userId: session.userId,
    username: session.username,
  });
}

async function readStoredResult<T>(key: string) {
  const file = cacheFilePath(key);
  const content = await readFile(file, "utf8").catch(() => null);

  if (!content) {
    return null;
  }

  return JSON.parse(content) as StoredCloudResult<T>;
}

async function writeStoredResult<T>(key: string, data: T) {
  const result: StoredCloudResult<T> = {
    data,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(cloudCacheDir, { recursive: true });
  await writeFile(cacheFilePath(key), JSON.stringify(result), "utf8");

  return result;
}

export async function invalidateCloudResult(
  session: BetterUiSession,
  cacheKey: string,
) {
  const scopedCacheKey = `${cacheKey}:${sessionCacheScope(session)}`;

  activeRefreshes.delete(scopedCacheKey);
  refreshAttempts.delete(scopedCacheKey);
  await unlink(cacheFilePath(scopedCacheKey)).catch(() => undefined);
}

function refreshStoredResult<T>(
  key: string,
  loader: (session: BetterUiSession) => Promise<T>,
  session: BetterUiSession,
) {
  if (activeRefreshes.has(key)) {
    return;
  }

  refreshAttempts.set(key, Date.now());

  const refresh = loader(session)
    .then((data) => writeStoredResult(key, data))
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      activeRefreshes.delete(key);
    });

  activeRefreshes.set(key, refresh);
}

async function parseError(response: Response) {
  const body = (await response.json().catch(() => null)) as unknown;
  const record = asRecord(body);
  const error = asRecord(record.error ?? record.Error);
  const message = firstString(
    [
      error.message,
      error.error_msg,
      record.message,
      record.error_msg,
      response.statusText,
    ],
    "Huawei Cloud API request failed.",
  );

  return `${response.status} ${message}`;
}

async function huaweiFetch<T>(
  session: HuaweiProjectSession,
  service: ServiceKey,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(
    `${serviceEndpoint(service, session.region)}${path}`,
    {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json;charset=utf8",
        "X-Auth-Token": session.token,
        ...init?.headers,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json().catch(() => ({}))) as T;
}

type ObsCredential = {
  access: string;
  secret: string;
  securityToken: string;
};

function obsHost(region: string, bucket?: string) {
  const endpoint = (process.env.HUAWEI_OBS_ENDPOINT || `obs.${region}.myhuaweicloud.com`)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  return bucket ? `${bucket}.${endpoint}` : endpoint;
}

async function createObsCredential(session: BetterUiSession): Promise<ObsCredential> {
  const response = await fetch(`${session.iamEndpoint}/v3.0/OS-CREDENTIAL/securitytokens`, {
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
  });
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const credential = asRecord(asRecord(body).credential);
  const access = firstString([credential.access, credential.access_key, credential.ak], "");
  const secret = firstString([credential.secret, credential.secret_key, credential.sk], "");
  const securityToken = firstString(
    [credential.securitytoken, credential.security_token, credential.token],
    "",
  );

  if (!access || !secret || !securityToken) {
    throw new Error("IAM did not return temporary OBS credentials.");
  }

  return { access, secret, securityToken };
}

function obsAuthorization({
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
  const stringToSign = [method, "", contentType, date, `${canonicalHeaders}${canonicalResource}`].join("\n");
  const signature = createHmac("sha1", credential.secret)
    .update(stringToSign)
    .digest("base64");

  return `OBS ${credential.access}:${signature}`;
}

function encodeObsObjectKey(key: string) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function obsFetchXml(
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
      Authorization: obsAuthorization({ bucket, credential, date, method: "GET" }),
      Date: date,
      "x-obs-security-token": credential.securityToken,
    },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${xmlTag(body, "Message", response.statusText)}`);
  }

  return body;
}

async function findObsBucketRegion(
  session: BetterUiSession,
  credential: ObsCredential,
  bucket: string,
) {
  const buckets = parseObsBuckets(await obsFetchXml(credential, session.region, "/"));
  const match = buckets.find((item) => item.name === bucket);
  return match?.location && match.location !== "-" ? match.location : session.region;
}

async function obsObjectRequest({
  body,
  bucket,
  contentType = "",
  key,
  method,
  region,
  requestHeaders,
  session,
}: {
  body?: BodyInit;
  bucket: string;
  contentType?: string;
  key: string;
  method: "GET" | "PUT";
  region: string;
  requestHeaders?: HeadersInit;
  session: BetterUiSession;
}) {
  const credential = await createObsCredential(session);
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

  return fetch(`https://${obsHost(region, bucket)}/${encodeObsObjectKey(key)}`, {
    body,
    cache: "no-store",
    headers,
    method,
  });
}

function sessionProjects(session: BetterUiSession) {
  return getSessionProjects(session);
}

async function loadAcrossProjects<T>(
  session: BetterUiSession,
  loader: (project: HuaweiProjectSession) => Promise<T[]>,
) {
  const results = await Promise.allSettled(
    sessionProjects(session).map((project) => loader(project)),
  );

  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

export async function withCloudResult<T>(
  fallback: T,
  loader: (session: BetterUiSession) => Promise<T>,
  cacheKey = loader.name,
): Promise<CloudResult<T>> {
  const updatedAt = new Date().toISOString();
  const session = await getCurrentSession();

  if (!session) {
    return {
      data: fallback,
      error: "Not signed in.",
      isCached: false,
      isRefreshing: false,
      updatedAt,
    };
  }

  const scopedCacheKey = `${cacheKey}:${sessionCacheScope(session)}`;
  const stored = await readStoredResult<T>(scopedCacheKey);

  if (stored) {
    const cacheAge = Date.now() - new Date(stored.updatedAt).getTime();
    const lastAttempt = refreshAttempts.get(scopedCacheKey) ?? 0;
    const canAttemptRefresh = Date.now() - lastAttempt > staleAfterMs;
    const isRefreshActive = activeRefreshes.has(scopedCacheKey);
    const shouldRefresh = cacheAge > staleAfterMs && canAttemptRefresh;

    if (shouldRefresh) {
      refreshStoredResult(scopedCacheKey, loader, session);
    }

    return {
      data: stored.data,
      error: null,
      isCached: true,
      isRefreshing: shouldRefresh || isRefreshActive,
      updatedAt: stored.updatedAt,
    };
  }

  try {
    const fresh = await writeStoredResult(scopedCacheKey, await loader(session));

    return {
      data: fresh.data,
      error: null,
      isCached: false,
      isRefreshing: false,
      updatedAt: fresh.updatedAt,
    };
  } catch (error) {
    return {
      data: fallback,
      error: normalizeError(error),
      isCached: false,
      isRefreshing: false,
      updatedAt,
    };
  }
}

async function listEcsInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ servers?: unknown[] }>(
    session,
    "ecs",
    `/v1/${session.projectId}/cloudservers/detail?limit=100`,
  );

  return asArray(body.servers).map((server): EcsInstance => {
    const item = asRecord(server);
    const flavor = asRecord(item.flavor);
    const image = asRecord(item.image);
    const metadata = asRecord(item.metadata);
    const imageId = asString(image.id, "-");
    const imageName = firstString([image.name, metadata.image_name, imageId]);
    const securityGroups = asArray(item.security_groups).map((group) => {
      const record = asRecord(group);
      const id = firstString([record.id, record.uuid, record.name]);
      const name = firstString([record.name, record.id, record.uuid]);

      return { id, name };
    });

    return {
      attachedDiskIds: asArray(item["os-extended-volumes:volumes_attached"])
        .map((volume) => asRecord(volume).id)
        .filter((volumeId): volumeId is string => typeof volumeId === "string"),
      availabilityZone: firstString([
        item["OS-EXT-AZ:availability_zone"],
        item.availability_zone,
      ]),
      createdAt: asString(item.created, "-"),
      flavor: firstString([flavor.name, flavor.id]),
      id: asString(item.id),
      image: imageName,
      imageId,
      imageName,
      name: asString(item.name),
      privateIp: firstIp(item.addresses, "private"),
      projectId: session.projectId,
      projectName: session.projectName,
      publicIp: firstIp(item.addresses, "public"),
      region: session.region,
      securityGroups,
      status: asString(item.status, "UNKNOWN"),
      systemDisk: null,
    };
  });
}

async function getImageNameForProject(
  session: HuaweiProjectSession,
  imageId: string,
) {
  if (!imageId || imageId === "-") {
    return "-";
  }

  const body = await huaweiFetch<Record<string, unknown>>(
    session,
    "ims",
    `/v2/cloudimages/${imageId}`,
  );
  const image = asRecord(body.image ?? body);

  return firstString([image.name, imageId]);
}

export async function listEcsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listEcsInstancesForProject);
}

export async function getEcsInstance(session: BetterUiSession, id: string) {
  const instances = await listEcsInstances(session);
  const instance = instances.find((item) => item.id === id) ?? null;

  if (!instance) {
    return null;
  }

  const project =
    sessionProjects(session).find(
      (item) =>
        item.projectId === instance.projectId && item.region === instance.region,
    ) ?? sessionProjects(session)[0];

  const [resolvedImageName, disks] = await Promise.all([
    getImageNameForProject(project, instance.imageId).catch(() => instance.imageName),
    listEvsDisksForProject(project).catch(() => []),
  ]);
  const systemDisk =
    disks.find((disk) => instance.attachedDiskIds.includes(disk.id)) ??
    disks.find((disk) => disk.attachedTo === instance.id) ??
    null;

  return {
    ...instance,
    image: resolvedImageName,
    imageName: resolvedImageName,
    systemDisk: systemDisk
      ? {
          id: systemDisk.id,
          name: systemDisk.name,
          size: systemDisk.size,
          status: systemDisk.status,
          type: systemDisk.type,
        }
      : null,
  };
}

type EcsMetricCandidate = {
  dimensions?: Array<{ name: string; value: string }>;
  metricName: string;
  namespace: string;
  unit: string;
};

function metricKey(candidate: EcsMetricCandidate): string {
  return `${candidate.namespace}:${candidate.metricName}`;
}

async function getCesMetricBatch(
  session: HuaweiProjectSession,
  instanceId: string,
  candidates: EcsMetricCandidate[],
) {
  const to = Date.now();
  const from = to - 6 * 60 * 60 * 1000;

  const body = await huaweiFetch<{ metrics?: unknown[] }>(
    session,
    "ces",
    `/V1.0/${session.projectId}/batch-query-metric-data`,
    {
      body: JSON.stringify({
        filter: "average",
        from,
        metrics: candidates.map((candidate) => ({
          dimensions: candidate.dimensions ?? [
            { name: "instance_id", value: instanceId },
          ],
          metric_name: candidate.metricName,
          namespace: candidate.namespace,
        })),
        period: "300",
        to,
      }),
      method: "POST",
    },
  );

  return new Map<string, EcsMonitoringMetric["datapoints"]>(
    asArray(body.metrics).map((metric) => {
      const item = asRecord(metric);
      const metricName = asString(item.metric_name);
      const namespace = asString(item.namespace);
      const datapoints = asArray(item.datapoints)
        .map((point) => {
          const datapoint = asRecord(point);
          const average = Number(
            datapoint.average ?? datapoint.value ?? datapoint.max ?? datapoint.min,
          );
          const timestamp = Number(datapoint.timestamp);

          if (!Number.isFinite(average) || !Number.isFinite(timestamp)) {
            return null;
          }

          return {
            timestamp: new Date(timestamp).toISOString(),
            value: average,
          };
        })
        .filter(
          (point): point is { timestamp: string; value: number } => point !== null,
        )
        .sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );

      return [`${namespace}:${metricName}`, datapoints] as const;
    }),
  );
}

async function listCesMetricsForInstance(
  session: HuaweiProjectSession,
  instanceId: string,
) {
  const namespaces = ["SYS.ECS", "AGT.ECS"];
  const results = await Promise.allSettled(
    namespaces.map(async (namespace) => {
      const query = new URLSearchParams({ namespace });
      const body = await huaweiFetch<{ metrics?: unknown[] }>(
        session,
        "ces",
        `/V1.0/${session.projectId}/metrics?${query.toString()}`,
      );

      return asArray(body.metrics).flatMap((metric) => {
        const item = asRecord(metric);
        const dimensions = asArray(item.dimensions)
          .map((dimension) => {
            const record = asRecord(dimension);
            const name = asString(record.name, "");
            const value = asString(record.value, "");

            return name && value ? { name, value } : null;
          })
          .filter(
            (dimension): dimension is { name: string; value: string } =>
              dimension !== null,
          );

        if (!dimensions.some((dimension) => dimension.value === instanceId)) {
          return [];
        }

        return [
          {
            dimensions,
            metricName: asString(item.metric_name, ""),
            namespace: asString(item.namespace, namespace),
            unit: asString(item.unit, ""),
          },
        ];
      });
    }),
  );

  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

function candidatesForNames(
  discoveredMetrics: EcsMetricCandidate[],
  fallbackCandidates: EcsMetricCandidate[],
) {
  const fallbackByKey = new Map(
    fallbackCandidates.map((candidate) => [metricKey(candidate), candidate]),
  );
  const discovered = discoveredMetrics.flatMap((metric) => {
    const fallback = fallbackByKey.get(metricKey(metric));

    return fallback
      ? [
          {
            ...metric,
            unit: metric.unit || fallback.unit,
          },
        ]
      : [];
  });

  return [...discovered, ...fallbackCandidates];
}

export async function getEcsMonitoring(session: BetterUiSession, id: string) {
  const instance = await getEcsInstance(session, id);

  if (!instance) {
    return null;
  }

  const project =
    sessionProjects(session).find(
      (item) =>
        item.projectId === instance.projectId && item.region === instance.region,
    ) ?? sessionProjects(session)[0];

  const discoveredMetrics = await listCesMetricsForInstance(project, id).catch(
    () => [] as EcsMetricCandidate[],
  );
  const metricDefinitions: Array<{
    candidates: EcsMetricCandidate[];
    label: string;
  }> = [
    {
      candidates: candidatesForNames(discoveredMetrics, [
        { metricName: "cpu_util", namespace: "SYS.ECS", unit: "%" },
      ]),
      label: "CPU usage",
    },
    {
      candidates: candidatesForNames(discoveredMetrics, [
        { metricName: "mem_util", namespace: "SYS.ECS", unit: "%" },
        { metricName: "mem_usedPercent", namespace: "AGT.ECS", unit: "%" },
        { metricName: "mem_util", namespace: "AGT.ECS", unit: "%" },
      ]),
      label: "Memory usage",
    },
    {
      candidates: candidatesForNames(discoveredMetrics, [
        {
          metricName: "network_incoming_bytes_aggregate_rate",
          namespace: "SYS.ECS",
          unit: "B/s",
        },
        {
          metricName: "network_incoming_bytes_rate_inband",
          namespace: "SYS.ECS",
          unit: "B/s",
        },
        { metricName: "net_bitSent", namespace: "AGT.ECS", unit: "bit/s" },
      ]),
      label: "Network in",
    },
    {
      candidates: candidatesForNames(discoveredMetrics, [
        {
          metricName: "network_outgoing_bytes_aggregate_rate",
          namespace: "SYS.ECS",
          unit: "B/s",
        },
        {
          metricName: "network_outgoing_bytes_rate_inband",
          namespace: "SYS.ECS",
          unit: "B/s",
        },
        { metricName: "net_bitRecv", namespace: "AGT.ECS", unit: "bit/s" },
      ]),
      label: "Network out",
    },
  ];
  const candidates = metricDefinitions.flatMap((metric) => metric.candidates);
  const datapointsByMetric = await getCesMetricBatch(
    project,
    id,
    candidates,
  ).catch(() => new Map<string, EcsMonitoringMetric["datapoints"]>());
  const metrics = metricDefinitions.map((definition) => {
    const selectedCandidate =
      definition.candidates.find(
        (candidate) => (datapointsByMetric.get(metricKey(candidate)) ?? []).length > 0,
      ) ?? definition.candidates[0];

    return {
      datapoints: datapointsByMetric.get(metricKey(selectedCandidate)) ?? [],
      label: definition.label,
      metricName: selectedCandidate.metricName,
      namespace: selectedCandidate.namespace,
      unit: selectedCandidate.unit,
    };
  });

  return {
    metrics,
    projectId: instance.projectId,
    region: instance.region,
  };
}

export async function runEcsAction(
  session: BetterUiSession,
  id: string,
  action: "restart" | "start" | "stop",
  projectId?: string,
) {
  const project =
    sessionProjects(session).find((item) => item.projectId === projectId) ??
    sessionProjects(session).find((item) => item.projectId === session.projectId) ??
    sessionProjects(session)[0];

  const payload =
    action === "start"
      ? { "os-start": { servers: [{ id }] } }
      : action === "stop"
        ? { "os-stop": { servers: [{ id }], type: "SOFT" } }
        : { reboot: { servers: [{ id }], type: "SOFT" } };

  return huaweiFetch<{ job_id?: string }>(
    project,
    "ecs",
    `/v1/${project.projectId}/cloudservers/action`,
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
  );
}

async function listEvsDisksForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ cloudvolumes?: unknown[]; volumes?: unknown[] }>(
    session,
    "evs",
    `/v2/${session.projectId}/cloudvolumes/detail?limit=100`,
  );

  return asArray(body.cloudvolumes ?? body.volumes).map((volume): EvsDisk => {
    const item = asRecord(volume);
    const attachments = asArray(item.attachments);
    const firstAttachment = asRecord(attachments[0]);
    return {
      attachedTo: firstString([firstAttachment.server_id, firstAttachment.device]),
      availabilityZone: asString(item.availability_zone),
      createdAt: asString(item.created_at),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      size: `${Number(item.size ?? 0)} GB`,
      status: asString(item.status, "UNKNOWN"),
      type: asString(item.volume_type),
    };
  });
}

export async function getEvsDisk(session: BetterUiSession, id: string) {
  const disks = await listEvsDisks(session);
  return disks.find((disk) => disk.id === id) ?? null;
}

export async function listEvsDisks(session: BetterUiSession) {
  return loadAcrossProjects(session, listEvsDisksForProject);
}

function parseEvsSnapshot(
  snapshot: unknown,
  session: HuaweiProjectSession,
): EvsSnapshot {
  const item = asRecord(snapshot);

  return {
    createdAt: firstString([item.created_at, item.createdAt]),
    description: asString(item.description, ""),
    diskId: firstString([item.volume_id, item.volumeId, item.volume_id_v2]),
    id: asString(item.id),
    name: firstString([item.name, item.id]),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    size: `${Number(item.size ?? 0)} GB`,
    status: asString(item.status, "UNKNOWN"),
  };
}

async function listEvsSnapshotsForProject(
  session: HuaweiProjectSession,
  diskId?: string,
) {
  const query = new URLSearchParams({ limit: "100" });

  if (diskId) {
    query.set("volume_id", diskId);
  }

  const body = await huaweiFetch<{
    snapshots?: unknown[];
    cloudsnapshots?: unknown[];
  }>(
    session,
    "evs",
    `/v2/${session.projectId}/cloudsnapshots/detail?${query.toString()}`,
  );

  return asArray(body.cloudsnapshots ?? body.snapshots).map((snapshot) =>
    parseEvsSnapshot(snapshot, session),
  );
}

export async function listEvsSnapshots(session: BetterUiSession) {
  return loadAcrossProjects(session, listEvsSnapshotsForProject);
}

export async function getEcsSnapshots(session: BetterUiSession, id: string) {
  const instance = await getEcsInstance(session, id);

  if (!instance) {
    return null;
  }

  const diskIds = new Set([
    ...(instance.systemDisk?.id ? [instance.systemDisk.id] : []),
    ...instance.attachedDiskIds,
  ]);

  if (!diskIds.size) {
    return [];
  }

  const project =
    sessionProjects(session).find(
      (item) =>
        item.projectId === instance.projectId && item.region === instance.region,
    ) ?? sessionProjects(session)[0];
  const snapshots = (
    await Promise.all(
      Array.from(diskIds).map((diskId) =>
        listEvsSnapshotsForProject(project, diskId).catch(() => []),
      ),
    )
  ).flat();

  return snapshots.filter((snapshot) => diskIds.has(snapshot.diskId));
}

function projectForId(session: BetterUiSession, projectId?: string) {
  return (
    sessionProjects(session).find((project) => project.projectId === projectId) ??
    sessionProjects(session).find((project) => project.projectId === session.projectId) ??
    sessionProjects(session)[0]
  );
}

export async function createEvsSnapshot(
  session: BetterUiSession,
  diskId: string,
  name: string,
  description: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<{ snapshot?: { id?: string }; id?: string }>(
    project,
    "evs",
    `/v2/${project.projectId}/cloudsnapshots`,
    {
      body: JSON.stringify({
        snapshot: {
          description,
          force: true,
          name,
          volume_id: diskId,
        },
      }),
      method: "POST",
    },
  );
}

export async function deleteEvsSnapshot(
  session: BetterUiSession,
  snapshotId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "evs",
    `/v2/${project.projectId}/cloudsnapshots/${snapshotId}`,
    { method: "DELETE" },
  );
}

async function listVpcsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ vpcs?: unknown[] }>(
    session,
    "vpc",
    `/v3/${session.projectId}/vpc/vpcs?limit=200`,
  );

  return asArray(body.vpcs).map((vpc): VpcItem => {
    const item = asRecord(vpc);
    return {
      cidr: firstString([item.cidr, item.cidr_v4]),
      id: asString(item.id),
      name: asString(item.name),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "ACTIVE"),
    };
  });
}

async function listSubnetsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ subnets?: unknown[] }>(
    session,
    "vpc",
    `/v1/${session.projectId}/subnets?limit=200`,
  );

  return asArray(body.subnets).map((subnet): SubnetItem => {
    const item = asRecord(subnet);
    return {
      cidr: asString(item.cidr),
      gateway: asString(item.gateway_ip),
      id: asString(item.id),
      name: asString(item.name),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "ACTIVE"),
      vpcId: asString(item.vpc_id),
    };
  });
}

export async function listVpcs(session: BetterUiSession) {
  return loadAcrossProjects(session, listVpcsForProject);
}

export async function listSubnets(session: BetterUiSession) {
  return loadAcrossProjects(session, listSubnetsForProject);
}

async function listSecurityGroupsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ security_groups?: unknown[] }>(
    session,
    "vpc",
    `/v3/${session.projectId}/vpc/security-groups?limit=200`,
  );

  return asArray(body.security_groups).map((group): SecurityGroupItem => {
    const item = asRecord(group);
    return {
      description: asString(item.description, ""),
      id: asString(item.id),
      name: asString(item.name),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      rules: asArray(item.security_group_rules).length,
    };
  });
}

export async function listSecurityGroups(session: BetterUiSession) {
  return loadAcrossProjects(session, listSecurityGroupsForProject);
}

async function listElbsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ loadbalancers?: unknown[] }>(
    session,
    "elb",
    `/v3/${session.projectId}/elb/loadbalancers?limit=100`,
  );

  return asArray(body.loadbalancers).map((loadBalancer): ElbItem => {
    const item = asRecord(loadBalancer);
    return {
      id: asString(item.id),
      name: asString(item.name),
      operatingStatus: asString(item.operating_status, "UNKNOWN"),
      projectId: session.projectId,
      projectName: session.projectName,
      provisioningStatus: asString(item.provisioning_status, "UNKNOWN"),
      region: session.region,
      vipAddress: asString(item.vip_address),
    };
  });
}

export async function getElb(session: BetterUiSession, id: string) {
  const elbs = await listElbs(session);
  return elbs.find((elb) => elb.id === id) ?? null;
}

export async function listElbs(session: BetterUiSession) {
  return loadAcrossProjects(session, listElbsForProject);
}

async function listCceClustersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ items?: unknown[] }>(
    session,
    "cce",
    `/api/v3/projects/${session.projectId}/clusters`,
  );

  return asArray(body.items).map((cluster): CceCluster => {
    const item = asRecord(cluster);
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    return {
      id: asString(metadata.uid ?? metadata.id),
      name: asString(metadata.name),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(status.phase, "UNKNOWN"),
      type: asString(spec.type),
      version: asString(spec.version),
    };
  });
}

export async function getCceCluster(session: BetterUiSession, id: string) {
  const clusters = await listCceClusters(session);
  return clusters.find((cluster) => cluster.id === id) ?? null;
}

export async function listCceClusters(session: BetterUiSession) {
  return loadAcrossProjects(session, listCceClustersForProject);
}

async function listFunctionGraphFunctionsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{
    functions?: unknown[];
    next_marker?: string;
  }>(session, "fg", `/v2/${session.projectId}/fgs/functions?maxitems=400`);

  return asArray(body.functions).map((item): FunctionGraphFunction => {
    const fn = asRecord(item);
    return parseFunctionGraphFunction(fn, session);
  });
}

function parseFunctionGraphFunction(
  fn: Record<string, unknown>,
  session: HuaweiProjectSession,
): FunctionGraphFunction {
  const funcCode = asRecord(fn.func_code ?? fn.code);
  const codeFile = firstString([fn.code_filename, funcCode.file, funcCode.code_filename], "");
  const inlineCode = firstString(
    [fn.code_text, fn.codeText, fn.source_code, funcCode.code, funcCode.source_code],
    "",
  );
  const codeType = firstString([fn.code_type, fn.codeType, funcCode.type]);

  return {
    codeFile,
    codeLink: firstString([fn.code_url, funcCode.link, funcCode.location], ""),
    codeSize: numberWithUnit(fn.code_size, "bytes"),
    codeText: inlineCode,
    codeType,
    cpu: firstString([fn.cpu], "-"),
    description: asString(fn.description, ""),
    digest: firstString([fn.digest, fn.code_sha256, fn.code_digest], ""),
    handler: asString(fn.handler),
    id: firstString([fn.func_id, fn.id, fn.function_id, fn.function_urn, fn.func_urn]),
    lastModified: firstString([fn.last_modified, fn.updated_at, fn.created_time]),
    memorySize: numberWithUnit(fn.memory_size ?? fn.memorySize, "MB"),
    name: firstString([fn.func_name, fn.name, fn.function_name]),
    packageName: firstString([fn.package, fn.package_name, fn.app], "default"),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    runtime: firstString([fn.runtime, fn.runtime_id]),
    timeout: numberWithUnit(fn.timeout, "s"),
    urn: firstString([fn.func_urn, fn.function_urn, fn.urn, fn.id]),
    version: firstString([fn.version, fn.func_version], "latest"),
  };
}

async function getFunctionGraphFunctionForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const decodedId = decodeURIComponent(id);
  const functions = await listFunctionGraphFunctionsForProject(session);
  const summary = functions.find(
    (fn) =>
      fn.id === id ||
      fn.id === decodedId ||
      fn.urn === id ||
      fn.urn === decodedId ||
      fn.name === id ||
      fn.name === decodedId,
  );

  if (!summary) {
    return null;
  }

  const functionUrn = encodeURIComponent(summary.urn || summary.id);
  const [configResult, codeResult] = await Promise.allSettled([
    huaweiFetch<Record<string, unknown>>(
      session,
      "fg",
      `/v2/${session.projectId}/fgs/functions/${functionUrn}/config`,
    ),
    huaweiFetch<Record<string, unknown>>(
      session,
      "fg",
      `/v2/${session.projectId}/fgs/functions/${functionUrn}/code`,
    ),
  ]);
  const config = configResult.status === "fulfilled" ? configResult.value : {};
  const code = codeResult.status === "fulfilled" ? codeResult.value : {};
  const merged = {
    ...summary,
    ...config,
    func_code: asRecord(code.func_code ?? code.code),
    code_text: firstString([code.code, code.code_text, code.source_code], summary.codeText),
    code_filename: firstString([code.code_filename, code.file], summary.codeFile),
    code_size: firstString([code.code_size], summary.codeSize),
    code_type: firstString([code.code_type, code.type], summary.codeType),
    code_url: firstString([code.code_url, code.link, code.location], summary.codeLink),
  };

  return parseFunctionGraphFunction(merged, session);
}

export async function listFunctionGraphFunctions(session: BetterUiSession) {
  return loadAcrossProjects(session, listFunctionGraphFunctionsForProject);
}

export async function getFunctionGraphFunction(session: BetterUiSession, id: string) {
  const results = await Promise.allSettled(
    sessionProjects(session).map((project) => getFunctionGraphFunctionForProject(project, id)),
  );

  return (
    results
      .filter((result): result is PromiseFulfilledResult<FunctionGraphFunction | null> =>
        result.status === "fulfilled",
      )
      .map((result) => result.value)
      .find(Boolean) ?? null
  );
}

async function listRdsInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "rds",
    `/v3/${session.projectId}/instances?limit=100`,
  );

  return asArray(body.instances).map((instance): RdsInstance => {
    const item = asRecord(instance);
    const datastore = asRecord(item.datastore);
    return {
      datastore: firstString([datastore.type, item.datastore_type]),
      id: asString(item.id),
      name: asString(item.name),
      privateIp: firstString(asArray(item.private_ips), "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      type: asString(item.type),
    };
  });
}

export async function getRdsInstance(session: BetterUiSession, id: string) {
  const instances = await listRdsInstances(session);
  return instances.find((instance) => instance.id === id) ?? null;
}

export async function listRdsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listRdsInstancesForProject);
}

function parseObsBuckets(xml: string): ObsBucket[] {
  return xmlBlocks(xml, "Bucket").map((bucket) => {
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
  }).filter((bucket) => bucket.name);
}

function parseObsObjects(xml: string): Pick<ObsBucketDetail, "commonPrefixes" | "isTruncated" | "objects"> {
  const objects = xmlBlocks(xml, "Contents").map((object): ObsObject => {
    const sizeBytes = Number(xmlTag(object, "Size", "0"));
    return {
      etag: xmlTag(object, "ETag", "-").replace(/^"|"$/g, ""),
      key: xmlTag(object, "Key"),
      lastModified: xmlTag(object, "LastModified", "-"),
      owner: xmlTag(xmlTag(object, "Owner"), "DisplayName", xmlTag(xmlTag(object, "Owner"), "ID", "-")),
      size: formatBytes(sizeBytes),
      sizeBytes,
      storageClass: xmlTag(object, "StorageClass", "-"),
    };
  }).filter((object) => object.key);

  return {
    commonPrefixes: xmlBlocks(xml, "CommonPrefixes").map((prefix) => xmlTag(prefix, "Prefix")).filter(Boolean),
    isTruncated: xmlTag(xml, "IsTruncated", "false") === "true",
    objects,
  };
}

function isTextPreviewType(contentType: string, key: string) {
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

function isImagePreviewType(contentType: string, key: string) {
  const type = contentType.toLowerCase();
  const lowerKey = key.toLowerCase();

  return (
    type.startsWith("image/") ||
    [".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"].some((extension) =>
      lowerKey.endsWith(extension),
    )
  );
}

function isPdfPreviewType(contentType: string, key: string) {
  return contentType.toLowerCase().includes("pdf") || key.toLowerCase().endsWith(".pdf");
}

function isAudioPreviewType(contentType: string, key: string) {
  const type = contentType.toLowerCase();
  const lowerKey = key.toLowerCase();

  return (
    type.startsWith("audio/") ||
    [".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".weba"].some((extension) =>
      lowerKey.endsWith(extension),
    )
  );
}

function isVideoPreviewType(contentType: string, key: string) {
  const type = contentType.toLowerCase();
  const lowerKey = key.toLowerCase();

  return (
    type.startsWith("video/") ||
    [".m4v", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm"].some((extension) =>
      lowerKey.endsWith(extension),
    )
  );
}

function getObsPreviewKind(contentType: string, key: string): ObsObjectDetail["previewKind"] {
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
  const bucketName = decodeURIComponent(name);
  const credential = await createObsCredential(session);
  const buckets = parseObsBuckets(await obsFetchXml(credential, session.region, "/"));
  const bucket = buckets.find((item) => item.name === bucketName);

  if (!bucket) {
    return null;
  }

  const region = bucket.location && bucket.location !== "-" ? bucket.location : session.region;
  const objectXml = await obsFetchXml(
    credential,
    region,
    "/?max-keys=1000&encoding-type=url",
    bucket.name,
  );
  const objectData = parseObsObjects(objectXml);
  const sizeBytes = objectData.objects.reduce((sum, object) => sum + object.sizeBytes, 0);

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
  const bucketName = decodeURIComponent(bucket);
  const objectKey = decodeURIComponent(key);
  const credential = await createObsCredential(session);
  const region = await findObsBucketRegion(session, credential, bucketName);
  const response = await obsObjectRequest({
    bucket: bucketName,
    key: objectKey,
    method: "GET",
    region,
    session,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${xmlTag(body, "Message", response.statusText)}`);
  }

  return {
    body: response.body,
    contentLength: response.headers.get("content-length"),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    filename: objectKey.split("/").filter(Boolean).at(-1) || objectKey || "download",
  };
}

export async function getObsObjectDetail(
  session: BetterUiSession,
  bucket: string,
  key: string,
) {
  const bucketName = decodeURIComponent(bucket);
  const objectKey = decodeURIComponent(key);
  const bucketDetail = await getObsBucket(session, bucketName);
  const listedObject = bucketDetail?.objects.find((object) => object.key === objectKey);
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
    session,
  });

  if (!response.ok && response.status !== 206) {
    const body = await response.text().catch(() => "");
    if (listedObject) {
      return {
        bucket: bucketName,
        contentLength: listedObject.size,
        contentType: "application/octet-stream",
        etag: listedObject.etag,
        key: objectKey,
        lastModified: listedObject.lastModified,
        owner: listedObject.owner,
        previewKind: "unsupported",
        previewText: "",
        size: listedObject.size,
        sizeBytes: listedObject.sizeBytes,
        storageClass: listedObject.storageClass,
      } satisfies ObsObjectDetail;
    }

    throw new Error(`${response.status} ${xmlTag(body, "Message", response.statusText)}`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const contentRange = response.headers.get("content-range") ?? "";
  const contentLength =
    contentRange.match(/\/(\d+)$/)?.[1] ??
    response.headers.get("content-length") ??
    listedObject?.sizeBytes.toString() ??
    "0";
  const previewKind = getObsPreviewKind(contentType, objectKey);
  const previewText =
    previewKind === "text" ? await response.text().catch(() => "") : "";

  return {
    bucket: bucketName,
    contentLength: formatBytes(contentLength),
    contentType,
    etag: listedObject?.etag ?? response.headers.get("etag")?.replace(/^"|"$/g, "") ?? "-",
    key: objectKey,
    lastModified: listedObject?.lastModified ?? response.headers.get("last-modified") ?? "-",
    owner: listedObject?.owner ?? "-",
    previewKind,
    previewText,
    size: listedObject?.size ?? formatBytes(contentLength),
    sizeBytes: Number(contentLength),
    storageClass: listedObject?.storageClass ?? response.headers.get("x-obs-storage-class") ?? "-",
  } satisfies ObsObjectDetail;
}

export async function uploadObsObject(
  session: BetterUiSession,
  bucket: string,
  key: string,
  file: File,
) {
  const bucketName = decodeURIComponent(bucket);
  const objectKey = key.trim();

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
    session,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${xmlTag(body, "Message", response.statusText)}`);
  }
}

export async function loadCloudSummary() {
  return withCloudResult(emptySummary, async (session) => {
    const [ecs, evs, vpcs, subnets, securityGroups, elbs, cce, rds] =
      await Promise.allSettled([
        listEcsInstances(session),
        listEvsDisks(session),
        listVpcs(session),
        listSubnets(session),
        listSecurityGroups(session),
        listElbs(session),
        listCceClusters(session),
        listRdsInstances(session),
      ]);

    const errors = [
      ecs,
      evs,
      vpcs,
      subnets,
      securityGroups,
      elbs,
      cce,
      rds,
    ]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => normalizeError(result.reason));

    const ecsData = ecs.status === "fulfilled" ? ecs.value : [];

    return {
      cceClusters: cce.status === "fulfilled" ? cce.value.length : 0,
      ecsInstances: ecsData.length,
      ecsRunning: ecsData.filter((instance) => instance.status === "ACTIVE").length,
      elbLoadBalancers: elbs.status === "fulfilled" ? elbs.value.length : 0,
      errors,
      evsDisks: evs.status === "fulfilled" ? evs.value.length : 0,
      rdsInstances: rds.status === "fulfilled" ? rds.value.length : 0,
      securityGroups:
        securityGroups.status === "fulfilled" ? securityGroups.value.length : 0,
      subnets: subnets.status === "fulfilled" ? subnets.value.length : 0,
      vpcs: vpcs.status === "fulfilled" ? vpcs.value.length : 0,
    };
  }, "cloud-summary");
}
