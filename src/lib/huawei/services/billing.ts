import "server-only";

import type { BetterUiSession } from "@/lib/auth-session";
import {
  validateBillingMonth,
  costGroups,
  type CostQuery,
} from "@/lib/billing-query";
import { decimalAmount, sumAmounts } from "@/lib/billing-format";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";

export type BillRow = {
  service: string;
  serviceCode: string;
  resource: string;
  account: string;
  kind: string;
  chargingMode: string;
  amount: string | null;
  coupons: string | null;
  outstanding: string | null;
};
export type BillingSummary = {
  currency: string;
  amount: string | null;
  coupons: string | null;
  outstanding: string | null;
  rows: BillRow[];
};
export type CostRow = {
  dimension: string;
  amount: string;
  listPrice: string | null;
};
export type CostReport = {
  currency: string;
  amount: string | null;
  rows: CostRow[];
};

export const emptyBillingSummary: BillingSummary = {
  currency: "",
  amount: null,
  coupons: null,
  outstanding: null,
  rows: [],
};
export const emptyCostReport: CostReport = {
  currency: "",
  amount: null,
  rows: [],
};

function billingSession(session: BetterUiSession) {
  // Account APIs must not be fanned out across regional project tokens.
  return { ...session, token: session.accountToken ?? session.token };
}

function responseCurrency(body: Record<string, unknown>) {
  if (body.error_code)
    throw new Error(
      `${body.error_code}: ${asString(body.error_msg, "Billing request failed.")}`,
    );
  const currency = asString(body.currency, "");
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("Billing response did not include a valid currency.");
  return currency;
}

export async function getBillingSummary(
  session: BetterUiSession,
  month: string,
): Promise<BillingSummary> {
  validateBillingMonth(month);
  const query = new URLSearchParams({
    bill_cycle: month,
    method: "oneself",
    limit: "100",
  });
  const body = await huaweiList<Record<string, unknown>>(
    billingSession(session),
    "bss",
    `/v2/bills/customer-bills/monthly-sum?${query}`,
    {
      items: ["bill_sums"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count"],
    },
    { headers: { "X-Language": "en_US" } },
  );
  const currency = responseCurrency(body);
  const kinds: Record<string, string> = {
    1: "Expenditure",
    2: "Refund",
    3: "Adjustment",
  };
  const modes: Record<string, string> = {
    1: "Yearly/monthly",
    3: "Pay-per-use",
    10: "Reserved instance",
    11: "Savings plan",
  };
  return {
    currency,
    amount: decimalAmount(body.consume_amount),
    coupons: decimalAmount(body.coupon_amount),
    outstanding: decimalAmount(body.debt_amount),
    rows: asArray(body.bill_sums).map((value): BillRow => {
      const item = asRecord(value);
      return {
        service: asString(
          item.service_type_name,
          asString(item.service_type_code),
        ),
        serviceCode: asString(item.service_type_code),
        resource: asString(
          item.resource_type_name,
          asString(item.resource_type_code),
        ),
        account: asString(item.account_name, asString(item.customer_id)),
        kind:
          kinds[String(item.bill_type)] ??
          asString(String(item.bill_type ?? "")),
        chargingMode:
          modes[String(item.charging_mode)] ??
          asString(String(item.charging_mode ?? "")),
        amount: decimalAmount(item.consume_amount),
        coupons: decimalAmount(item.coupon_amount),
        outstanding: decimalAmount(item.debt_amount),
      };
    }),
  };
}

export async function getCostReport(
  session: BetterUiSession,
  query: CostQuery,
): Promise<CostReport> {
  validateBillingMonth(query.month, 18);
  if (
    !Object.hasOwn(costGroups, query.group) ||
    !["ORIGINAL_COST", "AMORTIZED_COST"].includes(query.type)
  )
    throw new Error("Unsupported cost query.");
  const body = await huaweiList<Record<string, unknown>>(
    billingSession(session),
    "bss",
    "/v4/costs/cost-analysed-bills/query",
    {
      items: ["cost_data"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count"],
      inBody: true,
    },
    {
      method: "POST",
      headers: { "X-Language": "en_US" },
      body: JSON.stringify({
        time_condition: {
          time_measure_id: 2,
          begin_time: query.month,
          end_time: query.month,
        },
        groupby: [{ type: "dimension", key: query.group }],
        cost_type: query.type,
        amount_type: "NET_AMOUNT",
        limit: 100,
      }),
    },
  );
  const currency = responseCurrency(body);
  const rows = asArray(body.cost_data).map((value): CostRow => {
    const item = asRecord(value);
    const dimension = asArray(item.dimensions)
      .map(asRecord)
      .find((dimension) => dimension.key === query.group);
    const amount = decimalAmount(item.amount_by_costs);
    if (amount === null)
      throw new Error("Cost response did not include the grouped amount.");
    return {
      dimension: asString(dimension?.value, "Unallocated"),
      amount,
      listPrice: decimalAmount(item.official_amount_by_costs),
    };
  });
  return { currency, amount: sumAmounts(rows.map((row) => row.amount)), rows };
}
