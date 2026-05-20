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
  | "apig"
  | "bms"
  | "cbr"
  | "cdn"
  | "cce"
  | "ces"
  | "cci"
  | "cts"
  | "dcs"
  | "dds"
  | "dc"
  | "deh"
  | "dew"
  | "dms"
  | "dns"
  | "drs"
  | "ecs"
  | "eip"
  | "elb"
  | "er"
  | "evs"
  | "fg"
  | "gaussdb"
  | "geminidb"
  | "hss"
  | "ims"
  | "lts"
  | "modelarts"
  | "nat"
  | "dli"
  | "dws"
  | "css"
  | "mrs"
  | "rds"
  | "sfs"
  | "smn"
  | "taurusdb"
  | "vpn"
  | "vpcep"
  | "waf"
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

export type EipItem = {
  associatedInstanceId: string;
  associatedInstanceType: string;
  bandwidthName: string;
  bandwidthSize: string;
  createdAt: string;
  id: string;
  ipAddress: string;
  name: string;
  privateIpAddress: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  type: string;
};

export type NatGateway = {
  createdAt: string;
  description: string;
  enterpriseProjectId: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  routerId: string;
  spec: string;
  status: string;
  subnetId: string;
  type: string;
  vpcId: string;
};

export type VpnConnection = {
  cgwId: string;
  connectionMonitorId: string;
  createdAt: string;
  customerGatewayId: string;
  enterpriseProjectId: string;
  haRole: string;
  id: string;
  localSubnets: string;
  name: string;
  peerSubnets: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  style: string;
  tunnelLocalAddress: string;
  tunnelPeerAddress: string;
  updatedAt: string;
  vgwId: string;
  vgwIp: string;
  vpnGatewayId: string;
};

export type DirectConnectConnection = {
  adminState: string;
  bandwidth: string;
  createdAt: string;
  deviceId: string;
  id: string;
  location: string;
  name: string;
  peerLocation: string;
  portType: string;
  projectId: string;
  projectName: string;
  provider: string;
  providerStatus: string;
  region: string;
  status: string;
  type: string;
  vlan: string;
};

export type EnterpriseRouter = {
  asn: string;
  autoAcceptSharedAttachments: string;
  createdAt: string;
  defaultAssociation: string;
  defaultPropagation: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  routeTableId: string;
  status: string;
  updatedAt: string;
};

export type VpcEndpoint = {
  createdAt: string;
  dnsEnabled: string;
  endpointServiceName: string;
  id: string;
  ip: string;
  markerId: string;
  networkId: string;
  projectId: string;
  projectName: string;
  region: string;
  serviceType: string;
  status: string;
  subnetId: string;
  vpcId: string;
};

export type BmsServer = {
  availabilityZone: string;
  flavor: string;
  id: string;
  image: string;
  keyName: string;
  name: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  publicIp: string;
  region: string;
  status: string;
  systemDisk: string;
  updatedAt: string;
};

export type DedicatedHost = {
  availabilityZone: string;
  availableMemory: string;
  availableVcpus: string;
  hostProperties: string;
  hostType: string;
  id: string;
  instanceCount: number;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  totalMemory: string;
  totalVcpus: string;
};

