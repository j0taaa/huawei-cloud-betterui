import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { huaweiFetch as nativeFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listDwsClustersForProject } from "@/lib/huawei/services/dws";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const available = ["AVAILABLE"];
const deletable = ["AVAILABLE", "FAILED", "CREATE_FAILED", "DELETE_FAILED"];
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const wholeHours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
const nodeStatusCodes: Record<string, string> = { "100": "Creating", "199": "Idle", "200": "Available", "300": "Unavailable", "303": "Creation failed", "304": "Deleting", "305": "Deletion failed", "400": "Deleted" };

const clusterName: ManagementField = { key: "name", label: "Cluster name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$", help: "4-64 characters starting with a letter; letters, digits, hyphens, and underscores." };
const adminUser: ManagementField = { key: "adminUser", label: "Administrator username", max: 63, defaultValue: "dbadmin", pattern: "^[a-z_][a-z0-9_]{0,62}$", help: "1-63 lowercase letters, digits, or underscores, starting with a lowercase letter or underscore. Defaults to dbadmin." };
const passwordField: ManagementField = { key: "password", label: "Administrator password", type: "password", required: true, min: 12, max: 32, help: "12-32 characters combining at least three of lowercase letters, uppercase letters, digits, and the special characters ~!?,.:;-_(){}[]/<>@#%^&*+|\\=. It cannot match the administrator username or its reverse." };
const snapshotName: ManagementField = { key: "name", label: "Snapshot name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$", help: "4-64 characters starting with a letter." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 256, allowEmpty: true, help: "Up to 256 characters; the characters ! < > ' = & \" \\ are not accepted." };

// Huawei documents one special-character set for cluster creation and a slightly wider one for password resets.
const passwordCharset = { create: /^[A-Za-z0-9~!?,.:;\-_(){}[\]\/<>@#%^&*+|\\=]+$/, reset: /^[A-Za-z0-9~!?,.:;\-_'"(){}[\]\/<>@#%^&*+|\\=]+$/ };

function assertPassword(value: string, kind: "create" | "reset", account: string) {
  if (value.length < 12 || value.length > 32) throw new ManagementInputError("The password must be 12 to 32 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and special characters.");
  if (!passwordCharset[kind].test(value)) throw new ManagementInputError("The password uses characters outside the supported DWS set.");
  if (account && (value === account || value === [...account].reverse().join(""))) throw new ManagementInputError("The password cannot match the administrator username or its reverse.");
}

function parseOffering(value: unknown) {
  let offering: unknown;
  try { offering = JSON.parse(String(value)); } catch { return []; }
  return Array.isArray(offering) ? offering : [];
}

async function clusterRecord(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(id)}`);
  const record = asRecord(body.cluster);
  if (firstString([record.id], "") !== id) throw new ManagementInputError("The cluster was not found in this project.", 404);
  return record;
}

function assertPayPerUse(record: Record<string, unknown>) {
  if (firstString([record.order_id], "")) throw new ManagementInputError("This operation supports pay-per-use clusters only. Prepaid clusters require a subscription order workflow.", 409);
}

function assertNoInFlightTask(record: Record<string, unknown>) {
  if (typeof record.task_status !== "string") throw new ManagementInputError("The cluster's current management task could not be verified.", 409);
  if (record.task_status) throw new ManagementInputError(`The cluster is running the ${record.task_status} task. Wait for it to finish before starting another operation.`, 409);
}

async function huaweiFetch<T = Record<string, unknown>>(session: BetterUiSession, service: "dws", path: string, init?: RequestInit): Promise<T> {
  const response = await nativeFetch<T>(session, service, path, init);
  const body = asRecord(response);
  if (body.error_code || body.error_msg || body.error) throw new ManagementInputError("Huawei rejected this DWS request. Inspect the cluster before retrying.", 409);
  return response;
}

function createdCluster(response: Record<string, unknown>) {
  const id = firstString([asRecord(response.cluster).id], "");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new Error("Huawei returned no verified cluster ID. Check the cluster list before retrying.");
  return id;
}

type NodeTypeRow = { specName: string; id: string; vcpus: number; ram: number; azStatus: Record<string, string>; stableVersions: string[]; elastic: boolean };

async function nodeTypeRows(session: BetterUiSession): Promise<NodeTypeRow[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v2/${session.projectId}/node-types`);
  if (!Array.isArray(body.node_types)) throw new Error("DWS returned no verified specification catalog.");
  return asArray(body.node_types).map(asRecord).flatMap((nodeType) => {
    const specName = firstString([nodeType.spec_name], "");
    const id = firstString([nodeType.id], "");
    if (!specName || !id) return [];
    const azStatus = Object.fromEntries(asArray(nodeType.available_zones).map(asRecord).map((zone) => [firstString([zone.code], ""), firstString([zone.status], "")]));
    const stableVersions = asArray(nodeType.datastores).map(asRecord).filter((datastore) => firstString([datastore.role], "") === "STABLE").map((datastore) => firstString([datastore.version], "")).filter(Boolean);
    return [{ specName, id, vcpus: Number(nodeType.vcpus) || 0, ram: Number(nodeType.ram) || 0, azStatus, stableVersions, elastic: asArray(nodeType.elastic_volume_specs).length > 0 }];
  });
}

