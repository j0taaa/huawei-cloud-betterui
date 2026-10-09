import { mapCloudLoad } from "@/lib/huawei/errors";
import { CloudErrorPage } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleActionStack,
  ConsoleMain,
  ConsoleDescriptionPanel,
  ConsolePanel,
  DataFreshnessText,
  FactGrid,
  ResourceDetailHero,
  SimpleTable,
  StatusBadge,
  TableEmptyText,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { NetworkResourceActions } from "@/components/network-resource-actions";
import { listSecurityGroups, withCloudResult } from "@/lib/huawei-cloud";

export default async function SecurityGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => mapCloudLoad(() => listSecurityGroups(session), items => items.find((group) => group.id === id) ??
      null),
    `security-group:${id}`,
  );
  if (!result.data && result.error) return <CloudErrorPage active="Networking" backHref="/services/network/security-groups" error={result.error} />;
  const item = result.data;

  if (!item) notFound();

  const facts = [
    { label: "Name", value: item.name },
    { label: "ID", value: item.id },
    { label: "Rules", value: String(item.rules) },
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
      <CloudRefreshIndicator show={result.isRefreshing} />
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
                kind="security-groups"
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
          eyebrow="Security group"
          icon={ShieldCheck}
          title={item.name}
        />

        {item.description ? (
          <ConsoleDescriptionPanel>{item.description}</ConsoleDescriptionPanel>
        ) : null}

        <FactGrid items={facts} />

        <ConsolePanel
          description="Inbound and outbound rules returned by Huawei Cloud."
          title="Rules"
        >
          <SimpleTable
            columns={[
              { header: "Direction" },
              { header: "Protocol" },
              { header: "Ports" },
              { header: "Remote" },
              { header: "Priority" },
              { header: "Action" },
              { header: "Description" },
            ]}
            emptyState={<TableEmptyText>No security group rules returned.</TableEmptyText>}
            minWidthClassName="min-w-[960px]"
            rows={item.ruleItems.map((rule) => ({
              cells: [
                <>
                  <StatusBadge tone="neutral">{rule.direction}</StatusBadge>
                  <p className="mt-1 text-xs font-semibold text-[#98a2b3]">
                    {rule.ethertype}
                  </p>
                </>,
                rule.protocol,
                rule.multiport,
                rule.remote,
                rule.priority,
                rule.action,
                rule.description || "-",
              ],
              key: rule.id,
            }))}
          />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
