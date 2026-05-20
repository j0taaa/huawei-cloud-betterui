import type { Metadata } from "next";
import { ServerCog } from "lucide-react";

import {
  DataFreshness,
  EmptyState,
  GovernanceShell,
  StatStrip,
  StatusPill,
} from "@/app/services/_components/governance-readonly";
import type { BetterUiSession } from "@/lib/auth-session";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "HSS | Huawei Cloud Better UI",
  description: "Read-only Host Security Service host risk posture.",
};

type HssHost = {
  agentStatus?: string;
  baselineRiskCount?: number;
  detectResult?: string;
  groupName?: string;
  id?: string;
  intrusionCount?: number;
  name?: string;
  os?: string;
  policyGroupName?: string;
  privateIp?: string;
  projectId?: string;
  projectName?: string;
  publicIp?: string;
  region?: string;
  riskCount?: number;
  version?: string;
  vulnerabilityCount?: number;
};

type ListHssHosts = (session: BetterUiSession) => Promise<HssHost[]>;

const listHssHosts =
  (huaweiCloud as typeof huaweiCloud & { listHssHosts?: ListHssHosts })
    .listHssHosts ??
  (async () => {
    throw new Error("listHssHosts is not exported from @/lib/huawei-cloud yet.");
  });

function agentIntent(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "online") {
    return "good";
  }

  if (normalized === "offline" || normalized === "install_failed") {
    return "bad";
  }

  if (normalized === "not_installed") {
    return "warn";
  }

  return "muted";
}

function detectionIntent(result: string) {
  const normalized = result.toLowerCase();

  if (normalized === "clean") {
    return "good";
  }

  if (normalized === "risk") {
    return "bad";
  }

  if (normalized === "scanning") {
    return "info";
  }

  return "muted";
}

function riskIntent(count: number) {
  if (count > 0) {
    return "bad";
  }

  return "good";
}

export default async function HssPage() {
  const result = await withCloudResult<HssHost[]>([], listHssHosts, "listHssHosts");
  const hosts = result.data;
  const online = hosts.filter((host) => (host.agentStatus ?? "").toLowerCase() === "online").length;
  const risky = hosts.filter((host) => (host.riskCount ?? 0) > 0 || (host.detectResult ?? "").toLowerCase() === "risk").length;
  const vulnerabilities = hosts.reduce((total, host) => total + (host.vulnerabilityCount ?? 0), 0);
  const baselines = hosts.reduce((total, host) => total + (host.baselineRiskCount ?? 0), 0);

  return (
    <GovernanceShell
      active="Security"
      backHref="/services/security"
      backLabel="Back to Security"
      description="Host agent health, HSS edition coverage, vulnerability counts, baseline risks, and intrusion posture."
      icon={ServerCog}
      result={result}
      title="Host Security Service"
      tone="red"
    >
      <StatStrip
        items={[
          { label: "Hosts", value: hosts.length, tone: "info" },
          { label: "Agent online", value: online, tone: online === hosts.length ? "good" : "warn" },
          { label: "Risky hosts", value: risky, tone: risky ? "bad" : "good" },
          { label: "Vulnerabilities", value: vulnerabilities + baselines, tone: vulnerabilities || baselines ? "bad" : "good" },
        ]}
      />

      <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="border-b border-[#e4e9f2] p-5">
          <h2 className="text-lg font-black">Host Risk Posture</h2>
          <DataFreshness
            count={hosts.length}
            isCached={result.isCached}
            label="hosts"
            updatedAt={result.updatedAt}
          />
        </div>

        {hosts.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] text-left text-sm">
              <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                <tr>
                  <th className="px-5 py-3">Host</th>
                  <th className="px-5 py-3">Agent</th>
                  <th className="px-5 py-3">Detection</th>
                  <th className="px-5 py-3">Risk counts</th>
                  <th className="px-5 py-3">Policy</th>
                  <th className="px-5 py-3">Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {hosts.map((host) => (
                  <tr className="hover:bg-[#fbfcfe]" key={`${host.projectId ?? "project"}:${host.id ?? host.name ?? "host"}`}>
                    <td className="px-5 py-4 align-top">
                      <p className="font-black">{host.name || "-"}</p>
                      <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">
                        {host.id || "-"}
                      </p>
                      <p className="mt-2 text-xs font-bold text-[#667085]">
                        {host.privateIp || "-"} private · {host.publicIp || "-"} public
                      </p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">{host.os || "-"}</p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <StatusPill intent={agentIntent(host.agentStatus ?? "")}>
                        {host.agentStatus || "Unknown"}
                      </StatusPill>
                      <p className="mt-2 text-xs font-semibold text-[#667085]">
                        Edition {host.version || "-"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <StatusPill intent={detectionIntent(host.detectResult ?? "")}>
                        {host.detectResult || "Unknown"}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <div className="flex flex-wrap gap-2">
                        <StatusPill intent={riskIntent(host.vulnerabilityCount ?? 0)}>
                          {host.vulnerabilityCount ?? 0} vul
                        </StatusPill>
                        <StatusPill intent={riskIntent(host.baselineRiskCount ?? 0)}>
                          {host.baselineRiskCount ?? 0} baseline
                        </StatusPill>
                        <StatusPill intent={riskIntent(host.intrusionCount ?? 0)}>
                          {host.intrusionCount ?? 0} intrusion
                        </StatusPill>
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p className="font-semibold">{host.policyGroupName || "-"}</p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">
                        Group {host.groupName || "-"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top font-semibold">
                      {host.projectName || host.projectId || "-"} · {host.region || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="No HSS hosts were returned. Verify HSS has access to server assets and that the current IAM principal can query Host Security Service."
            title="No HSS hosts found"
          />
        )}
      </section>
    </GovernanceShell>
  );
}
