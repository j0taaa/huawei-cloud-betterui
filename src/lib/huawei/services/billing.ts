import "server-only";

import type { BetterUiSession } from "@/lib/auth-session";
import {
  validateBillingMonth,
  costGroups,
  type CostQuery,
} from "@/lib/billing-query";
import { decimalAmount, sumAmounts } from "@/lib/billing-format";
import { collectList } from "@/lib/huawei/pagination";
import { huaweiFetch } from "@/lib/huawei/http";
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
  // Billing data is account-wide; a regional project token must never scope it.
  if (!session.accountToken)
    throw new Error(
      "Sign in again to obtain an account token; billing data is account-wide.",
    );
  return { ...session, token: session.accountToken };
}

/** Native 200 bodies must not carry business errors; never echo their private text. */
function rejectBusinessError(record: Record<string, unknown>) {
  const code = record.error_code;
  if (
    (code !== undefined && code !== 0 && code !== "0") ||
    record.error_msg !== undefined ||
    record.error !== undefined
  )
    throw new Error(
      "Huawei returned a billing business error. Check the native billing center before retrying.",
    );
}

function rejectRowBusinessErrors(rows: unknown[]) {
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("Huawei returned an invalid billing row.");
    rejectBusinessError(row as Record<string, unknown>);
  }
}

function pageCurrency(body: Record<string, unknown>) {
  const currency = asString(body.currency, "");
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("Billing response did not include a valid currency.");
  return currency;
}

function pageRows(body: Record<string, unknown>, items: string) {
  const rows = body[items];
  if (!Array.isArray(rows))
    throw new Error(
      `Billing response did not include the required ${items} list.`,
    );
  const total = body.total_count;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0)
    throw new Error("Billing response did not include a valid total count.");
  if (total < rows.length)
    throw new Error(
      "Billing response reported a total smaller than its current page.",
    );
  rejectRowBusinessErrors(rows);
  return total;
}

type StrictPagesConfig = {
  path: string;
  init: RequestInit;
  items: string;
  inBody: boolean;
};

/** Read every native page strictly: stable currency and total on every page. */
async function strictBillingPages(
  session: BetterUiSession,
  config: StrictPagesConfig,
) {
  let reference: { currency: string; total: number } | undefined;
  let collected = 0;
  const body = await collectList<Record<string, unknown>>(async (cursor) => {
    const url = new URL(config.path, "https://huawei.invalid");
    let pageInit = config.init;
    if (config.inBody) {
      const payload = JSON.parse(String(config.init.body ?? "{}")) as Record<
        string,
        unknown
      >;
      payload.offset = cursor;
      pageInit = { ...config.init, body: JSON.stringify(payload) };
    } else {
      url.searchParams.set("offset", String(cursor));
    }
    const page = await huaweiFetch<Record<string, unknown>>(
      billingSession(session),
      "bss",
      `${url.pathname}${url.search}`,
      pageInit,
    );
    if (!page || typeof page !== "object" || Array.isArray(page)) throw new Error("Huawei returned an invalid billing response.");
    rejectBusinessError(page);
    rejectBusinessError(asRecord(page.data));
    const currency = pageCurrency(page);
    const total = pageRows(page, config.items);
    const length = (page[config.items] as unknown[]).length;
    collected += length;
    if (length > 100 || collected > total) throw new Error("Huawei returned more billing rows than its reported total or page limit.");
    if (reference && reference.currency !== currency)
      throw new Error(
        "Huawei changed the billing currency between pages. Check the native billing center before retrying.",
      );
    if (reference && reference.total !== total)
      throw new Error(
        "Huawei changed the billing total between pages. Check the native billing center before retrying.",
      );
    reference = { currency, total };
    return page;
  }, {
    items: [config.items],
    kind: "offset",
    parameter: "offset",
    size: 100,
    total: ["total_count"],
  });
  return { body, currency: reference!.currency };
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
  const { body, currency } = await strictBillingPages(session, {
    path: `/v2/bills/customer-bills/monthly-sum?${query}`,
    init: { headers: { "X-Language": "en_US" } },
    items: "bill_sums",
    inBody: false,
  });
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
    // The native endpoint reports account-wide totals on the first page only.
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
        kind: kinds[String(item.bill_type)] ?? "Unknown",
        chargingMode: modes[String(item.charging_mode)] ?? "Unknown",
        amount: decimalAmount(item.consume_amount),
        coupons: decimalAmount(item.coupon_amount),
        outstanding: decimalAmount(item.debt_amount),
      };
    }),
  };
}

function groupDimension(item: Record<string, unknown>, group: string) {
  const dimensions = asArray(item.dimensions).map(asRecord);
  const matching = dimensions.filter((dimension) => dimension.key === group);
  if (dimensions.length !== 1 || matching.length !== 1)
    throw new Error(
      "Cost response did not include the requested grouping dimension.",
    );
  const value = matching[0].value;
  if (typeof value !== "string")
    throw new Error(
      "Cost response did not include the requested grouping dimension.",
    );
  // The native API reports unallocated spend with an explicit empty value.
  return value;
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
  const { body, currency } = await strictBillingPages(session, {
    path: "/v4/costs/cost-analysed-bills/query",
    init: {
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
    items: "cost_data",
    inBody: true,
  });
  const seen = new Set<string>();
  const rows = asArray(body.cost_data).map((value): CostRow => {
    const item = asRecord(value);
    const dimension = groupDimension(item, query.group);
    if (seen.has(dimension))
      throw new Error(
        "Huawei repeated a cost grouping value; the report may be incomplete.",
      );
    seen.add(dimension);
    const amount = decimalAmount(item.amount_by_costs);
    if (amount === null)
      throw new Error("Cost response did not include the grouped amount.");
    return {
      dimension,
      amount,
      listPrice: decimalAmount(item.official_amount_by_costs),
    };
  });
  return { currency, amount: sumAmounts(rows.map((row) => row.amount)), rows };
}
