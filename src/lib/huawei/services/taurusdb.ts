import { mapCloudLoad, combineCloudLoads } from "@/lib/huawei/errors";
import { finishCloudLoad } from "@/lib/huawei/errors";
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
  projectForId,
  sessionProjects,
} from "@/lib/huawei/core";
import {
  firstIpFromValues,
  nodeCount,
} from "@/lib/huawei/database-cache-helpers";

export type TaurusDbNode = {
  availabilityZone: string;
  id: string;
  name: string;
  privateIp: string;
  role: string;
  status: string;
  type: string;
};

export type TaurusDbBackup = {
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

export type TaurusDbInstance = {
  availabilityZone: string;
  backupKeepDays: string;
  backupWindow: string;
  chargeMode: string;
  createdAt: string;
  datastore: string;
  dbUserName: string;
  dedicatedResourceId: string;
  enterpriseProjectId: string;
  flavor: string;
  id: string;
  maintenanceWindow: string;
  mode: string;
  name: string;
  nodes: TaurusDbNode[];
  nodeCount: number;
  port: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  proxyIp: string;
  publicIp: string;
  readOnlyPrivateIp: string;
  region: string;
  securityGroupId: string;
  status: string;
  storage: string;
  storageType: string;
  subnetId: string;
  tags: Array<{
    key: string;
    value: string;
  }>;
  timeZone: string;
  type: string;
  updatedAt: string;
  vpcId: string;
};

function datastoreName(datastore: Record<string, unknown>, fallback: unknown) {
  return (
    [datastore.type ?? fallback, datastore.version]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ") || "TaurusDB"
  );
}

function backupWindow(strategy: Record<string, unknown>) {
  const start = asString(strategy.start_time, "");
  const end = asString(strategy.end_time, "");

  if (start && end) {
    return `${start}-${end}`;
  }

  return firstString([strategy.start_time, strategy.period], "-");
}

function parseTaurusDbNode(node: unknown): TaurusDbNode {
  const item = asRecord(node);

  return {
    availabilityZone: firstString([item.availability_zone, item.az_code], "-"),
    id: firstString([item.id, item.node_id], "-"),
    name: firstString([item.name, item.node_name, item.id], "-"),
    privateIp: firstIpFromValues([
      item.private_ips,
      item.private_ip,
      item.private_ip_address,
    ]),
    role: firstString([item.role, item.type], "-"),
    status: firstString([item.status, item.node_status], "-"),
    type: firstString([item.type, item.node_type], "-"),
  };
}

function parseTags(value: unknown) {
  return asArray(value).map((tag) => {
    const item = asRecord(tag);

    return {
      key: firstString([item.key], "-"),
      value: firstString([item.value], "-"),
    };
  });
}

function parseTaurusDbInstance(
  instance: unknown,
  session: HuaweiProjectSession,
): TaurusDbInstance {
  const item = asRecord(instance);
  const datastore = asRecord(item.datastore);
  const volume = asRecord(item.volume);
  const backupStrategy = asRecord(item.backup_strategy ?? item.backupStrategy);
  const chargeInfo = asRecord(item.charge_info);
  const flavorInfo = asRecord(item.flavor_info);
  const nodes = asArray(item.nodes).map(parseTaurusDbNode);
  const parsedNodeCount =
    nodes.length || nodeCount(item.nodes ?? item.node_count);
  const availabilityZone = firstString(
    [
      item.az_code,
      item.availability_zone,
      item.availability_zone_mode,
      nodes.map((node) => node.availabilityZone).find((zone) => zone !== "-"),
    ],
    "-",
  );

  return {
    availabilityZone,
    backupKeepDays: firstString([backupStrategy.keep_days], "-"),
    backupWindow: backupWindow(backupStrategy),
    chargeMode: firstString([chargeInfo.charge_mode, item.charge_mode], "-"),
    createdAt: firstString(
      [item.created, item.created_at, item.create_time],
      "-",
    ),
    datastore: datastoreName(datastore, item.datastore_type),
    dbUserName: firstString([item.db_user_name], "-"),
    dedicatedResourceId: firstString([item.dedicated_resource_id], "-"),
    enterpriseProjectId: firstString([item.enterprise_project_id], "-"),
    flavor: firstString(
      [
        item.flavor_ref,
        item.flavor,
        item.spec_code,
        flavorInfo.spec_code,
        flavorInfo.code,
      ],
      "-",
    ),
    id: firstString([item.id, item.instance_id]),
    maintenanceWindow: firstString(
      [item.maintenance_window, item.maintain_begin, item.maintain_time],
      "-",
    ),
    mode: firstString([item.mode, item.ha_mode, item.instance_mode], "-"),
    name: firstString([item.name, item.instance_name, item.id]),
    nodeCount: parsedNodeCount,
    nodes,
    port: String(item.port ?? item.db_port ?? "-"),
    privateIp: firstIpFromValues([
      item.private_ips,
      item.private_ip,
      item.private_ip_address,
    ]),
    projectId: session.projectId,
    projectName: session.projectName,
    proxyIp: firstIpFromValues([item.proxy_ips, item.proxy_ip]),
    publicIp: firstIpFromValues([item.public_ips, item.public_ip]),
    readOnlyPrivateIp: firstIpFromValues([
      item.readonly_private_ips,
      item.readonly_private_ip,
    ]),
    region: session.region,
    securityGroupId: firstString(
      [item.security_group_id, item.security_group_ids],
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
    tags: parseTags(item.tags),
    timeZone: firstString([item.time_zone], "-"),
    type: firstString([item.type, item.instance_type], "-"),
    updatedAt: firstString(
      [item.updated, item.updated_at, item.update_time],
      "-",
    ),
    vpcId: firstString([item.vpc_id, item.vpcId], "-"),
  };
}

export async function listTaurusDbInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "taurusdb",
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
    parseTaurusDbInstance(instance, session),
  );
}

