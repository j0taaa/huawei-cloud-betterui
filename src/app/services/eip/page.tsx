import type { Metadata } from "next";
import { Cable, Gauge, Globe2, ShieldCheck, Wifi } from "lucide-react";

import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleCallout,
  ConsoleMutedText,
  ConsolePageHeader,
  ConsolePanel,
  DataFreshnessText,
  MetricCard,
  MetricGrid,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { CreateEipButton } from "@/components/eip-actions";
import {
  EipAddressesTable,
  isEipReleaseAllowed,
} from "@/components/eip-addresses-table";
import { RefreshButton } from "@/components/cloud-action-buttons";
import { getCurrentSession, getSessionProjects } from "@/lib/auth-session";
import { listEips, withCloudResult, type EipItem } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "EIP | Huawei Cloud Better UI",
};

export default async function EipPage() {
  const [result, session] = await Promise.all([
    withCloudResult<EipItem[]>([], listEips, "listEips"),
    getCurrentSession(),
  ]);
  const eips = result.data;
  const active = eips.filter((eip) => eip.status.toUpperCase() === "ACTIVE").length;
  const unbound = eips.filter((eip) => eip.status.toUpperCase() === "DOWN").length;
  const releasable = eips.filter(isEipReleaseAllowed).length;
  const totalBandwidth = eips.reduce((total, eip) => {
    const size = Number.parseInt(eip.bandwidthSize, 10);

    return Number.isFinite(size) ? total + size : total;
  }, 0);
  const projects = session
    ? getSessionProjects(session).map((project) => ({
        label: `${project.projectName} / ${project.region}`,
        value: project.projectId,
      }))
    : [];

  return (
    <ConsoleShell active="Networking">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <CreateEipButton projects={projects} />
            <RefreshButton />
            </>
          }
          backHref="/services/networking"
          backLabel="Back to networking"
          description="Internet-facing addresses with binding, bandwidth, billing, and release controls."
          icon={Globe2}
          iconClassName="bg-[#e0f2fe] text-[#0369a1]"
          title="Elastic IP"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid className="gap-3 sm:grid-cols-2">
          <MetricCard icon={Globe2} iconClassName="bg-[#e0f2fe] text-[#0369a1]" label="Total EIPs" value={eips.length} variant="compact" />
          <MetricCard icon={Wifi} iconClassName="bg-[#f0fdf4] text-[#166534]" label="Bound and active" value={active} variant="compact" />
          <MetricCard icon={Cable} iconClassName="bg-[#fff7ed] text-[#c2410c]" label="Unbound" value={unbound} variant="compact" />
          <MetricCard icon={Gauge} iconClassName="bg-[#eef4ff] text-[#2563eb]" label="Dedicated bandwidth" value={`${totalBandwidth} Mbit/s`} variant="compact" />
        </MetricGrid>

        <section className="grid gap-4 rounded-xl border border-[#dbeafe] bg-[#f8fbff] p-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <h2 className="text-lg font-black">Release guardrails</h2>
            <ConsoleMutedText className="mt-1" weight="semibold">
              This UI releases only unbound EIPs in DOWN status. Bound addresses
              stay protected until they are detached from their workload.
            </ConsoleMutedText>
          </div>
          <div className="grid gap-2 rounded-lg border border-[#bfdbfe] bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-black text-[#175cd3]">
              <ShieldCheck className="size-4" />
              {releasable} releasable address{releasable === 1 ? "" : "es"}
            </div>
            <p className="text-xs font-bold text-[#667085]">
              <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
            </p>
          </div>
        </section>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix="Public IP inventory across projects and regions"
              updatedAt={result.updatedAt}
            />
          }
          title="Elastic IP addresses"
        >
          <EipAddressesTable eips={eips} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
