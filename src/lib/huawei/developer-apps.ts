import "server-only";

import { asRecord, firstString } from "@/lib/huawei/core";

export function timestampMillis(value: unknown) {
  const millis = Number(value);

  return Number.isFinite(millis) && millis > 0
    ? new Date(millis).toISOString()
    : firstString([value], "-");
}

export function firstResponseArray(
  body: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = body[key];

    if (Array.isArray(value)) {
      return value;
    }

    const nested = asRecord(value);
    for (const nestedKey of keys) {
      if (Array.isArray(nested[nestedKey])) {
        return nested[nestedKey] as unknown[];
      }
    }
  }

  return [];
}
