import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { BetterUiSession } from "@/lib/auth-session";
import {
  currentBillingMonth,
  type CostGroup,
  type CostType,
} from "@/lib/billing-query";
import { formatMoney } from "@/lib/billing-format";
import { HuaweiApiError } from "@/lib/huawei/http";
import { costManagement } from "@/lib/huawei/management/adapters/cost";
import type { ManagementValues } from "@/lib/management-contract";
import {
  getBillingSummary,
  getCostReport,
} from "@/lib/huawei/services/billing";
import { session } from "./fixtures/session";

const account: BetterUiSession = { ...session, accountToken: "account-token" };
const month = currentBillingMonth();

function shiftedMonth(delta: number, now = new Date()) {
  const current = currentBillingMonth(now);
  const year = Number(current.slice(0, 4));
  const ordinal = year * 12 + Number(current.slice(5)) - 1 + delta;
  return `${Math.floor(ordinal / 12)}-${String((ordinal % 12) + 1).padStart(2, "0")}`;
}

type CloudCall = {
  url: URL;
  method: string;
  body: Record<string, unknown>;
  headers: Headers;
};

function mockCloud(t: TestContext, handler: (call: CloudCall) => unknown) {
  const calls: CloudCall[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      const call: CloudCall = {
        url: new URL(input),
        method: init.method ?? "GET",
        body: init.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {},
        headers: new Headers(init.headers),
      };
      calls.push(call);
      const response = handler(call);
      return response instanceof Response
        ? response
        : Response.json(response);
    },
  );
  return calls;
}

function costRow(
  key: string,
  value: string,
  amount: string,
  official?: string,
) {
  return {
    dimensions: [{ key, value }],
    amount_by_costs: amount,
    ...(official === undefined
      ? {}
      : { official_amount_by_costs: official }),
  };
}

function costPage(
  rows: Record<string, unknown>[],
  currency: string,
  total: number,
) {
  return { currency, total_count: total, cost_data: rows };
}

function pagedCost(t: TestContext, pages: Record<string, unknown>[]) {
  let index = 0;
  return mockCloud(t, (call) => {
    if (call.url.pathname !== "/v4/costs/cost-analysed-bills/query")
      throw new Error(`Unexpected request ${call.method} ${call.url.pathname}`);
    return pages[Math.min(index++, pages.length - 1)];
  });
}

function pagedBills(t: TestContext, pages: Record<string, unknown>[]) {
  let index = 0;
  return mockCloud(t, (call) => {
    if (call.url.pathname !== "/v2/bills/customer-bills/monthly-sum")
      throw new Error(`Unexpected request ${call.method} ${call.url.pathname}`);
    return pages[Math.min(index++, pages.length - 1)];
  });
}

const iamToken = {
  token: {
    domain: { id: "domain-1", name: "test-account" },
    user: { id: "user-1", name: "test-user", domain: { id: "domain-1" } },
    methods: ["password"],
    expires_at: "2099-01-01T00:00:00Z",
  },
};
const accountResource = {
  id: "account:domain-1",
  name: "test-account",
  status: "Verified",
};

function mockCostAdapter(
  t: TestContext,
  iam: Record<string, unknown>,
  cost?: (call: CloudCall) => Record<string, unknown>,
) {
  return mockCloud(t, (call) => {
    if (call.url.pathname === "/v3/auth/tokens") {
      assert.equal(call.headers.get("X-Subject-Token"), "account-token");
      assert.equal(call.method, "GET");
      return iam;
    }
    if (call.url.pathname === "/v4/costs/cost-analysed-bills/query") {
      return (
        cost?.(call) ?? {
          currency: "USD",
          total_count: 1,
          cost_data: [
            costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "10"),
          ],
        }
      );
    }
    throw new Error(`Unexpected request ${call.method} ${call.url.pathname}`);
  });
}

test("billing summary requires an account token and never falls back to the regional token", async (t) => {
  const calls = mockCloud(t, () => {
    throw new Error("must not fetch");
  });
  await assert.rejects(getBillingSummary(session, month), /account token/);
  await assert.rejects(
    getBillingSummary({ ...session, token: "regional-token" }, month),
    /account token/,
  );
  assert.equal(calls.length, 0);
});

