import "server-only";
import { huaweiFetch } from "@/lib/huawei/http";
import { asRecord, firstString } from "@/lib/huawei/parsers";
import { createSfsShare, createSfsAccessRule, deleteSfsShare, deleteSfsAccessRule, listSfsAccessRules, listSfsSharesForProject } from "@/lib/huawei/services/sfs";
import { listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";
const name = { key: "name", label: "File system name", required: true, max: 255 };
const description = { key: "description", label: "Description", type: "textarea" as const, max: 255, allowEmpty: true };
const size = { key: "size", label: "Capacity (GB)", type: "number" as const, required: true, min: 1, max: 512000, defaultValue: 100 };
const headers = { "X-Openstack-Manila-Api-Version": "2.9" };
export const sfsManagement: ManagementAdapter = {
  title: "SFS Capacity-Oriented File Systems",
  operations: [
    { id: "create", label: "Create NFS file system", kind: "create", description: "Create a private capacity-oriented NFS share with the region's default share type.", fields: [name, description, size, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }], impact: "File system capacity incurs storage charges. Configure VPC access before mounting clients." },
    { id: "update", label: "Edit file system", kind: "update", description: "Update the file system name and description.", fields: [name, description], allowedStatuses: ["available"] },
    { id: "expand", label: "Expand file system", kind: "action", description: "Increase capacity while preserving existing data.", fields: [size], allowedStatuses: ["available"], impact: "Additional storage increases charges. This workflow cannot shrink a file system." },
    { id: "delete", label: "Delete file system", kind: "delete", description: "Permanently delete the share and its stored data.", fields: [], allowedStatuses: ["available", "error"], confirmation: true, impact: "Every file is permanently deleted and clients lose their NFS mount." },
    { id: "access", label: "View access rules", kind: "inspect", description: "List current NFS access permissions.", fields: [] },
    { id: "grant", label: "Grant VPC access", kind: "action", description: "Authorize clients in a current VPC to mount the NFS share.", fields: [{ key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true }, { key: "level", label: "Access level", type: "select", required: true, defaultValue: "ro", choices: [{ value: "ro", label: "Read only" }, { value: "rw", label: "Read and write" }] }], allowedStatuses: ["available"], impact: "Clients in the selected VPC receive the selected NFS access permissions." },
    { id: "revoke", label: "Revoke access rule", kind: "action", description: "Remove one current access rule from this share.", fields: [{ key: "rule", label: "Access rule", type: "select", source: "rules", required: true }], confirmation: true, impact: "Clients authorized by this rule lose access to the file system." },
  ],
  inventory: async (session) => (await listSfsSharesForProject(session)).map((share) => ({ id: share.id, name: share.name, status: share.status.toLowerCase(), values: { name: share.name, description: share.description, size: share.sizeGb } })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "grant") return { vpcs: (await listVpcsForProject(session)).map((vpc) => ({ value: vpc.id, label: `${vpc.name} · ${vpc.cidr}` })) };
    if (operation === "revoke" && resource) return { rules: (await listSfsAccessRules(session, resource.id, session.projectId)).map((rule) => ({ value: rule.id, label: `${rule.accessTo} · ${rule.accessLevel}` })) };
    return {};
  },
  invalidationKeys: () => [cloudCacheKeys.listSfsShares],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      const result = await createSfsShare(session, { name: String(values.name), description: String(values.description ?? ""), sizeGb: Number(values.size), isPublic: false, enterpriseProjectId: String(values.enterpriseProjectId ?? "0"), projectId: session.projectId });
      return { message: "NFS file system creation submitted.", resourceId: firstString([asRecord(result.share).id], "") || undefined, asynchronous: true };
    }
    const path = `/v2/${session.projectId}/shares/${encodeURIComponent(resource!.id)}`;
    if (operation === "access") {
      const rules = await listSfsAccessRules(session, resource!.id, session.projectId);
      return { message: `${rules.length} access rules loaded.`, facts: rules.map((rule) => ({ label: `${rule.accessTo} · ${rule.accessLevel}`, value: `${rule.state} · ${rule.id}` })) };
    }
    if (operation === "delete") await deleteSfsShare(session, resource!.id, session.projectId);
    else if (operation === "update") await huaweiFetch(session, "sfs", path, { method: "PUT", headers, body: JSON.stringify({ share: { name: values.name, description: values.description ?? "" } }) });
    else if (operation === "expand") {
      const share = (await listSfsSharesForProject(session)).find((share) => share.id === resource!.id);
      if (!share || Number(values.size) <= share.sizeGb) throw new ManagementInputError("The new capacity must exceed the file system's current capacity.");
      await huaweiFetch(session, "sfs", `${path}/action`, { method: "POST", headers, body: JSON.stringify({ "os-extend": { new_size: values.size } }) });
    } else if (operation === "grant") await createSfsAccessRule(session, { shareId: resource!.id, accessTo: String(values.vpc), accessLevel: values.level as "ro" | "rw", projectId: session.projectId });
    else if (operation === "revoke") {
      if (!(await listSfsAccessRules(session, resource!.id, session.projectId)).some((rule) => rule.id === values.rule)) throw new ManagementInputError("The rule no longer exists on this file system.", 404);
      await deleteSfsAccessRule(session, resource!.id, String(values.rule), session.projectId);
    } else throw new ManagementInputError("Unsupported file system operation.");
    return { message: "File system operation accepted.", asynchronous: operation !== "update" };
  },
};
