import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  firstResponseArray,
  firstString,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type IotdaDevice = {
  appName: string;
  deviceId: string;
  deviceName: string;
  gatewayId: string;
  nodeId: string;
  nodeType: string;
  productId: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  tags: number;
};

export async function listIotdaDevicesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<Record<string, unknown>>(
    session,
    "iotda",
    `/v5/iot/${session.projectId}/devices?limit=50`,
    {
      items: ["devices", "devices.devices"],
      kind: "marker",
      parameter: "marker",
      size: 50,
      next: ["page.marker"],
      total: ["page.count"],
    },
  );

  return firstResponseArray(body, ["devices"]).map((device): IotdaDevice => {
    const item = asRecord(device);

    return {
      appName: firstString([item.app_name, item.app_id], "-"),
      deviceId: firstString([item.device_id, item.id]),
      deviceName: firstString([item.device_name, item.name, item.node_id]),
      gatewayId: firstString([item.gateway_id], "-"),
      nodeId: firstString([item.node_id], "-"),
      nodeType: firstString([item.node_type], "-"),
      productId: firstString([item.product_id], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.status], "UNKNOWN"),
      tags: asArray(item.tags).length,
    };
  });
}

export async function listIotdaDevices(session: BetterUiSession) {
  return loadAcrossProjects(session, listIotdaDevicesForProject);
}
