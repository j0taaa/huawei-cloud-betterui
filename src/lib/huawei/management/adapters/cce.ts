import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listCceClustersForProject } from "@/lib/huawei/services/cce";
import { listImagesForProject } from "@/lib/huawei/services/ims";
import { listSecurityGroupsForProject, listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const root = (s: BetterUiSession) => `/api/v3/projects/${s.projectId}/clusters`;
// Documented finite cluster flavors (CreateCluster spec.flavor): s1 = single control node, s2 = three control nodes.
const clusterFlavors: ManagementChoice[] = [
  { value: "cce.s1.small", label: "cce.s1.small · single control node · up to 50 nodes" },
  { value: "cce.s1.medium", label: "cce.s1.medium · single control node · up to 200 nodes" },
  { value: "cce.s1.large", label: "cce.s1.large · single control node · up to 1000 nodes" },
  { value: "cce.s2.small", label: "cce.s2.small · three control nodes · up to 50 nodes" },
  { value: "cce.s2.medium", label: "cce.s2.medium · three control nodes · up to 200 nodes" },
  { value: "cce.s2.large", label: "cce.s2.large · three control nodes · up to 1000 nodes" },
  { value: "cce.s2.xlarge", label: "cce.s2.xlarge · three control nodes · up to 2000 nodes" },
];
// Documented container network modes for CCE Standard clusters (eni is CCE Turbo only).
const networkModes: ManagementChoice[] = [
  { value: "overlay_l2", label: "overlay_l2 · container tunnel network" },
  { value: "vpc-router", label: "vpc-router · VPC network" },
];
// EVS disk types that need no extra parameters (ESSD2/GPSSD2 require iops/throughput this form does not collect).
const diskTypes: ManagementChoice[] = [
  { value: "SAS", label: "SAS · high IO" },
  { value: "SSD", label: "SSD · ultra-high IO" },
  { value: "GPSSD", label: "GPSSD · general-purpose SSD" },
  { value: "ESSD", label: "ESSD · extreme SSD" },
];
const clusterName: ManagementField = { key: "name", label: "Cluster name", required: true, pattern: "^[a-z][a-z0-9-]{2,126}[a-z0-9]$", help: "4-128 characters starting with a lowercase letter, using lowercase letters, digits, and hyphens, without a trailing hyphen." };
const aliasField: ManagementField = { key: "alias", label: "Display name", pattern: "^[A-Za-z\\p{Script=Han}][A-Za-z0-9\\p{Script=Han}-]{2,126}[A-Za-z0-9\\p{Script=Han}]$", help: "4-128 characters starting with a letter. The display name is shown in the console; the cluster name itself cannot change." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 200, maxBytes: 200, allowEmpty: true, pattern: "^[^~$%^&*<>\\[\\]{}()'\"#\\\\]*$", help: "Up to 200 bytes, without the characters ~ $ % ^ & * < > [ ] { } ( ) ' \" # \\." };
const versionField: ManagementField = { key: "version", label: "Cluster version", pattern: "^v[0-9]+\\.[0-9]+(\\.[0-9]+)?(-r[0-9]+)?$", help: "Leave empty for the latest version supported in this region. Otherwise use the documented format, for example v1.30, v1.30.0, or v1.30.0-r0." };
const cidrField: ManagementField = { key: "containerCidr", label: "Container network CIDR", pattern: "^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])/(1[2-9])$", help: "Recommended 10.0.0.0/12-19, 172.16.0.0/16-19, or 192.168.0.0/16-19. Leave empty to have a non-conflicting range assigned automatically. This range cannot change after creation." };
const enterpriseProject: ManagementField = { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" };
const poolName: ManagementField = { key: "name", label: "Node pool name", required: true, pattern: "^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$", help: "1-63 characters starting with a lowercase letter; DefaultPool is not allowed." };
const poolSelect: ManagementField = { key: "nodepool", label: "Node pool", type: "select", source: "nodepools", required: true };
const initialCount: ManagementField = { key: "initialNodeCount", label: "Initial node count", type: "number", required: true, min: 0, max: 2000, defaultValue: 1, help: "Nodes are billed hourly. The cluster flavor limits the total node count (50, 200, 1000, or 2000)." };
const scaleCount: ManagementField = { key: "initialNodeCount", label: "New node count", type: "number", required: true, min: 1, max: 2000, help: "Scaling up provisions billed nodes; scaling down evicts workloads from the removed nodes." };
const clusterEditable = ["Available", "ScalingUp", "ScalingDown"];
const nodeImpact = "Node compute and disks are billed hourly while they exist. No public IP is attached to the nodes.";

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** Reads the first non-negative numeric candidate; missing counters fail closed to a re-check of every node pool. */
function firstNumber(values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isSafeInteger(number) && number >= 0) return number;
  }
  throw new ManagementInputError("The current node count could not be verified. Retry before deleting this cluster.", 409);
}

