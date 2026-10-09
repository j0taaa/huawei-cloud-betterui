import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import {
  GovernanceShell,
  StatStrip,
} from "@/app/services/_components/governance-readonly";
import { ConsoleCallout, ConsolePanel, DataFreshnessText } from "@/components/console-ui";
import {
  WafProtectedHostsTable,
  wafHostAction,
  type WafProtectedHost,
} from "@/components/waf-protected-hosts-table";
import { listWafInstances, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "WAF | Huawei Cloud Better UI",
  description: "Read-only Web Application Firewall protected host and policy posture.",
};

export default async function WafPage() {
  const result = await withCloudResult<WafProtectedHost[]>(
    [],
    listWafInstances,
    "listWafInstances",
  );
  const instances = result.data;
  const protectedHosts = instances.filter((instance) => {
    const value = (instance.protectStatus || instance.accessStatus || "").toLowerCase();
    return value === "1" || value === "enabled";
  }).length;
  const blocking = instances.filter(
    (instance) => wafHostAction(instance).toLowerCase() === "block",
  ).length;
  const strict = instances.filter((instance) => {
    const level = (instance.policyLevel ?? "").toLowerCase();
    return level === "strict" || level === "3";
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
          { label: "Protection on", value: protectedHosts, tone: protectedHosts === instances.length ? "good" : "warn" },
          { label: "Blocking policies", value: blocking || "Not returned", tone: blocking ? "good" : "warn" },
          { label: "Bound policies", value: policies, tone: policies ? "good" : "warn" },
        ]}
      />

      <ConsolePanel
        description={
          <DataFreshnessText
            isCached={result.isCached}
            prefix={`${instances.length} protected hosts`}
            updatedAt={result.updatedAt}
          />
        }
        title="Protected Host Posture"
      >
        <WafProtectedHostsTable instances={instances} />
      </ConsolePanel>

      {strict === 0 && instances.length ? (
        <ConsoleCallout tone="warning">
          No protected host reports a strict policy level. If the shared loader starts returning policy details, this view will surface strict, medium, and low posture per host.
        </ConsoleCallout>
      ) : null}
    </GovernanceShell>
  );
}
