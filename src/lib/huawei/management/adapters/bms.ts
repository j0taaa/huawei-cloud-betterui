import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { huaweiFetch as nativeFetch, huaweiList, HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listBmsServersForProject } from "@/lib/huawei/services/bms";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

// Primary BMS v1 and VPC port contracts are checked before mutations. A successful
// HTTP transport is not sufficient when Huawei supplies a native error object.
async function huaweiFetch<T = unknown>(...args: Parameters<typeof nativeFetch>) {
  const body = await nativeFetch<T>(...args).catch(error => {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected this BMS request (HTTP ${error.status}). Check current state in the native console.`, error.status);
    throw error;
  });
  const result = asRecord(body);
  if (result.error_code || result.error || result.error_msg) throw new ManagementInputError("Huawei rejected this BMS request. Check current resource state before retrying.", 409);
  return body;
}

const base = (session: BetterUiSession) => `/v1/${session.projectId}`;
const serverPath = (session: BetterUiSession, id: string) => `${base(session)}/baremetalservers/${encodeURIComponent(id)}`;
const active = ["ACTIVE"];
const stopped = ["SHUTOFF"];
const passwordCharset = /^[A-Za-z0-9!@$%^\-_=+\[{}\]:,.\/?]+$/;
const reservedMetadataKeys = new Set(["chargingMode", "vpc_id", "EcmResStatus", "baremetalPortIDList", "op_svc_userid", "image_name", "os_type", "os_bit", "__bms_support_evs"]);
const reservedMetadataPrefixes = ["metering.", "__"];

const nameField: ManagementField = { key: "name", label: "Server name", required: true, min: 1, max: 63, pattern: "^[A-Za-z0-9_\\-.\\p{L}]{1,63}$", help: "1-63 letters, digits, underscores, hyphens, dots, or Chinese characters." };
const flavorField: ManagementField = { key: "flavor", label: "Bare metal flavor", type: "select", source: "flavors", required: true, help: "Commercial ironic flavors currently on sale in this region." };
const imageField: ManagementField = { key: "image", label: "Server image", type: "select", source: "images", required: true, help: "Public or private Ironic (bare metal) images." };
const zoneField: ManagementField = { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true };
const subnetField: ManagementField = { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC. BMS NICs use the subnet's network ID." };
const securityGroupsField: ManagementField = { key: "securityGroups", label: "Security groups", type: "list", source: "securityGroups", required: true, max: 5 };
const authenticationField: ManagementField = { key: "authentication", label: "Login method", type: "select", required: true, defaultValue: "key", choices: [{ value: "key", label: "SSH key" }, { value: "password", label: "Password" }] };
const keyField: ManagementField = { key: "key", label: "SSH key", type: "select", source: "keys", help: "Required for key-based login." };
const passwordField: ManagementField = { key: "password", label: "Initial administrator password", type: "password", min: 8, max: 26, help: "8-26 characters with at least three of uppercase, lowercase, digits, and the special characters !@$%^-_=+[{}]:,./? ; it cannot contain the administrator user name or its reverse." };
const diskTypeField: ManagementField = { key: "diskType", label: "System disk type", type: "select", choices: ["SATA", "SAS", "SSD"].map((value) => ({ value, label: value })), help: "Required for quick-provisioning flavors. Leave empty for local-disk flavors." };
const diskSizeField: ManagementField = { key: "diskSize", label: "System disk capacity (GB)", type: "number", min: 40, max: 1024, help: "40-1024 GB and at least the image minimum. Leave empty for local-disk flavors." };
const billingModeField: ManagementField = { key: "billingMode", label: "Billing mode", type: "select", required: true, defaultValue: "prePaid", choices: [{ value: "prePaid", label: "prePaid · yearly/monthly order, unpaid until manual payment" }, { value: "postPaid", label: "postPaid · pay-per-use" }], help: "Huawei's native default is prePaid. Prepaid orders are created with automatic payment and renewal disabled." };
const periodTypeField: ManagementField = { key: "periodType", label: "Subscription period type", type: "select", choices: [{ value: "month", label: "month" }, { value: "year", label: "year" }], help: "Required for prepaid orders." };
const periodNumField: ManagementField = { key: "periodNum", label: "Number of periods", type: "number", min: 1, max: 9, help: "1-9 months or a single year. Required for prepaid orders." };
const enterpriseProjectField: ManagementField = { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" };

type BmsFlavor = { id: string; name: string; vcpus: string; ramGb: number; bootType: string; status: string; azStatus: Record<string, string> };
type BmsImage = { id: string; name: string; osType: string; minDiskGb: number; status: string };
type TagRow = { key: string; value: string };

function commercial(status: string) {
  return status === "normal" || status === "promotion";
}

function assertPassword(value: string) {
  if (value.length < 8 || value.length > 26) throw new ManagementInputError("The administrator password must be 8 to 26 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[!@$%^\-_=+\[{}\]:,.\/?]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and the special characters !@$%^-_=+[{}]:,./?.");
  if (!passwordCharset.test(value)) throw new ManagementInputError("The password uses characters outside the supported BMS set (!@$%^-_=+[{}]:,./?).");
  if (/root|toor|administrator|rotartsinimda/i.test(value)) throw new ManagementInputError("The password cannot contain the administrator user name or its reverse.");
}

function assertNetworkId(subnet: { neutronNetworkId: string }) {
  if (["", "-"].includes(subnet.neutronNetworkId)) throw new ManagementInputError("The selected subnet does not expose the distinct network ID that a bare metal server NIC requires.");
}

async function flavorRows(session: BetterUiSession): Promise<BmsFlavor[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "bms", `${base(session)}/baremetalservers/flavors`);
  return asArray(body.flavors).map(asRecord).flatMap((row) => {
    const id = firstString([row.id], "");
    const extra = asRecord(row.os_extra_specs);
    if (!id || extra.resource_type !== "ironic") return [];
    const azStatus: Record<string, string> = {};
    for (const match of String(extra["cond:operation:az"] ?? "").matchAll(/([A-Za-z0-9_-]+)\(([A-Za-z]+)\)/g)) azStatus[match[1]] = match[2];
    const ram = Number(row.ram) || 0;
    return [{ id, name: firstString([row.name, row.id]), vcpus: String(row.vcpus ?? "-"), ramGb: ram >= 1024 ? ram / 1024 : ram, bootType: firstString([extra["baremetal:extBootType"]], ""), status: firstString([extra["cond:operation:status"]], ""), azStatus }];
  });
}

async function imageRows(session: BetterUiSession): Promise<BmsImage[]> {
  const pages = await Promise.all(["gold", "private"].map((imageType) => huaweiList<Record<string, unknown>>(session, "ims", `/v2/cloudimages?${new URLSearchParams({ __imagetype: imageType, __isregistered: "true", virtual_env_type: "Ironic", limit: "100", sort_dir: "desc", sort_key: "created_at" })}`, { items: ["images"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" })));
  const seen = new Set<string>();
  return pages.flatMap((page) => asArray(page.images).map(asRecord)).flatMap((row) => {
    const id = firstString([row.id], "");
    const virtualEnvType = firstString([row.virtual_env_type, asRecord(row.properties).virtual_env_type], "");
    if (!id || seen.has(id) || virtualEnvType !== "Ironic") return [];
    seen.add(id);
    return [{ id, name: firstString([row.name, row.id]), osType: firstString([row.__os_type, asRecord(row.properties).__os_type, row.os_type], ""), minDiskGb: Number(row.min_disk) || 0, status: firstString([row.status], "") }];
  });
}

async function keypairRows(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "ecs", `/v2.1/${session.projectId}/os-keypairs?limit=100`, { items: ["keypairs"], kind: "marker", parameter: "marker", size: 100, fallbackKey: "keypair.name" });
  return asArray(body.keypairs).map((raw) => asRecord(raw)).map((raw) => firstString([asRecord(raw.keypair).name], "")).filter(Boolean);
}

async function quotaAbsolute(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "bms", `${base(session)}/baremetalservers/limits`);
  return asRecord(body.absolute);
}

async function assertZoneCapacity(session: BetterUiSession, zone: string, flavorId: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "bms", `${base(session)}/baremetalservers/available_resource?${new URLSearchParams({ availability_zone: zone, flavor_id: flavorId, check_limit: "true" })}`);
  const entry = asArray(body.available_resource).map(asRecord).find((row) => firstString([row.availability_zone], "") === zone);
  const flavor = asArray(entry?.flavors).map(asRecord).find((row) => firstString([row.flavor_id], "") === flavorId);
  if (!flavor || !(Number(flavor.count) >= 1)) throw new ManagementInputError("The selected flavor has no available capacity in this availability zone.");
}

async function serverDetail(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "bms", serverPath(session, id));
  const server = asRecord(body.server);
  if (server.id !== id || server.tenant_id !== session.projectId) throw new ManagementInputError("The bare metal server identity and project could not be verified.", 409);
  return server;
}

async function nicRows(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "bms", `${serverPath(session, id)}/os-interface`);
  if (!Array.isArray(body.interfaceAttachments)) throw new ManagementInputError("The current NIC inventory could not be verified.", 409);
  const rows = body.interfaceAttachments.map(asRecord);
  if (rows.some(row => typeof row.port_id !== "string" || !row.port_id) || new Set(rows.map(row => row.port_id)).size !== rows.length) throw new ManagementInputError("The current NIC identities could not be verified.", 409);
  return rows;
}

async function portDetail(session: BetterUiSession, serverId: string, nic: Record<string, unknown>) {
  const response = await huaweiFetch<Record<string, unknown>>(session, "vpc", `/v1/${session.projectId}/ports/${encodeURIComponent(String(nic.port_id))}`);
  const port = asRecord(response.port);
  if (port.id !== nic.port_id || port.tenant_id !== session.projectId || port.device_id !== serverId || port.network_id !== nic.net_id) throw new ManagementInputError("The NIC's current server and project ownership could not be verified.", 409);
  const primary = asRecord(port["binding:vif_details"]).primary_interface;
  if (typeof primary !== "boolean") throw new ManagementInputError("The NIC's primary-interface status could not be verified.", 409);
  return { port, primary };
}

function assertIdleServer(detail: Record<string, unknown>, operation: string) {
  const allowed = operation === "start" ? ["SHUTOFF"] : ["stop", "reboot"].includes(operation) ? ["ACTIVE"] : ["ACTIVE", "SHUTOFF"];
  if (!allowed.includes(String(detail.status))) throw new ManagementInputError("The server's current state does not allow this operation.", 409);
  if (!("OS-EXT-STS:task_state" in detail) || ![null, ""].includes(detail["OS-EXT-STS:task_state"] as null | string)) throw new ManagementInputError("Wait for the server's current task to finish; its idle task state must be verified.", 409);
  if (detail.locked !== false) throw new ManagementInputError("The server's unlocked state could not be verified.", 409);
}

async function tagRows(session: BetterUiSession, id: string): Promise<TagRow[]> {
  const body = await huaweiFetch<Record<string, unknown>>(session, "bms", `${serverPath(session, id)}/tags`);
  return asArray(body.tags).map(asRecord).map((tag) => ({ key: firstString([tag.key], ""), value: firstString([tag.value], "") })).filter((tag) => tag.key);
}

const systemTag = (key: string) => key.startsWith("__") || key.startsWith("_sys_") || key === "_type_baremetal";
const userTags = (rows: TagRow[]) => rows.filter(tag => !systemTag(tag.key));

const operations: ManagementOperation[] = [
  { id: "create", label: "Create server", kind: "create", description: "Create one private bare metal server from live BMS flavors, Ironic images, networks, and keypairs. No public IP is attached; prepaid orders are created unpaid.", impact: "This starts a billable order: a prepaid order must be paid manually in the billing console before the server is provisioned, and a pay-per-use server is billed while it exists. The system disk is billed with the server.", fields: [nameField, flavorField, imageField, zoneField, subnetField, securityGroupsField, authenticationField, keyField, passwordField, diskTypeField, diskSizeField, billingModeField, periodTypeField, periodNumField, enterpriseProjectField] },
  { id: "rename", label: "Rename server", kind: "update", description: "Change the server name. BMS exposes no server description field.", fields: [nameField] },
  { id: "start", label: "Start server", kind: "action", description: "Power on a stopped bare metal server.", fields: [], allowedStatuses: stopped, impact: "The server powers on and serves traffic again." },
  { id: "stop", label: "Stop server", kind: "action", description: "Force a hard power-off of the operating system.", fields: [], allowedStatuses: active, confirmation: true, impact: "The server is forcefully powered off: applications stop immediately and unsaved work can be lost. The server's pricing plan and attached storage continue to apply." },
  { id: "reboot", label: "Restart server", kind: "action", description: "Force a hard restart of the operating system.", fields: [], allowedStatuses: active, confirmation: true, impact: "The server is unavailable until the forced restart completes, and unsaved work can be lost." },
  { id: "inspect", label: "View server topology", kind: "inspect", description: "Inspect status, billing, NICs, volumes, and tags without exposing raw metadata or credentials.", fields: [] },
  { id: "add-nic", label: "Add private NIC", kind: "action", description: "Attach one more NIC from the server's VPC. A bare metal server supports at most two NICs.", fields: [subnetField, { key: "securityGroups", label: "Security groups", type: "list", source: "securityGroups", max: 5, help: "Optional security groups for the new port." }], impact: "The new port connects the server to the selected subnet; its traffic is governed by the selected security groups." },
  { id: "remove-nic", label: "Remove NIC", kind: "action", description: "Detach one non-primary NIC port. The primary NIC cannot be removed.", fields: [{ key: "port", label: "NIC port", type: "select", source: "ports", required: true }], confirmation: true, impact: "Traffic through this NIC stops immediately and the port with its private IP is released." },
  { id: "add-tag", label: "Add tag", kind: "action", description: "Add one user tag. Huawei reserves system tags and limits a server to nine user tags.", fields: [{ key: "key", label: "Tag key", required: true, max: 127, pattern: "^[\\p{L}\\p{N}_\\-.+]{1,127}$" }, { key: "value", label: "Tag value", required: true, max: 255 }] },
  { id: "remove-tag", label: "Remove tag", kind: "action", description: "Remove one user tag by key.", fields: [{ key: "tag", label: "Tag key", type: "select", source: "tags", required: true }] },
  { id: "security-groups", label: "Change NIC security groups", kind: "update", description: "Replace the security groups of one verified BMS port using the native VPC port route.", fields: [{ key: "port", label: "NIC port", type: "select", source: "ports", required: true }, securityGroupsField], impact: "This immediately changes ingress and egress rules on the selected NIC. Incorrect security groups can expose services or interrupt traffic." },
  { id: "set-metadata", label: "Set IAM agency", kind: "update", description: "Set the documented agency_name metadata entry for IAM delegation.", fields: [{ key: "key", label: "Metadata entry", type: "select", required: true, defaultValue: "agency_name", choices: [{ value: "agency_name", label: "IAM agency" }] }, { key: "value", label: "IAM agency name", required: true, max: 255 }], impact: "The selected IAM agency changes which permissions Huawei services can exercise on this server." },
  { id: "delete", label: "Delete server", kind: "delete", description: "Permanently delete one stopped pay-per-use bare metal server. Prepaid servers must be unsubscribed in the billing console.", fields: [{ key: "deleteVolume", label: "Delete attached data disks", type: "boolean", defaultValue: false }, { key: "deletePublicIp", label: "Release bound public IP", type: "boolean", defaultValue: false }], allowedStatuses: stopped, confirmation: true, impact: "The server is permanently removed. Retained data disks and public IPs keep billing until they are deleted separately." },
];

export const bmsManagement: ManagementAdapter = {
  title: "Bare Metal Server",
  operations,
  inventory: async (session) => (await listBmsServersForProject(session)).map((item) => ({
    id: item.id, name: item.name, status: item.status,
    values: { name: item.name, flavor: item.flavor, image: item.image, zone: item.availabilityZone, privateIp: item.privateIp, publicIp: item.publicIp, keyName: item.keyName, projectId: item.projectId },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [flavors, images, zones, subnets, groups, keys] = await Promise.all([flavorRows(session), imageRows(session), huaweiFetch<Record<string, unknown>>(session, "ecs", `/v2.1/${session.projectId}/os-availability-zone`), listSubnetsForProject(session), listSecurityGroupsForProject(session), keypairRows(session)]);
      return {
        flavors: flavors.filter((flavor) => commercial(flavor.status)).map((flavor) => ({ value: flavor.id, label: `${flavor.name} · ${flavor.vcpus} vCPU · ${flavor.ramGb} GB RAM · ${flavor.bootType === "LocalDisk" ? "local disk boot" : "quick provisioning"}` })),
        images: images.filter((image) => image.status.toLowerCase() === "active").map((image) => ({ value: image.id, label: `${image.name} · ${image.osType || "unknown OS"}${image.minDiskGb ? ` · min ${image.minDiskGb} GB` : ""}` })),
        zones: asArray(zones.availabilityZoneInfo).map(asRecord).filter((zone) => asRecord(zone.zoneState).available === true).map((zone) => ({ value: String(zone.zoneName), label: String(zone.zoneName) })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
        keys: keys.map((key) => ({ value: key, label: key })),
      };
    }
    if (operation === "add-nic") {
      const [subnets, groups] = await Promise.all([listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      return { subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })), securityGroups: groups.map((group) => ({ value: group.id, label: group.name })) };
    }
    if (operation === "remove-nic") {
      if (!resource) return {};
      const nics = await nicRows(session, resource.id);
      const verified = nics.length > 1 ? await Promise.all(nics.map(async nic => ({ nic, ...(await portDetail(session, resource.id, nic)) }))) : [];
      return { ports: verified.filter(item => !item.primary).map(({ nic }) => ({ value: firstString([nic.port_id], ""), label: `${asArray(nic.fixed_ips).map(asRecord).map((ip) => firstString([ip.ip_address], "-")).join(", ") || "no fixed IP"} · net ${firstString([nic.net_id], "-")}` })) };
    }
    if (operation === "security-groups") {
      if (!resource) return {};
      const [nics, groups] = await Promise.all([nicRows(session, resource.id), listSecurityGroupsForProject(session)]);
      const verified = await Promise.all(nics.map(async nic => ({ nic, ...(await portDetail(session, resource.id, nic)) })));
      return { ports: verified.map(({ nic, primary }) => ({ value: String(nic.port_id), label: `${String(nic.port_id)}${primary ? " · primary" : ""}` })), securityGroups: groups.map(group => ({ value: group.id, label: group.name })) };
    }
    if (operation === "remove-tag") {
      if (!resource) return {};
      return { tags: userTags(await tagRows(session, resource.id)).map((tag) => ({ value: tag.key, label: tag.value ? `${tag.key} = ${tag.value}` : tag.key })) };
    }
    return {};
  },
  poll: async (session, entry) => {
    if (!entry.jobId || !/^[A-Za-z0-9_-]+$/.test(entry.jobId)) throw new ManagementInputError("No verified native BMS job ID is stored.");
    const job = await huaweiFetch<Record<string, unknown>>(session, "bms", `${base(session)}/jobs/${encodeURIComponent(entry.jobId!)}`);
    if (!entry.jobId || firstString([job.job_id], "") !== entry.jobId) throw new ManagementInputError("Huawei returned a different BMS job.");
    const entities = asRecord(job.entities);
    const serverId = firstString([entities.server_id, asRecord(asRecord(asArray(entities.sub_jobs)[0]).entities).server_id], "");
    if (entry.resourceId && serverId !== entry.resourceId) throw new ManagementInputError("The BMS job does not belong to the selected server.");
    const status = firstString([job.status], "");
    if (status === "SUCCESS" && !entry.resourceId && !serverId) throw new ManagementInputError("Huawei has not confirmed the created server identity.", 409);
    if (status === "SUCCESS") return { state: "succeeded", message: "The BMS cloud job completed successfully.", resourceId: serverId || entry.resourceId };
    if (status === "FAIL") return { state: "failed", message: "The BMS cloud job failed. Review the server state in Huawei before retrying." };
    return { state: "submitted", message: `The BMS cloud job is ${status || "processing"}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listBmsServers, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      if (!["prePaid", "postPaid"].includes(String(values.billingMode))) throw new ManagementInputError("Select a documented billing mode.");
      const prepaid = values.billingMode === "prePaid";
      let periodNum = 0;
      if (prepaid) {
        if (!["month", "year"].includes(String(values.periodType))) throw new ManagementInputError("Select a subscription period type for the prepaid order.");
        periodNum = Number(values.periodNum);
        if (!Number.isInteger(periodNum) || periodNum < 1 || periodNum > (values.periodType === "year" ? 1 : 9)) throw new ManagementInputError("Prepaid orders accept 1-9 months or a single year.");
      }
      const operatorId = session.userId;
      if (!operatorId) throw new ManagementInputError("The session does not expose the operator user ID required by the BMS creation contract.");
      const [flavors, images, subnets, groups, absolute] = await Promise.all([flavorRows(session), imageRows(session), listSubnetsForProject(session), listSecurityGroupsForProject(session), quotaAbsolute(session)]);
      const maxServers = Number(absolute.maxTotalInstances);
      if (!Number.isFinite(maxServers)) throw new ManagementInputError("The bare metal server quota could not be verified. Retry the operation.");
      const used = Number(absolute.totalInstancesUsed);
      if (!Number.isSafeInteger(absolute.maxTotalInstances) || !Number.isSafeInteger(maxServers) || maxServers < -1 || !Number.isSafeInteger(absolute.totalInstancesUsed) || !Number.isSafeInteger(used) || used < 0) throw new ManagementInputError("The bare metal server quota usage could not be verified.");
      if (maxServers >= 0 && used + 1 > maxServers) throw new ManagementInputError(`The project's bare metal server quota of ${maxServers} is already used.`);
      const flavor = flavors.find((item) => item.id === values.flavor);
      if (!flavor || !commercial(flavor.status)) throw new ManagementInputError("The selected bare metal flavor is no longer on sale.");
      if (!["Volume", "LocalDisk"].includes(flavor.bootType)) throw new ManagementInputError("The flavor's boot type could not be verified.");
      const zone = String(values.zone);
      const zones = await huaweiFetch<Record<string, unknown>>(session, "ecs", `/v2.1/${session.projectId}/os-availability-zone`);
      if (!asArray(zones.availabilityZoneInfo).map(asRecord).some(row => row.zoneName === zone && asRecord(row.zoneState).available === true)) throw new ManagementInputError("The availability zone is no longer available.");
      if (!commercial(flavor.azStatus[zone] ?? flavor.status)) throw new ManagementInputError("The selected flavor is not on sale in this availability zone.");
      const image = images.find((item) => item.id === values.image);
      if (!image || image.status.toLowerCase() !== "active") throw new ManagementInputError("The selected image is no longer available.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      assertNetworkId(subnet);
      const selectedGroups = values.securityGroups as string[];
      if (selectedGroups.some((id) => !groups.some((group) => group.id === id))) throw new ManagementInputError("A selected security group is no longer available in this project.");
      let rootVolume: { volumetype: string; size: number } | undefined;
      if (flavor.bootType === "Volume") {
        if (!values.diskType || values.diskSize === undefined) throw new ManagementInputError("Quick-provisioning flavors require a system disk type and capacity.");
        const size = Number(values.diskSize);
        if (!Number.isSafeInteger(size) || size < 40 || size > 1024 || !["SATA", "SAS", "SSD"].includes(String(values.diskType))) throw new ManagementInputError("The system disk must be between 40 and 1024 GB.");
        if (image.minDiskGb && size < image.minDiskGb) throw new ManagementInputError(`The image requires at least ${image.minDiskGb} GB of system disk.`);
        rootVolume = { volumetype: String(values.diskType), size };
      } else if (values.diskType !== undefined || values.diskSize !== undefined) {
        throw new ManagementInputError("Local-disk flavors use their physical system disk; clear the system disk fields.");
      }
      if (values.authentication === "key") {
        if (!values.key) throw new ManagementInputError("Select an SSH key for key-based login.");
        if (!(await keypairRows(session)).includes(String(values.key))) throw new ManagementInputError("The selected SSH key is no longer available.");
      } else if (values.authentication === "password") {
        assertPassword(String(values.password ?? ""));
      } else throw new ManagementInputError("Select a verified login method.");
      await assertZoneCapacity(session, zone, flavor.id);
      const response = await huaweiFetch<Record<string, unknown>>(session, "bms", `${base(session)}/baremetalservers`, { method: "POST", body: JSON.stringify({ server: {
        name: values.name,
        imageRef: image.id,
        flavorRef: flavor.id,
        availability_zone: zone,
        count: 1,
        vpcid: subnet.vpcId,
        nics: [{ subnet_id: subnet.neutronNetworkId }],
        security_groups: selectedGroups.map((id) => ({ id })),
        metadata: { op_svc_userid: operatorId },
        ...(values.authentication === "key" ? { key_name: values.key } : { adminPass: values.password }),
        ...(rootVolume ? { root_volume: rootVolume } : {}),
        extendparam: {
          chargingMode: values.billingMode,
          regionID: session.region,
          ...(prepaid ? { periodType: values.periodType, periodNum, isAutoRenew: "false", isAutoPay: "false" } : {}),
          enterprise_project_id: values.enterpriseProjectId ?? "0",
        },
      } }) });
      const orderId = firstString([response.order_id], "");
      const jobId = firstString([response.job_id], "");
      if (prepaid) {
        if (!orderId) throw new Error("Huawei accepted the prepaid order but returned no order ID.");
        return { message: `Prepaid order ${orderId} was accepted and is unpaid. Automatic payment and renewal are disabled; the bare metal server is provisioned only after the order is paid in the billing console.`, asynchronous: true, facts: [{ label: "Order ID", value: orderId }, { label: "Billing", value: "prePaid · unpaid order" }] };
      }
      if (!jobId) throw new Error("Huawei returned no job ID for the pay-per-use creation.");
      return { message: "Pay-per-use bare metal server creation submitted. The server is private; compute and system disk billing start with provisioning.", jobId, asynchronous: true };
    }
    if (!resource) throw new ManagementInputError("Select a bare metal server.");
    if (operation !== "inspect") assertIdleServer(await serverDetail(session, resource.id), operation);
    if (operation === "rename") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "bms", serverPath(session, resource.id), { method: "PUT", body: JSON.stringify({ server: { name: values.name } }) });
      const confirmed = asRecord(response.server);
      if (firstString([confirmed.id], "") !== resource.id || firstString([confirmed.name], "") !== String(values.name)) throw new Error("Huawei returned no matching confirmation for the rename.");
      return { message: "Server renamed.", resourceId: resource.id };
    }
    if (["start", "stop", "reboot"].includes(operation)) {
      const body = operation === "start" ? { "os-start": { servers: [{ id: resource.id }] } } : operation === "stop" ? { "os-stop": { type: "HARD", servers: [{ id: resource.id }] } } : { reboot: { type: "HARD", servers: [{ id: resource.id }] } };
      const response = await huaweiFetch<Record<string, unknown>>(session, "bms", `${base(session)}/baremetalservers/action`, { method: "POST", body: JSON.stringify(body) });
      const jobId = firstString([response.job_id], "");
      if (!jobId) throw new Error(`Huawei returned no job ID for the ${operation} operation.`);
      return { message: `Server ${operation} submitted.`, resourceId: resource.id, jobId, asynchronous: true };
    }
    if (operation === "inspect") {
      const [detail, nics, tags] = await Promise.all([serverDetail(session, resource.id), nicRows(session, resource.id), tagRows(session, resource.id)]);
      const charging = firstString([asRecord(detail.metadata).chargingMode], "");

      const facts = [
        { label: "Status", value: `${firstString([detail.status], "-")} · task ${firstString([detail["OS-EXT-STS:task_state"]], "-")}` },
        { label: "Flavor", value: firstString([asRecord(detail.flavor).name, asRecord(detail.flavor).id], "-") },
        { label: "Image", value: firstString([asRecord(detail.image).name, asRecord(detail.image).id], "-") },
        { label: "Availability zone", value: firstString([detail["OS-EXT-AZ:availability_zone"], detail.availability_zone], "-") },
        { label: "Billing", value: charging === "1" ? "prePaid (yearly/monthly)" : charging === "0" ? "postPaid (pay-per-use)" : "unverified" },
        { label: "SSH key", value: firstString([detail.key_name], "-") },
        { label: "Created", value: firstString([detail.created], "-") },
        { label: "Updated", value: firstString([detail.updated], "-") },
        ...nics.map((nic) => ({ label: `NIC ${firstString([nic.port_id], "-")}`, value: `${asArray(nic.fixed_ips).map(asRecord).map((ip) => firstString([ip.ip_address], "-")).join(", ") || "no fixed IP"} · net ${firstString([nic.net_id], "-")} · ${firstString([nic.port_state], "-")}` })),
        ...asArray(detail["os-extended-volumes:volumes_attached"]).map(asRecord).map((volume) => ({ label: `Volume ${firstString([volume.id], "-")}`, value: firstString([volume.device], "-") })),
        ...tags.map((tag) => ({ label: `Tag ${tag.key}`, value: tag.value || "(empty)" })),
      ];
      if (detail.fault) facts.push({ label: "Fault", value: "Huawei reports a fault; inspect its private details in the native console." });
      return { message: "Current bare metal server topology.", resourceId: resource.id, facts };
    }
    if (operation === "add-nic") {
      const [detail, nics, subnets, groups] = await Promise.all([serverDetail(session, resource.id), nicRows(session, resource.id), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      if (nics.length >= 2) throw new ManagementInputError("A bare metal server supports at most two NICs.", 409);
      const vpcId = firstString([asRecord(detail.metadata).vpc_id], "");
      if (!vpcId) throw new ManagementInputError("The server's VPC could not be verified for the new NIC.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      assertNetworkId(subnet);
      if (subnet.vpcId !== vpcId) throw new ManagementInputError("All NICs of a bare metal server must belong to the same VPC.");
      const selectedGroups = (values.securityGroups as string[] | undefined) ?? [];
      if (selectedGroups.some((id) => !groups.some((group) => group.id === id))) throw new ManagementInputError("A selected security group is no longer available in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "bms", `${serverPath(session, resource.id)}/nics`, { method: "POST", body: JSON.stringify({ nics: [{ subnet_id: subnet.neutronNetworkId, ...(selectedGroups.length ? { security_groups: selectedGroups.map((id) => ({ id })) } : {}) }] }) });
      const jobId = firstString([response.job_id], "");
      if (!jobId) throw new Error("Huawei returned no job ID for the NIC addition.");
      return { message: "NIC addition submitted.", resourceId: resource.id, jobId, asynchronous: true };
    }
    if (operation === "remove-nic") {
      const nics = await nicRows(session, resource.id);
      if (nics.length <= 1) throw new ManagementInputError("The server has only its primary NIC, which cannot be removed.", 409);
      if (!nics.some((nic) => firstString([nic.port_id], "") === values.port)) throw new ManagementInputError("Select a current NIC port of this server.", 404);
      const nic = nics.find(nic => nic.port_id === values.port)!;
      if ((await portDetail(session, resource.id, nic)).primary) throw new ManagementInputError("The primary NIC cannot be removed.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "bms", `${serverPath(session, resource.id)}/nics/delete`, { method: "POST", body: JSON.stringify({ nics: [{ id: values.port }] }) });
      const jobId = firstString([response.job_id], "");
      if (!jobId) throw new Error("Huawei returned no job ID for the NIC removal.");
      return { message: "NIC removal submitted.", resourceId: resource.id, jobId, asynchronous: true };
    }
    if (operation === "security-groups") {
      const [nics, groups] = await Promise.all([nicRows(session, resource.id), listSecurityGroupsForProject(session)]);
      const nic = nics.find(nic => nic.port_id === values.port);
      if (!nic) throw new ManagementInputError("Select a current NIC port of this server.", 404);
      await portDetail(session, resource.id, nic);
      const selected = values.securityGroups;
      if (!Array.isArray(selected) || !selected.length || selected.length > 5 || selected.some(id => !groups.some(group => group.id === id))) throw new ManagementInputError("Select current security groups in this project.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "vpc", `/v1/${session.projectId}/ports/${encodeURIComponent(String(nic.port_id))}`, { method: "PUT", body: JSON.stringify({ port: { security_groups: selected } }) });
      const port = asRecord(response.port);
      if (port.id !== nic.port_id || !Array.isArray(port.security_groups) || port.security_groups.length !== selected.length || !selected.every(id => (port.security_groups as unknown[]).includes(id))) throw new Error("Huawei returned no matching confirmation for the NIC's security groups.");
      return { message: "NIC security groups updated.", resourceId: resource.id };
    }
    if (operation === "add-tag") {
      const tags = await tagRows(session, resource.id);
      const key = String(values.key);
      if (systemTag(key)) throw new ManagementInputError("System tag keys are managed by Huawei and cannot be created here.", 409);
      if (tags.some((tag) => tag.key === key)) throw new ManagementInputError("The tag key already exists on this server.", 409);
      if (userTags(tags).length >= 9) throw new ManagementInputError("A bare metal server accepts at most nine user tags.", 409);
      await huaweiFetch(session, "bms", `${serverPath(session, resource.id)}/tags/action`, { method: "POST", body: JSON.stringify({ action: "create", tags: [{ key, value: values.value }] }) });
      return { message: "Tag added.", resourceId: resource.id };
    }
    if (operation === "remove-tag") {
      const key = String(values.tag);
      if (!userTags(await tagRows(session, resource.id)).some((tag) => tag.key === key)) throw new ManagementInputError("Select a current user tag of this server.", 404);
      await huaweiFetch(session, "bms", `${serverPath(session, resource.id)}/tags/action`, { method: "POST", body: JSON.stringify({ action: "delete", tags: [{ key }] }) });
      return { message: "Tag removed.", resourceId: resource.id };
    }
    if (operation === "set-metadata") {
      const key = String(values.key);
      if (reservedMetadataKeys.has(key) || reservedMetadataPrefixes.some((prefix) => key.startsWith(prefix))) throw new ManagementInputError("System metadata keys are managed by Huawei and cannot be set here.", 409);
      if (key !== "agency_name") throw new ManagementInputError("Only the documented IAM agency entry can be edited here.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "bms", `${serverPath(session, resource.id)}/metadata`, { method: "POST", body: JSON.stringify({ metadata: { [key]: values.value } }) });
      if (firstString([asRecord(response.metadata)[key]], "") !== String(values.value)) throw new Error("Huawei returned no confirmation for the metadata update.");
      return { message: "Metadata entry set.", resourceId: resource.id };
    }
    if (operation === "delete") {
      const detail = await serverDetail(session, resource.id);
      if (firstString([detail.status], "") !== "SHUTOFF") throw new ManagementInputError("Only stopped bare metal servers can be deleted here.", 409);
      const charging = firstString([asRecord(detail.metadata).chargingMode], "");
      if (charging === "1") throw new ManagementInputError("Prepaid servers require subscription cancellation in the billing console. This deletion supports pay-per-use servers only.", 409);
      if (charging !== "0") throw new ManagementInputError("The server's billing mode could not be verified; deletion was refused.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "bms", `${base(session)}/baremetalservers/delete`, { method: "POST", body: JSON.stringify({ servers: [{ id: resource.id }], delete_publicip: values.deletePublicIp ?? false, delete_volume: values.deleteVolume ?? false }) });
      const jobId = firstString([response.job_id], "");
      if (!jobId) throw new Error("Huawei returned no job ID for the deletion.");
      return { message: "Server deletion submitted.", resourceId: resource.id, jobId, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported BMS operation.");
  },
};
