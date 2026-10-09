"use client";

import type { ReactNode } from "react";
import { BellRing, Code2, DatabaseZap, Link2 } from "lucide-react";

import { ConsolePanel } from "@/components/console-ui";
import { ConsoleTabs } from "@/components/console-tabs";

type FunctionGraphMainTabId = "functions" | "triggers" | "reserved" | "dependencies";

type FunctionGraphMainTabsProps = {
  dependencies: ReactNode;
  dependencyCount: number;
  functions: ReactNode;
  functionCount: number;
  reserved: ReactNode;
  reservedCount: number;
  triggers: ReactNode;
  triggerCount: number;
};

const tabs: Array<{
  id: FunctionGraphMainTabId;
  label: string;
  icon: ReactNode;
}> = [
  { id: "functions", label: "Functions", icon: <Code2 className="size-4" /> },
  { id: "triggers", label: "Triggers", icon: <BellRing className="size-4" /> },
  { id: "reserved", label: "Reserved instances", icon: <DatabaseZap className="size-4" /> },
  { id: "dependencies", label: "Dependencies", icon: <Link2 className="size-4" /> },
];

export function FunctionGraphMainTabs({
  dependencies,
  dependencyCount,
  functions,
  functionCount,
  reserved,
  reservedCount,
  triggers,
  triggerCount,
}: FunctionGraphMainTabsProps) {
  const counts: Record<FunctionGraphMainTabId, number> = {
    dependencies: dependencyCount,
    functions: functionCount,
    reserved: reservedCount,
    triggers: triggerCount,
  };

  const panels: Record<FunctionGraphMainTabId, ReactNode> = {
    dependencies,
    functions,
    reserved,
    triggers,
  };

  return (
    <ConsolePanel>
      <ConsoleTabs
        ariaLabel="FunctionGraph inventory"
        headerClassName="border-b border-[#e4e9f2] bg-[#fbfcfe] px-4 pt-4"
        idPrefix="functiongraph-inventory"
        size="md"
        tabs={tabs.map((tab) => ({
          ...tab,
          content: panels[tab.id],
          count: counts[tab.id],
        }))}
      />
    </ConsolePanel>
  );
}
