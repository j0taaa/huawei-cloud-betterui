/** Partial loads must never replace a complete, successful cache entry. */
export class CloudLoadError<T = unknown> extends Error {
  constructor(
    message: string,
    readonly partialData?: T,
  ) {
    super(message);
    this.name = "CloudLoadError";
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error
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
    const partial = await transform(error.partialData as T);
    throw new CloudLoadError(error.message, partial);
  }
  return transform(data);
}
