import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import {
  DataFreshness,
  EmptyState,
  GovernanceShell,
  StatStrip,
  StatusPill,
} from "@/app/services/_components/governance-readonly";
import {
  withCloudResult,
  listWafInstances,
  type WafInstance,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "WAF | Huawei Cloud Better UI",
  description:
    "Read-only Web Application Firewall protected host and policy posture.",
};

function hostAction(instance: WafInstance) {
  return instance.protectStatus || instance.accessStatus || "Unknown";
}

function statusIntent(value: string) {
  const normalized = value.toLowerCase();

  if (
    normalized === "block" ||
    normalized === "enabled" ||
    normalized === "1"
  ) {
    return "good";
  }

  if (normalized === "log" || normalized === "0" || normalized === "disabled") {
    return "warn";
  }

  return "muted";
}

export default async function WafPage() {
  const result = await withCloudResult<WafInstance[]>(
    [],
    listWafInstances,
    cloudCacheKeys.listWafInstances,
  );
  const instances = result.data;
  const protectedHosts = instances.filter((instance) => {
    const value = (
      instance.protectStatus ||
      instance.accessStatus ||
      ""
    ).toLowerCase();
    return value === "1" || value === "enabled";
  }).length;
  const policies = new Set(
    instances.map((instance) => instance.policyId).filter(Boolean),
  ).size;

  return (
    <GovernanceShell
      active="Security"
      backHref="/services/security"
      backLabel="Back to Security"
      description="Protected domains, bound policies, proxy posture, and enforcement state across WAF projects."
      icon={ShieldAlert}
      result={result}
      title="Web Application Firewall"
      tone="red"
    >
      <StatStrip
        items={[
          { label: "Protected hosts", value: instances.length, tone: "info" },
          {
            label: "Protection on",
            value: protectedHosts,
            tone: protectedHosts === instances.length ? "good" : "warn",
          },
          {
            label: "Projects",
            value: new Set(instances.map((instance) => instance.projectId))
              .size,
            tone: "info",
          },
          {
            label: "Bound policies",
            value: policies,
            tone: policies ? "good" : "warn",
          },
        ]}
      />

      <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="border-b border-[#e4e9f2] p-5">
          <h2 className="text-lg font-black">Protected Host Posture</h2>
          <DataFreshness
            count={instances.length}
            isCached={result.isCached}
            label="protected hosts"
            updatedAt={result.updatedAt}
          />
        </div>

        {instances.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                <tr>
                  <th className="px-5 py-3">Host</th>
                  <th className="px-5 py-3">Protection</th>
                  <th className="px-5 py-3">Policy</th>
                  <th className="px-5 py-3">Origin path</th>
                  <th className="px-5 py-3">Project</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {instances.map((instance) => (
                  <tr
                    className="hover:bg-[#fbfcfe]"
                    key={`${instance.projectId ?? "project"}:${instance.id ?? instance.hostname ?? "host"}`}
                  >
                    <td className="px-5 py-4 align-top">
                      <p className="font-black">{instance.hostname || "-"}</p>
                      <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">
                        {instance.id || "-"}
                      </p>
                      {instance.createdAt ? (
                        <p className="mt-2 text-xs font-bold text-[#667085]">
                          Added {instance.createdAt}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-4 align-top">
                      <StatusPill intent={statusIntent(hostAction(instance))}>
                        {hostAction(instance)}
                      </StatusPill>
                      <p className="mt-2 text-xs font-semibold text-[#667085]">
                        Access {instance.accessStatus || "-"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p className="font-black">Policy ID</p>
                      <p className="mt-1 break-all text-xs font-semibold text-[#98a2b3]">
                        {instance.policyId || "-"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p className="font-semibold">
                        Proxy {instance.proxy || "-"}
                      </p>
                    </td>
                    <td className="px-5 py-4 align-top font-semibold">
                      {instance.projectName || instance.projectId || "-"} ·{" "}
                      {instance.region || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="No protected WAF hosts were returned, or the signed-in principal cannot list WAF protected domains in the selected projects."
            title="No WAF protected hosts found"
          />
        )}
      </section>
    </GovernanceShell>
  );
}