export type CciNamespace = {
  createdAt: string;
  id: string;
  name: string;
  phase: string;
  podCount: number;
  projectId: string;
  projectName: string;
  readyContainers: number;
  region: string;
  restartCount: number;
  runningPods: number;
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

export type DrsJob = {
  createdAt: string;
  destination: string;
  direction: string;
  engineType: string;
  id: string;
  jobType: string;
  name: string;
  networkType: string;
  projectId: string;
  projectName: string;
  region: string;
  source: string;
  status: string;
};

export type GaussDbInstance = {
  availabilityZone: string;
  backupWindow: string;
  datastore: string;
  id: string;
  mode: string;
  name: string;
  nodes: number;
  port: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  type: string;
};

export type DdsInstance = {
  availabilityZone: string;
  backupWindow: string;
  datastore: string;
  id: string;
  mode: string;
  name: string;
  nodes: number;
  port: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  vpcId: string;
};

export type TaurusDbInstance = {
  availabilityZone: string;
  backupWindow: string;
  datastore: string;
  id: string;
  mode: string;
  name: string;
  nodes: number;
  port: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  vpcId: string;
};

export type GeminiDbInstance = {
  apiType: string;
  backupWindow: string;
  datastore: string;
  groupCount: number;
  id: string;
  mode: string;
  name: string;
  nodeCount: number;
  privateIp: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  vpcId: string;
};

export type DnsZone = {
  createdAt: string;
  description: string;
  id: string;
  name: string;
  projectId: string;
  recordCount: number;
  status: string;
  ttl: string;
  type: string;
  updatedAt: string;
};

export type CdnDomain = {
  businessType: string;
  cname: string;
  createdAt: string;
  domainName: string;
  id: string;
  originHost: string;
  region: string;
  serviceArea: string;
  status: string;
  updatedAt: string;
};

export type ApigInstance = {
  createdAt: string;
  edition: string;
  eipAddress: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  subnetId: string;
  version: string;
  vpcId: string;
};

export type DmsKafkaInstance = {
  availabilityZones: string;
  brokerCount: number;
  connectAddress: string;
  createdAt: string;
  engineVersion: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  subnetId: string;
  vpcId: string;
};

export type DcsRedisInstance = {
  capacity: string;
  createdAt: string;
  engine: string;
  engineVersion: string;
  id: string;
  ip: string;
  mode: string;
  name: string;
  port: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  usedMemory: string;
  vpcId: string;
};

export type WafInstance = {
  accessCode: string;
  accessStatus: string;
  createdAt: string;
  hostname: string;
  id: string;
  policyId: string;
  projectId: string;
  projectName: string;
  protectStatus: string;
  proxy: string;
  region: string;
};

export type DewKey = {
  alias: string;
  createdAt: string;
  id: string;
  keyId: string;
  keyState: string;
  keyType: string;
  origin: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type HssHost = {
  agentStatus: string;
  baselineRiskCount: number;
  detectResult: string;
  groupName: string;
  id: string;
  intrusionCount: number;
  name: string;
  os: string;
  policyGroupName: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  publicIp: string;
  region: string;
  riskCount: number;
  version: string;
  vulnerabilityCount: number;
};

export type SmnTopic = {
  createdAt: string;
  displayName: string;
  enterpriseProjectId: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  pushPolicy: string;
  region: string;
  topicUrn: string;
  updatedAt: string;
};

export type ModelArtsNotebook = {
  createdAt: string;
  flavor: string;
  id: string;
  image: string;
  name: string;
  pool: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  workspaceId: string;
};

export type DliQueue = {
  chargingMode: string;
  cuCount: number;
  description: string;
  engine: string;
  name: string;
  owner: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  type: string;
};

export type MrsCluster = {
  billingType: string;
  components: string;
  createdAt: string;
  coreNodes: number;
  hadoopVersion: string;
  id: string;
  masterNodes: number;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  totalNodes: number;
  vpcId: string;
};

export type DwsCluster = {
  availabilityZone: string;
  createdAt: string;
  endpoint: string;
  id: string;
  name: string;
  nodeType: string;
  nodes: number;
  port: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  version: string;
};

export type CssCluster = {
  createdAt: string;
  datastore: string;
  endpoint: string;
  id: string;
  name: string;
  nodeCount: number;
  nodeSpec: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
};

export type CbrVault = {
  allocated: string;
  autoBind: string;
  createdAt: string;
  id: string;
  name: string;
  objectType: string;
  projectId: string;
  projectName: string;
  providerId: string;
  region: string;
  resources: number;
  size: string;
  status: string;
};

export type SfsShare = {
  availabilityZone: string;
  createdAt: string;
  exportLocation: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  protocol: string;
  region: string;
  shareType: string;
  size: string;
  status: string;
};

export type ImsImage = {
  createdAt: string;
  id: string;
  imageType: string;
  minDisk: string;
  name: string;
  os: string;
  projectId: string;
  projectName: string;
  region: string;
  size: string;
  status: string;
  visibility: string;
};

export type IamUser = {
  description: string;
  domainId: string;
  enabled: string;
  id: string;
  name: string;
  passwordExpiresAt: string;
};

export type CtsTracker = {
  bucketName: string;
  filePrefix: string;
  id: string;
  isLtsEnabled: string;
  ltsGroupId: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
};

export type CtsTrace = {
  code: string;
  id: string;
  recordedAt: string;
  resourceName: string;
  resourceType: string;
  serviceType: string;
  sourceIp: string;
  traceName: string;
  traceRating: string;
  traceType: string;
  userName: string;
};

export type LtsLogGroup = {
  alias: string;
  createdAt: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  tags: number;
  ttlDays: string;
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
  apig: "HUAWEI_APIG_ENDPOINT",
  bms: "HUAWEI_BMS_ENDPOINT",
  cbr: "HUAWEI_CBR_ENDPOINT",
  cdn: "HUAWEI_CDN_ENDPOINT",
  cce: "HUAWEI_CCE_ENDPOINT",
  ces: "HUAWEI_CES_ENDPOINT",
  cci: "HUAWEI_CCI_ENDPOINT",
  cts: "HUAWEI_CTS_ENDPOINT",
  dcs: "HUAWEI_DCS_ENDPOINT",
  dds: "HUAWEI_DDS_ENDPOINT",
  dc: "HUAWEI_DIRECT_CONNECT_ENDPOINT",
  deh: "HUAWEI_DEH_ENDPOINT",
  dew: "HUAWEI_DEW_ENDPOINT",
  dms: "HUAWEI_DMS_ENDPOINT",
  dns: "HUAWEI_DNS_ENDPOINT",
  drs: "HUAWEI_DRS_ENDPOINT",
  ecs: "HUAWEI_ECS_ENDPOINT",
  eip: "HUAWEI_EIP_ENDPOINT",
  elb: "HUAWEI_ELB_ENDPOINT",
  er: "HUAWEI_ENTERPRISE_ROUTER_ENDPOINT",
  evs: "HUAWEI_EVS_ENDPOINT",
  fg: "HUAWEI_FUNCTIONGRAPH_ENDPOINT",
  gaussdb: "HUAWEI_GAUSSDB_ENDPOINT",
  geminidb: "HUAWEI_GEMINIDB_ENDPOINT",
  hss: "HUAWEI_HSS_ENDPOINT",
  ims: "HUAWEI_IMS_ENDPOINT",
  lts: "HUAWEI_LTS_ENDPOINT",
  modelarts: "HUAWEI_MODELARTS_ENDPOINT",
  nat: "HUAWEI_NAT_ENDPOINT",
  dli: "HUAWEI_DLI_ENDPOINT",
  dws: "HUAWEI_DWS_ENDPOINT",
  css: "HUAWEI_CSS_ENDPOINT",
  mrs: "HUAWEI_MRS_ENDPOINT",
  rds: "HUAWEI_RDS_ENDPOINT",
  sfs: "HUAWEI_SFS_ENDPOINT",
  smn: "HUAWEI_SMN_ENDPOINT",
  taurusdb: "HUAWEI_TAURUSDB_ENDPOINT",
  vpn: "HUAWEI_VPN_ENDPOINT",
  vpcep: "HUAWEI_VPCEP_ENDPOINT",
  waf: "HUAWEI_WAF_ENDPOINT",
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
  const globalServiceEndpoint: Partial<Record<ServiceKey, string>> = {
    cdn: "https://cdn.myhuaweicloud.com",
    dns: "https://dns.myhuaweicloud.com",
  };
  const regionalServiceHost: Partial<Record<ServiceKey, string>> = {
    dc: "dc",
    fg: "functiongraph",
    gaussdb: "gaussdb-opengauss",
    geminidb: "gaussdb-nosql",
    vpcep: "vpcep",
    taurusdb: "gaussdb-mysql",
  };
  const defaultService = regionalServiceHost[service] ?? service;

  return (
    process.env[endpointEnv[service]] ??
    globalServiceEndpoint[service] ??
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

async function huaweiAccountFetch<T>(
  session: BetterUiSession,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${session.iamEndpoint.replace(/\/+$/, "")}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json;charset=utf8",
      "X-Auth-Token": session.token,
      ...init?.headers,
    },
  });

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

async function listCbrVaultsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ vaults?: unknown[] }>(
    session,
    "cbr",
    `/v3/${session.projectId}/vaults?limit=1000`,
  );

  return asArray(body.vaults).map((vault): CbrVault => {
    const item = asRecord(vault);
    const billing = asRecord(item.billing);
    const resources = asArray(item.resources);

    return {
      allocated: formatBytes(billing.allocated),
      autoBind: String(item.auto_bind ?? "-"),
      createdAt: firstString([item.created_at, item.createdAt]),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      objectType: firstString([billing.object_type, item.object_type]),
      projectId: session.projectId,
      projectName: session.projectName,
      providerId: asString(item.provider_id, "-"),
      region: session.region,
      resources: resources.length,
      size: formatBytes(billing.size),
      status: asString(item.status, "UNKNOWN"),
    };
  });
}

export async function listCbrVaults(session: BetterUiSession) {
  return loadAcrossProjects(session, listCbrVaultsForProject);
}

