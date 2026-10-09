import type { Metadata } from "next";
import { MessagingInventoryPage } from "@/app/services/_components/messaging-workspace";
import { listDmsRabbitMqInstances, withCloudResult } from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
export const metadata: Metadata = {
  title: "DMS for RabbitMQ | Huawei Cloud Better UI",
};
export default async function RabbitMqPage() {
  const result = await withCloudResult(
    [],
    listDmsRabbitMqInstances,
    cloudCacheKeys.listDmsRabbitMqInstances,
  );
  return <MessagingInventoryPage engine="rabbitmq" result={result} />;
}
