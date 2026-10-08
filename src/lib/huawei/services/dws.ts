import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

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

export async function listDwsClustersForProject(session: HuaweiProjectSession) {
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
      availabilityZone: firstString(
        [item.availability_zone, item.az_code],
        "-",
      ),
      createdAt: firstString([item.created, item.created_at, item.create_time]),
      endpoint: firstString(
        [
          firstEndpoint.connect_info,
          firstEndpoint.ip,
          item.private_ip,
          item.public_ip,
        ],
        "-",
      ),
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
