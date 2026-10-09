import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  Network,
  Plus,
  Route,
  ShieldCheck,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleMutedText,
  ConsoleCallout,
  ConsolePageHeader,
  ConsolePanel,
  ConsolePanelGrid,
  ConsoleResourceLink,
  MetricCard,
  SimpleTable,
  StatusBadge,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import {
  listSecurityGroups,
  listSubnets,
  listVpcs,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "Networking | Huawei Cloud Better UI",
};

export default async function NetworkPage() {
  const [vpcsResult, subnetsResult, groupsResult] = await Promise.all([
    withCloudResult([], listVpcs, cloudCacheKeys.listVpcs),
    withCloudResult([], listSubnets, cloudCacheKeys.listSubnets),
    withCloudResult([], listSecurityGroups, cloudCacheKeys.listSecurityGroups),
  ]);

  const errors = [vpcsResult.error, subnetsResult.error, groupsResult.error].filter(Boolean);
  const isRefreshing =
    vpcsResult.isRefreshing ||
    subnetsResult.isRefreshing ||
    groupsResult.isRefreshing;

  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
              <DisabledCloudButton title="VPC creation is not implemented yet.">
                <Plus className="size-4" />
                Create VPC
              </DisabledCloudButton>
              <RefreshButton />
            </>
          }
          backHref="/"
          backLabel="Back to dashboard"
          description="Real VPC, subnet, and security group data."
          icon={Network}
          title="Networking"
        />

        {errors.length ? (
          <ConsoleCallout>{errors.join(" ")}</ConsoleCallout>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <MetricCard
            icon={Network}
            label="VPCs"
            value={
              <>
                {vpcsResult.data.length}
                <ConsoleMutedText as="span" className="mt-1 block" weight="semibold">
                  {unique(vpcsResult.data.map((vpc) => vpc.region)).length} regions
                </ConsoleMutedText>
              </>
            }
          />
          <MetricCard
            icon={Route}
            label="Subnets"
            value={
              <>
                {subnetsResult.data.length}
                <ConsoleMutedText as="span" className="mt-1 block" weight="semibold">
                  {subnetsResult.data.filter((subnet) => subnet.dhcpEnabled === "Enabled").length} with DHCP
                </ConsoleMutedText>
              </>
            }
          />
          <MetricCard
            icon={ShieldCheck}
            label="Security groups"
            value={
              <>
                {groupsResult.data.length}
                <ConsoleMutedText as="span" className="mt-1 block" weight="semibold">
                  {groupsResult.data.reduce((total, group) => total + group.rules, 0)} rules
                </ConsoleMutedText>
              </>
            }
          />
        </section>

        <ConsolePanelGrid>
          <NetworkTable
            columns={["Name", "CIDR", "Status", "Project", "Region"]}
            rows={vpcsResult.data.map((vpc) => ({
              href: `/services/network/vpcs/${vpc.id}`,
              id: vpc.id,
              meta: vpc.id,
              values: [vpc.name, vpc.cidr, vpc.status, vpc.projectName, vpc.region],
            }))}
            title="VPCs"
            isCached={vpcsResult.isCached}
            updatedAt={vpcsResult.updatedAt}
          />
          <NetworkTable
            columns={["Name", "CIDR", "Gateway", "DHCP", "VPC"]}
            rows={subnetsResult.data.map((subnet) => ({
              href: `/services/network/subnets/${subnet.id}`,
              id: subnet.id,
              meta: `${subnet.projectName} / ${subnet.region}`,
              values: [subnet.name, subnet.cidr, subnet.gateway, subnet.dhcpEnabled, subnet.vpcId],
            }))}
            title="Subnets"
            isCached={subnetsResult.isCached}
            updatedAt={subnetsResult.updatedAt}
          />
          <NetworkTable
            columns={["Name", "Rules", "Project", "Description"]}
            rows={groupsResult.data.map((group) => ({
              href: `/services/network/security-groups/${group.id}`,
              id: group.id,
              meta: group.id,
              values: [group.name, String(group.rules), group.projectName, group.description || "-"],
            }))}
            title="Security Groups"
            isCached={groupsResult.isCached}
            updatedAt={groupsResult.updatedAt}
          />
        </ConsolePanelGrid>
      </ConsoleMain>
    </ConsoleShell>
  );
}

function NetworkTable({
  columns,
  rows,
  isCached,
  title,
  updatedAt,
}: {
  columns: string[];
  isCached: boolean;
  rows: Array<{ href: string; id: string; meta: string; values: string[] }>;
  title: string;
  updatedAt: string;
}) {
  return (
    <ConsolePanel
      description={
        <>
          Showing {isCached ? "cached" : "fresh"} data from{" "}
          <LocalDateTime value={updatedAt} />.
        </>
      }
      title={title}
    >
      <SimpleTable
        columns={columns.map((column) => ({ header: column }))}
        emptyState={
          <ConsoleMutedText>No {title.toLowerCase()} found.</ConsoleMutedText>
        }
        rows={rows.map((row) => ({
          cells: row.values.map((value, index) =>
            index === 0 ? (
              <div key={`${row.id}:identity`}>
                <ConsoleResourceLink href={row.href} underline={false}>
                  {value}
                </ConsoleResourceLink>
                <p className="mt-1 text-xs font-semibold text-[#98a2b3]">
                  {row.meta}
                </p>
              </div>
            ) : (
              <CellValue key={`${row.id}:${index}`} value={value} />
            ),
          ),
          key: row.id,
        }))}
      />
    </ConsolePanel>
  );
}

function CellValue({ value }: { value: string }) {
  if (["ACTIVE", "Enabled"].includes(value)) {
    return (
      <StatusBadge tone="good">
        {value}
      </StatusBadge>
    );
  }

  if (["ERROR", "Disabled"].includes(value)) {
    return (
      <StatusBadge tone="bad">
        {value}
      </StatusBadge>
    );
  }

  return value || "-";
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