test("cost report requires an account token and never falls back to the regional token", async (t) => {
  const calls = mockCloud(t, () => {
    throw new Error("must not fetch");
  });
  await assert.rejects(
    getCostReport(session, {
      month,
      group: "CLOUD_SERVICE_TYPE",
      type: "ORIGINAL_COST",
    }),
    /account token/,
  );
  assert.equal(calls.length, 0);
});

test("billing summary wires the account token and reads every native page strictly", async (t) => {
  const calls = pagedBills(t, [
    {
      currency: "USD",
      total_count: 2,
      consume_amount: "12.345678",
      coupon_amount: "0",
      debt_amount: "1.2",
      bill_sums: [
        {
          service_type_code: "hws.service.type.ecs",
          service_type_name: "Elastic Cloud Server",
          account_name: "Team A",
          bill_type: 1,
          charging_mode: 3,
          consume_amount: "20",
          coupon_amount: "0",
          debt_amount: "0",
        },
      ],
    },
    {
      currency: "USD",
      total_count: 2,
      bill_sums: [
        {
          service_type_code: "hws.service.type.rds",
          bill_type: 2,
          charging_mode: 1,
          consume_amount: "-7.654322",
        },
      ],
    },
  ]);
  const summary = await getBillingSummary(account, month);
  assert.deepEqual(
    calls.map((call) => call.url.searchParams.get("offset")),
    ["0", "1"],
  );
  for (const call of calls) {
    assert.equal(call.method, "GET");
    assert.equal(call.headers.get("X-Auth-Token"), "account-token");
    assert.equal(call.headers.get("X-Language"), "en_US");
    assert.equal(call.url.searchParams.get("bill_cycle"), month);
    assert.equal(call.url.searchParams.get("method"), "oneself");
  }
  assert.equal(summary.currency, "USD");
  assert.equal(summary.amount, "12.345678");
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.rows[0].service, "Elastic Cloud Server");
  assert.equal(summary.rows[0].account, "Team A");
  assert.equal(summary.rows[0].chargingMode, "Pay-per-use");
  assert.equal(summary.rows[1].kind, "Refund");
  assert.equal(summary.rows[1].amount, "-7.654322");
});

test("cost report posts the documented native query on every page and sums exactly", async (t) => {
  const calls = pagedCost(t, [
    costPage(
      [costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "0.1", "0.5")],
      "USD",
      2,
    ),
    costPage(
      [costRow("CLOUD_SERVICE_TYPE", "hws.service.type.evs", "0.2")],
      "USD",
      2,
    ),
  ]);
  const report = await getCostReport(account, {
    month,
    group: "CLOUD_SERVICE_TYPE",
    type: "AMORTIZED_COST",
  });
  assert.deepEqual(
    calls.map((call) => call.body.offset),
    [0, 1],
  );
  for (const call of calls) {
    assert.equal(call.method, "POST");
    assert.equal(call.headers.get("X-Auth-Token"), "account-token");
    assert.equal(call.headers.get("X-Language"), "en_US");
    assert.deepEqual(call.body.time_condition, {
      time_measure_id: 2,
      begin_time: month,
      end_time: month,
    });
    assert.deepEqual(call.body.groupby, [
      { type: "dimension", key: "CLOUD_SERVICE_TYPE" },
    ]);
    assert.equal(call.body.cost_type, "AMORTIZED_COST");
    assert.equal(call.body.amount_type, "NET_AMOUNT");
    assert.equal(call.body.limit, 100);
  }
  assert.equal(report.currency, "USD");
  assert.equal(report.amount, "0.3");
  assert.equal(report.rows[0].dimension, "hws.service.type.ecs");
  assert.equal(report.rows[0].listPrice, "0.5");
  assert.equal(report.rows[1].listPrice, null);
});

