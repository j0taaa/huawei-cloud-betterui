import "server-only";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  getMessagingInstance,
  listMessagingInstancesForProject,
} from "@/lib/huawei/messaging";
import { loadAcrossProjects } from "@/lib/huawei/projects";
export type { MessagingInstance as DmsRabbitMqInstance } from "@/lib/huawei/messaging";

export async function listDmsRabbitMqInstancesForProject(
  session: HuaweiProjectSession,
) {
  return listMessagingInstancesForProject(session, "rabbitmq");
}
export async function listDmsRabbitMqInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDmsRabbitMqInstancesForProject);
}
export async function getDmsRabbitMqInstance(
  session: BetterUiSession,
  id: string,
  projectId?: string,
) {
  return getMessagingInstance(session, "rabbitmq", id, projectId);
}
