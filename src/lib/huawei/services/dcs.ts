import {
  finishCloudLoad,
  errorMessage,
  combineCloudLoads,
} from "@/lib/huawei/errors";
import { mapCloudLoad } from "@/lib/huawei/errors";
import { huaweiList } from "@/lib/huawei/http";
import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  formatBytes,
  huaweiFetch,
  loadAcrossProjects,
  numberWithUnit,
  sessionProjects,
} from "@/lib/huawei/core";
import type { DcsRedisInstance } from "@/lib/huawei/services/dcs.types";

export type DcsRedisInstanceDetails = DcsRedisInstance & {
  accessUser: string;
  availabilityZones: string[];
  azCodes: string[];
  backendAddresses: string;
  capacityGb: number;
  chargingMode: string;
  connectionAddress: string;
  cpuType: string;
  description: string;
  domainName: string;
  enterpriseProjectId: string;
  enterpriseProjectName: string;
  features: Array<{
    key: string;
    value: string;
  }>;
  launchedAt: string;
  maintenanceWindow: string;
  maxMemory: string;
  maxMemoryMb: number;
  noPasswordAccess: string;
  nodeCount: number;
  publicAccessEnabled: string;
  publicIpAddress: string;
  publicIpId: string;
  readOnlyDomainName: string;
  resourceSpecCode: string;
  securityGroupId: string;
  securityGroupName: string;
  serviceTaskId: string;
  serviceUpgrade: string;
  sslEnabled: string;
  storageType: string;
  subStatus: string;
  subnetCidr: string;
  subnetId: string;
  subnetName: string;
  tags: Array<{
    key: string;
    value: string;
  }>;
  task: string;
  transparentClientIp: string;
  usedMemoryMb: number;
  vpcName: string;
};

export type DcsBackupRecord = {
  backupFormat: string;
  createdAt: string;
  errorCode: string;
  executionAt: string;
  id: string;
  instanceId: string;
  name: string;
  progress: string;
  remark: string;
  size: string;
  status: string;
  supportRestore: string;
  type: string;
  updatedAt: string;
};

export type DcsRedisDetails = {
  backups: DcsBackupRecord[];
  instance: DcsRedisInstanceDetails;
};

export type DcsAction = "flush" | "restart" | "soft_restart";

function asNumber(value: unknown) {
  const number = Number(value ?? 0);

  return Number.isFinite(number) ? number : 0;
}

function asBooleanLabel(value: unknown, fallback = "-") {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "string" && value.trim()) {
    if (value.toLowerCase() === "true") {
      return "Yes";
    }

    if (value.toLowerCase() === "false") {
      return "No";
    }
  }

  return fallback;
}

function chargingMode(value: unknown) {
  if (value === 0 || value === "0") {
    return "Pay-per-use";
  }

  if (value === 1 || value === "1") {
    return "Yearly/monthly";
  }

  return asString(value, "-");
}

function maintenanceWindow(item: Record<string, unknown>) {
  const begin = asString(item.maintain_begin, "");
  const end = asString(item.maintain_end, "");

  if (begin && end) {
    return `${begin}-${end} UTC`;
  }

  return firstString([item.maintenance_window, item.maintain_begin], "-");
}

function stringList(value: unknown) {
  return asArray(value)
    .map((item) => asString(item, ""))
    .filter(Boolean);
}

function keyValueList(value: unknown) {
  const record = asRecord(value);

  if (Array.isArray(value)) {
    return value.map((item) => {
      const tag = asRecord(item);

      return {
        key: firstString([tag.key, tag.tag_key, tag.name], "-"),
        value: firstString([tag.value, tag.tag_value], "-"),
      };
    });
  }

  return Object.entries(record).map(([key, item]) => ({
    key,
    value:
      typeof item === "boolean" ? asBooleanLabel(item) : String(item ?? "-"),
  }));
}

