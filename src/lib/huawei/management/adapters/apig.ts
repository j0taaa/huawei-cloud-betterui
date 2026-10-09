import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { listApigInstancesForProject } from "@/lib/huawei/services/apig";
import { listSecurityGroupsForProject, listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

// Native dedicated APIG v2 contracts. New APIs use HTTPS and IAM authentication.
const root = (s: BetterUiSession) => `/v2/${s.projectId}/apigw`;
const path = (s: BetterUiSession, resource: ManagementResource) => `${root(s)}/instances/${encodeURIComponent(resource.id)}`;
const name: ManagementField = { key: "name", label: "Name", required: true, min: 3, max: 64, pattern: "^[\\p{L}][\\p{L}\\p{N}_-]+$" };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 255, allowEmpty: true, pattern: "^[^<>]*$" };
const group: ManagementField = { key: "group", label: "API group", type: "select", source: "groups", required: true };
const api: ManagementField = { key: "api", label: "API", type: "select", source: "apis", required: true };
const environment: ManagementField = { key: "environment", label: "Environment", type: "select", source: "environments", required: true };
const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].map(value => ({ value, label: value }));
async function instance(s: BetterUiSession, resource: ManagementResource) {
  if (!(await listApigInstancesForProject(s)).some(item => item.id === resource.id)) throw new ManagementInputError("The gateway is no longer in this project.", 404);
  const current = await huaweiFetch<Record<string, unknown>>(s, "apig", path(s, resource));
  if (current.id !== resource.id || current.project_id !== s.projectId) throw new ManagementInputError("The gateway's project scope could not be verified.", 404);
  return current;
}
async function rows(s: BetterUiSession, resource: ManagementResource, kind: "api-groups" | "apis" | "envs") {
  const key = kind === "api-groups" ? "groups" : kind;
  const response = await huaweiList<Record<string, unknown>>(s, "apig", `${path(s, resource)}/${kind}?limit=100&offset=0`, { items: [key], kind: "offset", parameter: "offset", size: 100, total: ["total"] });
  return asArray(response[key]).map(asRecord).filter(item => typeof item.id === "string" && !!item.id);
}
async function owned(s: BetterUiSession, resource: ManagementResource, kind: "api-groups" | "apis" | "envs", id: string) {
  const item = (await rows(s, resource, kind)).find(item => item.id === id);
  if (!item) throw new ManagementInputError("The selected child resource no longer belongs to this gateway.", 404);
  return item;
}
async function offers(s: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(s, "apig", `${root(s)}/available-zones`);
  return asArray(body.available_zones).map(asRecord).flatMap(zone => Object.entries(asRecord(zone.specs)).filter(([spec, available]) => available === true && ["BASIC", "PROFESSIONAL", "ENTERPRISE", "PLATINUM"].includes(spec)).map(([spec]) => ({ value: JSON.stringify({ zone: zone.id, spec }), label: `${spec} · ${zone.name ?? zone.code ?? zone.id}` }))).filter(offer => JSON.parse(offer.value).zone);
}
const facts = (item: Record<string, unknown>, keys: string[]) => keys.map(key => ({ label: key.replaceAll("_", " "), value: typeof item[key] === "number" || typeof item[key] === "string" ? String(item[key]) : "-" }));

