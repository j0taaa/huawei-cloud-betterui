"use client";

import { Building2, Clock3, KeyRound, UserRound } from "lucide-react";

import { CellStack, EmptyContent, ResourceIdentity, StatusBadge, type StatusTone } from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { LocalDateTime } from "@/components/local-date-time";
import type { IamUser } from "@/lib/huawei-cloud";

type IamUsersTableProps = {
  nowIso: string;
  users: IamUser[];
};

function enabledTone(enabled: string): StatusTone {
  return enabled.toLowerCase() === "true" ? "good" : "bad";
}

function passwordTone(passwordExpiresAt: string, nowIso: string): StatusTone {
  if (!passwordExpiresAt || passwordExpiresAt === "-") {
    return "neutral";
  }

  const expiresAt = new Date(passwordExpiresAt).getTime();
  const now = new Date(nowIso).getTime();

  if (Number.isNaN(expiresAt) || Number.isNaN(now)) {
    return "neutral";
  }

  const days = (expiresAt - now) / 86_400_000;

  if (days < 0) {
    return "bad";
  }

  if (days <= 14) {
    return "warn";
  }

  return "good";
}

function passwordLabel(passwordExpiresAt: string) {
  if (!passwordExpiresAt || passwordExpiresAt === "-") {
    return "No expiry returned";
  }

  if (Number.isNaN(new Date(passwordExpiresAt).getTime())) {
    return passwordExpiresAt;
  }

  return <LocalDateTime value={passwordExpiresAt} />;
}

export function IamUsersTable({ nowIso, users }: IamUsersTableProps) {
  const columns: DataTableColumn<IamUser>[] = [
    {
      cell: (user) => (
        <ResourceIdentity
          href={`/services/iam/${encodeURIComponent(user.id)}`}
          id={user.id}
          name={user.name}
          scope={user.description || "No description returned"}
        />
      ),
      header: "User",
    },
    {
      cell: (user) => (
        <span className="inline-flex items-center gap-2">
          <UserRound className="size-4 text-[#2563eb]" />
          <StatusBadge tone={enabledTone(user.enabled)}>
            {user.enabled.toLowerCase() === "true" ? "Enabled" : "Disabled"}
          </StatusBadge>
        </span>
      ),
      header: "State",
    },
    {
      cell: (user) => (
        <span className="inline-flex items-center gap-2">
          <KeyRound className="size-4 text-[#7c3aed]" />
          <StatusBadge tone={passwordTone(user.passwordExpiresAt, nowIso)}>
            {passwordLabel(user.passwordExpiresAt)}
          </StatusBadge>
        </span>
      ),
      header: "Password",
    },
    {
      cell: (user) => (
        <div className="flex items-center gap-2 font-semibold">
          <Building2 className="size-4 text-[#16a34a]" />
          <CellStack>{user.domainId}</CellStack>
        </div>
      ),
      header: "Domain",
    },
    {
      cell: (user) => (
        <div className="flex items-center gap-2 font-semibold text-[#667085]">
          <Clock3 className="size-4 text-[#ea580c]" />
          <CellStack>{user.description || "-"}</CellStack>
        </div>
      ),
      header: "Notes",
    },
  ];

  return (
    <DataTable
      columns={columns}
      emptyState={
        <EmptyContent title="No IAM users found">
          No IAM users were returned, or the signed-in principal lacks permission to list account users.
        </EmptyContent>
      }
      getRowKey={(user) => user.id}
      getSearchText={(user) =>
        `${user.name} ${user.id} ${user.description} ${user.enabled} ${user.passwordExpiresAt} ${user.domainId}`
      }
      items={users}
      searchPlaceholder="Search users, descriptions, domains, or status"
    />
  );
}
