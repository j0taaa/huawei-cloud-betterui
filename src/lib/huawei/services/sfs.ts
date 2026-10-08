import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type SfsShare = {
  availabilityZone: string;
  createdAt: string;
  exportLocation: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  protocol: string;
  region: string;
  shareType: string;
  size: string;
  status: string;
};

export async function listSfsSharesForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ shares?: unknown[] }>(
    session,
    "sfs",
    `/v2/${session.projectId}/shares/detail?limit=100`,
    {
      items: ["shares"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
    {
      headers: {
        Accept: "application/json",
        "X-Openstack-Manila-Api-Version": "2.9",
      },
    },
  );

  return asArray(body.shares).map((share): SfsShare => {
    const item = asRecord(share);
    const exportLocations = asArray(item.export_locations);
    const firstExport = asRecord(exportLocations[0]);

    return {
      availabilityZone: asString(item.availability_zone),
      createdAt: firstString([item.created_at, item.createdAt]),
      exportLocation: firstString(
        [item.export_location, firstExport.path, firstExport.export_location],
        "-",
      ),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      protocol: asString(item.share_proto),
      region: session.region,
      shareType: firstString([item.share_type, item.share_type_name]),
      size: `${Number(item.size ?? 0)} GB`,
      status: asString(item.status, "UNKNOWN"),
    };
  });
}

export async function listSfsShares(session: BetterUiSession) {
  return loadAcrossProjects(session, listSfsSharesForProject);
}
