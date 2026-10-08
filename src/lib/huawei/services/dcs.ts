import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type DcsRedisInstance = {
  availabilityZones: string[];
  chargingMode: string;
  nodeCount: number | null;
  resourceSpecCode: string;
  securityGroupId: string;
  subnetId: string;
  capacity: string;
  createdAt: string;
  engine: string;
  engineVersion: string;
  id: string;
  ip: string;
  mode: string;
  name: string;
  port: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  usedMemory: string;
  vpcId: string;
};

export async function listDcsRedisInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "dcs",
    `/v2/${session.projectId}/instances?offset=0&limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance): DcsRedisInstance => {
    const item = asRecord(instance);

    return {
      availabilityZones: asArray(item.available_zones ?? item.az_codes).map(
        String,
      ),
      chargingMode: String(item.charging_mode ?? "-"),
      nodeCount: item.node_count == null ? null : Number(item.node_count),
      resourceSpecCode: asString(item.resource_spec_code),
      securityGroupId: asString(item.security_group_id),
      subnetId: asString(item.subnet_id),
      capacity: `${Number(item.capacity ?? item.max_memory ?? 0)} GB`,
      createdAt: firstString([item.created_at, item.createdAt]),
      engine: asString(item.engine, "Redis"),
      engineVersion: firstString([item.engine_version, item.version], "-"),
      id: asString(item.instance_id ?? item.id),
      ip: firstString([item.ip, item.address, item.publicip_address], "-"),
      mode: firstString([item.cache_mode, item.mode], "-"),
      name: firstString([item.name, item.instance_name, item.id]),
      port: String(item.port ?? "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      usedMemory: item.used_memory ? `${item.used_memory} MB` : "-",
      vpcId: asString(item.vpc_id, "-"),
    };
  });
}

export async function listDcsRedisInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDcsRedisInstancesForProject);
}