async function listSfsSharesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ shares?: unknown[] }>(
    session,
    "sfs",
    `/v2/${session.projectId}/shares/detail?limit=100`,
    {
      headers: {
        Accept: "application/json",
        "X-Openstack-Manila-Api-Version": "2.9",
      },
    },
  );

  return asArray(body.shares).map((share): SfsShare => {
    const item = asRecord(share);
    const exportLocations = asArray(item.export_locations);
    const firstExport = asRecord(exportLocations[0]);

    return {
      availabilityZone: asString(item.availability_zone),
      createdAt: firstString([item.created_at, item.createdAt]),
      exportLocation: firstString([item.export_location, firstExport.path, firstExport.export_location], "-"),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      protocol: asString(item.share_proto),
      region: session.region,
      shareType: firstString([item.share_type, item.share_type_name]),
      size: `${Number(item.size ?? 0)} GB`,
      status: asString(item.status, "UNKNOWN"),
    };
  });
}

export async function listSfsShares(session: BetterUiSession) {
  return loadAcrossProjects(session, listSfsSharesForProject);
}

async function listImagesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ images?: unknown[] }>(
    session,
    "ims",
    "/v2/cloudimages?__imagetype=private&limit=100&sort_key=created_at&sort_dir=desc",
  );

  return asArray(body.images).map((image): ImsImage => {
    const item = asRecord(image);

    return {
      createdAt: firstString([item.created_at, item.createdAt]),
      id: asString(item.id),
      imageType: firstString([item.__imagetype, item.imagetype, item.image_type]),
      minDisk: `${Number(item.min_disk ?? 0)} GB`,
      name: firstString([item.name, item.id]),
      os: firstString([item.__os_version, item.os_version, item.__os_type, item.os_type]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      size: formatBytes(item.size),
      status: asString(item.status, "UNKNOWN"),
      visibility: asString(item.visibility, "-"),
    };
  });
}

export async function listImages(session: BetterUiSession) {
  return loadAcrossProjects(session, listImagesForProject);
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

async function listEipsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ publicips?: unknown[] }>(
    session,
    "eip",
    `/v3/${session.projectId}/eip/publicips?limit=2000`,
  );

  return asArray(body.publicips).map((publicIp): EipItem => {
    const item = asRecord(publicIp);
    const bandwidth = asRecord(item.bandwidth);
    const associate = asRecord(item.associate_instance_info);

    return {
      associatedInstanceId: firstString([item.associate_instance_id, associate.instance_id], ""),
      associatedInstanceType: firstString([item.associate_instance_type, associate.instance_type], ""),
      bandwidthName: asString(bandwidth.name, "-"),
      bandwidthSize: bandwidth.size ? `${bandwidth.size} Mbit/s` : "-",
      createdAt: firstString([item.created_at, item.createdAt]),
      id: asString(item.id),
      ipAddress: firstString([item.public_ip_address, item.publicip_address]),
      name: firstString([item.alias, item.name, item.public_ip_address, item.id]),
      privateIpAddress: asString(item.private_ip_address, "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      type: firstString([item.type, item.ip_version], "-"),
    };
  });
}

export async function listEips(session: BetterUiSession) {
  return loadAcrossProjects(session, listEipsForProject);
}

async function listNatGatewaysForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ nat_gateways?: unknown[] }>(
    session,
    "nat",
    `/v2/${session.projectId}/nat_gateways?limit=1000`,
  );

  return asArray(body.nat_gateways).map((gateway): NatGateway => {
    const item = asRecord(gateway);

    return {
      createdAt: firstString([item.created_at, item.createdAt]),
      description: asString(item.description, ""),
      enterpriseProjectId: asString(item.enterprise_project_id, "-"),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      routerId: firstString([item.router_id, item.vpc_id]),
      spec: firstString([item.spec, item.specification], "-"),
      status: asString(item.status, "UNKNOWN"),
      subnetId: firstString([item.internal_network_id, item.network_id, item.subnet_id]),
      type: firstString([item.type, item.gateway_type], "-"),
      vpcId: firstString([item.vpc_id, item.router_id]),
    };
  });
}

export async function listNatGateways(session: BetterUiSession) {
  return loadAcrossProjects(session, listNatGatewaysForProject);
}

async function listVpnConnectionsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ vpn_connections?: unknown[] }>(
    session,
    "vpn",
    `/v5/${session.projectId}/vpn-connection`,
  );

  return asArray(body.vpn_connections).map((connection): VpnConnection => {
    const item = asRecord(connection);
    const policyRules = asArray(item.policy_rules);
    const firstRule = asRecord(policyRules[0]);
    const localSubnets = asArray(firstRule.local_subnets ?? item.local_subnets)
      .map((value) => String(value))
      .join(", ");
    const peerSubnets = asArray(firstRule.peer_subnets ?? item.peer_subnets)
      .map((value) => String(value))
      .join(", ");

    return {
      cgwId: firstString([item.cgw_id, item.customer_gateway_id]),
      connectionMonitorId: firstString([item.connection_monitor_id, item.monitor_id], "-"),
      createdAt: firstString([item.created_at, item.createdAt]),
      customerGatewayId: firstString([item.cgw_id, item.customer_gateway_id]),
      enterpriseProjectId: asString(item.enterprise_project_id, "-"),
      haRole: asString(item.ha_role, "-"),
      id: asString(item.id),
      localSubnets: localSubnets || "-",
      name: firstString([item.name, item.id]),
      peerSubnets: peerSubnets || "-",
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      style: asString(item.style, "-"),
      tunnelLocalAddress: firstString([item.tunnel_local_address, item.local_gateway_ip], "-"),
      tunnelPeerAddress: firstString([item.tunnel_peer_address, item.peer_gateway_ip], "-"),
      updatedAt: firstString([item.updated_at, item.created_at, item.createdAt]),
      vgwId: firstString([item.vgw_id, item.vpn_gateway_id]),
      vgwIp: firstString([item.vgw_ip, item.gateway_ip], "-"),
      vpnGatewayId: firstString([item.vgw_id, item.vpn_gateway_id]),
    };
  });
}

export async function listVpnConnections(session: BetterUiSession) {
  return loadAcrossProjects(session, listVpnConnectionsForProject);
}

async function listDirectConnectConnectionsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ direct_connects?: unknown[] }>(
    session,
    "dc",
    `/v3/${session.projectId}/dcaas/direct-connects`,
  );

  return asArray(body.direct_connects).map((connection): DirectConnectConnection => {
    const item = asRecord(connection);

    return {
      adminState: String(item.admin_state_up ?? "-"),
      bandwidth: item.bandwidth ? `${item.bandwidth} Mbit/s` : "-",
      createdAt: firstString([item.create_time, item.created_at, item.apply_time]),
      deviceId: firstString([item.device_id, item.hosting_id], "-"),
      id: asString(item.id),
      location: firstString([item.location, item.public_border_group], "-"),
      name: firstString([item.name, item.id]),
      peerLocation: firstString([item.peer_location, item.peer_provider], "-"),
      portType: firstString([item.port_type, item.peer_port_type, item.spec_code], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      provider: firstString([item.provider, item.peer_provider], "-"),
      providerStatus: firstString([item.provider_status, item.onestopdc_status], "-"),
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      type: firstString([item.type, item.charge_mode], "-"),
      vlan: String(item.vlan ?? "-"),
    };
  });
}

