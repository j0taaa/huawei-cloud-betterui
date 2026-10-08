import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { parseRelationalDbInstance } from "@/lib/huawei/database-parsers";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type TaurusDbInstance = {
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

export async function listTaurusDbInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "taurusdb",
    `/v3/${session.projectId}/instances?limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance): TaurusDbInstance => {
    const parsed = parseRelationalDbInstance(instance, session);
    const item = asRecord(instance);

    return {
      ...parsed,
      datastore: parsed.datastore === "-" ? "TaurusDB" : parsed.datastore,
      vpcId: firstString([item.vpc_id, item.vpcId], "-"),
    };
  });
}

export async function listTaurusDbInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listTaurusDbInstancesForProject);
}
