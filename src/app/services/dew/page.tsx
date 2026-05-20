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
import type { BetterUiSession } from "@/lib/auth-session";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DEW | Huawei Cloud Better UI",
  description: "Read-only Data Encryption Workshop keys and secrets inventory.",
};

type DewKey = {
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

type ListDewKeys = (session: BetterUiSession) => Promise<DewKey[]>;

const listDewKeys =
  (huaweiCloud as typeof huaweiCloud & { listDewKeys?: ListDewKeys })
    .listDewKeys ??
  (async () => {
    throw new Error("listDewKeys is not exported from @/lib/huawei-cloud yet.");
  });

function keyState(key: DewKey) {
  return key.state || key.keyState || "Unknown";
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

function rotationIntent(rotationEnabled: string) {
  return rotationEnabled.toLowerCase() === "true" ? "good" : "warn";
}

function displayDate(value?: string) {
  if (!value || value === "-") {
    return "-";
  }

  return <LocalDateTime value={value} />;
}

export default async function DewPage() {
  const result = await withCloudResult<DewKey[]>([], listDewKeys, "listDewKeys");
  const keys = result.data;
  const enabled = keys.filter((key) => {
    const state = keyState(key).toLowerCase();
    return state === "enabled" || state === "2";
  }).length;
  const pendingDeletion = keys.filter((key) => {
    const state = keyState(key).toLowerCase();
    return state === "pending_delete" || state === "scheduled deletion" || state === "4";
  }).length;
  const rotationEnabled = keys.filter(
    (key) => (key.rotationEnabled ?? "").toLowerCase() === "true",
  ).length;
  const secrets = keys.reduce((total, key) => total + (key.secretCount ?? 0), 0);

  return (
    <GovernanceShell
      active="Security"
      backHref="/services/security"
      backLabel="Back to Security"
      description="KMS key lifecycle, rotation posture, scheduled deletion, and CSMS secret metadata without exposing secret values."
      icon={KeySquare}
      result={result}
      title="Data Encryption Workshop"
      tone="red"
    >
      <StatStrip
        items={[
          { label: "Keys", value: keys.length, tone: "info" },
          { label: "Enabled", value: enabled, tone: enabled === keys.length ? "good" : "warn" },
          { label: "Rotation enabled", value: rotationEnabled || "Not returned", tone: rotationEnabled ? "good" : "warn" },
          { label: "Secrets", value: secrets || "Not returned", tone: "info" },
        ]}
      />

      {pendingDeletion ? (
        <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
          {pendingDeletion} key{pendingDeletion === 1 ? "" : "s"} report pending deletion. Check dependent encrypted resources before the deletion window closes.
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="border-b border-[#e4e9f2] p-5">
          <h2 className="text-lg font-black">Keys and Secrets Inventory</h2>
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
                  <th className="px-5 py-3">Rotation</th>
                  <th className="px-5 py-3">Secrets</th>
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
                      <p className="mt-2 max-w-sm text-xs font-semibold leading-5 text-[#667085]">
                        {key.description || "-"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <StatusPill intent={stateIntent(keyState(key))}>
                        {keyState(key)}
                      </StatusPill>
                      <p className="mt-2 text-xs font-semibold text-[#667085]">
                        Created {displayDate(key.createdAt)}
                      </p>
                      {key.scheduledDeletionAt && key.scheduledDeletionAt !== "-" ? (
                        <p className="mt-1 text-xs font-bold text-[#b42318]">
                          Deletes {displayDate(key.scheduledDeletionAt)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p className="font-semibold">{key.spec || "-"}</p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">
                        {key.usage || "-"} · {key.origin || "-"}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">
                        Type {key.type || key.keyType || "-"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <StatusPill intent={rotationIntent(key.rotationEnabled ?? "")}>
                        {(key.rotationEnabled ?? "").toLowerCase() === "true"
                          ? "Enabled"
                          : "Not returned"}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p className="font-black">{key.secretCount ?? 0} bound secrets</p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">
                        {key.secretStates?.length
                          ? key.secretStates.join(", ")
                          : "No secret metadata returned"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top font-semibold">
                      {key.projectName || key.projectId || "-"} · {key.region || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="No DEW keys were returned. Secret metadata is only shown when the shared loader can list CSMS secrets; secret values are never requested."
            title="No DEW keys found"
          />
        )}
      </section>
    </GovernanceShell>
  );
}