export async function listDirectConnectConnections(session: BetterUiSession) {
  return loadAcrossProjects(session, listDirectConnectConnectionsForProject);
}

async function listEnterpriseRoutersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "er",
    `/v3/${session.projectId}/enterprise-router/instances?limit=2000`,
  );

  return asArray(body.instances).map((router): EnterpriseRouter => {
    const item = asRecord(router);

    return {
      asn: String(item.asn ?? "-"),
      autoAcceptSharedAttachments: String(item.auto_accept_shared_attachments ?? "-"),
      createdAt: firstString([item.created_at, item.createdAt]),
      defaultAssociation: String(item.enable_default_association ?? "-"),
      defaultPropagation: String(item.enable_default_propagation ?? "-"),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      routeTableId: firstString(
        [
          item.default_association_route_table_id,
          item.default_propagation_route_table_id,
        ],
        "-",
      ),
      status: firstString([item.state, item.status], "UNKNOWN"),
      updatedAt: firstString([item.updated_at, item.created_at, item.createdAt]),
    };
  });
}

export async function listEnterpriseRouters(session: BetterUiSession) {
  return loadAcrossProjects(session, listEnterpriseRoutersForProject);
}

async function listVpcEndpointsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ endpoints?: unknown[] }>(
    session,
    "vpcep",
    `/v1/${session.projectId}/vpc-endpoints?limit=1000`,
  );

  return asArray(body.endpoints).map((endpoint): VpcEndpoint => {
    const item = asRecord(endpoint);

    return {
      createdAt: firstString([item.created_at, item.createdAt]),
      dnsEnabled: String(item.enable_dns ?? "-"),
      endpointServiceName: firstString([item.endpoint_service_name, item.service_name], "-"),
      id: asString(item.id),
      ip: firstString([item.ip, item.private_ip_address], "-"),
      markerId: String(item.marker_id ?? "-"),
      networkId: firstString([item.network_id, item.port_id], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      serviceType: firstString([item.service_type, item.endpoint_type], "-"),
      status: asString(item.status, "UNKNOWN"),
      subnetId: asString(item.subnet_id, "-"),
      vpcId: asString(item.vpc_id, "-"),
    };
  });
}

export async function listVpcEndpoints(session: BetterUiSession) {
  return loadAcrossProjects(session, listVpcEndpointsForProject);
}

async function listBmsServersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ servers?: unknown[]; baremetalservers?: unknown[] }>(
    session,
    "bms",
    `/v1/${session.projectId}/baremetalservers/detail`,
  );

  return asArray(body.servers ?? body.baremetalservers).map((server): BmsServer => {
    const item = asRecord(server);
    const flavor = asRecord(item.flavor);
    const image = asRecord(item.image);
    const metadata = asRecord(item.metadata);
    const rootDevice = firstString([metadata.root_device_name, item.root_device_name], "-");

    return {
      availabilityZone: firstString(
        [item["OS-EXT-AZ:availability_zone"], item.availability_zone],
        "-",
      ),
      flavor: firstString([flavor.name, flavor.id, item.flavorRef], "-"),
      id: asString(item.id),
      image: firstString([image.name, image.id, item.imageRef], "-"),
      keyName: firstString([item.key_name, item.keypair_name], "-"),
      name: firstString([item.name, item.id]),
      privateIp: firstIp(item.addresses, "private"),
      projectId: session.projectId,
      projectName: session.projectName,
      publicIp: firstIp(item.addresses, "public"),
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      systemDisk: rootDevice,
      updatedAt: firstString([item.updated, item.updated_at, item.created]),
    };
  });
}

export async function listBmsServers(session: BetterUiSession) {
  return loadAcrossProjects(session, listBmsServersForProject);
}

async function listDedicatedHostsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ dedicated_hosts?: unknown[] }>(
    session,
    "deh",
    `/v1.0/${session.projectId}/dedicated-hosts`,
  );

  return asArray(body.dedicated_hosts).map((host): DedicatedHost => {
    const item = asRecord(host);
    const properties = asRecord(item.host_properties);
    const available = asRecord(item.available_resource);

    return {
      availabilityZone: firstString([item.availability_zone, item.az], "-"),
      availableMemory: numberWithUnit(available.memory ?? item.available_memory, "MB"),
      availableVcpus: String(available.vcpus ?? item.available_vcpus ?? "-"),
      hostProperties: [
        properties.cpu,
        properties.memory ? `${properties.memory} MB` : "",
      ].filter(Boolean).join(" / ") || "-",
      hostType: firstString([item.host_type, properties.host_type], "-"),
      id: asString(item.dedicated_host_id ?? item.id),
      instanceCount: asArray(item.instance_total ?? item.instances).length || Number(item.instance_total ?? 0),
      name: firstString([item.name, item.dedicated_host_id, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.state ?? item.status, "UNKNOWN"),
      totalMemory: numberWithUnit(properties.memory ?? item.memory, "MB"),
      totalVcpus: String(properties.vcpus ?? item.vcpus ?? "-"),
    };
  });
}

export async function listDedicatedHosts(session: BetterUiSession) {
  return loadAcrossProjects(session, listDedicatedHostsForProject);
}

function podContainerSummary(pods: unknown[]) {
  return pods.reduce<{
    readyContainers: number;
    restartCount: number;
    runningPods: number;
  }>(
    (summary, pod) => {
      const status = asRecord(asRecord(pod).status);
      const containerStatuses = asArray(status.containerStatuses);
      const restartCount = containerStatuses.reduce((total, container) => {
        const item = asRecord(container);
        return total + Number(item.restartCount ?? 0);
      }, 0);
      const readyContainers = containerStatuses.filter(
        (container) => asRecord(container).ready === true,
      ).length;

      return {
        readyContainers: summary.readyContainers + readyContainers,
        restartCount: summary.restartCount + restartCount,
        runningPods:
          summary.runningPods + (String(status.phase ?? "").toLowerCase() === "running" ? 1 : 0),
      };
    },
    { readyContainers: 0, restartCount: 0, runningPods: 0 },
  );
}

