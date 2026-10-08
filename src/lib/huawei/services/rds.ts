import "server-only";

import { mapCloudLoad } from "@/lib/huawei/errors";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type RdsInstance = {
  datastore: string;
  id: string;
  name: string;
  privateIp: string;
  status: string;
  type: string;
  projectId: string;
  projectName: string;
  region: string;
};

export async function listRdsInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "rds",
    `/v3/${session.projectId}/instances?limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance): RdsInstance => {
    const item = asRecord(instance);
    const datastore = asRecord(item.datastore);
    return {
      datastore: firstString([datastore.type, item.datastore_type]),
      id: asString(item.id),
      name: asString(item.name),
      privateIp: firstString(asArray(item.private_ips), "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      type: asString(item.type),
    };
  });
}

export async function getRdsInstance(session: BetterUiSession, id: string) {
  return mapCloudLoad(
    () => listRdsInstances(session),
    (instances) => instances.find((instance) => instance.id === id) ?? null,
  );
}

export async function listRdsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listRdsInstancesForProject);
}