async function ownedCluster(session: BetterUiSession, id: string) {
  const cluster = (await listCceClustersForProject(session)).find((item) => item.id === id);
  if (!cluster) throw new ManagementInputError("The cluster no longer exists in this project.", 404);
  return cluster;
}

async function clusterDetail(session: BetterUiSession, id: string) {
  const detail = asRecord(await huaweiFetch<Record<string, unknown>>(session, "cce", `${root(session)}/${encodeURIComponent(id)}?detail=true`));
  if (asRecord(detail.metadata).uid !== id) throw new ManagementInputError("Huawei returned a different cluster.", 404);
  return detail;
}

type NodePoolRow = { id: string; name: string; flavor: string; zone: string; os: string; key: string; currentNode: number; creatingNode: number; deletingNode: number; phase: string };

async function nodePools(session: BetterUiSession, clusterId: string, showDefault = false): Promise<NodePoolRow[]> {
  const query = showDefault ? "?showDefaultNodePool=true" : "";
  const body = await huaweiFetch<{ items?: unknown[] }>(session, "cce", `${root(session)}/${encodeURIComponent(clusterId)}/nodepools${query}`);
  return asArray(body.items).map((row) => {
    const item = asRecord(row);
    const metadata = asRecord(item.metadata);
    const template = asRecord(asRecord(item.spec).nodeTemplate);
    const status = asRecord(item.status);
    return {
      id: asString(metadata.uid, ""),
      name: asString(metadata.name, ""),
      flavor: asString(template.flavor),
      zone: asString(template.az),
      os: asString(template.os),
      key: asString(asRecord(template.login).sshKey),
      currentNode: toNumber(status.currentNode),
      creatingNode: toNumber(status.creatingNode),
      deletingNode: toNumber(status.deletingNode),
      phase: asString(status.phase, ""),
    };
  }).filter((pool) => pool.id);
}

type AddonRow = { id: string; name: string; alias: string; templateName: string; version: string; status: string; targetVersions: string[] };

async function addonInstances(session: BetterUiSession, clusterId: string): Promise<AddonRow[]> {
  const body = await huaweiFetch<{ items?: unknown[] }>(session, "cce", `/api/v3/addons?${new URLSearchParams({ cluster_id: clusterId })}`);
  return asArray(body.items).map(asRecord).filter(item => asRecord(item.spec).clusterID === clusterId).map((item) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    return {
      id: asString(metadata.uid, ""),
      name: asString(metadata.name, ""),
      alias: firstString([metadata.alias, metadata.name]),
      templateName: asString(spec.addonTemplateName, ""),
      version: firstString([spec.version, asRecord(status.currentVersion).version]),
      status: asString(status.status, "unknown"),
      targetVersions: asArray(status.targetVersions).map((version) => asString(version, "")).filter(Boolean),
    };
  }).filter((addon) => addon.id);
}

type TemplateVersion = { version: string; stable: boolean; input: Record<string, unknown> };
type AddonTemplate = { name: string; alias: string; description: string; type: string; require: boolean; versions: TemplateVersion[] };

async function addonTemplates(session: BetterUiSession): Promise<AddonTemplate[]> {
  const body = await huaweiFetch<{ items?: unknown[] }>(session, "cce", "/api/v3/addontemplates");
  return asArray(body.items).map((row) => {
    const item = asRecord(row);
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    return {
      name: asString(metadata.name, ""),
      alias: firstString([metadata.alias, metadata.name]),
      description: asString(spec.description, ""),
      type: asString(spec.type, ""),
      require: spec.require === true,
      versions: asArray(spec.versions).map((raw) => {
        const version = asRecord(raw);
        return { version: asString(version.version, ""), stable: version.stable === true, input: asRecord(version.input) };
      }).filter((entry) => entry.version),
    };
  }).filter((template) => template.name);
}

/** Build the documented install payload from the template version's own published parameters; nothing is invented. */
function addonInstallValues(input: Record<string, unknown>, flavorKey: string) {
  const basic = asRecord(input.basic);
  const parameters = asRecord(input.parameters);
  const custom = asRecord(parameters.custom);
  const flavor = asRecord(parameters[flavorKey]);
  const values: Record<string, unknown> = {};
  if (Object.keys(basic).length) values.basic = basic;
  if (Object.keys(custom).length) values.custom = custom;
  if (Object.keys(flavor).length) values.flavor = flavor;
  if (!Object.keys(values).length) throw new ManagementInputError("The selected template version does not publish install parameters in a supported shape.");
  return values;
}

function addonOfferings(templates: AddonTemplate[], installed: AddonRow[]) {
  return templates.flatMap((template) => template.versions.flatMap((entry) => {
    if (installed.some((addon) => addon.templateName === template.name)) return [];
    const parameters = asRecord(entry.input.parameters);
    const flavors = Object.keys(parameters).filter((key) => /^flavor\d*$/.test(key)).sort();
    const choices = flavors.length ? flavors : [""];
    return choices.map((flavorKey) => ({
      value: JSON.stringify([template.name, entry.version, flavorKey]),
      label: `${template.alias} · ${entry.version}${entry.stable ? " · stable" : ""}${flavorKey ? ` · ${flavorKey}` : ""}`,
    }));
  }));
}

