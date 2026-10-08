import "server-only";

import { mapCloudLoad } from "@/lib/huawei/errors";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type ElbItem = {
  id: string;
  name: string;
  operatingStatus: string;
  provisioningStatus: string;
  vipAddress: string;
  projectId: string;
  projectName: string;
  region: string;
};

export async function listElbsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ loadbalancers?: unknown[] }>(
    session,
    "elb",
    `/v3/${session.projectId}/elb/loadbalancers?limit=100`,
    {
      items: ["loadbalancers"],
      kind: "marker",
      parameter: "marker",
      size: 100,
      next: ["page_info.next_marker", "next_marker"],
    },
  );

  return asArray(body.loadbalancers).map((loadBalancer): ElbItem => {
    const item = asRecord(loadBalancer);
    return {
      id: asString(item.id),
      name: asString(item.name),
      operatingStatus: asString(item.operating_status, "UNKNOWN"),
      projectId: session.projectId,
      projectName: session.projectName,
      provisioningStatus: asString(item.provisioning_status, "UNKNOWN"),
      region: session.region,
      vipAddress: asString(item.vip_address),
    };
  });
}

export async function getElb(session: BetterUiSession, id: string) {
  return mapCloudLoad(
    () => listElbs(session),
    (elbs) => elbs.find((elb) => elb.id === id) ?? null,
  );
}

export async function listElbs(session: BetterUiSession) {
  return loadAcrossProjects(session, listElbsForProject);
}
