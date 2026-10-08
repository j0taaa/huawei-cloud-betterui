import Link from "next/link";
import {
  costGroups,
  currentBillingMonth,
  type CostQuery,
} from "@/lib/billing-query";

export function BillingFilters({
  month,
  cost,
}: {
  month: string;
  cost?: CostQuery;
}) {
  return (
    <section className="rounded-xl border border-[#e4e9f2] bg-white p-5">
      <nav
        aria-label="Billing views"
        className="mb-4 flex flex-wrap gap-4 text-sm font-bold text-[#2563eb]"
      >
        <Link
          href={`/services/billing/center?month=${encodeURIComponent(month)}`}
        >
          Billing Center
        </Link>
        <Link href={`/services/cost?month=${encodeURIComponent(month)}`}>
          Cost Center
        </Link>
      </nav>
      <form
        action={cost ? "/services/cost" : "/services/billing/center"}
        className="flex flex-wrap items-end gap-4"
      >
        <label className="grid gap-2 text-sm font-bold">
          Month (GMT+08:00)
          <input
            className="rounded-lg border border-[#d9e0eb] p-2"
            type="month"
            name="month"
            required
            defaultValue={month}
            max={currentBillingMonth()}
          />
        </label>
        {cost ? (
          <>
            <label className="grid gap-2 text-sm font-bold">
              Group by
              <select
                className="rounded-lg border border-[#d9e0eb] p-2"
                name="group"
                defaultValue={cost.group}
              >
                {Object.entries(costGroups).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold">
              Cost type
              <select
                className="rounded-lg border border-[#d9e0eb] p-2"
                name="type"
                defaultValue={cost.type}
              >
                <option value="ORIGINAL_COST">Original costs</option>
                <option value="AMORTIZED_COST">Amortized costs</option>
              </select>
            </label>
          </>
        ) : null}
        <button
          className="rounded-lg bg-[#2563eb] px-4 py-2 font-bold text-white"
          type="submit"
        >
          Apply
        </button>
      </form>
      <p className="mt-4 text-sm text-[#667085]">
        {cost
          ? "Net costs can be grouped by service, region, or enterprise project. Original costs can lag by about an hour; amortized costs update daily and can take longer. Current-month amounts can change."
          : "Monthly expenditure for this account. Refunds and adjustments remain separate in the breakdown. Current-month amounts can change."}
      </p>
    </section>
  );
}