async function zoneRows(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v1.0/${session.projectId}/availability-zones`);
  if (!Array.isArray(body.availability_zones)) throw new Error("DWS returned no verified availability-zone catalog.");
  return asArray(body.availability_zones).map(asRecord).map((zone) => ({ code: firstString([zone.code], ""), name: firstString([zone.name], ""), status: firstString([zone.status], "") })).filter((zone) => zone.code);
}

async function snapshotRows(session: BetterUiSession, clusterId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "dws", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/snapshots?limit=100`, { items: ["snapshots"], kind: "offset", parameter: "offset", size: 100, total: ["count"] });
  // Snapshots are parent-scoped: never touch one the cluster list does not own, even if the provider ignores its filter.
  return asArray(body.snapshots).map(asRecord).filter((row) => firstString([row.cluster_id], "") === clusterId);
}

async function targetFlavorRows(session: BetterUiSession, flavorId: string, clusterId: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v1/${session.projectId}/flavors/${encodeURIComponent(flavorId)}/target-flavors?${new URLSearchParams({ cluster_id: clusterId })}`);
  return asArray(body.flavors).map(asRecord).map((flavor) => ({ id: firstString([flavor.id], ""), name: firstString([flavor.name], ""), vcpus: Number(flavor.vcpus) || 0, ram: Number(flavor.ram) || 0, current: flavor.is_current_flavor === true }));
}

async function storageRange(session: BetterUiSession, clusterId: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/storage-expand-range`);
  const range = { min: Number(body.min_size), max: Number(body.max_size), current: Number(body.current_size), step: Number(body.step) };
  if (!Object.values(range).every((size) => Number.isFinite(size) && size > 0) || range.step <= 0) throw new ManagementInputError("The cluster's storage expansion range could not be loaded. Retry the operation.");
  return range;
}

