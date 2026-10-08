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

export type CphServer = {
  availabilityZone: string;
  bandwidth: string;
  flavor: string;
  id: string;
  name: string;
  phoneCount: number;
  projectId: string;
  projectName: string;
  publicIp: string;
  region: string;
  status: string;
  subnetId: string;
  vpcId: string;
};

export async function listCphServersForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{
    servers?: unknown[];
    cloud_phone_servers?: unknown[];
  }>(
    session,
    "cph",
    `/v1/${session.projectId}/cloud-phone/servers?offset=0&limit=100`,
    {
      items: ["servers", "cloud_phone_servers"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.servers ?? body.cloud_phone_servers).map(
    (server): CphServer => {
      const item = asRecord(server);
      const bandwidth = asRecord(item.band_width ?? item.bandwidth);

      return {
        availabilityZone: firstString(
          [item.availability_zone, item.availability_zone_name],
          "-",
        ),
        bandwidth: numberWithUnit(
          bandwidth.size ?? item.bandwidth_size,
          "Mbit/s",
        ),
        flavor: firstString(
          [item.server_model_name, item.flavor, item.server_model],
          "-",
        ),
        id: firstString([item.server_id, item.id]),
        name: firstString([item.server_name, item.name, item.id]),
        phoneCount: Number(item.phone_count ?? item.phone_num ?? 0),
        projectId: session.projectId,
        projectName: session.projectName,
        publicIp: firstString([item.public_ip, item.public_ip_address], "-"),
        region: session.region,
        status: firstString([item.status, item.server_status], "UNKNOWN"),
        subnetId: asString(item.subnet_id, "-"),
        vpcId: asString(item.vpc_id, "-"),
      };
    },
  );
}

export async function listCphServers(session: BetterUiSession) {
  return loadAcrossProjects(session, listCphServersForProject);
}
