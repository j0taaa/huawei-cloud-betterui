import "server-only";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  getMessagingInstance,
  listMessagingInstancesForProject,
} from "@/lib/huawei/messaging";
import { loadAcrossProjects } from "@/lib/huawei/projects";
export type { MessagingInstance as DmsRocketMqInstance } from "@/lib/huawei/messaging";

export async function listDmsRocketMqInstancesForProject(
  session: HuaweiProjectSession,
) {
  return listMessagingInstancesForProject(session, "rocketmq");
}
export async function listDmsRocketMqInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDmsRocketMqInstancesForProject);
}
export async function getDmsRocketMqInstance(
  session: BetterUiSession,
  id: string,
  projectId?: string,
) {
  return getMessagingInstance(session, "rocketmq", id, projectId);
}