async function nodeRows(session: BetterUiSession, clusterId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "dws", `/v2/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/nodes?limit=100`, { items: ["node_list"], kind: "offset", parameter: "offset", size: 100, total: ["count"] });
  return asArray(body.node_list).map(asRecord);
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create cluster", kind: "create", description: "Create one private pay-per-use GaussDB(DWS) cluster from live specifications, stable versions, availability zones, and current project network choices.", impact: "Compute and storage are billed hourly while the cluster exists. No public IP is attached; clients connect through the selected subnet. Creation takes 10 to 15 minutes.", fields: [
    clusterName,
    { key: "offering", label: "Specification and version", type: "select", source: "offerings", required: true, help: "Fixed-storage specifications currently on sale with a stable version in this region. Elastic-volume specifications are not offered yet." },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "numNode", label: "Node count", type: "number", required: true, min: 3, max: 256, defaultValue: 3, help: "3-256 nodes for cluster mode." },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC. DWS uses the subnet's network ID." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    adminUser,
    { key: "dbPort", label: "Database port", type: "number", min: 8000, max: 30000, defaultValue: 8000, help: "8000-30000. Defaults to 8000." },
    passwordField,
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "inspect", label: "Inspect cluster", kind: "inspect", description: "Show the cluster's topology, private endpoints, and non-secret configuration.", fields: [] },
  { id: "progress", label: "View task progress", kind: "inspect", description: "Show the cluster's native status, sub-status, running task, and task progress.", fields: [] },
  { id: "quotas", label: "View project quotas", kind: "inspect", description: "Show this project's DWS resource quotas and current usage.", fields: [] },
  { id: "metrics", label: "View supported metrics", kind: "inspect", description: "List the native DMS monitoring metrics this cluster reports.", fields: [], allowedStatuses: available },
  { id: "rename", label: "Rename cluster", kind: "update", description: "Change the cluster name. Requires guestAgent 8.3.1 or later on the cluster.", fields: [clusterName], allowedStatuses: available },
  { id: "describe", label: "Edit description", kind: "update", description: "Replace or clear the cluster's description.", fields: [{ ...descriptionField, required: true }] },
  { id: "maintenance-window", label: "Set maintenance window", kind: "update", description: "Set the weekly UTC whole-hour maintenance window. The start and end must be exactly four hours apart.", fields: [
    { key: "day", label: "Weekday", type: "select", source: "days", required: true },
    { key: "start", label: "Window start (UTC)", type: "select", source: "hours", required: true },
    { key: "end", label: "Window end (UTC)", type: "select", source: "hours", required: true },
  ], allowedStatuses: available, impact: "Maintenance operations run during this window and can briefly interrupt the cluster." },
  { id: "security-group", label: "Change security group", kind: "update", description: "Move the cluster to another security group in this project.", fields: [{ key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true }], allowedStatuses: available, confirmation: true, impact: "Network access rules change immediately. Clients blocked by the new group lose connectivity." },
  { id: "reset-password", label: "Reset administrator password", kind: "action", description: "Set a new password for the cluster administrator account.", fields: [{ ...passwordField, help: "12-32 characters with at least three character groups. It cannot match the administrator username or its reverse, an earlier password, or a common weak password." }], allowedStatuses: available, confirmation: true, impact: "Applications using the old password lose access once the new password takes effect." },
  { id: "restart", label: "Restart cluster", kind: "action", description: "Restart the whole cluster.", fields: [], allowedStatuses: available, confirmation: true, impact: "Connections are closed and the cluster is unavailable until the restart completes." },
  { id: "scale-out", label: "Add nodes", kind: "action", description: "Add nodes to a pay-per-use cluster.", fields: [{ key: "count", label: "Nodes to add", type: "number", required: true, min: 3, max: 256, help: "DWS adds at least 3 nodes at a time; the total node count cannot exceed 256." }], allowedStatuses: available, confirmation: true, impact: "The added nodes are billed immediately and cannot be removed by this workflow." },
  { id: "change-flavor", label: "Change specification", kind: "action", description: "Move a pay-per-use cluster to another supported specification.", fields: [{ key: "offering", label: "New specification", type: "select", source: "resizeOfferings", required: true }], allowedStatuses: available, confirmation: true, impact: "The cluster restarts on the new specification and connections are closed until the change completes. The new specification is billed immediately." },
  { id: "expand-storage", label: "Expand node storage", kind: "action", description: "Increase the effective storage capacity of every node in a pay-per-use cluster.", fields: [{ key: "newSize", label: "New per-node storage (GB)", type: "number", required: true, min: 1, max: 32768, help: "Must exceed the current per-node capacity, stay within the cluster's supported maximum, and follow the native expansion step." }], allowedStatuses: available, confirmation: true, impact: "The expanded storage is billed immediately and cannot be reduced." },
  { id: "snapshots", label: "View snapshots", kind: "inspect", description: "List manual and automatic snapshots of this cluster.", fields: [] },
  { id: "create-snapshot", label: "Create snapshot", kind: "action", description: "Create a full manual snapshot of this cluster.", fields: [snapshotName, descriptionField], allowedStatuses: available, impact: "Snapshot storage is billed while the snapshot is retained." },
  { id: "delete-snapshot", label: "Delete snapshot", kind: "action", description: "Permanently delete one available manual snapshot of this cluster.", fields: [{ key: "snapshot", label: "Manual snapshot", type: "select", source: "snapshots", required: true }], confirmation: true, impact: "The snapshot is permanently removed and can no longer be restored." },
  { id: "restore-snapshot", label: "Restore to new cluster", kind: "action", description: "Restore one available snapshot of this cluster into a new pay-per-use cluster. The new cluster reuses this cluster's network configuration.", fields: [
    { key: "snapshot", label: "Snapshot", type: "select", source: "restorableSnapshots", required: true },
    clusterName,
  ], confirmation: true, impact: "The restored cluster is billed hourly while it exists and contains the snapshot's data. The source cluster keeps running." },
  { id: "delete", label: "Delete cluster", kind: "delete", description: "Permanently delete a pay-per-use cluster and its data. Choose how many of the most recent manual snapshots to retain.", fields: [{ key: "keepSnapshots", label: "Manual snapshots to retain", type: "number", min: 0, max: 100, defaultValue: 0, help: "0 deletes every manual snapshot of this cluster. Retained snapshots continue to incur storage charges." }], allowedStatuses: deletable, confirmation: true, impact: "The cluster and all stored data are permanently removed and billing stops once deletion completes. Retained snapshots continue to incur storage charges." },
];

