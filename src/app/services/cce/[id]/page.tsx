import { CloudErrorPage, CloudErrorBanner } from "@/components/cloud-error";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Boxes, PackageCheck, Server } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleEmptyPanelBody,
  ConsoleKeyValueList,
  ConsolePanel,
  ConsolePanelBody,
  ConsoleSubPanel,
  DataFreshnessText,
  FactGrid,
  FieldGrid,
  InfoPill,
  ResourceDetailHero,
  ResourceIdentity,
  SimpleTable,
  StatusBadge,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import {
  getCceCluster,
  type CceAddon,
  type CceClusterDetail,
  type CceNode,
  withCloudResult,
} from "@/lib/huawei-cloud";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "nodes", label: "Nodes" },
  { id: "addons", label: "Add-ons" },
  { id: "network", label: "Network" },
] as const;

type CceTab = (typeof tabs)[number]["id"];

function isTab(value: string | undefined): value is CceTab {
  return tabs.some((tab) => tab.id === value);
}

function OverviewTab({ cluster }: { cluster: CceClusterDetail }) {
  return (
    <ConsolePanel icon={Activity} title="Overview">
      <div className="grid gap-6 p-5 xl:grid-cols-[1fr_1fr_1fr_0.9fr]">
        <FieldGrid
          items={[
            { label: "Status", value: <StatusBadge status={cluster.status} /> },
            { label: "Cluster type", value: cluster.type },
            { label: "Flavor", value: cluster.flavor },
            { label: "Authentication", value: cluster.authenticationMode },
          ]}
        />
        <FieldGrid
          items={[
            {
              label: "Nodes",
              value: `${cluster.activeNodes || cluster.nodes.length}/${cluster.nodeCount || cluster.nodes.length}`,
            },
            { label: "Cluster CPU", value: cluster.totalCpu },
            { label: "Cluster memory", value: cluster.totalMemory },
            {
              label: "Add-ons",
              value: cluster.addons.length || cluster.addOnCount,
            },
          ]}
        />
        <FieldGrid
          items={[
            { label: "Region", value: cluster.region },
            { label: "Project", value: cluster.projectName },
            {
              label: "Created",
              value:
                cluster.createdAt !== "-" ? (
                  <LocalDateTime value={cluster.createdAt} />
                ) : (
                  "-"
                ),
            },
            {
              label: "Updated",
              value:
                cluster.updatedAt !== "-" ? (
                  <LocalDateTime value={cluster.updatedAt} />
                ) : (
                  "-"
                ),
            },
          ]}
        />
        <div className="grid content-start gap-3">
          <InfoPill label="Billing mode" value={cluster.billingMode} />
          <InfoPill
            label="Enterprise project"
            value={cluster.enterpriseProjectId}
          />
          <InfoPill label="Alias" value={cluster.alias} />
          <InfoPill label="Description" value={cluster.description || "-"} />
        </div>
      </div>
    </ConsolePanel>
  );
}

function NodesTab({ nodes }: { nodes: CceNode[] }) {
  return (
    <ConsolePanel
      description={`${nodes.length} worker nodes returned by CCE`}
      icon={Server}
      title="Nodes"
    >
      <SimpleTable
        columns={[
          { header: "Name" },
          { header: "Status" },
          { header: "Flavor" },
          { header: "OS" },
          { header: "Private IP" },
          { header: "Public IP" },
          { header: "AZ" },
          { header: "Billing" },
        ]}
        emptyState={
          <p className="max-w-xl text-sm font-semibold text-[#667085]">
            No CCE nodes were returned for this cluster.
          </p>
        }
        minWidthClassName="min-w-[980px]"
        rows={nodes.map((node) => ({
          cells: [
            <ResourceIdentity
              id={node.serverId !== "-" ? node.serverId : node.id}
              key="name"
              name={node.name}
            />,
            <StatusBadge key="status" status={node.status} />,
            node.flavor,
            node.os,
            node.privateIp,
            node.publicIp,
            node.availabilityZone,
            node.billingMode,
          ],
          key: node.id,
        }))}
      />
    </ConsolePanel>
  );
}

