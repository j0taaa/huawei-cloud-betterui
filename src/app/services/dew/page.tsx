import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { KeySquare } from "lucide-react";

import {
  DataFreshness,
  EmptyState,
  GovernanceShell,
  StatStrip,
  StatusPill,
} from "@/app/services/_components/governance-readonly";
import { LocalDateTime } from "@/components/local-date-time";
import { withCloudResult, listDewKeys, type DewKey } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DEW | Huawei Cloud Better UI",
  description: "Read-only Data Encryption Workshop keys inventory.",
};

function keyState(key: DewKey) {
  return key.keyState || "Unknown";
}

function stateIntent(state: string) {
  const normalized = state.toLowerCase();

  if (normalized === "enabled" || normalized === "2") {
    return "good";
  }

  if (normalized === "disabled" || normalized === "3") {
    return "warn";
  }

  if (
    normalized === "pending_delete" ||
    normalized === "scheduled deletion" ||
    normalized === "4"
  ) {
    return "bad";
  }

  if (normalized === "pending import" || normalized === "5") {
    return "info";
  }

  return "muted";
}

function displayDate(value?: string) {
  if (!value || value === "-") {
    return "-";
  }

  return <LocalDateTime value={value} />;
}

export default async function DewPage() {
  const result = await withCloudResult<DewKey[]>(
    [],
    listDewKeys,
    cloudCacheKeys.listDewKeys,
  );
  const keys = result.data;
  const enabled = keys.filter((key) => {
    const state = keyState(key).toLowerCase();
    return state === "enabled" || state === "2";
  }).length;
  const pendingDeletion = keys.filter((key) => {
    const state = keyState(key).toLowerCase();
    return (
      state === "pending_delete" ||
      state === "scheduled deletion" ||
      state === "4"
    );
  }).length;
  return (
    <GovernanceShell
      active="Security"
      backHref="/services/security"
      backLabel="Back to Security"
      description="KMS key identifiers, lifecycle state, type, origin, and project ownership."
      icon={KeySquare}
      result={result}
      title="Data Encryption Workshop"
      tone="red"
    >
      <StatStrip
        items={[
          { label: "Keys", value: keys.length, tone: "info" },
          {
            label: "Enabled",
            value: enabled,
            tone: enabled === keys.length ? "good" : "warn",
          },
          {
            label: "Pending deletion",
            value: pendingDeletion,
            tone: pendingDeletion ? "warn" : "info",
          },
          {
            label: "Projects",
            value: new Set(keys.map((key) => key.projectId)).size,
            tone: "info",
          },
        ]}
      />

      {pendingDeletion ? (
        <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
          {pendingDeletion} key{pendingDeletion === 1 ? "" : "s"} report pending
          deletion. Check dependent encrypted resources before the deletion
          window closes.
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="border-b border-[#e4e9f2] p-5">
          <h2 className="text-lg font-black">Keys Inventory</h2>
          <DataFreshness
            count={keys.length}
            isCached={result.isCached}
            label="keys"
            updatedAt={result.updatedAt}
          />
        </div>

        {keys.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                <tr>
                  <th className="px-5 py-3">Key</th>
                  <th className="px-5 py-3">Lifecycle</th>
                  <th className="px-5 py-3">Cryptography</th>
                  <th className="px-5 py-3">Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {keys.map((key) => (
                  <tr
                    className="hover:bg-[#fbfcfe]"
                    key={`${key.projectId ?? "project"}:${key.id ?? key.keyId ?? key.alias ?? "key"}`}
                  >
                    <td className="px-5 py-4 align-top">
                      <p className="font-black">{key.alias || "-"}</p>
                      <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">
                        {key.id || key.keyId || "-"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <StatusPill intent={stateIntent(keyState(key))}>
                        {keyState(key)}
                      </StatusPill>
                      <p className="mt-2 text-xs font-semibold text-[#667085]">
                        Created {displayDate(key.createdAt)}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p className="font-semibold">{key.keyType || "-"}</p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">
                        {key.origin || "-"}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">
                        Type {key.keyType || "-"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top font-semibold">
                      {key.projectName || key.projectId || "-"} ·{" "}
                      {key.region || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="No KMS keys were returned for the selected projects."
            title="No DEW keys found"
          />
        )}
      </section>
    </GovernanceShell>
  );
}
