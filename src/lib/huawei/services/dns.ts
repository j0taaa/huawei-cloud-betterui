import "server-only";

import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { sessionProjects } from "@/lib/huawei/projects";

export type DnsZone = {
  createdAt: string;
  description: string;
  id: string;
  name: string;
  projectId: string;
  recordCount: number;
  status: string;
  ttl: string;
  type: string;
  updatedAt: string;
};

export async function listDnsZones(session: BetterUiSession) {
  const project = sessionProjects(session)[0];
  const body = await huaweiList<{ zones?: unknown[] }>(
    project,
    "dns",
    "/v2/zones?type=public&limit=500",
    {
      items: ["zones"],
      kind: "marker",
      parameter: "marker",
      size: 500,
      next: ["page_info.next_marker", "next_marker"],
      fallbackKey: "id",
    },
  );

  return asArray(body.zones).map((zone): DnsZone => {
    const item = asRecord(zone);

    return {
      createdAt: firstString([item.created_at, item.createdAt]),
      description: asString(item.description, ""),
      id: asString(item.id),
      name: asString(item.name),
      projectId: asString(item.project_id, project.projectId),
      recordCount: Number(item.record_num ?? 0),
      status: asString(item.status, "UNKNOWN"),
      ttl: String(item.ttl ?? "-"),
      type: asString(item.zone_type, "public"),
      updatedAt: firstString([item.updated_at, item.updatedAt]),
    };
  });
}
