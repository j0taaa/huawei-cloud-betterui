import { combineCloudLoads } from "@/lib/huawei/errors";
import type { Metadata } from "next";
import { Camera, HardDrive } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleCallout,
  ConsoleLinkButton,
  ConsoleMain,
  ConsolePageHeader,
  ConsolePanel,
  DataFreshnessText,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import {
  CreateEvsDiskButton,
  CreateEvsSnapshotButton,
} from "@/components/evs-disk-actions";
import { EvsDisksTable } from "@/components/evs-disks-table";
import { listEcsInstances, listEvsDisks, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "EVS | Huawei Cloud Better UI",
};

export default async function EvsPage() {
  const result = await withCloudResult(
    { disks: [], instances: [] },
    async (session) => {
      return combineCloudLoads({ disks: listEvsDisks(session), instances: listEcsInstances(session) }, { disks: [], instances: [] });
    },
    "evs-page-inventory",
  );
  const { disks, instances } = result.data;
  const projects = Array.from(
    new Map(
      disks.map((disk) => [
        disk.projectId,
        {
          label: `${disk.projectName} / ${disk.region}`,
          value: disk.projectId,
        },
      ]),
    ).values(),
  );
  const availabilityZones = Array.from(
    new Set(disks.map((disk) => disk.availabilityZone).filter(Boolean)),
  ).sort();
  const volumeTypes = Array.from(new Set(disks.map((disk) => disk.type).filter(Boolean))).sort();

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
              <CreateEvsDiskButton
                availabilityZones={availabilityZones}
                projects={
                  projects.length
                    ? projects
                    : [{ label: "Current project", value: "" }]
                }
                volumeTypes={volumeTypes.length ? volumeTypes : ["SSD", "GPSSD", "SAS"]}
              />
              <CreateEvsSnapshotButton disks={disks} />
              <ConsoleLinkButton href="/services/evs/snapshots" size="lg" variant="purple">
                <Camera className="size-4" />
                Snapshots
              </ConsoleLinkButton>
              <RefreshButton />
            </>
          }
          backHref="/"
          backLabel="Back to dashboard"
          description="Real EVS disks for the selected project."
          icon={HardDrive}
          title="Elastic Volume Service"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${disks.length} disks`}
              updatedAt={result.updatedAt}
            />
          }
          title="Disks"
        >
          <EvsDisksTable disks={disks} instances={instances} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
