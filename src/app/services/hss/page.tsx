import type { Metadata } from "next";
import { ServerCog } from "lucide-react";

import {
  GovernanceShell,
  StatStrip,
} from "@/app/services/_components/governance-readonly";
import { ConsolePanel, ConsoleLinkButton, DataFreshnessText } from "@/components/console-ui";
import { HssHostsTable, type HssHostRow } from "@/components/hss-hosts-table";
import { listHssHosts, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "HSS | Huawei Cloud Better UI",
  description: "Host Security Service protection and host risk posture.",
};

export default async function HssPage() {
  const result = await withCloudResult<HssHostRow[]>([], listHssHosts, "listHssHosts");
  const hosts = result.data;
  const online = hosts.filter((host) => (host.agentStatus ?? "").toLowerCase() === "online").length;
  const risky = hosts.filter((host) => (host.riskCount ?? 0) > 0 || (host.detectResult ?? "").toLowerCase() === "risk").length;
  const vulnerabilities = hosts.reduce((total, host) => total + (host.vulnerabilityCount ?? 0), 0);
  const baselines = hosts.reduce((total, host) => total + (host.baselineRiskCount ?? 0), 0);

  return (
    <GovernanceShell
      actions={<ConsoleLinkButton href="/services/hss/manage?operation=create-group">Create host group</ConsoleLinkButton>}
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

      <ConsolePanel
        description={
          <DataFreshnessText
            isCached={result.isCached}
            prefix={`${hosts.length} hosts`}
            updatedAt={result.updatedAt}
          />
        }
        title="Host Risk Posture"
      >
        <HssHostsTable hosts={hosts} />
      </ConsolePanel>
    </GovernanceShell>
  );
}
