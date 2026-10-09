import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listDedicatedHostsForProject } from "@/lib/huawei/services/deh";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";
import type { BetterUiSession } from "@/lib/auth-session";
const name = { key: "name", label: "Host name", required: true, max: 255, pattern: "^[A-Za-z0-9_.-]+$" };
const base = (s: BetterUiSession) => `/v1.0/${s.projectId}`;
async function offerings(s: BetterUiSession) {
  const response = await huaweiFetch<Record<string, unknown>>(s, "ecs", `/v2.1/${s.projectId}/os-availability-zone`);
  const zones = asArray(response.availabilityZoneInfo).map(asRecord).filter(z => asRecord(z.zoneState).available === true).map(z => String(z.zoneName));
  const types = await Promise.all(zones.map(async zone => {
    const response = await huaweiFetch<Record<string, unknown>>(s, "deh", `${base(s)}/availability-zone/${encodeURIComponent(zone)}/dedicated-host-types`);
    if (!Array.isArray(response.dedicated_host_types)) throw new Error("Invalid dedicated-host offering response.");
    return asArray(response.dedicated_host_types).map(asRecord).map(t => ({ value: JSON.stringify([zone, String(t.host_type)]), label: `${zone} · ${t.host_type_name || t.host_type}` }));
  }));
  return types.flat();
}
export const dehManagement: ManagementAdapter = {
  title: "Dedicated Host",
  operations: [
    { id: "create", label: "Order dedicated host", kind: "create", description: "Request one monthly dedicated host with automatic payment and renewal disabled. Pay the resulting order before using the host.", fields: [name, { key: "offering", label: "Availability zone and host type", type: "select", source: "offerings", required: true }, { key: "months", label: "Subscription months", type: "number", required: true, min: 1, max: 9, defaultValue: 1 }, { key: "placement", label: "Allow automatic ECS placement", type: "boolean", defaultValue: false }, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }], impact: "This creates a subscription order for an entire physical host. Review the order's price and pay it separately; automatic payment and renewal are disabled." },
    { id: "rename", label: "Rename host", kind: "update", description: "Change the host name while preserving automatic placement.", fields: [name], allowedStatuses: ["available"] },
    { id: "placement", label: "Configure automatic placement", kind: "update", description: "Control whether ECS instances can be placed here without explicitly naming this host.", fields: [{ key: "placement", label: "Allow automatic ECS placement", type: "boolean", defaultValue: false }], allowedStatuses: ["available"], impact: "Future ECS placement decisions change. Existing servers remain on this host." },
    { id: "instances", label: "View hosted servers", kind: "inspect", description: "List the host's ECS instances and available capacity.", fields: [] },
    { id: "delete", label: "Release empty host", kind: "delete", description: "Release an empty host through the native release API. Subscription cancellation may require its billing workflow.", fields: [], allowedStatuses: ["available", "fault"], confirmation: true, impact: "The dedicated physical host is released. Subscription cancellation and refunds are governed by Huawei billing." },
  ],
  inventory: async s => (await listDedicatedHostsForProject(s)).map(h => ({ id: h.id, name: h.name, status: h.status.toLowerCase(), values: { name: h.name } })),
  options: async (s, operation): Promise<Record<string, ManagementChoice[]>> => operation === "create" ? { offerings: await offerings(s) } : {},
  invalidationKeys: () => [cloudCacheKeys.listDedicatedHosts, cloudCacheKeys.listEcsInstances],
  execute: async (s, operation, v, resource) => {
    if (operation === "create") {
      const [zone, type] = JSON.parse(String(v.offering)) as string[];
      const response = await huaweiFetch<Record<string, unknown>>(s, "deh", `${base(s)}/dedicated-hosts`, { method: "POST", body: JSON.stringify({ name: v.name, availability_zone: zone, host_type: type, quantity: 1, auto_placement: v.placement ? "on" : "off", extend_param: { charging_mode: "prePaid", period_type: "month", period_num: v.months, is_auto_pay: false, is_auto_renew: false, enterprise_project_id: v.enterpriseProjectId ?? "0" } }) });
      return { message: `Dedicated host order ${response.order_id ? String(response.order_id) + " " : ""}submitted. Review and pay the order to proceed with provisioning.`, asynchronous: true, jobId: firstString([response.job_id], "") || undefined, facts: response.order_id ? [{ label: "Order ID", value: String(response.order_id) }] : undefined };
    }
    const path = `${base(s)}/dedicated-hosts/${encodeURIComponent(resource!.id)}`;
    if (operation === "instances" || operation === "delete") {
      const [detail, result] = await Promise.all([huaweiFetch<Record<string, unknown>>(s, "deh", path), huaweiList<Record<string, unknown>>(s, "deh", `${path}/servers?limit=100`, { items: ["servers"], kind: "marker", parameter: "marker", size: 100, fallbackKey: "id" })]);
      const host = asRecord(detail.dedicated_host);
      if (host.dedicated_host_id !== resource!.id || (host.project_id && host.project_id !== s.projectId)) throw new ManagementInputError("Unable to verify this host in the selected project.", 409);
      const servers = asArray(result.servers).map(asRecord);
      if (operation === "instances") return { message: `${servers.length} hosted servers loaded.`, facts: [{ label: "Automatic placement", value: asString(host.auto_placement) }, { label: "Available vCPUs", value: String(host.available_vcpus ?? "-") }, { label: "Available memory (MB)", value: String(host.available_memory ?? "-") }, ...servers.map(server => ({ label: `${server.name || server.id}`, value: `${server.id} · ${server.status}` }))] };
      if (Number(host.instance_total) !== 0 || asArray(host.instance_uuids).length || servers.length) throw new ManagementInputError("Migrate or delete every hosted ECS before releasing this host.", 409);
      await huaweiFetch(s, "deh", path, { method: "DELETE" });
      return { message: "Host release accepted. Check native host state and subscription status.", asynchronous: true };
    }
    if (!['rename', 'placement'].includes(operation)) throw new ManagementInputError("Unsupported dedicated-host operation.");
    await huaweiFetch(s, "deh", path, { method: "PUT", body: JSON.stringify({ dedicated_host: operation === "rename" ? { name: v.name } : { auto_placement: v.placement ? "on" : "off" } }) });
    return { message: "Dedicated host settings updated." };
  },
};
