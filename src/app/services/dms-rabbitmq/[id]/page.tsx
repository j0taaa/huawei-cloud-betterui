import type { Metadata } from "next";
import { MessagingDetailPage } from "@/app/services/_components/messaging-workspace";
import { getDmsRabbitMqInstance, withCloudResult } from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
export const metadata: Metadata = {
  title: "RabbitMQ instance | Huawei Cloud Better UI",
};
export default async function RabbitMqInstancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { id } = await params;
  const { projectId } = await searchParams;
  const result = await withCloudResult(
    null,
    (session) => getDmsRabbitMqInstance(session, id, projectId),
    cloudCacheKeys.messagingInstance("rabbitmq", id, projectId),
  );
  return <MessagingDetailPage engine="rabbitmq" result={result} />;
}
