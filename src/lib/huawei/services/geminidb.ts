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
  sessionProjects,
} from "@/lib/huawei/core";
import { firstIpFromValues } from "@/lib/huawei/database-cache-helpers";
import type { GeminiDbInstance } from "@/lib/huawei/services/geminidb.types";

export type GeminiDbBackupPolicy = {
  keepDays: string;
  period: string;
  startTime: string;
};

export type GeminiDbBackup = {
  createdAt: string;
  datastore: string;
  description: string;
  finishedAt: string;
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

export type GeminiDbDetails = {
  backups: GeminiDbBackup[];
  backupPolicy: GeminiDbBackupPolicy | null;
  instance: GeminiDbInstance;
};

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

  if (start && end && !start.includes("-")) {
    return `${start}-${end}`;
  }

  return firstString([strategy.start_time, strategy.period], "-");
}

function formatPayMode(value: unknown) {
  if (value === 0 || value === "0") return "Pay-per-use";
  if (value === 1 || value === "1") return "Yearly/Monthly";
  return firstString([value], "-");
}

function valueString(value: unknown, fallback = "-") {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return firstString([value], fallback);
}

function firstDisplayValue(values: string[]) {
  return values.find((value) => value !== "-") ?? "-";
}

function parseGeminiDbInstance(
  instance: unknown,
  session: HuaweiProjectSession,
): GeminiDbInstance {
  const item = asRecord(instance);
  const datastore = asRecord(item.datastore);
  const backupStrategy = asRecord(item.backup_strategy ?? item.backupStrategy);
  const groups = asArray(item.groups).map((group) => {
    const groupRecord = asRecord(group);
    const volume = asRecord(groupRecord.volume);
    const nodes = asArray(groupRecord.nodes).map((node) => {
      const nodeRecord = asRecord(node);

      return {
        availabilityZone: firstString(
          [nodeRecord.availability_zone, nodeRecord.az_code],
          "-",
        ),
        id: firstString([nodeRecord.id, nodeRecord.node_id], "-"),
        name: firstString(
          [nodeRecord.name, nodeRecord.node_name, nodeRecord.id],
          "-",
        ),
        privateIp: firstIpFromValues([
          nodeRecord.private_ips,
          nodeRecord.private_ip,
          nodeRecord.private_ip_address,
        ]),
        publicIp: firstIpFromValues([
          nodeRecord.public_ips,
          nodeRecord.public_ip,
        ]),
        role: firstString([nodeRecord.role, nodeRecord.type], "-"),
        specCode: firstString([nodeRecord.spec_code, nodeRecord.flavor], "-"),
        status: firstString([nodeRecord.status, nodeRecord.node_status], "-"),
        subnetId: firstString([nodeRecord.subnet_id, nodeRecord.subnetId], "-"),
      };
    });

    return {
      id: firstString([groupRecord.id, groupRecord.group_id], "-"),
      nodes,
      status: firstString([groupRecord.status], "-"),
      volumeSize: numberWithUnit(volume.size, "GB"),
      volumeUsed: numberWithUnit(volume.used, "GB"),
    };
  });
  const firstGroup = groups[0];
  const nodes = groups.flatMap((group) => group.nodes);
  const volume = asRecord(item.volume);
  const storage = firstDisplayValue([
    numberWithUnit(volume.size ?? item.volume_size ?? item.storage_size, "GB"),
    firstGroup?.volumeSize ?? "-",
  ]);
  const privateIp = firstIpFromValues([
    item.private_ips,
    item.private_ip,
    item.private_ip_address,
    item.lb_ip_address,
    nodes.map((node) => node.privateIp).find((ip) => ip !== "-"),
  ]);

  return {
    actions: asArray(item.actions).filter(
      (action): action is string => typeof action === "string",
    ),
    apiType: firstString([datastore.type, item.datastore_type, item.type], "-"),
    availabilityZone: firstString(
      [
        item.availability_zone,
        item.az_code,
        nodes.map((node) => node.availabilityZone).find((zone) => zone !== "-"),
      ],
      "-",
    ),
    backupKeepDays: valueString(backupStrategy.keep_days),
    backupPeriod: firstString([backupStrategy.period], "-"),
    backupWindow: backupWindow(backupStrategy),
    createdAt: firstString(
      [item.created, item.created_at, item.create_time],
      "-",
    ),
    datastore: datastoreName(datastore, item.datastore_type),
    dbUserName: firstString([item.db_user_name, item.user_name], "-"),
    engine: firstString([item.engine], "-"),
    enterpriseProjectId: firstString([item.enterprise_project_id], "-"),
    groupCount: groups.length,
    groups,
    id: firstString([item.id, item.instance_id]),
    lbIpAddress: firstString([item.lb_ip_address], "-"),
    lbPort: String(item.lb_port ?? "-"),
    maintenanceWindow: firstString([item.maintenance_window], "-"),
    mode: firstString([item.mode, item.instance_mode], "-"),
    name: firstString([item.name, item.instance_name, item.id]),
    nodeCount: nodes.length || Number(item.node_count ?? 0) || 0,
    patchAvailable:
      typeof datastore.patch_available === "boolean"
        ? datastore.patch_available
          ? "Yes"
          : "No"
        : "-",
    payMode: formatPayMode(item.pay_mode ?? item.charge_mode),
    privateIp,
    projectId: session.projectId,
    projectName: session.projectName,
    publicIp: firstIpFromValues([
      item.public_ips,
      item.public_ip,
      nodes.map((node) => node.publicIp).find((ip) => ip !== "-"),
    ]),
    region: session.region,
    securityGroupId: firstString(
      [
        item.security_group_id,
        asArray(item.security_group_ids).find(
          (securityGroupId) => typeof securityGroupId === "string",
        ),
      ],
      "-",
    ),
    status: firstString([item.status, item.instance_status], "UNKNOWN"),
    storage,
    subnetId: firstString(
      [item.subnet_id, item.subnetId, firstGroup?.nodes[0]?.subnetId],
      "-",
    ),
    timeZone: firstString([item.time_zone], "-"),
    updatedAt: firstString(
      [item.updated, item.updated_at, item.update_time],
      "-",
    ),
    volumeUsed: firstDisplayValue([
      numberWithUnit(volume.used ?? item.volume_used, "GB"),
      firstGroup?.volumeUsed ?? "-",
    ]),
    vpcId: firstString([item.vpc_id, item.vpcId], "-"),
  };
}