function parseDcsRedisInstance(
  instance: unknown,
  session: HuaweiProjectSession,
): DcsRedisInstanceDetails {
  const item = asRecord(instance);
  const maxMemoryMb = asNumber(item.max_memory);
  const usedMemoryMb = asNumber(item.used_memory);
  const capacityGb = asNumber(item.capacity_minor || item.capacity);
  const domainName = firstString([item.domain_name, item.name], "-");
  const ip = firstString([item.ip, item.address, item.private_ip], "-");
  const connectionAddress = firstString([domainName, ip], "-");
  const mode = firstString([item.cache_mode, item.mode], "-");
  const nodeCount = asNumber(
    item.node_num ?? item.node_count ?? item.replica_count,
  );

  return {
    accessUser: firstString([item.access_user, item.user_name], "-"),
    availabilityZones: stringList(item.available_zones),
    azCodes: stringList(item.az_codes),
    backendAddresses: firstString([item.backend_addrs], "-"),
    capacity:
      capacityGb > 0 ? `${capacityGb} GB` : numberWithUnit(item.capacity, "GB"),
    capacityGb,
    chargingMode: chargingMode(item.charging_mode),
    connectionAddress,
    cpuType: firstString([item.cpu_type], "-"),
    createdAt: firstString([item.created_at, item.createdAt], "-"),
    description: firstString([item.description], "-"),
    domainName,
    enterpriseProjectId: firstString([item.enterprise_project_id], "-"),
    enterpriseProjectName: firstString([item.enterprise_project_name], "-"),
    engine: asString(item.engine, "Redis"),
    engineVersion: firstString([item.engine_version, item.version], "-"),
    features: keyValueList(item.features),
    id: firstString([item.instance_id, item.id]),
    ip,
    launchedAt: firstString([item.launched_at], "-"),
    maintenanceWindow: maintenanceWindow(item),
    maxMemory: maxMemoryMb > 0 ? `${maxMemoryMb} MB` : "-",
    maxMemoryMb,
    mode,
    name: firstString([item.name, item.instance_name, item.id]),
    noPasswordAccess: asBooleanLabel(item.no_password_access),
    nodeCount,
    port: String(item.port ?? "-"),
    projectId: session.projectId,
    projectName: session.projectName,
    publicAccessEnabled: asBooleanLabel(item.enable_publicip),
    publicIpAddress: firstString([item.publicip_address], "-"),
    publicIpId: firstString([item.publicip_id], "-"),
    readOnlyDomainName: firstString([item.readonly_domain_name], "-"),
    region: session.region,
    resourceSpecCode: firstString(
      [item.spec_code, item.resource_spec_code],
      "-",
    ),
    securityGroupId: firstString([item.security_group_id], "-"),
    securityGroupName: firstString([item.security_group_name], "-"),
    serviceTaskId: firstString([item.service_task_id], "-"),
    serviceUpgrade: asBooleanLabel(item.service_upgrade),
    sslEnabled: asBooleanLabel(item.enable_ssl),
    status: asString(item.status, "UNKNOWN"),
    storageType: firstString([item.storage_type], "-"),
    subStatus: firstString([item.sub_status], "-"),
    subnetCidr: firstString([item.subnet_cidr], "-"),
    subnetId: firstString([item.subnet_id, item.subnetId], "-"),
    subnetName: firstString([item.subnet_name], "-"),
    tags: keyValueList(item.tags),
    task: firstString([item.task], "-"),
    transparentClientIp: asBooleanLabel(item.transparent_client_ip_enable),
    usedMemory: usedMemoryMb > 0 ? `${usedMemoryMb} MB` : "-",
    usedMemoryMb,
    vpcId: firstString([item.vpc_id, item.vpcId], "-"),
    vpcName: firstString([item.vpc_name], "-"),
  };
}

export async function listDcsRedisInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "dcs",
    `/v2/${session.projectId}/instances?offset=0&limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance) =>
    parseDcsRedisInstance(instance, session),
  );
}

async function getDcsRedisInstanceForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const body = await huaweiFetch<unknown>(
    session,
    "dcs",
    `/v2/${session.projectId}/instances/${id}`,
  );
  const record = asRecord(body);
  const instance = record.instance ?? body;

  return parseDcsRedisInstance(instance, session);
}

export async function listDcsBackupRecordsForProject(
  session: HuaweiProjectSession,
  instanceId: string,
) {
  const query = new URLSearchParams({ limit: "10", offset: "0" });
  const body = await huaweiFetch<{ backup_record_response?: unknown[] }>(
    session,
    "dcs",
    `/v2/${session.projectId}/instances/${instanceId}/backups?${query.toString()}`,
  );

  return asArray(body.backup_record_response).map((backup): DcsBackupRecord => {
    const item = asRecord(backup);

    return {
      backupFormat: firstString([item.backup_format], "-"),
      createdAt: firstString([item.created_at], "-"),
      errorCode: firstString([item.error_code], "-"),
      executionAt: firstString([item.execution_at], "-"),
      id: firstString([item.backup_id, item.id], "-"),
      instanceId,
      name: firstString([item.backup_name, item.name, item.backup_id], "-"),
      progress: firstString([item.progress], "-"),
      remark: firstString([item.remark], "-"),
      size: formatBytes(item.size),
      status: firstString([item.status], "UNKNOWN"),
      supportRestore: asBooleanLabel(item.is_support_restore),
      type: firstString([item.backup_type], "-"),
      updatedAt: firstString([item.updated_at], "-"),
    };
  });
}

export async function listDcsRedisInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDcsRedisInstancesForProject);
}

export async function getDcsRedisInstance(
  session: BetterUiSession,
  id: string,
) {
  const results = await Promise.allSettled(
    sessionProjects(session).map((project) =>
      getDcsRedisInstanceForProject(project, id),
    ),
  );

  const relevantResults = results.filter(
    (result) =>
      !(
        result.status === "rejected" &&
        errorMessage(result.reason).startsWith("404 ")
      ),
  );
  const instance =
    results
      .flatMap((result) =>
        result.status === "fulfilled" && result.value.id === id
          ? [result.value]
          : [],
      )
      .at(0) ?? null;
  return finishCloudLoad(relevantResults, instance);
}

export async function getDcsRedisDetails(
  session: BetterUiSession,
  id: string,
): Promise<DcsRedisDetails | null> {
  return mapCloudLoad(
    () => getDcsRedisInstance(session, id),
    async (instance) => {
      if (!instance) {
        return null;
      }

      const project =
        sessionProjects(session).find(
          (item) =>
            item.projectId === instance.projectId &&
            item.region === instance.region,
        ) ?? sessionProjects(session)[0];
      return combineCloudLoads(
        {
          backups: listDcsBackupRecordsForProject(project, id),
          instance: Promise.resolve(instance),
        },
        { backups: [], instance },
      );
    },
  );
}

export async function runDcsRedisAction(
  session: BetterUiSession,
  id: string,
  action: DcsAction,
  projectId: string,
) {
  const project = sessionProjects(session).find(
    (item) => item.projectId === projectId,
  );

  if (!project) {
    throw new Error("Project id does not match the signed-in projects.");
  }

  return huaweiFetch<{
    results?: Array<{
      instance?: string;
      result?: string;
    }>;
  }>(project, "dcs", `/v2/${project.projectId}/instances/status`, {
    body: JSON.stringify({ action, instances: [id] }),
    method: "PUT",
  });
}

export type * from "@/lib/huawei/services/dcs.types";
