import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { cbhFetch as huaweiFetch, cbhProjectScope as projectScope, listNativeCbhInstances as instanceRows, type CbhNativeInstance as CbhInstance } from "@/lib/huawei/services/cbh-native";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

// Native CBH v2 contracts. Mutations return documented empty bodies, so a 200 without a native
// error object is the acceptance proof; identities and effects are re-verified from fresh records,
// and any value the native API does not report stays unknown instead of defaulting.
const bastionPrefix = "bastion:";
const orderPrefix = "order:";
const active = ["ACTIVE"];
const passwordCharset = /^[A-Za-z0-9!@$%^\-_=+\[{}\]:,.\/?~#*]+$/;
const updateLabels: Record<string, string> = { OLD: "Already the latest version", NEW: "Minor upgrade available", CROSS_OS: "Cross-version upgrade available", ROLLBACK: "Rollback available" };
const knownZoneStatuses = new Set(["Running", "Stopped"]);
const knownZoneTypes = new Set(["Core", "Dedicated"]);
const knownSpecTypes = new Set(["basic", "enhance"]);

/** Paginated native catalogs pass through the same sanitizing transport; no raw list import bypasses it. */
async function sanitizedList<T>(session: BetterUiSession, service: "cbh" | "vpc" | "eip" | "eps", path: string, pagination: Pagination): Promise<T> {
  return collectList(async (cursor) => {
    const url = new URL(path, "https://cbh.invalid");
    if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor));
    return huaweiFetch<T>(session, service, `${url.pathname}${url.search}`);
  }, pagination);
}

