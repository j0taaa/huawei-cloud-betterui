import { createHash } from "node:crypto";

export type Pagination = {
  items: string[];
  kind: "offset" | "page" | "marker";
  parameter: string;
  size: number;
  first?: number;
  next?: string[];
  fallbackKey?: string;
  total?: string[];
  inBody?: boolean;
  hasMore?: string;
};

export function valueAt(value: unknown, field: string): unknown {
  return field
    .split(".")
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined,
      value,
    );
}

function setAt(
  value: Record<string, unknown>,
  field: string,
  items: unknown[],
) {
  const parts = field.split(".");
  let target = value;
  for (const part of parts.slice(0, -1)) {
    target[part] = { ...(target[part] as Record<string, unknown>) };
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = items;
}

/** Collect an explicitly configured API list without silently accepting truncated results. */
export async function collectList<T>(
  load: (cursor: string | number | undefined) => Promise<T>,
  pagination: Pagination,
): Promise<T> {
  let cursor: string | number | undefined =
    pagination.kind === "marker" ? undefined : (pagination.first ?? 0);
  let firstBody: Record<string, unknown> | undefined;
  let itemsPath = "";
  const items: unknown[] = [];
  const seen = new Set<string>();
  const seenPages = new Set<string>();

  for (let page = 0; page < 1000; page++) {
    const body = await load(cursor);
    const field = pagination.items.find((candidate) =>
      Array.isArray(valueAt(body, candidate)),
    );
    if (!field)
      throw new Error(
        `Invalid list response: expected ${pagination.items.join(" or ")}.`,
      );
    const rows = valueAt(body, field) as unknown[];
    if (!firstBody) {
      firstBody = { ...(body as Record<string, unknown>) };
      itemsPath = field;
    }
    if (rows.length) {
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(rows))
        .digest("hex");
      if (seenPages.has(fingerprint))
        throw new Error("API repeated a page; inventory may be incomplete.");
      seenPages.add(fingerprint);
    }
    items.push(...rows);
    const hasMore = pagination.hasMore
      ? valueAt(body, pagination.hasMore)
      : undefined;
    const total = pagination.total
      ?.map((key) => valueAt(body, key))
      .find((value) => typeof value === "number");
    if (typeof total === "number" && items.length < total && !rows.length)
      throw new Error(
        "API ended pagination before its reported total; inventory may be incomplete.",
      );
    let next: string | number | undefined;
    if (pagination.kind === "marker") {
      const reported = pagination.next
        ?.map((key) => valueAt(body, key))
        .find((value) => value !== undefined);
      if (typeof reported === "string" || typeof reported === "number")
        next = reported || undefined;
      else if (
        reported === undefined &&
        rows.length >= pagination.size &&
        pagination.fallbackKey
      ) {
        const last = valueAt(rows.at(-1), pagination.fallbackKey);
        if (typeof last === "string" || typeof last === "number") next = last;
      }
    } else if (
      rows.length &&
      (typeof total === "number"
        ? items.length < total
        : rows.length >= pagination.size)
    ) {
      next = Number(cursor) + (pagination.kind === "page" ? 1 : rows.length);
    }
    if (hasMore === true && (next === undefined || !rows.length))
      throw new Error(
        "API reported more results without a usable pagination cursor.",
      );
    if (
      hasMore === false ||
      next === undefined ||
      !rows.length ||
      (typeof total === "number" && items.length >= total)
    ) {
      setAt(firstBody, itemsPath, items);
      return firstBody as T;
    }
    if (String(next) === String(cursor) || seen.has(String(next)))
      throw new Error(
        "API repeated its pagination cursor; inventory may be incomplete.",
      );
    seen.add(String(next));
    cursor = next;
  }
  throw new Error(
    "Inventory exceeded 1000 pages; narrow the API query before retrying.",
  );
}
