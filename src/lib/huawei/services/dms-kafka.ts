import { finishCloudLoad, errorMessage } from "@/lib/huawei/errors";
import { huaweiList } from "@/lib/huawei/http";
import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  huaweiFetch,
  loadAcrossProjects,
  numberWithUnit,
  sessionProjects,
} from "@/lib/huawei/core";

export type DmsKafkaInstanceDetails = {
  accessUser: string;
  archType: string;
  billingMode: string;
  availabilityZones: string[];
  brokerCount: number;
  brokerIps: string[];
  chargingMode: string;
  connectAddress: string;
  createdAt: string;
  description: string;
  engineVersion: string;
  enterpriseProjectId: string;
  enterpriseProjectName: string;
  features: Array<{
    key: string;
    value: string;
  }>;
  kafkaManagerEnabled: string;
  kafkaManagerAddress: string;
  kafkaManagerUser: string;
  maintenanceWindow: string;
  id: string;
  name: string;
  partitionNum: number;
  privateConnectAddress: string;
  projectId: string;
  projectName: string;
  publicConnectAddress: string;
  publicIpAddress: string;
  publicIpId: string;
  region: string;
  replicaCount: number;
  resourceSpecCode: string;
  retentionPolicy: string;
  securityGroupId: string;
  securityGroupName: string;
  sslConnectAddress: string;
  sslEnabled: string;
  status: string;
  storage: string;
  storageResourceId: string;
  storageSpecCode: string;
  storageType: string;
  subnetCidr: string;
  subnetId: string;
  subnetName: string;
  supportFeatures: string[];
  tags: Array<{
    key: string;
    value: string;
  }>;
  topicCount: number;
  usedStorage: string;
  usedStorageGb: number;
  vpcId: string;
  vpcName: string;
};

export type DmsKafkaAction = "restart";

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

function stringList(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

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

function maintenanceWindow(item: Record<string, unknown>) {
  const begin = asString(item.maintain_begin, "");
  const end = asString(item.maintain_end, "");

  if (begin && end) {
    return `${begin}-${end} UTC`;
  }

  return firstString([item.maintenance_window, item.maintain_begin], "-");
}

function parseDmsKafkaInstance(
  instance: unknown,
  session: HuaweiProjectSession,
): DmsKafkaInstanceDetails {
  const item = asRecord(instance);
  const storageGb = asNumber(item.storage_space ?? item.storage);
  const usedStorageGb = asNumber(
    item.used_storage_space ?? item.used_storage ?? item.used_space,
  );
  const brokerCount = asNumber(item.broker_num ?? item.broker_count);
  const connectAddress = firstString(
    [
      item.connect_address,
      item.private_connect_address,
      item.management_connect_address,
      item.ssl_connect_address,
      item.public_connect_address,
    ],
    "-",
  );
  const supportFeatures = stringList(item.support_features);

  return {
    accessUser: firstString([item.access_user, item.user_name], "-"),
    archType: firstString([item.arch_type, item.type], "-"),
    availabilityZones: stringList(
      item.available_zones ?? item.availability_zones,
    ),
    billingMode: chargingMode(item.charging_mode ?? item.billing_mode),
    brokerCount,
    brokerIps: stringList(item.broker_ips ?? item.broker_connect_addresses),
    chargingMode: chargingMode(item.charging_mode ?? item.billing_mode),
    connectAddress,
    createdAt: firstString([item.created_at, item.create_time, item.createdAt]),
    description: firstString([item.description], "-"),
    engineVersion: firstString([item.engine_version, item.version], "-"),
    enterpriseProjectId: firstString([item.enterprise_project_id], "-"),
    enterpriseProjectName: firstString([item.enterprise_project_name], "-"),
    features: keyValueList(item.features),
    id: asString(item.instance_id ?? item.id),
    kafkaManagerAddress: firstString(
      [item.kafka_manager_connect_address, item.manager_connect_address],
      "-",
    ),
    kafkaManagerEnabled: asBooleanLabel(
      item.kafka_manager_enable ?? item.enable_kafka_manager,
    ),
    kafkaManagerUser: firstString(
      [item.kafka_manager_user, item.manager_user],
      "-",
    ),
    maintenanceWindow: maintenanceWindow(item),
    name: firstString([item.name, item.instance_name, item.id]),
    partitionNum: asNumber(item.partition_num ?? item.partition_count),
    privateConnectAddress: firstString(
      [item.private_connect_address, item.connect_address],
      "-",
    ),
    projectId: session.projectId,
    projectName: session.projectName,
    publicConnectAddress: firstString([item.public_connect_address], "-"),
    publicIpAddress: firstString([item.publicip_address, item.public_ip], "-"),
    publicIpId: firstString([item.publicip_id, item.public_ip_id], "-"),
    region: session.region,
    replicaCount: asNumber(item.replica_num ?? item.replica_count),
    resourceSpecCode: firstString(
      [item.spec_code, item.resource_spec_code],
      "-",
    ),
    retentionPolicy: firstString([item.retention_policy], "-"),
    securityGroupId: firstString([item.security_group_id], "-"),
    securityGroupName: firstString([item.security_group_name], "-"),
    sslConnectAddress: firstString([item.ssl_connect_address], "-"),
    sslEnabled: asBooleanLabel(item.ssl_enable ?? item.enable_ssl),
    status: asString(item.status, "UNKNOWN"),
    storage: storageGb ? `${storageGb} GB` : numberWithUnit(item.storage, "GB"),
    storageResourceId: firstString([item.storage_resource_id], "-"),
    storageSpecCode: firstString([item.storage_spec_code], "-"),
    storageType: firstString([item.storage_type], "-"),
    subnetCidr: firstString([item.subnet_cidr], "-"),
    subnetId: firstString([item.subnet_id, item.subnetId], "-"),
    subnetName: firstString([item.subnet_name], "-"),
    supportFeatures,
    tags: keyValueList(item.tags),
    topicCount: asNumber(item.topic_num ?? item.topic_count),
    usedStorage: usedStorageGb ? `${usedStorageGb} GB` : "-",
    usedStorageGb,
    vpcId: firstString([item.vpc_id, item.vpcId], "-"),
    vpcName: firstString([item.vpc_name], "-"),
  };
}

export async function listDmsKafkaInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "dms",
    `/v2/${session.projectId}/instances?engine=kafka&limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance) =>
    parseDmsKafkaInstance(instance, session),
  );
}

async function getDmsKafkaInstanceForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const body = await huaweiFetch<unknown>(
    session,
    "dms",
    `/v2/${session.projectId}/instances/${id}`,
  );
  const record = asRecord(body);
  const instance = record.instance ?? body;

  return parseDmsKafkaInstance(instance, session);
}

export async function listDmsKafkaInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDmsKafkaInstancesForProject);
}

export async function getDmsKafkaInstance(
  session: BetterUiSession,
  id: string,
) {
  const results = await Promise.allSettled(
    sessionProjects(session).map((project) =>
      getDmsKafkaInstanceForProject(project, id),
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

export async function runDmsKafkaAction(
  session: BetterUiSession,
  id: string,
  action: DmsKafkaAction,
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
  }>(project, "dms", `/v2/${project.projectId}/instances/action`, {
    body: JSON.stringify({ action, instances: [id] }),
    method: "POST",
  });
}

export type * from "@/lib/huawei/services/dms-kafka.types";