async function getTaurusDbInstanceForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const detail = await huaweiFetch<{ instance?: unknown }>(
    session,
    "taurusdb",
    `/v3.1/${session.projectId}/instances/${encodeURIComponent(id)}`,
  ).catch(() => null);

  if (detail?.instance) {
    return parseTaurusDbInstance(detail.instance, session);
  }

  const query = new URLSearchParams({ id, limit: "1" });
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "taurusdb",
    `/v3/${session.projectId}/instances?${query.toString()}`,
  );
  const instance = asArray(body.instances)[0];

  return instance ? parseTaurusDbInstance(instance, session) : null;
}

export async function listTaurusDbBackupsForProject(
  session: HuaweiProjectSession,
  instanceId: string,
) {
  const query = new URLSearchParams({ limit: "10", offset: "0" });
  const body = await huaweiFetch<{ backups?: unknown[] }>(
    session,
    "taurusdb",
    `/v3/${session.projectId}/instances/${encodeURIComponent(instanceId)}/backups?${query.toString()}`,
  ).catch(() =>
    huaweiFetch<{ backups?: unknown[] }>(
      session,
      "taurusdb",
      `/v3/${session.projectId}/backups?${new URLSearchParams({
        instance_id: instanceId,
        limit: "10",
        offset: "0",
      }).toString()}`,
    ),
  );

  return asArray(body.backups).map((backup): TaurusDbBackup => {
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

export async function getTaurusDbInstance(
  session: BetterUiSession,
  id: string,
) {
  const results = await Promise.allSettled(
    sessionProjects(session).map((project) =>
      getTaurusDbInstanceForProject(project, id),
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

export async function getTaurusDbInstanceDetails(
  session: BetterUiSession,
  id: string,
) {
  return mapCloudLoad(
    () => getTaurusDbInstance(session, id),
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
          backups: listTaurusDbBackupsForProject(project, id),
          instance: Promise.resolve(instance),
        },
        { backups: [], instance },
      );
    },
  );
}

const taurusDbRestartInit: RequestInit = {
  body: JSON.stringify({}),
  method: "POST",
};

export async function runTaurusDbAction(
  session: BetterUiSession,
  id: string,
  action: "reboot",
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  if (action !== "reboot") {
    throw new Error("Unsupported TaurusDB action.");
  }

  return huaweiFetch<{ job_id?: string }>(
    project,
    "taurusdb",
    `/v3/${project.projectId}/instances/${encodeURIComponent(id)}/restart`,
    taurusDbRestartInit,
  );
}

export async function listTaurusDbInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listTaurusDbInstancesForProject);
}
