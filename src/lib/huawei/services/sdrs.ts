import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type SdrsProtectedInstance = {
  createdAt: string;
  id: string;
  name: string;
  priorityStation: string;
  projectId: string;
  projectName: string;
  protectedServer: string;
  protectionGroupId: string;
  replicationPairs: number;
  region: string;
  sourceServer: string;
  status: string;
  targetServer: string;
};

export async function listSdrsProtectedInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{
    protected_instances?: unknown[];
    instances?: unknown[];
  }>(
    session,
    "sdrs",
    `/v1/${session.projectId}/protected-instances?limit=1000`,
    {
      items: ["protected_instances", "instances"],
      kind: "offset",
      parameter: "offset",
      size: 1000,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.protected_instances ?? body.instances).map(
    (instance): SdrsProtectedInstance => {
      const item = asRecord(instance);
      const server = asRecord(item.server);
      const target = asRecord(item.target_server);

      return {
        createdAt: firstString([
          item.created_at,
          item.create_time,
          item.createdAt,
        ]),
        id: firstString([item.id, item.protected_instance_id]),
        name: firstString([item.name, item.protected_instance_name, item.id]),
        priorityStation: firstString(
          [item.priority_station, item.primary_site],
          "-",
        ),
        projectId: session.projectId,
        projectName: session.projectName,
        protectedServer: firstString(
          [server.name, server.id, item.server_id],
          "-",
        ),
        protectionGroupId: firstString(
          [item.server_group_id, item.protection_group_id],
          "-",
        ),
        replicationPairs: asArray(
          item.replication_pairs ?? item.replication_pair_ids,
        ).length,
        region: session.region,
        sourceServer: firstString(
          [item.source_server, item.production_server, server.name],
          "-",
        ),
        status: firstString([item.status, item.protected_status], "UNKNOWN"),
        targetServer: firstString(
          [target.name, target.id, item.target_server],
          "-",
        ),
      };
    },
  );
}

export async function listSdrsProtectedInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listSdrsProtectedInstancesForProject);
}