async function ecsFlavors(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "ecs", `/v1/${session.projectId}/cloudservers/flavors?limit=100`, { items: ["flavors"], kind: "marker", parameter: "marker", size: 100, fallbackKey: "id" });
  return asArray(body.flavors).map(asRecord).filter((item) => item["os-flavor-access:is_public"] !== false && asRecord(item.extra_specs)["ecs:performancetype"] !== "baremetal");
}

async function ecsZones(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "ecs", `/v2.1/${session.projectId}/os-availability-zone`);
  return asArray(body.availabilityZoneInfo).map(asRecord).filter((zone) => asRecord(zone.zoneState).available === true).map((zone) => ({ value: asString(zone.zoneName, ""), label: asString(zone.zoneName, "") })).filter((zone) => zone.value);
}

async function ecsKeyPairs(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "ecs", `/v2.1/${session.projectId}/os-keypairs?limit=100`, { items: ["keypairs"], kind: "marker", parameter: "marker", size: 100, fallbackKey: "keypair.name" });
  return asArray(body.keypairs).map((raw) => asRecord(asRecord(raw).keypair)).map((key) => ({ value: asString(key.name, ""), label: asString(key.name, "") })).filter((key) => key.value);
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create cluster", kind: "create", description: "Create one private pay-per-use CCE Standard cluster with no nodes. Add compute afterwards by creating a node pool.", impact: "The cluster control plane is billed hourly while it exists, and node pools add billed compute and disks. No public IP is bound: the cluster API is reachable only inside the selected VPC. No yearly/monthly subscription is created.", fields: [
    clusterName,
    versionField,
    { key: "flavor", label: "Cluster flavor", type: "select", required: true, defaultValue: "cce.s1.small", choices: clusterFlavors, help: "Single control node flavors stop the cluster if that node fails; three control node flavors keep it available." },
    { key: "networkMode", label: "Container network mode", type: "select", required: true, defaultValue: "overlay_l2", choices: networkModes, help: "The container network mode cannot change after creation. CCE Turbo (eni) clusters are not created by this workflow." },
    cidrField,
    { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "Must belong to the selected VPC; the subnet's network ID is used for node traffic." },
    { key: "securityGroup", label: "Node security group", type: "select", source: "securityGroups", help: "Leave empty to have CCE create and manage the default node security group." },
    enterpriseProject,
  ] },
  { id: "rename", label: "Edit display name and description", kind: "update", description: "Change the console display name and the description. The immutable cluster name is not touched.", allowedStatuses: clusterEditable, fields: [aliasField, descriptionField] },
  { id: "inspect", label: "Inspect cluster", kind: "inspect", description: "Load the cluster's native configuration, network topology, and configurable component parameters.", fields: [] },
  { id: "hibernate", fields: [], label: "Hibernate cluster", kind: "action", description: "Stop the control plane and pause its billing. Existing nodes keep running and keep billing.", allowedStatuses: ["Available"], confirmation: true, impact: "The cluster cannot manage workloads while hibernated. Control-node charges pause once the cluster reaches the Hibernation state; nodes, bound EIPs, and bandwidth continue to be billed." },
  { id: "awake", fields: [], label: "Wake up cluster", kind: "action", description: "Wake a hibernated cluster and resume control-plane billing.", allowedStatuses: ["Hibernation"], impact: "Control-node billing resumes once the cluster reaches the Available state." },
  { id: "delete", fields: [], label: "Delete empty cluster", kind: "delete", description: "Permanently delete a cluster that has no nodes, preserving attached storage and log resources.", allowedStatuses: ["Available", "Unavailable", "Error"], confirmation: true, impact: "The cluster is permanently removed. Every deletion flag is set to preserve persistent volumes, file shares, object buckets, load balancers, and log resources, which continue to incur charges. Nodes must be removed first; the cluster must be empty." },
  { id: "nodepools", label: "View node pools", kind: "inspect", description: "List this cluster's node pools with their flavor, zone, image, and node counts.", fields: [] },
  { id: "create-nodepool", label: "Create node pool", kind: "action", description: "Create one pay-per-use node pool from live ECS flavors, zones, SSH key pairs, and optional private IMS images, inside the cluster's VPC.", allowedStatuses: clusterEditable, impact: nodeImpact, fields: [
    poolName,
    { key: "flavor", label: "Node flavor", type: "select", source: "flavors", required: true },
    { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
    { key: "image", label: "Node image", type: "select", source: "images", help: "Leave empty to use the current public node OS (Huawei Cloud EulerOS 2.0). Select a private IMS image to use it instead." },
    { key: "key", label: "SSH key pair", type: "select", source: "keys", required: true, help: "Nodes are reachable only with this SSH key pair; password login is not used by this workflow." },
    initialCount,
    { key: "rootDiskType", label: "System disk type", type: "select", required: true, defaultValue: "SAS", choices: diskTypes },
    { key: "rootDiskSize", label: "System disk capacity (GB)", type: "number", required: true, min: 40, max: 1024, defaultValue: 40 },
    { key: "dataDiskType", label: "Data disk type", type: "select", required: true, defaultValue: "SAS", choices: diskTypes },
    { key: "dataDiskSize", label: "Data disk capacity (GB)", type: "number", required: true, min: 100, max: 32768, defaultValue: 100, help: "The data disk holds the container runtime storage." },
    { key: "subnet", label: "Node subnet", type: "select", source: "nodepoolSubnets", help: "Leave empty to use the cluster's default subnet. Any selection must belong to the cluster's VPC." },
  ] },
  { id: "update-nodepool", confirmation: true, label: "Scale node pool", kind: "update", description: "Change a node pool's expected node count.", allowedStatuses: clusterEditable, fields: [poolSelect, scaleCount], impact: "Scaling up provisions billed nodes. Scaling down evicts workloads from removed nodes; their local data is lost and persistent volumes follow their own reclaim policies." },
  { id: "delete-nodepool", label: "Delete node pool", kind: "delete", description: "Permanently remove one node pool and every node it created.", allowedStatuses: clusterEditable, fields: [poolSelect], confirmation: true, impact: "The pool's nodes are evicted and permanently removed with their local data; attached persistent volumes follow their own reclaim policies. Nodes keep billing until cloud deletion finishes." },
  { id: "addons", label: "View installed addons", kind: "inspect", description: "List the addons installed on this cluster with their versions and states.", fields: [] },
  { id: "addon-templates", label: "View addon templates", kind: "inspect", description: "List the addon templates offered for this region with their published versions.", fields: [] },
  { id: "create-addon", label: "Install addon", kind: "action", description: "Install one addon from a live template and version, using the template's own published install parameters.", allowedStatuses: ["Available"], fields: [
    { key: "offering", label: "Addon template, version, and flavor", type: "select", source: "addonOfferings", required: true },
  ], impact: "The addon consumes cluster resources while installed. Installation parameters come from the addon template itself; no custom parameters are dispatched." },
  { id: "update-addon", label: "Upgrade addon", kind: "update", description: "Upgrade one installed addon to a version the cluster offers, resubmitting its current install parameters.", allowedStatuses: ["Available"], fields: [
    { key: "upgrade", label: "Addon and target version", type: "select", source: "addonUpgrades", required: true },
  ], impact: "The addon is unavailable to workloads while it upgrades. A failed upgrade can leave the addon in a rollback state." },
  { id: "delete-addon", label: "Delete addon", kind: "delete", description: "Remove one non-required addon from this cluster.", allowedStatuses: ["Available"], fields: [
    { key: "addon", label: "Installed addon", type: "select", source: "addons", required: true },
  ], confirmation: true, impact: "Workloads depending on this addon lose its capabilities immediately. Required system addons cannot be deleted." },
];

