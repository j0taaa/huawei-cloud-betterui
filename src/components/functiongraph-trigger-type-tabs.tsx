"use client";

import type { ReactNode } from "react";
import { BellRing } from "lucide-react";

import { ConsoleTabs } from "@/components/console-tabs";
import { ConsoleEmptyPanelBody } from "@/components/console-ui";

type FunctionGraphTriggerTypeTab = {
  content: ReactNode;
  count: number;
  id: string;
  label: string;
};

export function FunctionGraphTriggerTypeTabs({
  tabs,
}: {
  tabs: FunctionGraphTriggerTypeTab[];
}) {
  return (
    <ConsoleTabs
      ariaLabel="FunctionGraph trigger types"
      emptyState={
        <ConsoleEmptyPanelBody title="No triggers found">
          No triggers found for the selected FunctionGraph projects.
        </ConsoleEmptyPanelBody>
      }
      headerClassName="border-b border-[#e4e9f2] bg-[#fbfcfe] px-4 pt-3"
      idPrefix="functiongraph-trigger-types"
      tabs={tabs.map((tab) => ({
        ...tab,
        icon: <BellRing className="size-4" />,
      }))}
    />
  );
}
