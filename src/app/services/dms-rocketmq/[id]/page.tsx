import type { Metadata } from "next";
import { MessagingDetailPage } from "@/app/services/_components/messaging-workspace";
import { getDmsRocketMqInstance, withCloudResult } from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
export const metadata: Metadata = {
  title: "RocketMQ instance | Huawei Cloud Better UI",
};
export default async function RocketMqInstancePage({
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
    (session) => getDmsRocketMqInstance(session, id, projectId),
    cloudCacheKeys.messagingInstance("rocketmq", id, projectId),
  );
  return <MessagingDetailPage engine="rocketmq" result={result} />;
}
