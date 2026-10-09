import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { HuaweiApiError, huaweiAccountFetch } from "@/lib/huawei/http";
import { asRecord, asString } from "@/lib/huawei/parsers";
import {
  costGroups,
  currentBillingMonth,
  validateBillingMonth,
  type CostGroup,
  type CostType,
} from "@/lib/billing-query";
import { formatMoney, sumAmounts } from "@/lib/billing-format";
import { getCostReport, type CostReport } from "@/lib/huawei/services/billing";
import {
  ManagementInputError,
  type ManagementChoice,
  type ManagementField,
  type ManagementResource,
  type ManagementValues,
} from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

const accountPrefix = "account:";
const costAnalysisMonths = 18;
const maxGroupFacts = 20;

const monthField: ManagementField = {
  key: "month",
  label: "Billing month",
  type: "select",
  source: "months",
  required: true,
  help: "Any month within the native 18-month cost analysis window, including the current month.",
};
const groupField: ManagementField = {
  key: "group",
  label: "Cost grouping",
  type: "select",
  required: true,
  choices: Object.entries(costGroups).map(([value, label]) => ({
    value,
    label,
  })),
};
const typeField: ManagementField = {
  key: "type",
  label: "Cost type",
  type: "select",
  required: true,
  choices: [
    { value: "ORIGINAL_COST", label: "Original cost" },
    { value: "AMORTIZED_COST", label: "Amortized cost" },
  ],
  help: "Original costs show incurred amounts; amortized costs spread committed spending across usage periods.",
};

function monthChoices(now = new Date()): ManagementChoice[] {
  const current = currentBillingMonth(now);
  const year = Number(current.slice(0, 4));
  const month = Number(current.slice(5));
  const choices: ManagementChoice[] = [];
  for (let age = 0; age < costAnalysisMonths; age++) {
    const ordinal = year * 12 + month - 1 - age;
    const value = `${Math.floor(ordinal / 12)}-${String((ordinal % 12) + 1).padStart(2, "0")}`;
    choices.push({ value, label: value });
  }
  return choices;
}

async function verifyAccount(s: BetterUiSession) {
  if (!s.accountToken)
    throw new ManagementInputError(
      "Sign in again to obtain an account token.",
      409,
    );
  let response: Record<string, unknown>;
  try {
    response = await huaweiAccountFetch<Record<string, unknown>>({ ...s, token: s.accountToken }, "/v3/auth/tokens", { headers: { "X-Subject-Token": s.accountToken } });
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("Invalid IAM response");
    for (const container of [response, asRecord(response.data)]) if (["error", "error_code", "error_msg"].some(key => Object.hasOwn(container, key))) throw new Error("Invalid IAM proof");
  } catch (error) {
    if (error instanceof HuaweiApiError) throw error;
    throw new ManagementInputError("Unable to verify this account's IAM domain. Sign in again.", 409);
  }
  const token = asRecord(response.token);
  // A project-scoped token must never scope account-wide cost analysis.
  if (token.project !== undefined)
    throw new ManagementInputError(
      "The current token is project-scoped. Sign in again to obtain an account-wide token.",
      409,
    );
  const domainId = asString(asRecord(token.domain).id, "");
  const user = asRecord(token.user);
  if (
    !domainId ||
    (s.userId && user.id !== s.userId) ||
    asRecord(user.domain).id !== domainId
  )
    throw new ManagementInputError(
      "Unable to verify this account's IAM domain. Sign in again.",
      409,
    );
  return { domainId };
}

async function verifiedScope(
  s: BetterUiSession,
  resource: ManagementResource | undefined,
) {
  const { domainId } = await verifyAccount(s);
  if (!resource || resource.id !== `${accountPrefix}${domainId}`)
    throw new ManagementInputError(
      "Select the verified account scope for this cost analysis.",
      409,
    );
  return domainId;
}

function requireMonth(v: ManagementValues) {
  const month = typeof v.month === "string" ? v.month : "";
  try {
    validateBillingMonth(month, costAnalysisMonths);
  } catch {
    throw new ManagementInputError(
      "Choose a billing month within the latest 18 months, including the current month.",
    );
  }
  return month;
}

function requireGroup(v: ManagementValues) {
  const group = typeof v.group === "string" ? v.group : "";
  if (!Object.hasOwn(costGroups, group))
    throw new ManagementInputError("Choose a supported cost grouping.");
  return group as CostGroup;
}

function requireType(v: ManagementValues) {
  const type = typeof v.type === "string" ? v.type : "";
  if (type !== "ORIGINAL_COST" && type !== "AMORTIZED_COST")
    throw new ManagementInputError("Choose original or amortized costs.");
  return type as CostType;
}

function negate(amount: string) {
  return amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
}

function reportTotal(report: CostReport) {
  if (report.amount === null)
    throw new ManagementInputError(
      "Huawei did not report a verifiable cost total.",
      409,
    );
  return report.amount;
}

function remainingGroups(count: number) {
  return count > maxGroupFacts
    ? [
        {
          label: "Groupings",
          value: `${count} groupings in total; open the native cost center for the complete list.`,
        },
      ]
    : [];
}

