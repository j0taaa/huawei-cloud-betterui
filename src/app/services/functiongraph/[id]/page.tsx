import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { CloudErrorPage } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import { Code2 } from "lucide-react";

import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleCallout,
  ConsoleDetailHeader,
  ConsoleMain,
  ConsoleMonoText,
  DataFreshnessText,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { FunctionGraphFunctionWorkspace } from "@/components/functiongraph-function-workspace";
import {
  getFunctionGraphFunction,
  type FunctionGraphFunction,
  withCloudResult,
} from "@/lib/huawei-cloud";

export default async function FunctionGraphFunctionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult<FunctionGraphFunction | null>(
    null,
    (session) => getFunctionGraphFunction(session, id),
    cloudCacheKeys.functionGraphCode(id),
  );
  if (!result.data && result.error)
    return (
      <CloudErrorPage
        active="Compute"
        backHref="/services/functiongraph"
        error={result.error}
      />
    );
  const fn = result.data;

  if (!fn) {
    notFound();
  }

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain background="muted">
        <ConsoleDetailHeader
          backHref="/services/functiongraph"
          backLabel="Back to FunctionGraph"
          description={
            <DataFreshnessText
              isCached={result.isCached}
              updatedAt={result.updatedAt}
            />
          }
          eyebrow="FunctionGraph function"
          icon={Code2}
          iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
          id={
            <ConsoleMonoText className="block break-all">
              {fn.urn || fn.id}
            </ConsoleMonoText>
          }
          title={fn.name}
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <FunctionGraphFunctionWorkspace fn={fn} functionId={id} />
      </ConsoleMain>
    </ConsoleShell>
  );
}
