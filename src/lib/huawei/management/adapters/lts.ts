import "server-only";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { listLtsLogGroups } from "@/lib/huawei/services/lts";
import { ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

/**
 * Bounded LTS log group and log stream management.
 * Verified against HuaweiCloud SDK python v3 LtsClient v2:
 * - POST   /v2/{project_id}/groups                                        (CreateLogGroupParams: log_group_name, ttl_in_days, log_group_name_alias)
 * - POST   /v2/{project_id}/groups/{log_group_id}                         (UpdateLogGroupParams: ttl_in_days)  [yes: the update is a POST]
 * - DELETE /v2/{project_id}/groups/{log_group_id}
 * - GET    /v2/{project_id}/groups/{log_group_id}/streams                 (single response, log_streams[])
 * - POST   /v2/{project_id}/groups/{log_group_id}/streams                 (CreateLogStreamParams: log_stream_name, ttl_in_days, log_stream_name_alias)
 * - PUT    /v2/{project_id}/groups/{log_group_id}/streams-ttl/{log_stream_id} (UpdateLogStreamParams: ttl_in_days)
 * - DELETE /v2/{project_id}/groups/{log_group_id}/streams/{log_stream_id}
 *
 * Log groups are the parent resource required by the framework; every stream operation addresses the selected
 * group and the stream is chosen through an ID field validated against a fresh upstream list per submission.
 * Stream-level retention (ttl_in_days) is only available in some regions; the SDK documents cn-east-3,
 * cn-north-4, and cn-south-1. Where it is unavailable, Huawei rejects the request and the error is surfaced.
 */

const namePattern = "^[\\p{L}\\p{N}][\\p{L}\\p{N}_-]{0,62}$";
const retentionField = { key: "ttl", label: "Retention (days)", type: "number" as const, required: true, min: 1, max: 365 };

type GroupStream = { id: string; name: string; ttlDays: string };

/** LTS returns retention as a JSON number; plain string readers silently drop it, so numbers are accepted here. */
function plain(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Streams are always read live so stream choices and revalidation never use cached data. */
async function listGroupStreams(session: BetterUiSession, groupId: string): Promise<GroupStream[]> {
  const body = await huaweiFetch<{ log_streams?: unknown[] }>(session, "lts", `/v2/${session.projectId}/groups/${encodeURIComponent(groupId)}/streams`);
  return asArray(body.log_streams).map((raw) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return {
      id: asString(item.log_stream_id, ""),
      name: asString(item.log_stream_name, ""),
      ttlDays: plain(item.ttl_in_days) || "-",
    };
  }).filter((stream) => stream.id);
}

async function findStream(session: BetterUiSession, groupId: string, streamId: string): Promise<GroupStream> {
  const stream = (await listGroupStreams(session, groupId)).find((item) => item.id === streamId);
  if (!stream) throw new ManagementInputError("The log stream was not found in this group. Refresh the form and select a current stream.", 404);
  return stream;
}

export const ltsManagement: ManagementAdapter = {
  title: "LTS Log Groups",
  operations: [
    { id: "create-group", label: "Create log group", description: "Create a log group in the selected project to organize log streams and retention.", kind: "create", fields: [
      { key: "name", label: "Group name", type: "text", required: true, max: 63, pattern: namePattern, help: "Starts with a letter or digit; letters, digits, underscores, and hyphens; up to 63 characters." },
      { key: "alias", label: "Alias", type: "text", max: 63 },
      { ...retentionField, defaultValue: 7, help: "How long LTS keeps logs in this group (1-365 days)." },
    ] },
    { id: "update-group", label: "Edit group retention", description: "Change how long LTS retains logs in the selected group. This is the only field the group update API accepts.", kind: "update", fields: [retentionField], impact: "Reducing retention can permanently remove older logs from this group." },
    { id: "delete-group", label: "Delete log group", description: "Permanently remove the group together with its log streams and stored logs.", kind: "delete", fields: [], confirmation: true, impact: "All log streams and stored log data in the group are permanently deleted." },
    { id: "list-streams", label: "View log streams", description: "Inspect the log streams that currently exist in the selected group.", kind: "inspect", fields: [] },
    { id: "create-stream", label: "Create log stream", description: "Add a log stream to the selected group for a specific application or service.", kind: "action", fields: [
      { key: "name", label: "Stream name", type: "text", required: true, max: 63, pattern: namePattern },
      { key: "alias", label: "Alias", type: "text", max: 63 },
      { key: "ttl", label: "Stream retention (days)", type: "number", min: 1, max: 365, help: "Optional per-stream retention. Only available in some regions; where it is unavailable Huawei rejects this parameter." },
    ] },
    { id: "update-stream", label: "Edit stream retention", description: "Change how long LTS retains logs in one stream of the selected group. The stream name cannot be changed after creation.", kind: "action", fields: [
      { key: "streamId", label: "Log stream", type: "select", required: true, source: "streams", help: "Validated against the group's current streams when the operation is submitted." },
      retentionField,
    ], impact: "Reducing retention can permanently remove older logs from this stream." },
    { id: "delete-stream", label: "Delete log stream", description: "Remove one log stream and its stored logs from the selected group.", kind: "action", fields: [
      { key: "streamId", label: "Log stream", type: "select", required: true, source: "streams" },
    ], confirmation: true, impact: "The log stream and its stored log data are permanently deleted." },
  ],
  inventory: async (session) => (await listLtsLogGroups(session)).map((group) => {
    const ttl = Number(group.ttlDays);
    return {
      id: group.id,
      name: group.name,
      values: { alias: group.alias, ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : "" },
    };
  }),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (!["update-stream", "delete-stream"].includes(operation) || !resource) return {};
    const streams = await listGroupStreams(session, resource.id);
    return {
      streams: streams.map((stream) => ({ value: stream.id, label: `${stream.name} (retention ${stream.ttlDays} day${stream.ttlDays === "1" ? "" : "s"})` })),
    };
  },
  execute: async (session, operation, values, resource) => {
    const group = resource!;
    if (operation === "create-group") {
      const body: Record<string, unknown> = { log_group_name: String(values.name), ttl_in_days: Number(values.ttl) };
      if (values.alias !== undefined) body.log_group_name_alias = String(values.alias);
      const response = await huaweiFetch<{ log_group_id?: unknown }>(session, "lts", `/v2/${session.projectId}/groups`, { method: "POST", body: JSON.stringify(body) });
      return { message: "Log group created.", resourceId: asString(response.log_group_id, "") || undefined };
    }
    if (operation === "update-group") {
      // The LTS update API is a POST against the group path, not a PUT.
      await huaweiFetch(session, "lts", `/v2/${session.projectId}/groups/${encodeURIComponent(group.id)}`, { method: "POST", body: JSON.stringify({ ttl_in_days: Number(values.ttl) }) });
      return { message: "Log group retention updated.", facts: [{ label: "New retention", value: `${Number(values.ttl)} days` }] };
    }
    if (operation === "delete-group") {
      await huaweiFetch(session, "lts", `/v2/${session.projectId}/groups/${encodeURIComponent(group.id)}`, { method: "DELETE" });
      return { message: "Log group deleted." };
    }
    if (operation === "list-streams") {
      const streams = await listGroupStreams(session, group.id);
      const limited = streams;
      return {
        message: `The group has ${streams.length} log stream${streams.length === 1 ? "" : "s"}.`,
        facts: limited.map((stream) => ({ label: stream.name, value: `retention ${stream.ttlDays} day${stream.ttlDays === "1" ? "" : "s"} · ${stream.id}` })),
      };
    }
    if (operation === "create-stream") {
      const body: Record<string, unknown> = { log_stream_name: String(values.name) };
      if (values.alias !== undefined) body.log_stream_name_alias = String(values.alias);
      if (values.ttl !== undefined) body.ttl_in_days = Number(values.ttl);
      const response = await huaweiFetch<{ log_stream_id?: unknown }>(session, "lts", `/v2/${session.projectId}/groups/${encodeURIComponent(group.id)}/streams`, { method: "POST", body: JSON.stringify(body) });
      return { message: "Log stream created.", resourceId: asString(response.log_stream_id, "") || undefined };
    }
    if (operation === "update-stream") {
      const stream = await findStream(session, group.id, String(values.streamId));
      await huaweiFetch(session, "lts", `/v2/${session.projectId}/groups/${encodeURIComponent(group.id)}/streams-ttl/${encodeURIComponent(stream.id)}`, { method: "PUT", body: JSON.stringify({ ttl_in_days: Number(values.ttl) }) });
      return { message: "Log stream retention updated.", resourceId: stream.id };
    }
    if (operation === "delete-stream") {
      const stream = await findStream(session, group.id, String(values.streamId));
      await huaweiFetch(session, "lts", `/v2/${session.projectId}/groups/${encodeURIComponent(group.id)}/streams/${encodeURIComponent(stream.id)}`, { method: "DELETE" });
      return { message: "Log stream deleted.", resourceId: stream.id };
    }
    throw new ManagementInputError("Unsupported operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listLtsLogGroups],
};
