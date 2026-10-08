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

export type DdsInstance = {
  availabilityZone: string;
  backupWindow: string;
  datastore: string;
  id: string;
  mode: string;
  name: string;
  nodes: number;
  port: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  vpcId: string;
};

export async function listDdsInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "dds",
    `/v3/${session.projectId}/instances?limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance): DdsInstance => {
    const item = asRecord(instance);
    const datastore = asRecord(item.datastore);
    const volume = asRecord(item.volume);

    return {
      availabilityZone: firstString(
        [item.az_code, item.availability_zone, item.availability_zone_mode],
        "-",
      ),
      backupWindow: backupWindow(item.backup_strategy),
      datastore:
        [datastore.type, datastore.version].filter(Boolean).join(" ") || "DDS",
      id: firstString([item.id, item.instance_id]),
      mode: firstString([item.mode, item.instance_mode, item.type], "-"),
      name: firstString([item.name, item.instance_name, item.id]),
      nodes: nodeCount(item.nodes ?? item.groups),
      port: String(item.port ?? item.db_port ?? "-"),
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

export async function listDdsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDdsInstancesForProject);
}