test("a later native page that changes currency is rejected", async (t) => {
  pagedCost(t, [
    costPage([costRow("REGION_CODE", "sa-brazil-1", "1")], "USD", 2),
    costPage([costRow("REGION_CODE", "eu-west-0", "1")], "EUR", 2),
  ]);
  await assert.rejects(
    getCostReport(account, {
      month,
      group: "REGION_CODE",
      type: "ORIGINAL_COST",
    }),
    /currency between pages/,
  );
});

test("a later native page that changes total_count is rejected", async (t) => {
  pagedCost(t, [
    { currency: "USD", total_count: 2, cost_data: [costRow("REGION_CODE", "sa-brazil-1", "1")] },
    { currency: "USD", total_count: 5, cost_data: [costRow("REGION_CODE", "eu-west-0", "1")] },
  ]);
  await assert.rejects(
    getCostReport(account, {
      month,
      group: "REGION_CODE",
      type: "ORIGINAL_COST",
    }),
    /total between pages/,
  );
});

test("every native page must carry an exact ISO currency", async (t) => {
  for (const currency of ["", "usd", "US", "USDB"]) {
    mockCloud(t, () => ({ currency, total_count: 0, cost_data: [] }));
    await assert.rejects(
      getCostReport(account, {
        month,
        group: "REGION_CODE",
        type: "ORIGINAL_COST",
      }),
      /valid currency/,
    );
  }
  mockCloud(t, () => ({ total_count: 0, cost_data: [] }));
  await assert.rejects(getBillingSummary(account, month), /valid currency/);
});

test("every native page requires its list array and a safe non-negative total_count", async (t) => {
  const bodies = [
    { currency: "USD", cost_data: [] },
    { currency: "USD", total_count: "2", cost_data: [] },
    { currency: "USD", total_count: -1, cost_data: [] },
    { currency: "USD", total_count: 1.5, cost_data: [] },
    { currency: "USD", total_count: 2 ** 53, cost_data: [] },
    { currency: "USD", total_count: 0 },
    { currency: "USD", total_count: 0, cost_data: "rows" },
    { currency: "USD", total_count: 0, cost_data: [costRow("REGION_CODE", "sa-brazil-1", "1")] },
    { currency: "USD", total_count: 1, cost_data: [{ error_code: "PRIVATE_NATIVE", error_msg: "PRIVATE_NATIVE" }] },
    { currency: "USD", total_count: 1, cost_data: ["not-an-object"] },
  ];
  for (const body of bodies) {
    mockCloud(t, () => body);
    await assert.rejects(
      getCostReport(account, {
        month,
        group: "REGION_CODE",
        type: "ORIGINAL_COST",
      }),
      (error: Error) => !error.message.includes("PRIVATE_NATIVE"),
    );
  }
  mockCloud(t, () => ({ currency: "USD", total_count: 0 }));
  await assert.rejects(getBillingSummary(account, month), /bill_sums list/);
});

test("native 200 business errors are rejected without private diagnostics", async (t) => {
  for (const body of [
    { error_code: "PRIVATE_NATIVE", error_msg: "PRIVATE_NATIVE" },
    { error_code: null },
    { error_code: false },
    { error_msg: "PRIVATE_NATIVE" },
    { error: { code: "PRIVATE_NATIVE", message: "PRIVATE_NATIVE" } },
    { currency: "USD", total_count: 0, cost_data: [], error_code: "PRIVATE_NATIVE" },
  ]) {
    mockCloud(t, () => body);
    await assert.rejects(
      getCostReport(account, {
        month,
        group: "REGION_CODE",
        type: "ORIGINAL_COST",
      }),
      (error: Error) => !error.message.includes("PRIVATE_NATIVE"),
    );
  }
  mockCloud(t, () => ({
    error_code: "0",
    currency: "USD",
    total_count: 1,
    cost_data: [costRow("REGION_CODE", "sa-brazil-1", "2")],
  }));
  const report = await getCostReport(account, {
    month,
    group: "REGION_CODE",
    type: "ORIGINAL_COST",
  });
  assert.equal(report.amount, "2");
});

