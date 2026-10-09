import "server-only";
import { huaweiFetch } from "@/lib/huawei/http";
import { listCdnDomains } from "@/lib/huawei/services/cdn";
import { firstString, asRecord } from "@/lib/huawei/parsers";
import { ManagementInputError } from "@/lib/management-contract";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";
const domainPattern = "^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,63}$";
const sourceFields = [
  { key: "origin", label: "Origin address", required: true, max: 255, help: "An IPv4 address or host name, without a URL scheme or path." },
  { key: "originType", label: "Origin type", type: "select" as const, required: true, defaultValue: "domain", choices: [{ value: "domain", label: "Domain name" }, { value: "ipaddr", label: "IP address" }, { value: "obs_bucket", label: "OBS bucket domain" }] },
];
export const cdnManagement: ManagementAdapter = {
  title: "Content Delivery Network", accountWide: true,
  operations: [
    { id: "create", label: "Add accelerated domain", kind: "create", description: "Create a CDN domain with one primary origin. Ownership and regional requirements are enforced by Huawei.", fields: [{ key: "name", label: "Domain name", required: true, max: 253, pattern: domainPattern }, ...sourceFields,
      { key: "businessType", label: "Business type", type: "select", required: true, defaultValue: "web", choices: ["web", "download", "video"].map((value) => ({ value, label: value })) },
      { key: "serviceArea", label: "Service area", type: "select", required: true, defaultValue: "outside_mainland_china", choices: ["mainland_china", "outside_mainland_china", "global"].map((value) => ({ value, label: value.replaceAll("_", " ") })) },
      { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }], impact: "CDN traffic and requests are billed. Configure DNS delegation after reviewing domain ownership and origin availability." },
    { id: "origin", label: "Change origin", kind: "update", description: "Replace the domain's origin list with one primary origin.", fields: sourceFields, confirmation: true, impact: "The replacement origin becomes responsible for serving content after CDN propagation. Existing origins are replaced." },
    { id: "enable", label: "Enable domain", kind: "action", description: "Enable acceleration for a disabled domain.", fields: [], allowedStatuses: ["offline"], impact: "Traffic served by CDN can incur charges." },
    { id: "disable", label: "Disable domain", kind: "action", description: "Disable CDN acceleration for the domain.", fields: [], confirmation: true, allowedStatuses: ["online"], impact: "Delivery through the CDN domain stops after configuration propagation." },
    { id: "delete", label: "Delete domain", kind: "delete", description: "Remove a disabled accelerated domain.", fields: [], confirmation: true, allowedStatuses: ["offline"], impact: "The CDN configuration is permanently removed. Update DNS and application routing before deletion." },
    { id: "refresh", label: "Purge cached URLs", kind: "action", description: "Refresh file or directory content for this domain.", fields: [{ key: "type", label: "Refresh type", type: "select", required: true, defaultValue: "file", choices: [{ value: "file", label: "Files" }, { value: "directory", label: "Directories" }] }, { key: "urls", label: "URLs", type: "list", required: true, max: 1000, help: "One full HTTP or HTTPS URL per line. All URLs must belong to the selected domain." }], confirmation: true, impact: "Origin traffic can increase while CDN nodes fetch refreshed content." },
    { id: "preheat", label: "Prefetch URLs", kind: "action", description: "Load file URLs into the CDN cache before requests arrive.", fields: [{ key: "urls", label: "URLs", type: "list", required: true, max: 1000, help: "One full HTTP or HTTPS URL per line for the selected domain." }], impact: "Prefetching consumes bandwidth and can incur CDN and origin charges." },
  ],
  inventory: async (session) => {
    const project = { ...session, token: session.accountToken! };
    return (await listCdnDomains({ ...session, projects: [project] })).map((domain) => ({ id: domain.id, name: domain.domainName, status: domain.status.toLowerCase(), values: { name: domain.domainName, origin: domain.originHost } }));
  },
  invalidationKeys: () => [cloudCacheKeys.listCdnDomains],
  execute: async (session, operation, values, resource) => {
    const account = { ...session, token: session.accountToken! };
    const base = "/v1.0/cdn/domains";
    const path = `${base}/${encodeURIComponent(resource?.id ?? "")}`;
    let url = path; let method = "PUT"; let body: Record<string, unknown> | undefined;
    if (["create", "origin"].includes(operation)) {
      const origin = String(values.origin);
      if (/[\s/:?#]/.test(origin) || !origin) throw new ManagementInputError("Enter a host name or IPv4 address without a URL scheme, port, path, or whitespace.");
      if (values.originType === "ipaddr" ? !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(origin) || origin.split(".").some((part) => Number(part) > 255) : !new RegExp(domainPattern).test(origin)) throw new ManagementInputError("The origin address does not match its selected type.");
      const sources = [{ ip_or_domain: origin, origin_type: values.originType, active_standby: 1 }];
      if (operation === "create") { method = "POST"; url = base; body = { domain: { domain_name: values.name, business_type: values.businessType, service_area: values.serviceArea, enterprise_project_id: values.enterpriseProjectId ?? "0", sources } }; }
      else { url = `${path}/origin`; body = { origin: { sources } }; }
    } else if (operation === "delete") method = "DELETE";
    else if (["enable", "disable"].includes(operation)) url = `${path}/${operation}`;
    else if (["refresh", "preheat"].includes(operation)) {
      const urls = values.urls as string[];
      for (const value of urls) {
        let parsed: URL;
        try { parsed = new URL(value); } catch { throw new ManagementInputError("Enter full HTTP or HTTPS URLs."); }
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.hostname.toLowerCase() !== resource!.name.toLowerCase()) throw new ManagementInputError("Every URL must use HTTP or HTTPS and belong to the selected accelerated domain.");
      }
      method = "POST";
      url = `/v1.0/cdn/content/${operation === "refresh" ? "refresh-tasks" : "preheating-tasks"}`;
      body = operation === "refresh" ? { refresh_task: { type: values.type, urls } } : { preheating_task: { urls } };
    } else throw new ManagementInputError("Unsupported CDN operation.");
    const result = await huaweiFetch<Record<string, unknown>>(account, "cdn", url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { message: "CDN operation submitted. Configuration and cache changes can take time to propagate.", resourceId: firstString([asRecord(result.domain).id, resource?.id], "") || undefined, jobId: firstString([result.task_id, asRecord(result.refresh_task).id, asRecord(result.preheating_task).id], "") || undefined, asynchronous: true };
  },
};