export const cceManagement: ManagementAdapter = {
  title: "Cloud Container Engine",
  operations,
  inventory: async (session) => (await listCceClustersForProject(session)).map((cluster) => ({
    id: cluster.id,
    name: cluster.alias !== "-" ? cluster.alias : cluster.name,
    status: cluster.status,
    values: {
      name: cluster.name,
      alias: cluster.alias,
      description: cluster.description,
      flavor: cluster.flavor,
      version: cluster.version,
      type: cluster.type,
      vpcId: cluster.vpcId,
      subnetId: cluster.subnetId,
      billingMode: cluster.billingMode,
      nodeCount: cluster.nodeCount,
      containerNetworkMode: cluster.containerNetworkMode,
      projectId: cluster.projectId,
    },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [vpcs, subnets, groups] = await Promise.all([listVpcsForProject(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      return {
        vpcs: vpcs.map((vpc) => ({ value: vpc.id, label: `${vpc.name} · ${vpc.cidr}` })),
        subnets: subnets.filter((subnet) => subnet.neutronNetworkId && subnet.neutronNetworkId !== "-").map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
      };
    }
    if (!resource) return {};
    if (operation === "create-nodepool") {
      const cluster = await ownedCluster(session, resource.id);
      const [flavors, zones, keys, images, subnets] = await Promise.all([ecsFlavors(session), ecsZones(session), ecsKeyPairs(session), listImagesForProject(session), listSubnetsForProject(session)]);
      return {
        flavors: flavors.map((flavor) => ({ value: String(flavor.id), label: `${String(flavor.name)} · ${flavor.vcpus} vCPU · ${Number(flavor.ram) / 1024} GB RAM` })),
        zones,
        keys,
        images: images.filter((image) => image.imageType === "private" && image.status.toLowerCase() === "active" && image.osType.toLowerCase() === "linux" && !image.isWholeImage).map((image) => ({ value: image.id, label: `${image.name} · ${image.osType || image.os}` })),
        nodepoolSubnets: subnets.filter((subnet) => subnet.vpcId === cluster.vpcId && subnet.neutronNetworkId && subnet.neutronNetworkId !== "-").map((subnet) => ({ value: subnet.neutronNetworkId, label: `${subnet.name} · ${subnet.cidr}` })),
      };
    }
    if (operation === "update-nodepool" || operation === "delete-nodepool") {
      return { nodepools: (await nodePools(session, resource.id)).map((pool) => ({ value: pool.id, label: `${pool.name} · ${pool.currentNode} current node(s)` })) };
    }
    if (operation === "create-addon") {
      const [templates, installed] = await Promise.all([addonTemplates(session), addonInstances(session, resource.id)]);
      return { addonOfferings: addonOfferings(templates, installed) };
    }
    if (operation === "update-addon") {
      return { addonUpgrades: (await addonInstances(session, resource.id)).flatMap((addon) => addon.targetVersions.map((version) => ({ value: JSON.stringify([addon.id, version]), label: `${addon.alias} · ${addon.version} → ${version}` }))) };
    }
    if (operation === "delete-addon") {
      const [addons, templates] = await Promise.all([addonInstances(session, resource.id), addonTemplates(session)]);
      const required = new Set(templates.filter((template) => template.require).map((template) => template.name));
      return { addons: addons.filter((addon) => !required.has(addon.templateName)).map((addon) => ({ value: addon.id, label: `${addon.alias} · v${addon.version} · ${addon.status}` })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    const body = await huaweiFetch<Record<string, unknown>>(session, "cce", `/api/v3/projects/${session.projectId}/jobs/${encodeURIComponent(entry.jobId!)}`);
    if (!entry.jobId || asRecord(body.metadata).uid !== entry.jobId) throw new ManagementInputError("Huawei returned a different CCE job.");
    if (entry.resourceId && asRecord(body.spec).clusterUID !== entry.resourceId && asRecord(body.spec).resourceID !== entry.resourceId) throw new ManagementInputError("The CCE job does not belong to this cluster.");
    const status = asRecord(body.status);
    const phase = asString(status.phase, "");
    const resourceId = firstString([asRecord(body.spec).resourceID], "") || undefined;
    if (phase === "Success") return { state: "succeeded", message: "The CCE cloud job completed successfully.", resourceId };
    if (phase === "Failed") return { state: "failed", message: firstString([status.reason], "The CCE cloud job failed. Review the cluster or node pool state before retrying."), resourceId };
    return { state: "submitted", message: `The CCE cloud job is ${phase || "still processing"}.` };
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listCceClusters, cloudCacheKeys.summary, ...(resource ? [cloudCacheKeys.cce(resource.id)] : [])],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      if (!clusterFlavors.some((flavor) => flavor.value === values.flavor)) throw new ManagementInputError("Select a documented cluster flavor.");
      if (!networkModes.some((mode) => mode.value === values.networkMode)) throw new ManagementInputError("Select a documented container network mode.");
      const [vpcs, subnets, groups] = await Promise.all([listVpcsForProject(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      if (!vpcs.some((vpc) => vpc.id === values.vpc)) throw new ManagementInputError("The selected VPC is no longer available in this project.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet || subnet.vpcId !== values.vpc || !subnet.neutronNetworkId || subnet.neutronNetworkId === "-") throw new ManagementInputError("Select a subnet that belongs to the selected VPC.");
      if (values.securityGroup && !groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "cce", root(session), { method: "POST", body: JSON.stringify({
        kind: "Cluster",
        apiVersion: "v3",
        metadata: { name: values.name },
        spec: {
          type: "VirtualMachine",
          flavor: values.flavor,
          ...(values.version ? { version: values.version } : {}),
          hostNetwork: { vpc: values.vpc, subnet: subnet.neutronNetworkId, ...(values.securityGroup ? { SecurityGroup: values.securityGroup } : {}) },
          containerNetwork: { mode: values.networkMode, ...(values.containerCidr ? { cidrs: [{ cidr: values.containerCidr }] } : {}) },
          authentication: { mode: "rbac" },
          billingMode: 0,
          extendParam: { enterpriseProjectId: String(values.enterpriseProjectId ?? "0") },
        },
      }) });
      return { message: "Cluster creation submitted. The cluster is private and has no nodes yet; create a node pool to add compute.", resourceId: asString(asRecord(response.metadata).uid, "") || undefined, jobId: firstString([asRecord(response.status).jobID], "") || undefined, asynchronous: true };
    }
    const cluster = await ownedCluster(session, resource!.id);
    if (operation === "rename") {
      const alias = values.alias !== undefined ? String(values.alias) : "";
      if (!alias && values.description === undefined) throw new ManagementInputError("Enter a new display name or description.");
      const detail = await clusterDetail(session, cluster.id);
      const description = values.description !== undefined ? String(values.description) : asString(asRecord(detail.spec).description, "");
      await huaweiFetch(session, "cce", `${root(session)}/${encodeURIComponent(cluster.id)}`, { method: "PUT", body: JSON.stringify({ spec: { description }, ...(alias ? { metadata: { alias } } : {}) }) });
      return { message: "Cluster display name and description updated.", resourceId: cluster.id };
    }
    if (operation === "inspect") {
      const detail = await clusterDetail(session, cluster.id);
      const spec = asRecord(detail.spec);
      const status = asRecord(detail.status);
      const metadata = asRecord(detail.metadata);
      const hostNetwork = asRecord(spec.hostNetwork);
      const containerNetwork = asRecord(spec.containerNetwork);
      const configuration = await huaweiFetch<Record<string, unknown>>(session, "cce", `${root(session)}/${encodeURIComponent(cluster.id)}/configuration/detail`);
      const packages = Object.entries(configuration).map(([name, options]) => ({ name, parameters: asArray(options).map(asRecord).filter((option) => asString(option.name, "")) })).filter((entry) => entry.parameters.length);
      return { message: `Cluster configuration loaded (${packages.length} configurable component packages).`, resourceId: cluster.id, facts: [
        { label: "Cluster", value: `${asString(metadata.name)} · ${asString(metadata.alias)} · ${asString(status.phase)} · ${cluster.billingMode}` },
        { label: "Version and flavor", value: `${asString(spec.version)} · ${asString(spec.flavor)} · ${asString(spec.type)}` },
        { label: "Description", value: asString(spec.description, "") || "No description set" },
        { label: "Host network", value: `VPC ${asString(hostNetwork.vpc)} · subnet ${asString(hostNetwork.subnet)} · security group ${firstString([hostNetwork.SecurityGroup], "auto-created")}` },
        { label: "Container network", value: `${asString(containerNetwork.mode)} · ${asArray(containerNetwork.cidrs).map((cidr) => asString(asRecord(cidr).cidr)).join(", ") || "auto-assigned"}` },
        { label: "Authentication", value: `${asString(asRecord(spec.authentication).mode, "rbac")}` },
        { label: "Nodes", value: `${toNumber(status.totalNodesNumber)} total · ${toNumber(status.activeNodesNumber)} active` },
        ...packages.map((entry) => ({ label: `Component · ${entry.name}`, value: `${entry.parameters.length} parameters: ${entry.parameters.slice(0, 8).map((option) => asString(option.name, "")).join(", ")}${entry.parameters.length > 8 ? ", …" : ""}` })),
      ] };
    }
    if (operation === "hibernate" || operation === "awake") {
      await huaweiFetch(session, "cce", `${root(session)}/${encodeURIComponent(cluster.id)}/operation/${operation}`, { method: "POST" });
      return { message: operation === "hibernate" ? "Cluster hibernation submitted. Control-node billing pauses once the cluster reaches the Hibernation state; nodes and bound EIPs continue to be billed." : "Cluster wake-up submitted. Control-node billing resumes once the cluster reaches the Available state.", resourceId: cluster.id, asynchronous: true };
    }
    if (operation === "delete") {
      const [detail, pools] = await Promise.all([clusterDetail(session, cluster.id), nodePools(session, cluster.id, true)]);
      const annotations = asRecord(asRecord(detail.metadata).annotations);
      const nodes = firstNumber([annotations.totalNodesNumber, annotations["cluster.cce.io/node-count"], asRecord(detail.status).totalNodesNumber]);
      if (String(asRecord(detail.spec).billingMode) !== "0") throw new ManagementInputError("Only pay-per-use clusters can be deleted here. Prepaid clusters require a subscription order workflow.", 409);
      if (nodes > 0) throw new ManagementInputError("The cluster still has nodes. Remove every node and node pool before deleting it.", 409);
      if (pools.some((pool) => pool.currentNode > 0 || pool.creatingNode > 0)) throw new ManagementInputError("A node pool in this cluster still has nodes. Remove its nodes before deleting the cluster.", 409);
      const remaining = await huaweiFetch<Record<string, unknown>>(session, "cce", `${root(session)}/${encodeURIComponent(cluster.id)}/nodes?limit=1`);
      if (!Array.isArray(remaining.items)) throw new ManagementInputError("The cluster node list could not be verified.", 409);
      if (remaining.items.length) throw new ManagementInputError("The cluster still has nodes. Remove every node before deleting it.", 409);
      const query = new URLSearchParams({ delete_efs: "false", delete_eni: "false", delete_evs: "false", delete_net: "false", delete_obs: "false", delete_sfs: "false", delete_sfs30: "false", lts_reclaim_policy: "Retain", ondemand_node_policy: "retain", periodic_node_policy: "retain" });
      const response = await huaweiFetch<Record<string, unknown>>(session, "cce", `${root(session)}/${encodeURIComponent(cluster.id)}?${query.toString()}`, { method: "DELETE" });
      return { message: "Cluster deletion submitted. Attached storage, load balancer, and log resources are preserved and continue to incur charges.", resourceId: cluster.id, jobId: firstString([asRecord(response.status).jobID], "") || undefined, asynchronous: true };
    }
    if (operation === "nodepools") {
      const pools = await nodePools(session, cluster.id);
      return { message: `${pools.length} node pools loaded.`, resourceId: cluster.id, facts: pools.map((pool) => ({ label: `${pool.name} · ${pool.id}`, value: `${pool.flavor} · ${pool.zone} · ${pool.os || "private image"} · key ${pool.key || "-"} · ${pool.currentNode} current / ${pool.creatingNode} creating / ${pool.deletingNode} deleting nodes` })) };
    }
    if (operation === "create-nodepool") {
      const [flavors, zones, keys, images, subnets] = await Promise.all([ecsFlavors(session), ecsZones(session), ecsKeyPairs(session), listImagesForProject(session), listSubnetsForProject(session)]);
      if (!flavors.some((flavor) => String(flavor.id) === values.flavor)) throw new ManagementInputError("The selected node flavor is no longer available.");
      if (!zones.some((zone) => zone.value === values.zone)) throw new ManagementInputError("The selected availability zone is no longer available.");
      if (!keys.some((key) => key.value === values.key)) throw new ManagementInputError("The selected SSH key pair is no longer available. Create a key pair before creating node pools.");
      const image = values.image !== undefined ? images.find((item) => item.id === values.image && item.imageType === "private" && item.status.toLowerCase() === "active" && item.osType.toLowerCase() === "linux" && !item.isWholeImage) : undefined;
      if (values.image !== undefined && !image) throw new ManagementInputError("The selected private image is no longer available.");
      const subnet = values.subnet !== undefined ? subnets.find((item) => item.neutronNetworkId === values.subnet) : undefined;
      if (values.subnet !== undefined && (!subnet || subnet.vpcId !== cluster.vpcId)) throw new ManagementInputError("Select a node subnet that belongs to this cluster's VPC.");
      if (!diskTypes.some((type) => type.value === values.rootDiskType) || !diskTypes.some((type) => type.value === values.dataDiskType)) throw new ManagementInputError("Select a documented disk type.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "cce", `${root(session)}/${encodeURIComponent(cluster.id)}/nodepools`, { method: "POST", body: JSON.stringify({
        kind: "NodePool",
        apiVersion: "v3",
        metadata: { name: values.name },
        spec: {
          type: "vm",
          initialNodeCount: Number(values.initialNodeCount),
          nodeTemplate: {
            flavor: values.flavor,
            az: values.zone,
            ...(image ? {} : { os: "Huawei Cloud EulerOS 2.0" }),
            login: { sshKey: values.key },
            rootVolume: { volumetype: values.rootDiskType, size: Number(values.rootDiskSize) },
            dataVolumes: [{ volumetype: values.dataDiskType, size: Number(values.dataDiskSize) }],
            billingMode: 0,
            ...(image ? { extendParam: { "alpha.cce/NodeImageID": image.id } } : {}),
            ...(subnet ? { nodeNicSpec: { primaryNic: { subnetId: subnet.neutronNetworkId } } } : {}),
          },
        },
      }) });
      return { message: "Node pool creation submitted. Nodes are billed hourly while they exist.", resourceId: cluster.id, jobId: firstString([asRecord(response.status).jobId], "") || undefined, asynchronous: true };
    }
    if (operation === "update-nodepool") {
      const pool = (await nodePools(session, cluster.id)).find((item) => item.id === values.nodepool);
      if (!pool) throw new ManagementInputError("The node pool no longer belongs to this cluster.", 404);
      const response = await huaweiFetch<Record<string, unknown>>(session, "cce", `${root(session)}/${encodeURIComponent(cluster.id)}/nodepools/${encodeURIComponent(pool.id)}`, { method: "PUT", body: JSON.stringify({ spec: { initialNodeCount: Number(values.initialNodeCount) } }) });
      return { message: `Node pool scale to ${Number(values.initialNodeCount)} node(s) submitted. Refresh the node pool list to verify progress.`, resourceId: cluster.id, jobId: firstString([asRecord(response.status).jobId], "") || undefined, asynchronous: true };
    }
    if (operation === "delete-nodepool") {
      const pool = (await nodePools(session, cluster.id)).find((item) => item.id === values.nodepool);
      if (!pool) throw new ManagementInputError("The node pool no longer belongs to this cluster.", 404);
      const response = await huaweiFetch<Record<string, unknown>>(session, "cce", `${root(session)}/${encodeURIComponent(cluster.id)}/nodepools/${encodeURIComponent(pool.id)}`, { method: "DELETE" });
      return { message: "Node pool deletion submitted. Its nodes are permanently removed and stop billing once deletion completes.", resourceId: cluster.id, jobId: firstString([asRecord(response.status).jobId], "") || undefined, asynchronous: true };
    }
    if (operation === "addons") {
      const addons = await addonInstances(session, cluster.id);
      return { message: `${addons.length} installed addons loaded.`, resourceId: cluster.id, facts: addons.map((addon) => ({ label: `${addon.alias} · ${addon.name}`, value: `v${addon.version} · ${addon.status} · template ${addon.templateName}` })) };
    }
    if (operation === "addon-templates") {
      const templates = await addonTemplates(session);
      return { message: `${templates.length} addon templates loaded.`, resourceId: cluster.id, facts: templates.map((template) => ({ label: `${template.alias} · ${template.name} · ${template.type}${template.require ? " · required" : ""}`, value: `${template.versions.length} version(s), ${template.versions.filter((entry) => entry.stable).length} stable · ${template.description}` })) };
    }
    if (operation === "create-addon") {
      let offering: unknown;
      try { offering = JSON.parse(String(values.offering)); } catch { throw new ManagementInputError("Select an available addon template, version, and flavor."); }
      const [templateName, version, flavorKey] = Array.isArray(offering) ? offering : [];
      if (typeof templateName !== "string" || !templateName || typeof version !== "string" || !version || typeof flavorKey !== "string") throw new ManagementInputError("Select an available addon template, version, and flavor.");
      const [templates, installed] = await Promise.all([addonTemplates(session), addonInstances(session, cluster.id)]);
      const templateVersion = templates.find((template) => template.name === templateName)?.versions.find((entry) => entry.version === version);
      if (!templateVersion) throw new ManagementInputError("The selected addon template or version is no longer available.");
      if (installed.some((addon) => addon.templateName === templateName)) throw new ManagementInputError("This addon is already installed on the cluster.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "cce", "/api/v3/addons", { method: "POST", body: JSON.stringify({
        kind: "Addon",
        apiVersion: "v3",
        metadata: { annotations: { "addon.install/type": "install" } },
        spec: { clusterID: cluster.id, addonTemplateName: templateName, version, values: addonInstallValues(templateVersion.input, flavorKey) },
      }) });
      return { message: "Addon installation submitted. Refresh the addon list to verify it reaches the running state.", resourceId: firstString([asRecord(response.metadata).uid], "") || undefined, asynchronous: true };
    }
    if (operation === "update-addon") {
      let upgrade: unknown;
      try { upgrade = JSON.parse(String(values.upgrade)); } catch { throw new ManagementInputError("Select an installed addon and a target version."); }
      const [addonId, targetVersion] = Array.isArray(upgrade) ? upgrade : [];
      if (typeof addonId !== "string" || !addonId || typeof targetVersion !== "string" || !targetVersion) throw new ManagementInputError("Select an installed addon and a target version.");
      const addon = (await addonInstances(session, cluster.id)).find((item) => item.id === addonId);
      if (!addon) throw new ManagementInputError("The addon no longer belongs to this cluster.", 404);
      if (!addon.targetVersions.includes(targetVersion)) throw new ManagementInputError("The selected target version is no longer offered for this addon.");
      const current = asRecord(await huaweiFetch<Record<string, unknown>>(session, "cce", `/api/v3/addons/${encodeURIComponent(addon.id)}?${new URLSearchParams({ cluster_id: cluster.id })}`));
      if (asRecord(current.metadata).uid !== addon.id || asRecord(current.spec).clusterID !== cluster.id) throw new ManagementInputError("Huawei returned an addon from a different cluster.", 404);
      const currentValues = asRecord(asRecord(current.spec).values);
      if (!Object.keys(currentValues).length) throw new ManagementInputError("The addon's current install parameters could not be loaded. Retry the operation.");
      await huaweiFetch(session, "cce", `/api/v3/addons/${encodeURIComponent(addon.id)}`, { method: "PUT", body: JSON.stringify({
        kind: "Addon",
        apiVersion: "v3",
        metadata: { annotations: { "addon.upgrade/type": "upgrade" } },
        spec: { clusterID: cluster.id, addonTemplateName: addon.templateName, version: targetVersion, values: currentValues },
      }) });
      return { message: `Addon upgrade to ${targetVersion} submitted. Refresh the addon list to verify completion.`, resourceId: addon.id, asynchronous: true };
    }
    if (operation === "delete-addon") {
      const [addons, templates] = await Promise.all([addonInstances(session, cluster.id), addonTemplates(session)]);
      const addon = addons.find((item) => item.id === values.addon);
      if (!addon) throw new ManagementInputError("The addon no longer belongs to this cluster.", 404);
      if (!templates.some(template => template.name === addon.templateName)) throw new ManagementInputError("The addon template could not be verified. Retry before deleting it.", 409);
      if (templates.some((template) => template.name === addon.templateName && template.require)) throw new ManagementInputError("Required system addons cannot be deleted.", 409);
      await huaweiFetch(session, "cce", `/api/v3/addons/${encodeURIComponent(addon.id)}?${new URLSearchParams({ cluster_id: cluster.id })}`, { method: "DELETE" });
      return { message: "Addon deletion submitted. Refresh the addon list to verify it is removed.", resourceId: cluster.id, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported CCE operation.");
  },
};
