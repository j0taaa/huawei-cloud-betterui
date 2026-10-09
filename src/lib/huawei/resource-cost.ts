import { huaweiList } from "@/lib/huawei/http";
import "server-only";

import type { BetterUiSession } from "@/lib/auth-session";
import { asArray, asRecord, asString } from "@/lib/huawei/core";

export type MonthlyResourceCost = {
  amount: number;
  billingCycle: string;
  currency: string;
  recordCount: number;
  resourceId: string;
};

type BssFeeRecord = {
  amount?: unknown;
  resource_id?: unknown;
};

function currentBillingCycle() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";

  return `${year}-${month}`;
}

export async function getMonthlyResourceCost(
  session: BetterUiSession,
  resourceId: string,
  options?: {
    cloudServiceType?: string;
    region?: string;
  },
): Promise<MonthlyResourceCost> {
  const billingCycle = currentBillingCycle();
  const params = new URLSearchParams({
    cycle: billingCycle,
    include_zero_record: "true",
    limit: "1000",
    method: "oneself",
    offset: "0",
    resource_id: resourceId,
    statistic_type: "3",
  });

  if (options?.cloudServiceType) {
    params.set("cloud_service_type", options.cloudServiceType);
  }

  if (options?.region) {
    params.set("region", options.region);
  }

  const body = await huaweiList<{
    currency?: unknown;
    fee_records?: BssFeeRecord[];
  }>(
    { ...session, token: session.accountToken ?? session.token },
    "bss",
    `/v2/bills/customer-bills/res-fee-records?${params.toString()}`,
    {
      items: ["fee_records"],
      kind: "offset",
      parameter: "offset",
      size: 1000,
      total: ["total_count"],
    },
    { headers: { "X-Language": "en_US" } },
  );
  const records = asArray(body.fee_records).filter((record) => {
    const item = asRecord(record);
    return asString(item.resource_id, "") === resourceId;
  });
  const amount = records.reduce((total, record) => {
    const item = asRecord(record);
    const value = Number(item.amount ?? 0);

    return Number.isFinite(value) ? total + value : total;
  }, 0);

  return {
    amount,
    billingCycle,
    currency: asString(body.currency, "USD"),
    recordCount: records.length,
    resourceId,
  };
}
