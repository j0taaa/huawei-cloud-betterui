import type { Metadata } from "next";
import { MessagingInventoryPage } from "@/app/services/_components/messaging-workspace";
import { listDmsRocketMqInstances, withCloudResult } from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
export const metadata: Metadata = {
  title: "DMS for RocketMQ | Huawei Cloud Better UI",
};
export default async function RocketMqPage() {
  const result = await withCloudResult(
    [],
    listDmsRocketMqInstances,
    cloudCacheKeys.listDmsRocketMqInstances,
  );
  return <MessagingInventoryPage engine="rocketmq" result={result} />;
}
