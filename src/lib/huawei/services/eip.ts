import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type EipItem = {
  associatedInstanceId: string;
  associatedInstanceType: string;
  bandwidthName: string;
  bandwidthSize: string;
  createdAt: string;
  id: string;
  ipAddress: string;
  name: string;
  privateIpAddress: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  type: string;
};

export async function listEipsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ publicips?: unknown[] }>(
    session,
    "eip",
    `/v3/${session.projectId}/eip/publicips?limit=2000`,
    {
      items: ["publicips"],
      kind: "marker",
      parameter: "marker",
      size: 2000,
      next: ["page_info.next_marker", "next_marker"],
    },
  );

  return asArray(body.publicips).map((publicIp): EipItem => {
    const item = asRecord(publicIp);
    const bandwidth = asRecord(item.bandwidth);
    const associate = asRecord(item.associate_instance_info);

    return {
      associatedInstanceId: firstString(
        [item.associate_instance_id, associate.instance_id],
        "",
      ),
      associatedInstanceType: firstString(
        [item.associate_instance_type, associate.instance_type],
        "",
      ),
      bandwidthName: asString(bandwidth.name, "-"),
      bandwidthSize: bandwidth.size ? `${bandwidth.size} Mbit/s` : "-",
      createdAt: firstString([item.created_at, item.createdAt]),
      id: asString(item.id),
      ipAddress: firstString([item.public_ip_address, item.publicip_address]),
      name: firstString([
        item.alias,
        item.name,
        item.public_ip_address,
        item.id,
      ]),
      privateIpAddress: asString(item.private_ip_address, "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      type: firstString([item.type, item.ip_version], "-"),
    };
  });
}

export async function listEips(session: BetterUiSession) {
  return loadAcrossProjects(session, listEipsForProject);
}