test("HTTP failures keep the HuaweiApiError status and malformed bodies stay sanitized", async (t) => {
  for (const [status, text] of [
    [403, "PRIVATE_NATIVE"],
    [502, '{"error_code":"PRIVATE_NATIVE"}'],
  ] as const) {
    mockCloud(t, () => new Response(text, { status }));
    await assert.rejects(
      getCostReport(account, {
        month,
        group: "REGION_CODE",
        type: "ORIGINAL_COST",
      }),
      (error: Error) =>
        error instanceof HuaweiApiError &&
        error.status === status &&
        !error.message.includes("PRIVATE_NATIVE"),
    );
  }
  mockCloud(t, () => new Response("PRIVATE_NATIVE"));
  await assert.rejects(
    getBillingSummary(account, month),
    (error: Error) =>
      error instanceof SyntaxError &&
      !error.message.includes("PRIVATE_NATIVE"),
  );
});

test("missing, duplicated, or mismatched cost dimensions never default to Unallocated", async (t) => {
  const rows = [
    { amount_by_costs: "1" },
    { dimensions: [], amount_by_costs: "1" },
    { dimensions: [{ key: "REGION_CODE", value: "a" }, { key: "REGION_CODE", value: "b" }], amount_by_costs: "1" },
    { dimensions: [{ key: "CLOUD_SERVICE_TYPE", value: "a" }], amount_by_costs: "1" },
    { dimensions: [{ key: "REGION_CODE", value: 7 }], amount_by_costs: "1" },
    { dimensions: [{ key: "REGION_CODE", value: "a" }, { key: "CLOUD_SERVICE_TYPE", value: "b" }], amount_by_costs: "1" },
  ];
  for (const row of rows) {
    mockCloud(t, () => ({ currency: "USD", total_count: 1, cost_data: [row] }));
    await assert.rejects(
      getCostReport(account, {
        month,
        group: "REGION_CODE",
        type: "ORIGINAL_COST",
      }),
      /grouping dimension/,
    );
  }
});

test("an explicit empty native dimension retains its distinct native identity", async (t) => {
  mockCloud(t, () => ({
    currency: "USD",
    total_count: 1,
    cost_data: [costRow("ENTERPRISE_PROJECT_ID", "", "3.5")],
  }));
  const report = await getCostReport(account, {
    month,
    group: "ENTERPRISE_PROJECT_ID",
    type: "ORIGINAL_COST",
  });
  assert.equal(report.rows[0].dimension, "");
  assert.equal(report.amount, "3.5");
});

test("repeated grouping values are rejected before any total aggregation", async (t) => {
  mockCloud(t, () => ({
    currency: "USD",
    total_count: 2,
    cost_data: [
      costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "1"),
      costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "2"),
    ],
  }));
  await assert.rejects(
    getCostReport(account, {
      month,
      group: "CLOUD_SERVICE_TYPE",
      type: "ORIGINAL_COST",
    }),
    /repeated a cost grouping/,
  );
  pagedCost(t, [
    { currency: "USD", total_count: 2, cost_data: [costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "1")] },
    { currency: "USD", total_count: 2, cost_data: [costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "2")] },
  ]);
  await assert.rejects(
    getCostReport(account, {
      month,
      group: "CLOUD_SERVICE_TYPE",
      type: "ORIGINAL_COST",
    }),
    /repeated a cost grouping/,
  );
});

test("cost amounts stay exact with negative credits and no fake zeros", async (t) => {
  mockCloud(t, () => ({
    currency: "USD",
    total_count: 3,
    cost_data: [
      costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "0.1"),
      costRow("CLOUD_SERVICE_TYPE", "hws.service.type.evs", "0.2"),
      costRow("CLOUD_SERVICE_TYPE", "hws.service.type.nat", "-0.45"),
    ],
  }));
  const report = await getCostReport(account, {
    month,
    group: "CLOUD_SERVICE_TYPE",
    type: "ORIGINAL_COST",
  });
  assert.equal(report.amount, "-0.15");
  assert.equal(report.rows[2].amount, "-0.45");
  assert.equal(report.rows[2].listPrice, null);
  mockCloud(t, () => ({
    currency: "USD",
    total_count: 1,
    cost_data: [
      { dimensions: [{ key: "CLOUD_SERVICE_TYPE", value: "hws.service.type.ecs" }] },
    ],
  }));
  await assert.rejects(
    getCostReport(account, {
      month,
      group: "CLOUD_SERVICE_TYPE",
      type: "ORIGINAL_COST",
    }),
    /grouped amount/,
  );
});

