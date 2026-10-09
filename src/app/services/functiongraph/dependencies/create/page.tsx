import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { PackagePlus } from "lucide-react";

import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleCallout, ConsoleMain, ConsolePageHeader } from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { FunctionGraphAddDependencyForm } from "@/components/functiongraph-add-dependency-form";
import {
  listFunctionGraphFunctions,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "Add Dependency | FunctionGraph | Huawei Cloud Better UI",
};

function functionId(fn: { id: string; name: string; urn: string }) {
  return fn.id || fn.urn || fn.name;
}

export default async function AddFunctionGraphDependencyPage() {
  const result = await withCloudResult([], listFunctionGraphFunctions, cloudCacheKeys.listFunctionGraphFunctions);
  const functions = result.data.map((fn) => ({
    id: functionId(fn),
    name: fn.name,
    packageName: fn.packageName,
    projectId: fn.projectId,
    projectName: fn.projectName,
    runtime: fn.runtime,
  }));

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain background="muted">
        <ConsolePageHeader
          backHref="/services/functiongraph"
          backLabel="Back to FunctionGraph"
          description="Add a library to a function package manifest and redeploy the code package."
          icon={PackagePlus}
          iconClassName="bg-[#fdf2f8] text-[#be185d]"
          title="Add dependency"
        />

        {result.error ? (
          <ConsoleCallout>{result.error}</ConsoleCallout>
        ) : null}

        <FunctionGraphAddDependencyForm functions={functions} />
      </ConsoleMain>
    </ConsoleShell>
  );
}
