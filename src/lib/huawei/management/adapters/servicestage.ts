import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { huaweiFetch as nativeFetch, huaweiList as nativeList, HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listCceClustersForProject } from "@/lib/huawei/services/cce";
import { listElbsForProject } from "@/lib/huawei/services/elb";
import { listVpcsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { listSwrRepositoriesForProject, listSwrTagsForProject } from "@/lib/huawei/services/swr";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

// Native private errors may contain image credentials or deployment configuration.
async function safeResponse<T>(request: Promise<T>) {
  try {
    const result = await request;
    const body = asRecord(result);
    if (body.error_code || body.error_msg || body.error) throw new ManagementInputError("Huawei rejected this ServiceStage request. Check current native state before retrying.", 409);
    return result;
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected this ServiceStage request (HTTP ${error.status}). Check current state in the native console.`, error.status);
    throw error;
  }
}
async function huaweiFetch<T = unknown>(...args: Parameters<typeof nativeFetch>) { return safeResponse(nativeFetch<T>(...args)); }
async function huaweiList<T>(...args: Parameters<typeof nativeList>) { return safeResponse(nativeList<T>(...args)); }
function verifiedRows(body: Record<string, unknown>, collection: string, session: BetterUiSession) {
  if (!Array.isArray(body[collection])) throw new ManagementInputError("Huawei returned an incomplete ServiceStage inventory.", 409);
  const rows = asArray(body[collection]).map(asRecord);
  const ids = rows.map(row => firstString([row.id], ""));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || rows.some(row => row.project_id && row.project_id !== session.projectId)) throw new ManagementInputError("Huawei returned an unverified ServiceStage inventory.", 409);
  return rows;
}
async function listServiceStageApplicationsForProject(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "servicestage", `${base(session)}/applications?limit=100`, { items: ["applications"], kind: "offset", parameter: "offset", size: 100, total: ["count", "total"] });
  return verifiedRows(body, "applications", session).map(row => ({ id: firstString([row.id], ""), name: firstString([row.name, row.id], ""), description: asString(row.description, ""), componentCount: Number(row.component_count), enterpriseProjectId: firstString([row.enterprise_project_id], ""), creator: firstString([row.creator], "") }));
}
function imageReference(value: unknown) {
  const image = asString(value, "");
  return /^[a-zA-Z0-9.-]+(?::[0-9]+)?\/[A-Za-z0-9._/-]+(?::[A-Za-z0-9_.-]+|@sha256:[a-fA-F0-9]+)?$/.test(image) ? image : "Image address omitted";
}

// Native ServiceStage v3 contracts only: /v3/{project_id}/cas applications, environments, components, jobs, and runtime stacks.
const base = (s: BetterUiSession) => `/v3/${s.projectId}/cas`;

type EnvironmentRow = { id: string; name: string; description: string; enterpriseProjectId: string; vpcId: string; deployMode: string; labels: Array<Record<string, unknown>> };
type ComponentRow = { id: string; applicationId: string; applicationName: string; environmentId: string; environmentName: string; name: string; version: string; status: string; replica: number; availableReplica: number; runtimeStack: Record<string, unknown>; source: Record<string, unknown> };
type RuntimeStackRow = { name: string; type: string; version: string; deployMode: string; status: string };
type ResourceRow = { id: string; name: string; type: string; alias?: string; parameters?: Record<string, unknown> };
type RecordRow = { version: string; status: string; deployType: string; currentUsed: boolean; beginTime: string; endTime: string };

const nameField: ManagementField = { key: "name", label: "Name", required: true, min: 2, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{1,63}$", help: "2-64 characters starting with a letter; letters, digits, hyphens, and underscores." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 128, allowEmpty: true, help: "Leave empty to clear the description." };
const enterpriseProjectField: ManagementField = { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" };
const versionField: ManagementField = { key: "version", label: "Component version", required: true, max: 64, pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$", help: "Semantic version such as 1.0.0." };

async function environmentRows(session: BetterUiSession): Promise<EnvironmentRow[]> {
  const body = await huaweiList<Record<string, unknown>>(session, "servicestage", `${base(session)}/environments?limit=100`, { items: ["environments"], kind: "offset", parameter: "offset", size: 100, total: ["count", "total"] });
  return verifiedRows(body, "environments", session).map((row) => ({
    id: firstString([row.id], ""),
    name: firstString([row.name, row.id], ""),
    description: asString(row.description, ""),
    enterpriseProjectId: firstString([row.enterprise_project_id], ""),
    vpcId: firstString([row.vpc_id], ""),
    deployMode: firstString([row.deploy_mode], ""),
    labels: asArray(row.labels).map(asRecord),
  }));
}

async function componentRows(session: BetterUiSession): Promise<ComponentRow[]> {
  const body = await huaweiList<Record<string, unknown>>(session, "servicestage", `${base(session)}/components?limit=100`, { items: ["components"], kind: "offset", parameter: "offset", size: 100, total: ["count", "total"] });
  const rows = verifiedRows(body, "components", session);
  if (rows.some(row => !firstString([row.application_id], "") || !firstString([row.environment_id], ""))) throw new ManagementInputError("Huawei returned a component with an unverified parent application or environment.", 409);
  return rows.map((row) => {
    const status = asRecord(row.status);
    return {
      id: firstString([row.id], ""),
      applicationId: firstString([row.application_id], ""),
      applicationName: firstString([row.application_name], ""),
      environmentId: firstString([row.environment_id], ""),
      environmentName: firstString([row.environment_name], ""),
      name: firstString([row.name, row.id], ""),
      version: firstString([row.version], ""),
      status: firstString([status.component_status], ""),
      replica: Number(status.replica) || 0,
      availableReplica: Number(status.available_replica) || 0,
      runtimeStack: asRecord(row.runtime_stack),
      source: asRecord(row.source),
    };
  });
}

async function runtimeStackRows(session: BetterUiSession): Promise<RuntimeStackRow[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/runtimestacks`);
  const rows = asArray(body.runtime_stacks ?? body.runtimestacks).map(asRecord);
  if (!Array.isArray(body.runtime_stacks ?? body.runtimestacks) || (typeof body.total === "number" && body.total !== rows.length)) throw new ManagementInputError("Huawei returned an incomplete ServiceStage runtime catalog.", 409);
  return rows.filter(row => row.status === "Supported" && (!row.project_id || row.project_id === session.projectId)).map((row) => ({
    name: firstString([row.name], ""),
    type: firstString([row.type], ""),
    version: firstString([row.version], ""),
    deployMode: firstString([row.deploy_mode], ""),
    status: firstString([row.status], ""),
  })).filter((row) => row.name && row.type && row.version);
}

async function applicationDetail(session: BetterUiSession, id: string) {
  const row = asRecord(await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/applications/${encodeURIComponent(id)}`));
  if (firstString([row.id], "") !== id || (row.project_id && row.project_id !== session.projectId)) throw new ManagementInputError("Huawei returned an unverified ServiceStage application.", 404);
  return row;
}

async function environmentDetail(session: BetterUiSession, id: string) {
  const row = asRecord(await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/environments/${encodeURIComponent(id)}`));
  if (firstString([row.id], "") !== id || (row.project_id && row.project_id !== session.projectId)) throw new ManagementInputError("Huawei returned an unverified ServiceStage environment.", 404);
  return row;
}

