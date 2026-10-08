import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import {
  DataFreshness,
  EmptyState,
  GovernanceShell,
  StatStrip,
  StatusPill,
} from "@/app/services/_components/governance-readonly";
import { LocalDateTime } from "@/components/local-date-time";
import {
  listIamUsers,
  type IamUser,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "IAM | Huawei Cloud Better UI",
  description: "Read-only IAM identity inventory.",
};

function enabledIntent(enabled: string) {
  return enabled.toLowerCase() === "true" ? "good" : "bad";
}

function passwordIntent(passwordExpiresAt: string) {
  if (!passwordExpiresAt || passwordExpiresAt === "-") {
    return "muted";
  }

  const expiresAt = new Date(passwordExpiresAt).getTime();

  if (Number.isNaN(expiresAt)) {
    return "info";
  }

  const days = (expiresAt - Date.now()) / 86_400_000;

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

export default async function IamPage() {
  const result = await withCloudResult<IamUser[]>([], listIamUsers, cloudCacheKeys.listIamUsers);
  const users = result.data;
  const enabled = users.filter((user) => user.enabled.toLowerCase() === "true").length;
  const disabled = users.length - enabled;
  const passwordAttention = users.filter((user) => {
    const intent = passwordIntent(user.passwordExpiresAt);
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

      <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="border-b border-[#e4e9f2] p-5">
          <h2 className="text-lg font-black">Users</h2>
          <DataFreshness
            count={users.length}
            isCached={result.isCached}
            label="users"
            updatedAt={result.updatedAt}
          />
        </div>

        {users.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">State</th>
                  <th className="px-5 py-3">Password</th>
                  <th className="px-5 py-3">Domain</th>
                  <th className="px-5 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {users.map((user) => (
                  <tr className="hover:bg-[#fbfcfe]" key={user.id}>
                    <td className="px-5 py-4">
                      <p className="font-black">{user.name}</p>
                      <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">{user.id}</p>
                    </td>
                    <td className="px-5 py-4">
                      <StatusPill intent={enabledIntent(user.enabled)}>
                        {user.enabled.toLowerCase() === "true" ? "Enabled" : "Disabled"}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-4">
                      <StatusPill intent={passwordIntent(user.passwordExpiresAt)}>
                        {passwordLabel(user.passwordExpiresAt)}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-4 font-semibold">{user.domainId}</td>
                    <td className="px-5 py-4 font-semibold">
                      {user.description || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="No IAM users were returned, or the signed-in principal lacks permission to list account users."
            title="No IAM users found"
          />
        )}
      </section>
    </GovernanceShell>
  );
}
