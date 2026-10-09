"use client";

import { CalendarDays, FolderTree, Tags } from "lucide-react";

import { CellStack, EmptyContent, ProjectRegionCell, ResourceIdentity, StatusBadge, type StatusTone } from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { LocalDateTime } from "@/components/local-date-time";
import type { LtsLogGroup } from "@/lib/huawei-cloud";

type LtsLogGroupsTableProps = {
  groups: LtsLogGroup[];
};

function ttlNumber(ttlDays: string) {
  const value = Number(ttlDays);
  return Number.isFinite(value) ? value : null;
}

function ttlTone(ttlDays: string): StatusTone {
  const value = ttlNumber(ttlDays);

  if (value === null) {
    return "neutral";
  }

  if (value < 30) {
    return "warn";
  }

  if (value >= 180) {
    return "good";
  }

  return "neutral";
}

function createdAt(group: LtsLogGroup) {
  if (!group.createdAt || group.createdAt === "-") {
    return "-";
  }

  return <LocalDateTime value={group.createdAt} />;
}

const columns: DataTableColumn<LtsLogGroup>[] = [
  {
    cell: (group) => (
      <ResourceIdentity
        href={`/services/lts/${encodeURIComponent(group.id)}`}
        id={group.id}
        name={group.name}
        scope={group.alias || "No alias returned"}
      />
    ),
    header: "Log group",
  },
  {
    cell: (group) => (
      <StatusBadge tone={ttlTone(group.ttlDays)}>
        {group.ttlDays === "-" ? "Unknown" : `${group.ttlDays} days`}
      </StatusBadge>
    ),
    header: "Retention",
  },
  {
    cell: (group) => (
      <div className="flex items-center gap-2 font-semibold">
        <CalendarDays className="size-4 text-[#2563eb]" />
        <CellStack>{createdAt(group)}</CellStack>
      </div>
    ),
    header: "Created",
  },
  {
    cell: (group) => (
      <div className="flex items-center gap-2 font-semibold">
        <Tags className="size-4 text-[#16a34a]" />
        <CellStack>{group.tags ? `${group.tags} tags` : "No tags returned"}</CellStack>
      </div>
    ),
    header: "Tags",
  },
  {
    cell: (group) => (
      <div className="flex items-start gap-2 font-semibold">
        <FolderTree className="mt-0.5 size-4 text-[#7c3aed]" />
        <ProjectRegionCell
          projectId={group.projectId}
          projectName={group.projectName}
          region={group.region}
        />
      </div>
    ),
    header: "Project",
  },
];

export function LtsLogGroupsTable({ groups }: LtsLogGroupsTableProps) {
  return (
    <DataTable
      columns={columns}
      emptyState={
        <EmptyContent title="No LTS log groups found">
          No LTS log groups were returned for the selected projects, or the current IAM principal cannot list LTS groups.
        </EmptyContent>
      }
      getRowKey={(group) => `${group.projectId}:${group.id}`}
      getSearchText={(group) =>
        `${group.name} ${group.alias} ${group.id} ${group.ttlDays} ${group.createdAt} ${group.tags} ${group.projectName} ${group.projectId} ${group.region}`
      }
      items={groups}
      searchPlaceholder="Search log groups, aliases, projects, or regions"
    />
  );
}