async function environmentResources(session: BetterUiSession, id: string): Promise<ResourceRow[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/environments/${encodeURIComponent(id)}/resources`);
  const rows = verifiedRows(body, "resources", session);
  if (rows.some(row => !firstString([row.type], ""))) throw new ManagementInputError("Huawei returned an unverified environment resource type.", 409);
  if (rows.some(row => row.parameters != null && (typeof row.parameters !== "object" || Array.isArray(row.parameters)))) throw new ManagementInputError("Existing environment resource parameters cannot be safely preserved.", 409);
  return rows.map(row => ({ id: firstString([row.id], ""), name: firstString([row.name], ""), type: firstString([row.type], ""), ...(row.alias !== undefined ? { alias: asString(row.alias, "") } : {}), ...(row.parameters !== undefined && row.parameters !== null ? { parameters: asRecord(row.parameters) } : {}) }));
}

async function applicationComponentCount(session: BetterUiSession, applicationId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "servicestage", `${base(session)}/applications/${encodeURIComponent(applicationId)}/components?limit=100`, { items: ["components"], kind: "offset", parameter: "offset", size: 100, total: ["count", "total"] });
  return asArray(body.components).length;
}

async function componentRecords(session: BetterUiSession, applicationId: string, componentId: string): Promise<RecordRow[]> {
  const body = await huaweiList<Record<string, unknown>>(session, "servicestage", `${base(session)}/applications/${encodeURIComponent(applicationId)}/components/${encodeURIComponent(componentId)}/records?limit=100`, { items: ["records"], kind: "offset", parameter: "offset", size: 100, total: ["count", "total"] });
  return asArray(body.records).map(asRecord).map((row) => ({
    version: firstString([row.version], ""),
    status: firstString([row.status], ""),
    deployType: firstString([row.deploy_type], ""),
    currentUsed: row.current_used === true,
    beginTime: firstString([row.begin_time], ""),
    endTime: firstString([row.end_time], ""),
  })).filter((row) => row.version);
}

function scoped(resource: ManagementResource | undefined, kind: "application" | "environment") {
  const prefix = `${kind}:`;
  if (!resource?.id.startsWith(prefix) || resource.id.length <= prefix.length) throw new ManagementInputError(`Select a current ServiceStage ${kind}.`);
  return resource.id.slice(prefix.length);
}

function componentIdentity(resource: ManagementResource | undefined): { applicationId: string; componentId: string } {
  const parts = (resource?.id ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "component" || !parts[1] || !parts[2]) throw new ManagementInputError("Select a current ServiceStage component.");
  return { applicationId: parts[1], componentId: parts[2] };
}

async function ownedComponent(session: BetterUiSession, resource: ManagementResource | undefined) {
  const { applicationId, componentId } = componentIdentity(resource);
  const row = (await componentRows(session)).find((component) => component.id === componentId);
  if (!row) throw new ManagementInputError("The component no longer exists in this project.", 404);
  if (row.applicationId !== applicationId) throw new ManagementInputError("The component belongs to a different application.", 404);
  const info = asRecord(await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/applications/${encodeURIComponent(applicationId)}/components/${encodeURIComponent(componentId)}`));
  if (info.application_id !== applicationId || info.environment_id !== row.environmentId || info.name !== row.name) throw new ManagementInputError("Huawei returned a component with a different application or environment.", 409);
  const status = asRecord(info.status);
  return { applicationId, componentId, info, row: { ...row, status: firstString([status.component_status], "UNKNOWN"), replica: Number(status.replica) } };
}

