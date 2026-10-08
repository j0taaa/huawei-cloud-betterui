import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  asString,
  firstIp,
  firstString,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type BmsServer = {
  availabilityZone: string;
  flavor: string;
  id: string;
  image: string;
  keyName: string;
  name: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  publicIp: string;
  region: string;
  status: string;
  systemDisk: string;
  updatedAt: string;
};

export async function listBmsServersForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{
    servers?: unknown[];
    baremetalservers?: unknown[];
  }>(
    session,
    "bms",
    `/v1/${session.projectId}/baremetalservers/detail?limit=1000`,
    {
      items: ["servers", "baremetalservers"],
      kind: "page",
      parameter: "offset",
      size: 1000,
      first: 1,
    },
  );

  return asArray(body.servers ?? body.baremetalservers).map(
    (server): BmsServer => {
      const item = asRecord(server);
      const flavor = asRecord(item.flavor);
      const image = asRecord(item.image);
      const metadata = asRecord(item.metadata);
      const rootDevice = firstString(
        [metadata.root_device_name, item.root_device_name],
        "-",
      );

      return {
        availabilityZone: firstString(
          [item["OS-EXT-AZ:availability_zone"], item.availability_zone],
          "-",
        ),
        flavor: firstString([flavor.name, flavor.id, item.flavorRef], "-"),
        id: asString(item.id),
        image: firstString([image.name, image.id, item.imageRef], "-"),
        keyName: firstString([item.key_name, item.keypair_name], "-"),
        name: firstString([item.name, item.id]),
        privateIp: firstIp(item.addresses, "private"),
        projectId: session.projectId,
        projectName: session.projectName,
        publicIp: firstIp(item.addresses, "public"),
        region: session.region,
        status: asString(item.status, "UNKNOWN"),
        systemDisk: rootDevice,
        updatedAt: firstString([item.updated, item.updated_at, item.created]),
      };
    },
  );
}

export async function listBmsServers(session: BetterUiSession) {
  return loadAcrossProjects(session, listBmsServersForProject);
}
