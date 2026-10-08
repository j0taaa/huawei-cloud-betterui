import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { parseRelationalDbInstance } from "@/lib/huawei/database-parsers";
import { huaweiList } from "@/lib/huawei/http";
import { asArray } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type GaussDbInstance = {
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
  type: string;
};

export async function listGaussDbInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "gaussdb",
    `/v3/${session.projectId}/instances?limit=100`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.instances).map((instance) =>
    parseRelationalDbInstance(instance, session),
  );
}

export async function listGaussDbInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listGaussDbInstancesForProject);
}
