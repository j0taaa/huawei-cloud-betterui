import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CesAlarmRule = {
  alarmActionEnabled: boolean | null;
  alarmLevel: string;
  alarmType: string;
  condition: string;
  enabled: boolean | null;
  id: string;
  metricName: string;
  name: string;
  namespace: string;
  projectId: string;
  projectName: string;
  region: string;
  resourceCount: number;
  status: string;
};

export async function listCesAlarmRulesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{
    alarm_rules?: unknown[];
    alarms?: unknown[];
    metric_alarms?: unknown[];
  }>(session, "ces", `/v2/${session.projectId}/alarms?limit=100`, {
    items: ["alarm_rules", "alarms", "metric_alarms"],
    kind: "offset",
    parameter: "offset",
    size: 100,
    total: ["total_count", "total", "data.total", "result.total"],
  });

  return asArray(body.alarm_rules ?? body.alarms ?? body.metric_alarms).map(
    (alarm): CesAlarmRule => {
      const item = asRecord(alarm);
      const metric = asRecord(item.metric);
      const condition = asRecord(item.condition);
      const resources = asArray(
        item.resources ??
          item.resource_list ??
          item.dimensions ??
          metric.dimensions,
      );

      return {
        alarmActionEnabled:
          typeof item.alarm_action_enabled === "boolean"
            ? item.alarm_action_enabled
            : null,
        alarmLevel: String(item.alarm_level ?? item.level ?? "-"),
        alarmType: firstString([item.alarm_type, item.type], "-"),
        condition:
          [
            condition.period ? `${condition.period}s` : "",
            condition.filter,
            condition.comparison_operator,
            condition.value,
            condition.unit,
          ]
            .filter(Boolean)
            .join(" ") || "-",
        enabled:
          typeof item.alarm_enabled === "boolean"
            ? item.alarm_enabled
            : typeof item.enabled === "boolean"
              ? item.enabled
              : null,
        id: firstString([item.alarm_id, item.id]),
        metricName: firstString([metric.metric_name, item.metric_name], "-"),
        name: firstString([item.alarm_name, item.name, item.id]),
        namespace: firstString([metric.namespace, item.namespace], "-"),
        projectId: session.projectId,
        projectName: session.projectName,
        region: session.region,
        resourceCount: resources.length,
        status: firstString([item.alarm_state, item.status], "UNKNOWN"),
      };
    },
  );
}

export async function listCesAlarmRules(session: BetterUiSession) {
  return loadAcrossProjects(session, listCesAlarmRulesForProject);
}
