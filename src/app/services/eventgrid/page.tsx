import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Cable } from "lucide-react";

import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import {
  listEventGridSubscriptions,
  type EventGridSubscription,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "EventGrid | Huawei Cloud Better UI",
};

const columns: InventoryColumn<EventGridSubscription>[] = [
  {
    header: "Subscription",
    render: (subscription) => (
      <ResourceIdentity id={subscription.id} name={subscription.name} />
    ),
  },
  { header: "Status", render: (subscription) => <InventoryStatus>{subscription.status}</InventoryStatus> },
  { header: "Channel", render: (subscription) => subscription.channelName },
  { header: "Type", render: (subscription) => subscription.type },
  { header: "Sources", render: (subscription) => subscription.sourceCount },
  { header: "Targets", render: (subscription) => subscription.targetCount },
  { header: "Updated", render: (subscription) => subscription.updatedAt },
];

export default async function EventGridPage() {
  const result = await withCloudResult<EventGridSubscription[]>([], listEventGridSubscriptions, cloudCacheKeys.listEventGridSubscriptions);
  const subscriptions = result.data;
  const routes = subscriptions.reduce((total, subscription) => total + subscription.targetCount, 0);

  return (
    <ServiceInventoryPage
      managementService="eventgrid"
      actionLabel="Create subscription"
      actionTitle="Event subscription creation is disabled in this read-only view."
      active="Monitoring"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="Event subscriptions, channel placement, source count, target fanout, status, and update cadence."
      empty="No EventGrid subscriptions were returned for the selected projects."
      icon={Cable}
      result={result}
      rows={subscriptions}
      stats={[
        { label: "Subscriptions", value: subscriptions.length },
        { label: "Target routes", value: routes },
        { label: "Channels", value: new Set(subscriptions.map((subscription) => subscription.channelName).filter((channel) => channel !== "-")).size },
        { label: "Source bindings", value: subscriptions.reduce((total, subscription) => total + subscription.sourceCount, 0) },
      ]}
      tableTitle="Event subscription inventory"
      title="EventGrid"
    />
  );
}
