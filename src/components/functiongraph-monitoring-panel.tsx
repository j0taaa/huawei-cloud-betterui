"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  ConsoleButton,
  ConsoleInlineMessage,
  ConsoleInsetPanel,
  MetricCard,
  MetricGrid,
  ConsolePill,
  ConsoleSubPanel,
} from "@/components/console-ui";
import { EcsMonitoringChart } from "@/components/ecs-monitoring-chart";
import type { FunctionGraphMonitoring } from "@/lib/huawei/services/functiongraph.types";
function formatMetricTotal(value: number, unit: string) {
  if (unit === "ms") {
    return `${value.toFixed(0)} ms`;
  }

  if (unit === "Count") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
      value,
    );
  }

  return `${value.toFixed(1)} ${unit}`;
}

export function FunctionGraphMonitoringPanel({
  functionId,
}: {
  functionId: string;
}) {
  const [timeframe, setTimeframe] = useState("6h");
  const [monitoring, setMonitoring] = useState<FunctionGraphMonitoring | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadMonitoring = useCallback(
    async (nextTimeframe: string) => {
      setIsLoading(true);
      setMessage("Loading monitoring data...");

      try {
        const query = new URLSearchParams({ timeframe: nextTimeframe });
        const response = await fetch(
          `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/monitoring?${query.toString()}`,
          { cache: "no-store" },
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          monitoring?: FunctionGraphMonitoring;
        };

        if (!response.ok || !body.monitoring) {
          throw new Error(
            body.error || `Monitoring request returned ${response.status}.`,
          );
        }

        setMonitoring(body.monitoring);
        setMessage("");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load monitoring data.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [functionId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMonitoring(timeframe);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadMonitoring, timeframe]);

  const costFormatter = monitoring?.cost
    ? new Intl.NumberFormat("en-US", {
        currency: monitoring.cost.currency,
        style: "currency",
      })
    : null;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {["1h", "6h", "24h", "7d", "30d"].map((option) => (
            <button
              className={`h-9 rounded-md px-3 text-sm font-black transition ${
                timeframe === option
                  ? "bg-[#2563eb] text-white"
                  : "bg-white text-[#475467] hover:bg-[#eef2f7] hover:text-[#101828] dark:bg-[#0b1220] dark:text-[#cbd5e1] dark:hover:bg-white/10 dark:hover:text-white"
              }`}
              key={option}
              onClick={() => setTimeframe(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
        <ConsoleButton
          disabled={isLoading}
          onClick={() => loadMonitoring(timeframe)}
          variant="ghost"
        >
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </ConsoleButton>
      </div>

      {message ? <ConsoleInlineMessage>{message}</ConsoleInlineMessage> : null}

      <MetricGrid columns={4} className="lg:grid-cols-4">
        <MetricCard
          className="border-[#d1fadf]"
          description={
            monitoring?.cost
              ? `${monitoring.cost.billingCycle} · ${monitoring.cost.recordCount} BSS records`
              : "BSSINTL did not return function cost records."
          }
          label="Current month cost"
          value={
            monitoring?.cost && costFormatter
              ? costFormatter.format(monitoring.cost.amount)
              : "Unavailable"
          }
          variant="compact"
        />
        {(monitoring?.metrics ?? []).slice(0, 3).map((metric) => (
          <MetricCard
            description={`${monitoring?.timeframe ?? timeframe} · ${metric.statistic}`}
            key={`summary-${metric.metricName}`}
            label={metric.label}
            value={formatMetricTotal(metric.total, metric.unit)}
            variant="compact"
          />
        ))}
      </MetricGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        {(monitoring?.metrics ?? []).map((metric) => (
          <ConsoleSubPanel
            actions={
              <ConsolePill className="px-3" tone="info">
                {metric.unit}
              </ConsolePill>
            }
            className="rounded-2xl"
            contentClassName="p-5"
            description={`${metric.namespace} · ${metric.metricName}`}
            key={`${metric.namespace}-${metric.metricName}`}
            title={metric.label}
          >
            {metric.datapoints.length ? (
              <EcsMonitoringChart
                aggregation={metric.statistic}
                datapoints={metric.datapoints}
                unit={metric.unit}
              />
            ) : (
              <ConsoleInsetPanel className="mt-5 text-center" dashed>
                <p className="text-sm font-black text-[#344054] dark:text-white">
                  No Cloud Eye datapoints returned.
                </p>
                <p className="mt-2 text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
                  The function may not have run during this timeframe. Try 30d
                  for functions that run infrequently.
                </p>
              </ConsoleInsetPanel>
            )}
          </ConsoleSubPanel>
        ))}
      </div>
    </div>
  );
}
