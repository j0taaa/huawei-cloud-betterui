import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type ApigInstance = {
  createdAt: string;
  edition: string;
  eipAddress: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  subnetId: string;
  version: string;
  vpcId: string;
};

export async function listApigInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "apig",
    `/v2/${session.projectId}/apigw/instances?limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance): ApigInstance => {
    const item = asRecord(instance);

    return {
      createdAt: firstString([
        item.create_time,
        item.created_at,
        item.createdAt,
      ]),
      edition: firstString([item.edition, item.spec, item.instance_type], "-"),
      eipAddress: firstString([item.eip_address, item.eip], "-"),
      id: asString(item.id),
      name: firstString([item.instance_name, item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      subnetId: firstString([item.subnet_id, item.network_id], "-"),
      version: firstString([item.version, item.enterprise_project_id], "-"),
      vpcId: firstString([item.vpc_id, item.router_id], "-"),
    };
  });
}

export async function listApigInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listApigInstancesForProject);
}
