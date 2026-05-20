import type { Metadata } from "next";
import { ScrollText } from "lucide-react";

import {
  DataFreshness,
  EmptyState,
  GovernanceShell,
  StatStrip,
  StatusPill,
} from "@/app/services/_components/governance-readonly";
import { LocalDateTime } from "@/components/local-date-time";
import {
  listLtsLogGroups,
  type LtsLogGroup,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "LTS | Huawei Cloud Better UI",
  description: "Read-only Log Tank Service log group operations.",
};

function ttlNumber(ttlDays: string) {
  const value = Number(ttlDays);
  return Number.isFinite(value) ? value : null;
}

function ttlIntent(ttlDays: string) {
  const value = ttlNumber(ttlDays);

  if (value === null) {
    return "muted";
  }

  if (value < 30) {
    return "warn";
  }

  if (value >= 180) {
    return "good";
  }

  return "info";
}

function createdAt(group: LtsLogGroup) {
  if (!group.createdAt || group.createdAt === "-") {
    return "-";
  }

  return <LocalDateTime value={group.createdAt} />;
}

export default async function LtsPage() {
  const result = await withCloudResult<LtsLogGroup[]>([], listLtsLogGroups, "listLtsLogGroups");
  const groups = result.data;
  const shortRetention = groups.filter((group) => {
    const ttl = ttlNumber(group.ttlDays);
    return ttl !== null && ttl < 30;
  }).length;
  const longRetention = groups.filter((group) => {
    const ttl = ttlNumber(group.ttlDays);
    return ttl !== null && ttl >= 180;
  }).length;
  const tagged = groups.filter((group) => group.tags > 0).length;

  return (
    <GovernanceShell
      active="Monitoring"
      backHref="/services/monitoring"
      backLabel="Back to Monitoring"
      description="Read-only log group inventory for retention review, ownership tagging, and regional logging coverage."
      icon={ScrollText}
      result={result}
      title="Log Tank Service"
      tone="green"
    >
      <StatStrip
        items={[
          { label: "Log groups", value: groups.length, tone: "info" },
          { label: "Retention < 30d", value: shortRetention, tone: shortRetention ? "warn" : "good" },
          { label: "Retention >= 180d", value: longRetention, tone: "good" },
          { label: "Tagged groups", value: tagged, tone: tagged === groups.length ? "good" : "warn" },
        ]}
      />

      <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="border-b border-[#e4e9f2] p-5">
          <h2 className="text-lg font-black">Log Groups</h2>
          <DataFreshness
            count={groups.length}
            isCached={result.isCached}
            label="log groups"
            updatedAt={result.updatedAt}
          />
        </div>

        {groups.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                <tr>
                  <th className="px-5 py-3">Log group</th>
                  <th className="px-5 py-3">Retention</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3">Tags</th>
                  <th className="px-5 py-3">Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {groups.map((group) => (
                  <tr className="hover:bg-[#fbfcfe]" key={`${group.projectId}:${group.id}`}>
                    <td className="px-5 py-4">
                      <p className="font-black">{group.name}</p>
                      {group.alias ? (
                        <p className="mt-1 text-xs font-semibold text-[#667085]">{group.alias}</p>
                      ) : null}
                      <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">{group.id}</p>
                    </td>
                    <td className="px-5 py-4">
                      <StatusPill intent={ttlIntent(group.ttlDays)}>
                        {group.ttlDays === "-" ? "Unknown" : `${group.ttlDays} days`}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-4 font-semibold">{createdAt(group)}</td>
                    <td className="px-5 py-4 font-semibold">
                      {group.tags ? `${group.tags} tags` : "No tags returned"}
                    </td>
                    <td className="px-5 py-4 font-semibold">
                      {group.projectName} · {group.region}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="No LTS log groups were returned for the selected projects, or the current IAM principal cannot list LTS groups."
            title="No LTS log groups found"
          />
        )}
      </section>
    </GovernanceShell>
  );
}
