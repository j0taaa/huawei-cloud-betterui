import type { Metadata } from "next";
import { ChartNoAxesCombined } from "lucide-react";
import {
  emptyCostReport,
  getCostReport,
  withCloudResult,
  type CloudResult,
  type CostReport,
  type CostRow,
} from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import {
  costGroups,
  currentBillingMonth,
  readCostQuery,
  type CostQuery,
} from "@/lib/billing-query";
import { formatMoney } from "@/lib/billing-format";
import { BillingFilters } from "../_components/billing-filters";
import {
  ServiceInventoryPage,
  type InventoryColumn,
} from "../_components/service-inventory";

export const metadata: Metadata = {
  title: "Cost Center | Huawei Cloud Better UI",
};

function CostView({
  query,
  result,
}: {
  query: CostQuery;
  result: CloudResult<CostReport>;
}) {
  const report = result.data;
  const columns: InventoryColumn<CostRow>[] = [
    { header: costGroups[query.group], render: (row) => row.dimension },
    {
      header: "Net cost",
      render: (row) => formatMoney(row.amount, report.currency),
    },
    {
      header: "List price",
      render: (row) => formatMoney(row.listPrice, report.currency),
    },
  ];
  return (
    <ServiceInventoryPage
      active="Billing"
      backHref="/services/billing"
      backLabel="Back to billing services"
      icon={ChartNoAxesCombined}
      title="Cost Center"
      description={`Account-wide cost analysis · ${query.month}`}
      result={result}
      rows={report.rows}
      columns={columns}
      tableTitle={`Costs by ${costGroups[query.group].toLowerCase()}`}
      empty="No cost records for this month."
      stats={[
        {
          label: "Net cost",
          value: formatMoney(report.amount, report.currency),
        },
        { label: "Groups", value: report.rows.length },
        {
          label: "Cost type",
          value: query.type === "ORIGINAL_COST" ? "Original" : "Amortized",
        },
        { label: "Currency", value: report.currency || "—" },
      ]}
    >
      <BillingFilters month={query.month} cost={query} />
    </ServiceInventoryPage>
  );
}

export default async function CostCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let query: CostQuery;
  try {
    query = readCostQuery(await searchParams);
  } catch (error) {
    return (
      <CostView
        query={{
          month: currentBillingMonth(),
          group: "CLOUD_SERVICE_TYPE",
          type: "ORIGINAL_COST",
        }}
        result={{
          data: emptyCostReport,
          error: error instanceof Error ? error.message : "Invalid cost query.",
          isCached: false,
          isRefreshing: false,
          updatedAt: new Date().toISOString(),
        }}
      />
    );
  }
  const result = await withCloudResult(
    emptyCostReport,
    (session) => getCostReport(session, query),
    cloudCacheKeys.costs(query.month, query.group, query.type),
  );
  return <CostView query={query} result={result} />;
}
