import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { listNativeCbhInstances } from "./cbh-native";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CbhInstance = {
  availabilityZone: string;
  bastionVersion: string;
  createdAt: string;
  enterpriseProjectId: string;
  id: string;
  name: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  publicIp: string;
  region: string;
  serverId: string;
  status: string;
  updateStatus: string;
};

export async function listCbhInstancesForProject(
  session: HuaweiProjectSession,
) {
  return (await listNativeCbhInstances(session)).map((item): CbhInstance => ({
    availabilityZone: item.zone || "-",
    bastionVersion: item.version || "-",
    createdAt: item.createdTime,
    enterpriseProjectId: item.enterpriseProjectId || "-",
    id: item.instanceId || item.serverId,
    name: item.name,
    privateIp: item.privateIp || "-",
    projectId: session.projectId,
    projectName: session.projectName,
    publicIp: item.publicIp || "-",
    region: session.region,
    serverId: item.serverId,
    status: item.status,
    updateStatus: item.updateFlag || "UNKNOWN",
  }));
}

export async function listCbhInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listCbhInstancesForProject);
}
