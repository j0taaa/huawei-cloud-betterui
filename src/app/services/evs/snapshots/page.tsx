import { combineCloudLoads } from "@/lib/huawei/errors";
import type { Metadata } from "next";
import { Camera, CheckCircle2, HardDrive, RotateCcw } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleCallout,
  ConsoleLinkButton,
  ConsoleMain,
  ConsolePageHeader,
  ConsolePanel,
  ConsoleStatCardGrid,
  DataFreshnessText,
  MetricCard,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { CreateEvsSnapshotButton } from "@/components/evs-disk-actions";
import { ExportEvsSnapshotsButton } from "@/components/evs-detail-actions";
import { EvsSnapshotsTable } from "@/components/evs-snapshots-table";
import { listEvsDisks, listEvsSnapshots, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "EVS Snapshots | Huawei Cloud Better UI",
};

export default async function EvsSnapshotsPage() {
  const result = await withCloudResult(
    { disks: [], snapshots: [] },
    async (session) => {
      return combineCloudLoads({ disks: listEvsDisks(session), snapshots: listEvsSnapshots(session) }, { disks: [], snapshots: [] });
    },
    "evs-snapshot-inventory",
  );
  const { disks, snapshots } = result.data;
  const availableSnapshots = snapshots.filter((snapshot) => snapshot.status.toLowerCase() === "available");
  const protectedDisks = new Set(snapshots.map((snapshot) => snapshot.diskId).filter(Boolean));

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={(
            <>
              <CreateEvsSnapshotButton disks={disks} />
              <ExportEvsSnapshotsButton snapshots={snapshots} />
              <ConsoleLinkButton href="/services/evs" size="lg" variant="neutral">
                <HardDrive className="size-4" />
                View disks
              </ConsoleLinkButton>
              <RefreshButton />
            </>
          )}
          backHref="/services/evs"
          backLabel="Back to EVS disks"
          description={(
            <DataFreshnessText
              isCached={result.isCached}
              prefix="Point-in-time disk copies"
              updatedAt={result.updatedAt}
            />
          )}
          icon={Camera}
          iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
          title="EVS snapshots"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <ConsoleStatCardGrid columns={3}>
          <MetricCard icon={Camera} label="Snapshots" value={snapshots.length} variant="compact" />
          <MetricCard icon={CheckCircle2} iconClassName="bg-[#ecfdf3] text-[#027a48]" label="Available" value={availableSnapshots.length} variant="compact" />
          <MetricCard icon={RotateCcw} iconClassName="bg-[#fff7ed] text-[#b54708]" label="Protected disks" value={protectedDisks.size} variant="compact" />
        </ConsoleStatCardGrid>

        <ConsolePanel
          description={`${snapshots.length} snapshots across ${protectedDisks.size} source disks.`}
          icon={Camera}
          title="Snapshot inventory"
        >
          <EvsSnapshotsTable
            disks={disks}
            snapshots={snapshots}
          />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
