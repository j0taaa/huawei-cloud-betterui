import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type DirectConnectConnection = {
  adminState: string;
  bandwidth: string;
  createdAt: string;
  deviceId: string;
  id: string;
  location: string;
  name: string;
  peerLocation: string;
  portType: string;
  projectId: string;
  projectName: string;
  provider: string;
  providerStatus: string;
  region: string;
  status: string;
  type: string;
  vlan: string;
};

export async function listDirectConnectConnectionsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ direct_connects?: unknown[] }>(
    session,
    "dc",
    `/v3/${session.projectId}/dcaas/direct-connects?limit=100`,
    {
      items: ["direct_connects"],
      kind: "marker",
      parameter: "marker",
      size: 100,
      next: ["page_info.next_marker", "next_marker"],
    },
  );

  return asArray(body.direct_connects).map(
    (connection): DirectConnectConnection => {
      const item = asRecord(connection);

      return {
        adminState: String(item.admin_state_up ?? "-"),
        bandwidth: item.bandwidth ? `${item.bandwidth} Mbit/s` : "-",
        createdAt: firstString([
          item.create_time,
          item.created_at,
          item.apply_time,
        ]),
        deviceId: firstString([item.device_id, item.hosting_id], "-"),
        id: asString(item.id),
        location: firstString([item.location, item.public_border_group], "-"),
        name: firstString([item.name, item.id]),
        peerLocation: firstString(
          [item.peer_location, item.peer_provider],
          "-",
        ),
        portType: firstString(
          [item.port_type, item.peer_port_type, item.spec_code],
          "-",
        ),
        projectId: session.projectId,
        projectName: session.projectName,
        provider: firstString([item.provider, item.peer_provider], "-"),
        providerStatus: firstString(
          [item.provider_status, item.onestopdc_status],
          "-",
        ),
        region: session.region,
        status: asString(item.status, "UNKNOWN"),
        type: firstString([item.type, item.charge_mode], "-"),
        vlan: String(item.vlan ?? "-"),
      };
    },
  );
}

export async function listDirectConnectConnections(session: BetterUiSession) {
  return loadAcrossProjects(session, listDirectConnectConnectionsForProject);
}
