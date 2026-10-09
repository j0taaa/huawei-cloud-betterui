import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { HuaweiApiError, huaweiFetch as nativeFetch } from "@/lib/huawei/http";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const desktopPrefix = "desktop:";
const desktopStatus = (value: unknown) => typeof value === "string" && ["ACTIVE", "SHUTOFF", "BUILD", "ERROR", "HIBERNATED", "DELETING"].includes(value) ? value : "UNKNOWN";
const userPrefix = "user:";
const poolPrefix = "pool:";
const payPerUse = "1";
const base = (session: BetterUiSession) => `/v2/${session.projectId}`;
const deleteLabels = new Set(["Delete desktop", "Delete user", "Delete empty pool"]);
function assertProject(row: Record<string, unknown>, session: BetterUiSession) {
  for (const key of ["project_id", "projectId"]) if (row[key] !== undefined && row[key] !== session.projectId) throw new Error("Huawei returned Workspace data for another project.");
}
async function huaweiFetch<T>(session: BetterUiSession, service: "workspace" | "vpc", path: string, init?: RequestInit): Promise<T> {
  try {
    const body = await nativeFetch<T>(session, service, path, init), row = asRecord(body);
    if (row.error_code !== undefined && row.error_code !== "0") throw new HuaweiApiError("Huawei rejected the Workspace request.", 502);
    assertProject(row, session);
    for (const key of ["desktop", "user_detail"]) if (row[key] !== undefined) assertProject(asRecord(row[key]), session);
    for (const key of ["desktops", "users", "desktop_pools", "products", "images", "subnets", "availability_zones", "objects", "existing_agencies"]) if (Array.isArray(row[key])) for (const item of row[key]) assertProject(asRecord(item), session);
    return body;
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected the Workspace request (HTTP ${error.status}).`, error.status);
    throw new Error("Huawei returned an unverifiable Workspace response or project. Check native state before retrying.");
  }
}
async function huaweiList<T>(session: BetterUiSession, service: "workspace", path: string, pagination: Pagination): Promise<T> {
  return collectList(async cursor => {
    const url = new URL(path, "https://local.invalid");
    if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor));
    const body = await huaweiFetch<T>(session, service, url.pathname + url.search), row = asRecord(body);
    const items = row[pagination.items[0]], total = row[pagination.total![0]];
    if (!Array.isArray(items)) throw new Error(`Invalid list response: expected ${pagination.items[0]}.`);
    if (typeof total !== "number" || !Number.isSafeInteger(total) || total < items.length) throw new Error("Huawei returned an incomplete Workspace page or total.");
    return body;
  }, pagination);
}
async function fresh<T>(load: () => Promise<T>) { try { return await load(); } catch { return undefined; } }
async function poolUsers(session: BetterUiSession, id: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "workspace", `${base(session)}/desktop-pools/${encodeURIComponent(id)}/users?limit=100`, { items: ["objects"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  if (!Array.isArray(body.objects)) throw new Error("Huawei returned no pool authorization list.");
  const rows = body.objects.map(asRecord), seen = new Set<string>();
  for (const row of rows) {
    if (!["USER", "USER_GROUP"].includes(String(row.object_type)) || typeof row.object_id !== "string" || !row.object_id) throw new Error("Huawei returned an unverifiable pool authorization.");
    const key = `${row.object_type}:${row.object_id}`;
    if (seen.has(key) || (row.pool_id !== undefined && row.pool_id !== id)) throw new Error("Huawei returned duplicate or foreign pool authorizations.");
    seen.add(key);
  }
  return rows;
}
async function assertAgencyReady(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/agencies?scene=WORKSPACE`);
  if (!Array.isArray(body.existing_agencies)) throw new ManagementInputError("Workspace agency readiness could not be verified. Configure it in the Huawei console first.", 409);
  const ready = body.existing_agencies.map(asRecord).some(row => {
    if (row.name !== "ServiceLinkedAgencyForWorkspace" || (row.scene !== undefined && row.scene !== "WORKSPACE") || !Array.isArray(row.permissions) || !row.permissions.length) return false;
    return row.permissions.map(asRecord).every(permission => {
      const have = permission.system_permission_display_names, want = permission.wanted_system_permission_display_names, needed = permission.should_have_system_permission_display_names;
      return Array.isArray(have) && have.includes("WorkspaceServiceLinkedAgencyPolicy") && have.every(value => typeof value === "string" && value.length > 0) && Array.isArray(want) && want.length === 0 && Array.isArray(needed) && needed.length > 0 && needed.every(value => typeof value === "string" && have.includes(value));
    });
  });
  if (!ready) throw new ManagementInputError("Workspace requires its service-linked agency and current permissions. Configure them in the Huawei console before provisioning; this flow never grants permissions.", 409);
}
// Verified against the primary Workspace API reference (2026-09-11): products carry a native string
// charge_mode ("1" pay-per-use) and status "normal"; product memory is reported in MB; image IDs are
// the native `id` field; CreateDesktop nics[].subnet_id and CreateDesktopPool subnet_ids take the
// workspace service subnet network ID (ListSubnets neutron_subnet_id, cross-checked with the VPC
// catalog and the configured workspace subnets); system disks are 80-32760 GB in multiples of 10;
// DeleteDesktop and DeleteUser return 204 with no job, so deletions are observed until 404.
// Agency readiness is read from ListAgencies; the native pool status STEADY is required for deletion.
// Advanced directory, disk, protocol, pool scaling, subscription, and policy workflows remain gaps.
const desktopNameField: ManagementField = { key: "name", label: "Computer name", required: true, min: 1, max: 15, pattern: "^[A-Za-z0-9]([A-Za-z0-9-]{0,13}[A-Za-z0-9])?$", help: "1-15 letters, digits, or hyphens; it must start and end with a letter or digit and be unique in the workspace." };
const poolNameField: ManagementField = { key: "name", label: "Pool name", required: true, min: 1, max: 64, pattern: "^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?$", help: "1-64 letters, digits, or hyphens; it must start and end with a letter or digit and be unique in the workspace." };
const userNameField: ManagementField = { key: "name", label: "User name", required: true, min: 1, max: 20, pattern: "^[A-Za-z][A-Za-z0-9_-]{0,19}$", help: "1-20 characters starting with a letter; letters, digits, hyphens, and underscores." };
const emailField: ManagementField = { key: "email", label: "Email", required: true, max: 320, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", help: "Huawei sends the activation email here. This management flow never sets or stores passwords." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 255, allowEmpty: true };
const userGroupField: ManagementField = { key: "userGroup", label: "Desktop user group", type: "select", required: true, choices: [
  { value: "administrators", label: "administrators · Windows administrator" },
  { value: "users", label: "users · Windows standard user" },
  { value: "sudo", label: "sudo · Linux administrator" },
  { value: "default", label: "default · Linux standard user" },
], help: "Windows desktops use administrators or users; Linux desktops use sudo or default. The group must match the selected image's operating system." };
const productField: ManagementField = { key: "product", label: "Product", type: "select", source: "products", required: true, help: "Products currently on sale (native status normal) in native pay-per-use charge mode. Subscription (periodic) products are not offered because they require an explicit order workflow." };
const imageField: ManagementField = { key: "image", label: "Image", type: "select", source: "images", required: true, help: "Public and private images currently available in this workspace." };
const zoneField: ManagementField = { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true };
const subnetField: ManagementField = { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "Service subnets registered with this workspace. The workspace's configured network ID is sent for the desktop NIC." };

function strictRows(rows: unknown, label: string, idKeys: string[], nameKeys?: string[]) {
  if (!Array.isArray(rows)) throw new Error(`Huawei returned no ${label} list.`);
  const records = rows.map(asRecord);
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const record of records) {
    const id = firstString(idKeys.map((key) => record[key]), "");
    if (!id) throw new Error(`Huawei returned a ${label} without an ID.`);
    if (seenIds.has(id)) throw new Error(`Huawei returned duplicate ${label} IDs.`);
    seenIds.add(id);
    if (!nameKeys) continue;
    const name = firstString(nameKeys.map((key) => record[key]), "");
    if (!name) throw new Error(`Huawei returned a ${label} without a name.`);
    if (seenNames.has(name)) throw new Error(`Huawei returned duplicate ${label} names.`);
    seenNames.add(name);
  }
  return records;
}