test("unknown native bill types and charging modes are labeled Unknown", async (t) => {
  mockCloud(t, () => ({
    currency: "USD",
    total_count: 1,
    consume_amount: "1",
    bill_sums: [
      {
        service_type_code: "hws.service.type.ecs",
        bill_type: 99,
        charging_mode: 42,
        consume_amount: "1",
      },
    ],
  }));
  const summary = await getBillingSummary(account, month);
  assert.equal(summary.rows[0].kind, "Unknown");
  assert.equal(summary.rows[0].chargingMode, "Unknown");
  assert.doesNotMatch(JSON.stringify(summary.rows[0]), /"99"|"42"/);
});

test("billing keeps its 36-month and cost its 18-month native query bounds", async (t) => {
  const calls = mockCloud(t, () => {
    throw new Error("must not fetch");
  });
  await assert.rejects(getBillingSummary(account, "2099-01"), /latest 36 months/);
  await assert.rejects(
    getCostReport(account, {
      month: shiftedMonth(-18),
      group: "REGION_CODE",
      type: "ORIGINAL_COST",
    }),
    /latest 18 months/,
  );
  await assert.rejects(
    getCostReport(account, {
      month: "2026-13",
      group: "REGION_CODE",
      type: "ORIGINAL_COST",
    }),
    /YYYY-MM/,
  );
  assert.equal(calls.length, 0);
});

test("unsupported cost groupings and types are rejected before any request", async (t) => {
  const calls = mockCloud(t, () => {
    throw new Error("must not fetch");
  });
  await assert.rejects(
    getCostReport(account, {
      month,
      group: "SERVICE" as CostGroup,
      type: "ORIGINAL_COST",
    }),
    /Unsupported cost query/,
  );
  await assert.rejects(
    getCostReport(account, {
      month,
      group: "REGION_CODE",
      type: "STANDARD_COST" as CostType,
    }),
    /Unsupported cost query/,
  );
  assert.equal(calls.length, 0);
});

test("cost management is account-wide, strictly read-only, and honestly described", () => {
  assert.equal(costManagement.accountWide, true);
  assert.deepEqual(
    costManagement.operations.map((operation) => operation.kind),
    ["inspect", "inspect"],
  );
  assert.equal(costManagement.poll, undefined);
  assert.deepEqual(costManagement.invalidationKeys(), []);
  for (const operation of costManagement.operations) {
    assert.equal(operation.confirmation, undefined);
    assert.deepEqual(operation.resourcePrefixes, ["account:"]);
    assert.match(operation.description, /read-only/i);
    assert.equal(
      operation.fields.some((field) => field.type === "password"),
      false,
    );
  }
  assert.match(
    costManagement.operations.find((operation) => operation.id === "analyze-costs")!
      .description,
    /Budget and forecast administration remain in Huawei Cost Center/,
  );
});

