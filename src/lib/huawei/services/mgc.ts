import "server-only";

import { finishCloudLoad, settledValue } from "@/lib/huawei/errors";

import type { BetterUiSession } from "@/lib/auth-session";
import { listCdmClusters } from "@/lib/huawei/services/cdm";
import { listOmsMigrationTasks } from "@/lib/huawei/services/oms";
import { listSmsTasks } from "@/lib/huawei/services/sms";

export type MgcMigrationItem = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  service: "CDM" | "OMS" | "SMS";
  signal: string;
  sizeOrScope: string;
  source: string;
  status: string;
  target: string;
};

export async function listMgcMigrationItems(session: BetterUiSession) {
  const results = await Promise.allSettled([
    listSmsTasks(session),
    listOmsMigrationTasks(session),
    listCdmClusters(session),
  ]);
  const smsTasks = settledValue(results[0], []);
  const omsTasks = settledValue(results[1], []);
  const cdmClusters = settledValue(results[2], []);

  return finishCloudLoad(results, [
    ...smsTasks.map((task): MgcMigrationItem => ({
      id: task.id,
      name: task.name,
      projectId: task.projectId,
      projectName: task.projectName,
      region: task.region,
      service: "SMS",
      signal: task.progress,
      sizeOrScope: task.syncSpeed,
      source: task.sourceServer,
      status: task.state,
      target: task.targetServer,
    })),
    ...omsTasks.map((task): MgcMigrationItem => ({
      id: task.id,
      name: task.name,
      projectId: task.projectId,
      projectName: task.projectName,
      region: task.region,
      service: "OMS",
      signal: task.progress,
      sizeOrScope: task.totalSize,
      source: task.source,
      status: task.status,
      target: task.destination,
    })),
    ...cdmClusters.map((cluster): MgcMigrationItem => ({
      id: cluster.id,
      name: cluster.name,
      projectId: cluster.projectId,
      projectName: cluster.projectName,
      region: cluster.region,
      service: "CDM",
      signal: cluster.mode,
      sizeOrScope: `${cluster.nodeCount} nodes`,
      source: cluster.manageIp,
      status: cluster.status,
      target: cluster.publicEndpoint,
    })),
  ]);
}
