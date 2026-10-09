const cloudLoadErrorBrand = Symbol.for("betterui.CloudLoadError");

export type CloudProjectIssue = {
  projectId: string;
  projectName: string;
  region: string;
  message: string;
};

/** Partial loads must never replace a complete, successful cache entry. */
export class CloudLoadError<T = unknown> extends Error {
  readonly [cloudLoadErrorBrand] = true;

  // Next can bundle an adapter and the process-global cache in separate entries.
  // Recognize their errors across bundle/realm boundaries, not by constructor identity.
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      value !== null &&
      typeof value === "object" &&
      (value as Record<symbol, unknown>)[cloudLoadErrorBrand] === true
    );
  }

  constructor(
    message: string,
    readonly partialData?: T,
    readonly projectIssues?: CloudProjectIssue[],
  ) {
    super(message);
    this.name = "CloudLoadError";
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error || error instanceof CloudLoadError
    ? error.message
    : "Huawei Cloud API request failed.";
}

/** Keep usable partial data for display while preventing incomplete results entering the cache. */
export function settledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): T {
  if (result.status === "fulfilled") return result.value;
  return result.reason instanceof CloudLoadError &&
    result.reason.partialData !== undefined
    ? (result.reason.partialData as T)
    : fallback;
}

export function finishCloudLoad<T>(
  results: PromiseSettledResult<unknown>[],
  data: T,
  contexts?: string[],
): T {
  const errors = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          `${contexts?.[index] ? `${contexts[index]}: ` : ""}${errorMessage(result.reason)}`,
        ]
      : [],
  );
  if (errors.length) throw new CloudLoadError(errors.join("; "), data);
  return data;
}

/** Transform both complete and partial results so their public data shape stays consistent. */
export async function mapCloudLoad<T, U>(
  loader: () => Promise<T>,
  transform: (data: T) => U | Promise<U>,
): Promise<U> {
  let data: T;
  try {
    data = await loader();
  } catch (error) {
    if (!(error instanceof CloudLoadError) || error.partialData === undefined)
      throw error;
    let partial: U;
    try {
      partial = await transform(error.partialData as T);
    } catch (transformError) {
      if (transformError instanceof CloudLoadError) {
        throw new CloudLoadError(
          `${error.message}; ${transformError.message}`,
          transformError.partialData,
        );
      }
      throw transformError;
    }
    throw new CloudLoadError(error.message, partial);
  }
  return transform(data);
}

/** Combine service loads without changing the shape of usable partial data. */
export async function combineCloudLoads<
  T extends Record<string, Promise<unknown>>,
>(
  loads: T,
  fallback: { [K in keyof T]: Awaited<T[K]> },
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(loads);
  const results = await Promise.allSettled(Object.values(loads));
  const data = Object.fromEntries(
    keys.map((key, index) => [
      key,
      settledValue(results[index], fallback[key]),
    ]),
  ) as { [K in keyof T]: Awaited<T[K]> };
  return finishCloudLoad(results, data, keys);
}