test("cost inventory verifies the account token via IAM and returns the analyzed account scope", async (t) => {
  const calls = mockCostAdapter(t, iamToken);
  const rows = await costManagement.inventory(account);
  assert.deepEqual(rows, [
    {
      id: "account:domain-1",
      name: "test-account",
      status: "Verified",
      values: { account: "test-account" },
    },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.hostname, "iam.example.invalid");
  assert.equal(calls[0].url.pathname, "/v3/auth/tokens");
  assert.equal(calls[0].headers.get("X-Auth-Token"), "account-token");
  assert.equal(
    calls.some((call) => call.url.pathname.includes("cost")),
    false,
  );
});

test("cost inventory rejects project-scoped account tokens including null projects", async (t) => {
  for (const project of [{ id: "project-1" }, null]) {
    mockCostAdapter(t, { token: { ...iamToken.token, project } });
    await assert.rejects(costManagement.inventory(account), /project-scoped/);
  }
});

test("cost inventory rejects mismatched user or domain identities", async (t) => {
  for (const token of [
    { domain: { id: "domain-1" }, user: { id: "other-user", domain: { id: "domain-1" } } },
    { domain: { id: "domain-1" }, user: { id: "user-1", domain: { id: "other-domain" } } },
    { user: { id: "user-1", domain: { id: "domain-1" } } },
  ]) {
    mockCostAdapter(t, { token });
    await assert.rejects(costManagement.inventory(account), /IAM domain/);
  }
});

test("cost inventory requires an account token without any request", async (t) => {
  const calls = mockCloud(t, () => {
    throw new Error("must not fetch");
  });
  await assert.rejects(costManagement.inventory(session), /account token/);
  assert.equal(calls.length, 0);
});

test("analyze costs performs a fresh native read with the account token", async (t) => {
  const calls = mockCostAdapter(t, iamToken, (call) => {
    assert.equal(call.body.cost_type, "ORIGINAL_COST");
    return {
      currency: "USD",
      total_count: 1,
      cost_data: [
        costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "12.345678", "20"),
      ],
    };
  });
  const result = await costManagement.execute(
    account,
    "analyze-costs",
    { month, group: "CLOUD_SERVICE_TYPE", type: "ORIGINAL_COST" },
    accountResource,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, "/v3/auth/tokens");
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(calls[1].body.groupby, [
    { type: "dimension", key: "CLOUD_SERVICE_TYPE" },
  ]);
  assert.deepEqual(calls[1].body.time_condition, {
    time_measure_id: 2,
    begin_time: month,
    end_time: month,
  });
  assert.equal(calls[1].body.amount_type, "NET_AMOUNT");
  assert.equal(calls[1].body.limit, 100);
  for (const call of calls)
    assert.equal(call.headers.get("X-Auth-Token"), "account-token");
  assert.ok(
    result.facts?.some((fact) => fact.label === "Month" && fact.value === month),
  );
  assert.ok(
    result.facts?.some(
      (fact) => fact.label === "Cost type" && fact.value === "Original cost",
    ),
  );
  assert.ok(
    result.facts?.some((fact) => fact.label === "Currency" && fact.value === "USD"),
  );
  assert.ok(
    result.facts?.some(
      (fact) =>
        fact.label === "Total net amount" &&
        fact.value === formatMoney("12.345678", "USD"),
    ),
  );
  assert.ok(
    result.facts?.some(
      (fact) =>
        fact.label === "Service · hws.service.type.ecs" &&
        fact.value === formatMoney("12.345678", "USD"),
    ),
  );
  assert.ok(
    result.facts?.some(
      (fact) =>
        fact.label === "List price · hws.service.type.ecs" &&
        fact.value === formatMoney("20", "USD"),
    ),
  );
  assert.doesNotMatch(JSON.stringify(result), /user-1|test-token|domain-1/);
});

test("analyze bounds grouping facts and summarizes the remainder", async (t) => {
  mockCostAdapter(t, iamToken, () => ({
    currency: "USD",
    total_count: 25,
    cost_data: Array.from({ length: 25 }, (_, index) =>
      costRow("REGION_CODE", `region-${index}`, "1"),
    ),
  }));
  const result = await costManagement.execute(
    account,
    "analyze-costs",
    { month, group: "REGION_CODE", type: "AMORTIZED_COST" },
    accountResource,
  );
  const grouped = result.facts!.filter((fact) =>
    fact.label.startsWith("Region · "),
  );
  assert.equal(grouped.length, 20);
  assert.ok(
    result.facts!.some(
      (fact) =>
        fact.label === "Groupings" &&
        fact.value.includes("25 groupings in total"),
    ),
  );
});