async function desktopRows(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "workspace", `${base(session)}/desktops?limit=100`, { items: ["desktops"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return strictRows(body.desktops, "desktop", ["desktop_id"], ["computer_name", "os_host_name", "desktop_id"]);
}

async function userRows(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "workspace", `${base(session)}/users?limit=100`, { items: ["users"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return strictRows(body.users, "workspace user", ["id"], ["user_name"]);
}

async function poolRows(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "workspace", `${base(session)}/desktop-pools?limit=100`, { items: ["desktop_pools"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return strictRows(body.desktop_pools, "desktop pool", ["id"], ["name"]);
}

async function productRows(session: BetterUiSession, filters?: { osType?: string; architecture?: string; zone?: string }) {
  const query = new URLSearchParams({ charge_mode: payPerUse, limit: "100" });
  if (filters?.osType) query.set("os_type", filters.osType);
  if (filters?.architecture) query.set("architecture", filters.architecture);
  if (filters?.zone) query.set("availability_zone", filters.zone);
  const body = await huaweiList<Record<string, unknown>>(session, "workspace", `${base(session)}/products?${query}`, { items: ["products"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return strictRows(body.products, "product", ["product_id"]).filter((row) => row.charge_mode === payPerUse).filter((row) => row.status === "normal").filter((row) => row.domain_ids === undefined || (Array.isArray(row.domain_ids) && row.domain_ids.length === 0));
}

async function imageRows(session: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(session, "workspace", `${base(session)}/images?limit=100`, { items: ["images"], kind: "offset", parameter: "offset", size: 100, total: ["total_count"] });
  return strictRows(body.images, "image", ["id"]);
}

async function zoneRows(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/availability-zones`);
  return strictRows(body.availability_zones, "availability zone", ["availability_zone"]);
}

async function subnetRows(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/subnets`);
  const rows = strictRows(body.subnets, "workspace subnet", ["id"]);
  if (verifiedCount(body.subnet_size) !== rows.length) throw new Error("Huawei returned an incomplete workspace subnet list.");
  return rows;
}

async function workspaceTenant(session: BetterUiSession) {
  return huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/workspaces`);
}

function assertWorkspaceReady(tenant: Record<string, unknown>) {
  if (tenant.config_status !== "0" || tenant.status !== "SUBSCRIBED") throw new ManagementInputError("The Workspace service is not fully configured in this project. Finish the service activation (including the AD connection) in the Huawei console first; this flow never activates the service or creates agencies.", 409);
}

function tenantNetworkIds(tenant: Record<string, unknown>) {
  if (!Array.isArray(tenant.subnet_ids)) throw new ManagementInputError("The configured Workspace subnets could not be verified.", 409);
  const ids = tenant.subnet_ids.map(entry => asRecord(entry).subnet_id);
  if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw new ManagementInputError("The configured Workspace subnets could not be verified.", 409);
  return ids as string[];
}

async function networkChoice(session: BetterUiSession, subnetId: string, tenant: Record<string, unknown>) {
  const subnets = await subnetRows(session);
  const subnet = subnets.find((row) => firstString([row.id], "") === subnetId);
  if (!subnet) throw new ManagementInputError("The selected subnet is no longer registered with this workspace.");
  const networkId = firstString([subnet.neutron_subnet_id], "");
  if (!networkId) throw new ManagementInputError("The selected subnet does not expose the network ID that desktop provisioning requires.");
  const vpcId = firstString([subnet.vpc_id], "");
  if (!vpcId) throw new ManagementInputError("The selected subnet does not expose its VPC ID.");
  const tenantVpc = firstString([tenant.vpc_id], "");
  if (!tenantVpc) throw new ManagementInputError("The workspace's configured VPC could not be verified.");
  if (vpcId !== tenantVpc) throw new ManagementInputError("The selected subnet is not in the workspace's configured VPC.");
  const configured = tenantNetworkIds(tenant);
  if (!configured.length) throw new ManagementInputError("The workspace's configured service subnets could not be verified.");
  if (!configured.includes(networkId)) throw new ManagementInputError("The selected subnet is not one of the workspace's configured service subnets.");
  const body = await collectList(async cursor => {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor !== undefined) query.set("marker", String(cursor));
    const page = await huaweiFetch<Record<string, unknown>>(session, "vpc", `/v1/${session.projectId}/subnets?${query}`);
    strictRows(page.subnets, "VPC subnet", ["id"]);
    return page;
  }, { items: ["subnets"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  const vpcSubnets = strictRows(body.subnets, "VPC subnet", ["id"]);
  if (subnet.status !== "ACTIVE" || !vpcSubnets.some((row) => row.vpc_id === vpcId && row.id === subnetId && row.neutron_subnet_id === networkId && row.status === "ACTIVE")) throw new ManagementInputError("The selected subnet could not be verified against the project's VPC subnets.");
  return { networkId, vpcId };
}

async function desktopRecord(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/desktops/${encodeURIComponent(id)}`);
  const record = asRecord(body.desktop);
  if (record.desktop_id !== id) throw new Error("Huawei returned an unverifiable desktop identity.");
  return record;
}

async function userRecord(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/users/${encodeURIComponent(id)}`);
  const record = asRecord(body.user_detail);
  if (record.id !== id) throw new Error("Huawei returned an unverifiable workspace user identity.");
  return record;
}

async function poolRecord(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/desktop-pools/${encodeURIComponent(id)}`);
  if (body.id !== id) throw new Error("Huawei returned an unverifiable desktop pool identity.");
  return body;
}

async function desktopGone(session: BetterUiSession, id: string) {
  try { await desktopRecord(session, id); return false; } catch (error) {
    if ((error instanceof HuaweiApiError) && error.status === 404) return true;
    throw error;
  }
}

async function userGone(session: BetterUiSession, id: string) {
  try { await userRecord(session, id); return false; } catch (error) {
    if ((error instanceof HuaweiApiError) && error.status === 404) return true;
    throw error;
  }
}

async function poolGone(session: BetterUiSession, id: string) {
  try { await poolRecord(session, id); return false; } catch (error) {
    if ((error instanceof HuaweiApiError) && error.status === 404) return true;
    throw error;
  }
}

function selected(resource: ManagementResource | undefined, prefix: string, label: string) {
  if (!resource?.id.startsWith(prefix)) throw new ManagementInputError(`Select a ${label}.`);
  const id = resource.id.slice(prefix.length);
  if (!id) throw new ManagementInputError(`Select a ${label}.`);
  return id;
}

function assertIdle(record: Record<string, unknown>, label: string) {
  const task = record.task_status;
  if (task === "") return;
  if (typeof task === "string" && task) throw new ManagementInputError(`The ${label} is running a cloud task. Wait for it to finish before making changes.`, 409);
  throw new ManagementInputError(`Huawei did not report the ${label}'s cloud task state. Reload the ${label} and retry once the state is clear.`, 409);
}

function userStatus(row: Record<string, unknown>) {
  if (row.locked === true) return "LOCKED";
  if (row.disabled === true) return "DISABLED";
  if (row.locked === false && row.disabled === false) return "ACTIVE";
  return "UNKNOWN";
}

function verifiedCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function groupsForOs(osType: string) {
  const os = osType.trim().toLowerCase();
  if (os === "windows") return ["administrators", "users"];
  if (os === "linux") return ["sudo", "default"];
  return [];
}

function memoryLabel(memory: unknown) {
  const mb = Number(memory);
  if (!Number.isFinite(mb) || mb <= 0) return "unknown";
  const gb = mb / 1024;
  return Number.isInteger(gb) ? `${gb} GB` : `${mb} MB`;
}

function productDisk(product: Record<string, unknown>) {
  const type = firstString([product.system_disk_type], "");
  const size = Number(product.system_disk_size);
  if (!["SAS", "SSD"].includes(type) || !Number.isSafeInteger(size) || size < 80 || size > 32760 || size % 10 !== 0) throw new ManagementInputError("The selected product does not expose a system disk within Huawei's 80-32760 GB range (multiples of 10 GB).");
  return { type, size };
}

async function imageChoice(session: BetterUiSession, imageId: string) {
  const images = await imageRows(session);
  const image = images.find((row) => firstString([row.id], "") === imageId);
  if (!image) throw new ManagementInputError("The selected image is no longer available in this workspace.");
  const imageType = String(image.image_type ?? "");
  if (!["gold", "private"].includes(imageType)) throw new ManagementInputError("Only public and private images can be used to provision desktops.");
  const osType = firstString([image.os_type], "");
  const groups = groupsForOs(osType);
  if (!groups.length) throw new ManagementInputError("The selected image does not report a supported operating system.");
  const architecture = firstString([image.architecture], "");
  if (!["x86", "arm"].includes(architecture)) throw new ManagementInputError("The selected image does not report a supported architecture.");
  return { image, imageType, osType, architecture, groups };
}

function chosenProduct(products: Record<string, unknown>[], productId: string, imageType: string, architecture: string, osType: string, zone: string) {
  const product = products.find((row) => firstString([row.product_id], "") === productId && (!firstString([row.architecture], "") || firstString([row.architecture], "").toLowerCase() === architecture.toLowerCase()));
  if (!product) throw new ManagementInputError("The selected product is unavailable for the selected image, architecture, and zone. Only pay-per-use products currently on sale are offered; subscription products require an explicit order workflow.");
  if ((product.os_type !== undefined && product.os_type !== osType) || (product.availability_zone !== undefined && product.availability_zone !== zone)) throw new ManagementInputError("The selected product is incompatible with the image or availability zone.");
  if (imageType === "private" && String(product.type ?? "") !== "BASE") throw new ManagementInputError("Private images can only be combined with basic (BASE) product packages per Huawei's product catalog.");
  return product;
}

const operations: ManagementOperation[] = [
  { id: "create-desktop", label: "Create desktop", kind: "create", description: "Create one dedicated pay-per-use cloud desktop for an existing workspace user from live product, image, zone, and subnet catalogs. Requires an activated Workspace service.", impact: "The desktop bills hourly at the selected pay-per-use product rate from creation. The selected product, image licensing, disks, and snapshots can incur charges. Review Huawei pricing for this configuration. No subscription order is placed. The assigned user receives no automatic email notification from this flow.", fields: [
    desktopNameField,
    { key: "user", label: "Workspace user", type: "select", source: "users", required: true, help: "The desktop is assigned to this existing workspace user. Locked, disabled, or unverified users cannot receive desktops." },
    userGroupField,
    productField,
    imageField,
    zoneField,
    subnetField,
  ] },
  { id: "inspect-desktop", label: "View desktop configuration", kind: "inspect", description: "Show the desktop's status, assignment, product, system disk, and operating system without exposing addresses or machine identifiers.", fields: [], resourcePrefixes: [desktopPrefix] },
  { id: "rename-desktop", label: "Rename desktop", kind: "update", description: "Change the desktop's computer name and verify the new name with a fresh read.", fields: [desktopNameField], resourcePrefixes: [desktopPrefix] },
  { id: "self-backup", label: "Toggle user snapshot management", kind: "update", description: "Allow or forbid the desktop's user from managing their own snapshots.", fields: [{ key: "enable", label: "Allow user snapshot management", type: "boolean", required: true }], resourcePrefixes: [desktopPrefix], confirmation: true, impact: "When enabled, the desktop's user can create and restore their own snapshots, which consume snapshot storage that is billed." },
  { id: "start", label: "Start desktop", kind: "action", description: "Power on a shut-down desktop.", fields: [], resourcePrefixes: [desktopPrefix], allowedStatuses: ["SHUTOFF"] },
  { id: "stop", label: "Stop desktop", kind: "action", description: "Gracefully shut down a running desktop.", fields: [], resourcePrefixes: [desktopPrefix], allowedStatuses: ["ACTIVE"], confirmation: true, impact: "Connected users are disconnected immediately; unsaved work can be lost. The desktop keeps its configuration and data." },
  { id: "reboot", label: "Reboot desktop", kind: "action", description: "Gracefully restart a running desktop.", fields: [], resourcePrefixes: [desktopPrefix], allowedStatuses: ["ACTIVE"], confirmation: true, impact: "Connected users are disconnected immediately; unsaved work can be lost. The desktop comes back after the restart." },
  { id: "hibernate", label: "Hibernate desktop", kind: "action", description: "Hibernate a running desktop so it resumes faster on the next start.", fields: [], resourcePrefixes: [desktopPrefix], allowedStatuses: ["ACTIVE"], confirmation: true, impact: "Connected users are disconnected. The desktop hibernates and resumes with its previous memory state when started." },
  { id: "delete-desktop", label: "Delete desktop", kind: "delete", description: "Permanently delete one desktop after exact-name confirmation. The workspace user account is kept.", fields: [], resourcePrefixes: [desktopPrefix], confirmation: true, impact: "The desktop and all data on its disks are permanently destroyed and cannot be restored. Subscription desktops require a separate order workflow; this flow keeps watching until the desktop is gone. Review final charges in Billing. The workspace user account is kept and must be deleted separately." },
  { id: "create-user", label: "Create workspace user", kind: "create", description: "Create one workspace user who activates their own password from an email. This flow never sets, sends, or stores passwords.", impact: "Huawei sends an activation email to the address entered here. The user sets their own password; no password travels through this management flow.", fields: [userNameField, emailField, descriptionField] },
  { id: "inspect-user", label: "View user settings", kind: "inspect", description: "Show the user's activation, lock, desktop count, and password policy settings without machine identifiers.", fields: [], resourcePrefixes: [userPrefix] },
  { id: "update-user", label: "Edit user settings", kind: "update", description: "Change the user's email or description and verify the change with a fresh read. Every other setting is preserved.", fields: [{ ...emailField, required: false }, { ...descriptionField, required: false }], resourcePrefixes: [userPrefix] },
  { id: "lock-user", label: "Lock user", kind: "action", description: "Lock the user so they cannot sign in to desktops.", fields: [], resourcePrefixes: [userPrefix], allowedStatuses: ["ACTIVE"], confirmation: true, impact: "The user cannot sign in to any desktop until unlocked. Active sessions can be disrupted." },
  { id: "unlock-user", label: "Unlock user", kind: "action", description: "Unlock a locked user.", fields: [], resourcePrefixes: [userPrefix], allowedStatuses: ["LOCKED"] },
  { id: "delete-user", label: "Delete user", kind: "delete", description: "Permanently delete a workspace user who owns no desktops.", fields: [], resourcePrefixes: [userPrefix], confirmation: true, impact: "The user account is permanently removed from the workspace and cannot be restored. This flow verifies from live data that the user owns no desktops first; Huawei rejects users with remaining dependencies." },
  { id: "create-pool", label: "Create desktop pool", kind: "create", description: "Create one dynamic or static pool of pay-per-use desktops for selected workspace users from live catalogs. Requires an activated Workspace service.", impact: "The pool provisions the requested number of desktops, each billed hourly at the selected pay-per-use product rate. The selected product, image licensing, disks, and snapshots can incur charges. Review Huawei pricing for this configuration. No subscription order is placed.", fields: [
    poolNameField,
    { key: "type", label: "Pool type", type: "select", required: true, choices: [{ value: "DYNAMIC", label: "DYNAMIC · desktops assigned on connect" }, { value: "STATIC", label: "STATIC · desktops bound to users" }] },
    { key: "size", label: "Desktop count", type: "number", required: true, min: 1, max: 100, defaultValue: 1, help: "How many desktops the pool creates now. Each desktop bills hourly." },
    { key: "users", label: "Authorized users", type: "list", source: "poolUsers", required: true, max: 100, help: "Existing active workspace users who can use the pool's desktops. Locked, disabled, or unverified users cannot be authorized." },
    userGroupField,
    productField,
    imageField,
    zoneField,
    subnetField,
    descriptionField,
  ] },
  { id: "inspect-pool", label: "View pool configuration", kind: "inspect", description: "Show the pool's type, charging mode, desktop counts, product, image, and system disk.", fields: [], resourcePrefixes: [poolPrefix] },
  { id: "delete-pool", label: "Delete empty pool", kind: "delete", description: "Permanently delete a desktop pool that contains no desktops.", fields: [], resourcePrefixes: [poolPrefix], confirmation: true, impact: "The pool configuration is permanently removed. The native API deletes every desktop in a pool with it, so this flow requires the pool to be empty first and keeps watching until the pool is gone." },
];

export const workspaceManagement: ManagementAdapter = {
  title: "Cloud Desktop (Workspace)",
  operations,
  inventory: async (session) => {
    const [desktops, users, pools] = await Promise.all([desktopRows(session), userRows(session), poolRows(session)]);
    return [
      ...desktops.map((row) => ({
        id: `${desktopPrefix}${firstString([row.desktop_id], "")}`,
        name: firstString([row.computer_name, row.os_host_name, row.desktop_id], "Desktop"),
        status: desktopStatus(row.status),
        values: { user: firstString([row.user_name], ""), taskStatus: row.task_status === "" ? "Idle" : typeof row.task_status === "string" ? "Busy" : "Unknown", zone: firstString([row.availability_zone], ""), poolId: firstString([row.pool_id], ""), desktopType: firstString([row.desktop_type], "") },
      })),
      ...users.map((row) => {
        const owned = verifiedCount(row.total_desktops);
        return {
          id: `${userPrefix}${firstString([row.id], "")}`,
          name: firstString([row.user_name], ""),
          status: userStatus(row),
          values: { ...(owned === undefined ? {} : { desktops: owned }), activeType: firstString([row.active_type], "") },
        };
      }),
      ...pools.map((row) => {
        const count = verifiedCount(row.desktop_count);
        const used = verifiedCount(row.desktop_used);
        return {
          id: `${poolPrefix}${firstString([row.id], "")}`,
          name: firstString([row.name], ""),
          values: { ...(count === undefined ? {} : { desktops: count }), ...(used === undefined ? {} : { used }), type: firstString([row.type], ""), chargingMode: firstString([row.charging_mode], "") },
        };
      }),
    ];
  },
  options: async (session, operation): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-desktop" || operation === "create-pool") {
      const [users, products, images, zones, subnets] = await Promise.all([userRows(session), productRows(session), imageRows(session), zoneRows(session), subnetRows(session)]);
      const activeUsers = users.filter((row) => userStatus(row) === "ACTIVE");
      const usableProducts = products.filter((row) => { try { productDisk(row); return true; } catch { return false; } });
      const productChoices = usableProducts.map((row) => ({ value: firstString([row.product_id], ""), label: `${firstString([row.product_id], "")} · ${firstString([row.cpu], "-")} vCPU · ${memoryLabel(row.memory)} memory · ${firstString([row.system_disk_size], "-")} GB ${firstString([row.system_disk_type], "-")} system disk` }));
      const imageChoices = images.filter((row) => ["gold", "private"].includes(String(row.image_type)) && groupsForOs(firstString([row.os_type], "")).length > 0).map((row) => ({ value: firstString([row.id], ""), label: `${firstString([row.name], firstString([row.id], "-"))} · ${firstString([row.os_type], "-")} ${firstString([row.os_version], "")} · ${String(row.image_type)}` }));
      const zoneChoices = zones.map((row) => ({ value: firstString([row.availability_zone], ""), label: `${firstString([row.availability_zone], "")}${row.default_availability_zone === true ? " · default" : ""}` }));
      const subnetChoices = subnets.filter((row) => firstString([row.neutron_subnet_id], "") !== "" && firstString([row.vpc_id], "") !== "").map((row) => ({ value: firstString([row.id], ""), label: `${firstString([row.name], "-")} · ${firstString([row.cidr], "-")}${firstString([row.availability_zone], "") ? ` · ${firstString([row.availability_zone], "")}` : ""}` }));
      if (operation === "create-desktop") return {
        users: activeUsers.map((row) => ({ value: firstString([row.user_name], ""), label: firstString([row.user_name], "") })),
        products: productChoices,
        images: imageChoices,
        zones: zoneChoices,
        subnets: subnetChoices,
      };
      return {
        poolUsers: activeUsers.map((row) => ({ value: firstString([row.id], ""), label: firstString([row.user_name], "") })),
        products: productChoices,
        images: imageChoices,
        zones: zoneChoices,
        subnets: subnetChoices,
      };
    }
    return {};
  },
  poll: async (session, entry) => {
    if (!entry.jobId) throw new ManagementInputError("The history entry has no Workspace job reference.");
    if (deleteLabels.has(entry.operation)) {
      const prefix = entry.operation === "Delete desktop" ? desktopPrefix : entry.operation === "Delete user" ? userPrefix : poolPrefix;
      if (!entry.resourceId || entry.resourceId !== prefix + entry.jobId) throw new ManagementInputError("The deletion record is inconsistent. Check the resource state before retrying.");
      const gone = prefix === desktopPrefix ? await desktopGone(session, entry.jobId) : prefix === userPrefix ? await userGone(session, entry.jobId) : await poolGone(session, entry.jobId);
      return gone ? { state: "succeeded", message: "Huawei reports the original resource gone. Deletion completed; review final charges in Billing." } : { state: "submitted", message: "Deletion is still in progress; the original resource is still present." };
    }
    const allowed = new Set(["Create desktop", "Create desktop pool", "Start desktop", "Stop desktop", "Reboot desktop", "Hibernate desktop"]);
    if (!allowed.has(entry.operation) || (entry.resourceId !== undefined && (!entry.resourceId.startsWith(desktopPrefix) || entry.resourceId.length === desktopPrefix.length))) throw new ManagementInputError("Unsupported or inconsistent Workspace job history.");
    const body = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/workspace-jobs/${encodeURIComponent(entry.jobId)}`);
    if (body.id !== entry.jobId) throw new Error("Huawei returned a different Workspace job or no verifiable job identity.");
    const subJobs = strictRows(body.sub_jobs, "Workspace subtask", ["id"]);
    if (verifiedCount(body.sub_jobs_total) !== subJobs.length) throw new Error("Huawei returned an incomplete Workspace subtask list.");
    let createdDesktopId = "";
    for (const sub of subJobs) {
      assertProject(sub, session);
      if (sub.job_id !== undefined && sub.job_id !== entry.jobId) throw new Error("Huawei returned a subtask for another Workspace job.");
      const desktopId = firstString([asRecord(sub.entities).desktop_id], "");
      if (desktopId && !createdDesktopId) createdDesktopId = desktopId;
      if (entry.resourceId && desktopId !== entry.resourceId.slice(desktopPrefix.length)) throw new Error("Huawei returned a Workspace job for a different desktop.");
    }
    if (body.status === "FAIL" || body.status === "FAILED" || subJobs.some(sub => sub.status === "FAIL" || sub.status === "FAILED")) return { state: "failed", message: "The Workspace cloud job failed. Private failure details are not surfaced; review native state before retrying." };
    if ((body.status === "SUCCESS" || body.status === "COMPLETE") && subJobs.length > 0 && subJobs.every(sub => sub.status === "SUCCESS") && (entry.operation !== "Create desktop" || !!createdDesktopId)) return { state: "succeeded", message: "The Workspace cloud job completed successfully.", ...(createdDesktopId && entry.operation === "Create desktop" ? { resourceId: desktopPrefix + createdDesktopId } : {}) };
    return { state: "submitted", message: "The Workspace cloud job is still processing or its completion state could not be verified." };
  },
  invalidationKeys: () => [cloudCacheKeys.listWorkspaceTenants, cloudCacheKeys.listWorkspaceResources, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    if (operation === "create-desktop") {
      const name = String(values.name);
      const tenant = await workspaceTenant(session);
      assertWorkspaceReady(tenant);
      await assertAgencyReady(session);
      const [desktops, users, zones] = await Promise.all([desktopRows(session), userRows(session), zoneRows(session)]);
      if (desktops.some((row) => firstString([row.computer_name, row.os_host_name], "") === name)) throw new ManagementInputError("A desktop with this computer name already exists in the workspace.", 409);
      const { image, imageType, osType, architecture, groups } = await imageChoice(session, String(values.image));
      if (!groups.includes(String(values.userGroup))) throw new ManagementInputError(`The ${values.userGroup} group does not match the selected ${osType} image.`);
      const user = users.find((row) => firstString([row.user_name], "") === values.user);
      if (!user) throw new ManagementInputError("The selected user is no longer available in this workspace.");
      if (userStatus(user) !== "ACTIVE") throw new ManagementInputError("The selected user is locked, disabled, or unverified and cannot receive a desktop.");
      if (!zones.some((row) => firstString([row.availability_zone], "") === values.zone)) throw new ManagementInputError("The selected availability zone is no longer available.");
      const { networkId } = await networkChoice(session, String(values.subnet), tenant);
      const products = await productRows(session, { osType, architecture, zone: String(values.zone) });
      const product = chosenProduct(products, String(values.product), imageType, architecture, osType, String(values.zone));
      const disk = productDisk(product);
      for (const [minimum, available] of [[image.min_disk, disk.size], [image.min_ram, Number(product.memory)]]) {
        if (minimum !== undefined && (typeof minimum !== "number" || !Number.isSafeInteger(minimum) || minimum < 0 || !Number.isFinite(Number(available)) || Number(available) < minimum)) throw new ManagementInputError("The selected product does not meet the image's disk or memory requirements.");
      }
      const response = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/desktops`, { method: "POST", body: JSON.stringify({
        desktop_type: "DEDICATED",
        availability_zone: values.zone,
        product_id: values.product,
        image_type: imageType,
        image_id: values.image,
        root_volume: disk,
        nics: [{ subnet_id: networkId }],
        desktops: [{ user_name: values.user, user_group: values.userGroup, computer_name: name }],
        email_notification: false,
      }) });
      const jobId = firstString([response.job_id], "");
      if (!jobId) throw new Error("Huawei returned no job ID for the desktop creation.");
      return { message: "Desktop creation submitted. The selected pay-per-use product, image licensing, and storage can incur charges.", jobId, asynchronous: true };
    }
    if (operation === "create-user") {
      const users = await userRows(session);
      if (users.some((row) => firstString([row.user_name], "") === values.name)) throw new ManagementInputError("A workspace user with this name already exists.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/users`, { method: "POST", body: JSON.stringify({
        user_name: values.name,
        user_email: values.email,
        active_type: "USER_ACTIVATE",
        ...(values.description ? { description: String(values.description) } : {}),
      }) });
      const id = firstString([response.id], "");
      if (!id) throw new Error("Huawei returned no ID for the created workspace user.");
      let verified = false;
      try { verified = firstString([(await userRecord(session, id)).user_name], "") === values.name; } catch { verified = false; }
      return { message: verified ? "Workspace user created and verified. The user sets their own password from the activation email; this flow never sets or stores passwords." : "Huawei accepted the workspace user creation, but a fresh read could not verify the account yet. Reload the user list to confirm.", resourceId: `${userPrefix}${id}` };
    }
    if (operation === "create-pool") {
      const name = String(values.name);
      const size = Number(values.size);
      if (!Number.isSafeInteger(size) || size < 1 || size > 100) throw new ManagementInputError("The pool size must be between 1 and 100 desktops.");
      const poolType = String(values.type);
      if (!["DYNAMIC", "STATIC"].includes(poolType)) throw new ManagementInputError("Select a valid desktop pool type.");
      const authorized = values.users as string[];
      if (!Array.isArray(authorized) || !authorized.length) throw new ManagementInputError("Select at least one authorized workspace user.");
      if (new Set(authorized).size !== authorized.length) throw new ManagementInputError("The authorized user list must not contain duplicates.");
      if (authorized.length > 100) throw new ManagementInputError("A desktop pool can authorize at most 100 users.");
      const tenant = await workspaceTenant(session);
      assertWorkspaceReady(tenant);
      await assertAgencyReady(session);
      const [pools, users, zones] = await Promise.all([poolRows(session), userRows(session), zoneRows(session)]);
      if (pools.some((row) => firstString([row.name], "") === name)) throw new ManagementInputError("A desktop pool with this name already exists in the workspace.", 409);
      const { image, imageType, osType, architecture, groups } = await imageChoice(session, String(values.image));
      if (!groups.includes(String(values.userGroup))) throw new ManagementInputError(`The ${values.userGroup} group does not match the selected ${osType} image.`);
      if (!zones.some((row) => firstString([row.availability_zone], "") === values.zone)) throw new ManagementInputError("The selected availability zone is no longer available.");
      const { networkId, vpcId } = await networkChoice(session, String(values.subnet), tenant);
      const products = await productRows(session, { osType, architecture, zone: String(values.zone) });
      const product = chosenProduct(products, String(values.product), imageType, architecture, osType, String(values.zone));
      const disk = productDisk(product);
      for (const [minimum, available] of [[image.min_disk, disk.size], [image.min_ram, Number(product.memory)]]) {
        if (minimum !== undefined && (typeof minimum !== "number" || !Number.isSafeInteger(minimum) || minimum < 0 || !Number.isFinite(Number(available)) || Number(available) < minimum)) throw new ManagementInputError("The selected product does not meet the image's disk or memory requirements.");
      }
      const objects = authorized.map((id) => {
        const user = users.find((row) => firstString([row.id], "") === id);
        if (!user) throw new ManagementInputError("A selected user is no longer available in this workspace.");
        if (userStatus(user) !== "ACTIVE") throw new ManagementInputError("A selected user is locked, disabled, or unverified and cannot be authorized for a pool.");
        return { object_type: "USER", object_id: id, object_name: firstString([user.user_name], ""), user_group: values.userGroup };
      });
      const response = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/desktop-pools`, { method: "POST", body: JSON.stringify({
        name,
        type: poolType,
        size,
        ...(values.description ? { description: String(values.description) } : {}),
        availability_zone: values.zone,
        product_id: values.product,
        image_type: imageType,
        image_id: values.image,
        root_volume: disk,
        vpc_id: vpcId,
        subnet_ids: [networkId],
        authorized_objects: objects,
      }) });
      const jobId = firstString([response.job_id], "");
      if (!jobId) throw new Error("Huawei returned no job ID for the desktop pool creation.");
      return { message: `Desktop pool creation submitted for ${size} pay-per-use desktop${size === 1 ? "" : "s"}; product, image licensing, and storage charges can apply.`, jobId, asynchronous: true };
    }
    if (operation === "inspect-desktop") {
      const record = await desktopRecord(session, selected(resource, desktopPrefix, "desktop"));
      const product = asRecord(record.product);
      const rootVolume = asRecord(record.root_volume);
      const task = typeof record.task_status === "string" ? record.task_status : "";
      return { message: "Current desktop configuration.", resourceId: resource!.id, facts: [
        { label: "Computer name", value: firstString([record.computer_name, record.os_host_name], "-") },
        { label: "Status", value: `${desktopStatus(record.status)}${task ? " · cloud task in progress" : ""}` },
        { label: "Desktop type", value: firstString([record.desktop_type], "-") },
        { label: "Assigned user", value: firstString([record.user_name], "-") },
        { label: "User group", value: firstString([record.user_group], "-") },
        { label: "Availability zone", value: firstString([record.availability_zone], "-") },
        { label: "Operating system", value: firstString([record.os_version], "-") },
        { label: "Product", value: `${firstString([record.product_id, product.product_id], "-")}${firstString([product.cpu], "") ? ` · ${firstString([product.cpu], "")} vCPU · ${memoryLabel(product.memory)} memory` : ""}` },
        { label: "System disk", value: `${firstString([rootVolume.type], "-")} · ${Number(rootVolume.size) || 0} GB` },
        { label: "Data disks", value: String(asArray(record.data_volumes).length) },
        { label: "Created", value: firstString([record.created], "-") },
        { label: "Enterprise project", value: firstString([record.enterprise_project_id], "-") },
      ] };
    }
    if (operation === "rename-desktop") {
      const id = selected(resource, desktopPrefix, "desktop");
      const name = String(values.name);
      const [record, desktops] = await Promise.all([desktopRecord(session, id), desktopRows(session)]);
      assertIdle(record, "desktop");
      if (desktops.some((row) => firstString([row.desktop_id], "") !== id && firstString([row.computer_name, row.os_host_name], "") === name)) throw new ManagementInputError("A desktop with this computer name already exists in the workspace.", 409);
      await huaweiFetch(session, "workspace", `${base(session)}/desktops/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ desktop: { computer_name: name } }) });
      const verified = (await fresh(() => desktopRecord(session, id)))?.computer_name === name;
      return { message: verified ? "Desktop renamed and verified with a fresh read." : "Huawei accepted the rename, but a fresh read could not verify the new name yet. Reload the inventory to confirm.", resourceId: resource!.id };
    }
    if (operation === "self-backup") {
      const id = selected(resource, desktopPrefix, "desktop");
      const record = await desktopRecord(session, id);
      assertIdle(record, "desktop");
      const enable = values.enable === true;
      await huaweiFetch(session, "workspace", `${base(session)}/desktops/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ desktop: { self_backup_management: enable ? "1" : "0" } }) });
      const current = await fresh(() => desktopRecord(session, id));
      const verified = current?.self_backup_management === (enable ? "1" : "0");
      return { message: verified ? (enable ? "User snapshot management enabled and verified. Snapshots the user creates are billed." : "User snapshot management disabled and verified.") : `Huawei accepted the snapshot setting change, but a fresh read could not verify it yet. Reload the desktop to confirm.`, resourceId: resource!.id };
    }
    if (operation === "start" || operation === "stop" || operation === "reboot" || operation === "hibernate") {
      const id = selected(resource, desktopPrefix, "desktop");
      const record = await desktopRecord(session, id);
      assertIdle(record, "desktop");
      const status = firstString([record.status], "");
      if (!status) throw new ManagementInputError("The desktop's current power state could not be verified. Reload the desktop and retry.", 409);
      if (operation === "start" && status !== "SHUTOFF") throw new ManagementInputError("Start requires a shut-down desktop.", 409);
      if (operation !== "start" && status !== "ACTIVE") throw new ManagementInputError("This power operation runs only on a running desktop.", 409);
      const opType = operation === "start" ? "os-start" : operation === "stop" ? "os-stop" : operation === "reboot" ? "reboot" : "os-hibernate";
      const response = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/desktops/action`, { method: "POST", body: JSON.stringify({ desktop_ids: [id], op_type: opType, type: "SOFT" }) });
      if (!Array.isArray(response.failed_operation_list) || response.failed_operation_list.length) throw new Error("Huawei returned an unsuccessful or unverifiable desktop operation result. Check native state before retrying.");
      const jobId = firstString([response.job_id], "");
      if (!jobId) throw new Error("Huawei returned no job ID for the desktop operation.");
      return { message: `Desktop ${operation} submitted.`, resourceId: resource!.id, jobId, asynchronous: true };
    }
    if (operation === "delete-desktop") {
      const id = selected(resource, desktopPrefix, "desktop");
      const record = await desktopRecord(session, id);
      assertIdle(record, "desktop");
      const freshName = firstString([record.computer_name, record.os_host_name], "");
      if (!freshName) throw new ManagementInputError("The desktop could not be identified for deletion. Reload and retry.", 409);
      if (freshName !== resource!.name) throw new ManagementInputError(`The desktop is now named "${freshName}", not the confirmed name. Reload the inventory and retry.`, 409);
      if (!["ACTIVE", "SHUTOFF"].includes(String(record.status)) || record.desktop_type !== "DEDICATED") throw new ManagementInputError("Delete requires a stable dedicated desktop. Reload and verify its current state.", 409);
      if (asRecord(record.metadata).charging_mode !== payPerUse) throw new ManagementInputError("Only verified pay-per-use desktops can be deleted here. Subscription cancellation requires an order workflow.", 409);
      const query = new URLSearchParams({ delete_users: "false", email_notification: "false" });
      await huaweiFetch(session, "workspace", `${base(session)}/desktops/${encodeURIComponent(id)}?${query}`, { method: "DELETE" });
      return { message: "Desktop deletion accepted. This flow keeps watching the original desktop until Huawei reports it gone. The workspace user account was kept; review final charges in Billing.", resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    if (operation === "inspect-user") {
      const record = await userRecord(session, selected(resource, userPrefix, "user"));
      const owned = verifiedCount(record.total_desktops);
      return { message: "Current workspace user settings.", resourceId: resource!.id, facts: [
        { label: "User name", value: firstString([record.user_name], "-") },
        { label: "Email", value: firstString([record.user_email], "-") },
        { label: "Activation type", value: firstString([record.active_type], "-") },
        { label: "Locked", value: record.locked === true ? "Yes" : record.locked === false ? "No" : "Unknown" },
        { label: "Disabled", value: record.disabled === true ? "Yes" : record.disabled === false ? "No" : "Unknown" },
        { label: "Desktops owned", value: owned === undefined ? "Unknown" : String(owned) },
        { label: "Description", value: firstString([record.description], "-") },
        { label: "Account expires", value: record.account_expires === "0" ? "Never" : firstString([record.account_expires], "Unknown") },
        { label: "Password never expires", value: record.password_never_expired === true ? "Yes" : record.password_never_expired === false ? "No" : "Unknown" },
        { label: "User can change password", value: record.enable_change_password === true ? "Yes" : record.enable_change_password === false ? "No" : "Unknown" },
        { label: "Must reset password at next login", value: record.next_login_change_password === true ? "Yes" : record.next_login_change_password === false ? "No" : "Unknown" },
        { label: "Enterprise project", value: firstString([record.enterprise_project_id], "-") },
      ] };
    }
    if (operation === "update-user") {
      const id = selected(resource, userPrefix, "user");
      await userRecord(session, id);
      const body: Record<string, unknown> = {};
      if (values.email !== undefined) body.user_email = values.email;
      if (values.description !== undefined) body.description = String(values.description);
      if (!Object.keys(body).length) throw new ManagementInputError("Enter a new email or description.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "workspace", `${base(session)}/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
      const returned = firstString([response.id], "");
      if (returned && returned !== id) throw new Error("Huawei returned a different workspace user ID.");
      const current = await fresh(() => userRecord(session, id));
      const verified = !!current && (values.email === undefined || current.user_email === values.email) && (values.description === undefined || current.description === values.description);
      return { message: verified ? "User settings updated and verified with a fresh read. All other settings were preserved." : "Huawei accepted the update, but a fresh read could not verify every change yet. Reload the user to confirm.", resourceId: resource!.id };
    }
    if (operation === "lock-user" || operation === "unlock-user") {
      const id = selected(resource, userPrefix, "user");
      const record = await userRecord(session, id);
      if (typeof record.locked !== "boolean") throw new ManagementInputError("The user's lock state could not be verified. Reload the user and retry.", 409);
      if (operation === "lock-user" && record.locked) throw new ManagementInputError("The user is already locked.", 409);
      if (operation === "unlock-user" && !record.locked) throw new ManagementInputError("The user is not locked.", 409);
      await huaweiFetch(session, "workspace", `${base(session)}/users/${encodeURIComponent(id)}/actions`, { method: "POST", body: JSON.stringify({ op_type: operation === "lock-user" ? "LOCK" : "UNLOCK" }) });
      const expected = operation === "lock-user";
      const verified = (await fresh(() => userRecord(session, id)))?.locked === expected;
      return { message: verified ? (expected ? "User locked and verified. The user cannot sign in until unlocked." : "User unlocked and verified. Other account and desktop access restrictions still apply.") : `Huawei accepted the ${expected ? "lock" : "unlock"} request, but a fresh read could not verify the new state yet. Reload the user to confirm.`, resourceId: resource!.id };
    }
    if (operation === "delete-user") {
      const id = selected(resource, userPrefix, "user");
      const record = await userRecord(session, id);
      const freshName = firstString([record.user_name], "");
      if (!freshName) throw new ManagementInputError("The user could not be identified for deletion. Reload and retry.", 409);
      if (freshName !== resource!.name) throw new ManagementInputError(`The user is now named "${freshName}", not the confirmed name. Reload the inventory and retry.`, 409);
      const owned = verifiedCount(record.total_desktops);
      if (owned === undefined) throw new ManagementInputError("The user's desktop ownership could not be verified. Reload the user and retry.", 409);
      if (owned > 0) throw new ManagementInputError(`The user still owns ${owned} desktop${owned === 1 ? "" : "s"}. Delete or reassign them before deleting the user.`, 409);
      const desktops = await desktopRows(session);
      const assigned = desktops.filter((row) => firstString([row.user_name], "") === freshName);
      if (assigned.length) throw new ManagementInputError(`The live inventory still lists ${assigned.length} desktop${assigned.length === 1 ? "" : "s"} assigned to this user. Delete or reassign them first.`, 409);
      for (const pool of await poolRows(session)) {
        const objects = await poolUsers(session, String(pool.id));
        if (objects.some(row => row.object_type === "USER_GROUP" || (row.object_type === "USER" && (row.object_id === id || row.object_name === freshName)))) throw new ManagementInputError("The user may still have access through a pool authorization. Remove direct access and verify group membership before deleting this user.", 409);
      }
      await huaweiFetch(session, "workspace", `${base(session)}/users/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { message: "Workspace user deletion accepted. This flow keeps watching the original account until Huawei reports it gone.", resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    if (operation === "inspect-pool") {
      const record = await poolRecord(session, selected(resource, poolPrefix, "desktop pool"));
      const product = asRecord(record.product);
      const rootVolume = asRecord(record.root_volume);
      const count = verifiedCount(record.desktop_count);
      const used = verifiedCount(record.desktop_used);
      const chargingMode = firstString([record.charging_mode], "-");
      return { message: "Current desktop pool configuration.", resourceId: resource!.id, facts: [
        { label: "Pool name", value: firstString([record.name], "-") },
        { label: "Type", value: firstString([record.type], "-") },
        { label: "Description", value: firstString([record.description], "-") },
        { label: "Charging mode", value: chargingMode === "0" ? "Subscription (periodic)" : chargingMode === "1" ? "Pay-per-use" : "Unknown" },
        { label: "Desktops in pool", value: count === undefined ? "Unknown" : String(count) },
        { label: "Desktops in use", value: used === undefined ? "Unknown" : String(used) },
        { label: "Availability zone", value: firstString([record.availability_zone], "-") },
        { label: "Product", value: `${firstString([record.product_id, product.product_id], "-")}${firstString([product.cpu], "") ? ` · ${firstString([product.cpu], "")} vCPU · ${memoryLabel(product.memory)} memory` : ""}` },
        { label: "Image", value: `${firstString([record.image_name], "-")} · ${firstString([record.image_os_type], "-")} ${firstString([record.image_os_version], "")}` },
        { label: "System disk", value: `${firstString([rootVolume.type], "-")} · ${Number(rootVolume.size) || 0} GB` },
        { label: "Created", value: firstString([record.created_time], "-") },
      ] };
    }
    if (operation === "delete-pool") {
      const id = selected(resource, poolPrefix, "desktop pool");
      const record = await poolRecord(session, id);
      const freshName = firstString([record.name], "");
      if (!freshName) throw new ManagementInputError("The pool could not be identified for deletion. Reload and retry.", 409);
      if (freshName !== resource!.name) throw new ManagementInputError(`The pool is now named "${freshName}", not the confirmed name. Reload the inventory and retry.`, 409);
      if (record.status !== "STEADY" || (record.task_status !== undefined && record.task_status !== "")) throw new ManagementInputError("Delete requires a steady desktop pool with no cloud task in progress.", 409);
      if (record.charging_mode !== payPerUse) throw new ManagementInputError("Only verified pay-per-use pools can be deleted here. Subscription cancellation requires an order workflow.", 409);
      const count = verifiedCount(record.desktop_count);
      if (count === undefined) throw new ManagementInputError("The pool's desktop count could not be verified. Reload the pool and retry.", 409);
      if (count > 0) throw new ManagementInputError(`The pool still contains ${count} desktop${count === 1 ? "" : "s"}. The native API would destroy them with the pool; delete them first.`, 409);
      const desktops = await desktopRows(session);
      if (desktops.some((row) => firstString([row.pool_id], "") === id)) throw new ManagementInputError("The live inventory still lists desktops in this pool. Delete them first.", 409);
      await huaweiFetch(session, "workspace", `${base(session)}/desktop-pools/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { message: "Desktop pool deletion accepted. This flow keeps watching the original pool until Huawei reports it gone.", resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported Workspace operation.");
  },
};
