import { mapCloudLoad } from "@/lib/huawei/errors";
import { CloudErrorPage } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import { Route } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleActionStack,
  ConsoleMain,
  ConsoleDescriptionPanel,
  ConsoleResourceLink,
  DataFreshnessText,
  FactGrid,
  ResourceDetailHero,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import { NetworkResourceActions } from "@/components/network-resource-actions";
import { listSubnets, listVpcs, withCloudResult } from "@/lib/huawei-cloud";

export default async function SubnetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => mapCloudLoad(() => listSubnets(session), items => items.find((subnet) => subnet.id === id) ?? null),
    `subnet:${id}`,
  );
  if (!result.data && result.error) return <CloudErrorPage active="Networking" backHref="/services/network/subnets" error={result.error} />;
  const item = result.data;

  if (!item) notFound();

  const vpcResult = await withCloudResult(
    null,
    (session) => mapCloudLoad(() => listVpcs(session), items => items.find(
        (vpc) => vpc.id === item.vpcId && vpc.projectId === item.projectId,
      ) ?? null),
    `subnet-vpc:${id}`,
  );

  const facts = [
    { label: "Name", value: item.name },
    { label: "ID", value: item.id },
    { label: "CIDR", value: item.cidr },
    { label: "Gateway", value: item.gateway },
    { label: "IPv6 CIDR", value: item.ipv6Cidr },
    { label: "IPv6 Gateway", value: item.ipv6Gateway },
    { label: "DHCP", value: item.dhcpEnabled },
    { label: "DNS Servers", value: item.dnsServers.join(", ") || "-" },
    { label: "Availability Zone", value: item.availabilityZone },
    { label: "Status", value: item.status },
    {
      label: "VPC",
      value: vpcResult.data ? (
        <ConsoleResourceLink className="font-semibold" href={`/services/network/vpcs/${vpcResult.data.id}`}>
          {vpcResult.data.name}
        </ConsoleResourceLink>
      ) : (
        item.vpcId
      ),
    },
    { label: "VPC ID", value: item.vpcId },
    { label: "Neutron Network ID", value: item.neutronNetworkId },
    { label: "Neutron Subnet ID", value: item.neutronSubnetId },
    { label: "Project", value: item.projectName },
    { label: "Project ID", value: item.projectId },
    { label: "Region", value: item.region },
    { label: "Created", value: <LocalDateTime value={item.createdAt} /> },
    { label: "Updated", value: <LocalDateTime value={item.updatedAt} /> },
  ];

  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={result.isRefreshing || vpcResult.isRefreshing} />
      <ConsoleMain>
        <ResourceDetailHero
          actions={
            <ConsoleActionStack gap="md">
              <div className="flex justify-start lg:justify-end">
                <RefreshButton />
              </div>
              <NetworkResourceActions
                id={item.id}
                kind="subnets"
                name={item.name}
                projectId={item.projectId}
                vpcId={item.vpcId}
              />
            </ConsoleActionStack>
          }
          backHref="/services/network"
          backLabel="Back to Networking"
          description={
            <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          }
          eyebrow="Subnet"
          icon={Route}
          title={item.name}
        />

        {item.description ? (
          <ConsoleDescriptionPanel>{item.description}</ConsoleDescriptionPanel>
        ) : null}

        <FactGrid items={facts} />
      </ConsoleMain>
    </ConsoleShell>
  );
}
