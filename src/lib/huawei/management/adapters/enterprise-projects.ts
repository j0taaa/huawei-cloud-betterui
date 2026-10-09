import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listEnterpriseProjects } from "@/lib/huawei/services/enterprise-projects";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const fields = [
  { key: "name", label: "Project name", required: true, max: 255, pattern: "^(?![dD][eE][fF][aA][uU][lL][tT]$)[A-Za-z0-9_-]+$", help: "Letters, numbers, underscores, and hyphens. The reserved default name is unavailable." },
  { key: "description", label: "Description", type: "textarea" as const, max: 512 },
  { key: "type", label: "Environment", type: "select" as const, defaultValue: "prod", choices: [{ value: "prod", label: "Commercial" }, { value: "poc", label: "Test" }] },
];

export const enterpriseProjectsManagement: ManagementAdapter = {
  title: "Enterprise Project Management",
  accountWide: true,
  operations: [
    { id: "create", label: "Create enterprise project", description: "Create an account-wide group for organizing resources and costs.", kind: "create", fields },
    { id: "update", label: "Edit enterprise project", description: "Change the name, description, and environment classification.", kind: "update", fields, excludedResourceIds: ["0"] },
    { id: "enable", label: "Enable enterprise project", description: "Make a disabled project available again.", kind: "action", fields: [], allowedStatuses: ["Disabled"], excludedResourceIds: ["0"] },
    { id: "disable", label: "Disable enterprise project", description: "Disable the project while retaining its existing resources.", kind: "action", fields: [], confirmation: true, allowedStatuses: ["Enabled"], excludedResourceIds: ["0"], impact: "Resources remain in the project. New resource placement and project operations may be affected." },
    { id: "delete", label: "Delete enterprise project", description: "Permanently delete a disabled project. Huawei rejects projects that still contain resources.", kind: "delete", fields: [], confirmation: true, allowedStatuses: ["Disabled"], excludedResourceIds: ["0"], impact: "The enterprise project is permanently removed. Move its resources to another project first." },
    { id: "resources", label: "View resource summary", description: "Inspect the project's resource count and resource identifiers.", kind: "inspect", fields: [] },
  ],
  inventory: async (session) => (await listEnterpriseProjects(session)).map((item) => ({ id: item.id, name: item.name, status: item.status, values: { name: item.name, description: item.description === "-" ? "" : item.description, type: item.type === "Test" ? "poc" : "prod" } })),
  invalidationKeys: () => [cloudCacheKeys.listEnterpriseProjects],
  execute: async (session, operation, values, resource) => {
    const account = { ...session, token: session.accountToken! };
    const base = "/v1.0/enterprise-projects";
    const resourcePath = `${base}/${encodeURIComponent(resource?.id ?? "")}`;
    if (operation === "resources") {
      const body = await huaweiList<Record<string, unknown>>(account, "eps", `${resourcePath}/resources/filter`, { items: ["resources"], kind: "offset", parameter: "offset", size: 1000, total: ["total_count"], inBody: true }, { method: "POST", body: JSON.stringify({ offset: 0, limit: 1000 }) });
      return { message: "Resource summary loaded.", facts: [
        { label: "Total resources", value: String(body.total_count ?? asArray(body.resources).length) },
        ...asArray(body.resources).map((raw) => { const item = asRecord(raw); return { label: firstString([item.resource_name, item.resource_type], "Resource"), value: firstString([item.resource_id, item.id]) }; }),
      ] };
    }
    const method = operation === "create" ? "POST" : operation === "update" ? "PUT" : operation === "delete" ? "DELETE" : "POST";
    const url = operation === "create" ? base : ["enable", "disable"].includes(operation) ? `${resourcePath}/action` : resourcePath;
    const input = ["enable", "disable"].includes(operation) ? { action: operation } : values;
    const response = await huaweiFetch<Record<string, unknown>>(account, "eps", url, { method, ...(operation === "delete" ? {} : { body: JSON.stringify(input) }) });
    return { message: operation === "create" ? "Enterprise project created." : operation === "update" ? "Enterprise project updated." : operation === "delete" ? "Enterprise project deleted." : `Enterprise project ${operation}d.`, resourceId: firstString([asRecord(response.enterprise_project).id, resource?.id], "") || undefined };
  },
};
