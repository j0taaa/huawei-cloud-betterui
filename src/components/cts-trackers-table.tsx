"use client";

import { Archive, FolderTree, RadioTower } from "lucide-react";

import { CellStack, ConsoleMutedText, ProjectRegionCell, ResourceIdentity, StatusBadge, type StatusTone } from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import type { CtsTracker } from "@/lib/huawei-cloud";

type CtsTrackersTableProps = {
  trackers: CtsTracker[];
};

function statusTone(status: string): StatusTone {
  const normalized = status.toLowerCase();

  if (normalized === "enabled") {
    return "good";
  }

  if (normalized === "disabled") {
    return "warn";
  }

  if (normalized === "error") {
    return "bad";
  }

  return "neutral";
}

function enabledText(value: string) {
  return value.toLowerCase() === "true";
}

const columns: DataTableColumn<CtsTracker>[] = [
  {
    cell: (tracker) => (
      <ResourceIdentity
        href={`/services/cts/${encodeURIComponent(tracker.id)}`}
        id={tracker.id}
        name={tracker.name}
        scope={tracker.projectName}
      />
    ),
    header: "Tracker",
  },
  {
    cell: (tracker) => <StatusBadge tone={statusTone(tracker.status)}>{tracker.status}</StatusBadge>,
    header: "Status",
  },
  {
    cell: (tracker) => (
      <CellStack
        subValue={tracker.filePrefix === "-" ? "No prefix" : tracker.filePrefix}
      >
        <span className="inline-flex items-center gap-2 font-semibold">
          <Archive className="size-4 text-[#2563eb]" />
          {tracker.bucketName || "-"}
        </span>
      </CellStack>
    ),
    header: "OBS archive",
  },
  {
    cell: (tracker) => (
      <div className="flex flex-wrap items-center gap-2">
        <RadioTower className="size-4 text-[#7c3aed]" />
        <StatusBadge tone={enabledText(tracker.isLtsEnabled) ? "good" : "warn"}>
          {enabledText(tracker.isLtsEnabled) ? "Enabled" : "Off"}
        </StatusBadge>
        <span className="text-xs font-semibold text-[#667085]">Group {tracker.ltsGroupId}</span>
      </div>
    ),
    header: "LTS",
  },
  {
    cell: (tracker) => (
      <div className="flex items-start gap-2 font-semibold">
        <FolderTree className="mt-0.5 size-4 text-[#16a34a]" />
        <ProjectRegionCell
          projectId={tracker.projectId}
          projectName={tracker.projectName}
          region={tracker.region}
        />
      </div>
    ),
    header: "Project",
  },
];

export function CtsTrackersTable({ trackers }: CtsTrackersTableProps) {
  return (
    <DataTable
      columns={columns}
      emptyState={
        <div>
          <p className="font-black text-[#101828]">No CTS trackers found</p>
          <ConsoleMutedText className="mt-1" weight="semibold">
            No CTS trackers were returned. Verify CTS has been enabled in the selected projects and that the current IAM principal can list trackers.
          </ConsoleMutedText>
        </div>
      }
      getRowKey={(tracker) => `${tracker.projectId}:${tracker.id}`}
      getSearchText={(tracker) =>
        `${tracker.name} ${tracker.id} ${tracker.projectName} ${tracker.projectId} ${tracker.status} ${tracker.bucketName} ${tracker.filePrefix} ${tracker.isLtsEnabled} ${tracker.ltsGroupId} ${tracker.region}`
      }
      items={trackers}
      searchPlaceholder="Search trackers, buckets, LTS groups, projects, or regions"
    />
  );
}
