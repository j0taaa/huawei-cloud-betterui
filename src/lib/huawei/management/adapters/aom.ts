import "server-only";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listAomPrometheusInstances } from "@/lib/huawei/services/aom";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const nameField = { key: "name", label: "Instance name", required: true, max: 100, pattern: "^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}_-]{0,98}[\\p{L}\\p{N}])?$" };
export const aomManagement: ManagementAdapter = {
  title: "AOM Prometheus",
  operations: [
    { id: "create", label: "Create Prometheus instance", description: "Create a monitoring instance in the selected project.", kind: "create", fields: [nameField,
      { key: "type", label: "Monitoring source", type: "select", required: true, defaultValue: "REMOTE_WRITE", choices: [
        { value: "ECS", label: "Elastic Cloud Server" }, { value: "CCE", label: "Cloud Container Engine" },
        { value: "REMOTE_WRITE", label: "Remote write" }, { value: "CLOUD_SERVICE", label: "Cloud services" },
      ] },
      { key: "enterpriseProjectId", label: "Enterprise project ID", defaultValue: "0", max: 64 },
    ], impact: "Monitoring ingestion and storage can incur charges according to the selected project's AOM pricing." },
    { id: "update", label: "Edit name and retention", description: "Rename the instance and configure how long metrics are retained.", kind: "update", fields: [nameField,
      { key: "retention", label: "Metric retention", type: "select", required: true, defaultValue: "30", choices: ["15", "30", "60", "90"].map((value) => ({ value, label: `${value} days` })) },
    ], allowedStatuses: ["NORMAL"], impact: "Reducing retention can permanently remove older metric data." },
    { id: "delete", label: "Delete Prometheus instance", description: "Delete this hosted monitoring instance.", kind: "delete", fields: [], confirmation: true, allowedStatuses: ["NORMAL"], impact: "The monitoring instance and its stored metric data are removed." },
  ],
  inventory: async (session) => (await listAomPrometheusInstances(session)).map((item) => ({ id: item.id, name: item.name, status: item.status, values: { name: item.name, retention: item.retention, enterpriseProjectId: item.enterpriseProjectId } })),
  invalidationKeys: () => [cloudCacheKeys.listAomPrometheusInstances],
  execute: async (session, operation, values, resource) => {
    const base = `/v1/${session.projectId}/aom/prometheus`;
    if (operation === "create") {
      const body = await huaweiFetch<Record<string, unknown>>(session, "aom", base, { method: "POST", headers: { region: session.region }, body: JSON.stringify({ prom_name: values.name, prom_type: values.type, enterprise_project_id: values.enterpriseProjectId ?? "0", project_id: session.projectId }) });
      return { message: "Prometheus instance creation submitted.", resourceId: firstString([asRecord(asArray(body.prometheus)[0]).prom_id], "") || undefined, asynchronous: true };
    }
    const enterpriseProjectId = String(resource?.values?.enterpriseProjectId ?? "0");
    if (operation === "delete") {
      const query = new URLSearchParams({ prom_id: resource!.id });
      await huaweiFetch(session, "aom", `${base}?${query}`, { method: "DELETE", headers: { "Enterprise-Project-Id": enterpriseProjectId } });
      return { message: "Prometheus instance deletion submitted.", asynchronous: true };
    }
    await huaweiFetch(session, "aom", base, { method: "PUT", headers: { "Enterprise-Project-Id": enterpriseProjectId }, body: JSON.stringify({ prom_id: resource!.id, prom_name: values.name, prom_limits: { compactor_blocks_retention_period: values.retention } }) });
    return { message: "Prometheus instance configuration updated." };
  },
};
