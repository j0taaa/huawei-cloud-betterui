import { mapCloudLoad, combineCloudLoads } from "@/lib/huawei/errors";
import { finishCloudLoad } from "@/lib/huawei/errors";
import { huaweiList } from "@/lib/huawei/http";
import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  firstString,
  huaweiFetch,
  loadAcrossProjects,
  numberWithUnit,
  sessionProjects,
} from "@/lib/huawei/core";
import {
  backupWindow,
  firstIpFromValues,
  nodeCount,
} from "@/lib/huawei/database-cache-helpers";
import type { DdsInstance } from "@/lib/huawei/services/dds.types";

export type DdsNode = DdsInstance["groups"][number]["nodes"][number];
export type DdsGroup = DdsInstance["groups"][number];

export type DdsBackup = {
  beginTime: string;
  createdAt: string;
  datastore: string;
  endTime: string;
  id: string;
  instanceId: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  size: string;
  status: string;
  type: string;
};

function datastoreName(datastore: Record<string, unknown>, fallback: unknown) {
  return (
    [datastore.type ?? fallback, datastore.version]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ") || "DDS"
  );
}

function parseDdsNode(node: unknown, group: Record<string, unknown>): DdsNode {
  const item = asRecord(node);

  return {
    availabilityZone: firstString(
      [item.availability_zone, item.az_code, group.az_code],
      "-",
    ),
    groupId: firstString([group.id, group.group_id], "-"),
    groupName: firstString([group.name, group.group_name, group.id], "-"),
    groupType: firstString([group.type, group.group_type], "-"),
    id: firstString([item.id, item.node_id], "-"),
    name: firstString([item.name, item.node_name, item.id], "-"),
    privateIp: firstIpFromValues([
      item.private_ips,
      item.private_ip,
      item.private_ip_address,
    ]),
    role: firstString([item.role, item.type, item.node_type], "-"),
    status: firstString([item.status, item.node_status], "-"),
  };
}

function parseDdsGroup(group: unknown): DdsGroup {
  const item = asRecord(group);
  const volume = asRecord(item.volume);
  const nodes = asArray(item.nodes).map((node) => parseDdsNode(node, item));

  return {
    id: firstString([item.id, item.group_id], "-"),
    name: firstString([item.name, item.group_name, item.id], "-"),
    nodes,
    role: firstString([item.role], "-"),
    status: firstString([item.status, item.group_status], "-"),
    storage: numberWithUnit(
      volume.size ?? item.volume_size ?? item.storage_size,
      "GB",
    ),
    storageType: firstString(
      [volume.type, item.volume_type, item.storage_type],
      "-",
    ),
    type: firstString([item.type, item.group_type], "-"),
  };
}

