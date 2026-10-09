import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { listNativeCloudFirewalls } from "./cfw-native";
import {
  asRecord,
  asString,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CloudFirewall = {
  bandwidth: string;
  chargeMode: string;
  engineType: string;
  enterpriseProjectId: string;
  eipCount: number | null;
  haType: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  serviceType: string;
  status: string;
  vpcCount: number | null;
};

const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const enumText = (value: unknown, values: number[]) => typeof value === "number" && values.includes(value) ? String(value) : "UNKNOWN";

export async function listCloudFirewallsForProject(
  session: HuaweiProjectSession,
) {
  const { records } = await listNativeCloudFirewalls(session);
  return records.map(
    (firewall): CloudFirewall => {
      const item = asRecord(firewall);
      const flavor = asRecord(item.flavor);

      return {
        bandwidth: typeof flavor.bandwidth === "number" && Number.isFinite(flavor.bandwidth) && flavor.bandwidth >= 0 ? `${flavor.bandwidth} Mbit/s` : "Unknown",
        chargeMode: enumText(item.charge_mode, [0, 1]),
        engineType: enumText(item.engine_type, [0, 1, 2]),
        enterpriseProjectId: asString(item.enterprise_project_id, "-"),
        eipCount: count(flavor.eip_count),
        haType: enumText(item.ha_type, [0, 1]),
        id: asString(item.fw_instance_id),
        name: asString(item.fw_instance_name),
        projectId: session.projectId,
        projectName: session.projectName,
        region: session.region,
        serviceType: enumText(item.service_type, [0, 1]),
        status: enumText(item.status, [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
        vpcCount: count(flavor.vpc_count),
      };
    },
  );
}

export async function listCloudFirewalls(session: BetterUiSession) {
  return loadAcrossProjects(session, listCloudFirewallsForProject);
}
