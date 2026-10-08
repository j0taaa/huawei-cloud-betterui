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

export type EventGridSubscription = {
  channelName: string;
  createdAt: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  sourceCount: number;
  status: string;
  targetCount: number;
  type: string;
  updatedAt: string;
};

export async function listEventGridSubscriptionsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<Record<string, unknown>>(
    session,
    "eg",
    `/v1/${session.projectId}/subscriptions?offset=0&limit=100`,
    {
      items: [
        "items",
        "subscriptions",
        "items.items",
        "items.subscriptions",
        "subscriptions.items",
        "subscriptions.subscriptions",
      ],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return firstResponseArray(body, ["items", "subscriptions"]).map(
    (subscription): EventGridSubscription => {
      const item = asRecord(subscription);

      return {
        channelName: firstString([item.channel_name, item.channel_id], "-"),
        createdAt: firstString([item.created_time, item.created_at]),
        id: firstString([item.id, item.subscription_id]),
        name: firstString([item.name, item.id]),
        projectId: session.projectId,
        projectName: session.projectName,
        region: session.region,
        sourceCount: asArray(item.sources).length,
        status: firstString([item.status], "UNKNOWN"),
        targetCount: asArray(item.targets).length,
        type: firstString([item.type], "-"),
        updatedAt: firstString([item.updated_time, item.updated_at]),
      };
    },
  );
}

export async function listEventGridSubscriptions(session: BetterUiSession) {
  return loadAcrossProjects(session, listEventGridSubscriptionsForProject);
}
