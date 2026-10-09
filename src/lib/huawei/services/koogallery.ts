import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { listPurchasedApis } from "@/lib/huawei/services/koogallery-native";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type KooGalleryPurchasedApi = {
  apiName: string;
  apiId: string;
  subscriptionId: string;
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
  return (await listPurchasedApis(session)).map((api): KooGalleryPurchasedApi => ({
    apiName: api.name,
    apiId: api.id,
    subscriptionId: api.purchaseId,
    groupName: api.groupName,
    id: JSON.stringify([api.purchaseId, api.id]),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    remark: api.description,
    runEnvName: "Not reported",
    status: "Not reported",
  }));
}

export async function listKooGalleryPurchasedApis(session: BetterUiSession) {
  return loadAcrossProjects(session, listKooGalleryPurchasedApisForProject);
}
