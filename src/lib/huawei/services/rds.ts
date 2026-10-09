import { mapCloudLoad, combineCloudLoads } from "@/lib/huawei/errors";
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
  projectForId,
} from "@/lib/huawei/core";

export type RdsNode = {
  availabilityZone: string;
  id: string;
  name: string;
  privateIp: string;
  role: string;
  status: string;
};

export type RdsBackup = {
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

export type RdsInstance = {
  availabilityZone: string;
  backupKeepDays: string;
  backupWindow: string;
  chargeMode: string;
  createdAt: string;
  datastore: string;
  enterpriseProjectId: string;
  flavor: string;
  id: string;
  maintenanceWindow: string;
  mode: string;
  name: string;
  nodes: RdsNode[];
  port: string;
  privateIp: string;
  publicIp: string;
  status: string;
  storage: string;
  storageType: string;
  subnetId: string;
  switchStrategy: string;
  timeZone: string;
  type: string;
  updatedAt: string;
  vpcId: string;
  projectId: string;
  projectName: string;
  region: string;
};

function firstIpFromValues(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }

    const array = asArray(value);
    const match = array.find((item) => typeof item === "string" && item.trim());

    if (typeof match === "string") {
      return match;
    }
  }

  return "-";
}

function datastoreName(datastore: Record<string, unknown>, fallback: unknown) {
  return (
    [datastore.type ?? fallback, datastore.version]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ") || "-"
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

function parseNode(node: unknown): RdsNode {
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
  };
}

function parseRdsInstance(
  instance: unknown,
  session: HuaweiProjectSession,
): RdsInstance {
  const item = asRecord(instance);
  const datastore = asRecord(item.datastore);
  const volume = asRecord(item.volume);
  const backupStrategy = asRecord(item.backup_strategy ?? item.backupStrategy);
  const chargeInfo = asRecord(item.charge_info);
  const nodes = asArray(item.nodes).map(parseNode);
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
    enterpriseProjectId: firstString([item.enterprise_project_id], "-"),
    flavor: firstString([item.flavor_ref, item.flavor, item.spec_code], "-"),
    id: firstString([item.id, item.instance_id]),
    maintenanceWindow: firstString(
      [item.maintenance_window, item.maintain_begin, item.maintain_time],
      "-",
    ),
    mode: firstString([item.mode, item.ha_mode, item.instance_mode], "-"),
    name: firstString([item.name, item.instance_name, item.id]),
    nodes,
    port: String(item.port ?? item.db_port ?? "-"),
    privateIp: firstIpFromValues([
      item.private_ips,
      item.private_ip,
      item.private_ip_address,
    ]),
    projectId: session.projectId,
    projectName: session.projectName,
    publicIp: firstIpFromValues([item.public_ips, item.public_ip]),
    region: session.region,
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

export async function listRdsInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "rds",
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
    parseRdsInstance(instance, session),
  );
}

export async function getRdsInstanceForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const query = new URLSearchParams({ id, limit: "1" });
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "rds",
    `/v3/${session.projectId}/instances?${query.toString()}`,
  );
  const instance = asArray(body.instances)[0];

  return instance ? parseRdsInstance(instance, session) : null;
}

export async function listRdsBackupsForProject(
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
    "rds",
    `/v3/${session.projectId}/backups?${query.toString()}`,
  );

  return asArray(body.backups).map((backup): RdsBackup => {
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

export async function getRdsInstance(session: BetterUiSession, id: string) {
  return mapCloudLoad(
    () => listRdsInstances(session),
    (instances) => instances.find((instance) => instance.id === id) ?? null,
  );
}

export async function getRdsInstanceDetails(
  session: BetterUiSession,
  id: string,
) {
  return mapCloudLoad(
    () => getRdsInstance(session, id),
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
          backups: listRdsBackupsForProject(project, id),
          instance: Promise.resolve(instance),
        },
        { backups: [], instance },
      );
    },
  );
}

export async function runRdsAction(
  session: BetterUiSession,
  id: string,
  action: "reboot",
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  if (action !== "reboot") {
    throw new Error("Unsupported RDS action.");
  }

  return huaweiFetch<{ job_id?: string }>(
    project,
    "rds",
    `/v3/${project.projectId}/instances/${id}/action`,
    {
      body: JSON.stringify({ restart: {} }),
      method: "POST",
    },
  );
}

export async function listRdsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listRdsInstancesForProject);
}
