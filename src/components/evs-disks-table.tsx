"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckSquare, Square } from "lucide-react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import {
  AttachDetachEvsDiskButton,
  BulkDeleteEvsDisksButton,
  CreateEvsSnapshotButton,
  DeleteEvsDiskButton,
  EditEvsDiskButton,
  ExtendEvsDiskButton,
} from "@/components/evs-disk-actions";
import {
  ConsoleButton,
  ConsoleEmptyPanelBody,
  ConsoleResourceLink,
  ConsoleSelectedItemsToolbar,
  EmptyContent,
} from "@/components/console-ui";

type EvsTableDisk = {
  attachedDevice: string;
  attachedServerId: string;
  attachedTo: string;
  availabilityZone: string;
  description: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  size: string;
  status: string;
  type: string;
  typeLabel: string;
  rawSizeGb: number;
};

type EvsTableInstance = {
  availabilityZone: string;
  id: string;
  name: string;
  projectId: string;
  region: string;
  status: string;
};

function AttachedInstanceLink({
  attachedDevice,
  attachedServerId,
  instances,
}: {
  attachedDevice: string;
  attachedServerId: string;
  instances: EvsTableInstance[];
}) {
  if (!attachedServerId) {
    return <span className="font-bold text-[#98a2b3]">Not attached</span>;
  }

  const instance = instances.find((item) => item.id === attachedServerId);

  return (
    <div>
      <ConsoleResourceLink href={`/services/ecs/${attachedServerId}`}>
        {instance?.name ?? attachedServerId}
      </ConsoleResourceLink>
      <p className="mt-1 text-xs font-semibold text-[#98a2b3]">
        {attachedDevice || attachedServerId}
      </p>
    </div>
  );
}

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
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      aria-label="Select all EVS disks"
      checked={checked}
      className="size-4 rounded border-[#c8d3e3] text-[#2563eb]"
      onChange={onChange}
      ref={ref}
      type="checkbox"
    />
  );
}

export function EvsDisksTable({
  disks,
  instances,
}: {
  disks: EvsTableDisk[];
  instances: EvsTableInstance[];
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedDisks = useMemo(
    () => disks.filter((disk) => selectedIdSet.has(disk.id)),
    [disks, selectedIdSet],
  );
  const allSelected = disks.length > 0 && selectedIds.length === disks.length;
  const partiallySelected = selectedIds.length > 0 && !allSelected;
  const columns: DataTableColumn<EvsTableDisk>[] = [
    {
      header: (
        <SelectAllCheckbox
          checked={allSelected}
          indeterminate={partiallySelected}
          onChange={toggleAll}
        />
      ),
      headerClassName: "w-12",
      className: "align-top",
      cell: (disk) => {
        const selected = selectedIdSet.has(disk.id);

        return (
          <input
            aria-label={`Select ${disk.name}`}
            checked={selected}
            className="size-4 rounded border-[#c8d3e3] text-[#2563eb]"
            onChange={() => toggleDisk(disk.id)}
            type="checkbox"
          />
        );
      },
    },
    {
      header: "Name",
      cell: (disk) => (
        <>
          <ConsoleResourceLink href={`/services/evs/${disk.id}`} underline={false}>
            {disk.name}
          </ConsoleResourceLink>
          <p className="mt-1 text-xs font-semibold text-[#98a2b3]">
            {disk.id}
          </p>
        </>
      ),
    },
    {
      header: "Status",
      className: "font-bold",
      cell: (disk) => disk.status,
    },
    {
      header: "Size",
      className: "font-bold",
      cell: (disk) => disk.size,
    },
    {
      header: "Type",
      cell: (disk) => (
        <>
          <p className="font-black">{disk.typeLabel}</p>
          <p className="mt-1 text-xs font-semibold text-[#98a2b3]">
            {disk.type}
          </p>
        </>
      ),
    },
    {
      header: "Attached to",
      cell: (disk) => (
        <AttachedInstanceLink
          attachedDevice={disk.attachedDevice}
          attachedServerId={disk.attachedServerId}
          instances={instances}
        />
      ),
    },
    {
      header: "AZ",
      className: "font-bold",
      cell: (disk) => disk.availabilityZone,
    },
    {
      header: "Project",
      cell: (disk) => (
        <>
          <p className="font-bold">{disk.projectName}</p>
          <p className="mt-1 text-xs font-semibold text-[#98a2b3]">
            {disk.region}
          </p>
        </>
      ),
    },
    {
      header: "Actions",
      headerClassName: "text-right",
      cell: (disk) => (
        <div className="flex flex-wrap justify-end gap-2">
          <CreateEvsSnapshotButton
            disks={disks}
            selectedDiskId={disk.id}
          />
          <EditEvsDiskButton disk={disk} />
          <ExtendEvsDiskButton disk={disk} />
          <AttachDetachEvsDiskButton disk={disk} instances={instances} />
          <DeleteEvsDiskButton
            attachedTo={disk.attachedTo}
            diskId={disk.id}
            diskName={disk.name}
            projectId={disk.projectId}
            status={disk.status}
          />
        </div>
      ),
    },
  ];

  function toggleAll() {
    setSelectedIds(allSelected ? [] : disks.map((disk) => disk.id));
  }

  function toggleDisk(diskId: string) {
    setSelectedIds((current) =>
      current.includes(diskId)
        ? current.filter((id) => id !== diskId)
        : [...current, diskId],
    );
  }

  if (!disks.length) {
    return <ConsoleEmptyPanelBody title="No EVS disks found" />;
  }

  return (
    <>
      {selectedDisks.length ? (
        <ConsoleSelectedItemsToolbar
          actions={
            <>
              <ConsoleButton
                onClick={() => setSelectedIds([])}
                size="md"
                variant="neutral"
              >
                <Square className="size-4" />
                Clear selection
              </ConsoleButton>
              <BulkDeleteEvsDisksButton disks={selectedDisks} />
            </>
          }
          icon={<CheckSquare className="size-4" />}
        >
          <p className="text-sm font-black text-[#101828] dark:text-white">
            {selectedDisks.length} selected
          </p>
          <p className="text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
            Bulk actions apply to selected EVS disks only.
          </p>
        </ConsoleSelectedItemsToolbar>
      ) : null}
      <DataTable
        columns={columns}
        emptyState={<EmptyContent title="No EVS disks found" />}
        getRowClassName={(disk) => selectedIdSet.has(disk.id) ? "bg-[#eef4ff]" : ""}
        getRowKey={(disk) => disk.id}
        getSearchText={(disk) => [
          disk.name,
          disk.id,
          disk.status,
          disk.size,
          disk.type,
          disk.typeLabel,
          disk.attachedTo,
          disk.attachedServerId,
          disk.attachedDevice,
          disk.availabilityZone,
          disk.projectName,
          disk.region,
        ].join(" ")}
        items={disks}
        searchPlaceholder="Search disks by name, status, type, attachment, AZ..."
        tableMinWidthClassName="min-w-[1040px]"
      />
    </>
  );
}