const nameField: ManagementField = { key: "name", label: "Instance name", required: true, min: 1, max: 64, pattern: "^[\\p{Script=Han}A-Za-z0-9_-]{1,64}$", help: "1-64 letters, digits, underscores, hyphens, or Chinese characters." };
const passwordField: ManagementField = { key: "password", label: "Admin sign-in password", type: "password", required: true, min: 8, max: 32, help: "8-32 characters combining at least three of lowercase, uppercase, digits, and the special characters !@$%^-_=+[{}]:,./?~#*. It cannot contain the admin user name or its reverse, nor more than two consecutive identical characters." };
const specificationField: ManagementField = { key: "specification", label: "Specification", type: "select", source: "specifications", required: true, help: "Bastion specifications currently offered in this region." };
const zoneField: ManagementField = { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true };
const subnetField: ManagementField = { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "An active subnet of this project; its VPC must also be active." };
const securityGroupField: ManagementField = { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true };
const periodTypeField: ManagementField = { key: "periodType", label: "Subscription period", type: "select", required: true, defaultValue: "month", choices: [{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly" }], help: "The native CBH API offers yearly/monthly (prepaid) orders only; monthly and yearly are the only accepted period types." };
const periodNumField: ManagementField = { key: "periodNum", label: "Number of periods", type: "number", required: true, min: 1, max: 10, help: "Monthly orders accept 1-9 months; yearly orders accept 1-10 years." };
const enterpriseProjectField: ManagementField = { key: "enterpriseProjectId", label: "Enterprise project", type: "select", source: "enterpriseProjects", help: "Current active enterprise projects of this account. Leave empty to let Huawei place the order in its default enterprise project." };
const eipField: ManagementField = { key: "eip", label: "Unbound elastic IP", type: "select", source: "eips", required: true, help: "A project-owned elastic IP proven currently unbound: native DOWN status with no attached NIC." };
const rebootTypeField: ManagementField = { key: "rebootType", label: "Restart method", type: "select", required: true, defaultValue: "SOFT", choices: [{ value: "SOFT", label: "SOFT · stop services and restart" }, { value: "HARD", label: "HARD · force restart" }] };
const upgradeTimeField: ManagementField = { key: "upgradeTime", label: "Upgrade time (UTC)", required: true, max: 20, pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$", help: "At least 24 hours ahead, in the form 2026-01-30T02:00:00Z. The date must be a real calendar date." };

function assertPassword(value: string) {
  if (value.length < 8 || value.length > 32) throw new ManagementInputError("The password must be 8 to 32 characters long.");
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[!@$%^\-_=+\[{}\]:,.\/?~#*]/].filter((expression) => expression.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and the special characters !@$%^-_=+[{}]:,./?~#*.");
  if (!passwordCharset.test(value)) throw new ManagementInputError("The password uses characters outside the supported CBH set (!@$%^-_=+[{}]:,./?~#*).");
  if (/(.)\1{2}/.test(value)) throw new ManagementInputError("The password cannot contain more than two consecutive identical characters.");
  if (/(admin|nimda)/i.test(value)) throw new ManagementInputError("The password cannot contain the admin user name or its reverse.");
}

function upgradeTimestamp(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text)) throw new ManagementInputError("Enter the upgrade time as a UTC timestamp in the form 2026-01-30T02:00:00Z.");
  const millis = Date.parse(text);
  if (!Number.isFinite(millis) || `${new Date(millis).toISOString().slice(0, -5)}Z` !== text) throw new ManagementInputError("The upgrade time is not a real UTC calendar date and time.");
  if (millis < Date.now() + 24 * 60 * 60 * 1000) throw new ManagementInputError("The upgrade must be scheduled at least 24 hours ahead.");
  return millis;
}

async function currentInstance(session: BetterUiSession, resource: ManagementResource | undefined, exactName: boolean) {
  if (!resource?.id.startsWith(bastionPrefix)) throw new ManagementInputError("Select a current CBH bastion instance.");
  const serverId = resource.id.slice(bastionPrefix.length);
  if (!serverId) throw new ManagementInputError("Select a current CBH bastion instance.");
  const record = (await instanceRows(session)).find((row) => row.serverId === serverId);
  if (!record) throw new ManagementInputError("The bastion instance was not found in this project.", 404);
  if (exactName && resource.name !== record.name) throw new ManagementInputError("The bastion instance name changed. Refresh the inventory and confirm its current name.", 409);
  return record;
}

function assertMutable(record: CbhInstance, statuses: string[]) {
  if (!statuses.includes(record.status)) throw new ManagementInputError(`This operation is unavailable while the bastion status is ${record.status}.`, 409);
  if (record.taskStatus !== "NO_TASK") throw new ManagementInputError(`The bastion is running a native task (${record.taskStatus}). Wait for it to finish and retry.`, 409);
}

type CbhSpec = { code: string; cpu: number; ram: number; asset: number; connection: number; type: string; dataDiskSize: number };

function knownPositive(value: unknown, label: string) {
  const amount = value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || (label !== "data disk size" && !Number.isSafeInteger(amount))) throw new ManagementInputError(`Huawei returned a CBH specification without a known positive ${label}.`, 409);
  return amount;
}

/** Specification codes are unique and every capacity is a known positive native number; nothing defaults to zero. */
async function specificationRows(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "cbh", `/v2/${projectScope(session)}/cbs/instance/specification?action=create`);
  if (!Array.isArray(body.body)) throw new ManagementInputError("Huawei returned no CBH specification catalog.", 409);
  const seen = new Set<string>();
  return body.body.map(asRecord).map((row): CbhSpec => {
    const code = firstString([row.resource_spec_code], "");
    if (!code) throw new ManagementInputError("Huawei returned an unverified CBH specification.", 409);
    if (seen.has(code)) throw new ManagementInputError("Huawei returned a duplicate CBH specification.", 409);
    seen.add(code);
    const type = firstString([row.type], "");
    if (!knownSpecTypes.has(type)) throw new ManagementInputError("Huawei returned a CBH specification without a known offering type.", 409);
    return { code, type, cpu: knownPositive(row.cpu, "vCPU count"), ram: knownPositive(row.ram, "RAM size"), asset: knownPositive(row.asset, "asset capacity"), connection: knownPositive(row.connection, "connection capacity"), dataDiskSize: knownPositive(row.data_disk_size, "data disk size") };
  });
}

type CbhZone = { id: string; name: string; status: string; type: string };

/** Zone ids are unique, their status and capability type are known native values, and they belong to the selected region. */
async function zoneRows(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "cbh", `/v2/${projectScope(session)}/cbs/available-zone`);
  if (!Array.isArray(body.availability_zone)) throw new ManagementInputError("Huawei returned no CBH availability zones.", 409);
  const seen = new Set<string>();
  return body.availability_zone.map(asRecord).map((row): CbhZone => {
    const id = firstString([row.id], "");
    if (!id) throw new ManagementInputError("Huawei returned an unverified CBH availability zone.", 409);
    if (seen.has(id)) throw new ManagementInputError("Huawei returned a duplicate CBH availability zone.", 409);
    seen.add(id);
    const status = firstString([row.status], "");
    if (!knownZoneStatuses.has(status)) throw new ManagementInputError("Huawei returned a CBH availability zone without a known status.", 409);
    const type = firstString([row.type], "");
    if (!knownZoneTypes.has(type)) throw new ManagementInputError("Huawei returned a CBH availability zone without a known capability type.", 409);
    if (firstString([row.region_id], "") !== session.region) throw new ManagementInputError("Huawei returned a CBH availability zone outside the selected region.", 409);
    return { id, name: firstString([row.display_name], id), status, type };
  });
}

type NetworkSubnet = { id: string; name: string; cidr: string; vpcId: string; status: string };

