import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import {
  asRecord,
  asString,
  firstResponseArray,
  firstString,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type KooGalleryPurchasedApi = {
  apiName: string;
  groupName: string;
  id: string;
  projectId: string;
  projectName: string;
  region: string;
  remark: string;
  runEnvName: string;
  status: string;
};

export async function listKooGalleryPurchasedApisForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<Record<string, unknown>>(
    session,
    "apig",
    "/v1.0/apigw/purchases/apis?page_size=100&page_no=1",
    {
      items: [
        "apis",
        "purchases",
        "purchased_apis",
        "items",
        "apis.apis",
        "apis.purchases",
        "apis.purchased_apis",
        "apis.items",
        "purchases.apis",
        "purchases.purchases",
        "purchases.purchased_apis",
        "purchases.items",
        "purchased_apis.apis",
        "purchased_apis.purchases",
        "purchased_apis.purchased_apis",
        "purchased_apis.items",
        "items.apis",
        "items.purchases",
        "items.purchased_apis",
        "items.items",
      ],
      kind: "page",
      parameter: "page_no",
      size: 100,
      first: 1,
    },
  );

  return firstResponseArray(body, [
    "apis",
    "purchases",
    "purchased_apis",
    "items",
  ]).map((api): KooGalleryPurchasedApi => {
    const item = asRecord(api);

    return {
      apiName: firstString([item.api_name, item.name, item.api_id]),
      groupName: firstString([item.group_name, item.group_id], "-"),
      id: firstString([item.api_id, item.id, item.name]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      remark: asString(item.remark ?? item.description, ""),
      runEnvName: firstString([item.run_env_name, item.env_name], "-"),
      status: firstString([item.status, item.auth_status], "UNKNOWN"),
    };
  });
}

export async function listKooGalleryPurchasedApis(session: BetterUiSession) {
  return loadAcrossProjects(session, listKooGalleryPurchasedApisForProject);
}