function analyzeFacts(
  report: CostReport,
  month: string,
  group: CostGroup,
  type: CostType,
) {
  const facts = [
    { label: "Month", value: month },
    { label: "Grouping", value: costGroups[group] },
    {
      label: "Cost type",
      value: type === "ORIGINAL_COST" ? "Original cost" : "Amortized cost",
    },
    { label: "Currency", value: report.currency },
    {
      label: "Total net amount",
      value: formatMoney(report.amount, report.currency),
    },
  ];
  for (const row of report.rows.slice(0, maxGroupFacts)) {
    facts.push({
      label: `${costGroups[group]} · ${row.dimension || "Unallocated"}`,
      value: formatMoney(row.amount, report.currency),
    });
    if (row.listPrice !== null)
      facts.push({
        label: `List price · ${row.dimension || "Unallocated"}`,
        value: formatMoney(row.listPrice, report.currency),
      });
  }
  facts.push(...remainingGroups(report.rows.length));
  return facts;
}

function compareFacts(
  original: CostReport,
  amortized: CostReport,
  month: string,
  group: CostGroup,
) {
  const currency = original.currency;
  const originalTotal = reportTotal(original);
  const amortizedTotal = reportTotal(amortized);
  const facts = [
    { label: "Month", value: month },
    { label: "Grouping", value: costGroups[group] },
    { label: "Currency", value: currency },
    { label: "Original total", value: formatMoney(originalTotal, currency) },
    {
      label: "Amortized total",
      value: formatMoney(amortizedTotal, currency),
    },
    {
      label: "Total difference (original minus amortized)",
      value: formatMoney(
        sumAmounts([originalTotal, negate(amortizedTotal)]),
        currency,
      ),
    },
  ];
  const originalAmounts = new Map(
    original.rows.map((row) => [row.dimension, row.amount]),
  );
  const amortizedAmounts = new Map(
    amortized.rows.map((row) => [row.dimension, row.amount]),
  );
  const dimensions = [
    ...original.rows.map((row) => row.dimension),
    ...amortized.rows
      .filter((row) => !originalAmounts.has(row.dimension))
      .map((row) => row.dimension),
  ];
  for (const dimension of dimensions.slice(0, maxGroupFacts)) {
    const before = originalAmounts.get(dimension);
    const after = amortizedAmounts.get(dimension);
    facts.push({
      label: `${costGroups[group]} · ${dimension || "Unallocated"}`,
      value: `${before === undefined ? "Not reported" : formatMoney(before, currency)} → ${after === undefined ? "Not reported" : formatMoney(after, currency)}`,
    });
  }
  facts.push(...remainingGroups(dimensions.length));
  return facts;
}

export const costManagement: ManagementAdapter = {
  title: "Cost Analysis (Read-Only)",
  accountWide: true,
  operations: [
    {
      id: "analyze-costs",
      label: "Analyze costs",
      kind: "inspect",
      description:
        "Read fresh account costs for one month, grouping, and cost type. This read-only query changes no resources and saves no operation history. Budget and forecast administration remain in Huawei Cost Center.",
      resourcePrefixes: [accountPrefix],
      allowedStatuses: ["Verified"],
      fields: [monthField, groupField, typeField],
    },
    {
      id: "compare-cost-types",
      label: "Compare original and amortized costs",
      kind: "inspect",
      description:
        "Read this account's native original and amortized costs for the same month and grouping and compare them per grouping. Both native reads must report the same currency before any comparison. The queries are read-only and nothing is saved.",
      resourcePrefixes: [accountPrefix],
      allowedStatuses: ["Verified"],
      fields: [monthField, groupField],
    },
  ],
  inventory: async (s) => {
    const { domainId } = await verifyAccount(s);
    return [
      {
        id: `${accountPrefix}${domainId}`,
        name: s.accountName,
        status: "Verified",
        values: { account: s.accountName },
      },
    ];
  },
  options: async () => ({ months: monthChoices() }),
  invalidationKeys: () => [],
  execute: async (s, operation, v, resource) => {
    if (operation === "analyze-costs") {
      const month = requireMonth(v);
      const group = requireGroup(v);
      const type = requireType(v);
      await verifiedScope(s, resource);
      const report = await getCostReport(s, { month, group, type });
      return {
        message: `Native cost analysis for ${month} grouped by ${costGroups[group].toLowerCase()} (${type === "AMORTIZED_COST" ? "amortized" : "original"} cost). Amounts are net and were read fresh; nothing was saved.`,
        facts: analyzeFacts(report, month, group, type),
      };
    }
    if (operation === "compare-cost-types") {
      const month = requireMonth(v);
      const group = requireGroup(v);
      await verifiedScope(s, resource);
      const original = await getCostReport(s, {
        month,
        group,
        type: "ORIGINAL_COST",
      });
      const amortized = await getCostReport(s, {
        month,
        group,
        type: "AMORTIZED_COST",
      });
      if (original.currency !== amortized.currency)
        throw new ManagementInputError(
          "Huawei reported different currencies for original and amortized costs; they cannot be compared here.",
          409,
        );
      return {
        message: `Original and amortized costs compared for ${month} grouped by ${costGroups[group].toLowerCase()} in ${original.currency}. Nothing was saved.`,
        facts: compareFacts(original, amortized, month, group),
      };
    }
    throw new ManagementInputError("Unsupported cost operation.");
  },
};