function parseDdsInstance(
  instance: unknown,
  session: HuaweiProjectSession,
): DdsInstance {
  const item = asRecord(instance);
  const datastore = asRecord(item.datastore);
  const volume = asRecord(item.volume);
  const backupStrategy = item.backup_strategy ?? item.backupStrategy;
  const backupStrategyRecord = asRecord(backupStrategy);
  const chargeInfo = asRecord(item.charge_info);
  const groups = asArray(item.groups).map(parseDdsGroup);
  const flatNodes = [
    ...groups.flatMap((group) => group.nodes),
    ...asArray(item.nodes).map((node) => parseDdsNode(node, {})),
  ];
  const availabilityZone = firstString(
    [
      item.az_code,
      item.availability_zone,
      item.availability_zone_mode,
      flatNodes
        .map((node) => node.availabilityZone)
        .find((zone) => zone !== "-"),
    ],
    "-",
  );

  return {
    availabilityZone,
    backupKeepDays: firstString(
      [backupStrategyRecord.keep_days, backupStrategyRecord.keep_day],
      "-",
    ),
    backupWindow: backupWindow(backupStrategy),
    chargeMode: firstString([chargeInfo.charge_mode, item.charge_mode], "-"),
    createdAt: firstString(
      [item.created, item.created_at, item.create_time],
      "-",
    ),
    datastore: datastoreName(datastore, item.datastore_type),
    enterpriseProjectId: firstString([item.enterprise_project_id], "-"),
    flavor: firstString([item.flavor_ref, item.flavor, item.spec_code], "-"),
    groups,
    id: firstString([item.id, item.instance_id]),
    maintenanceWindow: firstString(
      [item.maintenance_window, item.maintain_begin, item.maintain_time],
      "-",
    ),
    mode: firstString([item.mode, item.instance_mode, item.type], "-"),
    name: firstString([item.name, item.instance_name, item.id]),
    nodes: flatNodes.length || nodeCount(item.nodes ?? item.groups),
    port: String(item.port ?? item.db_port ?? "-"),
    privateIp: firstIpFromValues([
      item.private_ips,
      item.private_ip,
      item.private_ip_address,
      ...flatNodes.map((node) => node.privateIp),
    ]),
    projectId: session.projectId,
    projectName: session.projectName,
    publicIp: firstIpFromValues([item.public_ips, item.public_ip]),
    region: session.region,
    securityGroupId: firstString(
      [item.security_group_id, item.securityGroupId],
      "-",
    ),
    status: firstString([item.status, item.instance_status], "UNKNOWN"),
    storage: numberWithUnit(
      volume.size ?? item.volume_size ?? item.storage_size,
      "GB",
    ),
    storageType: firstString(
      [volume.type, item.volume_type, item.storage_type],
      "-",
    ),
    subnetId: firstString([item.subnet_id, item.subnetId], "-"),
    switchStrategy: firstString([item.switch_strategy], "-"),
    timeZone: firstString([item.time_zone], "-"),
    type: firstString([item.type, item.instance_type], "-"),
    updatedAt: firstString(
      [item.updated, item.updated_at, item.update_time],
      "-",
    ),
    vpcId: firstString([item.vpc_id, item.vpcId], "-"),
  };
}

export async function listDdsInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "dds",
    `/v3/${session.projectId}/instances?limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance) =>
    parseDdsInstance(instance, session),
  );
}

async function getDdsInstanceForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const query = new URLSearchParams({ id, limit: "1" });
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "dds",
    `/v3/${session.projectId}/instances?${query.toString()}`,
  );
  const instance = asArray(body.instances)[0];

  return instance ? parseDdsInstance(instance, session) : null;
}

export async function listDdsBackupsForProject(
  session: HuaweiProjectSession,
  instanceId: string,
) {
  const query = new URLSearchParams({
    instance_id: instanceId,
    limit: "10",
    offset: "0",
  });
  const body = await huaweiFetch<{ backups?: unknown[] }>(
    session,
    "dds",
    `/v3/${session.projectId}/backups?${query.toString()}`,
  );

  return asArray(body.backups).map((backup): DdsBackup => {
    const item = asRecord(backup);
    const datastore = asRecord(item.datastore);

    return {
      beginTime: firstString([item.begin_time, item.start_time], "-"),
      createdAt: firstString([item.created, item.created_at], "-"),
      datastore: datastoreName(datastore, item.datastore_type),
      endTime: firstString([item.end_time, item.finished_at], "-"),
      id: firstString([item.id, item.backup_id], "-"),
      instanceId,
      name: firstString([item.name, item.backup_name, item.id], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      size: numberWithUnit(item.size, "GB"),
      status: firstString([item.status], "UNKNOWN"),
      type: firstString([item.type, item.backup_type], "-"),
    };
  });
}

export async function getDdsInstance(session: BetterUiSession, id: string) {
  const results = await Promise.allSettled(
    sessionProjects(session).map((project) =>
      getDdsInstanceForProject(project, id),
    ),
  );

  return finishCloudLoad(
    results,
    results
      .flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      )
      .at(0) ?? null,
  );
}

export async function getDdsInstanceDetails(
  session: BetterUiSession,
  id: string,
) {
  return mapCloudLoad(
    () => getDdsInstance(session, id),
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
          backups: listDdsBackupsForProject(project, id),
          instance: Promise.resolve(instance),
        },
        { backups: [], instance },
      );
    },
  );
}

export async function listDdsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDdsInstancesForProject);
}

export type * from "@/lib/huawei/services/dds.types";
