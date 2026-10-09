import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import {
  GovernanceShell,
  StatStrip,
} from "@/app/services/_components/governance-readonly";
import { ConsolePanel, DataFreshnessText } from "@/components/console-ui";
import { IamUsersTable } from "@/components/iam-users-table";
import {
  listIamUsers,
  type IamUser,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "IAM | Huawei Cloud Better UI",
  description: "Read-only IAM identity inventory.",
};

function passwordIntent(passwordExpiresAt: string, nowIso: string) {
  if (!passwordExpiresAt || passwordExpiresAt === "-") {
    return "muted";
  }

  const expiresAt = new Date(passwordExpiresAt).getTime();
  const now = new Date(nowIso).getTime();

  if (Number.isNaN(expiresAt) || Number.isNaN(now)) {
    return "info";
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

export default async function IamPage() {
  const nowIso = new Date().toISOString();
  const result = await withCloudResult<IamUser[]>([], listIamUsers, "listIamUsers");
  const users = result.data;
  const enabled = users.filter((user) => user.enabled.toLowerCase() === "true").length;
  const disabled = users.length - enabled;
  const passwordAttention = users.filter((user) => {
    const intent = passwordIntent(user.passwordExpiresAt, nowIso);
    return intent === "bad" || intent === "warn";
  }).length;

  return (
    <GovernanceShell
      active="Security"
      backHref="/services/security"
      backLabel="Back to Security"
      description="Read-only account identity inventory for access reviews, disabled-user checks, and password-expiry triage."
      icon={KeyRound}
      result={result}
      title="Identity and Access Management"
      tone="red"
    >
      <StatStrip
        items={[
          { label: "IAM users", value: users.length, tone: "info" },
          { label: "Enabled", value: enabled, tone: "good" },
          { label: "Disabled", value: disabled, tone: disabled ? "warn" : "good" },
          { label: "Password attention", value: passwordAttention, tone: passwordAttention ? "bad" : "good" },
        ]}
      />

      <ConsolePanel
        description={
          <DataFreshnessText
            isCached={result.isCached}
            prefix={`${users.length} users`}
            updatedAt={result.updatedAt}
          />
        }
        title="Users"
      >
        <IamUsersTable nowIso={nowIso} users={users} />
      </ConsolePanel>
    </GovernanceShell>
  );
}