async function listCciNamespacesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ items?: unknown[] }>(
    session,
    "cci",
    "/apis/cci/v2/namespaces",
  );

  const namespaces = asArray(body.items);
  const podsByNamespace = await Promise.all(
    namespaces.map(async (namespace) => {
      const metadata = asRecord(asRecord(namespace).metadata);
      const name = asString(metadata.name, "");

      if (!name) {
        return [] as unknown[];
      }

      const podBody = await huaweiFetch<{ items?: unknown[] }>(
        session,
        "cci",
        `/apis/cci/v2/namespaces/${encodeURIComponent(name)}/pods`,
      ).catch(() => ({ items: [] }));

      return asArray(podBody.items);
    }),
  );

  return namespaces.map((namespace, index): CciNamespace => {
    const item = asRecord(namespace);
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const pods = podsByNamespace[index] ?? [];
    const summary = podContainerSummary(pods);

    return {
      createdAt: firstString([metadata.creationTimestamp, item.creationTimestamp]),
      id: firstString([metadata.uid, metadata.name]),
      name: asString(metadata.name),
      phase: asString(status.phase, "UNKNOWN"),
      podCount: pods.length,
      projectId: session.projectId,
      projectName: session.projectName,
      readyContainers: summary.readyContainers,
      region: session.region,
      restartCount: summary.restartCount,
      runningPods: summary.runningPods,
    };
  });
}

export async function listCciNamespaces(session: BetterUiSession) {
  return loadAcrossProjects(session, listCciNamespacesForProject);
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

async function listDrsJobsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ jobs?: unknown[] }>(
    session,
    "drs",
    `/v5/${session.projectId}/jobs?limit=100`,
  );

  return asArray(body.jobs).map((job): DrsJob => {
    const item = asRecord(job);
    const sourceEndpoint = asRecord(item.source_endpoint ?? item.source);
    const targetEndpoint = asRecord(item.target_endpoint ?? item.destination ?? item.target);

    return {
      createdAt: firstString([item.created_at, item.create_time, item.createdAt]),
      destination: firstString([targetEndpoint.db_type, targetEndpoint.endpoint_type, targetEndpoint.name, item.target_db_type], "-"),
      direction: firstString([item.db_use_type, item.direction], "-"),
      engineType: firstString([item.engine_type, item.engine, item.migration_type], "-"),
      id: firstString([item.id, item.job_id]),
      jobType: firstString([item.job_type, item.type], "-"),
      name: firstString([item.name, item.job_name, item.id]),
      networkType: firstString([item.net_type, item.network_type], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      source: firstString([sourceEndpoint.db_type, sourceEndpoint.endpoint_type, sourceEndpoint.name, item.source_db_type], "-"),
      status: firstString([item.status, item.job_status], "UNKNOWN"),
    };
  });
}

export async function listDrsJobs(session: BetterUiSession) {
  return loadAcrossProjects(session, listDrsJobsForProject);
}

function nodeCount(value: unknown) {
  return asArray(value).length || Number(value ?? 0) || 0;
}

function firstIpFromValues(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }

    const array = asArray(value);
    if (array.length) {
      const match = array.find((item) => typeof item === "string" && item.trim());
      if (typeof match === "string") {
        return match;
      }
    }
  }

  return "-";
}

function backupWindow(value: unknown) {
  const strategy = asRecord(value);
  return firstString([strategy.start_time, strategy.period, strategy.keep_days], "-");
}

function parseRelationalDbInstance(
  instance: unknown,
  session: HuaweiProjectSession,
): GaussDbInstance {
  const item = asRecord(instance);
  const datastore = asRecord(item.datastore);
  const volume = asRecord(item.volume);
  const backupStrategy = item.backup_strategy ?? item.backupStrategy;

  return {
    availabilityZone: firstString([item.az_code, item.availability_zone, item.availability_zone_mode], "-"),
    backupWindow: backupWindow(backupStrategy),
    datastore: [datastore.type, datastore.version].filter(Boolean).join(" ") || "-",
    id: firstString([item.id, item.instance_id]),
    mode: firstString([item.mode, item.ha_mode, item.instance_mode], "-"),
    name: firstString([item.name, item.instance_name, item.id]),
    nodes: nodeCount(item.nodes ?? item.node_count),
    port: String(item.port ?? item.db_port ?? "-"),
    privateIp: firstIpFromValues([item.private_ips, item.private_ip, item.private_ip_address]),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    status: firstString([item.status, item.instance_status], "UNKNOWN"),
    storage: numberWithUnit(volume.size ?? item.volume_size ?? item.storage_size, "GB"),
    type: firstString([item.type, item.instance_type, item.flavor_ref], "-"),
  };
}

async function listGaussDbInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "gaussdb",
    `/v3/${session.projectId}/instances?limit=100`,
  );

  return asArray(body.instances).map((instance) =>
    parseRelationalDbInstance(instance, session),
  );
}

export async function listGaussDbInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listGaussDbInstancesForProject);
}

async function listDdsInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "dds",
    `/v3/${session.projectId}/instances?limit=100`,
  );

  return asArray(body.instances).map((instance): DdsInstance => {
    const item = asRecord(instance);
    const datastore = asRecord(item.datastore);
    const volume = asRecord(item.volume);

    return {
      availabilityZone: firstString([item.az_code, item.availability_zone, item.availability_zone_mode], "-"),
      backupWindow: backupWindow(item.backup_strategy),
      datastore: [datastore.type, datastore.version].filter(Boolean).join(" ") || "DDS",
      id: firstString([item.id, item.instance_id]),
      mode: firstString([item.mode, item.instance_mode, item.type], "-"),
      name: firstString([item.name, item.instance_name, item.id]),
      nodes: nodeCount(item.nodes ?? item.groups),
      port: String(item.port ?? item.db_port ?? "-"),
      privateIp: firstIpFromValues([item.private_ips, item.private_ip, item.private_ip_address]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.status, item.instance_status], "UNKNOWN"),
      storage: numberWithUnit(volume.size ?? item.volume_size ?? item.storage_size, "GB"),
      vpcId: firstString([item.vpc_id, item.vpcId], "-"),
    };
  });
}

export async function listDdsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDdsInstancesForProject);
}

async function listTaurusDbInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "taurusdb",
    `/v3/${session.projectId}/instances?limit=100`,
  );

  return asArray(body.instances).map((instance): TaurusDbInstance => {
    const parsed = parseRelationalDbInstance(instance, session);
    const item = asRecord(instance);

    return {
      ...parsed,
      datastore: parsed.datastore === "-" ? "TaurusDB" : parsed.datastore,
      vpcId: firstString([item.vpc_id, item.vpcId], "-"),
    };
  });
}

export async function listTaurusDbInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listTaurusDbInstancesForProject);
}

