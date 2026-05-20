"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

function formatLocalDateTime(value: string) {
  if (!value || value === "-") {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}

export function LocalDateTime({ value }: { value: string }) {
  const isClient = useIsClient();
  const formatted = isClient ? formatLocalDateTime(value) : "Loading local time";

  return (
    <time dateTime={value === "-" ? undefined : value} suppressHydrationWarning>
      {formatted}
    </time>
  );
}
