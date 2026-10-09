import type { Metadata } from "next";
import { Code2 } from "lucide-react";

import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleCallout, ConsoleMain, ConsolePageHeader } from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { FunctionGraphCreateFunctionForm } from "@/components/functiongraph-create-function-form";
import {
  listFunctionGraphProjectOptions,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "Create Function | FunctionGraph | Huawei Cloud Better UI",
};

export default async function CreateFunctionGraphFunctionPage() {
  const projectResult = await withCloudResult(
    [],
    listFunctionGraphProjectOptions,
    "functiongraph-projects",
  );

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator show={projectResult.isRefreshing} />
      <ConsoleMain background="muted">
        <ConsolePageHeader
          backHref="/services/functiongraph"
          backLabel="Back to FunctionGraph"
          description="Configure and deploy a new FunctionGraph function from inline code."
          icon={Code2}
          iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
          title="Create function"
        />

        {projectResult.error ? (
          <ConsoleCallout>{projectResult.error}</ConsoleCallout>
        ) : null}

        <FunctionGraphCreateFunctionForm projects={projectResult.data} />
      </ConsoleMain>
    </ConsoleShell>
  );
}