test("analyze costs rejects invalid months, groupings, and types before any request", async (t) => {
  const calls = mockCloud(t, () => {
    throw new Error("must not fetch");
  });
  for (const values of [
    {},
    { month: "2026-13", group: "CLOUD_SERVICE_TYPE", type: "ORIGINAL_COST" },
    { month: shiftedMonth(-18), group: "CLOUD_SERVICE_TYPE", type: "ORIGINAL_COST" },
    { month, group: "SERVICE", type: "ORIGINAL_COST" },
    { month, group: "CLOUD_SERVICE_TYPE", type: "STANDARD_COST" },
  ] as ManagementValues[]) {
    await assert.rejects(
      costManagement.execute(account, "analyze-costs", values, accountResource),
      /month|grouping|original or amortized/,
    );
  }
  assert.equal(calls.length, 0);
});

test("cost analysis requires the verified account parent selection", async (t) => {
  mockCostAdapter(t, iamToken);
  const values = { month, group: "CLOUD_SERVICE_TYPE", type: "ORIGINAL_COST" };
  await assert.rejects(
    costManagement.execute(account, "analyze-costs", values, undefined),
    /account scope/,
  );
  await assert.rejects(
    costManagement.execute(account, "analyze-costs", values, {
      id: "account:foreign",
      name: "test-account",
    }),
    /account scope/,
  );
  await assert.rejects(
    costManagement.execute(
      account,
      "compare-cost-types",
      { month, group: "REGION_CODE" },
      { id: "subscription:r-1", name: "other" },
    ),
    /account scope/,
  );
});

test("compare reads both native cost types for the same month and grouping", async (t) => {
  const calls = mockCostAdapter(t, iamToken, (call) =>
    call.body.cost_type === "ORIGINAL_COST"
      ? {
          currency: "USD",
          total_count: 1,
          cost_data: [
            costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "10"),
          ],
        }
      : {
          currency: "USD",
          total_count: 2,
          cost_data: [
            costRow("CLOUD_SERVICE_TYPE", "hws.service.type.ecs", "4"),
            costRow("CLOUD_SERVICE_TYPE", "hws.service.type.obs", "1"),
          ],
        },
  );
  const result = await costManagement.execute(
    account,
    "compare-cost-types",
    { month, group: "CLOUD_SERVICE_TYPE" },
    accountResource,
  );
  const queries = calls.filter(
    (call) => call.url.pathname === "/v4/costs/cost-analysed-bills/query",
  );
  assert.deepEqual(
    queries.map((call) => call.body.cost_type),
    ["ORIGINAL_COST", "AMORTIZED_COST"],
  );
  for (const call of queries) {
    assert.equal(call.headers.get("X-Auth-Token"), "account-token");
    assert.deepEqual(call.body.time_condition, {
      time_measure_id: 2,
      begin_time: month,
      end_time: month,
    });
    assert.deepEqual(call.body.groupby, [
      { type: "dimension", key: "CLOUD_SERVICE_TYPE" },
    ]);
  }
  assert.ok(
    result.facts?.some(
      (fact) =>
        fact.label === "Original total" &&
        fact.value === formatMoney("10", "USD"),
    ),
  );
  assert.ok(
    result.facts?.some(
      (fact) =>
        fact.label === "Amortized total" &&
        fact.value === formatMoney("5", "USD"),
    ),
  );
  assert.ok(
    result.facts?.some(
      (fact) =>
        fact.label === "Total difference (original minus amortized)" &&
        fact.value === formatMoney("5", "USD"),
    ),
  );
  assert.ok(
    result.facts?.some(
      (fact) =>
        fact.label === "Service · hws.service.type.ecs" &&
        fact.value ===
          `${formatMoney("10", "USD")} → ${formatMoney("4", "USD")}`,
    ),
  );
  assert.ok(
    result.facts?.some(
      (fact) =>
        fact.label === "Service · hws.service.type.obs" &&
        fact.value === `Not reported → ${formatMoney("1", "USD")}`,
    ),
  );
});

test("compare refuses native reads that report different currencies", async (t) => {
  mockCostAdapter(t, iamToken, (call) =>
    call.body.cost_type === "ORIGINAL_COST"
      ? { currency: "USD", total_count: 0, cost_data: [] }
      : { currency: "EUR", total_count: 0, cost_data: [] },
  );
  await assert.rejects(
    costManagement.execute(
      account,
      "compare-cost-types",
      { month, group: "CLOUD_SERVICE_TYPE" },
      accountResource,
    ),
    /currencies/,
  );
});

