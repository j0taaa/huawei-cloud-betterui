import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import {
  emptyBillingSummary,
  getBillingSummary,
  withCloudResult,
  type BillRow,
} from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { currentBillingMonth } from "@/lib/billing-query";
import { formatMoney } from "@/lib/billing-format";
import { BillingFilters } from "../../_components/billing-filters";
import {
  ServiceInventoryPage,
  type InventoryColumn,
} from "../../_components/service-inventory";

export const metadata: Metadata = {
  title: "Billing Center | Huawei Cloud Better UI",
};

export default async function BillingCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const month =
    typeof params.month === "string" ? params.month : currentBillingMonth();
  const result = await withCloudResult(
    emptyBillingSummary,
    (session) => getBillingSummary(session, month),
    cloudCacheKeys.billing(month),
  );
  const summary = result.data;
  const money = (value: string | null) => formatMoney(value, summary.currency);
  const columns: InventoryColumn<BillRow>[] = [
    {
      header: "Service",
      render: (row) => (
        <>
          {row.service}
          <p className="mt-1 text-xs text-[#667085]">{row.serviceCode}</p>
        </>
      ),
    },
    { header: "Resource type", render: (row) => row.resource },
    { header: "Account", render: (row) => row.account },
    { header: "Record type", render: (row) => row.kind },
    { header: "Billing mode", render: (row) => row.chargingMode },
    { header: "Amount", render: (row) => money(row.amount) },
    { header: "Cash coupons", render: (row) => money(row.coupons) },
    {
      header: "Settlement / Outstanding",
      render: (row) => money(row.outstanding),
    },
  ];
  return (
    <ServiceInventoryPage
      active="Billing"
      backHref="/services/billing"
      backLabel="Back to billing services"
      icon={CreditCard}
      title="Billing Center"
      description={`Account expenditure summary · ${month}`}
      result={result}
      rows={summary.rows}
      columns={columns}
      tableTitle="Monthly expenditure breakdown"
      empty="No billing records for this month."
      stats={[
        {
          label: "Total expenditure (including refunds)",
          value: money(summary.amount),
        },
        { label: "Cash coupons", value: money(summary.coupons) },
        {
          label: "Settlement / Outstanding",
          value: money(summary.outstanding),
        },
        { label: "Billing records", value: summary.rows.length },
      ]}
    >
      <BillingFilters month={month} />
    </ServiceInventoryPage>
  );
}
