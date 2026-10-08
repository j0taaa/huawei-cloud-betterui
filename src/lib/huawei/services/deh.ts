import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  numberWithUnit,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type DedicatedHost = {
  availabilityZone: string;
  availableMemory: string;
  availableVcpus: string;
  hostProperties: string;
  hostType: string;
  id: string;
  instanceCount: number;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  totalMemory: string;
  totalVcpus: string;
};

export async function listDedicatedHostsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ dedicated_hosts?: unknown[] }>(
    session,
    "deh",
    `/v1.0/${session.projectId}/dedicated-hosts?limit=100`,
    {
      items: ["dedicated_hosts"],
      kind: "marker",
      parameter: "marker",
      size: 100,
      fallbackKey: "dedicated_host_id",
    },
  );

  return asArray(body.dedicated_hosts).map((host): DedicatedHost => {
    const item = asRecord(host);
    const properties = asRecord(item.host_properties);
    const available = asRecord(item.available_resource);

    return {
      availabilityZone: firstString([item.availability_zone, item.az], "-"),
      availableMemory: numberWithUnit(
        available.memory ?? item.available_memory,
        "MB",
      ),
      availableVcpus: String(available.vcpus ?? item.available_vcpus ?? "-"),
      hostProperties:
        [properties.cpu, properties.memory ? `${properties.memory} MB` : ""]
          .filter(Boolean)
          .join(" / ") || "-",
      hostType: firstString([item.host_type, properties.host_type], "-"),
      id: asString(item.dedicated_host_id ?? item.id),
      instanceCount:
        asArray(item.instance_total ?? item.instances).length ||
        Number(item.instance_total ?? 0),
      name: firstString([item.name, item.dedicated_host_id, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.state ?? item.status, "UNKNOWN"),
      totalMemory: numberWithUnit(properties.memory ?? item.memory, "MB"),
      totalVcpus: String(properties.vcpus ?? item.vcpus ?? "-"),
    };
  });
}

export async function listDedicatedHosts(session: BetterUiSession) {
  return loadAcrossProjects(session, listDedicatedHostsForProject);
}
