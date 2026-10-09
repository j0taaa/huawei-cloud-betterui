"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, Square } from "lucide-react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import {
  BulkDeleteEvsSnapshotsButton,
  CreateEvsDiskFromSnapshotButton,
  DeleteEvsSnapshotButton,
  RollbackEvsSnapshotButton,
} from "@/components/evs-disk-actions";
import { LocalDateTime } from "@/components/local-date-time";
import {
  CellStack,
  ConsoleButton,
  ConsoleEmptyPanelBody,
  ConsoleSelectedItemsToolbar,
  EmptyContent,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";

type EvsSnapshotRow = {
  createdAt: string;
  description: string;
  diskId: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  rawSizeGb: number;
  region: string;
  size: string;
  status: string;
};

type EvsSnapshotSourceDisk = {
  availabilityZone: string;
  id: string;
  name: string;
  projectId: string;
  rawSizeGb: number;
  type: string;
};

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      aria-label="Select all EVS snapshots"
      checked={checked}
      className="size-4 rounded border-[#c8d3e3] text-[#2563eb]"
      onChange={onChange}
      ref={ref}
      type="checkbox"
    />
  );
}

export function EvsSnapshotsTable({
  disks,
  snapshots,
}: {
  disks: EvsSnapshotSourceDisk[];
  snapshots: EvsSnapshotRow[];
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSnapshots = useMemo(
    () => snapshots.filter((snapshot) => selectedIdSet.has(snapshot.id)),
    [selectedIdSet, snapshots],
  );
  const allSelected = snapshots.length > 0 && selectedIds.length === snapshots.length;
  const columns: DataTableColumn<EvsSnapshotRow>[] = [
    {
      className: "align-top",
      header: (
        <SelectAllCheckbox
          checked={allSelected}
          indeterminate={selectedIds.length > 0 && !allSelected}
          onChange={() => setSelectedIds(allSelected ? [] : snapshots.map((snapshot) => snapshot.id))}
        />
      ),
      headerClassName: "w-12",
      cell: (snapshot) => (
        <input
          aria-label={`Select ${snapshot.name}`}
          checked={selectedIdSet.has(snapshot.id)}
          className="size-4 rounded border-[#c8d3e3] text-[#2563eb]"
          onChange={() => setSelectedIds((current) => current.includes(snapshot.id) ? current.filter((id) => id !== snapshot.id) : [...current, snapshot.id])}
          type="checkbox"
        />
      ),
    },
    {
      header: "Snapshot",
      cell: (snapshot) => (
        <ResourceIdentity id={snapshot.id} name={snapshot.name} />
      ),
    },
    {
      header: "Status",
      cell: (snapshot) => <StatusBadge status={snapshot.status} />,
    },
    {
      header: "Source disk",
      cell: (snapshot) => {
        const disk = disks.find((item) => item.id === snapshot.diskId);

        return disk ? (
          <ResourceIdentity href={`/services/evs/${disk.id}`} id={disk.id} name={disk.name} />
        ) : (
          <CellStack subValue="Source disk no longer returned">{snapshot.diskId}</CellStack>
        );
      },
    },
    { header: "Size", className: "font-bold", cell: (snapshot) => snapshot.size },
    { header: "Created", cell: (snapshot) => <LocalDateTime value={snapshot.createdAt} /> },
    {
      header: "Project",
      cell: (snapshot) => <CellStack subValue={snapshot.region}>{snapshot.projectName}</CellStack>,
    },
    {
      header: "Actions",
      headerClassName: "text-right",
      cell: (snapshot) => {
        const sourceDisk = disks.find((disk) => disk.id === snapshot.diskId);
        const projectDisks = disks.filter((disk) => disk.projectId === snapshot.projectId);
        const projectAvailabilityZones = Array.from(new Set([
          ...(sourceDisk ? [sourceDisk.availabilityZone] : []),
          ...projectDisks.map((disk) => disk.availabilityZone),
        ].filter(Boolean)));
        const projectVolumeTypes = Array.from(new Set([
          ...(sourceDisk ? [sourceDisk.type] : []),
          ...projectDisks.map((disk) => disk.type),
        ].filter(Boolean)));

        return (
          <div className="flex flex-wrap justify-end gap-2">
            <CreateEvsDiskFromSnapshotButton
              availabilityZones={projectAvailabilityZones}
              snapshot={snapshot}
              sourceDisk={sourceDisk}
              volumeTypes={projectVolumeTypes}
            />
            <RollbackEvsSnapshotButton snapshot={snapshot} />
            <DeleteEvsSnapshotButton snapshot={snapshot} />
          </div>
        );
      },
    },
  ];

  if (!snapshots.length) {
    return <ConsoleEmptyPanelBody title="No EVS snapshots found" />;
  }

  return (
    <>
      {selectedSnapshots.length ? (
        <ConsoleSelectedItemsToolbar
          actions={(
            <>
              <ConsoleButton onClick={() => setSelectedIds([])} size="md" variant="neutral">
                <Square className="size-4" />
                Clear selection
              </ConsoleButton>
              <BulkDeleteEvsSnapshotsButton snapshots={selectedSnapshots} />
            </>
          )}
          icon={<CheckSquare className="size-4" />}
        >
          <p className="text-sm font-black text-[#101828] dark:text-white">
            {selectedSnapshots.length} selected
          </p>
          <p className="text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
            Busy snapshots are skipped by bulk deletion.
          </p>
        </ConsoleSelectedItemsToolbar>
      ) : null}
      <DataTable
        columns={columns}
        emptyState={<EmptyContent title="No EVS snapshots found" />}
        getRowClassName={(snapshot) => selectedIdSet.has(snapshot.id) ? "bg-[#eef4ff] dark:bg-[#172554]/40" : ""}
        getRowKey={(snapshot) => snapshot.id}
        getSearchText={(snapshot) => [
          snapshot.name,
          snapshot.id,
          snapshot.status,
          snapshot.diskId,
          snapshot.size,
          snapshot.projectName,
          snapshot.region,
          snapshot.description,
        ].join(" ")}
        items={snapshots}
        searchPlaceholder="Search snapshots by name, status, source disk, or project..."
        tableMinWidthClassName="min-w-[1180px]"
      />
    </>
  );
}