async function listGeminiDbInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "geminidb",
    `/v3/${session.projectId}/instances?limit=100`,
  );

  return asArray(body.instances).map((instance): GeminiDbInstance => {
    const item = asRecord(instance);
    const datastore = asRecord(item.datastore);
    const groups = asArray(item.groups);
    const groupNodes = groups.reduce((total, group) => {
      const record = asRecord(group);
      return total + asArray(record.nodes).length;
    }, 0);
    const firstGroup = asRecord(groups[0]);
    const volume = asRecord(item.volume ?? firstGroup.volume);

    return {
      apiType: firstString([datastore.type, item.datastore_type, item.type], "-"),
      backupWindow: backupWindow(item.backup_strategy),
      datastore: [datastore.type, datastore.version].filter(Boolean).join(" ") || "-",
      groupCount: groups.length,
      id: firstString([item.id, item.instance_id]),
      mode: firstString([item.mode, item.instance_mode], "-"),
      name: firstString([item.name, item.instance_name, item.id]),
      nodeCount: groupNodes || nodeCount(item.nodes ?? item.node_count),
      privateIp: firstIpFromValues([item.private_ips, item.private_ip, item.private_ip_address]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.status, item.instance_status], "UNKNOWN"),
      storage: numberWithUnit(volume.size ?? item.volume_size ?? item.storage_size, "GB"),
      vpcId: firstString([item.vpc_id, item.vpcId], "-"),
    };
  });
}

export async function listGeminiDbInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listGeminiDbInstancesForProject);
}

export async function listDnsZones(session: BetterUiSession) {
  const project = sessionProjects(session)[0];
  const body = await huaweiFetch<{ zones?: unknown[] }>(
    project,
    "dns",
    "/v2/zones?type=public&limit=500",
  );

  return asArray(body.zones).map((zone): DnsZone => {
    const item = asRecord(zone);

    return {
      createdAt: firstString([item.created_at, item.createdAt]),
      description: asString(item.description, ""),
      id: asString(item.id),
      name: asString(item.name),
      projectId: asString(item.project_id, project.projectId),
      recordCount: Number(item.record_num ?? 0),
      status: asString(item.status, "UNKNOWN"),
      ttl: String(item.ttl ?? "-"),
      type: asString(item.zone_type, "public"),
      updatedAt: firstString([item.updated_at, item.updatedAt]),
    };
  });
}

export async function listCdnDomains(session: BetterUiSession) {
  const project = sessionProjects(session)[0];
  const body = await huaweiFetch<{ domains?: unknown[] }>(
    project,
    "cdn",
    "/v1.0/cdn/domains?page_size=100&page_number=1",
  );

  return asArray(body.domains).map((domain): CdnDomain => {
    const item = asRecord(domain);
    const originHost = asRecord(item.origin_host);

    return {
      businessType: asString(item.business_type, "-"),
      cname: firstString([item.cname, item.cname_target], "-"),
      createdAt: firstString([item.create_time, item.created_at, item.createdAt]),
      domainName: firstString([item.domain_name, item.name]),
      id: firstString([item.id, item.domain_id, item.domain_name]),
      originHost: firstString([originHost.domain_name, item.origin_host, item.origin_host_name], "-"),
      region: project.region,
      serviceArea: asString(item.service_area, "-"),
      status: asString(item.domain_status, "UNKNOWN"),
      updatedAt: firstString([item.update_time, item.updated_at, item.updatedAt]),
    };
  });
}

async function listApigInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "apig",
    `/v2/${session.projectId}/apigw/instances?limit=100`,
  );

  return asArray(body.instances).map((instance): ApigInstance => {
    const item = asRecord(instance);

    return {
      createdAt: firstString([item.create_time, item.created_at, item.createdAt]),
      edition: firstString([item.edition, item.spec, item.instance_type], "-"),
      eipAddress: firstString([item.eip_address, item.eip], "-"),
      id: asString(item.id),
      name: firstString([item.instance_name, item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      subnetId: firstString([item.subnet_id, item.network_id], "-"),
      version: firstString([item.version, item.enterprise_project_id], "-"),
      vpcId: firstString([item.vpc_id, item.router_id], "-"),
    };
  });
}

export async function listApigInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listApigInstancesForProject);
}

async function listDmsKafkaInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "dms",
    `/v2/${session.projectId}/instances?engine=kafka&limit=100`,
  );

  return asArray(body.instances).map((instance): DmsKafkaInstance => {
    const item = asRecord(instance);
    const storage = Number(item.storage_space ?? item.storage ?? 0);

    return {
      availabilityZones: asArray(item.available_zones ?? item.availability_zones).join(", ") || "-",
      brokerCount: Number(item.broker_num ?? item.broker_count ?? 0),
      connectAddress: firstString([item.connect_address, item.public_connect_address, item.management_connect_address], "-"),
      createdAt: firstString([item.created_at, item.create_time, item.createdAt]),
      engineVersion: firstString([item.engine_version, item.version], "-"),
      id: asString(item.instance_id ?? item.id),
      name: firstString([item.name, item.instance_name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      storage: storage ? `${storage} GB` : "-",
      subnetId: asString(item.subnet_id, "-"),
      vpcId: asString(item.vpc_id, "-"),
    };
  });
}

export async function listDmsKafkaInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDmsKafkaInstancesForProject);
}

async function listDcsRedisInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "dcs",
    `/v2/${session.projectId}/instances?offset=0&limit=100`,
  );

  return asArray(body.instances).map((instance): DcsRedisInstance => {
    const item = asRecord(instance);

    return {
      capacity: `${Number(item.capacity ?? item.max_memory ?? 0)} GB`,
      createdAt: firstString([item.created_at, item.createdAt]),
      engine: asString(item.engine, "Redis"),
      engineVersion: firstString([item.engine_version, item.version], "-"),
      id: asString(item.instance_id ?? item.id),
      ip: firstString([item.ip, item.address, item.publicip_address], "-"),
      mode: firstString([item.cache_mode, item.mode], "-"),
      name: firstString([item.name, item.instance_name, item.id]),
      port: String(item.port ?? "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      usedMemory: item.used_memory ? `${item.used_memory} MB` : "-",
      vpcId: asString(item.vpc_id, "-"),
    };
  });
}

export async function listDcsRedisInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDcsRedisInstancesForProject);
}

async function listWafInstancesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ items?: unknown[] }>(
    session,
    "waf",
    `/v1/${session.projectId}/waf/instance?page=1&pagesize=100`,
  );

  return asArray(body.items).map((host): WafInstance => {
    const item = asRecord(host);

    return {
      accessCode: asString(item.access_code, "-"),
      accessStatus: String(item.access_status ?? "-"),
      createdAt: item.timestamp ? new Date(Number(item.timestamp)).toISOString() : "",
      hostname: firstString([item.hostname, item.name]),
      id: firstString([item.id, item.hostid, item.hostname]),
      policyId: asString(item.policyid, "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      protectStatus: String(item.protect_status ?? "-"),
      proxy: String(item.proxy ?? "-"),
      region: firstString([item.region, session.region]),
    };
  });
}

export async function listWafInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listWafInstancesForProject);
}

