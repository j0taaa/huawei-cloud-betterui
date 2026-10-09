import { CloudLoadError, errorMessage } from "@/lib/huawei/errors";

/** Group the same project failure across services without hiding distinct failures. */
export function summaryErrors(
  results: PromiseSettledResult<unknown>[],
  services: string[],
): string[] {
  const groups = new Map<
    string,
    { location: string; message: string; services: Set<string> }
  >();
  results.forEach((result, index) => {
    if (result.status !== "rejected") return;
    const issues =
      result.reason instanceof CloudLoadError
        ? result.reason.projectIssues
        : undefined;
    const failures = issues?.length
      ? issues.map((issue) => ({
          key: JSON.stringify([issue.projectId, issue.region, issue.message]),
          location:
            issue.projectName === issue.region
              ? issue.region
              : `${issue.projectName} (${issue.region})`,
          message: issue.message,
        }))
      : [
          {
            key: JSON.stringify([null, errorMessage(result.reason)]),
            location: "",
            message: errorMessage(result.reason),
          },
        ];
    for (const failure of failures) {
      const group = groups.get(failure.key) ?? {
        ...failure,
        services: new Set<string>(),
      };
      group.services.add(services[index]);
      groups.set(failure.key, group);
    }
  });
  return Array.from(
    groups.values(),
    (group) =>
      `${group.location ? `${group.location} — ` : ""}${Array.from(group.services).join(", ")}: ${group.message}`,
  );
}