function AddonsTab({ addons }: { addons: CceAddon[] }) {
  return (
    <ConsolePanel
      description={`${addons.length} installed add-on instances`}
      icon={PackageCheck}
      title="Add-ons"
    >
      {addons.length ? (
        <ConsolePanelBody columns="lg-2" gap="md">
          {addons.map((addon) => (
            <ConsoleSubPanel
              actions={<StatusBadge status={addon.status} />}
              className="bg-[#fbfcfe] dark:bg-white/5"
              contentClassName="p-4"
              key={addon.id}
              title={addon.alias !== "-" ? addon.alias : addon.templateName}
            >
              <p className="break-all text-xs font-semibold text-[#98a2b3]">
                {addon.id}
              </p>
              <ConsoleKeyValueList
                className="mt-4"
                items={[
                  { label: "Template", value: addon.templateName },
                  { label: "Version", value: addon.version },
                  { label: "Type", value: addon.templateType },
                  { label: "Category", value: addon.category },
                  { label: "Reason", value: addon.reason || "-" },
                  { label: "Message", value: addon.message || "-" },
                ]}
              />
            </ConsoleSubPanel>
          ))}
        </ConsolePanelBody>
      ) : (
        <ConsoleEmptyPanelBody className="py-12" title="No add-ons found">
          No CCE add-on instances were returned for this cluster.
        </ConsoleEmptyPanelBody>
      )}
    </ConsolePanel>
  );
}

function NetworkTab({ cluster }: { cluster: CceClusterDetail }) {
  const items = [
    {
      href:
        cluster.vpcId !== "-"
          ? `/services/network/vpcs/${cluster.vpcId}`
          : undefined,
      label: "VPC",
      value: cluster.vpcId,
    },
    {
      href:
        cluster.subnetId !== "-"
          ? `/services/network/subnets/${cluster.subnetId}`
          : undefined,
      label: "Subnet",
      value: cluster.subnetId,
    },
    {
      href:
        cluster.securityGroupId !== "-"
          ? `/services/network/security-groups/${cluster.securityGroupId}`
          : undefined,
      label: "Security group",
      value: cluster.securityGroupId,
    },
    {
      label: "Container network mode",
      value: cluster.containerNetworkMode,
    },
    {
      label: "Container CIDR",
      value: cluster.containerNetworkCidr,
    },
    {
      label: "Cluster ID",
      value: cluster.id,
    },
  ];

  return (
    <FactGrid
      items={items.map((item) => ({
        label: item.label,
        value: item.href ? (
          <ResourceIdentity href={item.href} name={item.value} />
        ) : (
          item.value
        ),
      }))}
    />
  );
}

export default async function CceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const activeTab = isTab(query.tab) ? query.tab : "overview";
  const result = await withCloudResult(
    null,
    (session) => getCceCluster(session, id),
    `cce-cluster:${id}`,
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Containers"
        backHref="/services/cce"
        error={result.error}
      />
    );
  const cluster = result.data;
  if (!cluster) notFound();

  return (
    <ConsoleShell active="Containers">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <CloudErrorBanner error={result.error} isCached={result.isCached} />
        <ResourceDetailHero
          actions={<RefreshButton />}
          backHref="/services/cce"
          backLabel="Back to CCE"
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${cluster.version} · ${cluster.type} · ${cluster.region}`}
              updatedAt={result.updatedAt}
            />
          }
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-2">
              CCE cluster <StatusBadge status={cluster.status} />
            </span>
          }
          icon={Boxes}
          id={cluster.id}
          title={cluster.name}
        />

        <nav className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Link
              className={`rounded-lg border px-4 py-2 text-sm font-black ${
                activeTab === tab.id
                  ? "border-[#2563eb] bg-[#eef4ff] text-[#2563eb]"
                  : "border-[#d9e0eb] bg-white text-[#344054] hover:bg-[#f8fafc]"
              }`}
              href={`/services/cce/${cluster.id}?tab=${tab.id}`}
              key={tab.id}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {activeTab === "overview" ? <OverviewTab cluster={cluster} /> : null}
        {activeTab === "nodes" ? <NodesTab nodes={cluster.nodes} /> : null}
        {activeTab === "addons" ? <AddonsTab addons={cluster.addons} /> : null}
        {activeTab === "network" ? <NetworkTab cluster={cluster} /> : null}
      </ConsoleMain>
    </ConsoleShell>
  );
}
