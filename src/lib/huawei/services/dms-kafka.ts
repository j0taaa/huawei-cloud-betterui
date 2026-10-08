import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type DmsKafkaInstance = {
  usedStorageSpace: string;
  storageSpecCode: string;
  partitionNum: number | null;
  securityGroupId: string;
  sslConnectAddress: string;
  publicConnectAddress: string;
  availabilityZones: string;
  brokerCount: number;
  connectAddress: string;
  createdAt: string;
  engineVersion: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  storage: string;
  subnetId: string;
  vpcId: string;
};

export async function listDmsKafkaInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "dms",
    `/v2/${session.projectId}/instances?engine=kafka&limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance): DmsKafkaInstance => {
    const item = asRecord(instance);
    const storage = Number(item.storage_space ?? item.storage ?? 0);

    return {
      usedStorageSpace:
        item.used_storage_space == null ? "-" : `${item.used_storage_space} GB`,
      storageSpecCode: asString(item.storage_spec_code),
      partitionNum:
        item.partition_num == null ? null : Number(item.partition_num),
      securityGroupId: asString(item.security_group_id),
      sslConnectAddress: asString(item.ssl_connect_address),
      publicConnectAddress: asString(item.public_connect_address),
      availabilityZones:
        asArray(item.available_zones ?? item.availability_zones).join(", ") ||
        "-",
      brokerCount: Number(item.broker_num ?? item.broker_count ?? 0),
      connectAddress: firstString(
        [
          item.connect_address,
          item.public_connect_address,
          item.management_connect_address,
        ],
        "-",
      ),
      createdAt: firstString([
        item.created_at,
        item.create_time,
        item.createdAt,
      ]),
      engineVersion: firstString([item.engine_version, item.version], "-"),
      id: asString(item.instance_id ?? item.id),
      name: firstString([item.name, item.instance_name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      storage: storage ? `${storage} GB` : "-",
      subnetId: asString(item.subnet_id, "-"),
      vpcId: asString(item.vpc_id, "-"),
    };
  });
}

export async function listDmsKafkaInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDmsKafkaInstancesForProject);
}
