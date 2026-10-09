import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiFetch as nativeFetch, huaweiList as nativeList, HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

// Preserve HTTP status for uncertain writes without copying private native errors into history.
async function safeResponse<T>(request: Promise<T>) {
  try { return await request; }
  catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected this CPH request (HTTP ${error.status}). Check current state in the native console.`, error.status);
    throw error;
  }
}
async function huaweiFetch<T>(...args: Parameters<typeof nativeFetch>) { return safeResponse(nativeFetch<T>(...args)); }
async function huaweiList<T>(...args: Parameters<typeof nativeList>) { return safeResponse(nativeList<T>(...args)); }
function verifiedRows(body: Record<string, unknown>, collection: string, key: string) {
  if (!Array.isArray(body[collection])) throw new ManagementInputError("Huawei returned an incomplete CPH inventory.", 409);
  const rows = asArray(body[collection]).map(asRecord);
  const ids = rows.map(row => asString(row[key], ""));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ManagementInputError("Huawei returned an unverified CPH inventory.", 409);
  return rows;
}
function requireAck(body: Record<string, unknown>) {
  if (body.error_code || body.error_msg) throw new ManagementInputError("Huawei rejected this CPH operation. Check current resource state before retrying.", 409);
  if (!asString(body.request_id, "")) throw new Error("Huawei returned no verifiable CPH acknowledgement; check native state before retrying.");
  return body;
}
async function requireStableChildren(s: BetterUiSession, id: string) {
  const children = (await phoneRows(s)).filter(phone => asString(phone.server_id, "") === id);
  for (const phone of children) requireStatus(statusOf(phoneStatuses, phone.status), ["RUNNING", "STOPPED"], "child phone");
}

const base = (s: BetterUiSession) => `/v1/${s.projectId}`;
const serverPrefixes = ["server:"];
const phonePrefixes = ["phone:"];
const serverStatuses: Record<string, string> = { "0": "CREATING", "1": "CREATING", "2": "ABNORMAL", "3": "CREATING", "4": "CREATING", "5": "NORMAL", "8": "FROZEN", "10": "STOPPED", "11": "STOPPING", "12": "STOP_FAILED", "13": "STARTING" };
const phoneStatuses: Record<string, string> = { "1": "CREATING", "2": "RUNNING", "3": "RESETTING", "4": "REBOOTING", "6": "FROZEN", "7": "STOPPING", "8": "STOPPED", "-5": "RESET_FAILED", "-6": "REBOOT_FAILED", "-7": "ABNORMAL", "-8": "CREATE_FAILED", "-9": "STOP_FAILED" };
const namePattern = "^[\\u4e00-\\u9fa5A-Za-z0-9_-]{1,60}$";
const serverName: ManagementField = { key: "name", label: "Server name", required: true, min: 1, max: 60, pattern: "^[A-Za-z0-9_-]{1,60}$", help: "1-60 letters, digits, underscores, or hyphens. Batch orders append a numeric suffix per server." };
const phoneName: ManagementField = { key: "name", label: "Phone name", required: true, min: 1, max: 60, pattern: namePattern };
const volumeTypes: ManagementChoice[] = [{ value: "GPSSD", label: "GPSSD (general purpose SSD)" }, { value: "SSD", label: "SSD (ultra-high I/O)" }];
const subscriptionImpact = "Dedicated bandwidth is included even when no public EIP is requested. The unpaid subscription order starts recurring charges after you pay it in the Huawei Cloud console. Server, storage, EIP, and bandwidth bills continue until the subscription expires or is cancelled.";

function statusOf(table: Record<string, string>, code: unknown) {
  if (code === null || code === undefined || code === "") return "UNKNOWN";
  const numeric = Number(code);
  if (!Number.isFinite(numeric)) return "UNKNOWN";
  return table[String(numeric)] ?? "UNKNOWN";
}

async function serverRows(s: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(s, "cph", `${base(s)}/cloud-phone/servers?offset=0&limit=100`, { items: ["servers"], kind: "offset", parameter: "offset", size: 100, total: ["count"] });
  return verifiedRows(body, "servers", "server_id");
}

async function phoneRows(s: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(s, "cph", `${base(s)}/cloud-phone/phones?offset=0&limit=100`, { items: ["phones"], kind: "offset", parameter: "offset", size: 100, total: ["count"] });
  const rows = verifiedRows(body, "phones", "phone_id");
  if (rows.some(row => !asString(row.server_id, ""))) throw new ManagementInputError("Huawei returned a phone without a verified parent server.", 409);
  return rows;
}

async function phoneModelRows(s: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(s, "cph", `${base(s)}/cloud-phone/phone-models?offset=0&limit=100`, { items: ["phone_models"], kind: "offset", parameter: "offset", size: 100 });
  return asArray(body.phone_models).map(asRecord);
}

async function offeringRows(s: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(s, "cph", `${base(s)}/server-model-offerings?limit=100`, { items: ["models"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker"] });
  return asArray(body.models).map(asRecord);
}

async function imageRows(s: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(s, "cph", `${base(s)}/cloud-phone/phone-images?limit=100`, { items: ["phone_images"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker"] });
  return asArray(body.phone_images).map(asRecord);
}

async function keypairRows(s: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(s, "ecs", `/v2.1/${s.projectId}/os-keypairs?limit=100`, { items: ["keypairs"], kind: "marker", parameter: "marker", size: 100, fallbackKey: "keypair.name" });
  return asArray(body.keypairs).map((raw) => asRecord(asRecord(raw).keypair)).map((key) => ({ name: asString(key.name, "") })).filter((key) => key.name);
}

function selected(resource: ManagementResource | undefined, prefix: "server:" | "phone:") {
  if (!resource?.id.startsWith(prefix) || !resource.id.slice(prefix.length)) throw new ManagementInputError(prefix === "server:" ? "Select a current cloud phone server." : "Select a current cloud phone.");
  return resource.id.slice(prefix.length);
}

async function liveServer(s: BetterUiSession, resource: ManagementResource | undefined) {
  const id = selected(resource, "server:");
  const server = (await serverRows(s)).find((row) => asString(row.server_id, "") === id);
  if (!server) throw new ManagementInputError("The cloud phone server no longer exists in this project.", 404);
  return { id, server: await serverDetail(s, id) };
}

async function livePhone(s: BetterUiSession, resource: ManagementResource | undefined, mutation = true) {
  const id = selected(resource, "phone:");
  const [rows, servers] = await Promise.all([phoneRows(s), serverRows(s)]);
  const phone = rows.find((row) => asString(row.phone_id, "") === id);
  if (!phone) throw new ManagementInputError("The cloud phone no longer exists in this project.", 404);
  const parentId = asString(phone.server_id, "");
  if (!servers.some((row) => asString(row.server_id, "") === parentId)) throw new ManagementInputError("The cloud phone's parent server is no longer available in this project.", 409);
  const parent = await serverDetail(s, parentId);
  if (mutation) requireStatus(statusOf(serverStatuses, parent.status), ["NORMAL"], "parent server");
  const detail = await phoneDetail(s, id);
  if (asString(detail.server_id, "") !== parentId) throw new ManagementInputError("Huawei returned a cloud phone with a different parent server.", 409);
  return { id, phone: detail, parentId };
}

async function serverDetail(s: BetterUiSession, id: string) {
  const detail = await huaweiFetch<Record<string, unknown>>(s, "cph", `${base(s)}/cloud-phone/servers/${encodeURIComponent(id)}`);
  if (asString(detail.server_id, "") !== id) throw new ManagementInputError("Huawei returned an unverified cloud phone server.", 404);
  return detail;
}

async function phoneDetail(s: BetterUiSession, id: string) {
  const detail = await huaweiFetch<Record<string, unknown>>(s, "cph", `${base(s)}/cloud-phone/phones/${encodeURIComponent(id)}`);
  if (asString(detail.phone_id, "") !== id) throw new ManagementInputError("Huawei returned an unverified cloud phone.", 404);
  return detail;
}

function requireStatus(status: string, allowed: string[], what: string) {
  if (!allowed.includes(status)) throw new ManagementInputError(`This operation is unavailable while the ${what} status is ${status}.`, 409);
}

function nativeJob(body: Record<string, unknown>, key: "server_id" | "phone_id", id: string) {
  const jobs = asArray(body.jobs).map(asRecord);
  const job = jobs.length === 1 && asString(jobs[0][key], "") === id ? jobs[0] : undefined;
  if (!job) throw new Error("Huawei returned no verifiable CPH job for this resource.");
  if (job.error_code || job.error_msg) throw new ManagementInputError("Huawei rejected this CPH operation. Check current resource state before retrying.", 409);
  const jobId = asString(job.job_id, "");
  if (!jobId) throw new Error("Huawei returned no CPH job ID.");
  return jobId;
}

function publicImages(images: Record<string, unknown>[]) {
  return images.filter((image) => Number(image.is_public) === 1 && asString(image.image_id, "")).map((image) => ({ value: asString(image.image_id, ""), label: `${asString(image.image_name, "-")} · ${asString(image.os_name, "-")} · ${asString(image.image_label, "-")}` }));
}

const operations: ManagementOperation[] = [
  { id: "create-server", label: "Order cloud phone server", kind: "create", description: "Place an unpaid monthly or yearly subscription order for cloud phone servers from live on-sale server models, phone models, public images, network, and ADB key pair choices. Automatic payment and renewal are disabled.", fields: [
    serverName,
    { key: "offering", label: "Server model, phone model, and availability zone", type: "select", source: "offerings", required: true },
    { key: "image", label: "Public phone image", type: "select", source: "images", required: true },
    { key: "count", label: "Server count", type: "number", required: true, min: 1, max: 10, defaultValue: 1 },
    { key: "keypair", label: "ADB key pair", type: "select", source: "keypairs", required: true, help: "An existing ECS key pair used for ADB access to the phones." },
    { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true },
    { key: "publicIpCount", label: "Public EIP count", type: "number", required: true, min: 0, max: 1000, defaultValue: 1, help: "0 for a private server. Bounded by the selected phone model's capacity." },
    { key: "eipType", label: "EIP type", type: "select", required: true, defaultValue: "5_bgp", choices: [{ value: "5_bgp", label: "Dynamic BGP" }], help: "Used when new public EIPs are requested; availability depends on the region." },
    { key: "bandwidthSize", label: "Dedicated bandwidth (Mbit/s)", type: "number", required: true, min: 1, max: 2000, defaultValue: 10, help: "Dedicated bandwidth is included in the order, including private servers, as required by the CPH purchasing interface." },
    { key: "phoneVolumeType", label: "Phone data volume type", type: "select", required: true, choices: volumeTypes, defaultValue: "GPSSD" },
    { key: "phoneVolumeSize", label: "Phone data volume (GiB)", type: "number", required: true, min: 1, max: 32768, defaultValue: 10 },
    { key: "sharedStorage", label: "Add shared application storage", type: "boolean", defaultValue: false, help: "Only specification 2.0 supports this option. RX7 with AOSP 11 is excluded." },
    { key: "shareVolumeType", label: "Shared volume type", type: "select", required: true, choices: volumeTypes, defaultValue: "GPSSD" },
    { key: "shareVolumeSize", label: "Shared volume (GiB)", type: "number", required: true, min: 10, max: 32768, defaultValue: 10 },
    { key: "periodType", label: "Subscription period", type: "select", required: true, defaultValue: "2", choices: [{ value: "2", label: "Monthly" }, { value: "3", label: "Yearly" }] },
    { key: "periodNum", label: "Number of periods", type: "number", required: true, min: 1, max: 10, defaultValue: 1, help: "1-9 months or 1-10 years." },
  ], impact: subscriptionImpact },
  { id: "inspect-server", label: "Inspect server", kind: "inspect", resourcePrefixes: serverPrefixes, description: "Inspect non-secret server state, models, network, bandwidth, and volumes. Key pair material and ADB credentials are never displayed.", fields: [] },
  { id: "rename-server", label: "Rename server", kind: "update", resourcePrefixes: serverPrefixes, allowedStatuses: ["NORMAL", "STOPPED"], description: "Change the server name without restarting it.", fields: [serverName] },
  { id: "restart-server", label: "Restart server", kind: "action", resourcePrefixes: serverPrefixes, description: "Restart the server and every cloud phone on it.", fields: [], allowedStatuses: ["NORMAL"], confirmation: true, impact: "All cloud phones on the server are restarted. ADB and application connections are closed until the restart completes." },
  { id: "update-keypair", label: "Change ADB key pair", kind: "update", resourcePrefixes: serverPrefixes, allowedStatuses: ["NORMAL", "STOPPED"], description: "Switch the server's phones to a different existing ECS key pair for ADB access.", fields: [{ key: "keypair", label: "ADB key pair", type: "select", source: "keypairs", required: true }], confirmation: true, impact: "ADB access switches to the selected key pair and existing ADB sessions can be disconnected. No key material is displayed or uploaded." },
  { id: "resize-bandwidth", label: "Resize dedicated bandwidth", kind: "update", resourcePrefixes: serverPrefixes, description: "Change the size of the server's dedicated CPH bandwidth on the system-defined network.", fields: [{ key: "size", label: "New bandwidth (Mbit/s)", type: "number", required: true, min: 1, max: 2000 }], allowedStatuses: ["NORMAL", "STOPPED"], confirmation: true, impact: "The new bandwidth size is billed immediately. Shared bandwidths and custom-network servers are not supported here." },
  { id: "delete-server", label: "Delete pay-per-use server", kind: "delete", resourcePrefixes: serverPrefixes, description: "Permanently delete one pay-per-use server and its cloud phones. Subscription servers must be cancelled in the billing console instead.", fields: [], allowedStatuses: ["NORMAL", "STOPPED"], confirmation: true, impact: "The server and all of its cloud phones and phone data are permanently removed. Subscription (prepaid) servers cannot be deleted here; cancel their subscription in the Huawei Cloud billing console." },
  { id: "inspect-phone", label: "Inspect phone", kind: "inspect", resourcePrefixes: phonePrefixes, description: "Inspect non-secret phone state, image, addresses, and storage. ADB credentials and raw property payloads are never displayed.", fields: [] },
  { id: "rename-phone", label: "Rename phone", kind: "update", resourcePrefixes: phonePrefixes, allowedStatuses: ["RUNNING", "STOPPED"], description: "Change the phone name without restarting it.", fields: [phoneName] },
  { id: "restart-phone", label: "Restart phone", kind: "action", resourcePrefixes: phonePrefixes, description: "Restart one cloud phone.", fields: [], allowedStatuses: ["RUNNING", "STOPPED"], confirmation: true, impact: "ADB and application connections to this phone are closed until the restart completes." },
  { id: "stop-phone", label: "Stop phone", kind: "action", resourcePrefixes: phonePrefixes, description: "Power off one running cloud phone.", fields: [], allowedStatuses: ["RUNNING"], confirmation: true, impact: "The phone stops and is unreachable until it is restarted. Billing continues while the server exists." },
  { id: "reset-phone", label: "Reset phone", kind: "action", resourcePrefixes: phonePrefixes, description: "Erase the phone and reinstall it with a current public image.", fields: [
    { key: "image", label: "Public phone image", type: "select", source: "images", required: true },
    { key: "factoryReset", label: "Also clear historical property configuration", type: "boolean", defaultValue: false },
  ], allowedStatuses: ["RUNNING", "STOPPED"], confirmation: true, impact: "All data on the phone is permanently erased and the phone is reinstalled with the selected image. Existing ADB and application sessions are closed." },
  { id: "expand-phone-storage", label: "Expand phone data volume", kind: "action", resourcePrefixes: phonePrefixes, description: "Increase the phone's independent data volume capacity.", fields: [{ key: "size", label: "New data volume size (GiB)", type: "number", required: true, min: 1, max: 32768 }], allowedStatuses: ["RUNNING", "STOPPED"], impact: "The added capacity is billed while the phone exists and the volume cannot be shrunk afterwards." },
];

export const cphManagement: ManagementAdapter = {
  title: "Cloud Phone Host",
  operations,
  inventory: async (s) => {
    const [servers, phones] = await Promise.all([serverRows(s), phoneRows(s)]);
    const serverItems = servers.flatMap((server) => {
      const id = asString(server.server_id, "");
      if (!id) return [];
      const metadata = asRecord(server.metadata);
      return [{ id: `server:${id}`, name: asString(server.server_name, id), status: statusOf(serverStatuses, server.status), values: {
        name: asString(server.server_name, ""), model: asString(server.server_model_name, ""), phoneModel: asString(server.phone_model_name, ""),
        zone: asString(server.availability_zone, ""), keypair: asString(server.keypair_name, ""),
        chargingMode: typeof metadata.charging_mode === "number" ? metadata.charging_mode : -1,
        networkVersion: asString(server.network_version, ""),
      } }];
    });
    const phoneItems = phones.flatMap((phone) => {
      const id = asString(phone.phone_id, "");
      if (!id) return [];
      return [{ id: `phone:${id}`, name: asString(phone.phone_name, id), status: statusOf(phoneStatuses, phone.status), values: {
        name: asString(phone.phone_name, ""), serverId: asString(phone.server_id, ""), model: asString(phone.phone_model_name, ""), imageVersion: asString(phone.image_version, ""),
      } }];
    });
    return [...serverItems, ...phoneItems];
  },
  options: async (s, operation): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-server") {
      const [offerings, models, images, keys, vpcs, subnets] = await Promise.all([offeringRows(s), phoneModelRows(s), imageRows(s), keypairRows(s), listVpcsForProject(s), listSubnetsForProject(s)]);
      const offeringChoices: ManagementChoice[] = [];
      for (const offering of offerings) {
        const model = asString(offering.model_name, "");
        const zone = asString(offering.available_zone, "");
        if (!model || !zone || asString(offering.sell_status, "") !== "available") continue;
        for (const phoneModel of models.filter((row) => asString(row.server_model_name, "") === model && row.status === 1 && [0, 1].includes(row.phone_model_version as number) && Number.isSafeInteger(row.phone_capacity) && Number(row.phone_capacity) > 0 && asString(row.image_label, "") && asString(row.phone_model_name, ""))) {
          offeringChoices.push({ value: JSON.stringify([model, asString(phoneModel.phone_model_name, ""), zone]), label: `${model} · ${asString(phoneModel.phone_model_name, "")} · ${Number(phoneModel.phone_capacity) || 0} phones · ${zone}` });
        }
      }
      return {
        offerings: offeringChoices,
        images: publicImages(images),
        keypairs: keys.map((key) => ({ value: key.name, label: key.name })),
        vpcs: vpcs.map((vpc) => ({ value: vpc.id, label: `${vpc.name} · ${vpc.cidr}` })),
        subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · VPC ${subnet.vpcId}` })),
      };
    }
    if (operation === "update-keypair") return { keypairs: (await keypairRows(s)).map((key) => ({ value: key.name, label: key.name })) };
    if (operation === "reset-phone") return { images: publicImages(await imageRows(s)) };
    return {};
  },
  poll: async (s, entry) => {
    const jobId = entry.jobId;
    if (!jobId) return { state: "failed", message: "The history entry has no native CPH job ID." };
    const job = await huaweiFetch<Record<string, unknown>>(s, "cph", `${base(s)}/cloud-phone/jobs/${encodeURIComponent(jobId)}`);
    if (asString(job.job_id, "") !== jobId) throw new ManagementInputError("Huawei returned a different CPH job.", 409);
    const separator = entry.resourceId?.indexOf(":") ?? -1;
    const prefix = separator === -1 ? "" : entry.resourceId!.slice(0, separator);
    const id = separator === -1 ? "" : entry.resourceId!.slice(separator + 1);
    if (prefix === "phone" && id) {
      if (asString(job.phone_id, "") !== id) throw new ManagementInputError("The CPH job does not belong to this cloud phone.", 409);
    } else if (prefix === "server" && id) {
      if (asString(job.server_id, "") !== id) throw new ManagementInputError("The CPH job does not belong to this cloud phone server.", 409);
    } else throw new ManagementInputError("The CPH job has no verifiable parent resource.", 409);
    const status = Number(job.status);
    if (status === 2) return { state: "succeeded", message: "The CPH cloud job completed successfully." };
    if (status === -1) return { state: "failed", message: "The CPH cloud job failed. Review the resource state in the native console before retrying." };
    return { state: "submitted", message: `The CPH cloud job is ${status === 1 ? "running" : "still processing"}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listCphServers, cloudCacheKeys.summary],
  execute: async (s, operation, v: ManagementValues, resource) => {
    const root = base(s);
    const write = async (path: string, method: string, body?: unknown) => requireAck(await huaweiFetch<Record<string, unknown>>(s, "cph", path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    if (operation === "create-server") {
      let offering: unknown;
      try { offering = JSON.parse(String(v.offering)); } catch { throw new ManagementInputError("Select an available server model, phone model, and availability zone."); }
      const [model, phoneModelName, zone] = Array.isArray(offering) ? offering : [];
      if (typeof model !== "string" || !model || typeof phoneModelName !== "string" || !phoneModelName || typeof zone !== "string" || !zone) throw new ManagementInputError("Select an available server model, phone model, and availability zone.");
      const count = Number(v.count);
      if (!Number.isInteger(count) || count < 1 || count > 10) throw new ManagementInputError("The server count must be between 1 and 10.");
      const [offerings, models, images, keys, vpcs, subnets] = await Promise.all([offeringRows(s), phoneModelRows(s), imageRows(s), keypairRows(s), listVpcsForProject(s), listSubnetsForProject(s)]);
      if (!offerings.some((row) => asString(row.model_name, "") === model && asString(row.available_zone, "") === zone && asString(row.sell_status, "") === "available")) throw new ManagementInputError("The selected server model is no longer on sale in this availability zone.");
      const phoneModel = models.find((row) => asString(row.phone_model_name, "") === phoneModelName && asString(row.server_model_name, "") === model);
      if (!phoneModel || Number(phoneModel.status) !== 1) throw new ManagementInputError("The selected phone model is no longer available for this server model.");
      const image = images.find((row) => asString(row.image_id, "") === v.image);
      if (!image || Number(image.is_public) !== 1) throw new ManagementInputError("Select a current public phone image.");
      if (asString(image.image_label, "") === "" || asString(image.image_label, "") !== asString(phoneModel.image_label, "")) throw new ManagementInputError("The selected image does not match the phone model's image type.");
      if (!keys.some((key) => key.name === v.keypair)) throw new ManagementInputError("The selected key pair is no longer available in this project.");
      const vpc = vpcs.find((row) => row.id === v.vpc);
      if (!vpc) throw new ManagementInputError("The selected VPC is no longer available in this project.");
      const subnet = subnets.find((row) => row.id === v.subnet);
      if (!subnet) throw new ManagementInputError("The selected subnet is no longer available in this project.");
      if (subnet.vpcId !== vpc.id) throw new ManagementInputError("Select a subnet inside the selected VPC.");
      const capacity = Number(phoneModel.phone_capacity);
      if (!Number.isSafeInteger(capacity) || capacity < 1) throw new ManagementInputError("The selected phone model capacity could not be verified.", 409);
      if (![0, 1].includes(phoneModel.phone_model_version as number)) throw new ManagementInputError("The selected phone model storage specification could not be verified.", 409);
      if (v.sharedStorage === true && (phoneModel.phone_model_version !== 1 || (/rx7/i.test(model) && (!asString(image.os_name, "") || /(?:aosp|android).*\b11\b/i.test(asString(image.os_name, "")))))) throw new ManagementInputError("This server and image do not support shared application storage.", 409);
      if (v.eipType !== "5_bgp") throw new ManagementInputError("Select the supported dynamic BGP EIP type.");
      const publicIpCount = Number(v.publicIpCount);
      if (!Number.isInteger(publicIpCount) || publicIpCount < 0 || publicIpCount > capacity) throw new ManagementInputError(`The public EIP count must be between 0 and this phone model's capacity of ${capacity}.`);
      const bandwidthSize = Number(v.bandwidthSize);
      if (!Number.isInteger(bandwidthSize) || bandwidthSize < 1 || bandwidthSize > 2000) throw new ManagementInputError("The dedicated bandwidth must be between 1 and 2000 Mbit/s.");
      const phoneVolumeSize = Number(v.phoneVolumeSize);
      if (!Number.isInteger(phoneVolumeSize) || phoneVolumeSize < 1 || phoneVolumeSize > 32768) throw new ManagementInputError("The phone data volume must be between 1 and 32768 GiB.");
      const shareVolumeSize = Number(v.shareVolumeSize);
      if (!Number.isInteger(shareVolumeSize) || shareVolumeSize < 10 || shareVolumeSize > 32768) throw new ManagementInputError("The shared volume must be between 10 and 32768 GiB.");
      if (!["SSD", "GPSSD"].includes(String(v.phoneVolumeType)) || !["SSD", "GPSSD"].includes(String(v.shareVolumeType))) throw new ManagementInputError("Select the SSD or GPSSD volume type.");
      const periodType = Number(v.periodType);
      if (periodType !== 2 && periodType !== 3) throw new ManagementInputError("Select a monthly or yearly subscription period.");
      const periodNum = Number(v.periodNum);
      const periodMax = periodType === 2 ? 9 : 10;
      if (!Number.isInteger(periodNum) || periodNum < 1 || periodNum > periodMax) throw new ManagementInputError(`The number of ${periodType === 2 ? "months" : "years"} must be between 1 and ${periodMax}.`);
      const response = await write(`/v2/${s.projectId}/cloud-phone/servers`, "POST", {
        server_name: v.name,
        server_model_name: model,
        phone_model_name: phoneModelName,
        image_id: v.image,
        count,
        keypair_name: v.keypair,
        tenant_vpc_id: vpc.id,
        nics: [{ subnet_id: subnet.id }],
        public_ip: { count: publicIpCount, ...(publicIpCount > 0 ? { eip: { type: v.eipType } } : {}) },
        band_width: { band_width_size: bandwidthSize, band_width_charge_mode: 0, band_width_share_type: 0 },
        ...(phoneModel.phone_model_version === 1 ? { phone_data_volume: { volume_type: v.phoneVolumeType, size: phoneVolumeSize } } : {}),
        ...(v.sharedStorage === true ? { server_share_data_volume: { volume_type: v.shareVolumeType, size: shareVolumeSize } } : {}),
        availability_zone: zone,
        extend_param: { charging_mode: 0, period_type: periodType, period_num: periodNum, is_auto_pay: 0, is_auto_renew: 0 },
      });
      const orderId = asString(response.order_id, "");
      if (!orderId) throw new Error("Huawei returned no order ID for the server order.");
      return { message: `Unpaid subscription order ${orderId} created for ${count} server(s). Automatic payment and renewal are disabled; complete payment in the Huawei Cloud console. Servers are provisioned only after the order is paid.` };
    }
    if (operation === "inspect-server") {
      const { server } = await liveServer(s, resource);
      const detail = server;
      const metadata = asRecord(detail.metadata);
      const facts = [
        { label: "Status", value: statusOf(serverStatuses, detail.status ?? server.status) },
        { label: "Server model", value: asString(detail.server_model_name, "-") },
        { label: "Phone model", value: asString(detail.phone_model_name, "-") },
        { label: "Availability zone", value: asString(detail.availability_zone, "-") },
        { label: "ADB key pair", value: asString(detail.keypair_name, "None") },
        { label: "Network", value: detail.network_version === "v2" ? "Custom VPC" : detail.network_version === "v1" ? "System-defined" : "Unknown" },
        { label: "VPC", value: `${asString(detail.vpc_id, "-")} · ${asString(detail.vpc_cidr ?? detail.cidr, "-")}` },
        { label: "Subnet", value: `${asString(detail.subnet_id, "-")} · ${asString(detail.subnet_cidr, "-")}` },
        { label: "Billing mode", value: metadata.charging_mode === 1 ? "Pay-per-use" : metadata.charging_mode === 0 ? "Subscription" : "Unknown" },
        { label: "Created", value: asString(detail.create_time, "-") },
      ];
      for (const address of asArray(detail.addresses).map(asRecord)) facts.push({ label: "Address", value: `server ${asString(address.server_ip, "-")} · public ${asString(address.public_ip, "-")}` });
      for (const bandwidth of asArray(detail.band_widths).map(asRecord)) facts.push({ label: `Bandwidth · ${asString(bandwidth.band_width_name, asString(bandwidth.band_width_id, "-"))}`, value: `${Number(bandwidth.band_width_size) || 0} Mbit/s · ${Number(bandwidth.band_width_charge_mode) === 1 ? "traffic" : "bandwidth"} billing · ${Number(bandwidth.band_width_share_type) === 1 ? "shared" : "dedicated"}` });
      return { message: "Current cloud phone server configuration.", facts };
    }
    if (operation === "rename-server") {
      const { id, server } = await liveServer(s, resource);
      requireStatus(statusOf(serverStatuses, server.status), ["NORMAL", "STOPPED"], "server");
      await write(`${root}/cloud-phone/servers/${encodeURIComponent(id)}`, "PUT", { server_name: v.name });
      return { message: "Server renamed.", resourceId: resource!.id };
    }
    if (operation === "restart-server") {
      const { id, server } = await liveServer(s, resource);
      requireStatus(statusOf(serverStatuses, server.status), ["NORMAL"], "server");
      await requireStableChildren(s, id);
      const response = await write(`${root}/cloud-phone/servers/batch-restart`, "POST", { server_ids: [id] });
      return { message: "Server restart submitted. Every cloud phone on the server restarts and connections are closed.", resourceId: resource!.id, jobId: nativeJob(response, "server_id", id), asynchronous: true };
    }
    if (operation === "update-keypair") {
      const { id, server } = await liveServer(s, resource);
      requireStatus(statusOf(serverStatuses, server.status), ["NORMAL", "STOPPED"], "server");
      await requireStableChildren(s, id);
      if (!(await keypairRows(s)).some((key) => key.name === v.keypair)) throw new ManagementInputError("The selected key pair is no longer available in this project.", 404);
      const response = await write(`${root}/cloud-phone/servers/open-access`, "PUT", { servers: [{ server_id: id, keypair_name: v.keypair }] });
      return { message: "ADB key pair change submitted. Existing ADB sessions can be disconnected.", resourceId: resource!.id, jobId: nativeJob(response, "server_id", id), asynchronous: true };
    }
    if (operation === "resize-bandwidth") {
      const { server } = await liveServer(s, resource);
      requireStatus(statusOf(serverStatuses, server.status), ["NORMAL", "STOPPED"], "server");
      if (asString(server.network_version, "") !== "v1") throw new ManagementInputError("Only servers on the system-defined network support CPH bandwidth resizing here.", 409);
      const detail = server;
      const bandwidth = asArray(detail.band_widths).map(asRecord).find((row) => Number(row.band_width_share_type) === 0 && asString(row.band_width_id, ""));
      if (!bandwidth) throw new ManagementInputError("The server has no dedicated CPH bandwidth.", 409);
      const size = Number(v.size);
      if (!Number.isInteger(size) || size < 1 || size > 2000) throw new ManagementInputError("The new bandwidth must be between 1 and 2000 Mbit/s.");
      if (size === Number(bandwidth.band_width_size)) throw new ManagementInputError("The new bandwidth must differ from the current size.");
      await write(`${root}/cloud-phone/bandwidths/${encodeURIComponent(asString(bandwidth.band_width_id, ""))}`, "PUT", { band_width_size: size });
      return { message: `Dedicated bandwidth resized to ${size} Mbit/s. Billing reflects the new size.`, resourceId: resource!.id };
    }
    if (operation === "delete-server") {
      const { id, server } = await liveServer(s, resource);
      requireStatus(statusOf(serverStatuses, server.status), ["NORMAL", "STOPPED"], "server");
      const detail = server;
      const chargingMode = asRecord(detail.metadata).charging_mode;
      if (chargingMode !== 1) throw new ManagementInputError(chargingMode === 0 ? "Subscription servers cannot be deleted here. Cancel the subscription in the Huawei Cloud billing console instead." : "The server's billing mode could not be verified; deletion is blocked.", 409);
      await requireStableChildren(s, id);
      const response = await write(`/v2/${s.projectId}/cloud-phone/servers`, "DELETE", { server_ids: [id] });
      const jobId = asString(response.job_id, "");
      if (!jobId) throw new Error("Huawei returned no deletion job ID.");
      return { message: "Pay-per-use server deletion submitted. The server and its phones are removed permanently.", resourceId: resource!.id, jobId, asynchronous: true };
    }
    if (operation === "inspect-phone") {
      const { phone } = await livePhone(s, resource, false);
      const detail = phone;
      const facts = [
        { label: "Status", value: statusOf(phoneStatuses, detail.status ?? phone.status) },
        { label: "Phone model", value: asString(detail.phone_model_name, "-") },
        { label: "Image", value: `${asString(detail.image_version, "-")} · ${asString(detail.image_id, "-")}` },
        { label: "Parent server", value: asString(detail.server_id, "-") },
        { label: "IMEI", value: asString(detail.imei, "-") },
        { label: "Type", value: Number(detail.type) === 1 ? "Trial" : "Standard" },
        { label: "Traffic routing", value: asString(detail.traffic_type, "-") },
        { label: "Independent data volume", value: Number(detail.volume_mode) === 1 ? "Yes" : "No" },
        { label: "File-level encryption", value: detail.has_encrypt === true ? "Enabled" : "Disabled" },
        { label: "Availability zone", value: asString(detail.availability_zone, "-") },
        { label: "Created", value: asString(detail.create_time, "-") },
      ];
      for (const access of asArray(detail.access_infos).map(asRecord)) {
        const address = asString(access.public_ip, "") || asString(access.server_ip, "");
        const port = Number(access.access_port) || Number(access.listen_port);
        facts.push({ label: `Access · ${asString(access.type, "endpoint")}`, value: `${address || "-"}${port ? `:${port}` : ""}` });
      }
      const volume = asRecord(detail.phone_data_volume);
      if (volume.volume_type || volume.volume_size) facts.push({ label: "Data volume", value: `${asString(volume.volume_type, "-")} · ${Number(volume.volume_size) || 0} GiB` });
      return { message: "Current cloud phone configuration without credentials.", facts };
    }
    if (operation === "rename-phone") {
      const { id, phone } = await livePhone(s, resource);
      requireStatus(statusOf(phoneStatuses, phone.status), ["RUNNING", "STOPPED"], "phone");
      await write(`${root}/cloud-phone/phones/${encodeURIComponent(id)}`, "PUT", { phone_name: v.name });
      return { message: "Phone renamed.", resourceId: resource!.id };
    }
    if (operation === "restart-phone") {
      const { id, phone } = await livePhone(s, resource);
      requireStatus(statusOf(phoneStatuses, phone.status), ["RUNNING", "STOPPED"], "phone");
      const response = await write(`${root}/cloud-phone/phones/batch-restart`, "POST", { phones: [{ phone_id: id }] });
      return { message: "Phone restart submitted. Connections to this phone are closed until it restarts.", resourceId: resource!.id, jobId: nativeJob(response, "phone_id", id), asynchronous: true };
    }
    if (operation === "stop-phone") {
      const { id, phone } = await livePhone(s, resource);
      requireStatus(statusOf(phoneStatuses, phone.status), ["RUNNING"], "phone");
      const response = await write(`${root}/cloud-phone/phones/batch-stop`, "POST", { phone_ids: [id] });
      return { message: "Phone stop submitted. The phone is unreachable until restarted; billing continues.", resourceId: resource!.id, jobId: nativeJob(response, "phone_id", id), asynchronous: true };
    }
    if (operation === "reset-phone") {
      const { id, phone } = await livePhone(s, resource);
      requireStatus(statusOf(phoneStatuses, phone.status), ["RUNNING", "STOPPED"], "phone");
      const [images, models] = await Promise.all([imageRows(s), phoneModelRows(s)]);
      const image = images.find((row) => asString(row.image_id, "") === v.image);
      if (!image || Number(image.is_public) !== 1) throw new ManagementInputError("Select a current public phone image.", 404);
      const phoneModel = models.find((row) => asString(row.phone_model_name, "") === asString(phone.phone_model_name, ""));
      if (!phoneModel || phoneModel.status !== 1 || asString(image.image_label, "") === "" || asString(image.image_label, "") !== asString(phoneModel.image_label, "")) throw new ManagementInputError("The selected image does not match this phone's model image type.", 409);
      const response = await write(`${root}/cloud-phone/phones/batch-reset`, "POST", { image_id: v.image, phones: [{ phone_id: id, ...(v.factoryReset === true ? { factory_reset_enabled: true } : {}) }] });
      return { message: "Phone reset submitted. All phone data is erased and reinstalled from the selected image.", resourceId: resource!.id, jobId: nativeJob(response, "phone_id", id), asynchronous: true };
    }
    if (operation === "expand-phone-storage") {
      const { id, phone } = await livePhone(s, resource);
      requireStatus(statusOf(phoneStatuses, phone.status), ["RUNNING", "STOPPED"], "phone");
      const detail = phone;
      if (detail.volume_mode !== 1) throw new ManagementInputError("Only phones with a verified independent data volume can expand storage.", 409);
      const current = Number(asRecord(detail.phone_data_volume).volume_size);
      if (!Number.isInteger(current) || current < 1) throw new ManagementInputError("The phone's current data volume could not be verified.", 409);
      const size = Number(v.size);
      if (!Number.isInteger(size) || size < 1 || size > 32768) throw new ManagementInputError("The new data volume size must be between 1 and 32768 GiB.");
      if (size <= current) throw new ManagementInputError(`The new size must exceed the current ${current} GiB data volume.`);
      const response = await write(`${root}/cloud-phone/phones/expand-volume`, "POST", { phones: [{ phone_id: id, new_size: size }] });
      return { message: `Phone data volume expansion to ${size} GiB submitted. The added capacity is billed and cannot be shrunk.`, resourceId: resource!.id, jobId: nativeJob(response, "phone_id", id), asynchronous: true };
    }
    throw new ManagementInputError("Unsupported Cloud Phone operation.");
  },
};
