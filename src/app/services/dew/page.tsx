import type { Metadata } from "next";
import { KeySquare } from "lucide-react";

import {
  GovernanceShell,
  StatStrip,
} from "@/app/services/_components/governance-readonly";
import { ConsoleCallout, ConsolePanel, DataFreshnessText } from "@/components/console-ui";
import { DewKeysTable, dewKeyState, type DewKeyRow } from "@/components/dew-keys-table";
import { listDewKeys, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "DEW | Huawei Cloud Better UI",
  description: "Read-only Data Encryption Workshop keys and secrets inventory.",
};

export default async function DewPage() {
  const result = await withCloudResult<DewKeyRow[]>([], listDewKeys, "listDewKeys");
  const keys = result.data;
  const enabled = keys.filter((key) => {
    const state = dewKeyState(key).toLowerCase();
    return state === "enabled" || state === "2";
  }).length;
  const pendingDeletion = keys.filter((key) => {
    const state = dewKeyState(key).toLowerCase();
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
        <ConsoleCallout tone="danger">
          {pendingDeletion} key{pendingDeletion === 1 ? "" : "s"} report pending deletion. Check dependent encrypted resources before the deletion window closes.
        </ConsoleCallout>
      ) : null}

      <ConsolePanel
        description={
          <DataFreshnessText
            isCached={result.isCached}
            prefix={`${keys.length} keys`}
            updatedAt={result.updatedAt}
          />
        }
        title="Keys and Secrets Inventory"
      >
        <DewKeysTable keys={keys} />
      </ConsolePanel>
    </GovernanceShell>
  );
}
