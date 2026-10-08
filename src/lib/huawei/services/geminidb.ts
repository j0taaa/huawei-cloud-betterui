import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  backupWindow,
  firstIpFromValues,
  nodeCount,
} from "@/lib/huawei/database-parsers";
import { huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  firstString,
  numberWithUnit,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type GeminiDbInstance = {
  apiType: string;
  backupWindow: string;
  datastore: string;
  groupCount: number;
  id: string;
  mode: string;
  name: string;
  nodeCount: number;
  privateIp: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  vpcId: string;
};

export async function listGeminiDbInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "geminidb",
    `/v3/${session.projectId}/instances?limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance): GeminiDbInstance => {
    const item = asRecord(instance);
    const datastore = asRecord(item.datastore);
    const groups = asArray(item.groups);
    const groupNodes = groups.reduce((total, group) => {
      const record = asRecord(group);
      return total + asArray(record.nodes).length;
    }, 0);
    const firstGroup = asRecord(groups[0]);
    const volume = asRecord(item.volume ?? firstGroup.volume);

    return {
      apiType: firstString(
        [datastore.type, item.datastore_type, item.type],
        "-",
      ),
      backupWindow: backupWindow(item.backup_strategy),
      datastore:
        [datastore.type, datastore.version].filter(Boolean).join(" ") || "-",
      groupCount: groups.length,
      id: firstString([item.id, item.instance_id]),
      mode: firstString([item.mode, item.instance_mode], "-"),
      name: firstString([item.name, item.instance_name, item.id]),
      nodeCount: groupNodes || nodeCount(item.nodes ?? item.node_count),
      privateIp: firstIpFromValues([
        item.private_ips,
        item.private_ip,
        item.private_ip_address,
      ]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.status, item.instance_status], "UNKNOWN"),
      storage: numberWithUnit(
        volume.size ?? item.volume_size ?? item.storage_size,
        "GB",
      ),
      vpcId: firstString([item.vpc_id, item.vpcId], "-"),
    };
  });
}

export async function listGeminiDbInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listGeminiDbInstancesForProject);
}
