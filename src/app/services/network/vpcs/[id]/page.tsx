import { mapCloudLoad } from "@/lib/huawei/errors";
import { CloudErrorPage } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import { Network, Route } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleActionStack,
  ConsoleMain,
  ConsoleDescriptionPanel,
  ConsolePanel,
  DataFreshnessText,
  FactGrid,
  ResourceIdentity,
  ResourceDetailHero,
  SimpleTable,
  StatusBadge,
  TableEmptyText,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { NetworkResourceActions } from "@/components/network-resource-actions";
import { listSubnets, listVpcs, withCloudResult } from "@/lib/huawei-cloud";

export default async function VpcDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => mapCloudLoad(() => listVpcs(session), items => items.find((vpc) => vpc.id === id) ?? null),
    `vpc:${id}`,
  );
  if (!result.data && result.error) return <CloudErrorPage active="Networking" backHref="/services/network/vpcs" error={result.error} />;
  const item = result.data;

  if (!item) notFound();

  const subnetsResult = await withCloudResult(
    [],
    (session) => mapCloudLoad(() => listSubnets(session), items => items.filter(
        (subnet) => subnet.vpcId === item.id && subnet.projectId === item.projectId,
      )),
    `vpc-subnets:${id}`,
  );

  const facts = [
    { label: "Name", value: item.name },
    { label: "ID", value: item.id },
    { label: "CIDR", value: item.cidr },
    { label: "Secondary CIDRs", value: item.secondaryCidrs.join(", ") || "-" },
    { label: "Status", value: <StatusBadge status={item.status} /> },
    { label: "Project", value: item.projectName },
    { label: "Project ID", value: item.projectId },
    { label: "Region", value: item.region },
    { label: "Enterprise Project", value: item.enterpriseProjectId },
    { label: "Created", value: item.createdAt },
    { label: "Updated", value: item.updatedAt },
    { label: "Tags", value: item.tags.join(", ") || "-" },
  ];

  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={result.isRefreshing || subnetsResult.isRefreshing} />
      <ConsoleMain>
        <ResourceDetailHero
          actions={
            <ConsoleActionStack gap="md">
              <div className="flex justify-start lg:justify-end">
                <RefreshButton />
              </div>
              <NetworkResourceActions
                description={item.description}
                id={item.id}
                kind="vpcs"
                name={item.name}
                projectId={item.projectId}
              />
            </ConsoleActionStack>
          }
          backHref="/services/network"
          backLabel="Back to Networking"
          description={
            <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          }
          eyebrow="VPC"
          icon={Network}
          title={item.name}
        />

        {item.description ? (
          <ConsoleDescriptionPanel>{item.description}</ConsoleDescriptionPanel>
        ) : null}

        <FactGrid items={facts} />

        <ConsolePanel
          description={`${subnetsResult.data.length} subnets in this VPC.`}
          icon={Route}
          title="Subnets"
        >
          <SimpleTable
            columns={[
              { header: "Name" },
              { header: "CIDR" },
              { header: "Gateway" },
              { header: "DHCP" },
              { header: "AZ" },
            ]}
            emptyState={<TableEmptyText>No subnets found for this VPC.</TableEmptyText>}
            rows={subnetsResult.data.map((subnet) => ({
              cells: [
                <ResourceIdentity
                  href={`/services/network/subnets/${subnet.id}`}
                  id={subnet.id}
                  key="name"
                  name={subnet.name}
                />,
                subnet.cidr,
                subnet.gateway,
                <StatusBadge key="dhcp" status={subnet.dhcpEnabled} />,
                subnet.availabilityZone,
              ],
              key: subnet.id,
            }))}
          />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
