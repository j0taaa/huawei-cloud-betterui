"use client";

import { useMemo } from "react";
import { Radio, ShieldCheck } from "lucide-react";

import { CellStack, EmptyContent, ResourceIdentity } from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { LocalDateTime } from "@/components/local-date-time";
import { DeleteSmnTopicButton } from "@/components/smn-topic-actions";

export type SmnTopicTableItem = {
  displayName?: string;
  enterpriseProjectId?: string;
  id?: string;
  name: string;
  projectId?: string;
  projectName?: string;
  pushPolicy?: number | string;
  region?: string;
  topicUrn: string;
  updatedAt?: string;
};

export function pushPolicyLabel(value: SmnTopicTableItem["pushPolicy"]) {
  if (value === 0 || value === "0") {
    return "HTTP status only";
  }

  if (value === 1 || value === "1") {
    return "JSON envelope";
  }

  return value ? String(value) : "-";
}

function topicSearchText(topic: SmnTopicTableItem) {
  return [
    topic.name,
    topic.displayName,
    topic.topicUrn,
    topic.enterpriseProjectId,
    topic.projectId,
    topic.projectName,
    topic.region,
    pushPolicyLabel(topic.pushPolicy),
  ]
    .filter(Boolean)
    .join(" ");
}

export function SmnTopicsTable({ topics }: { topics: SmnTopicTableItem[] }) {
  const columns = useMemo(
    (): DataTableColumn<SmnTopicTableItem>[] => [
      {
        cell: (topic) => (
          <ResourceIdentity
            id={topic.topicUrn}
            name={topic.name}
            scope={topic.displayName || "No display name"}
          />
        ),
        header: "Topic",
      },
      {
        cell: (topic) => (
          <p className="inline-flex items-center gap-1 font-semibold">
            <Radio className="size-3.5 text-[#c2410c]" />
            {pushPolicyLabel(topic.pushPolicy)}
          </p>
        ),
        header: "Delivery policy",
      },
      {
        cell: () => (
          <CellStack
            subValue={
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="size-3.5" />
                Delivery targets are not modified from this view
              </span>
            }
          >
            -
          </CellStack>
        ),
        className: "font-bold",
        header: "Subscriptions",
      },
      {
        cell: (topic) => topic.enterpriseProjectId || "-",
        className: "font-semibold",
        header: "Enterprise project",
      },
      {
        cell: (topic) => (
          <CellStack subValue={topic.region || "-"}>
            {topic.projectName || topic.projectId || "-"}
          </CellStack>
        ),
        className: "font-semibold",
        header: "Project / region",
      },
      {
        cell: (topic) => <LocalDateTime value={topic.updatedAt || ""} />,
        className: "font-semibold",
        header: "Updated",
      },
      {
        cell: (topic) => (
          <div className="text-right">
            <DeleteSmnTopicButton
              projectId={topic.projectId ?? ""}
              topicName={topic.name}
              topicUrn={topic.topicUrn}
            />
          </div>
        ),
        header: "Actions",
        headerClassName: "text-right",
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      emptyState={<EmptyContent title="No SMN topics found" />}
      getRowKey={(topic, index) => topic.topicUrn || topic.id || `${topic.name}:${index}`}
      getSearchText={topicSearchText}
      items={topics}
      searchPlaceholder="Search notification topics"
      tableMinWidthClassName="min-w-[980px]"
    />
  );
}
