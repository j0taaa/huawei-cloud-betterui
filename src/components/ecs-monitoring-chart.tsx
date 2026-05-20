"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

type Datapoint = {
  timestamp: string;
  value: number;
};

function formatMetricValue(value: number, unit: string) {
  if (unit === "%") {
    return `${value.toFixed(1)}%`;
  }

  if (["B/s", "byte/s", "bytes/s"].includes(unit)) {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)} MB/s`;
    }

    return `${(value / 1_000).toFixed(2)} KB/s`;
  }

  return `${value.toFixed(1)} ${unit}`;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

const subscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function EcsMonitoringChart({
  datapoints,
  unit,
}: {
  datapoints: Datapoint[];
  unit: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const isClient = useIsClient();
  const maxValue = useMemo(
    () => Math.max(...datapoints.map((point) => point.value), 1),
    [datapoints],
  );
  const activePoint = activeIndex === null ? null : datapoints[activeIndex];
  const timestampLabel = (value: string) =>
    isClient ? formatTimestamp(value) : value;

  return (
    <div className="relative mt-6 rounded-xl bg-[#f7f9fc] p-4">
      {activePoint ? (
        <div className="absolute right-4 top-4 z-10 rounded-lg border border-[#d9e0eb] bg-white px-3 py-2 text-xs font-bold shadow-[0_14px_34px_rgba(16,24,40,0.14)]">
          <p className="text-[#101828]">{formatMetricValue(activePoint.value, unit)}</p>
          <p className="mt-1 text-[#667085]">{timestampLabel(activePoint.timestamp)}</p>
        </div>
      ) : null}

      <div className="flex h-48 items-end gap-1">
        {datapoints.map((point, index) => {
          const scale = unit === "%" ? 100 : maxValue;
          const height = `${Math.max(8, Math.min(100, (point.value / scale) * 100))}%`;
          const isActive = activeIndex === index;

          return (
            <button
              aria-label={`${formatMetricValue(point.value, unit)} at ${timestampLabel(point.timestamp)}`}
              className="group flex h-full flex-1 items-end focus:outline-none"
              key={`${point.timestamp}-${point.value}`}
              onBlur={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              type="button"
            >
              <span
                className={`block w-full rounded-t transition ${
                  isActive
                    ? "bg-gradient-to-t from-[#d7000f] to-[#ff9aa3]"
                    : "bg-gradient-to-t from-[#2563eb] to-[#7db2ff] group-hover:from-[#d7000f] group-hover:to-[#ff9aa3]"
                }`}
                style={{ height }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