async function listDewKeysForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ keys?: unknown[]; key_details?: unknown[] }>(
    session,
    "dew",
    `/v1.0/${session.projectId}/kms/list-keys`,
    {
      body: JSON.stringify({ limit: "100" }),
      method: "POST",
    },
  );

  return asArray(body.key_details ?? body.keys).map((key): DewKey => {
    const item = asRecord(key);

    return {
      alias: firstString([item.key_alias, item.alias], "-"),
      createdAt: item.creation_date ? new Date(Number(item.creation_date)).toISOString() : firstString([item.created_at, item.createdAt]),
      id: firstString([item.key_id, item.id]),
      keyId: firstString([item.key_id, item.id]),
      keyState: String(item.key_state ?? item.state ?? "-"),
      keyType: firstString([item.key_type, item.type], "-"),
      origin: firstString([item.origin, item.key_origin], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
    };
  });
}

export async function listDewKeys(session: BetterUiSession) {
  return loadAcrossProjects(session, listDewKeysForProject);
}

async function listHssHostsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ data_list?: unknown[]; hosts?: unknown[] }>(
    session,
    "hss",
    `/v5/${session.projectId}/host-management/hosts?limit=100`,
  );

  return asArray(body.data_list ?? body.hosts).map((host): HssHost => {
    const item = asRecord(host);
    const asset = asRecord(item.asset_info);
    const risk = asRecord(item.risk_info);
    const agent = asRecord(item.agent_info);

    return {
      agentStatus: firstString([item.agent_status, agent.agent_status, agent.status], "UNKNOWN"),
      baselineRiskCount: Number(item.baseline_num ?? risk.baseline_num ?? risk.baseline_risk_count ?? 0),
      detectResult: firstString([item.detect_result, item.risk_status, risk.detect_result], "-"),
      groupName: firstString([item.group_name, asset.group_name], "-"),
      id: firstString([item.host_id, item.id, item.server_id]),
      intrusionCount: Number(item.intrusion_num ?? risk.intrusion_num ?? risk.intrusion_count ?? 0),
      name: firstString([item.host_name, item.name, item.server_name, item.id]),
      os: firstString([item.os_type, item.os_name, asset.os], "-"),
      policyGroupName: firstString([item.policy_group_name, item.policy_name], "-"),
      privateIp: firstString([item.private_ip, item.private_ip_address, asset.private_ip], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      publicIp: firstString([item.public_ip, item.public_ip_address, asset.public_ip], "-"),
      region: session.region,
      riskCount: Number(item.risk_num ?? risk.risk_num ?? risk.risk_count ?? 0),
      version: firstString([item.version, item.edition, agent.version], "-"),
      vulnerabilityCount: Number(item.vul_num ?? item.vulnerability_num ?? risk.vul_num ?? 0),
    };
  });
}

export async function listHssHosts(session: BetterUiSession) {
  return loadAcrossProjects(session, listHssHostsForProject);
}

async function listSmnTopicsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ topics?: unknown[] }>(
    session,
    "smn",
    `/v2/${session.projectId}/notifications/topics?offset=0&limit=100`,
  );

  return asArray(body.topics).map((topic): SmnTopic => {
    const item = asRecord(topic);

    return {
      createdAt: firstString([item.create_time, item.created_at, item.createdAt]),
      displayName: asString(item.display_name, ""),
      enterpriseProjectId: asString(item.enterprise_project_id, "-"),
      id: firstString([item.topic_id, item.topic_urn, item.name]),
      name: firstString([item.name, item.topic_urn]),
      projectId: session.projectId,
      projectName: session.projectName,
      pushPolicy: String(item.push_policy ?? "-"),
      region: session.region,
      topicUrn: asString(item.topic_urn),
      updatedAt: firstString([item.update_time, item.updated_at, item.updatedAt]),
    };
  });
}

export async function listSmnTopics(session: BetterUiSession) {
  return loadAcrossProjects(session, listSmnTopicsForProject);
}

async function listModelArtsNotebooksForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ data?: unknown[]; notebooks?: unknown[] }>(
    session,
    "modelarts",
    `/v1/${session.projectId}/notebooks/all?limit=100`,
  );

  return asArray(body.data ?? body.notebooks).map((notebook): ModelArtsNotebook => {
    const item = asRecord(notebook);
    const flavor = asRecord(item.flavor);
    const image = asRecord(item.image);
    const volume = asRecord(item.volume);
    const resourcePool = asRecord(item.pool ?? item.resource_pool);

    return {
      createdAt: firstString([item.created_at, item.create_time, item.createdAt]),
      flavor: firstString([item.flavor, flavor.name, flavor.code, item.flavor_id], "-"),
      id: firstString([item.id, item.instance_id, item.notebook_id]),
      image: firstString([item.image_name, image.name, image.id], "-"),
      name: firstString([item.name, item.instance_name, item.id]),
      pool: firstString([resourcePool.name, item.pool_name, item.resource_pool_name], "default"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.status, item.state], "UNKNOWN"),
      storage: firstString([volume.size, item.volume_size], "-"),
      workspaceId: String(item.workspace_id ?? "-"),
    };
  });
}

export async function listModelArtsNotebooks(session: BetterUiSession) {
  return loadAcrossProjects(session, listModelArtsNotebooksForProject);
}

async function listDliQueuesForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ queues?: unknown[]; queue_list?: unknown[] }>(
    session,
    "dli",
    `/v1.0/${session.projectId}/queues?queue_type=all&with-charge-info=true&page-size=100&current-page=1`,
  );

  return asArray(body.queues ?? body.queue_list).map((queue): DliQueue => {
    const item = asRecord(queue);
    const charge = asRecord(item.charge_info ?? item.chargeInfo);

    return {
      chargingMode: firstString([item.charging_mode, charge.charging_mode, charge.mode], "-"),
      cuCount: Number(item.cu_count ?? item.cuCount ?? item.cu_num ?? 0),
      description: asString(item.description, ""),
      engine: firstString([item.engine, item.resource_type, item.platform], "-"),
      name: firstString([item.queue_name, item.name]),
      owner: firstString([item.owner, item.user_name], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.status, item.queue_status], "UNKNOWN"),
      type: firstString([item.queue_type, item.type], "-"),
    };
  });
}

export async function listDliQueues(session: BetterUiSession) {
  return loadAcrossProjects(session, listDliQueuesForProject);
}

function timestampSeconds(value: unknown) {
  const seconds = Number(value);

  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : firstString([value], "-");
}

async function listMrsClustersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ clusters?: unknown[] }>(
    session,
    "mrs",
    `/v1.1/${session.projectId}/cluster_infos?pageSize=100&currentPage=1&clusterState=existing`,
  );

  return asArray(body.clusters).map((cluster): MrsCluster => {
    const item = asRecord(cluster);
    const components = asArray(item.componentList ?? item.components)
      .map((component) => {
        const record = asRecord(component);
        return firstString([record.componentName, record.name, record.component_name], "");
      })
      .filter(Boolean)
      .join(", ");

    return {
      billingType: firstString([item.billingType, item.billing_type], "-"),
      components: components || "-",
      coreNodes: Number(item.coreNodeNum ?? item.core_node_num ?? 0),
      createdAt: timestampSeconds(item.createAt ?? item.created_at),
      hadoopVersion: firstString([item.hadoopVersion, item.hadoop_version], "-"),
      id: firstString([item.clusterId, item.id]),
      masterNodes: Number(item.masterNodeNum ?? item.master_node_num ?? 0),
      name: firstString([item.clusterName, item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.clusterState, item.status], "UNKNOWN"),
      totalNodes: Number(item.totalNodeNum ?? item.total_node_num ?? 0),
      vpcId: firstString([item.vpcId, item.vpc_id], "-"),
    };
  });
}