test("compare reports unmatched groupings honestly on both sides", async (t) => {
  mockCostAdapter(t, iamToken, (call) =>
    call.body.cost_type === "ORIGINAL_COST"
      ? {
          currency: "USD",
          total_count: 1,
          cost_data: [costRow("REGION_CODE", "sa-brazil-1", "2")],
        }
      : { currency: "USD", total_count: 0, cost_data: [] },
  );
  const result = await costManagement.execute(
    account,
    "compare-cost-types",
    { month, group: "REGION_CODE" },
    accountResource,
  );
  assert.ok(
    result.facts?.some(
      (fact) =>
        fact.label === "Region · sa-brazil-1" &&
        fact.value === `${formatMoney("2", "USD")} → Not reported`,
    ),
  );
});

test("cost analysis failures never expose private native payloads", async (t) => {
  mockCloud(t, () => new Response("PRIVATE_NATIVE", { status: 403 }));
  await assert.rejects(
    costManagement.inventory(account),
    (error: Error) =>
      error instanceof HuaweiApiError &&
      error.status === 403 &&
      !error.message.includes("PRIVATE_NATIVE"),
  );
  mockCostAdapter(t, iamToken, () => ({
    error_code: "PRIVATE_NATIVE",
    error_msg: "PRIVATE_NATIVE",
  }));
  await assert.rejects(
    costManagement.execute(
      account,
      "analyze-costs",
      { month, group: "CLOUD_SERVICE_TYPE", type: "ORIGINAL_COST" },
      accountResource,
    ),
    (error: Error) => !error.message.includes("PRIVATE_NATIVE"),
  );
});

test("cost month options stay bounded to the documented 18-month native window", async () => {
  const choices = await costManagement.options!(account, "analyze-costs");
  assert.equal(choices.months.length, 18);
  assert.equal(choices.months[0].value, currentBillingMonth());
  assert.equal(choices.months.at(-1)!.value, shiftedMonth(-17));
  for (const choice of choices.months)
    assert.match(choice.value, /^\d{4}-(0[1-9]|1[0-2])$/);
});

test("cost pagination rejects cumulative overshoot even when each page fits the stable total", async t => {
  let page = 0;
  mockCloud(t, () => ({ currency: "USD", total_count: 2, cost_data: ++page === 1 ? [costRow("REGION_CODE", "region-one", "1")] : [costRow("REGION_CODE", "region-two", "2"), costRow("REGION_CODE", "region-three", "3")] }));
  await assert.rejects(getCostReport(account, { month, group: "REGION_CODE", type: "ORIGINAL_COST" }), /more billing rows/);
});
test("financial response wrappers reject nested native business errors without exposing diagnostics", async t => {
  mockCloud(t, () => ({ currency: "USD", total_count: 0, cost_data: [], data: { error_code: "private-code", error_msg: "private-secret" } }));
  await assert.rejects(getCostReport(account, { month, group: "REGION_CODE", type: "ORIGINAL_COST" }), error => error instanceof Error && /business error/.test(error.message) && !error.message.includes("private"));
});
test("cost analysis keeps an empty native grouping distinct from a literal Unallocated grouping", async t => {
  mockCloud(t, () => ({ currency: "USD", total_count: 2, cost_data: [costRow("ENTERPRISE_PROJECT_ID", "", "1"), costRow("ENTERPRISE_PROJECT_ID", "Unallocated", "2")] }));
  const report = await getCostReport(account, { month, group: "ENTERPRISE_PROJECT_ID", type: "ORIGINAL_COST" });
  assert.deepEqual(report.rows.map(row => row.dimension), ["", "Unallocated"]); assert.equal(report.amount, "3");
});

test("cost account proof rejects a missing signed-in user identity", async t => {
  mockCostAdapter(t, { token: { domain: { id: "domain-1" }, user: { domain: { id: "domain-1" } } } });
  for (const userId of [undefined, "", " "]) await assert.rejects(costManagement.inventory({ ...account, userId }), /IAM domain/);
});
