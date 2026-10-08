import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type VpnConnection = {
  cgwId: string;
  connectionMonitorId: string;
  createdAt: string;
  customerGatewayId: string;
  enterpriseProjectId: string;
  haRole: string;
  id: string;
  localSubnets: string;
  name: string;
  peerSubnets: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  style: string;
  tunnelLocalAddress: string;
  tunnelPeerAddress: string;
  updatedAt: string;
  vgwId: string;
  vgwIp: string;
  vpnGatewayId: string;
};

export async function listVpnConnectionsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ vpn_connections?: unknown[] }>(
    session,
    "vpn",
    `/v5/${session.projectId}/vpn-connection?limit=2000`,
    {
      items: ["vpn_connections"],
      kind: "marker",
      parameter: "marker",
      size: 2000,
      next: ["page_info.next_marker"],
    },
  );

  return asArray(body.vpn_connections).map((connection): VpnConnection => {
    const item = asRecord(connection);
    const policyRules = asArray(item.policy_rules);
    const firstRule = asRecord(policyRules[0]);
    const localSubnets = asArray(firstRule.local_subnets ?? item.local_subnets)
      .map((value) => String(value))
      .join(", ");
    const peerSubnets = asArray(firstRule.peer_subnets ?? item.peer_subnets)
      .map((value) => String(value))
      .join(", ");

    return {
      cgwId: firstString([item.cgw_id, item.customer_gateway_id]),
      connectionMonitorId: firstString(
        [item.connection_monitor_id, item.monitor_id],
        "-",
      ),
      createdAt: firstString([item.created_at, item.createdAt]),
      customerGatewayId: firstString([item.cgw_id, item.customer_gateway_id]),
      enterpriseProjectId: asString(item.enterprise_project_id, "-"),
      haRole: asString(item.ha_role, "-"),
      id: asString(item.id),
      localSubnets: localSubnets || "-",
      name: firstString([item.name, item.id]),
      peerSubnets: peerSubnets || "-",
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      style: asString(item.style, "-"),
      tunnelLocalAddress: firstString(
        [item.tunnel_local_address, item.local_gateway_ip],
        "-",
      ),
      tunnelPeerAddress: firstString(
        [item.tunnel_peer_address, item.peer_gateway_ip],
        "-",
      ),
      updatedAt: firstString([
        item.updated_at,
        item.created_at,
        item.createdAt,
      ]),
      vgwId: firstString([item.vgw_id, item.vpn_gateway_id]),
      vgwIp: firstString([item.vgw_ip, item.gateway_ip], "-"),
      vpnGatewayId: firstString([item.vgw_id, item.vpn_gateway_id]),
    };
  });
}

export async function listVpnConnections(session: BetterUiSession) {
  return loadAcrossProjects(session, listVpnConnectionsForProject);
}
