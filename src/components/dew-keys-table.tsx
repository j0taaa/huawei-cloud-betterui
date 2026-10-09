"use client";

import { CalendarClock, Globe2, KeyRound, RotateCw, ShieldCheck } from "lucide-react";

import { CellStack, EmptyContent, ResourceIdentity, StatusBadge, type StatusTone } from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { LocalDateTime } from "@/components/local-date-time";

export type DewKeyRow = {
  alias?: string;
  createdAt?: string;
  description?: string;
  id?: string;
  keyId?: string;
  keyState?: string;
  keyType?: string;
  origin?: string;
  projectId?: string;
  projectName?: string;
  region?: string;
  rotationEnabled?: string;
  scheduledDeletionAt?: string;
  secretCount?: number;
  secretStates?: string[];
  spec?: string;
  state?: string;
  type?: string;
  usage?: string;
};

type DewKeysTableProps = {
  keys: DewKeyRow[];
};

export function dewKeyState(key: DewKeyRow) {
  return key.state || key.keyState || "Unknown";
}

function stateTone(state: string): StatusTone {
  const normalized = state.toLowerCase();

  if (normalized === "enabled" || normalized === "2") {
    return "good";
  }

  if (normalized === "disabled" || normalized === "3" || normalized === "pending import" || normalized === "5") {
    return "warn";
  }

  if (normalized === "pending_delete" || normalized === "scheduled deletion" || normalized === "4") {
    return "bad";
  }

  return "neutral";
}

function rotationTone(rotationEnabled: string): StatusTone {
  return rotationEnabled.toLowerCase() === "true" ? "good" : "warn";
}

function displayDate(value?: string) {
  if (!value || value === "-") {
    return "-";
  }

  return <LocalDateTime value={value} />;
}

const columns: DataTableColumn<DewKeyRow>[] = [
  {
    cell: (key) => (
      <ResourceIdentity
        id={key.id || key.keyId || "-"}
        name={key.alias || "-"}
        scope={key.description || "-"}
      />
    ),
    header: "Key",
  },
  {
    cell: (key) => (
      <CellStack
        subValue={
          <>
            Created {displayDate(key.createdAt)}
            {key.scheduledDeletionAt && key.scheduledDeletionAt !== "-" ? (
              <span className="mt-1 block font-bold text-[#b42318]">
                Deletes {displayDate(key.scheduledDeletionAt)}
              </span>
            ) : null}
          </>
        }
      >
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="size-4 text-[#ea580c]" />
          <StatusBadge tone={stateTone(dewKeyState(key))}>{dewKeyState(key)}</StatusBadge>
        </span>
      </CellStack>
    ),
    header: "Lifecycle",
  },
  {
    cell: (key) => (
      <CellStack subValue={`${key.usage || "-"} · ${key.origin || "-"} · Type ${key.type || key.keyType || "-"}`}>
        <span className="inline-flex items-center gap-2 font-semibold">
          <KeyRound className="size-4 text-[#2563eb]" />
          {key.spec || "-"}
        </span>
      </CellStack>
    ),
    header: "Cryptography",
  },
  {
    cell: (key) => (
      <span className="inline-flex items-center gap-2">
        <RotateCw className="size-4 text-[#16a34a]" />
        <StatusBadge tone={rotationTone(key.rotationEnabled ?? "")}>
          {(key.rotationEnabled ?? "").toLowerCase() === "true" ? "Enabled" : "Not returned"}
        </StatusBadge>
      </span>
    ),
    header: "Rotation",
  },
  {
    cell: (key) => (
      <CellStack
        subValue={key.secretStates?.length ? key.secretStates.join(", ") : "No secret metadata returned"}
      >
        <span className="inline-flex items-center gap-2 font-black">
          <ShieldCheck className="size-4 text-[#7c3aed]" />
          {key.secretCount ?? 0} bound secrets
        </span>
      </CellStack>
    ),
    header: "Secrets",
  },
  {
    cell: (key) => (
      <CellStack subValue={key.region || "-"}>
        <span className="inline-flex items-center gap-2 font-semibold">
          <Globe2 className="size-4 text-[#16a34a]" />
          {key.projectName || key.projectId || "-"}
        </span>
      </CellStack>
    ),
    header: "Project",
  },
];

export function DewKeysTable({ keys }: DewKeysTableProps) {
  return (
    <DataTable
      columns={columns}
      emptyState={
        <EmptyContent title="No DEW keys found">
          No DEW keys were returned. Secret metadata is only shown when the shared loader can list CSMS secrets; secret values are never requested.
        </EmptyContent>
      }
      getRowKey={(key) => `${key.projectId ?? "project"}:${key.id ?? key.keyId ?? key.alias ?? "key"}`}
      getSearchText={(key) =>
        `${key.alias} ${key.id} ${key.keyId} ${key.description} ${dewKeyState(key)} ${key.createdAt} ${key.scheduledDeletionAt} ${key.spec} ${key.usage} ${key.origin} ${key.type} ${key.keyType} ${key.rotationEnabled} ${key.secretCount} ${key.secretStates?.join(" ")} ${key.projectName} ${key.projectId} ${key.region}`
      }
      items={keys}
      searchPlaceholder="Search keys, states, cryptography, secrets, projects, or regions"
      tableMinWidthClassName="min-w-[1180px]"
    />
  );
}
