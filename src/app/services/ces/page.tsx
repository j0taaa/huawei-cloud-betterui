import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Activity } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { CellStack, ResourceIdentity } from "@/components/console-ui";
import { listCesAlarmRules, type CesAlarmRule, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "Cloud Eye | Huawei Cloud Better UI",
};

function alarmTone(alarm: CesAlarmRule) {
  const status = alarm.status.toLowerCase();

  if (status.includes("alarm")) {
    return "bad";
  }

  if (status.includes("ok") || status.includes("normal")) {
    return "good";
  }

  return alarm.enabled === false ? "warn" : "neutral";
}

export default async function CesPage() {
  const result = await withCloudResult<CesAlarmRule[]>([], listCesAlarmRules, cloudCacheKeys.listCesAlarmRules);
  const alarms = result.data;
  const enabled = alarms.filter((alarm) => alarm.enabled !== false).length;
  const firing = alarms.filter((alarm) => alarm.status.toLowerCase().includes("alarm")).length;
  const actionsOn = alarms.filter((alarm) => alarm.alarmActionEnabled === true).length;

  return (
    <ServiceInventoryPage
      managementService="ces"
      actionLabel="Create alarm"
      actionTitle="Alarm creation is disabled in this read-only view."
      active="Monitoring"
      backHref="/services/monitoring"
      backLabel="Back to Monitoring"
      description="Alarm rules, monitored namespaces, trigger status, notification posture, and resource coverage from Cloud Eye."
      empty="No Cloud Eye alarm rules were returned for the selected projects."
      icon={Activity}
      result={result}
      rows={alarms}
      stats={[
        { label: "Alarm rules", value: alarms.length },
        { label: "Enabled", value: enabled, tone: enabled === alarms.length ? "good" : "warn" },
        { label: "In alarm", value: firing, tone: firing ? "bad" : "good" },
        { label: "Actions on", value: actionsOn, tone: actionsOn ? "good" : "warn" },
      ]}
      tableTitle="Alarm Rule Coverage"
      title="Cloud Eye"
      tone="blue"
      columns={[
        {
          header: "Alarm",
          render: (alarm) => (
            <ResourceIdentity id={alarm.id} name={alarm.name} />
          ),
        },
        {
          header: "State",
          render: (alarm) => (
            <CellStack subValue={alarm.enabled === false ? "Disabled" : "Enabled"}>
              <InventoryStatus tone={alarmTone(alarm)}>{alarm.status}</InventoryStatus>
            </CellStack>
          ),
        },
        {
          header: "Signal",
          render: (alarm) => (
            <CellStack subValue={alarm.metricName}>{alarm.namespace}</CellStack>
          ),
        },
        { header: "Condition", render: (alarm) => alarm.condition },
        {
          header: "Notify",
          render: (alarm) => (
            <InventoryStatus tone={alarm.alarmActionEnabled ? "good" : "warn"}>
              {alarm.alarmActionEnabled ? "Actions on" : "No actions"}
            </InventoryStatus>
          ),
        },
        { header: "Resources", render: (alarm) => alarm.resourceCount },
        { header: "Project", render: (alarm) => `${alarm.projectName} · ${alarm.region}` },
      ]}
    />
  );
}
