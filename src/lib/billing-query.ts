export const costGroups = {
  CLOUD_SERVICE_TYPE: "Service",
  REGION_CODE: "Region",
  ENTERPRISE_PROJECT_ID: "Enterprise project",
} as const;
export type CostGroup = keyof typeof costGroups;
export type CostType = "ORIGINAL_COST" | "AMORTIZED_COST";
export type CostQuery = { month: string; group: CostGroup; type: CostType };

export function currentBillingMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}

export function validateBillingMonth(
  month: string,
  months = 36,
  now = new Date(),
) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Choose a month in YYYY-MM format.");
  const ordinal = (value: string) =>
    Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
  const age = ordinal(currentBillingMonth(now)) - ordinal(month);
  if (age < 0 || age >= months)
    throw new Error(
      `Choose a month within the latest ${months} months, including the current month.`,
    );
  return month;
}

export function readCostQuery(
  params: Record<string, string | string[] | undefined>,
): CostQuery {
  const month =
    typeof params.month === "string" ? params.month : currentBillingMonth();
  const group =
    typeof params.group === "string" ? params.group : "CLOUD_SERVICE_TYPE";
  const type = typeof params.type === "string" ? params.type : "ORIGINAL_COST";
  validateBillingMonth(month, 18);
  if (!Object.hasOwn(costGroups, group))
    throw new Error("Choose a supported cost grouping.");
  if (type !== "ORIGINAL_COST" && type !== "AMORTIZED_COST")
    throw new Error("Choose original or amortized costs.");
  return { month, group: group as CostGroup, type };
}
