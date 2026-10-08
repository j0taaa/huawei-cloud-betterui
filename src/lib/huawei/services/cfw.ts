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

export type CloudFirewall = {
  bandwidth: string;
  chargeMode: string;
  engineType: string;
  enterpriseProjectId: string;
  eipCount: number;
  haType: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  serviceType: string;
  status: string;
  vpcCount: number;
};

export async function listCloudFirewallsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{
    data?: { records?: unknown[] };
    records?: unknown[];
  }>(
    session,
    "cfw",
    `/v1/${session.projectId}/firewalls/list?enterprise_project_id=all_granted_eps`,
    {
      items: ["data.records", "records"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
      inBody: true,
    },
    {
      body: JSON.stringify({ limit: 100, offset: 0 }),
      method: "POST",
    },
  );
  const data = asRecord(body.data);

  return asArray(data.records ?? body.records).map(
    (firewall): CloudFirewall => {
      const item = asRecord(firewall);
      const flavor = asRecord(item.flavor);

      return {
        bandwidth: numberWithUnit(flavor.bandwidth, "Mbit/s"),
        chargeMode: String(item.charge_mode ?? "-"),
        engineType: String(item.engine_type ?? "-"),
        enterpriseProjectId: asString(item.enterprise_project_id, "-"),
        eipCount: Number(flavor.eip_count ?? item.eip_count ?? 0),
        haType: String(item.ha_type ?? "-"),
        id: firstString([item.fw_instance_id, item.resource_id, item.id]),
        name: firstString([item.fw_instance_name, item.name, item.id]),
        projectId: session.projectId,
        projectName: session.projectName,
        region: session.region,
        serviceType: String(item.service_type ?? "-"),
        status: String(item.status ?? "UNKNOWN"),
        vpcCount: Number(flavor.vpc_count ?? item.vpc_count ?? 0),
      };
    },
  );
}

export async function listCloudFirewalls(session: BetterUiSession) {
  return loadAcrossProjects(session, listCloudFirewallsForProject);
}
