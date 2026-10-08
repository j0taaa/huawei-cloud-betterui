import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type NatGateway = {
  createdAt: string;
  description: string;
  enterpriseProjectId: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  routerId: string;
  spec: string;
  status: string;
  subnetId: string;
  type: string;
  vpcId: string;
};

export async function listNatGatewaysForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ nat_gateways?: unknown[] }>(
    session,
    "nat",
    `/v2/${session.projectId}/nat_gateways?limit=1000`,
    {
      items: ["nat_gateways"],
      kind: "marker",
      parameter: "marker",
      size: 1000,
      next: ["page_info.next_marker", "next_marker"],
      fallbackKey: "id",
    },
  );

  return asArray(body.nat_gateways).map((gateway): NatGateway => {
    const item = asRecord(gateway);

    return {
      createdAt: firstString([item.created_at, item.createdAt]),
      description: asString(item.description, ""),
      enterpriseProjectId: asString(item.enterprise_project_id, "-"),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      routerId: firstString([item.router_id, item.vpc_id]),
      spec: firstString([item.spec, item.specification], "-"),
      status: asString(item.status, "UNKNOWN"),
      subnetId: firstString([
        item.internal_network_id,
        item.network_id,
        item.subnet_id,
      ]),
      type: firstString([item.type, item.gateway_type], "-"),
      vpcId: firstString([item.vpc_id, item.router_id]),
    };
  });
}

export async function listNatGateways(session: BetterUiSession) {
  return loadAcrossProjects(session, listNatGatewaysForProject);
}
