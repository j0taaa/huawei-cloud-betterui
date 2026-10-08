import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type DliQueue = {
  chargingMode: string;
  cuCount: number;
  description: string;
  engine: string;
  name: string;
  owner: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  type: string;
};

export async function listDliQueuesForProject(session: HuaweiProjectSession) {
  // This endpoint returns all queues and has no pagination parameters.
  const body = await huaweiFetch<{
    queues?: unknown[];
    queue_list?: unknown[];
  }>(
    session,
    "dli",
    `/v1.0/${session.projectId}/queues?queue_type=all&with-charge-info=true`,
  );

  return asArray(body.queues ?? body.queue_list).map((queue): DliQueue => {
    const item = asRecord(queue);
    const charge = asRecord(item.charge_info ?? item.chargeInfo);

    return {
      chargingMode: firstString(
        [item.charging_mode, charge.charging_mode, charge.mode],
        "-",
      ),
      cuCount: Number(item.cu_count ?? item.cuCount ?? item.cu_num ?? 0),
      description: asString(item.description, ""),
      engine: firstString(
        [item.engine, item.resource_type, item.platform],
        "-",
      ),
      name: firstString([item.queue_name, item.name]),
      owner: firstString([item.owner, item.user_name], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([item.status, item.queue_status], "UNKNOWN"),
      type: firstString([item.queue_type, item.type], "-"),
    };
  });
}

export async function listDliQueues(session: BetterUiSession) {
  return loadAcrossProjects(session, listDliQueuesForProject);
}