export async function listMrsClusters(session: BetterUiSession) {
  return loadAcrossProjects(session, listMrsClustersForProject);
}

async function listDwsClustersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ clusters?: unknown[] }>(
    session,
    "dws",
    `/v1.0/${session.projectId}/clusters`,
  );

  return asArray(body.clusters).map((cluster): DwsCluster => {
    const item = asRecord(cluster);
    const endpoints = asArray(item.endpoints ?? item.private_endpoints);
    const firstEndpoint = asRecord(endpoints[0]);

    return {
      availabilityZone: firstString([item.availability_zone, item.az_code], "-"),
      createdAt: firstString([item.created, item.created_at, item.create_time]),
      endpoint: firstString([firstEndpoint.connect_info, firstEndpoint.ip, item.private_ip, item.public_ip], "-"),
      id: asString(item.id),
      name: firstString([item.name, item.cluster_name, item.id]),
      nodeType: firstString([item.node_type, item.nodeType], "-"),
      nodes: Number(item.number_of_node ?? item.node_num ?? item.nodes ?? 0),
      port: String(item.port ?? "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      version: asString(item.version, "-"),
    };
  });
}

export async function listDwsClusters(session: BetterUiSession) {
  return loadAcrossProjects(session, listDwsClustersForProject);
}

async function listCssClustersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ clusters?: unknown[] }>(
    session,
    "css",
    `/v1.0/${session.projectId}/clusters?limit=100`,
  );

  return asArray(body.clusters).map((cluster): CssCluster => {
    const item = asRecord(cluster);
    const datastore = asRecord(item.datastore);
    const instances = asArray(item.instances ?? item.nodes);
    const firstNode = asRecord(instances[0]);
    const volume = asRecord(firstNode.volume ?? item.volume);

    return {
      createdAt: firstString([item.created, item.created_at, item.create_time]),
      datastore: [datastore.type, datastore.version].filter(Boolean).join(" ") || "-",
      endpoint: firstString([item.endpoint, item.privateEndpoint, item.private_ip, item.publicKibanaResp], "-"),
      id: firstString([item.id, item.cluster_id]),
      name: firstString([item.name, item.cluster_name, item.id]),
      nodeCount: Number(item.nodeNum ?? item.node_num ?? instances.length),
      nodeSpec: firstString([item.nodeType, item.node_type, firstNode.flavorRef, firstNode.flavor_ref], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      storage: numberWithUnit(volume.size ?? item.volume_size ?? item.storage_size, "GB"),
    };
  });
}

export async function listCssClusters(session: BetterUiSession) {
  return loadAcrossProjects(session, listCssClustersForProject);
}

export async function listIamUsers(session: BetterUiSession) {
  const body = await huaweiAccountFetch<{ users?: unknown[] }>(
    session,
    "/v3/users",
  );

  return asArray(body.users).map((user): IamUser => {
    const item = asRecord(user);

    return {
      description: asString(item.description, ""),
      domainId: asString(item.domain_id),
      enabled: String(item.enabled ?? "-"),
      id: asString(item.id),
      name: asString(item.name),
      passwordExpiresAt: firstString([item.password_expires_at, item.pwd_status], "-"),
    };
  });
}

async function listCtsTrackersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ trackers?: unknown[] }>(
    session,
    "cts",
    `/v3/${session.projectId}/trackers`,
  );

  return asArray(body.trackers).map((tracker): CtsTracker => {
    const item = asRecord(tracker);
    const obs = asRecord(item.obs_info);
    const lts = asRecord(item.lts);

    return {
      bucketName: asString(obs.bucket_name, "-"),
      filePrefix: asString(obs.file_prefix_name, "-"),
      id: firstString([item.id, item.tracker_name]),
      isLtsEnabled: String(item.is_lts_enabled ?? lts.is_lts_enabled ?? "-"),
      ltsGroupId: firstString([item.group_id, lts.log_group_id], "-"),
      name: firstString([item.tracker_name, item.name]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
    };
  });
}

export async function listCtsTrackers(session: BetterUiSession) {
  return loadAcrossProjects(session, listCtsTrackersForProject);
}

async function listCtsTracesForProject(session: HuaweiProjectSession) {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const body = await huaweiFetch<{ traces?: unknown[] }>(
    session,
    "cts",
    `/v1.0/${session.projectId}/system/trace?from=${oneDayAgo}&to=${now}&limit=50`,
  );

  return asArray(body.traces).map((trace): CtsTrace => {
    const item = asRecord(trace);
    const user = asRecord(item.user);

    return {
      code: firstString([item.code, item.request_id], "-"),
      id: firstString([item.trace_id, item.id, item.request_id]),
      recordedAt: firstString([item.time, item.record_time, item.trace_time]),
      resourceName: firstString([item.resource_name, item.resource_id], "-"),
      resourceType: asString(item.resource_type, "-"),
      serviceType: asString(item.service_type, "-"),
      sourceIp: firstString([item.source_ip, item.user_ip], "-"),
      traceName: asString(item.trace_name, "-"),
      traceRating: asString(item.trace_rating, "-"),
      traceType: asString(item.trace_type, "-"),
      userName: firstString([user.name, item.user_name], "-"),
    };
  });
}

export async function listCtsTraces(session: BetterUiSession) {
  const results = await Promise.allSettled(
    sessionProjects(session).map((project) => listCtsTracesForProject(project)),
  );

  return results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
    .slice(0, 50);
}

async function listLtsLogGroupsForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ log_groups?: unknown[]; groups?: unknown[] }>(
    session,
    "lts",
    `/v2/${session.projectId}/groups`,
  );

  return asArray(body.log_groups ?? body.groups).map((group): LtsLogGroup => {
    const item = asRecord(group);

    return {
      alias: asString(item.alias, ""),
      createdAt: firstString([item.creation_time, item.created_at, item.createdAt]),
      id: firstString([item.log_group_id, item.id]),
      name: firstString([item.log_group_name, item.name]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      tags: asArray(item.tag).length || asArray(item.tags).length,
      ttlDays: firstString([item.ttl_in_days, item.ttl], "-"),
    };
  });
}

export async function listLtsLogGroups(session: BetterUiSession) {
  return loadAcrossProjects(session, listLtsLogGroupsForProject);
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
