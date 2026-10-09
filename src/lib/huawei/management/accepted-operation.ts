import "server-only";
import { randomUUID } from "node:crypto";
import type { BetterUiSession } from "@/lib/auth-session";
import { saveManagementHistory } from "./history";

type AcceptedOperation = {
  service: string;
  operation: string;
  projectId: string;
  resourceId?: string;
  resourceName?: string;
  resultResourceId?: string;
  jobId?: string;
};

/** Called only after Huawei accepts a legacy detail action. Local failures cannot undo that write. */
export async function recordAcceptedOperation(
  session: BetterUiSession,
  receipt: AcceptedOperation,
  refresh: () => Promise<unknown>,
) {
  const id = randomUUID();
  const results = await Promise.allSettled([
    saveManagementHistory(session, {
      id,
      ...receipt,
      startedAt: new Date().toISOString(),
      state: "submitted",
      message: receipt.jobId
        ? "Huawei accepted this request. Check its cloud job for completion."
        : "Huawei accepted this request without a tracked job. Verify the resulting resource state before retrying.",
    }),
    // Keep synchronous local errors inside the settled maintenance result, too.
    Promise.resolve().then(refresh),
  ]);
  return {
    ...(results[0].status === "fulfilled" ? { operationId: id } : {}),
    ...(results.some(result => result.status === "rejected") ? {
      maintenanceWarning: "Huawei accepted this request, but local history or cache refresh failed. Reload the resource to verify its state; do not resubmit the accepted request.",
    } : {}),
  };
}
