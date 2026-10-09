import { CloudErrorPage, CloudErrorBanner } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import {
  Activity,
  CloudCog,
  Globe2,
  Layers3,
  LockKeyhole,
  Network,
  Plus,
  Power,
  Server,
  ShieldCheck,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleActionTile,
  ConsoleEmptyPanelBody,
  ConsoleKeyValueList,
  ConsoleMutedText,
  ConsolePanel,
  ConsolePanelBody,
  ConsoleSubPanel,
  DataFreshnessText,
  FactGrid,
  MetricCard,
  MetricGrid,
  ResourceDetailHero,
  ResourceIdentity,
  SimpleTable,
  StatusBadge,
  TagList,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import {
  getElb,
  type ElbBackendPool,
  type ElbDetail,
  type ElbListener,
  withCloudResult,
} from "@/lib/huawei-cloud";

type DetailItem = {
  label: string;
  value: React.ReactNode;
};

function booleanLabel(value: boolean | null) {
  if (value === null) {
    return "-";
  }

  return value ? "Enabled" : "Disabled";
}

function ListenerTable({ listeners }: { listeners: ElbListener[] }) {
  return (
    <SimpleTable
      columns={[
        { header: "Name" },
        { header: "Protocol" },
        { header: "Port" },
        { header: "Operating" },
        { header: "Provisioning" },
        { header: "Default pool" },
        { header: "Admin" },
      ]}
      emptyState={
        <ConsoleMutedText className="max-w-xl" weight="semibold">
          No listeners were returned for this load balancer.
        </ConsoleMutedText>
      }
      minWidthClassName="min-w-[980px]"
      rows={listeners.map((listener) => ({
        cells: [
          <ResourceIdentity id={listener.id} key="name" name={listener.name} />,
          listener.protocol,
          listener.protocolPort,
          <StatusBadge key="operating" status={listener.operatingStatus} />,
          listener.provisioningStatus,
          listener.defaultPoolId,
          booleanLabel(listener.adminStateUp),
        ],
        key: listener.id,
      }))}
    />
  );
}

function BackendPools({ pools }: { pools: ElbBackendPool[] }) {
  if (!pools.length) {
    return (
      <ConsoleEmptyPanelBody className="py-14" title="No backend server groups">
        No backend server groups were returned in the ELB status tree.
      </ConsoleEmptyPanelBody>
    );
  }

  return (
    <ConsolePanelBody>
      {pools.map((pool) => (
        <ConsoleSubPanel
          actions={
            <>
              <StatusBadge status={pool.operatingStatus} />
              <TagList
                emptyState=""
                items={[pool.protocol, pool.algorithm]}
                tone="neutral"
              />
            </>
          }
          className="rounded-xl bg-[#fbfcfe] dark:bg-white/5"
          contentClassName="grid gap-4 p-4 lg:grid-cols-[0.9fr_1.5fr]"
          description={pool.id}
          key={pool.id}
          title={pool.name}
        >
          <ConsoleSubPanel contentClassName="p-4" title="Health check">
            {pool.healthMonitor ? (
              <ConsoleKeyValueList
                className="mt-3"
                items={[
                  { label: "Type", value: pool.healthMonitor.type },
                  { label: "Delay", value: pool.healthMonitor.delay },
                  { label: "Timeout", value: pool.healthMonitor.timeout },
                  {
                    label: "Max retries",
                    value: pool.healthMonitor.maxRetries,
                  },
                  {
                    label: "Expected codes",
                    value: pool.healthMonitor.expectedCodes,
                  },
                ]}
              />
            ) : (
              <ConsoleMutedText className="mt-3" weight="semibold">
                No health monitor attached.
              </ConsoleMutedText>
            )}
          </ConsoleSubPanel>

          <ConsoleSubPanel title={`Backend servers (${pool.members.length})`}>
            <SimpleTable
              columns={[
                { header: "Address" },
                { header: "Port" },
                { header: "Weight" },
                { header: "Operating" },
              ]}
              emptyState={
                <ConsoleMutedText weight="semibold">
                  No backend servers in this pool.
                </ConsoleMutedText>
              }
              minWidthClassName="min-w-[620px]"
              rows={pool.members.map((member) => ({
                cells: [
                  <ResourceIdentity
                    id={member.name !== "-" ? member.name : member.id}
                    key="address"
                    name={member.address}
                  />,
                  member.protocolPort,
                  member.weight,
                  <StatusBadge
                    key="operating"
                    status={member.operatingStatus}
                  />,
                ],
                key: member.id,
              }))}
            />
          </ConsoleSubPanel>
        </ConsoleSubPanel>
      ))}
    </ConsolePanelBody>
  );
}

function TopologySummary({ elb }: { elb: ElbDetail }) {
  const backendCount = elb.backendPools.reduce(
    (total, pool) => total + pool.members.length,
    0,
  );
  const items = [
    {
      icon: Globe2,
      label: "VIP",
      value: elb.vipAddress,
    },
    {
      icon: Network,
      label: "Listeners",
      value: String(elb.listenerCount),
    },
    {
      icon: Layers3,
      label: "Backend pools",
      value: String(elb.backendPoolCount),
    },
    {
      icon: Server,
      label: "Backend servers",
      value: String(backendCount),
    },
  ];

  return (
    <MetricGrid>
      {items.map((item) => (
        <MetricCard
          icon={item.icon}
          key={item.label}
          label={item.label}
          value={item.value}
          variant="compact"
        />
      ))}
    </MetricGrid>
  );
}

export default async function ElbDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => getElb(session, id),
    `elb:${id}`,
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Networking"
        backHref="/services/elb"
        error={result.error}
      />
    );
  const elb = result.data;
  if (!elb) notFound();

  const overview: DetailItem[] = [
    { label: "VIP", value: elb.vipAddress },
    { label: "IP version", value: elb.ipVersion },
    {
      label: "Operating status",
      value: <StatusBadge status={elb.operatingStatus} />,
    },
    { label: "Provisioning status", value: elb.provisioningStatus },
    { label: "Admin state", value: booleanLabel(elb.adminStateUp) },
    { label: "Flavor", value: elb.flavor },
    { label: "Provider", value: elb.provider },
    { label: "VIP subnet", value: elb.vipSubnetCidrId },
    { label: "VIP port", value: elb.vipPortId },
    { label: "Region", value: elb.region },
    { label: "Project", value: elb.projectName },
    { label: "Enterprise project", value: elb.enterpriseProjectId },
    {
      label: "Availability zones",
      value: elb.availabilityZones.length
        ? elb.availabilityZones.join(", ")
        : "-",
    },
    { label: "EIPs", value: elb.eips.length ? elb.eips.join(", ") : "-" },
    { label: "Created", value: <LocalDateTime value={elb.createdAt} /> },
    { label: "Updated", value: <LocalDateTime value={elb.updatedAt} /> },
  ];

  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <CloudErrorBanner error={result.error} isCached={result.isCached} />
        <ResourceDetailHero
          actions={
            <>
              <DisabledCloudButton title="Listener creation is not implemented yet.">
                <Plus className="size-4" />
                Add listener
              </DisabledCloudButton>
              <DisabledCloudButton title="ELB enable/disable actions are intentionally read-only here.">
                <Power className="size-4" />
                Change admin state
              </DisabledCloudButton>
              <RefreshButton />
            </>
          }
          backHref="/services/elb"
          backLabel="Back to ELB"
          description={
            <DataFreshnessText
              isCached={result.isCached}
              updatedAt={result.updatedAt}
            />
          }
          eyebrow="Elastic Load Balance"
          icon={CloudCog}
          id={elb.id}
          title={elb.name}
        />

        <TopologySummary elb={elb} />

        <FactGrid className="xl:grid-cols-4" items={overview} />

        <ConsolePanel
          description="Listener runtime and provisioning information from ELB."
          icon={Activity}
          title="Listeners"
        >
          <ListenerTable listeners={elb.listeners} />
        </ConsolePanel>

        <ConsolePanel
          description="Backend server groups, health checks, and member status from the load balancer status tree."
          icon={Server}
          title="Backend server groups"
        >
          <BackendPools pools={elb.backendPools} />
        </ConsolePanel>

        <ConsolePanel
          description="Safe shortcuts for related networking checks."
          icon={ShieldCheck}
          title="Networking"
        >
          <ConsolePanelBody columns="md-3" gap="md">
            <ConsoleActionTile
              href="/services/networking"
              icon={<Network className="size-5" />}
            >
              Open networking overview
            </ConsoleActionTile>
            <ConsoleActionTile
              href="/services/network"
              icon={<Globe2 className="size-5" />}
            >
              Open VPC resources
            </ConsoleActionTile>
            <ConsoleActionTile
              disabled
              icon={<LockKeyhole className="size-5" />}
            >
              Destructive ELB actions are disabled
            </ConsoleActionTile>
          </ConsolePanelBody>
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
