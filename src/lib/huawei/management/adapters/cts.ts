import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listCtsTrackersForProject } from "@/lib/huawei/services/cts";
import { ManagementInputError } from "@/lib/management-contract";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";
export const ctsManagement: ManagementAdapter = {
  title: "Cloud Trace Service",
  operations: [
    { id: "create", label: "Create management tracker", kind: "create", description: "Enable the project's system management-event tracker. Huawei permits one system tracker per project.", fields: [{ key: "lts", label: "Log Tank event analysis", type: "boolean", defaultValue: true }, { key: "validate", label: "Trace file integrity validation", type: "boolean", defaultValue: true }], impact: "CTS records cloud account activity. Enabling LTS event analysis can incur log ingestion and storage charges." },
    { id: "update", label: "Configure management tracker", kind: "update", description: "Configure log analysis and trace-file validation for the system tracker. Existing OBS configuration is preserved.", fields: [{ key: "lts", label: "Log Tank event analysis", type: "boolean", required: true }, { key: "validate", label: "Trace file integrity validation", type: "boolean", required: true }], impact: "Changing event analysis can affect log ingestion charges and audit availability." },
    { id: "enable", label: "Enable tracker", kind: "action", description: "Start recording management events.", fields: [] },
    { id: "disable", label: "Disable tracker", kind: "action", description: "Stop recording new management events.", fields: [], confirmation: true, impact: "New operations are no longer recorded by this tracker while it is disabled." },
    { id: "delete", label: "Delete tracker", kind: "delete", description: "Remove the selected tracker configuration.", fields: [], confirmation: true, impact: "Future operations stop being collected by this tracker. Existing exported logs follow their storage retention policies." },
    { id: "traces", label: "View recent audit events", kind: "inspect", description: "Read this tracker's events from the past 24 hours. Raw request bodies and credentials are excluded.", fields: [] },
  ],
  inventory: async (session) => (await listCtsTrackersForProject(session)).map((tracker) => ({ id: tracker.id, name: tracker.name, status: tracker.status, values: { lts: tracker.isLtsEnabled === "true", validate: tracker.isSupportValidate } })),
  invalidationKeys: () => [cloudCacheKeys.listCtsTrackers],
  execute: async (session, operation, values, resource) => {
    const base = `/v3/${session.projectId}`;
    if (operation === "traces") {
      const query = new URLSearchParams({ trace_type: resource!.name === "system" ? "system" : "data", tracker_name: resource!.name, from: String(Date.now() - 86400000), to: String(Date.now()), limit: "100" });
      const result = await huaweiList<Record<string, unknown>>(session, "cts", `${base}/traces?${query}`, { items: ["traces"], kind: "marker", parameter: "next", size: 100, next: ["meta_data.marker"] });
      return { message: "Recent audit events loaded.", facts: asArray(result.traces).map((raw) => { const trace = asRecord(raw); return { label: `${firstString([trace.trace_name], "Operation")} · ${firstString([trace.service_type], "Service")}`, value: [trace.time, trace.resource_name ?? trace.resource_id, trace.trace_rating, asRecord(trace.user).name].filter((value) => value !== undefined).join(" · ") }; }) };
    }
    if (operation !== "create" && resource!.name !== "system") throw new ManagementInputError("This workflow manages the system tracker. Data-event tracker configuration requires a separate bucket selection workflow.", 409);
    if (operation === "delete") {
      await huaweiFetch(session, "cts", `${base}/trackers?${new URLSearchParams({ tracker_name: resource!.name, tracker_type: "system" })}`, { method: "DELETE" });
      return { message: "Tracker deleted." };
    }
    if (!["create", "update", "enable", "disable"].includes(operation)) throw new ManagementInputError("Unsupported CTS operation.");
    // PUT can replace optional configuration. Re-read and preserve its writable settings.
    const preserved: Record<string, unknown> = {};
    if (operation !== "create") {
      const current = await huaweiFetch<{ trackers?: unknown[] }>(session, "cts", `${base}/trackers?tracker_type=system&tracker_name=system`);
      const tracker = asArray(current.trackers).map(asRecord).find((item) => item.tracker_name === "system");
      if (!tracker) throw new ManagementInputError("The system tracker no longer exists in this project.", 404);
      for (const key of ["status", "is_organization_tracker", "management_event_selector", "is_support_trace_files_encryption", "kms_id", "is_support_validate"]) if (tracker[key] !== undefined) preserved[key] = tracker[key];
      const lts = asRecord(tracker.lts);
      if (tracker.is_lts_enabled !== undefined || lts.is_lts_enabled !== undefined) preserved.is_lts_enabled = tracker.is_lts_enabled ?? lts.is_lts_enabled;
      const obs = asRecord(tracker.obs_info);
      if (obs.bucket_name) preserved.obs_info = Object.fromEntries(["bucket_name", "file_prefix_name", "bucket_lifecycle", "compress_type", "is_sort_by_service"].filter((key) => obs[key] !== undefined).map((key) => [key, obs[key]]).concat([["is_obs_created", false]]));
    }
    const body = { ...preserved, tracker_type: "system", tracker_name: "system", ...(operation === "create" || operation === "update" ? { is_lts_enabled: values.lts ?? true, is_support_validate: values.validate ?? true } : { status: operation === "enable" ? "enabled" : "disabled" }) };
    const result = await huaweiFetch<Record<string, unknown>>(session, "cts", `${base}/tracker`, { method: operation === "create" ? "POST" : "PUT", body: JSON.stringify(body) });
    return { message: "Tracker configuration updated.", resourceId: firstString([result.id, result.tracker_name, resource?.id], "system") };
  },
};
