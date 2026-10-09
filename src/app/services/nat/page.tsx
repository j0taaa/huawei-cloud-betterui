import type { Metadata } from "next";
import {
  Cable,
  CheckCircle2,
  Gauge,
  Network,
  Router,
  ShieldCheck,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  CellStack,
  ConsoleCallout,
  ConsolePageHeader,
  ConsoleMutedText,
  ConsolePanel,
  ConsoleResponsiveGrid,
  ConsoleTablePanel,
  FieldGrid,
  MetricCard,
  MetricGrid,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import {
  CreateNatGatewayButton,
  CreateNatSnatRuleButton,
  DeleteNatGatewayButton,
  DeleteNatSnatRuleButton,
} from "@/components/nat-actions";
import {
  listNatGateways,
  listNatSnatRules,
  withCloudResult,
  type NatGateway,
  type NatSnatRule,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "NAT Gateway | Huawei Cloud Better UI",
};

function valueOrDash(value?: string | number | null) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function specLabel(spec: string) {
  const labels: Record<string, string> = {
    "1": "Small",
    "2": "Medium",
    "3": "Large",
    "4": "Extra large",
    "5": "Enterprise",
  };

  return labels[spec] ? `${labels[spec]} (${spec})` : valueOrDash(spec);
}

function sourceLabel(rule: NatSnatRule) {
  if (rule.sourceType === 1) {
    return `Direct Connect / ${valueOrDash(rule.cidr)}`;
  }

  return rule.networkId ? `Subnet ${rule.networkId}` : `CIDR ${valueOrDash(rule.cidr)}`;
}

export default async function NatPage() {
  const [gatewayResult, snatResult] = await Promise.all([
    withCloudResult<NatGateway[]>([], listNatGateways, "listNatGateways"),
    withCloudResult<NatSnatRule[]>([], listNatSnatRules, "listNatSnatRules"),
  ]);
  const gateways = gatewayResult.data;
  const snatRules = snatResult.data;
  const activeGateways = gateways.filter(
    (gateway) => gateway.status.toUpperCase() === "ACTIVE",
  );
  const unfrozenRules = snatRules.filter((rule) => rule.adminStateUp);
  const rulesByGateway = new Map<string, NatSnatRule[]>();

  for (const rule of snatRules) {
    const existing = rulesByGateway.get(rule.gatewayId) ?? [];
    existing.push(rule);
    rulesByGateway.set(rule.gatewayId, existing);
  }

  const projectOptions = Array.from(
    new Map(
      gateways.map((gateway) => [
        gateway.projectId,
        {
          label: `${gateway.projectName || gateway.projectId} / ${gateway.region}`,
          value: gateway.projectId,
        },
      ]),
    ).values(),
  );
  const gatewayOptions = gateways.map((gateway) => ({
    adminStateUp: gateway.adminStateUp,
    label: `${gateway.name} / ${gateway.projectName || gateway.projectId} / ${gateway.region}`,
    projectId: gateway.projectId,
    status: gateway.status,
    value: gateway.id,
  }));
  const totalPps = gateways.reduce((sum, gateway) => sum + (gateway.ppsMax ?? 0), 0);
  const totalBps = gateways.reduce((sum, gateway) => sum + (gateway.bpsMax ?? 0), 0);
  const newestUpdatedAt =
    gatewayResult.updatedAt > snatResult.updatedAt
      ? gatewayResult.updatedAt
      : snatResult.updatedAt;

  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={gatewayResult.isRefreshing || snatResult.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <CreateNatGatewayButton
              projects={projectOptions.length ? projectOptions : [{ label: "Current project", value: "" }]}
            />
            <CreateNatSnatRuleButton gateways={gatewayOptions} />
            <RefreshButton />
            </>
          }
          backHref="/services/networking"
          backLabel="Back to Networking"
          description="Public NAT gateways, egress SNAT rules, VPC attachment, EIP binding, and capacity posture."
          icon={Router}
          iconClassName="bg-[#ccfbf1] text-[#0f766e]"
          title="NAT Gateway"
        />

        {gatewayResult.error || snatResult.error ? (
          <ConsoleCallout>{gatewayResult.error || snatResult.error}</ConsoleCallout>
        ) : null}

        <MetricGrid className="gap-3">
          {[
            {
              icon: Router,
              label: "Gateways",
              tone: "bg-[#ecfeff] text-[#0e7490]",
              value: gateways.length,
            },
            {
              icon: CheckCircle2,
              label: "Active gateways",
              tone: "bg-[#f0fdf4] text-[#027a48]",
              value: activeGateways.length,
            },
            {
              icon: ShieldCheck,
              label: "SNAT rules",
              tone: "bg-[#eff6ff] text-[#155eef]",
              value: snatRules.length,
            },
            {
              icon: Gauge,
              label: "PPS capacity",
              tone: "bg-[#fff7ed] text-[#c2410c]",
              value: totalPps ? totalPps.toLocaleString() : "-",
            },
          ].map((item) => (
            <MetricCard
              icon={item.icon}
              iconClassName={item.tone}
              key={item.label}
              label={item.label}
              value={item.value}
              variant="compact"
            />
          ))}
        </MetricGrid>

        <ConsoleResponsiveGrid variant="lg-1.5-1">
          <ConsolePanel
            description="Aggregate packet and bandwidth ceilings reported by NAT Gateway."
            icon={Cable}
            iconClassName="text-[#0f766e]"
            title="Gateway capacity"
          >
            <FieldGrid
              items={[
                { label: "BPS max", value: totalBps ? `${totalBps.toLocaleString()} Mbit/s` : "-" },
                { label: "Unfrozen SNAT", value: unfrozenRules.length },
                { label: "Projects", value: projectOptions.length || "-" },
              ]}
            />
          </ConsolePanel>
          <ConsolePanel
            description={`Showing ${gatewayResult.isCached || snatResult.isCached ? "cached" : "fresh"} NAT data.`}
            icon={Network}
            title="Data freshness"
          >
            <FieldGrid
              items={[
                {
                  label: "Last inventory update",
                  value: <LocalDateTime value={newestUpdatedAt} />,
                },
              ]}
            />
          </ConsolePanel>
        </ConsoleResponsiveGrid>

        <ConsoleTablePanel
          columns={[
            { header: "Gateway" },
            { header: "Status" },
            { header: "Spec" },
            { header: "VPC / subnet" },
            { header: "Private IP" },
            { header: "Rules" },
            { header: "Capacity" },
            { header: "Scope" },
            { header: "Actions", className: "text-right", headerClassName: "text-right" },
          ]}
          description="Create and remove public gateways, then manage attached SNAT egress rules."
          emptyState={
            <div>
                <p className="text-lg font-black">No NAT gateways found</p>
                <ConsoleMutedText className="mt-2" weight="semibold">
                  Create a gateway with a VPC ID and subnet network ID to start configuring egress.
                </ConsoleMutedText>
            </div>
          }
          minWidthClassName="min-w-[1180px]"
          rows={gateways.map((gateway) => {
            const linkedRules = rulesByGateway.get(gateway.id) ?? [];

            return {
              cells: [
                (
                  <ResourceIdentity
                    id={gateway.id}
                    key="gateway"
                    name={gateway.name}
                    scope={gateway.description || "No description"}
                  />
                ),
                (
                  <div key="status">
                    <StatusBadge status={gateway.status} />
                    <p className="mt-2 text-xs font-bold text-[#667085]">
                      {gateway.adminStateUp ? "Unfrozen" : "Frozen"}
                    </p>
                  </div>
                ),
                specLabel(gateway.spec),
                (
                  <CellStack key="network" subValue={`Subnet ${valueOrDash(gateway.subnetId)}`}>
                    VPC {valueOrDash(gateway.vpcId)}
                  </CellStack>
                ),
                valueOrDash(gateway.ngportIpAddress),
                (
                  <CellStack key="rules" subValue={`DNAT limit ${valueOrDash(gateway.dnatRulesLimit)}`}>
                    {linkedRules.length} SNAT
                  </CellStack>
                ),
                (
                  <CellStack
                    key="capacity"
                    subValue={gateway.bpsMax ? `${gateway.bpsMax.toLocaleString()} Mbit/s` : "-"}
                  >
                    {gateway.ppsMax ? `${gateway.ppsMax.toLocaleString()} pps` : "-"}
                  </CellStack>
                ),
                (
                  <CellStack key="scope" subValue={gateway.region}>
                    {gateway.projectName || gateway.projectId}
                  </CellStack>
                ),
                (
                  <DeleteNatGatewayButton
                    gatewayId={gateway.id}
                    gatewayName={gateway.name}
                    key="actions"
                    projectId={gateway.projectId}
                    ruleCount={linkedRules.length}
                    status={gateway.status}
                  />
                ),
              ],
              key: gateway.id,
            };
          })}
          title="Public NAT gateways"
        />

        <ConsoleTablePanel
          columns={[
            { header: "Rule" },
            { header: "Status" },
            { header: "Gateway" },
            { header: "Source" },
            { header: "EIP" },
            { header: "Created" },
            { header: "Scope" },
            { header: "Actions", className: "text-right", headerClassName: "text-right" },
          ]}
          description="Map private subnet or CIDR traffic to EIPs through active NAT gateways."
          emptyState={
            <div>
                <p className="text-lg font-black">No SNAT rules found</p>
                <ConsoleMutedText className="mt-2" weight="semibold">
                  SNAT rules can be added after at least one gateway reaches ACTIVE.
                </ConsoleMutedText>
            </div>
          }
          minWidthClassName="min-w-[1080px]"
          rows={snatRules.map((rule) => ({
            cells: [
              (
                <ResourceIdentity
                  key="rule"
                  name={rule.id}
                  scope={rule.description || "No description"}
                />
              ),
              (
                <div key="status">
                  <StatusBadge status={rule.status} />
                  <p className="mt-2 text-xs font-bold text-[#667085]">
                    {rule.adminStateUp ? "Unfrozen" : "Frozen"}
                  </p>
                </div>
              ),
              (
                <CellStack key="gateway" subValue={gateways.find((gateway) => gateway.id === rule.gatewayId)?.name || "-"}>
                  {rule.gatewayId}
                </CellStack>
              ),
              sourceLabel(rule),
              (
                <CellStack key="eip" subValue={valueOrDash(rule.floatingIpId)}>
                  {valueOrDash(rule.floatingIpAddress)}
                </CellStack>
              ),
              <LocalDateTime key="created" value={rule.createdAt} />,
              (
                <CellStack key="scope" subValue={rule.region}>
                  {rule.projectName || rule.projectId}
                </CellStack>
              ),
              (
                <DeleteNatSnatRuleButton
                  gatewayId={rule.gatewayId}
                  key="actions"
                  projectId={rule.projectId}
                  ruleId={rule.id}
                  status={rule.status}
                />
              ),
            ],
            key: rule.id,
          }))}
          title="SNAT egress rules"
        />
      </ConsoleMain>
    </ConsoleShell>
  );
}
