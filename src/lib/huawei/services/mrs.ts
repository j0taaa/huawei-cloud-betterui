import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  firstString,
  timestampSeconds,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type MrsCluster = {
  billingType: string;
  components: string;
  createdAt: string;
  coreNodes: number;
  hadoopVersion: string;
  id: string;
  masterNodes: number;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  totalNodes: number;
  vpcId: string;
};

export async function listMrsClustersForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ clusters?: unknown[] }>(
    session,
    "mrs",
    `/v1.1/${session.projectId}/cluster_infos?pageSize=100&currentPage=1&clusterState=existing`,
    {
      items: ["clusters"],
      kind: "page",
      parameter: "currentPage",
      size: 100,
      first: 1,
    },
  );

  return asArray(body.clusters).map((cluster): MrsCluster => {
    const item = asRecord(cluster);
    const components = asArray(item.componentList ?? item.components)
      .map((component) => {
        const record = asRecord(component);
        return firstString(
          [record.componentName, record.name, record.component_name],
          "",
        );
      })
      .filter(Boolean)
      .join(", ");

    return {
      billingType: firstString([item.billingType, item.billing_type], "-"),
      components: components || "-",
      coreNodes: Number(item.coreNodeNum ?? item.core_node_num ?? 0),
      createdAt: timestampSeconds(item.createAt ?? item.created_at),
      hadoopVersion: firstString(
        [item.hadoopVersion, item.hadoop_version],
        "-",
      ),
      id: firstString([item.clusterId, item.id]),
      masterNodes: Number(item.masterNodeNum ?? item.master_node_num ?? 0),
      name: firstString([item.clusterName, item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.clusterState, item.status], "UNKNOWN"),
      totalNodes: Number(item.totalNodeNum ?? item.total_node_num ?? 0),
      vpcId: firstString([item.vpcId, item.vpc_id], "-"),
    };
  });
}

export async function listMrsClusters(session: BetterUiSession) {
  return loadAcrossProjects(session, listMrsClustersForProject);
}
