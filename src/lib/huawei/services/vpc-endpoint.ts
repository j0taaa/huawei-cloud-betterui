import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type VpcEndpoint = {
  createdAt: string;
  dnsEnabled: string;
  endpointServiceName: string;
  id: string;
  ip: string;
  markerId: string;
  networkId: string;
  projectId: string;
  projectName: string;
  region: string;
  serviceType: string;
  status: string;
  subnetId: string;
  vpcId: string;
};

export async function listVpcEndpointsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ endpoints?: unknown[] }>(
    session,
    "vpcep",
    `/v1/${session.projectId}/vpc-endpoints?limit=1000`,
    {
      items: ["endpoints"],
      kind: "offset",
      parameter: "offset",
      size: 1000,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.endpoints).map((endpoint): VpcEndpoint => {
    const item = asRecord(endpoint);

    return {
      createdAt: firstString([item.created_at, item.createdAt]),
      dnsEnabled: String(item.enable_dns ?? "-"),
      endpointServiceName: firstString(
        [item.endpoint_service_name, item.service_name],
        "-",
      ),
      id: asString(item.id),
      ip: firstString([item.ip, item.private_ip_address], "-"),
      markerId: String(item.marker_id ?? "-"),
      networkId: firstString([item.network_id, item.port_id], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      serviceType: firstString([item.service_type, item.endpoint_type], "-"),
      status: asString(item.status, "UNKNOWN"),
      subnetId: asString(item.subnet_id, "-"),
      vpcId: asString(item.vpc_id, "-"),
    };
  });
}

export async function listVpcEndpoints(session: BetterUiSession) {
  return loadAcrossProjects(session, listVpcEndpointsForProject);
}
