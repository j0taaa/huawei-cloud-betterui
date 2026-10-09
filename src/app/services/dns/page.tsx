import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { DatabaseZap, Globe2, Network, RadioTower } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleCallout,
  ConsolePageHeader,
  ConsolePanel,
  DataFreshnessText,
  MetricCard,
  MetricGrid,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { CreateDnsZoneButton } from "@/components/dns-zone-actions";
import { DnsZonesTable } from "@/components/dns-zones-table";
import { getCurrentSession, getSessionProjects } from "@/lib/auth-session";
import { listDnsZones, type DnsZone, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "DNS | Huawei Cloud Better UI" };

export default async function DnsPage() {
  const [session, result] = await Promise.all([
    getCurrentSession(),
    withCloudResult<DnsZone[]>([], listDnsZones, cloudCacheKeys.listDnsZones),
  ]);
  const zones = result.data;
  const active = zones.filter((zone) => zone.status.toLowerCase() === "active").length;
  const totalRecords = zones.reduce((sum, zone) => sum + zone.recordCount, 0);
  const projects = session
    ? getSessionProjects(session).map((project) => ({
        label: `${project.projectName || project.projectId} / ${project.region}`,
        value: project.projectId,
      }))
    : [{ label: "Current project", value: "" }];

  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <CreateDnsZoneButton projects={projects} />
            <RefreshButton />
            </>
          }
          backHref="/services/networking"
          backLabel="Back to Networking"
          description="Public zone lifecycle, record density, authoritative status, and project ownership."
          icon={Network}
          iconClassName="bg-[#ecfeff] text-[#0891b2]"
          title="Domain Name Service"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid className="gap-3">
          <MetricCard icon={Globe2} iconClassName="bg-[#ecfeff] text-[#0891b2]" label="Zones" value={zones.length} variant="compact" />
          <MetricCard icon={RadioTower} iconClassName="bg-[#f0fdf4] text-[#166534]" label="Active" value={active} variant="compact" />
          <MetricCard icon={DatabaseZap} iconClassName="bg-[#eef4ff] text-[#2563eb]" label="Record sets" value={totalRecords} variant="compact" />
          <MetricCard icon={Network} iconClassName="bg-[#fff7ed] text-[#c2410c]" label="Projects" value={new Set(zones.map((zone) => zone.projectId)).size} variant="compact" />
        </MetricGrid>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${zones.length} zones`}
              updatedAt={result.updatedAt}
            />
          }
          title="Public zones"
        >
          <DnsZonesTable zones={zones} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
