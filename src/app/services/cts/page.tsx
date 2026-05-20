import type { Metadata } from "next";
import { FileSearch } from "lucide-react";

import {
  DataFreshness,
  EmptyState,
  GovernanceShell,
  StatStrip,
  StatusPill,
} from "@/app/services/_components/governance-readonly";
import {
  listCtsTrackers,
  type CtsTracker,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CTS | Huawei Cloud Better UI",
  description: "Read-only Cloud Trace Service tracker operations.",
};

function statusIntent(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "enabled") {
    return "good";
  }

  if (normalized === "disabled") {
    return "warn";
  }

  if (normalized === "error") {
    return "bad";
  }

  return "muted";
}

function enabledText(value: string) {
  return value.toLowerCase() === "true";
}

export default async function CtsPage() {
  const result = await withCloudResult<CtsTracker[]>([], listCtsTrackers, "listCtsTrackers");
  const trackers = result.data;
  const enabled = trackers.filter((tracker) => tracker.status.toLowerCase() === "enabled").length;
  const errors = trackers.filter((tracker) => tracker.status.toLowerCase() === "error").length;
  const ltsEnabled = trackers.filter((tracker) => enabledText(tracker.isLtsEnabled)).length;
  const obsConfigured = trackers.filter((tracker) => tracker.bucketName && tracker.bucketName !== "-").length;

  return (
    <GovernanceShell
      active="Monitoring"
      backHref="/services/monitoring"
      backLabel="Back to Monitoring"
      description="Read-only tracker posture for audit trail delivery, LTS routing, and OBS archive coverage."
      icon={FileSearch}
      result={result}
      title="Cloud Trace Service"
      tone="blue"
    >
      <StatStrip
        items={[
          { label: "Trackers", value: trackers.length, tone: "info" },
          { label: "Enabled", value: enabled, tone: enabled === trackers.length ? "good" : "warn" },
          { label: "Errors", value: errors, tone: errors ? "bad" : "good" },
          { label: "OBS archives", value: obsConfigured, tone: obsConfigured ? "good" : "warn" },
        ]}
      />

      <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="border-b border-[#e4e9f2] p-5">
          <h2 className="text-lg font-black">Tracker Delivery Matrix</h2>
          <DataFreshness
            count={trackers.length}
            isCached={result.isCached}
            label="trackers"
            updatedAt={result.updatedAt}
          />
        </div>

        {trackers.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                <tr>
                  <th className="px-5 py-3">Tracker</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">OBS archive</th>
                  <th className="px-5 py-3">LTS</th>
                  <th className="px-5 py-3">Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {trackers.map((tracker) => (
                  <tr className="hover:bg-[#fbfcfe]" key={`${tracker.projectId}:${tracker.id}`}>
                    <td className="px-5 py-4">
                      <p className="font-black">{tracker.name}</p>
                      <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">{tracker.id}</p>
                    </td>
                    <td className="px-5 py-4">
                      <StatusPill intent={statusIntent(tracker.status)}>
                        {tracker.status}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold">{tracker.bucketName}</p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">
                        {tracker.filePrefix === "-" ? "No prefix" : tracker.filePrefix}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <StatusPill intent={enabledText(tracker.isLtsEnabled) ? "good" : "warn"}>
                          {enabledText(tracker.isLtsEnabled) ? "Enabled" : "Off"}
                        </StatusPill>
                        <span className="text-xs font-semibold text-[#667085]">
                          Group {tracker.ltsGroupId}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 font-semibold">
                      {tracker.projectName} · {tracker.region}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="No CTS trackers were returned. Verify CTS has been enabled in the selected projects and that the current IAM principal can list trackers."
            title="No CTS trackers found"
          />
        )}
      </section>

      {trackers.length && ltsEnabled === 0 ? (
        <section className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4 text-sm font-bold text-[#c2410c]">
          No tracker reports LTS delivery. Confirm whether audit search is intentionally handled from archived trace files only.
        </section>
      ) : null}
    </GovernanceShell>
  );
}
