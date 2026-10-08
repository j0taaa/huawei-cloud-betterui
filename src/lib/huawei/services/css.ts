import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  numberWithUnit,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CssCluster = {
  createdAt: string;
  datastore: string;
  endpoint: string;
  id: string;
  name: string;
  nodeCount: number;
  nodeSpec: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
};

export async function listCssClustersForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ clusters?: unknown[] }>(
    session,
    "css",
    `/v1.0/${session.projectId}/clusters?limit=100`,
    {
      items: ["clusters"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.clusters).map((cluster): CssCluster => {
    const item = asRecord(cluster);
    const datastore = asRecord(item.datastore);
    const instances = asArray(item.instances ?? item.nodes);
    const firstNode = asRecord(instances[0]);
    const volume = asRecord(firstNode.volume ?? item.volume);

    return {
      createdAt: firstString([item.created, item.created_at, item.create_time]),
      datastore:
        [datastore.type, datastore.version].filter(Boolean).join(" ") || "-",
      endpoint: firstString(
        [
          item.endpoint,
          item.privateEndpoint,
          item.private_ip,
          item.publicKibanaResp,
        ],
        "-",
      ),
      id: firstString([item.id, item.cluster_id]),
      name: firstString([item.name, item.cluster_name, item.id]),
      nodeCount: Number(item.nodeNum ?? item.node_num ?? instances.length),
      nodeSpec: firstString(
        [
          item.nodeType,
          item.node_type,
          firstNode.flavorRef,
          firstNode.flavor_ref,
        ],
        "-",
      ),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      storage: numberWithUnit(
        volume.size ?? item.volume_size ?? item.storage_size,
        "GB",
      ),
    };
  });
}

export async function listCssClusters(session: BetterUiSession) {
  return loadAcrossProjects(session, listCssClustersForProject);
}
