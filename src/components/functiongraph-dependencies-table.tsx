"use client";

import { useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  PackageSearch,
} from "lucide-react";

import {
  CellStack,
  ConsoleButton,
  ConsoleIconTile,
  ConsoleMutedText,
  ConsoleTableToolbar,
  ResourceIdentity,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { LocalDateTime } from "@/components/local-date-time";
import type { FunctionGraphDependencyInventoryItem } from "@/lib/huawei-cloud/types";

function isPublicDependency(dependency: FunctionGraphDependencyInventoryItem) {
  return dependency.owner === "public";
}

function dependencyText(dependency: FunctionGraphDependencyInventoryItem) {
  return [
    dependency.name,
    dependency.description,
    dependency.runtime,
    dependency.version,
    isPublicDependency(dependency) ? "public" : "private",
    dependency.size,
    dependency.projectName,
    dependency.region,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function FunctionGraphDependenciesTable({
  dependencies,
}: {
  dependencies: FunctionGraphDependencyInventoryItem[];
}) {
  const [showPublic, setShowPublic] = useState(false);
  const privateDependencies = useMemo(
    () => dependencies.filter((dependency) => !isPublicDependency(dependency)),
    [dependencies],
  );
  const publicDependencies = useMemo(
    () => dependencies.filter(isPublicDependency),
    [dependencies],
  );
  const visibleDependencies = useMemo(
    () =>
      showPublic
        ? [...privateDependencies, ...publicDependencies]
        : privateDependencies,
    [privateDependencies, publicDependencies, showPublic],
  );
  const columns = useMemo(
    (): DataTableColumn<FunctionGraphDependencyInventoryItem>[] => [
      {
        cell: (dependency) => (
          <div className="flex items-center gap-3">
            <ConsoleIconTile className="bg-[#fdf2f8] text-[#be185d]" size="md">
              <PackageSearch className="size-4" />
            </ConsoleIconTile>
            <ResourceIdentity
              description={dependency.description}
              descriptionClassName="line-clamp-2 font-semibold"
              name={dependency.name}
            />
          </div>
        ),
        header: "Dependency",
      },
      {
        cell: (dependency) => dependency.runtime,
        className: "font-semibold",
        header: "Runtime",
      },
      {
        cell: (dependency) => dependency.version,
        className: "font-semibold text-[#667085]",
        header: "Version",
      },
      {
        cell: (dependency) => (
          <span
            className={`rounded-full px-2 py-1 text-xs font-black ${
              isPublicDependency(dependency)
                ? "bg-[#eef2ff] text-[#4338ca]"
                : "bg-[#ecfdf3] text-[#027a48]"
            }`}
          >
            {isPublicDependency(dependency) ? "Public" : "Private"}
          </span>
        ),
        header: "Owner",
      },
      {
        cell: (dependency) => dependency.size,
        className: "font-semibold text-[#667085]",
        header: "Size",
      },
      {
        cell: (dependency) => (
          <CellStack subValue={dependency.region}>
            {dependency.projectName}
          </CellStack>
        ),
        className: "font-semibold",
        header: "Project",
      },
      {
        cell: (dependency) => <LocalDateTime value={dependency.updatedAt} />,
        className: "font-semibold",
        header: "Updated",
      },
    ],
    [],
  );

  return (
    <>
      <ConsoleTableToolbar
        actions={
          <ConsoleButton
            disabled={!publicDependencies.length}
            onClick={() => {
              setShowPublic((current) => !current);
            }}
            size="md"
            variant={showPublic ? "neutral" : "primaryOutline"}
          >
            {showPublic ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {showPublic ? "Hide public" : `Show public (${publicDependencies.length})`}
          </ConsoleButton>
        }
        tone="muted"
      >
        <ConsoleMutedText>
          Showing {privateDependencies.length} private dependencies
          {showPublic ? ` and ${publicDependencies.length} public dependencies` : ""}.
        </ConsoleMutedText>
      </ConsoleTableToolbar>

      <DataTable
        columns={columns}
        emptyState={(
          <ConsoleMutedText weight="semibold">
            {dependencies.length
              ? "No private FunctionGraph dependencies were returned for the selected projects."
              : "No FunctionGraph dependencies were returned for the selected projects."}
          </ConsoleMutedText>
        )}
        getRowKey={(dependency, index) =>
          `${dependency.projectId}:${dependency.id || dependency.name}:${index}`
        }
        getSearchText={dependencyText}
        items={visibleDependencies}
        searchPlaceholder="Search dependencies"
      />
    </>
  );
}
