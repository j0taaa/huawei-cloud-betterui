import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type WafInstance = {
  accessCode: string;
  accessStatus: string;
  createdAt: string;
  hostname: string;
  id: string;
  policyId: string;
  projectId: string;
  projectName: string;
  protectStatus: string;
  proxy: string;
  region: string;
};

export async function listWafInstancesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ items?: unknown[] }>(
    session,
    "waf",
    `/v1/${session.projectId}/waf/instance?page=1&pagesize=100`,
    { items: ["items"], kind: "page", parameter: "page", size: 100, first: 1 },
  );

  return asArray(body.items).map((host): WafInstance => {
    const item = asRecord(host);

    return {
      accessCode: asString(item.access_code, "-"),
      accessStatus: String(item.access_status ?? "-"),
      createdAt: item.timestamp
        ? new Date(Number(item.timestamp)).toISOString()
        : "",
      hostname: firstString([item.hostname, item.name]),
      id: firstString([item.id, item.hostid, item.hostname]),
      policyId: asString(item.policyid, "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      protectStatus: String(item.protect_status ?? "-"),
      proxy: String(item.proxy ?? "-"),
      region: firstString([item.region, session.region]),
    };
  });
}

export async function listWafInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listWafInstancesForProject);
}
