import { huaweiList } from "@/lib/huawei/http";
import "server-only";

import type { BetterUiSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  huaweiFetch,
  loadAcrossProjects,
  projectForId,
  sessionProjects,
} from "@/lib/huawei/core";
import type { DnsZone } from "@/lib/huawei/services/dns.types";

export type CreateDnsZoneInput = {
  description?: string;
  email?: string;
  name: string;
  projectId?: string;
  ttl?: number;
};

function mapDnsZone(
  zone: unknown,
  project: ReturnType<typeof sessionProjects>[number],
): DnsZone {
  const item = asRecord(zone);

  return {
    createdAt: firstString([item.created_at, item.createdAt]),
    description: asString(item.description, ""),
    id: asString(item.id),
    name: asString(item.name),
    projectId: asString(item.project_id, project.projectId),
    projectName: project.projectName,
    recordCount: Number(item.record_num ?? 0),
    region: project.region,
    status: asString(item.status, "UNKNOWN"),
    ttl: String(item.ttl ?? "-"),
    type: asString(item.zone_type, "public"),
    updatedAt: firstString([item.updated_at, item.updatedAt]),
  };
}

export async function listDnsZones(session: BetterUiSession) {
  const zones = await loadAcrossProjects(session, async (project) => {
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

    return asArray(body.zones).map((zone) => mapDnsZone(zone, project));
  });

  return Array.from(new Map(zones.map((zone) => [zone.id, zone])).values());
}

export async function createDnsZone(
  session: BetterUiSession,
  input: CreateDnsZoneInput,
) {
  const project = projectForId(session, input.projectId);
  const body: Record<string, unknown> = {
    name: input.name,
    zone_type: "public",
  };

  if (input.description) {
    body.description = input.description;
  }

  if (input.email) {
    body.email = input.email;
  }

  if (input.ttl) {
    body.ttl = input.ttl;
  }

  return huaweiFetch<Record<string, unknown>>(project, "dns", "/v2/zones", {
    body: JSON.stringify(body),
    method: "POST",
  });
}

export async function deleteDnsZone(
  session: BetterUiSession,
  zoneId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "dns",
    `/v2/zones/${encodeURIComponent(zoneId)}`,
    {
      method: "DELETE",
    },
  );
}

export type * from "@/lib/huawei/services/dns.types";
