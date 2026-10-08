import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CdmCluster = {
  createdAt: string;
  flavor: string;
  id: string;
  manageIp: string;
  mode: string;
  name: string;
  nodeCount: number;
  projectId: string;
  projectName: string;
  publicEndpoint: string;
  region: string;
  status: string;
  statusDetail: string;
  version: string;
};

export async function listCdmClustersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ clusters?: unknown[] }>(
    session,
    "cdm",
    `/v1.1/${session.projectId}/clusters`,
  );

  return asArray(body.clusters).map((cluster): CdmCluster => {
    const item = asRecord(cluster);
    const datastore = asRecord(item.datastore);
    const instances = asArray(item.instances);
    const firstInstance = asRecord(instances[0]);

    return {
      createdAt: firstString([item.created, item.created_at, item.create_time]),
      flavor: firstString(
        [item.flavorName, item.flavor_name, item.flavor],
        "-",
      ),
      id: firstString([item.id, item.cluster_id]),
      manageIp: firstString(
        [firstInstance.manageIp, firstInstance.manage_ip, item.manageIp],
        "-",
      ),
      mode: firstString([item.clusterMode, item.cluster_mode, item.mode], "-"),
      name: firstString([item.name, item.cluster_name, item.id]),
      nodeCount: instances.length,
      projectId: session.projectId,
      projectName: session.projectName,
      publicEndpoint: firstString(
        [item.publicEndpoint, item.public_endpoint],
        "-",
      ),
      region: session.region,
      status: String(item.status ?? "UNKNOWN"),
      statusDetail: firstString([item.statusDetail, item.status_detail], "-"),
      version: firstString([datastore.version, item.version], "-"),
    };
  });
}

export async function listCdmClusters(session: BetterUiSession) {
  return loadAcrossProjects(session, listCdmClustersForProject);
}
