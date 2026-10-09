import { AlertCircle, CreditCard } from "lucide-react";

import { MetricCard } from "@/components/console-ui";
import { getMonthlyResourceCost, withCloudResult } from "@/lib/huawei-cloud";

export async function MonthlyResourceCostCard({
  cloudServiceType,
  region,
  resourceId,
}: {
  cloudServiceType?: string;
  region?: string;
  resourceId: string;
}) {
  const result = await withCloudResult(
    null,
    (session) =>
      getMonthlyResourceCost(session, resourceId, {
        cloudServiceType,
        region,
      }),
    `monthly-resource-cost:${resourceId}`,
  );

  if (result.error || !result.data) {
    return (
      <MetricCard
        className="border-[#fed7aa] bg-[#fff7ed] dark:border-[#9a3412] dark:bg-[#431407]"
        description="BSSINTL did not return resource cost data."
        icon={AlertCircle}
        iconClassName="bg-white text-[#c2410c] dark:bg-[#7c2d12] dark:text-[#fdba74]"
        label="This month"
        value="Cost unavailable"
        valueClassName="text-lg text-[#101828] dark:text-white"
        variant="compact"
      />
    );
  }

  const formatter = new Intl.NumberFormat("en-US", {
    currency: result.data.currency,
    style: "currency",
  });

  return (
    <MetricCard
      className="border-[#d1fadf]"
      description={`${result.data.billingCycle} · ${result.data.recordCount} BSS records`}
      icon={CreditCard}
      iconClassName="bg-[#ecfdf3] text-[#027a48] dark:bg-[#14532d]/50 dark:text-[#86efac]"
      label="This month"
      value={formatter.format(result.data.amount)}
      valueClassName="break-words text-lg text-[#101828] dark:text-white"
      variant="compact"
    />
  );
}
