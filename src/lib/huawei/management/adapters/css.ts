import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listCssClustersForProject } from "@/lib/huawei/services/css";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const clusterName: ManagementField = { key: "name", label: "Cluster name", required: true, min: 4, max: 32, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,31}$", help: "4-32 characters starting with a letter; letters, digits, hyphens, and underscores only." };
const clusterDescription: ManagementField = { key: "description", label: "Description", type: "textarea", allowEmpty: true, max: 128, help: "A nonempty description replaces the current description; leave blank to preserve it when renaming." };
const snapshotName: ManagementField = { key: "name", label: "Snapshot name", required: true, min: 4, max: 64, pattern: "^[a-z][a-z0-9_-]{3,63}$", help: "4-64 lowercase characters starting with a letter." };
const adminPassword: ManagementField = { key: "adminPassword", label: "Administrator password", type: "password", min: 8, max: 32, help: "Required for security clusters. 8-32 characters combining at least three of lowercase letters, uppercase letters, digits, and the special characters ~!@#$%&*()-_=|[{}];:,<.>/?." };
const available = ["200"];
const volumeTypes: ManagementChoice[] = [["COMMON", "common I/O"], ["HIGH", "high I/O"], ["ULTRAHIGH", "ultra-high I/O"], ["ESSD", "extreme SSD"]].map(([value, label]) => ({ value, label: `${value} · ${label}` }));
const frequencies: ManagementChoice[] = ["HOUR", "DAY", "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((value) => ({ value, label: value }));
// CreateClusterMultiRole documents the only creatable engine versions; live flavor versions are matched against these enums and anything else is skipped.
const creatableVersions: Record<string, string[]> = { elasticsearch: ["7.6.2", "7.10.2"], opensearch: ["2.19.0", "3.4.0"] };

const operations: ManagementOperation[] = [
  { id: "create", label: "Create cluster", kind: "create", description: "Create one private pay-per-use Elasticsearch or OpenSearch cluster from live version, flavor, zone, and network choices.", impact: "Nodes and storage are billed hourly while the cluster exists. No public access is attached; clients connect through the selected subnet.", fields: [
    clusterName,
    clusterDescription,
    { key: "offering", label: "Engine, version, and flavor", type: "select", source: "offerings", required: true, max: 512 },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "nodeCount", label: "Data node count", type: "number", required: true, min: 1, max: 32, defaultValue: 1 },
    { key: "volumeType", label: "Volume type", type: "select", choices: volumeTypes, required: true },
    { key: "diskSizeGb", label: "Disk capacity per node (GB)", type: "number", required: true, min: 40, max: 51200, defaultValue: 100, help: "Multiple of 20 GB within the flavor's documented disk range." },
    { key: "securityMode", label: "Security mode (authentication and HTTPS)", type: "boolean", defaultValue: true },
    adminPassword,
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "rename", label: "Rename cluster", kind: "update", description: "Change the cluster's display name and description without restarting it.", fields: [clusterName, clusterDescription] },
  { id: "inspect", label: "Inspect configuration", kind: "inspect", description: "Show the cluster's live engine, network, security, billing, node, and snapshot-policy configuration.", fields: [] },
  { id: "restart", label: "Restart data nodes", kind: "action", description: "Rolling-restart the cluster's data nodes.", fields: [], allowedStatuses: available, confirmation: true, impact: "Data nodes restart one by one and clients lose connections to each node while it restarts. Rolling restart requires more than three nodes in total." },
  { id: "change-flavor", label: "Change data node specification", kind: "action", description: "Move the cluster's data nodes to a different on-sale specification from the live resize catalog.", fields: [{ key: "flavor", label: "New data node specification", type: "select", source: "resizeFlavors", required: true }], allowedStatuses: available, confirmation: true, impact: "Data nodes are replaced with the new specification and the new specification is billed. The change runs as a cloud task and can take up to 48 hours per node." },
  { id: "expand-storage", label: "Expand data node storage", kind: "action", description: "Increase each data node's disk capacity without changing the node count.", fields: [{ key: "growSizeGb", label: "Storage increment per node (GB)", type: "number", required: true, min: 20, max: 51200, help: "Increment in multiples of 20 GB; storage cannot be reduced." }], allowedStatuses: available, confirmation: true, impact: "The expanded storage is billed immediately and cannot be reduced through this operation." },
  { id: "delete", label: "Delete cluster", kind: "delete", description: "Permanently delete a pay-per-use cluster and all of its data. Subscription cancellation requires a separate order workflow.", fields: [], confirmation: true, impact: "The cluster and all stored data are permanently removed. Create a snapshot first if data must be retained; retained snapshots continue to incur storage charges." },
  { id: "snapshots", label: "View snapshots", kind: "inspect", description: "List manual and automatic snapshots of this cluster.", fields: [] },
  { id: "create-snapshot", label: "Create manual snapshot", kind: "action", description: "Start a manual snapshot of all or selected indices.", fields: [snapshotName,
    { key: "description", label: "Description", type: "textarea", allowEmpty: true, max: 256, help: "Cannot contain the characters ! < > = & \" '." },
    { key: "indices", label: "Indices", max: 1024, help: "Comma-separated index names or a * prefix pattern. Leave empty to snapshot all indices." },
  ] },
  { id: "delete-snapshot", label: "Delete manual snapshot", kind: "action", description: "Permanently delete one completed manual snapshot of this cluster.", fields: [{ key: "snapshot", label: "Snapshot", type: "select", source: "snapshots", required: true }], confirmation: true, impact: "The snapshot is permanently removed and can no longer be restored." },
  { id: "snapshot-policy", label: "Set automatic snapshot policy", kind: "update", description: "Enable or disable automatic snapshots and set their schedule and retention.", fields: [
    { key: "enable", label: "Enable automatic snapshots", type: "boolean", defaultValue: true },
    { key: "prefix", label: "Snapshot name prefix", max: 32, pattern: "^[a-z][a-z0-9_-]{0,31}$", help: "1-32 lowercase letters, digits, hyphens, or underscores starting with a lowercase letter. Required when enabling." },
    { key: "frequency", label: "Frequency", type: "select", choices: frequencies, defaultValue: "DAY" },
    { key: "period", label: "Start time (whole hour with timezone)", max: 32, pattern: "^([01][0-9]|2[0-3]):00 GMT[+-](0[0-9]|1[0-2]):00$", help: "Format HH:mm GMT+HH:00, for example 00:00 GMT-03:00. Not needed for hourly frequency." },
    { key: "keepday", label: "Retention (days)", type: "number", min: 1, max: 90 },
    { key: "indices", label: "Indices", max: 1024, help: "Leave empty for all indices." },
    { key: "deleteAuto", label: "Delete existing automatic snapshots when disabling", type: "boolean", defaultValue: false },
  ], allowedStatuses: available, confirmation: true, impact: "Enabling replaces the previous schedule. Disabling with deletion permanently removes every automatic snapshot; without deletion they can no longer be deleted manually." },
];

type EsFlavor = { engine: string; version: string; name: string; flavorId: string; cpu: number; ram: number; diskMin: number; diskMax: number; azs: string[] };
type ResizeTarget = { version: string; azs: string[]; flavorId: string; name: string; cpu: number; ram: number; diskMin: number; diskMax: number };

function diskBounds(range: string) {
  const [min, max] = range.split(",").map(Number);
  return { diskMin: Number.isFinite(min) ? min : 0, diskMax: Number.isFinite(max) ? max : 0 };
}

/** Live data-node catalog; local-disk flavors (equal diskrange bounds) are skipped because the create contract has no volume payload for them. */
async function esFlavors(session: BetterUiSession): Promise<EsFlavor[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "css", `/v1.0/${session.projectId}/es-flavors`);
  return asArray(body.versions).map(asRecord).flatMap((entry) => {
    const version = firstString([entry.version], "");
    const engine = Object.keys(creatableVersions).find((candidate) => creatableVersions[candidate].includes(version));
    if (!engine || firstString([entry.type], "") !== "ess") return [];
    return asArray(entry.flavors).map(asRecord).map((flavor) => ({
      engine,
      version,
      name: firstString([flavor.name], ""),
      flavorId: firstString([flavor.flavor_id], ""),
      cpu: Number(flavor.cpu) || 0,
      ram: Number(flavor.ram) || 0,
      ...diskBounds(firstString([flavor.diskrange], "")),
      azs: firstString([flavor.availableAZ], "").split(",").map((zone) => zone.trim()).filter(Boolean),
    }));
  }).filter((flavor) => flavor.name && flavor.flavorId && flavor.diskMin > 0 && flavor.diskMin !== flavor.diskMax);
}