/** Raw native v1 subnet catalog of the selected project: unique identities and known native fields, no defaulted status. */
async function subnetRows(session: BetterUiSession) {
  const body = await sanitizedList<Record<string, unknown>>(session, "vpc", `/v1/${projectScope(session)}/subnets?limit=200`, { items: ["subnets"], kind: "marker", parameter: "marker", size: 200, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  const seen = new Set<string>();
  return asArray(body.subnets).map(asRecord).map((row): NetworkSubnet => {
    const id = firstString([row.id], "");
    if (!id) throw new ManagementInputError("Huawei returned an unverified subnet.", 409);
    if (seen.has(id)) throw new ManagementInputError("Huawei returned a duplicate subnet.", 409);
    seen.add(id);
    const vpcId = firstString([row.vpc_id], "");
    if (!vpcId) throw new ManagementInputError("Huawei returned a subnet without its native VPC identity.", 409);
    const status = firstString([row.status], "");
    if (!status) throw new ManagementInputError("Huawei returned a subnet without a known status.", 409);
    return { id, name: firstString([row.name], id), cidr: firstString([row.cidr], ""), vpcId, status };
  });
}

type NetworkVpc = { id: string; name: string; status: string };

/** Raw native v3 VPC catalog of the selected project with known statuses; nothing defaults to ACTIVE. */
async function vpcRows(session: BetterUiSession) {
  const body = await sanitizedList<Record<string, unknown>>(session, "vpc", `/v3/${projectScope(session)}/vpc/vpcs?limit=200`, { items: ["vpcs"], kind: "marker", parameter: "marker", size: 200, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  const seen = new Set<string>();
  return asArray(body.vpcs).map(asRecord).map((row): NetworkVpc => {
    const id = firstString([row.id], "");
    if (!id) throw new ManagementInputError("Huawei returned an unverified VPC.", 409);
    if (seen.has(id)) throw new ManagementInputError("Huawei returned a duplicate VPC.", 409);
    seen.add(id);
    const status = firstString([row.status], "");
    if (!status) throw new ManagementInputError("Huawei returned a VPC without a known status.", 409);
    return { id, name: firstString([row.name], id), status };
  });
}

type NetworkGroup = { id: string; name: string };

/** Raw native v3 security group catalog of the selected project with unique identities. */
async function securityGroupRows(session: BetterUiSession) {
  const body = await sanitizedList<Record<string, unknown>>(session, "vpc", `/v3/${projectScope(session)}/vpc/security-groups?limit=200`, { items: ["security_groups"], kind: "marker", parameter: "marker", size: 200, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  const seen = new Set<string>();
  return asArray(body.security_groups).map(asRecord).map((row): NetworkGroup => {
    const id = firstString([row.id], "");
    if (!id) throw new ManagementInputError("Huawei returned an unverified security group.", 409);
    if (seen.has(id)) throw new ManagementInputError("Huawei returned a duplicate security group.", 409);
    seen.add(id);
    return { id, name: firstString([row.name], id) };
  });
}

type NetworkEip = { id: string; name: string; ipAddress: string; status: string; nicOwner: string };

/**
 * Raw native v3 EIP catalog: the status is a known native field and the exact NIC identifier
 * fields decide bound state, so a missing association never masquerades as an empty default.
 */
async function eipRows(session: BetterUiSession) {
  const body = await sanitizedList<Record<string, unknown>>(session, "eip", `/v3/${projectScope(session)}/eip/publicips?limit=2000`, { items: ["publicips"], kind: "marker", parameter: "marker", size: 2000, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  const seen = new Set<string>();
  return asArray(body.publicips).map(asRecord).map((row): NetworkEip => {
    const id = firstString([row.id], "");
    if (!id) throw new ManagementInputError("Huawei returned an unverified elastic IP.", 409);
    if (seen.has(id)) throw new ManagementInputError("Huawei returned a duplicate elastic IP.", 409);
    seen.add(id);
    const status = firstString([row.status], "");
    if (!status) throw new ManagementInputError("Huawei returned an elastic IP without a known status.", 409);
    const associate = asRecord(row.associate_instance_info);
    const vnic = asRecord(row.vnic);
    for (const [source, key] of [[row, "associate_instance_id"], [row, "port_id"], [associate, "instance_id"], [vnic, "instance_id"], [vnic, "port_id"]] as const) if (key in source && source[key] !== null && typeof source[key] !== "string") throw new Error("Huawei returned an unverifiable EIP binding identity.");
    return { id, name: firstString([row.alias, row.name], id), ipAddress: firstString([row.public_ip_address, row.publicip_address], ""), status, nicOwner: firstString([associate.instance_id, vnic.instance_id, vnic.port_id, row.associate_instance_id, row.port_id], "") };
  });
}

/** Only a native DOWN status together with no exact NIC identifier proves an EIP currently unbound. */
function unboundEips(eips: NetworkEip[]) {
  return eips.filter((eip) => eip.status === "DOWN" && !eip.nicOwner);
}

/** Enterprise project selection comes from the current live account catalog; active projects only, never a free-form id. */
async function enterpriseProjectRows(session: BetterUiSession) {
  if (!session.accountToken) throw new ManagementInputError("Sign in with an account token to verify enterprise projects.", 409);
  const body = await collectList(async cursor => {
    const response = await huaweiFetch<Record<string, unknown>>({ ...session, token: session.accountToken! }, "eps", `/v1.0/enterprise-projects?offset=${cursor}&limit=100`);
    if (!Array.isArray(response.enterprise_projects) || typeof response.total_count !== "number" || !Number.isSafeInteger(response.total_count) || response.total_count < response.enterprise_projects.length) throw new Error("Huawei returned an incomplete enterprise-project catalog.");
    return response;
  }, { items: ["enterprise_projects"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  const seen = new Set<string>(), active: Array<{ id: string; name: string }> = [];
  for (const project of asArray(body.enterprise_projects).map(asRecord)) {
    if (typeof project.id !== "string" || !project.id || seen.has(project.id)) throw new Error("Huawei returned missing or duplicate enterprise-project identities.");
    seen.add(project.id);
    if (project.status === 1) active.push({ id: project.id, name: firstString([project.name], project.id) });
  }
  return active;
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create bastion instance", kind: "create", description: "Create one yearly/monthly (prepaid) bastion from live specifications, availability zones, and project networks. The order is created unpaid with automatic payment and renewal disabled (is_auto_pay 0, is_auto_renew 0); the bastion provisions after the order is paid. Charges follow Huawei's ordering conditions.", fields: [nameField, specificationField, zoneField, subnetField, securityGroupField, passwordField, periodTypeField, periodNumField, enterpriseProjectField], impact: "Creates an unpaid yearly/monthly order for a new bastion with its admin sign-in password. Automatic payment and renewal are disabled in the order; provisioning and charges follow Huawei's ordering conditions. The bastion is created without a public IP; attach a project-owned unbound EIP afterwards if public reachability is required." },
  { id: "inspect", label: "Inspect bastion", kind: "inspect", description: "Show the current native configuration, subscription, network, and upgrade state. Login URLs, one-time credentials, and private failure details are never displayed.", fields: [], resourcePrefixes: [bastionPrefix] },
  { id: "start", label: "Start instance", kind: "action", description: "Start a stopped bastion.", fields: [], allowedStatuses: ["SHUTOFF"], resourcePrefixes: [bastionPrefix], impact: "The bastion and its admin front end start again; managed-asset access through the bastion resumes." },
  { id: "stop", label: "Stop instance", kind: "action", description: "Stop a running bastion.", fields: [], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "Admin sign-in and every bastion-managed session close. The prepaid subscription keeps billing until it expires." },
  { id: "reboot", label: "Restart instance", kind: "action", description: "Restart a running bastion.", fields: [rebootTypeField], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "The bastion restarts and all admin and managed sessions close until it is back." },
  { id: "reset-password", label: "Reset admin password", kind: "action", description: "Replace the bastion's admin front-end sign-in password.", fields: [passwordField], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "The admin front-end sign-in password is replaced immediately. Anyone using the old password must use the new one." },
  { id: "reset-login-method", label: "Reset admin login method", kind: "action", description: "Reset the bastion's admin user login method to its native default.", fields: [], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "Huawei resets the admin user's native login method. Admin users must sign in again afterwards; verify sign-in once complete." },
  { id: "schedule-upgrade", label: "Schedule version upgrade", kind: "action", description: "Schedule a bastion version upgrade at least 24 hours ahead.", fields: [upgradeTimeField], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "Huawei upgrades the bastion to its next version at the scheduled time. The bastion can be unavailable during the upgrade." },
  { id: "cancel-upgrade", label: "Cancel scheduled upgrade", kind: "action", description: "Cancel a scheduled bastion version upgrade.", fields: [], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "The scheduled upgrade is canceled. Upgrades that already started cannot be canceled." },
  { id: "bind-eip", label: "Bind public IP", kind: "action", description: "Bind a project-owned unbound elastic IP to the bastion.", fields: [eipField], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "The bastion's admin front end becomes reachable from the public internet through the selected address. Verify the security group rules before binding." },
  { id: "unbind-eip", label: "Unbind public IP", kind: "action", description: "Unbind the bastion's current elastic IP.", fields: [], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "Public access to the bastion's front end is removed. The elastic IP remains owned by the project and keeps its own billing." },
  { id: "change-security-group", label: "Change security group", kind: "action", description: "Move the bastion to another security group in this project.", fields: [securityGroupField], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "Network access rules change immediately. Clients blocked by the new group lose connectivity to the bastion." },
  { id: "switch-vpc", label: "Change VPC and subnet", kind: "action", description: "Move the bastion to another project-owned VPC and subnet.", fields: [subnetField, securityGroupField], allowedStatuses: active, resourcePrefixes: [bastionPrefix], confirmation: true, impact: "The bastion moves to the selected VPC and subnet and its private address changes. Connectivity to managed assets can break until routes and security groups are restored." },
];

export const cbhManagement: ManagementAdapter = {
  title: "Cloud Bastion Instances (assets, users, access policies, session audit, and unsubscription remain in the CBH console)",
  operations,
  inventory: async (session) => (await instanceRows(session)).map((row) => ({
    id: `${bastionPrefix}${row.serverId}`,
    name: row.name,
    status: row.status,
    values: { task: row.taskStatus, version: row.version, specification: row.specification, zone: row.zone, publicIp: row.publicIp ?? "UNKNOWN", privateIp: row.privateIp, vpcId: row.vpcId, subnetId: row.subnetId, securityGroupId: row.securityGroupId, instanceId: row.instanceId, enterpriseProjectId: row.enterpriseProjectId, expires: row.endTime },
  })),
  options: async (session, operation): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [specs, zones, subnets, vpcs, groups] = await Promise.all([specificationRows(session), zoneRows(session), subnetRows(session), vpcRows(session), securityGroupRows(session)]);
      const activeVpcs = new Set(vpcs.filter((vpc) => vpc.status === "ACTIVE").map((vpc) => vpc.id));
      const enterpriseProjects = session.accountToken ? (await enterpriseProjectRows(session)).map((project) => ({ value: project.id, label: `${project.name} · ${project.id}` })) : [];
      return {
        specifications: specs.map((spec) => ({ value: spec.code, label: `${spec.code} · ${spec.type === "enhance" ? "Enhanced" : "Standard"} · ${spec.cpu} vCPU · ${spec.ram} GB RAM · ${spec.asset} assets · ${spec.connection} connections · ${spec.dataDiskSize} TB data disk` })),
        zones: zones.filter((zone) => zone.status === "Running" && zone.type !== "Dedicated").map((zone) => ({ value: zone.id, label: `${zone.id} · ${zone.name}` })),
        subnets: subnets.filter((subnet) => subnet.status === "ACTIVE" && activeVpcs.has(subnet.vpcId)).map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })),
        securityGroups: groups.map((group) => ({ value: group.id, label: group.name })),
        enterpriseProjects,
      };
    }
    if (operation === "bind-eip") {
      return { eips: unboundEips(await eipRows(session)).map((eip) => ({ value: eip.id, label: `${eip.name} · ${eip.ipAddress || eip.id}` })) };
    }
    if (operation === "change-security-group" || operation === "switch-vpc") {
      const groups = await securityGroupRows(session);
      const securityGroups = groups.map((group) => ({ value: group.id, label: group.name }));
      if (operation === "change-security-group") return { securityGroups };
      const [subnets, vpcs] = await Promise.all([subnetRows(session), vpcRows(session)]);
      const activeVpcs = new Set(vpcs.filter((vpc) => vpc.status === "ACTIVE").map((vpc) => vpc.id));
      return { subnets: subnets.filter((subnet) => subnet.status === "ACTIVE" && activeVpcs.has(subnet.vpcId)).map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })), securityGroups };
    }
    return {};
  },
  poll: async (session, entry) => {
    if (entry.operation === "Create bastion instance") {
      if (!entry.resourceId?.startsWith(orderPrefix) || !entry.jobId || entry.jobId !== entry.resourceId.slice(orderPrefix.length)) throw new ManagementInputError("This history entry has no verified original CBH order identity.");
      const matches = (await instanceRows(session)).filter((row) => row.orderId === entry.jobId);
      if (matches.length > 1) return { state: "submitted", message: "More than one bastion reports this order. The provisioned one cannot be uniquely identified from here; verify it in the CBH console." };
      if (matches.length === 1) {
        const provisioned = matches[0];
        if (provisioned.status === "ACTIVE" && provisioned.taskStatus === "NO_TASK") return { state: "succeeded", message: `The paid order provisioned bastion ${provisioned.name}, and it is running with no native task. Review its status and network before administering assets through it.`, resourceId: `${bastionPrefix}${provisioned.serverId}` };
        if (provisioned.status === "ERROR") return { state: "failed", message: `The order provisioned bastion ${provisioned.name}, but it reports a fault. Review its state in the CBH console.` };
        return { state: "submitted", message: `The order provisioned bastion ${provisioned.name}, but it is not ready yet (status ${provisioned.status}, task ${provisioned.taskStatus}).` };
      }
      return { state: "submitted", message: "The order has not provisioned a bastion yet. It provisions only after it is paid; a canceled or unpaid order never provisions one." };
    }
    if (!["Start instance", "Stop instance", "Restart instance"].includes(entry.operation)) throw new ManagementInputError("This CBH operation has no asynchronous observer.");
    if (!entry.resourceId?.startsWith(bastionPrefix) || !entry.jobId || entry.jobId !== entry.resourceId.slice(bastionPrefix.length)) throw new ManagementInputError("This history entry has no verified original bastion identity.");
    const record = (await instanceRows(session)).find((row) => row.serverId === entry.jobId);
    if (!record) return { state: "submitted", message: "The original bastion did not appear in the current inventory. A missing or partial inventory does not prove it was removed; verify it in the CBH console." };
    if (record.status === "ERROR") return { state: "failed", message: "The bastion reports a fault. Review its state in the CBH console before retrying." };
    if (entry.operation === "Start instance") {
      if (record.status === "ACTIVE" && record.taskStatus === "NO_TASK") return { state: "succeeded", message: "The bastion is running again with no native task.", resourceId: entry.resourceId };
      return { state: "submitted", message: `The bastion is still ${record.status} (task ${record.taskStatus}).` };
    }
    if (entry.operation === "Stop instance") {
      if (record.status === "SHUTOFF" && record.taskStatus === "NO_TASK") return { state: "succeeded", message: "The bastion is stopped with no native task.", resourceId: entry.resourceId };
      return { state: "submitted", message: `The bastion is still ${record.status} (task ${record.taskStatus}).` };
    }
    if (record.taskStatus === "rebooting") return { state: "submitted", observedTask: "rebooting", message: "The bastion restart is in progress." };
    if (entry.observedTask === "rebooting" && record.status === "ACTIVE" && record.taskStatus === "NO_TASK") return { state: "succeeded", message: "The observed restart task has finished and the bastion is running with no native task.", resourceId: entry.resourceId };
    return { state: "submitted", message: "The bastion reports no restart task. Its earlier running state does not prove the restart finished; verify admin sign-in on the bastion." };
  },
  invalidationKeys: () => [cloudCacheKeys.listCbhInstances, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      const [specs, zones, subnets, vpcs, groups] = await Promise.all([specificationRows(session), zoneRows(session), subnetRows(session), vpcRows(session), securityGroupRows(session)]);
      const spec = specs.find((item) => item.code === values.specification);
      if (!spec) throw new ManagementInputError("The selected bastion specification is no longer offered.");
      const zone = zones.find((item) => item.id === values.zone);
      if (!zone || zone.status !== "Running" || zone.type === "Dedicated") throw new ManagementInputError("The selected availability zone is not available for bastions.");
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.", 404);
      if (subnet.status !== "ACTIVE") throw new ManagementInputError("The selected subnet is not currently active.", 409);
      const vpc = vpcs.find((item) => item.id === subnet.vpcId);
      if (!vpc || vpc.status !== "ACTIVE") throw new ManagementInputError("The VPC of the selected subnet is not currently active.", 409);
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.", 404);
      assertPassword(String(values.password));
      if (values.periodType !== "month" && values.periodType !== "year") throw new ManagementInputError("Select the subscription period type: monthly or yearly.");
      const periodType = values.periodType === "year" ? 3 : 2;
      const periodNum = values.periodNum;
      if (typeof periodNum !== "number" || !Number.isSafeInteger(periodNum) || periodNum < 1 || periodNum > (periodType === 3 ? 10 : 9)) throw new ManagementInputError(periodType === 3 ? "Yearly orders accept 1 to 10 years." : "Monthly orders accept 1 to 9 months.");
      let enterpriseProjectId: string | undefined;
      if (values.enterpriseProjectId) {
        if (!session.accountToken) throw new ManagementInputError("The current sign-in cannot verify enterprise projects; leave the selection empty or sign in with an account token.");
        if (!(await enterpriseProjectRows(session)).some((project) => project.id === values.enterpriseProjectId)) throw new ManagementInputError("The selected enterprise project is not a current active enterprise project of this account.", 404);
        enterpriseProjectId = String(values.enterpriseProjectId);
      }
      const response = await huaweiFetch<Record<string, unknown>>(session, "cbh", `/v2/${projectScope(session)}/cbs/instance`, { method: "POST", body: JSON.stringify({
        specification: spec.code,
        instance_name: values.name,
        password: values.password,
        region: session.region,
        availability_zone: zone.id,
        charging_mode: 0,
        period_type: periodType,
        period_num: periodNum,
        is_auto_renew: 0,
        is_auto_pay: 0,
        network: { vpc_id: subnet.vpcId, subnet_id: subnet.id, security_groups: [{ id: values.securityGroup }] },
        ...(enterpriseProjectId ? { enterprise_project_id: enterpriseProjectId } : {}),
      }) });
      const orderId = firstString([response.order_id], "");
      if (!orderId) throw new Error("Huawei accepted the creation request but returned no verified order ID. The order may exist; check unpaid orders in the billing console before retrying.");
      return { message: `Unpaid order ${orderId} accepted for bastion ${values.name}. Automatic payment and renewal are disabled in the order (is_auto_pay 0, is_auto_renew 0); the bastion provisions after the order is paid in the billing console. Charges follow Huawei's ordering conditions.${enterpriseProjectId ? "" : " No enterprise project was selected; Huawei applies its own default."} No public IP is attached by this order.`, resourceId: `${orderPrefix}${orderId}`, jobId: orderId, asynchronous: true, facts: [
        { label: "Order ID", value: orderId },
        { label: "Billing", value: "Yearly/monthly prepaid · unpaid order · automatic payment and renewal disabled" },
        { label: "Specification", value: `${spec.code} · ${spec.cpu} vCPU · ${spec.ram} GB RAM · ${spec.asset} assets · ${spec.connection} connections` },
      ] };
    }
    if (operation === "inspect") {
      const record = await currentInstance(session, resource, false);
      const facts = [
        { label: "Instance", value: record.name },
        { label: "Bastion server ID", value: record.serverId },
        { label: "Bastion instance ID", value: record.instanceId || "Not reported" },
        { label: "Native resource ID", value: record.nativeResourceId || "Not reported" },
        { label: "Status", value: record.status },
        { label: "Task", value: record.taskStatus },
        { label: "Version", value: record.version || "Not reported" },
        { label: "Upgrade availability", value: updateLabels[record.updateFlag] ?? "Not reported" },
        { label: "Upgrade schedule", value: record.upgradeTime === null ? "Unknown (not reported)" : record.upgradeTime > 0 ? `Scheduled for ${new Date(record.upgradeTime).toISOString()}` : "None scheduled" },
        { label: "Specification", value: record.specification || "Not reported" },
        { label: "Zone", value: [record.zone, record.region].filter(Boolean).join(" / ") || "Not reported" },
        { label: "Private IP", value: record.privateIp || "Not reported" },
        { label: "Public IP", value: record.publicIp === null ? "Unknown (not reported)" : record.publicIp || "None bound" },
        { label: "VPC", value: record.vpcId || "Not reported" },
        { label: "Subnet", value: record.subnetId || "Not reported" },
        { label: "Security group", value: record.securityGroupId || "Not reported" },
        { label: "Enterprise project", value: record.enterpriseProjectId || "Not reported" },
        { label: "Subscription periods", value: record.periodNum || "Not reported" },
        { label: "Subscription start", value: record.startTime || "Not reported" },
        { label: "Subscription end", value: record.endTime || "Not reported" },
        { label: "Created", value: record.createdTime || "Not reported" },
      ];
      if (record.status === "ERROR") facts.push({ label: "Fault", value: "The bastion reports a fault; review its private details in the CBH console." });
      return { message: "Current bastion configuration. Login URLs and one-time credentials are never displayed.", facts };
    }
    if (!resource) throw new ManagementInputError("Select a bastion instance.");
    const record = await currentInstance(session, resource, true);
    const write = (path: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(session, "cbh", `/v2/${projectScope(session)}/cbs${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    /** Post-write verification reads never discard an accepted write: failures keep the accepted result and an uncertainty message. */
    const observed = async () => {
      try {
        return (await instanceRows(session)).find((row) => row.serverId === record.serverId);
      } catch {
        return undefined;
      }
    };
    if (operation === "start") {
      assertMutable(record, ["SHUTOFF"]);
      await write("/instance/start", "POST", { server_id: record.serverId });
      return { message: "Bastion start accepted. Admin sign-in and managed-asset access resume when it is running.", resourceId: resource.id, jobId: record.serverId, asynchronous: true };
    }
    if (operation === "stop") {
      assertMutable(record, active);
      await write("/instance/stop", "POST", { server_id: record.serverId });
      return { message: "Bastion stop accepted. Admin sessions close; the prepaid subscription keeps billing until it expires.", resourceId: resource.id, jobId: record.serverId, asynchronous: true };
    }
    if (operation === "reboot") {
      assertMutable(record, active);
      const rebootType = String(values.rebootType ?? "SOFT").toUpperCase();
      if (!["SOFT", "HARD"].includes(rebootType)) throw new ManagementInputError("Select a documented restart method.");
      await write("/instance/reboot", "POST", { server_id: record.serverId, reboot_type: rebootType });
      return { message: "Bastion restart accepted. All admin and managed sessions close until it is back; an earlier running state does not prove the restart finished.", resourceId: resource.id, jobId: record.serverId, asynchronous: true };
    }
    if (operation === "reset-password") {
      assertMutable(record, active);
      assertPassword(String(values.password));
      await write("/instance/password", "PUT", { server_id: record.serverId, new_password: values.password });
      return { message: "The admin sign-in password was accepted. The password is never displayed or stored by this console.", resourceId: resource.id };
    }
    if (operation === "reset-login-method") {
      assertMutable(record, active);
      await write("/instance/login-method", "PUT", { server_id: record.serverId });
      return { message: "The admin login method reset was accepted. Verify admin sign-in afterwards.", resourceId: resource.id };
    }
    if (operation === "schedule-upgrade") {
      assertMutable(record, active);
      if (!["NEW", "CROSS_OS"].includes(record.updateFlag)) throw new ManagementInputError(record.updateFlag === "OLD" ? "The bastion already runs the latest version." : "The bastion does not report an available upgrade.", 409);
      if (record.upgradeTime === null) throw new ManagementInputError("The bastion does not report a verified current upgrade time, so an existing schedule cannot be ruled out. Inspect it in the CBH console first.", 409);
      if (record.upgradeTime > 0) throw new ManagementInputError("An upgrade is already scheduled for this bastion. Cancel it before scheduling another.", 409);
      const when = upgradeTimestamp(values.upgradeTime);
      await write("/instance/upgrade", "POST", { server_id: record.serverId, upgrade_time: when });
      const current = await observed();
      if (current?.upgradeTime === when) return { message: `Upgrade scheduled for ${String(values.upgradeTime)} (UTC) and verified from the bastion record. The bastion can be unavailable during the upgrade.`, resourceId: resource.id };
      return { message: `Upgrade request for ${String(values.upgradeTime)} (UTC) accepted, but the schedule is not yet verified in the bastion record. Treat it as accepted, not guaranteed; reload the inventory to verify.`, resourceId: resource.id };
    }
    if (operation === "cancel-upgrade") {
      assertMutable(record, active);
      if (record.upgradeTime === null) throw new ManagementInputError("The bastion does not report a verified current upgrade time, so a scheduled upgrade cannot be confirmed for cancellation.", 409);
      if (record.upgradeTime === 0) throw new ManagementInputError("The bastion does not report a scheduled upgrade.", 409);
      await write("/instance/upgrade", "POST", { server_id: record.serverId, upgrade_time: record.upgradeTime, cancel: true });
      const current = await observed();
      if (current?.upgradeTime === 0) return { message: "The scheduled upgrade was canceled and the bastion record reports no upgrade scheduled. Upgrades that already started cannot be canceled.", resourceId: resource.id };
      return { message: "Upgrade cancellation accepted, but it is not yet verified in the bastion record. Treat it as accepted, not guaranteed; reload the inventory to verify.", resourceId: resource.id };
    }
    if (operation === "bind-eip") {
      assertMutable(record, active);
      if (record.publicId === null || record.publicIp === null) throw new ManagementInputError("The bastion's current public IP binding is not reported; refresh the inventory and verify it before binding.", 409);
      if (record.publicId || record.publicIp) throw new ManagementInputError("The bastion already reports a public IP binding. Unbind it first.", 409);
      const eip = unboundEips(await eipRows(session)).find((item) => item.id === values.eip);
      if (!eip) throw new ManagementInputError("The selected elastic IP is not a verified unbound EIP of this project.", 404);
      await write(`/instance/${encodeURIComponent(record.serverId)}/eip/bind`, "POST", { publicip_id: eip.id });
      const current = await observed();
      if (current?.publicId === eip.id && current.publicIp) return { message: `Public IP ${eip.ipAddress || eip.id} is bound to the bastion, verified from its record. Verify the security group before using public access.`, resourceId: resource.id };
      return { message: "Public IP binding accepted. The binding is not yet verified in the bastion record; reload the inventory to verify it.", resourceId: resource.id };
    }
    if (operation === "unbind-eip") {
      assertMutable(record, active);
      if (record.publicId === null) throw new ManagementInputError("The bastion's current public IP binding is not reported; refresh the inventory and verify it before unbinding.", 409);
      if (!record.publicId) throw new ManagementInputError("The bastion has no public IP bound.", 409);
      await write(`/instance/${encodeURIComponent(record.serverId)}/eip/unbind`, "POST", { publicip_id: record.publicId });
      const current = await observed();
      if (current?.publicId === "" && current?.publicIp === "") return { message: "The public IP was unbound from the bastion, verified from its record. The elastic IP remains owned by the project and keeps its own billing.", resourceId: resource.id };
      return { message: "Public IP unbinding accepted. The unbinding is not yet verified in the bastion record (the instance may be missing or its public IP fields unreported); reload the inventory to verify it.", resourceId: resource.id };
    }
    if (operation === "change-security-group") {
      assertMutable(record, active);
      if (!(await securityGroupRows(session)).some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.", 404);
      if (record.securityGroupId === values.securityGroup) throw new ManagementInputError("The bastion already uses this security group.", 409);
      await write(`/instance/${encodeURIComponent(record.serverId)}/security-groups`, "PUT", { security_groups: [values.securityGroup] });
      const current = await observed();
      if (current?.securityGroupId === values.securityGroup) return { message: "The bastion now uses the selected security group, verified from its record. Network access rules changed immediately.", resourceId: resource.id };
      return { message: "Security group change accepted. The change is not yet verified in the bastion record; reload the inventory to verify it.", resourceId: resource.id };
    }
    if (operation === "switch-vpc") {
      assertMutable(record, active);
      const [subnets, vpcs, groups] = await Promise.all([subnetRows(session), vpcRows(session), securityGroupRows(session)]);
      const subnet = subnets.find((item) => item.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.", 404);
      if (subnet.status !== "ACTIVE") throw new ManagementInputError("The selected subnet is not currently active.", 409);
      const vpc = vpcs.find((item) => item.id === subnet.vpcId);
      if (!vpc || vpc.status !== "ACTIVE") throw new ManagementInputError("The VPC of the selected subnet is not currently active.", 409);
      if (!groups.some((group) => group.id === values.securityGroup)) throw new ManagementInputError("The selected security group is no longer available in this project.", 404);
      if (subnet.vpcId === record.vpcId && subnet.id === record.subnetId) throw new ManagementInputError("The bastion already uses this VPC and subnet.", 409);
      await write("/instance/vpc", "PUT", { server_id: record.serverId, network: { vpc_id: subnet.vpcId, subnet_id: subnet.id, security_groups: [{ id: values.securityGroup }] } });
      const current = await observed();
      if (current?.vpcId === subnet.vpcId && current?.subnetId === subnet.id && current?.securityGroupId === values.securityGroup) return { message: "The bastion now uses the selected VPC, subnet, and security group, verified from its record. Its private address changed; restore routes and security rules for managed assets.", resourceId: resource.id };
      return { message: "VPC and subnet change accepted. The change, including the requested security group, is not yet verified in the bastion record; reload the inventory to verify it.", resourceId: resource.id };
    }
    throw new ManagementInputError("Unsupported CBH operation.");
  },
};
