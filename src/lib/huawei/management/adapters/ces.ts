import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listCesAlarmRulesForProject } from "@/lib/huawei/services/ces";
import { listSmnTopicsForProject } from "@/lib/huawei/services/smn";
import { ManagementInputError, type ManagementChoice, type ManagementField } from "@/lib/management-contract";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";
const policyFields: ManagementField[] = [
  { key: "period", label: "Evaluation period", type: "select", required: true, defaultValue: "300", choices: [1, 300, 1200, 3600, 14400, 86400].map((period) => ({ value: String(period), label: period === 1 ? "Raw data" : `${period} seconds` })) },
  { key: "filter", label: "Aggregation", type: "select", required: true, defaultValue: "average", choices: ["average", "min", "max", "sum"].map((value) => ({ value, label: value })) },
  { key: "comparison", label: "Comparison", type: "select", required: true, defaultValue: ">=", choices: [">", ">=", "<", "<=", "=", "!=", "cycle_decrease", "cycle_increase", "cycle_wave"].map((value) => ({ value, label: value })) },
  { key: "value", label: "Threshold", type: "decimal", required: true, min: -1e15, max: 1e15 },
  { key: "count", label: "Consecutive evaluations", type: "number", required: true, min: 1, max: 5, defaultValue: 1 },
  { key: "level", label: "Severity", type: "select", required: true, defaultValue: "2", choices: [{ value: "1", label: "Critical" }, { value: "2", label: "Major" }, { value: "3", label: "Minor" }, { value: "4", label: "Informational" }] },
];
async function metricChoices(session: BetterUiSession) {
  const result = await huaweiList<Record<string, unknown>>(session, "ces", `/V1.0/${session.projectId}/metrics?limit=1000`, { items: ["metrics"], kind: "marker", parameter: "start", size: 1000, next: ["meta_data.marker", "marker"] });
  return asArray(result.metrics).map(asRecord).filter((metric) => typeof metric.namespace === "string" && typeof metric.metric_name === "string" && asArray(metric.dimensions).length).map((metric) => {
    const dimensions = asArray(metric.dimensions).map(asRecord).map((dimension) => ({ name: String(dimension.name), value: String(dimension.value) }));
    return { value: JSON.stringify({ namespace: metric.namespace, metricName: metric.metric_name, dimensions, unit: firstString([metric.unit], "") }), label: `${metric.namespace} · ${metric.metric_name} · ${dimensions.map((dimension) => `${dimension.name}=${dimension.value}`).join(", ")}` };
  });
}
export const cesManagement: ManagementAdapter = {
  title: "Cloud Eye",
  operations: [
    { id: "create", label: "Create metric alarm", kind: "create", description: "Create a metric alarm for one resource using a signal currently available in this project.", fields: [{ key: "name", label: "Alarm name", required: true, max: 128, pattern: "^[A-Za-z0-9_-]{1,128}$" }, { key: "description", label: "Description", type: "textarea", max: 256 }, { key: "metric", label: "Resource metric", type: "select", source: "metrics", required: true, max: 4096 }, ...policyFields,
      { key: "topics", label: "Notification topics", type: "list", source: "topics", max: 5 }, { key: "enterpriseProjectId", label: "Enterprise project ID", defaultValue: "0", max: 64 }], impact: "This rule evaluates the selected metric and sends messages to the selected notification topics. Monitoring and notification charges may apply." },
    { id: "enable", label: "Enable alarm", kind: "action", description: "Enable evaluation for this alarm.", fields: [] },
    { id: "disable", label: "Disable alarm", kind: "action", description: "Stop evaluating this alarm.", fields: [], confirmation: true, impact: "This alarm stops detecting and notifying about threshold breaches." },
    { id: "delete", label: "Delete alarm", kind: "delete", description: "Permanently remove this alarm rule.", fields: [], confirmation: true, impact: "This rule no longer detects or reports metric changes." },
    { id: "history", label: "View alarm history", kind: "inspect", description: "Read recorded state changes for this alarm.", fields: [] },
  ],
  inventory: async (session) => (await listCesAlarmRulesForProject(session)).map((alarm) => ({ id: alarm.id, name: alarm.name, status: alarm.status })),
  options: async (session, operation): Promise<Record<string, ManagementChoice[]>> => operation === "create" ? { metrics: await metricChoices(session), topics: (await listSmnTopicsForProject(session)).map((topic) => ({ value: topic.topicUrn, label: topic.name })) } : {},
  invalidationKeys: () => [cloudCacheKeys.listCesAlarmRules],
  execute: async (session, operation, values, resource) => {
    const base = `/v2/${session.projectId}/alarms`;
    let url = base; let body: Record<string, unknown>;
    if (operation === "history") {
      const history = await huaweiList<Record<string, unknown>>(session, "ces", `/v2/${session.projectId}/alarm-histories?${new URLSearchParams({ alarm_id: resource!.id, limit: "100", offset: "0" })}`, { items: ["alarm_histories"], kind: "offset", parameter: "offset", size: 100, total: ["count"] });
      return { message: "Alarm history loaded.", facts: asArray(history.alarm_histories).map((raw) => { const item = asRecord(raw); return { label: firstString([item.update_time, item.record_id], "Alarm change"), value: firstString([item.status, item.alarm_status], "Recorded") }; }) };
    }
    if (operation === "create") {
      const metric = JSON.parse(String(values.metric)) as { namespace: string; metricName: string; dimensions: Array<{ name: string; value: string }>; unit: string };
      const topics = (values.topics ?? []) as string[];
      body = { name: values.name, description: values.description ?? "", namespace: metric.namespace, resources: [metric.dimensions], type: "MULTI_INSTANCE", policies: [{ metric_name: metric.metricName, period: Number(values.period), filter: values.filter, comparison_operator: values.comparison, value: values.value, unit: metric.unit, count: values.count, level: Number(values.level), suppress_duration: 0 }], enabled: true, notification_enabled: !!topics.length, enterprise_project_id: values.enterpriseProjectId ?? "0", ...(topics.length ? { alarm_notifications: [{ type: "notification", notification_list: topics }], ok_notifications: [{ type: "notification", notification_list: topics }], notification_begin_time: "00:00", notification_end_time: "23:59" } : {}) };
    } else if (["enable", "disable"].includes(operation)) { url += "/action"; body = { alarm_ids: [resource!.id], alarm_enabled: operation === "enable" }; }
    else if (operation === "delete") { url += "/batch-delete"; body = { alarm_ids: [resource!.id] }; }
    else throw new ManagementInputError("Unsupported Cloud Eye operation.");
    const result = await huaweiFetch<Record<string, unknown>>(session, "ces", url, { method: "POST", body: JSON.stringify(body) });
    return { message: "Cloud Eye alarm operation completed.", resourceId: firstString([result.alarm_id, asArray(result.alarm_ids)[0], resource?.id], "") || undefined };
  },
};