export async function listGeminiDbInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "geminidb",
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
    parseGeminiDbInstance(instance, session),
  );
}

async function getGeminiDbInstanceForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const query = new URLSearchParams({ id, limit: "1" });
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "geminidb",
    `/v3/${session.projectId}/instances?${query.toString()}`,
  );
  const instance = asArray(body.instances)[0];

  return instance ? parseGeminiDbInstance(instance, session) : null;
}

async function getGeminiDbBackupPolicyForProject(
  session: HuaweiProjectSession,
  instanceId: string,
): Promise<GeminiDbBackupPolicy | null> {
  const body = await huaweiFetch<{ backup_policy?: unknown }>(
    session,
    "geminidb",
    `/v3.1/${session.projectId}/instances/${instanceId}/backups/policy`,
  );
  const policy = asRecord(body.backup_policy);

  return {
    keepDays: valueString(policy.keep_days),
    period: firstString([policy.period], "-"),
    startTime: firstString([policy.start_time], "-"),
  };
}

export async function listGeminiDbBackupsForProject(
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
    "geminidb",
    `/v3.1/${session.projectId}/backups?${query.toString()}`,
  );

  return asArray(body.backups).map((backup): GeminiDbBackup => {
    const item = asRecord(backup);
    const datastore = asRecord(item.datastore);

    return {
      datastore:
        [datastore.type, datastore.version].filter(Boolean).join(" ") || "-",
      createdAt: firstString(
        [item.created, item.created_at, item.begin_time],
        "-",
      ),
      description: firstString([item.description], "-"),
      finishedAt: firstString([item.finished_at, item.end_time], "-"),
      id: firstString([item.id, item.backup_id], "-"),
      instanceId: firstString([item.instance_id], instanceId),
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

export async function getGeminiDbInstance(
  session: BetterUiSession,
  id: string,
) {
  const results = await Promise.allSettled(
    sessionProjects(session).map((project) =>
      getGeminiDbInstanceForProject(project, id),
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

export async function getGeminiDbDetails(
  session: BetterUiSession,
  id: string,
): Promise<GeminiDbDetails | null> {
  return mapCloudLoad(
    () => getGeminiDbInstance(session, id),
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
          backups: listGeminiDbBackupsForProject(project, id),
          backupPolicy: getGeminiDbBackupPolicyForProject(project, id),
          instance: Promise.resolve(instance),
        },
        { backups: [], backupPolicy: null, instance },
      );
    },
  );
}

export async function runGeminiDbAction(
  session: BetterUiSession,
  id: string,
  action: "restart",
  projectId: string,
) {
  const postMethod = "POST";
  const project = sessionProjects(session).find(
    (item) => item.projectId === projectId,
  );

  if (!project) {
    throw new Error("Project id does not match the signed-in projects.");
  }

  if (action !== "restart") {
    throw new Error("Unsupported GeminiDB action.");
  }

  return huaweiFetch<{ job_id?: string }>(
    project,
    "geminidb",
    `/v3/${project.projectId}/instances/${id}/restart`,
    {
      body: JSON.stringify({}),
      method: postMethod,
    },
  );
}

export async function listGeminiDbInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listGeminiDbInstancesForProject);
}

export type * from "@/lib/huawei/services/geminidb.types";
