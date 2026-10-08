import "server-only";

import { mapCloudLoad } from "@/lib/huawei/errors";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CceCluster = {
  id: string;
  name: string;
  status: string;
  type: string;
  version: string;
  projectId: string;
  projectName: string;
  region: string;
};

export async function listCceClustersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ items?: unknown[] }>(
    session,
    "cce",
    `/api/v3/projects/${session.projectId}/clusters`,
  );

  return asArray(body.items).map((cluster): CceCluster => {
    const item = asRecord(cluster);
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    return {
      id: asString(metadata.uid ?? metadata.id),
      name: asString(metadata.name),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(status.phase, "UNKNOWN"),
      type: asString(spec.type),
      version: asString(spec.version),
    };
  });
}

export async function getCceCluster(session: BetterUiSession, id: string) {
  return mapCloudLoad(
    () => listCceClusters(session),
    (clusters) => clusters.find((cluster) => cluster.id === id) ?? null,
  );
}

export async function listCceClusters(session: BetterUiSession) {
  return loadAcrossProjects(session, listCceClustersForProject);
}