async function clusterDetail(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "css", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(id)}`);
  if (body.id !== id) throw new ManagementInputError("Huawei returned a different search cluster.", 404);
  return asRecord(body);
}

function essNodes(detail: Record<string, unknown>) {
  return asArray(detail.instances).map(asRecord).filter((node) => firstString([node.type], "") === "ess");
}

function assertAvailable(detail: Record<string, unknown>) {
  if (firstString([detail.status], "") !== "200") throw new ManagementInputError("This operation is unavailable while the cluster is not in the available state.", 409);
}

async function snapshots(session: BetterUiSession, clusterId: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "css", `/v1.0/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/index_snapshots`);
  return asArray(body.backups).map(asRecord).filter(row => row.clusterId === clusterId);
}

function snapshotId(item: Record<string, unknown>) {
  return firstString([item.id], "");
}

/** Targets come from the cluster-scoped resize catalog; the submitted ID is the ListFlavors flavor_id documented for UpdateFlavorByType. */
async function resizeCandidates(session: BetterUiSession, clusterId: string): Promise<ResizeTarget[]> {
  const [resize, flavors] = await Promise.all([
    huaweiFetch<Record<string, unknown>>(session, "css", `/v1.0/${session.projectId}/resize-flavors?${new URLSearchParams({ clusterId })}`),
    esFlavors(session),
  ]);
  return asArray(resize.versions).map(asRecord).flatMap((version) => asArray(version.flavors).map(asRecord).flatMap((flavor) => {
    if (firstString([flavor.typename], "") !== "ess") return [];
    if (firstString([flavor.condOperationStatus, flavor.cond_operation_status], "") !== "normal" || flavor.localdisk === true || flavor.edge === true) return [];
    const name = firstString([flavor.name], "");
    const catalog = flavors.find((item) => item.version === firstString([version.name], "") && item.name === name);
    return catalog ? [{ version: catalog.version, azs: catalog.azs, flavorId: catalog.flavorId, name, cpu: Number(flavor.cpu) || 0, ram: Number(flavor.ram) || 0, ...diskBounds(firstString([flavor.diskrange], "")) }] : [];
  }));
}

function assertAdminPassword(value: string) {
  if (value.length < 8 || value.length > 32) throw new ManagementInputError("The administrator password must be 8 to 32 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The administrator password must combine at least three of lowercase letters, uppercase letters, digits, and special characters.");
  if (!/^[A-Za-z0-9~!@#$%&*()\-_=|\[{}\];:,<.>\/?]+$/.test(value)) throw new ManagementInputError("The administrator password uses characters outside the supported set.");
}

function assertIndices(value: string) {
  if (/[A-Z]/.test(value) || /\s/.test(value) || /["<|>/?]/.test(value)) throw new ManagementInputError("Indices cannot contain uppercase letters, spaces, or the characters \" < | > / ?.");
}

export const cssManagement: ManagementAdapter = {
  title: "Cloud Search Service",
  operations,
  inventory: async (session) => (await listCssClustersForProject(session)).map((item) => {
    const [engine, version] = item.datastore.includes(" ") ? item.datastore.split(" ") : ["", ""];
    return { id: item.id, name: item.name, status: item.status, values: { name: item.name, engine, version, nodeCount: item.nodeCount, projectId: item.projectId } };
  }),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [flavors, subnets, groups] = await Promise.all([esFlavors(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      return {
        offerings: flavors.map((flavor) => ({ value: JSON.stringify([flavor.engine, flavor.version, flavor.name]), label: `${flavor.engine} ${flavor.version} · ${flavor.name} · ${flavor.cpu} vCPU · ${flavor.ram} GB RAM` })),
        zones: [...new Set(flavors.flatMap((flavor) => flavor.azs))].map((zone) => ({ value: zone, label: zone })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
      };
    }
    if (!resource) return {};
    if (operation === "change-flavor") {
      const detail = await clusterDetail(session, resource.id);
      const nodes = essNodes(detail);
      return { resizeFlavors: (await resizeCandidates(session, resource.id)).filter(target => target.version === asRecord(detail.datastore).version && nodes.length && nodes.every(node => typeof node.azCode === "string" && target.azs.includes(node.azCode) && Number(asRecord(node.volume).size) > 0 && Number(asRecord(node.volume).size) <= target.diskMax)).map((flavor) => ({ value: flavor.flavorId, label: `${flavor.name} · ${flavor.cpu} vCPU · ${flavor.ram} GB RAM · disk ${flavor.diskMin}-${flavor.diskMax} GB` })) };
    }
    if (operation === "delete-snapshot") {
      return { snapshots: (await snapshots(session, resource.id)).filter(row => row.backupType === "1" && row.status === "COMPLETED").map((item) => ({ value: snapshotId(item), label: `${firstString([item.name], "Snapshot")} · ${firstString([item.status], "")} · ${firstString([item.created], "")}` })).filter((choice) => !!choice.value) };
    }
    return {};
  },
  invalidationKeys: () => [cloudCacheKeys.listCssClusters, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    const base = `/v1.0/${session.projectId}/clusters`;
    if (operation === "create") {
      let offering: unknown;
      try { offering = JSON.parse(String(values.offering)); } catch { throw new ManagementInputError("Select an available engine, version, and flavor."); }
      const [engine, version, flavorName] = Array.isArray(offering) ? offering : [];
      if (typeof engine !== "string" || typeof version !== "string" || typeof flavorName !== "string" || !(engine in creatableVersions) || !creatableVersions[engine].includes(version)) throw new ManagementInputError("Select an available engine, version, and flavor.");
      const [flavors, subnets, groups] = await Promise.all([esFlavors(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      const flavor = flavors.find((item) => item.engine === engine && item.version === version && item.name === flavorName);
      if (!flavor) throw new ManagementInputError("The selected engine, version, or flavor is no longer available.");
      const zone = String(values.zone);
      if (!flavor.azs.includes(zone)) throw new ManagementInputError("The selected flavor is unavailable in this availability zone.");
      const diskSizeGb = Number(values.diskSizeGb);
      if (diskSizeGb % 20) throw new ManagementInputError("Disk capacity must be a multiple of 20 GB.");
      if (diskSizeGb < flavor.diskMin || diskSizeGb > flavor.diskMax) throw new ManagementInputError(`Disk capacity must be between ${flavor.diskMin} and ${flavor.diskMax} GB for this flavor.`);
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet || ["", "-"].includes(subnet.neutronNetworkId)) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const securityMode = values.securityMode === true;
      const secret = String(values.adminPassword ?? "");
      if (securityMode && !secret) throw new ManagementInputError("The administrator password is required for security clusters.");
      if (secret) assertAdminPassword(secret);
      const description = String(values.description ?? "").trim();
      const response = await huaweiFetch<Record<string, unknown>>(session, "css", `/v2.0/${session.projectId}/clusters`, { method: "POST", body: JSON.stringify({ cluster: {
        name: values.name,
        ...(description ? { desc: description } : {}),
        roles: [{ flavorRef: flavor.name, volume: { volume_type: values.volumeType, size: diskSizeGb }, type: "ess", instanceNum: Number(values.nodeCount) }],
        nics: { vpcId: subnet.vpcId, netId: subnet.neutronNetworkId, securityGroupId: values.securityGroup },
        availability_zone: zone,
        datastore: { version, type: engine },
        enterprise_project_id: values.enterpriseProjectId ?? "0",
        ...(securityMode ? { authorityEnable: true, httpsEnable: true, adminPwd: secret } : {}),
      } }) });
      if (!firstString([asRecord(response.cluster).id], "")) throw new Error("Huawei returned no cluster ID. Check current clusters before creating another one.");
      return { message: "Cluster creation submitted. The cluster is private; configure public access separately if needed.", resourceId: firstString([asRecord(response.cluster).id], "") || undefined, asynchronous: true };
    }
    const cluster = resource!;
    if (operation === "rename") {
      const description = String(values.description ?? "").trim();
      await huaweiFetch(session, "css", `${base}/${encodeURIComponent(cluster.id)}/changename`, { method: "POST", body: JSON.stringify({ display_name: values.name, ...(description ? { desc: description } : {}) }) });
      return { message: "Cluster renamed.", resourceId: cluster.id };
    }
    if (operation === "inspect") {
      const detail = await clusterDetail(session, cluster.id);
      const datastore = asRecord(detail.datastore);
      const policy = asRecord(detail.snapshotPolicy);
      const nodes = asArray(detail.instances).map(asRecord);
      const byType = new Map<string, Record<string, unknown>[]>();
      for (const node of nodes) byType.set(firstString([node.type], "unknown"), [...(byType.get(firstString([node.type], "unknown")) ?? []), node]);
      const failed = asRecord(detail.failedReason);
      return { message: `Configuration for ${firstString([detail.name], cluster.name)} loaded.`, resourceId: cluster.id, facts: [
        { label: "Engine", value: `${firstString([datastore.type], "-")} ${firstString([datastore.version], "-")}`.trim() },
        { label: "Private endpoint", value: firstString([detail.endpoint], "Not reported") },
        { label: "HTTPS", value: detail.httpsEnable === true ? "Enabled" : "Disabled" },
        { label: "Security mode", value: detail.authorityEnable === true ? "Enabled" : "Disabled" },
        { label: "Disk encryption", value: detail.diskEncrypted === true ? "Enabled" : "Disabled" },
        { label: "Billing mode", value: detail.period === true ? "Subscription" : detail.period === false ? "Pay-per-use" : "Not reported" },
        { label: "Created", value: firstString([detail.created], "-") },
        { label: "Updated", value: firstString([detail.updated], "-") },
        { label: "Description", value: firstString([detail.desc], "None") },
        ...[...byType.entries()].map(([type, list]) => {
          const volume = asRecord(list[0].volume);
          return { label: `${type} nodes (${list.length})`, value: `${firstString([list[0].specCode], "-")} · ${firstString([list[0].azCode], "-")} · ${firstString([volume.type], "-")} · ${Number(volume.size) || 0} GB` };
        }),
        { label: "Automatic snapshots", value: policy.backupEnable === true ? `${firstString([policy.bakFrequency], "-")} at ${firstString([policy.bakPeriod], "-")}, kept ${String(policy.bakKeepDay ?? "-")} days` : "Disabled" },
        ...(asArray(detail.actions).length ? [{ label: "Tasks in progress", value: asArray(detail.actions).map(String).join(", ") }] : []),
        ...(firstString([failed.errorCode], "") ? [{ label: "Last failure", value: "Huawei reported a failure. Check native task details for diagnostics." }] : []),
      ] };
    }
    if (operation === "restart") {
      const detail = await clusterDetail(session, cluster.id);
      assertAvailable(detail);
      if (asArray(detail.instances).length <= 3) throw new ManagementInputError("Rolling restart requires more than three nodes in total; this cluster has fewer.", 409);
      await huaweiFetch(session, "css", `/v2.0/${session.projectId}/clusters/${encodeURIComponent(cluster.id)}/restart`, { method: "POST", body: JSON.stringify({ type: "role", value: "ess" }) });
      return { message: "Data node rolling restart submitted.", resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "change-flavor") {
      const detail = await clusterDetail(session, cluster.id);
      assertAvailable(detail);
      const nodes = essNodes(detail);
      if (!nodes.length) throw new ManagementInputError("This cluster has no data nodes; the specification cannot be changed through this operation.", 409);
      const currentSpec = firstString([nodes[0].specCode], "");
      const target = (await resizeCandidates(session, cluster.id)).find((item) => item.flavorId === values.flavor);
      if (!target) throw new ManagementInputError("The selected specification is no longer available for this cluster.");
      if (target.version !== asRecord(detail.datastore).version || !nodes.every(node => typeof node.azCode === "string" && target.azs.includes(node.azCode) && Number(asRecord(node.volume).size) > 0 && Number(asRecord(node.volume).size) <= target.diskMax)) throw new ManagementInputError("The new specification cannot support the current engine, node zones, or disk capacities.");
      if (target.name === currentSpec) throw new ManagementInputError("The selected specification is already the current data node specification.", 409);
      await huaweiFetch(session, "css", `${base}/${encodeURIComponent(cluster.id)}/ess/flavor`, { method: "POST", body: JSON.stringify({ new_flavor_id: target.flavorId, operation_type: "vm" }) });
      return { message: "Data node specification change submitted.", resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "expand-storage") {
      const detail = await clusterDetail(session, cluster.id);
      assertAvailable(detail);
      const nodes = essNodes(detail);
      if (!nodes.length) throw new ManagementInputError("This cluster has no data nodes; storage cannot be expanded through this operation.", 409);
      const currentDisk = Number(asRecord(nodes[0].volume).size) || 0;
      const growSizeGb = Number(values.growSizeGb);
      if (growSizeGb % 20) throw new ManagementInputError("The storage increment must be a multiple of 20 GB.");
      const datastore = asRecord(detail.datastore);
      const flavor = (await esFlavors(session)).find((item) => item.version === firstString([datastore.version], "") && item.name === firstString([nodes[0].specCode], ""));
      if (!flavor || !currentDisk || !nodes.every(node => Number(asRecord(node.volume).size) === currentDisk && node.specCode === nodes[0].specCode)) throw new ManagementInputError("The current homogeneous data-node flavor and disk capacity could not be verified.", 409);
      if (currentDisk + growSizeGb > flavor.diskMax) throw new ManagementInputError(`The expanded capacity cannot exceed ${flavor.diskMax} GB for this specification.`);
      await huaweiFetch(session, "css", `${base}/${encodeURIComponent(cluster.id)}/role_extend`, { method: "POST", body: JSON.stringify({ grow: [{ type: "ess", nodesize: 0, disksize: growSizeGb }] }) });
      return { message: "Data node storage expansion submitted.", resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "delete") {
      const detail = await clusterDetail(session, cluster.id);
      if (detail.period !== false) throw new ManagementInputError("Only verified pay-per-use clusters can be deleted here. Subscription cancellation requires an order workflow.", 409);
      await huaweiFetch(session, "css", `${base}/${encodeURIComponent(cluster.id)}`, { method: "DELETE" });
      return { message: "Cluster deletion submitted.", resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "snapshots") {
      const rows = await snapshots(session, cluster.id);
      return { message: `${rows.length} snapshots loaded.`, resourceId: cluster.id, facts: rows.map((item) => ({ label: `${firstString([item.name], "Snapshot")} · ${firstString([item.backupType], "") === "1" ? "manual" : "automatic"} · ${firstString([item.status], "-")}`, value: [firstString([item.created], ""), firstString([item.indices], "")].filter(Boolean).join(" · ") || snapshotId(item) })) };
    }
    if (operation === "create-snapshot") {
      const detail = await clusterDetail(session, cluster.id);
      assertAvailable(detail);
      if (detail.backupAvailable !== true) throw new ManagementInputError("Configure snapshot storage and its access agency before creating manual snapshots.", 409);
      const description = String(values.description ?? "").trim();
      if (/[><!=&"']/.test(description)) throw new ManagementInputError("The description cannot contain the characters ! < > = & \" '.");
      const indices = String(values.indices ?? "").trim();
      if (indices) assertIndices(indices);
      const response = await huaweiFetch<Record<string, unknown>>(session, "css", `${base}/${encodeURIComponent(cluster.id)}/index_snapshot`, { method: "POST", body: JSON.stringify({ name: values.name, ...(description ? { description } : {}), ...(indices ? { indices } : {}) }) });
      return { message: "Manual snapshot creation submitted.", resourceId: firstString([asRecord(response.backup).id], "") || cluster.id, asynchronous: true };
    }
    if (operation === "delete-snapshot") {
      const snapshot = (await snapshots(session, cluster.id)).find(item => snapshotId(item) === values.snapshot);
      if (!snapshot) throw new ManagementInputError("The selected snapshot is not in this cluster.", 404);
      if (snapshot.backupType !== "1" || snapshot.status !== "COMPLETED") throw new ManagementInputError("Only completed manual snapshots can be deleted here.", 409);
      await huaweiFetch(session, "css", `${base}/${encodeURIComponent(cluster.id)}/index_snapshot/${encodeURIComponent(String(values.snapshot))}`, { method: "DELETE" });
      return { message: "Snapshot deletion accepted.", resourceId: cluster.id };
    }
    if (operation === "snapshot-policy") {
      const enable = values.enable === true;
      const body: Record<string, unknown> = { enable: enable ? "true" : "false" };
      if (enable) {
        const prefix = String(values.prefix ?? "");
        if (!prefix) throw new ManagementInputError("The snapshot name prefix is required when enabling automatic snapshots.");
        if (!values.keepday) throw new ManagementInputError("The retention in days is required when enabling automatic snapshots.");
        const frequency = String(values.frequency ?? "DAY");
        const period = String(values.period ?? "");
        if (frequency !== "HOUR" && !period) throw new ManagementInputError("The start time is required unless snapshots run hourly.");
        const indices = String(values.indices ?? "").trim();
        if (indices) assertIndices(indices);
        Object.assign(body, { prefix, keepday: Number(values.keepday), frequency, ...(period ? { period } : {}), ...(indices ? { indices } : {}) });
      } else {
        body.delete_auto = values.deleteAuto === true ? "true" : "false";
      }
      await huaweiFetch(session, "css", `${base}/${encodeURIComponent(cluster.id)}/index_snapshot/policy`, { method: "POST", body: JSON.stringify(body) });
      return { message: enable ? "Automatic snapshot policy enabled." : "Automatic snapshot policy disabled.", resourceId: cluster.id };
    }
    throw new ManagementInputError("Unsupported CSS operation.");
  },
};