function parseRuntimeStack(value: unknown): { name: string; type: string; version: string; deployMode: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { throw new ManagementInputError("Select an available container runtime stack."); }
  const [name, type, version, deployMode] = Array.isArray(parsed) ? parsed : [];
  if (typeof name !== "string" || typeof type !== "string" || typeof version !== "string" || typeof deployMode !== "string" || !name || !type || !version || !deployMode) throw new ManagementInputError("Select an available container runtime stack.");
  return { name, type, version, deployMode };
}

async function imageChoices(session: BetterUiSession): Promise<ManagementChoice[]> {
  const repositories = await listSwrRepositoriesForProject(session);
  const choices: ManagementChoice[] = [];
  for (const repository of repositories) {
    if (repository.imageCount <= 0) continue;
    const tags = await listSwrTagsForProject(session, repository.namespace, repository.name);
    for (const tag of tags) {
      if (!tag.pullPath || tag.pullPath === "-") continue;
      choices.push({ value: tag.pullPath, label: `${tag.pullPath} · ${tag.digest}` });
    }
  }
  return choices;
}

function labelRows(labels: unknown) {
  if (labels !== undefined && labels !== null && !Array.isArray(labels)) throw new ManagementInputError("Current ServiceStage labels could not be preserved.", 409);
  const rows = asArray(labels).map(asRecord);
  if (rows.some(row => typeof row.key !== "string" || !row.key || typeof row.value !== "string") || new Set(rows.map(row => row.key)).size !== rows.length) throw new ManagementInputError("Current ServiceStage labels could not be preserved.", 409);
  return rows.map(row => ({ key: String(row.key), value: String(row.value) }));
}