export const dwsManagement: ManagementAdapter = {
  title: "Data Warehouse Service",
  operations,
  inventory: async (session) => (await listDwsClustersForProject(session)).map((item) => ({
    id: item.id, name: item.name, status: item.status,
    values: { name: item.name, version: item.version, nodeType: item.nodeType, nodes: item.nodes, az: item.availabilityZone, port: item.port, projectId: item.projectId },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [nodeTypes, zones, subnets, groups] = await Promise.all([nodeTypeRows(session), zoneRows(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      const offerings = nodeTypes.filter((nodeType) => !nodeType.elastic && nodeType.stableVersions.length && Object.values(nodeType.azStatus).some((status) => status === "normal")).flatMap((nodeType) => nodeType.stableVersions.map((version) => ({
        value: JSON.stringify([nodeType.specName, version]),
        label: `${nodeType.specName} · ${version} · ${nodeType.vcpus} vCPU · ${nodeType.ram} GB RAM`,
      })));
      return {
        offerings,
        zones: zones.filter((zone) => zone.status === "available").map((zone) => ({ value: zone.code, label: zone.name && zone.name !== zone.code ? `${zone.name} · ${zone.code}` : zone.code })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
      };
    }
    if (operation === "maintenance-window") return {
      days: weekdays.map((day) => ({ value: day, label: day })),
      hours: wholeHours.map((hour) => ({ value: hour, label: `${hour} UTC` })),
    };
    if (!resource) return {};
    if (operation === "security-group") {
      const groups = await listSecurityGroupsForProject(session);
      return { securityGroups: groups.map((group) => ({ value: group.id, label: group.name })) };
    }
    if (operation === "delete-snapshot" || operation === "restore-snapshot") {
      const rows = await snapshotRows(session, resource.id);
      const restorable = rows.filter((row) => firstString([row.status], "") === "AVAILABLE");
      if (operation === "restore-snapshot") return { restorableSnapshots: restorable.map((row) => ({ value: firstString([row.id], ""), label: `${firstString([row.name], "-")} · ${firstString([row.type], "-")} · ${firstString([row.started], "-")}` })) };
      return { snapshots: restorable.filter((row) => firstString([row.type], "") === "MANUAL").map((row) => ({ value: firstString([row.id], ""), label: `${firstString([row.name], "-")} · ${firstString([row.started], "-")}` })) };
    }
    if (operation === "change-flavor") {
      const record = await clusterRecord(session, resource.id);
      const flavorId = firstString([record.node_type_id], "");
      if (!flavorId) return {};
      const flavors = await targetFlavorRows(session, flavorId, resource.id);
      return { resizeOfferings: flavors.filter((flavor) => flavor.id && !flavor.current).map((flavor) => ({ value: flavor.id, label: `${flavor.name} · ${flavor.vcpus} vCPU · ${flavor.ram} GB RAM` })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    const response = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v1.0/${session.projectId}/job/${encodeURIComponent(entry.jobId!)}`);
    const jobId = firstString([response.job_id], "");
    if (!entry.jobId || jobId !== entry.jobId) throw new ManagementInputError("Huawei returned a different DWS task.");
    const status = firstString([response.status], "");
    const progress = firstString([response.progress], "");
    if (status === "SUCCESS") return { state: "succeeded", message: "The DWS cloud task completed successfully." };
    if (status === "FAIL" || status === "STOP") return { state: "failed", message: status === "STOP" ? "The DWS cloud task was stopped before completion." : "The DWS cloud task failed. Review the cluster status before retrying." };
    return { state: "submitted", message: `The DWS cloud task is ${status || "still processing"}${progress ? ` (${progress})` : ""}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listDwsClusters, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      const [specName, version] = parseOffering(values.offering).map(String);
      if (!specName || !version) throw new ManagementInputError("Select an available specification and version.");
      const numNode = Number(values.numNode);
      if (!Number.isSafeInteger(numNode) || numNode < 3 || numNode > 256) throw new ManagementInputError("The node count must be between 3 and 256.");
      const dbPort = Number(values.dbPort ?? 8000);
      if (!Number.isSafeInteger(dbPort) || dbPort < 8000 || dbPort > 30000) throw new ManagementInputError("The database port must be between 8000 and 30000.");
      const account = String(values.adminUser ?? "dbadmin");
      assertPassword(String(values.password), "create", account);
      const [nodeTypes, zones, subnets, groups] = await Promise.all([nodeTypeRows(session), zoneRows(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      const nodeType = nodeTypes.find((item) => item.specName === specName);
      if (!nodeType || nodeType.elastic) throw new ManagementInputError("The selected specification is no longer available.");
      if (!nodeType.stableVersions.includes(version)) throw new ManagementInputError("The selected version is no longer available for this specification.");
      const zone = String(values.zone);
      if (nodeType.azStatus[zone] !== "normal") throw new ManagementInputError("The selected specification is not on sale in this availability zone.");
      if (!zones.some(item => item.code === zone && item.status === "available")) throw new ManagementInputError("The selected availability zone is no longer available.", 409);
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (["", "-"].includes(subnet.neutronNetworkId)) throw new ManagementInputError("The selected subnet does not expose the network ID that DWS requires.");
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v2/${session.projectId}/clusters`, { method: "POST", body: JSON.stringify({ cluster: {
        name: values.name,
        flavor: specName,
        num_node: numNode,
        db_name: account,
        db_password: values.password,
        db_port: dbPort,
        availability_zones: [zone],
        vpc_id: subnet.vpcId,
        subnet_id: subnet.neutronNetworkId,
        security_group_id: values.securityGroup,
        datastore_version: version,
        public_ip: { public_bind_type: "not_use" },
        enterprise_project_id: values.enterpriseProjectId ?? "0",
      } }) });
      return { message: "Cluster creation submitted. The cluster is private without a public IP; it appears in the cluster list while creating and typically becomes available in 10 to 15 minutes.", resourceId: createdCluster(response), asynchronous: true };
    }
    if (!resource) throw new ManagementInputError("Select a current warehouse cluster.");
    const cluster = resource;
    if (!["inspect", "progress", "quotas", "metrics", "snapshots"].includes(operation)) {
      const current = await clusterRecord(session, cluster.id);
      const permitted = operations.find(item => item.id === operation)?.allowedStatuses ?? available;
      if (!permitted.includes(firstString([current.status], ""))) throw new ManagementInputError("This operation is unavailable in the cluster's current or unknown state.", 409);
      assertNoInFlightTask(current);
    }
    if (operation === "inspect") {
      const [record, nodes, configurations] = await Promise.all([
        clusterRecord(session, cluster.id),
        nodeRows(session, cluster.id),
        huaweiFetch<Record<string, unknown>>(session, "dws", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/configurations`),
      ]);
      const endpoints = asArray(record.endpoints).map(asRecord).map((endpoint) => firstString([endpoint.connect_info], "")).filter(Boolean);
      const window = asRecord(record.maintain_window);
      const parameterGroup = asRecord(record.parameter_group);
      const publicIp = firstString([asRecord(record.public_ip).eip_address], "");
      const facts = [
        { label: "Status", value: [firstString([record.status], "-"), firstString([record.sub_status], "")].filter(Boolean).join(" · ") },
        { label: "Version and specification", value: `${firstString([record.version], "-")} · ${firstString([record.node_type], "-")} · ${Number(record.number_of_node) || 0} nodes` },
        { label: "Availability zone", value: firstString([record.availability_zone], "-") },
        { label: "Administrator", value: firstString([record.user_name], "-") },
        { label: "Database port", value: String(record.port ?? "-") },
        { label: "Private endpoints", value: endpoints.join(", ") || firstString([asArray(record.private_ip).map(String).join(", ")], "None reported") },
        { label: "Public IP", value: publicIp || "Not bound (private only)" },
        { label: "Network", value: `VPC ${firstString([record.vpc_id], "-")} · subnet ${firstString([record.subnet_id], "-")} · security group ${firstString([record.security_group_id], "-")}` },
        { label: "Maintenance window", value: [firstString([window.day], ""), firstString([window.start_time], ""), firstString([window.end_time], "")].filter(Boolean).join(" ") || "Not set" },
        { label: "Parameter group", value: [firstString([parameterGroup.name], ""), firstString([parameterGroup.status], "")].filter(Boolean).join(" · ") || "None reported" },
        { label: "Enterprise project", value: firstString([record.enterprise_project_id], "-") },
        { label: "Tags", value: asArray(record.tags).map(asRecord).map((tag) => `${firstString([tag.key], "")}=${firstString([tag.value], "")}`).filter(Boolean).join(", ") || "None" },
        ...asArray(configurations.configurations).map(asRecord).map((group) => ({ label: `Parameter group ${firstString([group.name], "-")}`, value: `${firstString([group.type], "-")} · ${firstString([group.status], "-")}` })),
        ...nodes.map((node) => ({ label: `${firstString([node.name], "-")} · ${nodeStatusCodes[firstString([node.status], "")] ?? firstString([node.status], "-")}`, value: [firstString([node.spec], ""), firstString([node.az_code], "")].filter(Boolean).join(" · ") || "No specification reported" })),
      ];
      return { message: `${facts.length} cluster details loaded.`, resourceId: cluster.id, facts };
    }
    if (operation === "progress") {
      const record = await clusterRecord(session, cluster.id);
      const task = firstString([record.task_status], "");
      const progress = Object.entries(asRecord(record.action_progress)).map(([name, value]) => `${name}: ${String(value)}`);
      const failure = asRecord(record.failed_reasons);
      const facts = [
        { label: "Status", value: firstString([record.status], "-") },
        { label: "Sub-status", value: firstString([record.sub_status], "None reported") },
        { label: "Running task", value: task || "None" },
        ...progress.map((entry) => ({ label: "Task progress", value: entry })),
        { label: "Recent events", value: String(record.recent_event ?? 0) },
        ...(failure.error_code ? [{ label: "Last failure code", value: firstString([failure.error_code], "") }] : []),
      ];
      return { message: task ? `The cluster is running the ${task} task.` : "No management task is running.", resourceId: cluster.id, facts };
    }
    if (operation === "quotas") {
      const body = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v1.0/${session.projectId}/quotas`);
      const rows = asArray(asRecord(body.quotas).resources).map(asRecord);
      return { message: `${rows.length} project quotas loaded.`, resourceId: cluster.id, facts: rows.map((row) => ({ label: firstString([row.type], "-"), value: `${Number(row.used) || 0} used of ${Number(row.quota) || 0} ${firstString([row.unit], "")}`.trim() })) };
    }
    if (operation === "metrics") {
      const body = await huaweiList<Record<string, unknown>>(session, "dws", `/v1/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/dms/metrics?limit=100`, { items: ["data"], kind: "offset", parameter: "offset", size: 100, total: ["count"] });
      const rows = asArray(body.data).map(asRecord);
      return { message: `${rows.length} supported metrics loaded.`, resourceId: cluster.id, facts: rows.map((row) => ({ label: firstString([row.metric_name, row.scope], "-"), value: [firstString([row.scope, row.metric_name], ""), firstString([row.collect_rate], "") && `collect rate ${firstString([row.collect_rate], "")}`, firstString([row.collect_range], "") && `collect range ${firstString([row.collect_range], "")}`].filter(Boolean).join(" · ") || "No collection details reported" })) };
    }
    if (operation === "rename") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v1/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/cluster-name`, { method: "PUT", body: JSON.stringify({ cluster_name: values.name }) });
      return { message: "Cluster rename submitted.", resourceId: cluster.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "describe") {
      const description = String(values.description ?? "");
      if (/[!<>'=&"\\]/.test(description)) throw new ManagementInputError("The description contains unsupported DWS characters.");
      await huaweiFetch(session, "dws", `/v1/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/description`, { method: "POST", body: JSON.stringify({ description_info: description }) });
      return { message: "Cluster description updated.", resourceId: cluster.id };
    }
    if (operation === "maintenance-window") {
      const day = String(values.day);
      const start = String(values.start);
      const end = String(values.end);
      if (!weekdays.includes(day)) throw new ManagementInputError("Select a weekday for the maintenance window.");
      if (!wholeHours.includes(start) || !wholeHours.includes(end)) throw new ManagementInputError("The maintenance window start and end must be whole hours.");
      if ((Number(end.slice(0, 2)) - Number(start.slice(0, 2)) + 24) % 24 !== 4) throw new ManagementInputError("The maintenance window start and end must be exactly four hours apart.");
      await huaweiFetch(session, "dws", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/maintenance-window`, { method: "PUT", body: JSON.stringify({ day, start_time: start, end_time: end }) });
      return { message: "Maintenance window updated.", resourceId: cluster.id };
    }
    if (operation === "security-group") {
      const groups = await listSecurityGroupsForProject(session);
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const record = await clusterRecord(session, cluster.id);
      if (firstString([record.security_group_id], "") === values.securityGroup) throw new ManagementInputError("The cluster already uses this security group.", 409);
      await huaweiFetch(session, "dws", `/v1/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/security-group`, { method: "PUT", body: JSON.stringify({ security_groups: [values.securityGroup] }) });
      return { message: "Security group change accepted.", resourceId: cluster.id };
    }
    if (operation === "reset-password") {
      const record = await clusterRecord(session, cluster.id);
      assertNoInFlightTask(record);
      assertPassword(String(values.password), "reset", firstString([record.user_name], ""));
      await huaweiFetch(session, "dws", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/reset-password`, { method: "POST", body: JSON.stringify({ new_password: values.password }) });
      return { message: "Password reset accepted. The new password takes effect within a few minutes.", resourceId: cluster.id };
    }
    if (operation === "restart") {
      const record = await clusterRecord(session, cluster.id);
      assertNoInFlightTask(record);
      await huaweiFetch(session, "dws", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/restart`, { method: "POST", body: JSON.stringify({ restart: {} }) });
      return { message: "Cluster restart submitted. The cluster reboots and becomes unavailable until the restart completes; refresh the cluster list to verify.", resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "scale-out") {
      const record = await clusterRecord(session, cluster.id);
      assertPayPerUse(record);
      assertNoInFlightTask(record);
      const count = Number(values.count);
      if (!Number.isSafeInteger(count) || count < 3 || count > 256) throw new ManagementInputError("DWS adds at least 3 nodes at a time, up to the 256-node limit.");
      const current = Number(record.number_of_node) || 0;
      if (!Number.isSafeInteger(current) || current < 3) throw new ManagementInputError("The cluster's current node count could not be loaded. Retry the operation.");
      if (current + count > 256) throw new ManagementInputError(`The cluster has ${current} nodes; adding ${count} would exceed the 256-node limit.`);
      await huaweiFetch(session, "dws", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/resize`, { method: "POST", body: JSON.stringify({ scale_out: { count } }) });
      return { message: `Node expansion from ${current} to ${current + count} nodes submitted. Refresh the cluster list to verify progress.`, resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "change-flavor") {
      const record = await clusterRecord(session, cluster.id);
      assertPayPerUse(record);
      assertNoInFlightTask(record);
      const flavorId = firstString([record.node_type_id], "");
      if (!flavorId) throw new ManagementInputError("The cluster's current specification could not be loaded. Retry the operation.");
      const flavors = await targetFlavorRows(session, flavorId, cluster.id);
      const target = flavors.find((flavor) => flavor.id === values.offering);
      if (!target) throw new ManagementInputError("The selected specification is no longer available for this cluster.");
      if (target.current) throw new ManagementInputError("The new specification must differ from the current one.", 409);
      await huaweiFetch(session, "dws", `/v1/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/flavor`, { method: "POST", body: JSON.stringify({ target_flavor_id: target.id }) });
      return { message: "Specification change submitted. The cluster restarts on the new specification; refresh the cluster list to verify progress.", resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "expand-storage") {
      const record = await clusterRecord(session, cluster.id);
      assertPayPerUse(record);
      assertNoInFlightTask(record);
      const range = await storageRange(session, cluster.id);
      const newSize = Number(values.newSize);
      if (!Number.isSafeInteger(newSize)) throw new ManagementInputError("Use an integer storage capacity.");
      if (newSize <= range.current) throw new ManagementInputError(`The new per-node storage must exceed the current ${range.current} GB.`);
      if (newSize > range.max) throw new ManagementInputError(`The new per-node storage cannot exceed the supported ${range.max} GB.`);
      if ((newSize - range.min) % range.step !== 0) throw new ManagementInputError(`The new per-node storage must follow the native ${range.step} GB expansion step starting at ${range.min} GB.`);
      await huaweiFetch(session, "dws", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/expand-instance-storage`, { method: "POST", body: JSON.stringify({ new_size: newSize }) });
      return { message: `Storage expansion to ${newSize} GB per node submitted. Refresh the cluster list to verify progress.`, resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "snapshots") {
      const rows = await snapshotRows(session, cluster.id);
      return { message: `${rows.length} snapshots loaded.`, resourceId: cluster.id, facts: rows.map((row) => ({ label: `${firstString([row.name], "-")} · ${firstString([row.type], "-")} · ${firstString([row.status], "-")}`, value: `${firstString([row.started], "-")} · ${Number(row.size) || 0} GB · ${firstString([row.id], "-")}` })) };
    }
    if (operation === "create-snapshot") {
      const record = await clusterRecord(session, cluster.id);
      assertNoInFlightTask(record);
      const description = String(values.description ?? "").trim();
      if (/[!<>'=&"\\]/.test(description)) throw new ManagementInputError("The description cannot contain the characters ! < > ' = & \" \\.");
      await huaweiFetch(session, "dws", `/v1.0/${session.projectId}/snapshots`, { method: "POST", body: JSON.stringify({ snapshot: { name: values.name, cluster_id: cluster.id, ...(description ? { description } : {}) } }) });
      return { message: "Snapshot creation submitted. The snapshot appears in this cluster's snapshot list while it is being created.", resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "delete-snapshot") {
      const rows = await snapshotRows(session, cluster.id);
      const snapshot = rows.find((row) => firstString([row.id], "") === values.snapshot);
      if (!snapshot) throw new ManagementInputError("Select a manual snapshot of this cluster.", 404);
      if (firstString([snapshot.type], "") !== "MANUAL") throw new ManagementInputError("Only manual snapshots can be deleted.", 409);
      if (firstString([snapshot.status], "") !== "AVAILABLE") throw new ManagementInputError("Only available snapshots can be deleted.", 409);
      await huaweiFetch(session, "dws", `/v1.0/${session.projectId}/snapshots/${encodeURIComponent(String(values.snapshot))}`, { method: "DELETE" });
      return { message: "Snapshot deletion submitted. The snapshot is permanently removed once deletion completes.", resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "restore-snapshot") {
      const rows = await snapshotRows(session, cluster.id);
      const snapshot = rows.find((row) => firstString([row.id], "") === values.snapshot);
      if (!snapshot) throw new ManagementInputError("Select a snapshot of this cluster.", 404);
      if (firstString([snapshot.status], "") !== "AVAILABLE") throw new ManagementInputError("Only available snapshots can be restored.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "dws", `/v1.0/${session.projectId}/snapshots/${encodeURIComponent(String(values.snapshot))}/actions`, { method: "POST", body: JSON.stringify({ restore: { name: values.name, public_ip: { public_bind_type: "not_use" } } }) });
      return { message: "Restore submitted. The new cluster reuses this cluster's private network configuration without a public IP and appears in the cluster list while it is being restored.", resourceId: createdCluster(response), jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "delete") {
      const record = await clusterRecord(session, cluster.id);
      assertPayPerUse(record);
      assertNoInFlightTask(record);
      const keepSnapshots = Number(values.keepSnapshots ?? 0);
      if (!Number.isSafeInteger(keepSnapshots) || keepSnapshots < 0 || keepSnapshots > 100) throw new ManagementInputError("The retained manual snapshot count must be between 0 and 100.");
      await huaweiFetch(session, "dws", `/v2/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}?${new URLSearchParams({ keep_last_manual_backup: String(keepSnapshots) })}`, { method: "DELETE" });
      return { message: "Cluster deletion submitted. The cluster, its data, and unretained snapshots are permanently removed; billing stops once deletion completes.", resourceId: cluster.id, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported DWS operation.");
  },
};
