import "server-only";

export function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function firstString(values: unknown[], fallback = "-") {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return fallback;
}

export function numberWithUnit(value: unknown, unit: string) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? `${number} ${unit}` : "-";
}

export function formatBytes(value: unknown) {
  const bytes = Number(value ?? 0);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const amount = bytes / 1024 ** exponent;

  return `${amount.toFixed(amount >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function xmlDecode(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function xmlTag(source: string, tag: string, fallback = "") {
  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1] ? xmlDecode(match[1]) : fallback;
}

export function xmlBlocks(source: string, tag: string) {
  return Array.from(
    source.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g")),
  ).map((match) => match[1] ?? "");
}

export function firstIp(addresses: unknown, kind: "private" | "public") {
  const pools = Object.values(asRecord(addresses));

  for (const pool of pools) {
    for (const address of asArray(pool)) {
      const item = asRecord(address);
      const osType = item["OS-EXT-IPS:type"];
      const ip = item.addr;

      if (
        typeof ip === "string" &&
        ((kind === "private" && osType === "fixed") ||
          (kind === "public" && osType === "floating"))
      ) {
        return ip;
      }
    }
  }

  return "-";
}

export function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Huawei Cloud API request failed.";
}

export function timestampSeconds(value: unknown) {
  const seconds = Number(value);

  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : firstString([value], "-");
}

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