async function componentAction(session: BetterUiSession, applicationId: string, componentId: string, action: string, parameters?: Record<string, unknown>, resourceId?: string) {
  const response = await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/applications/${encodeURIComponent(applicationId)}/components/${encodeURIComponent(componentId)}/action`, { method: "POST", body: JSON.stringify({ action, ...(parameters ? { parameters } : {}) }) });
  const jobId = firstString([response.job_id], "");
  if (!jobId) throw new Error("Huawei returned no ServiceStage job for this component action. Check the component status before retrying.");
  return { jobId, resourceId };
}

const operations: ManagementOperation[] = [
  { id: "create-application", label: "Create application", kind: "create", description: "Create an application grouping container components. An application holds no resources and creates no billed workload until components are deployed into it.", fields: [nameField, descriptionField, enterpriseProjectField] },
  { id: "update-application", label: "Edit application name and description", kind: "update", description: "Change the name or description. The existing enterprise project scope and labels are preserved.", resourcePrefixes: ["application:"], fields: [nameField, descriptionField] },
  { id: "inspect-application", label: "Inspect application", kind: "inspect", description: "Show the application's scope, component count, and metadata.", resourcePrefixes: ["application:"], fields: [] },
  { id: "delete-application", label: "Delete application", kind: "delete", description: "Permanently delete an application that has no components. Delete its components first.", resourcePrefixes: ["application:"], fields: [], confirmation: true, impact: "The application and its remaining metadata are permanently removed. Its components must be deleted first." },
  { id: "create-environment", label: "Create environment", kind: "create", description: "Create a deployment environment bound to one current VPC. The VPC and deployment mode cannot change after creation.", fields: [nameField, descriptionField, { key: "deployMode", label: "Deployment mode", type: "select", source: "deployModes", required: true, help: "Deployment modes currently offered by the region's runtime stacks." }, { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true }, enterpriseProjectField], impact: "The environment itself is free, but components deployed into it create billed container workloads. The VPC and deployment mode cannot change after creation." },
  { id: "update-environment", label: "Edit environment name and description", kind: "update", description: "Change the name or description. The existing labels, VPC, and deployment mode are preserved.", resourcePrefixes: ["environment:"], fields: [nameField, descriptionField] },
  { id: "attach-cluster", label: "Attach CCE cluster", kind: "update", description: "Attach one current CCE cluster from this environment's VPC. Existing attached resources are preserved.", resourcePrefixes: ["environment:"], fields: [{ key: "cluster", label: "CCE cluster", type: "select", source: "clusters", required: true }], confirmation: true, impact: "Components in this environment can deploy onto the attached cluster, creating billed workloads there." },
  { id: "inspect-environment", label: "Inspect environment", kind: "inspect", description: "Show the environment's deployment mode, VPC, and attached resources.", resourcePrefixes: ["environment:"], fields: [] },
  { id: "delete-environment", label: "Delete environment", kind: "delete", description: "Permanently delete an environment with no components. Delete the components deployed in it first.", resourcePrefixes: ["environment:"], fields: [], confirmation: true, impact: "The environment and its resource attachments are permanently removed. Components deployed in it must be deleted first." },
  { id: "create-component", label: "Deploy container component", kind: "create", description: "Deploy one container component from an owned SWR image into a current environment, using a live Docker runtime stack and a CCE cluster attached to that environment. Environment variables, persistent storage, health probes, lifecycle hooks, and source-code builds are not configured by this workflow.", fields: [
    { key: "application", label: "Application", type: "select", source: "applications", required: true },
    nameField,
    descriptionField,
    { key: "environment", label: "Environment", type: "select", source: "environments", required: true },
    { key: "image", label: "SWR image", type: "select", source: "images", required: true, help: "Image versions currently available in this account's SWR repositories." },
    { key: "runtimeStack", label: "Container runtime stack", type: "select", source: "runtimeStacks", required: true },
    versionField,
    { key: "replica", label: "Replicas", type: "number", required: true, min: 1, max: 100, defaultValue: 1 },
    { key: "requestCpu", label: "Requested CPU (cores)", type: "decimal", required: true, min: 0.01, max: 128, defaultValue: 0.5 },
    { key: "limitCpu", label: "CPU limit (cores)", type: "decimal", required: true, min: 0.01, max: 128, defaultValue: 1 },
    { key: "requestMemory", label: "Requested memory (GiB)", type: "decimal", required: true, min: 0.01, max: 1024, defaultValue: 1 },
    { key: "limitMemory", label: "Memory limit (GiB)", type: "decimal", required: true, min: 0.01, max: 1024, defaultValue: 2 },
    { key: "cluster", label: "CCE cluster", type: "select", source: "clusters", required: true, help: "Must be attached to the selected environment and belong to its VPC." },
    { key: "namespace", label: "Cluster namespace", max: 63, pattern: "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", defaultValue: "default", help: "Kubernetes namespace in the selected cluster. Defaults to default." },
    { key: "elb", label: "Load balancer", type: "select", source: "elbs", help: "Leave empty to keep the component reachable only inside the cluster." },
    { key: "protocol", label: "Access protocol", type: "select", defaultValue: "http", choices: [{ value: "http", label: "HTTP" }], help: "HTTPS requires a certificate workflow that is not yet available here." },
    { key: "port", label: "External access port", type: "number", min: 1, max: 65535, help: "Required when a load balancer is selected." },
  ], impact: "This deploys billed container workloads on the selected cluster: running replicas consume cluster resources and the image is pulled from SWR. External access through the selected load balancer can expose the component to client traffic." },
  { id: "start", label: "Start component", kind: "action", description: "Start a stopped or failed component.", resourcePrefixes: ["component:"], allowedStatuses: ["DOWN", "FAILED"], fields: [] },
  { id: "stop", label: "Stop component", kind: "action", description: "Stop a running component.", resourcePrefixes: ["component:"], allowedStatuses: ["RUNNING"], fields: [], confirmation: true, impact: "The component stops serving traffic and clients lose connectivity until it is started again. Billing for the underlying cluster resources continues." },
  { id: "restart", label: "Restart component", kind: "action", description: "Restart a running component.", resourcePrefixes: ["component:"], allowedStatuses: ["RUNNING"], fields: [], confirmation: true, impact: "The component is unavailable while it restarts and open connections are dropped." },
  { id: "scale", label: "Scale component", kind: "action", description: "Change the replica count of a running component.", resourcePrefixes: ["component:"], allowedStatuses: ["RUNNING"], fields: [{ key: "replica", label: "New replica count", type: "number", required: true, min: 1, max: 100 }], confirmation: true, impact: "Scaling out increases consumed cluster resources; scaling in terminates the pods of removed replicas. Availability can drop during the change." },
  { id: "rollback", label: "Roll back component", kind: "action", description: "Redeploy the component at one of its successful historical versions.", resourcePrefixes: ["component:"], allowedStatuses: ["RUNNING", "FAILED"], fields: [{ key: "version", label: "Historical version", type: "select", source: "rollbackVersions", required: true }], confirmation: true, impact: "The current version is replaced by the selected historical version and the component is unavailable during the rollback." },
  { id: "inspect-component", label: "Inspect component", kind: "inspect", description: "Show the component's runtime stack, source image, replicas, and access configuration. Environment variable values are never displayed.", resourcePrefixes: ["component:"], fields: [] },
  { id: "component-records", label: "View deployment records", kind: "inspect", description: "List the component's deployment history. Raw job payloads are not displayed.", resourcePrefixes: ["component:"], fields: [] },
  { id: "delete-component", label: "Delete component", kind: "delete", description: "Permanently remove a component that is not currently changing state.", resourcePrefixes: ["component:"], allowedStatuses: ["RUNNING", "FAILED", "DOWN"], fields: [], confirmation: true, impact: "The component and its pods are permanently removed and stop consuming cluster resources. Its deployment records are deleted." },
];

export const serviceStageManagement: ManagementAdapter = {
  title: "ServiceStage Applications and Environments",
  operations,
  inventory: async (session) => {
    const [applications, environments, components] = await Promise.all([listServiceStageApplicationsForProject(session), environmentRows(session), componentRows(session)]);
    return [
      ...applications.map((application) => ({ id: `application:${application.id}`, name: application.name, values: { description: application.description, componentCount: application.componentCount, enterpriseProjectId: application.enterpriseProjectId, creator: application.creator } })),
      ...environments.map((environment) => ({ id: `environment:${environment.id}`, name: environment.name, values: { deployMode: environment.deployMode, vpcId: environment.vpcId, description: environment.description, enterpriseProjectId: environment.enterpriseProjectId } })),
      ...components.map((component) => ({ id: `component:${component.applicationId}:${component.id}`, name: component.name, status: component.status || "UNKNOWN", values: { applicationId: component.applicationId, applicationName: component.applicationName, environmentId: component.environmentId, environmentName: component.environmentName, version: component.version, runtimeStack: `${firstString([component.runtimeStack.type], "")} ${firstString([component.runtimeStack.name], "")} ${firstString([component.runtimeStack.version], "")}`.trim(), replica: component.replica, availableReplica: component.availableReplica } })),
    ];
  },
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-environment") {
      const [stacks, vpcs] = await Promise.all([runtimeStackRows(session), listVpcsForProject(session)]);
      return {
        deployModes: [...new Set(stacks.map((stack) => stack.deployMode).filter(Boolean))].map((mode) => ({ value: mode, label: mode })),
        vpcs: vpcs.map((vpc) => ({ value: vpc.id, label: `${vpc.name} · ${vpc.cidr}` })),
      };
    }
    if (operation === "create-component") {
      const [applications, environments, stacks, clusters, elbs, images] = await Promise.all([listServiceStageApplicationsForProject(session), environmentRows(session), runtimeStackRows(session), listCceClustersForProject(session), listElbsForProject(session), imageChoices(session)]);
      return {
        applications: applications.map((application) => ({ value: application.id, label: application.name })),
        environments: environments.map((environment) => ({ value: environment.id, label: `${environment.name} · ${environment.deployMode} · VPC ${environment.vpcId}` })),
        runtimeStacks: stacks.filter((stack) => stack.type.toUpperCase() === "DOCKER").map((stack) => ({ value: JSON.stringify([stack.name, stack.type, stack.version, stack.deployMode]), label: `${stack.type} · ${stack.name} ${stack.version} · ${stack.deployMode} · ${stack.status}` })),
        clusters: clusters.map((cluster) => ({ value: cluster.id, label: `${cluster.name} · ${cluster.status} · VPC ${cluster.vpcId}` })),
        elbs: elbs.map((elb) => ({ value: elb.id, label: `${elb.name} · ${elb.operatingStatus} · ${elb.vipAddress}` })),
        images,
      };
    }
    if (operation === "attach-cluster") return { clusters: (await listCceClustersForProject(session)).map((cluster) => ({ value: cluster.id, label: `${cluster.name} · ${cluster.status} · VPC ${cluster.vpcId}` })) };
    if (operation === "rollback" && resource) {
      const { applicationId, componentId } = componentIdentity(resource);
      const records = await componentRecords(session, applicationId, componentId);
      return { rollbackVersions: records.filter((record) => !record.currentUsed && record.status.toUpperCase() === "SUCCESS").map((record) => ({ value: record.version, label: `${record.version} · ${record.deployType} · ${record.beginTime}` })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    if (!entry.jobId) throw new ManagementInputError("This history entry has no native ServiceStage job ID.");
    if (entry.operation === "Delete component" && entry.jobId.startsWith("component:")) {
      if (entry.jobId !== entry.resourceId) throw new ManagementInputError("The deletion observation has a different component identity.", 409);
      const { applicationId, componentId } = componentIdentity({ id: entry.jobId, name: entry.resourceName ?? "" });
      try {
        const info = asRecord(await huaweiFetch(session, "servicestage", `${base(session)}/applications/${encodeURIComponent(applicationId)}/components/${encodeURIComponent(componentId)}`));
        if (info.application_id !== applicationId || (entry.resourceName && info.name !== entry.resourceName)) throw new ManagementInputError("Huawei returned an unverified component during deletion observation.", 409);
      } catch (error) {
        if (error instanceof HuaweiApiError && error.status === 404) return { state: "succeeded", message: "The component record no longer exists. Cluster workload cleanup may still be completing." };
        throw error;
      }
      return { state: "submitted", message: "The component record still exists; deletion has not completed. This checks resource presence because Huawei returned no job ID." };
    }
    const body = await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/jobs/${encodeURIComponent(entry.jobId)}`);
    const job = asRecord(body.job);
    if (!entry.jobId || firstString([job.job_id], "") !== entry.jobId) throw new ManagementInputError("Huawei returned a different ServiceStage job.");
    const status = firstString([job.execution_status], "").toUpperCase();
    if (status === "SUCCESS") return { state: "succeeded", message: "The ServiceStage job completed successfully." };
    if (status === "ERROR" || status === "FAILED") {
      return { state: "failed", message: "The ServiceStage job failed. Review the component records in the native console before retrying." };
    }
    return { state: "submitted", message: "The ServiceStage job is still processing; no terminal state has been reported." };
  },
  invalidationKeys: () => [cloudCacheKeys.listServiceStageApplications, cloudCacheKeys.listCceClusters, cloudCacheKeys.listElbs, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    if (operation === "create-application") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/applications`, { method: "POST", body: JSON.stringify({ name: values.name, description: values.description ?? "", enterprise_project_id: values.enterpriseProjectId ?? "0" }) });
      const id = firstString([response.id], "");
      if (!id) throw new Error("Huawei returned no application ID. Check applications before retrying.");
      return { message: "Application created. It holds no resources until components are deployed into it.", resourceId: `application:${id}` };
    }
    if (operation === "create-environment") {
      const deployMode = String(values.deployMode);
      const stacks = await runtimeStackRows(session);
      if (![...new Set(stacks.map((stack) => stack.deployMode))].includes(deployMode)) throw new ManagementInputError("The selected deployment mode is no longer offered in this region.");
      const vpcs = await listVpcsForProject(session);
      if (!vpcs.some((vpc) => vpc.id === values.vpc)) throw new ManagementInputError("The selected VPC is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/environments`, { method: "POST", body: JSON.stringify({ name: values.name, description: values.description ?? "", enterprise_project_id: values.enterpriseProjectId ?? "0", vpc_id: values.vpc, deploy_mode: deployMode }) });
      const id = firstString([response.id], "");
      if (!id) throw new Error("Huawei returned no environment ID. Check environments before retrying.");
      return { message: "Environment created. Attach a CCE cluster before deploying components.", resourceId: `environment:${id}` };
    }
    if (operation === "create-component") {
      const stack = parseRuntimeStack(values.runtimeStack);
      const applications = await listServiceStageApplicationsForProject(session);
      const application = applications.find((item) => item.id === values.application);
      if (!application) throw new ManagementInputError("The selected application no longer exists in this project.", 404);
      const [stacks, environments, clusters, images] = await Promise.all([runtimeStackRows(session), environmentRows(session), listCceClustersForProject(session), imageChoices(session)]);
      const liveStack = stacks.find((item) => item.name === stack.name && item.type === stack.type && item.version === stack.version && item.deployMode === stack.deployMode);
      if (!liveStack) throw new ManagementInputError("The selected runtime stack is no longer available.");
      if (liveStack.deployMode !== "container") throw new ManagementInputError("Only container deployment mode is supported for image deployments.");
      if (liveStack.type.toUpperCase() !== "DOCKER") throw new ManagementInputError("Only Docker runtime stacks are supported for image deployments.");
      const environment = environments.find((item) => item.id === values.environment);
      if (!environment) throw new ManagementInputError("The selected environment no longer exists in this project.", 404);
      if (environment.deployMode !== liveStack.deployMode) throw new ManagementInputError("The selected runtime stack does not match the environment's deployment mode.");
      if (!images.some((image) => image.value === values.image)) throw new ManagementInputError("The selected SWR image is no longer available.");
      const cluster = clusters.find((item) => item.id === values.cluster);
      if (!cluster) throw new ManagementInputError("The selected cluster is no longer available in this project.", 404);
      if (cluster.status !== "Available") throw new ManagementInputError("The selected CCE cluster is not currently Available.", 409);
      if (!environment.vpcId || cluster.vpcId !== environment.vpcId) throw new ManagementInputError("The selected cluster belongs to a different VPC than this environment.");
      const attached = await environmentResources(session, environment.id);
      if (!attached.some((item) => item.id === cluster.id && item.type === "cce")) throw new ManagementInputError("The selected cluster is not attached to this environment. Attach it first.");
      const replica = Number(values.replica);
      if (!Number.isSafeInteger(replica) || replica < 1 || replica > 100) throw new ManagementInputError("The replica count must be a whole number from 1 to 100.");
      const [requestCpu, limitCpu, requestMemory, limitMemory] = [Number(values.requestCpu), Number(values.limitCpu), Number(values.requestMemory), Number(values.limitMemory)];
      if (![requestCpu, limitCpu, requestMemory, limitMemory].every((value) => Number.isFinite(value) && value > 0)) throw new ManagementInputError("CPU and memory values must be positive numbers.");
      if (requestCpu > limitCpu || requestMemory > limitMemory) throw new ManagementInputError("Requested CPU and memory must not exceed the corresponding limits.");
      const external: { protocol: string; address: string; forward_port: number } | null = values.elb !== undefined ? (() => {
        if (values.port === undefined) throw new ManagementInputError("Enter the external access port.");
        const port = Number(values.port);
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new ManagementInputError("The external access port must be a whole number from 1 to 65535.");
        return { protocol: String(values.protocol ?? "http"), address: String(values.elb), forward_port: port };
      })() : null;
      if (values.port !== undefined && !external) throw new ManagementInputError("Select a load balancer for the external port.");
      if (external) {
        if (external.protocol !== "http") throw new ManagementInputError("Only HTTP external access is supported; HTTPS requires certificate configuration.");
        const elbs = await listElbsForProject(session);
        const elb = elbs.find(item => item.id === external.address);
        if (!elb) throw new ManagementInputError("The selected load balancer is no longer available in this project.", 404);
        if (elb.operatingStatus !== "ONLINE" || elb.provisioningStatus !== "ACTIVE") throw new ManagementInputError("The selected load balancer is not currently idle and online.", 409);
        const subnets = await listSubnetsForProject(session);
        if (!subnets.some(subnet => subnet.id === elb.vipSubnetCidrId && subnet.vpcId === environment.vpcId)) throw new ManagementInputError("The load balancer subnet does not belong to this environment VPC.", 409);
        const listeners = await huaweiList<Record<string, unknown>>(session, "elb", `/v3/${session.projectId}/elb/listeners?loadbalancer_id=${encodeURIComponent(elb.id)}&limit=100`, { items: ["listeners"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker"], fallbackKey: "id" });
        if (asArray(listeners.listeners).map(asRecord).some(listener => !Number.isInteger(listener.protocol_port) || Number(listener.protocol_port) === external.forward_port)) throw new ManagementInputError("The load balancer port is already occupied or its current listeners could not be verified.", 409);
        if (!elb.vipAddress || elb.vipAddress === "-") throw new ManagementInputError("The load balancer address could not be verified.", 409);
        external.address = elb.vipAddress;
      }
      const namespace = values.namespace !== undefined ? String(values.namespace) : "default";
      const response = await huaweiFetch<Record<string, unknown>>(session, "servicestage", `${base(session)}/applications/${encodeURIComponent(application.id)}/components`, { method: "POST", body: JSON.stringify({
        name: values.name,
        description: values.description ?? "",
        runtime_stack: { name: liveStack.name, type: liveStack.type, version: liveStack.version, deploy_mode: liveStack.deployMode },
        source: { kind: "image", url: String(values.image) },
        environment_id: environment.id,
        replica,
        request_cpu: requestCpu,
        request_memory: requestMemory,
        limit_cpu: limitCpu,
        limit_memory: limitMemory,
        version: values.version,
        refer_resources: [{ id: cluster.id, type: "cce", parameters: { namespace } }, ...(external ? [{ id: values.elb, type: "elb" }] : [])],
        ...(external ? { external_accesses: [external] } : {}),
      }) });
      const componentId = firstString([response.component_id], "");
      const jobId = firstString([response.job_id], "");
      if (!componentId || !jobId) throw new Error("Huawei returned no verifiable component deployment job. Check the application's components before retrying.");
      return { message: "Component deployment submitted. The container workload is billed while it runs.", resourceId: `component:${application.id}:${componentId}`, jobId, asynchronous: true };
    }
    if (operation === "update-application") {
      const id = scoped(resource, "application");
      const current = await applicationDetail(session, id);
      if (typeof current.enterprise_project_id !== "string" || !current.enterprise_project_id) throw new ManagementInputError("The application enterprise project could not be preserved.", 409);
      const labels = labelRows(current.labels);
      await huaweiFetch(session, "servicestage", `${base(session)}/applications/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({
        name: values.name,
        description: values.description !== undefined ? String(values.description) : asString(current.description, ""),
        enterprise_project_id: current.enterprise_project_id,
        labels,
      }) });
      return { message: "Application updated. The enterprise project scope and labels are preserved.", resourceId: resource!.id };
    }
    if (operation === "update-environment") {
      const id = scoped(resource, "environment");
      const current = await environmentDetail(session, id);
      if (current.configuration != null && (typeof current.configuration !== "object" || Array.isArray(current.configuration))) throw new ManagementInputError("Environment settings cannot be safely round-tripped.", 409);
      const configuration = asRecord(current.configuration);
      if (Object.values(configuration).some(value => value !== null && value !== undefined && (!Array.isArray(value) || value.length))) throw new ManagementInputError("Environment settings contain variables that cannot be safely round-tripped; edit its name in the native console.", 409);
      if (typeof current.enterprise_project_id !== "string" || !current.enterprise_project_id) throw new ManagementInputError("The environment enterprise project could not be preserved.", 409);
      const labels = labelRows(current.labels);
      await huaweiFetch(session, "servicestage", `${base(session)}/environments/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({
        name: values.name,
        description: values.description !== undefined ? String(values.description) : asString(current.description, ""),
        enterprise_project_id: current.enterprise_project_id,
        labels,
        ...(current.configuration !== undefined ? { configuration: current.configuration } : {}),
      }) });
      return { message: "Environment updated. The labels, VPC, and deployment mode are preserved.", resourceId: resource!.id };
    }
    if (operation === "attach-cluster") {
      const id = scoped(resource, "environment");
      const current = await environmentDetail(session, id);
      const vpcId = firstString([current.vpc_id], "");
      const clusters = await listCceClustersForProject(session);
      const cluster = clusters.find((item) => item.id === values.cluster);
      if (!cluster) throw new ManagementInputError("The selected cluster is no longer available in this project.", 404);
      if (cluster.status !== "Available") throw new ManagementInputError("The selected CCE cluster is not currently Available.", 409);
      if (!vpcId || cluster.vpcId !== vpcId) throw new ManagementInputError("The selected cluster belongs to a different VPC than this environment.");
      const attached = await environmentResources(session, id);
      if (attached.some(item => item.type === "custom_k8s" || Object.keys(item.parameters ?? {}).length)) throw new ManagementInputError("Existing environment resource parameters cannot be safely preserved; attach the cluster in the native console.", 409);
      if (attached.some((item) => item.id === cluster.id)) throw new ManagementInputError("This cluster is already attached to the environment.", 409);
      await huaweiFetch(session, "servicestage", `${base(session)}/environments/${encodeURIComponent(id)}/resources`, { method: "PUT", body: JSON.stringify({ resources: [...attached, { id: cluster.id, name: cluster.name, type: "cce" }] }) });
      return { message: "CCE cluster attached. Existing environment resources are preserved.", resourceId: resource!.id };
    }
    if (operation === "inspect-application") {
      const id = scoped(resource, "application");
      const current = await applicationDetail(session, id);
      return { message: "Current application configuration.", resourceId: resource!.id, facts: [
        { label: "Application", value: `${firstString([current.name], "-")} · ${firstString([current.id], "-")}` },
        { label: "Description", value: asString(current.description, "") || "No description set" },
        { label: "Components", value: String(Number(current.component_count) || 0) },
        { label: "Enterprise project", value: firstString([current.enterprise_project_id], "-") },
        { label: "Creator", value: firstString([current.creator], "-") },
        { label: "Labels", value: labelRows(current.labels).map((label) => `${label.key}=${label.value}`).join(", ") || "None" },
      ] };
    }
    if (operation === "inspect-environment") {
      const id = scoped(resource, "environment");
      const current = await environmentDetail(session, id);
      const attached = await environmentResources(session, id);
      return { message: "Current environment configuration.", resourceId: resource!.id, facts: [
        { label: "Environment", value: `${firstString([current.name], "-")} · ${firstString([current.id], "-")}` },
        { label: "Deployment mode", value: firstString([current.deploy_mode], "-") },
        { label: "VPC", value: firstString([current.vpc_id], "-") },
        { label: "Description", value: asString(current.description, "") || "No description set" },
        { label: "Enterprise project", value: firstString([current.enterprise_project_id], "-") },
        ...attached.map((item) => ({ label: `Attached ${item.type}`, value: `${item.name || "-"} · ${item.id}` })),
      ] };
    }
    if (operation === "delete-application") {
      const id = scoped(resource, "application");
      await applicationDetail(session, id);
      const components = await applicationComponentCount(session, id);
      if (components > 0) throw new ManagementInputError("Delete the application's components first.", 409);
      await huaweiFetch(session, "servicestage", `${base(session)}/applications/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { message: "Application deleted.", resourceId: resource!.id };
    }
    if (operation === "delete-environment") {
      const id = scoped(resource, "environment");
      await environmentDetail(session, id);
      const components = await componentRows(session);
      if (components.some((component) => component.environmentId === id)) throw new ManagementInputError("Delete the components deployed in this environment first.", 409);
      await huaweiFetch(session, "servicestage", `${base(session)}/environments/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { message: "Environment deleted.", resourceId: resource!.id };
    }
    const { applicationId, componentId, row, info } = await ownedComponent(session, resource);
    const definition = operations.find(item => item.id === operation);
    if (!definition) throw new ManagementInputError("Unsupported ServiceStage operation.");
    if (definition.kind !== "inspect") {
      if (!definition.allowedStatuses?.includes(row.status)) throw new ManagementInputError(`The component status ${row.status} does not permit this operation.`, 409);
      const lastJobId = asRecord(info.status).last_job_id;
      if (typeof lastJobId !== "string") throw new ManagementInputError("The component current deployment job could not be verified.", 409);
      if (lastJobId) {
        const latest = asRecord(asRecord(await huaweiFetch(session, "servicestage", `${base(session)}/jobs/${encodeURIComponent(lastJobId)}`)).job);
        if (latest.job_id !== lastJobId || !["SUCCESS", "ERROR", "FAILED"].includes(String(latest.execution_status))) throw new ManagementInputError("The component still has an active or unverified deployment job.", 409);
      }
    }
    const componentPath = `${base(session)}/applications/${encodeURIComponent(applicationId)}/components/${encodeURIComponent(componentId)}`;
    if (operation === "start" || operation === "stop" || operation === "restart") {
      const outcome = await componentAction(session, applicationId, componentId, operation, undefined, resource!.id);
      return { message: `Component ${operation} submitted.`, ...outcome, asynchronous: true };
    }
    if (operation === "scale") {
      const replica = Number(values.replica);
      if (!Number.isSafeInteger(replica) || replica < 1 || replica > 100) throw new ManagementInputError("The new replica count must be a whole number from 1 to 100.");
      if (!Number.isSafeInteger(row.replica) || row.replica < 0) throw new ManagementInputError("The component replica count could not be verified.", 409);
      if (replica === row.replica) throw new ManagementInputError(`The component already runs ${row.replica} replica(s).`, 409);
      const outcome = await componentAction(session, applicationId, componentId, "scale", { replica }, resource!.id);
      return { message: `Scale to ${replica} replica(s) submitted.`, ...outcome, asynchronous: true };
    }
    if (operation === "rollback") {
      const records = await componentRecords(session, applicationId, componentId);
      const record = records.find((item) => item.version === values.version);
      if (!record) throw new ManagementInputError("The selected historical version was not found for this component.", 404);
      if (record.currentUsed) throw new ManagementInputError("The selected version is the component's current version.", 409);
      if (record.status.toUpperCase() !== "SUCCESS") throw new ManagementInputError("Only successful historical versions can be restored.", 409);
      const outcome = await componentAction(session, applicationId, componentId, "rollback", { version: record.version }, resource!.id);
      return { message: `Rollback to version ${record.version} submitted.`, ...outcome, asynchronous: true };
    }
    if (operation === "inspect-component") {
      const status = asRecord(info.status);
      const stack = asRecord(info.runtime_stack);
      const source = asRecord(info.source);
      return { message: "Current component configuration.", resourceId: resource!.id, facts: [
        { label: "Component", value: `${firstString([info.name], "-")} · ${firstString([info.version], "-")} · ${firstString([status.component_status], "-")}` },
        { label: "Runtime stack", value: `${firstString([stack.type], "-")} ${firstString([stack.name], "")} ${firstString([stack.version], "")} · ${firstString([stack.deploy_mode], "-")}`.replace(/\s+/g, " ").trim() },
        { label: "Environment", value: firstString([info.environment_id], "-") },
        { label: "Replicas", value: `${Number(status.available_replica) || 0} available of ${Number(status.replica) || 0}` },
        { label: "Source", value: firstString([source.kind], "") === "image" ? `image · ${imageReference(source.url)}` : firstString([source.kind], "Not reported") },
        { label: "Environment variables", value: `${asArray(info.envs).length} configured (values are never displayed)` },
        ...asArray(info.refer_resources).map(asRecord).map((item) => ({ label: `Referenced ${firstString([item.type], "resource")}`, value: firstString([item.id], "-") })),
        ...asArray(info.external_accesses).map(asRecord).map((item) => ({ label: `External access · ${firstString([item.protocol], "-")}`, value: `${firstString([item.address], "-")}:${Number(item.forward_port) || 0}` })),
      ] };
    }
    if (operation === "component-records") {
      const records = await componentRecords(session, applicationId, componentId);
      return { message: `${records.length} deployment records loaded.`, resourceId: resource!.id, facts: records.map((record) => ({ label: `${record.version} · ${record.status}${record.currentUsed ? " · current" : ""}`, value: `${record.deployType || "-"} · ${record.beginTime || "-"} → ${record.endTime || "-"}` })) };
    }
    if (operation === "delete-component") {
      const response = asRecord(await huaweiFetch(session, "servicestage", componentPath, { method: "DELETE" }));
      return { message: "Component deletion accepted. Native job progress or resource presence must be checked before treating removal as complete; cluster cleanup can continue afterwards.", resourceId: resource!.id, jobId: firstString([response.job_id], resource!.id), asynchronous: true };
    }
    throw new ManagementInputError("Unsupported ServiceStage operation.");
  },
};
