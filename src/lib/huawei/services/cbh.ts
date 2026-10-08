import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
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
  const body = await huaweiList<{
    instance?: unknown[];
    instances?: unknown[];
  }>(session, "cbh", `/v2/${session.projectId}/cbs/instance/list?limit=100`, {
    items: ["instance", "instances"],
    kind: "offset",
    parameter: "offset",
    size: 100,
    total: ["total"],
  });

  return asArray(body.instance ?? body.instances).map(
    (instance): CbhInstance => {
      const item = asRecord(instance);
      const az = asRecord(item.az_info);
      const status = asRecord(item.status_info);
      const network = asRecord(item.network);

      return {
        availabilityZone: firstString(
          [az.zone_name, az.availability_zone, item.availability_zone],
          "-",
        ),
        bastionVersion: firstString([item.bastion_version, item.version], "-"),
        createdAt: firstString([
          item.created_time,
          item.create_time,
          item.createdAt,
        ]),
        enterpriseProjectId: asString(item.enterprise_project_id, "-"),
        id: firstString([item.instance_id, item.id]),
        name: firstString([item.name, item.instance_name, item.id]),
        privateIp: firstString([network.private_ip, item.private_ip], "-"),
        projectId: session.projectId,
        projectName: session.projectName,
        publicIp: firstString([network.public_ip, item.public_ip], "-"),
        region: session.region,
        serverId: firstString([item.server_id, item.resource_id], "-"),
        status: firstString([status.status, item.status], "UNKNOWN"),
        updateStatus: firstString([item.update, item.upgrade_status], "-"),
      };
    },
  );
}

export async function listCbhInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listCbhInstancesForProject);
}