export const apigManagement: ManagementAdapter = {
  title: "API Gateway Instances, APIs and Environments",
  operations: [
    { id: "create", label: "Create pay-per-use gateway", kind: "create", description: "Provision a dedicated gateway using a live available specification and zone, a project VPC/subnet, and security group. No existing public inbound EIP is bound.", fields: [name, description, { key: "offer", label: "Specification and availability zone", type: "select", source: "offers", required: true }, { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true }, { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true }, { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true }, { key: "bandwidth", label: "Outbound public bandwidth (Mbit/s)", type: "number", required: true, min: 1, max: 2000, defaultValue: 5 }, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }], impact: "Gateway, load balancer, network resources, and configured outbound bandwidth can incur recurring charges. Confirm the specification, zone, network, and bandwidth before provisioning." },
    { id: "update", label: "Edit gateway metadata", kind: "update", description: "Rename the gateway or edit its description, preserving maintenance, network, and security settings.", fields: [name, description] },
    { id: "inspect", label: "View gateway configuration", kind: "inspect", description: "Inspect project, billing, network, maintenance, and capacity settings.", fields: [] },
    { id: "progress", label: "Check provisioning progress", kind: "inspect", description: "Query Huawei's current gateway provisioning progress and status.", fields: [] },
    { id: "delete", label: "Delete empty pay-per-use gateway", kind: "delete", description: "Delete a pay-per-use gateway only when no APIs remain and billing has no operation locks.", fields: [], confirmation: true, impact: "The dedicated gateway and its configuration are permanently removed. Dependent integrations and endpoints stop working." },
    { id: "resources", label: "View groups, APIs and environments", kind: "inspect", description: "List current API groups, API definitions, and deployment environments.", fields: [] },
    { id: "create-group", label: "Create API group", kind: "action", description: "Create a global V1 API group in this gateway.", fields: [name, description] },
    { id: "edit-group", label: "Edit API group", kind: "action", description: "Rename a current V1 API group or edit its description, preserving unrelated group configuration.", fields: [group, name, description] },
    { id: "delete-group", label: "Delete empty API group", kind: "action", description: "Delete a current API group only after all of its APIs are removed.", fields: [group], confirmation: true, impact: "The selected API group and its associated domain configuration are permanently removed." },
    { id: "create-environment", label: "Create environment", kind: "action", description: "Create an API deployment environment.", fields: [{ ...name, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_]*$" }, description] },
    { id: "edit-environment", label: "Edit environment", kind: "action", description: "Rename a current environment or change its description. The built-in RELEASE environment is protected.", fields: [environment, { ...name, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_]*$" }, description] },
    { id: "delete-environment", label: "Delete unused environment", kind: "action", description: "Delete a non-RELEASE environment only when no APIs are published into it.", fields: [environment], confirmation: true, impact: "The environment and its environment-specific configuration are permanently removed." },
    { id: "create-api", label: "Create HTTPS API", kind: "action", description: "Create an unpublished API with IAM authentication and a fixed mock response or HTTPS backend. Publish it into an environment separately.", fields: [name, description, group, { key: "method", label: "HTTP method", type: "select", required: true, defaultValue: "GET", choices: methods }, { key: "uri", label: "Request path", required: true, max: 512, pattern: "^/[^\\s?#]*$", help: "A fixed path, for example /orders. Parameter mappings are configured separately." }, { key: "backend", label: "Backend type", type: "select", required: true, defaultValue: "MOCK", choices: [{ value: "MOCK", label: "Fixed response" }, { value: "HTTP", label: "HTTPS backend" }] }, { key: "response", label: "Fixed response", type: "textarea", maxBytes: 16384, allowEmpty: true, defaultValue: "{}" }, { key: "backendUrl", label: "HTTPS backend URL", max: 768, help: "Required for HTTPS backends. Fixed paths without credentials, query strings, or fragments." }, { key: "timeout", label: "Backend timeout (milliseconds)", type: "number", min: 1, max: 60000, defaultValue: 5000 }] },
    { id: "inspect-api", label: "View API configuration", kind: "inspect", description: "Inspect a current API's request, authentication, backend, and publication settings.", fields: [api] },
    { id: "publish", label: "Publish API", kind: "action", description: "Publish the current API definition into a current environment. This can replace an existing published version.", fields: [api, environment, description], confirmation: true, impact: "The API becomes callable in the selected environment. Replacing a published version can change active client behavior and incur request/backend charges." },
    { id: "offline", label: "Take API offline", kind: "action", description: "Remove a current API's publication from the selected environment.", fields: [api, environment], confirmation: true, impact: "Clients invoking this API in the selected environment lose access immediately." },
    { id: "delete-api", label: "Delete API definition", kind: "action", description: "Delete an unpublished API definition. Take it offline from every environment first.", fields: [api], confirmation: true, impact: "The selected API definition and its configuration are permanently removed." },
  ],
  inventory: async s => (await listApigInstancesForProject(s)).map(item => ({ id: item.id, name: item.name, status: item.status, values: { name: item.name } })),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [available, vpcs, subnets, securityGroups] = await Promise.all([offers(s), listVpcsForProject(s), listSubnetsForProject(s), listSecurityGroupsForProject(s)]);
      return { offers: available, vpcs: vpcs.map(item => ({ value: item.id, label: item.name })), subnets: subnets.filter(item => item.neutronNetworkId !== "-" && item.neutronNetworkId).map(item => ({ value: item.id, label: `${item.name} · ${item.cidr} · VPC ${item.vpcId}` })), securityGroups: securityGroups.map(item => ({ value: item.id, label: item.name })) };
    }
    if (!resource) return {};
    if (operation === "update") { const current = await instance(s, resource); resource.values = { ...resource.values, description: asString(current.description, "") }; }
    const choices: Record<string, ManagementChoice[]> = {};
    if (["create-api", "edit-group", "delete-group"].includes(operation)) choices.groups = (await rows(s, resource, "api-groups")).map(item => ({ value: String(item.id), label: String(item.name) }));
    if (["inspect-api", "publish", "offline", "delete-api"].includes(operation)) choices.apis = (await rows(s, resource, "apis")).map(item => ({ value: String(item.id), label: `${item.name} · ${item.req_method} ${item.req_uri}` }));
    if (["edit-environment", "delete-environment", "publish", "offline"].includes(operation)) choices.environments = (await rows(s, resource, "envs")).filter(item => ["publish", "offline"].includes(operation) || item.name !== "RELEASE").map(item => ({ value: String(item.id), label: String(item.name) }));
    return choices;
  },
  execute: async (s, operation, v, resource) => {
    const write = (target: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "apig", target, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (operation === "create") {
      const [available, vpcs, subnets, groups] = await Promise.all([offers(s), listVpcsForProject(s), listSubnetsForProject(s), listSecurityGroupsForProject(s)]);
      if (!available.some(offer => offer.value === v.offer)) throw new ManagementInputError("The selected specification and zone are no longer available.");
      const offer = JSON.parse(String(v.offer)) as { zone: string; spec: string }; const subnet = subnets.find(item => item.id === v.subnet && item.vpcId === v.vpc);
      if (!subnet?.neutronNetworkId || subnet.neutronNetworkId === "-" || !vpcs.some(item => item.id === v.vpc) || !groups.some(item => item.id === v.securityGroup)) throw new ManagementInputError("Choose a current VPC, its subnet, and a security group from this project.");
      const result = await write(`${root(s)}/instances`, "POST", { instance_name: v.name, description: v.description ?? "", spec_id: offer.spec, available_zone_ids: [offer.zone], vpc_id: v.vpc, subnet_id: subnet.neutronNetworkId, security_group_id: v.securityGroup, enterprise_project_id: v.enterpriseProjectId ?? "0", bandwidth_size: v.bandwidth, bandwidth_charging_mode: "bandwidth", ipv6_enable: false });
      if (!result.instance_id) throw new Error("Huawei returned no gateway ID; verify provisioning before retrying.");
      return { message: "Pay-per-use gateway provisioning accepted. Check provisioning progress before publishing APIs.", resourceId: String(result.instance_id), jobId: asString(result.job_id, "") || undefined, asynchronous: true };
    }
    if (!resource) throw new ManagementInputError("Select a current gateway."); const current = await instance(s, resource); const target = path(s, resource);
    if (operation === "inspect") return { message: "Current gateway configuration.", facts: facts(current, ["instance_name", "description", "status", "project_id", "spec", "charging_mode", "vpc_id", "subnet_id", "security_group_id", "ingress_ip", "nat_eip_address", "bandwidth_size", "maintain_begin", "maintain_end"]) };
    if (operation === "progress") { const progress = await huaweiFetch<Record<string, unknown>>(s, "apig", `${target}/progress`); return { message: "Huawei gateway provisioning progress.", facts: facts(progress, ["progress", "status", "error_code", "start_time", "end_time"]) }; }
    if (operation === "update") { await write(target, "PUT", { instance_name: v.name, description: v.description ?? "" }); return { message: "Gateway metadata updated." }; }
    if (operation === "delete") {
      if (current.charging_mode !== 0 || asArray(current.cbc_operation_locks).length || current.is_releasable === false) throw new ManagementInputError("Only releasable pay-per-use gateways without billing locks can be deleted here.");
      if ((await rows(s, resource, "apis")).length) throw new ManagementInputError("Take APIs offline and delete their definitions before deleting this gateway.");
      await write(target, "DELETE"); return { message: "Gateway deletion accepted.", asynchronous: true };
    }
    if (current.status !== "Running") throw new ManagementInputError("API resources can be managed only when the gateway is Running.");
    if (operation === "resources") {
      const kinds = ["api-groups", "apis", "envs"] as const; const groups = await Promise.all(kinds.map(kind => rows(s, resource, kind)));
      return { message: "Current groups, API definitions and environments.", facts: kinds.flatMap((kind, index) => groups[index].map(item => ({ label: `${kind} · ${item.name}`, value: `${item.id}${kind === "apis" ? ` · ${item.req_method} ${item.req_uri} · ${item.auth_type}` : ""}` }))) };
    }
    if (operation === "create-group" || operation === "create-environment") {
      const result = await write(`${target}/${operation === "create-group" ? "api-groups" : "envs"}`, "POST", { name: v.name, remark: v.description ?? "", ...(operation === "create-group" ? { version: "V1" } : {}) });
      if (!result.id) throw new Error("Huawei returned no child resource ID."); return { message: operation === "create-group" ? "API group created." : "Environment created.", resourceId: String(result.id) };
    }
    if (["edit-group", "delete-group", "edit-environment", "delete-environment"].includes(operation)) {
      const isGroup = operation.endsWith("group"); const kind = isGroup ? "api-groups" : "envs"; const id = String(isGroup ? v.group : v.environment); const child = await owned(s, resource, kind, id);
      if (!isGroup && child.name === "RELEASE") throw new ManagementInputError("The built-in RELEASE environment is protected.");
      if (isGroup && child.version && child.version !== "V1") throw new ManagementInputError("Use the application workflow to manage V2 API groups.");
      if (operation.startsWith("delete")) {
        if (isGroup && (await rows(s, resource, "apis")).some(api => api.group_id === id)) throw new ManagementInputError("Delete every API in this group first.");
        if (!isGroup) {
          const published = await huaweiList<Record<string, unknown>>(s, "apig", `${target}/apis?env_id=${encodeURIComponent(id)}&limit=100&offset=0`, { items: ["apis"], kind: "offset", parameter: "offset", size: 100, total: ["total"] });
          if (asArray(published.apis).length) throw new ManagementInputError("Take every API offline from this environment first.");
        }
        await write(`${target}/${kind}/${encodeURIComponent(id)}`, "DELETE"); return { message: isGroup ? "Empty API group deleted." : "Unused environment deleted." };
      }
      await write(`${target}/${kind}/${encodeURIComponent(id)}`, "PUT", { name: v.name, remark: v.description ?? "", ...(isGroup ? { version: "V1" } : {}) }); return { message: isGroup ? "API group updated." : "Environment updated." };
    }
    if (operation === "create-api") {
      await owned(s, resource, "api-groups", String(v.group)); const payload: Record<string, unknown> = { name: v.name, remark: v.description ?? "", group_id: v.group, type: 1, req_protocol: "HTTPS", req_method: v.method, req_uri: v.uri, auth_type: "IAM", cors: false, match_mode: "NORMAL", backend_type: v.backend };
      if (v.backend === "MOCK") payload.mock_info = { result_content: v.response ?? "{}" };
      else if (v.backend === "HTTP") {
        let backend: URL; try { backend = new URL(String(v.backendUrl)); } catch { throw new ManagementInputError("Enter an absolute HTTPS backend URL."); }
        if (backend.protocol !== "https:" || backend.username || backend.password || backend.search || backend.hash || backend.host.length > 255 || backend.pathname.length > 512) throw new ManagementInputError("Use an HTTPS backend with a fixed path and no credentials, query, or fragment.");
        payload.backend_api = { url_domain: backend.host, req_protocol: "HTTPS", req_method: v.method, req_uri: backend.pathname, timeout: v.timeout ?? 5000, vpc_channel_status: 2, retry_count: "0" };
      } else throw new ManagementInputError("Choose a supported backend type.");
      const result = await write(`${target}/apis`, "POST", payload); if (!result.id) throw new Error("Huawei returned no API ID."); return { message: "HTTPS API definition created with IAM authentication. Publish it into an environment separately.", resourceId: String(result.id) };
    }
    if (["inspect-api", "delete-api", "publish", "offline"].includes(operation)) {
      const id = String(v.api); await owned(s, resource, "apis", id);
      if (["publish", "offline"].includes(operation)) { await owned(s, resource, "envs", String(v.environment)); await write(`${target}/apis/action`, "POST", { api_id: id, env_id: v.environment, action: operation === "publish" ? "online" : "offline", remark: v.description ?? "" }); return { message: operation === "publish" ? "API published into the selected environment." : "API taken offline from the selected environment." }; }
      const detail = await huaweiFetch<Record<string, unknown>>(s, "apig", `${target}/apis/${encodeURIComponent(id)}`); if (detail.id !== id) throw new ManagementInputError("The API could not be verified.");
      if (operation === "inspect-api") return { message: "Current API configuration.", facts: facts(detail, ["name", "remark", "group_id", "type", "req_protocol", "req_method", "req_uri", "auth_type", "backend_type", "run_env_name", "run_env_id"]) };
      // Huawei refuses deletion while publication records remain; check native records first.
      const records = await huaweiList<Record<string, unknown>>(s, "apig", `${target}/apis/publish/${encodeURIComponent(id)}?limit=100&offset=0`, { items: ["api_versions"], kind: "offset", parameter: "offset", size: 100, total: ["total"] });
      if (asArray(records.api_versions).map(asRecord).some(version => version.status !== 2)) throw new ManagementInputError("Take this API offline from every environment before deleting it. Publication states must be verified as inactive.");
      await write(`${target}/apis/${encodeURIComponent(id)}`, "DELETE"); return { message: "Unpublished API definition deleted." };
    }
    throw new ManagementInputError("Unsupported API Gateway operation.");
  },
  poll: async (s, entry) => {
    if (entry.operation !== "Create pay-per-use gateway" || !entry.resourceId) throw new ManagementInputError("Only gateway provisioning requests support this progress check.");
    const item = await instance(s, { id: entry.resourceId, name: entry.resourceName ?? entry.resourceId });
    const progress = await huaweiFetch<Record<string, unknown>>(s, "apig", `${root(s)}/instances/${encodeURIComponent(String(item.id))}/progress`);
    if (progress.status === "success") return { state: "succeeded", message: "Gateway provisioning completed." };
    if (["failed", "error"].includes(String(progress.status))) return { state: "failed", message: `Gateway provisioning failed (${asString(progress.error_code, "unknown")}). Inspect its cloud state before retrying.` };
    return { state: "submitted", message: `Gateway provisioning is ${asString(progress.status, "in progress")} (${progress.progress ?? "-"}%).` };
  },
  invalidationKeys: () => [cloudCacheKeys.listApigInstances],
};
