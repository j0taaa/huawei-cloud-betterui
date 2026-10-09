import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listIotdaDevices } from "@/lib/huawei/services/iotda";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

// Huawei IoTDA SDK v5: products are unique within an app, whereas device IDs are global.
// Always retain app_id for product requests; never fall back to a same-named product in another space.
const base = (s: BetterUiSession) => `/v5/iot/${s.projectId}`;
const namePattern = "^[\\p{L}\\p{N}_?'#().,&%@! -]+$";
const name: ManagementField = { key: "name", label: "Name", required: true, max: 64, pattern: namePattern };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", allowEmpty: true, max: 128 };
const deviceDescription: ManagementField = { ...description, max: 2048 };
const secret: ManagementField = { key: "secret", label: "Device secret", type: "password", required: true, min: 8, max: 32, pattern: "^[A-Za-z0-9_-]{8,32}$", help: "Save this secret securely for the device. BetterUI does not retain it." };
const modelField: ManagementField = { key: "model", label: "Service model (JSON array)", type: "textarea", required: true, max: 131072, maxBytes: 131072, defaultValue: "[]", help: "Service capabilities with service_id, service_type, properties, and commands. View an existing product model for its schema." };
const protocols = ["MQTT", "CoAP", "HTTP", "HTTPS", "Modbus", "ONVIF", "OPC-UA", "OPC-DA", "Other", "TCP", "UDP"];
const pick = (value: string, label = value): ManagementChoice => ({ value, label });
const productKey = (app: string, id: string) => `product:${app}:${id}`;
function productIdentity(resource: ManagementResource) {
  const app = asString(resource.values?.app, "");
  const id = asString(resource.values?.product, "");
  if (!app || !id || resource.id !== productKey(app, id)) throw new ManagementInputError("Select a current product and resource space.");
  return { app, id };
}
async function apps(s: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(s, "iotda", `${base(s)}/apps`);
  return asArray(body.applications).map(asRecord).filter(a => asString(a.app_id, ""));
}
async function products(s: BetterUiSession): Promise<Record<string, unknown>[]> {
  const spaces = await apps(s);
  const rows = await Promise.all(spaces.map(async a => {
    const app = asString(a.app_id);
    const body = await huaweiList<Record<string, unknown>>(s, "iotda", `${base(s)}/products?${new URLSearchParams({ app_id: app, limit: "50" })}`, { items: ["products"], kind: "marker", parameter: "marker", size: 50, next: ["page.marker"], total: ["page.count"] });
    return asArray(body.products).map(asRecord).filter(p => asString(p.product_id, "") && (!p.app_id || p.app_id === app)).map(p => ({ ...p, app_id: app, app_name: a.app_name }));
  }));
  return rows.flat();
}
async function productDetail(s: BetterUiSession, app: string, id: string) {
  const body = await huaweiFetch<Record<string, unknown>>(s, "iotda", `${base(s)}/products/${encodeURIComponent(id)}?${new URLSearchParams({ app_id: app })}`);
  if (body.product_id !== id || body.app_id !== app) throw new ManagementInputError("The product no longer belongs to this resource space.", 404);
  return body;
}
function devicePath(s: BetterUiSession, resource: ManagementResource) { return `${base(s)}/devices/${encodeURIComponent(resource.id.slice("device:".length))}`; }
async function deviceDetail(s: BetterUiSession, resource: ManagementResource) {
  const body = await huaweiFetch<Record<string, unknown>>(s, "iotda", devicePath(s, resource));
  if (`device:${body.device_id}` !== resource.id || !asString(body.app_id, "")) throw new ManagementInputError("The device could not be verified in this project.", 404);
  return body;
}
async function deviceModel(s: BetterUiSession, resource: ManagementResource) {
  const device = await deviceDetail(s, resource);
  return { device, product: await productDetail(s, asString(device.app_id), asString(device.product_id)) };
}
function services(product: Record<string, unknown>) { return asArray(product.service_capabilities).map(asRecord); }
function commands(product: Record<string, unknown>) {
  return services(product).flatMap(service => asArray(service.commands).map(asRecord).filter(command => command.command_name).map(command => ({ service: asString(service.service_id), command, value: JSON.stringify([service.service_id, command.command_name]) })));
}
function jsonObject(value: unknown, label: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { throw new ManagementInputError(`${label} must be valid JSON.`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ManagementInputError(`${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}
function validateModelValues(values: Record<string, unknown>, definitions: Record<string, unknown>[], key: "para_name" | "property_name", requireAll: boolean) {
  if (Object.keys(values).some(name => !definitions.some(p => p[key] === name))) throw new ManagementInputError("A parameter is absent from the current product model.");
  for (const p of definitions) {
    const label = String(p[key]); const value = values[label];
    if (value === undefined) { if (requireAll && p.required === true) throw new ManagementInputError(`${label} is required by the product model.`); continue; }
    const type = asString(p.data_type, "");
    const numeric = ["int", "long", "decimal"].includes(type);
    if (numeric && (typeof value !== "number" || !Number.isFinite(value) || (type !== "decimal" && !Number.isSafeInteger(value)))) throw new ManagementInputError(`${label} must be a ${type === "decimal" ? "number" : "whole number"}.`);
    if (numeric && ((p.min !== undefined && Number.isFinite(Number(p.min)) && Number(value) < Number(p.min)) || (p.max !== undefined && Number.isFinite(Number(p.max)) && Number(value) > Number(p.max)))) throw new ManagementInputError(`${label} is outside the product model's limits.`);
    if (["string", "DateTime", "enum"].includes(type) && typeof value !== "string") throw new ManagementInputError(`${label} must be text.`);
    if (typeof value === "string" && typeof p.max_length === "number" && value.length > p.max_length) throw new ManagementInputError(`${label} exceeds the product model's maximum length.`);
    if (type === "enum" && !asArray(p.enum_list).includes(value)) throw new ManagementInputError(`${label} is outside the product model's enumeration.`);
    if (type === "boolean" && typeof value !== "boolean") throw new ManagementInputError(`${label} must be true or false.`);
    if (type === "jsonObject" && (!value || typeof value !== "object" || Array.isArray(value))) throw new ManagementInputError(`${label} must be a JSON object.`);
    if (type === "string list" && (!Array.isArray(value) || value.some(v => typeof v !== "string"))) throw new ManagementInputError(`${label} must be a list of strings.`);
    if (!["int", "long", "decimal", "string", "DateTime", "enum", "boolean", "jsonObject", "string list"].includes(type)) throw new ManagementInputError(`${label} uses an unsupported product model type.`);
  }
}

function model(value: unknown): Record<string, unknown>[] {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { throw new ManagementInputError("The service model must be valid JSON."); }
  if (!Array.isArray(parsed) || parsed.length > 500) throw new ManagementInputError("The model must be an array of up to 500 services.");
  const unique = (rows: Record<string, unknown>[], key: string, max: number) => {
    if (rows.length > 500 || rows.some(row => typeof row[key] !== "string" || !String(row[key]).length || String(row[key]).length > max) || new Set(rows.map(row => row[key])).size !== rows.length) throw new ManagementInputError(`Model ${key} values must be unique, nonempty names of up to ${max} characters.`);
  };
  const keys = (row: Record<string, unknown>, allowed: string[]) => { if (Object.keys(row).some(key => !allowed.includes(key))) throw new ManagementInputError("The model contains an unsupported field."); };
  const rows = (value: unknown) => { if (value === undefined) return []; if (!Array.isArray(value) || value.some(v => !v || typeof v !== "object" || Array.isArray(v))) throw new ManagementInputError("Model definitions must be arrays of objects."); return value.map(asRecord); };
  const definitions = (items: Record<string, unknown>[], key: "para_name" | "property_name") => {
    unique(items, key, key === "para_name" ? 32 : 64);
    for (const p of items) {
      keys(p, [key, "data_type", "required", "enum_list", "min", "max", "max_length", "step", "unit", "description", ...(key === "property_name" ? ["method", "default_value"] : [])]);
      if (!["int", "long", "decimal", "string", "DateTime", "jsonObject", "enum", "boolean", "string list"].includes(String(p.data_type))) throw new ManagementInputError("A model definition has an unsupported data type.");
      if (p.required !== undefined && typeof p.required !== "boolean") throw new ManagementInputError("Model required flags must be true or false.");
      if (p.enum_list !== undefined && (!Array.isArray(p.enum_list) || p.enum_list.some(v => typeof v !== "string"))) throw new ManagementInputError("Model enum values must be strings.");
      if (p.max_length !== undefined && (!Number.isSafeInteger(p.max_length) || Number(p.max_length) < 0)) throw new ManagementInputError("Model maximum lengths must be nonnegative integers.");
      if (p.min !== undefined && !Number.isFinite(Number(p.min)) || p.max !== undefined && !Number.isFinite(Number(p.max)) || p.min !== undefined && p.max !== undefined && Number(p.min) > Number(p.max)) throw new ManagementInputError("A model numeric range is invalid.");
      if (p.step !== undefined && (typeof p.step !== "number" || !Number.isFinite(p.step) || p.step <= 0)) throw new ManagementInputError("Model steps must be positive numbers.");
      if (key === "property_name" && (!['RWE', 'RW', 'RE', 'WE', 'E', 'W', 'R'].includes(String(p.method)) || (/[.$]/.test(String(p[key])) || String(p[key]).includes(String.fromCharCode(0))))) throw new ManagementInputError("A property has an invalid access mode or name.");
    }
  };
  const result = rows(parsed); unique(result, "service_id", 64);
  for (const service of result) {
    keys(service, ["service_id", "service_type", "properties", "commands", "description", "option"]);
    if (typeof service.service_type !== "string" || !service.service_type.length || service.service_type.length > 64) throw new ManagementInputError("Each service needs a service_type of up to 64 characters.");
    if (service.option !== undefined && !["Master", "Mandatory", "Optional"].includes(String(service.option))) throw new ManagementInputError("A service has an invalid option.");
    definitions(rows(service.properties), "property_name");
    const commands = rows(service.commands); unique(commands, "command_name", 64);
    for (const command of commands) {
      keys(command, ["command_name", "paras", "responses"]); definitions(rows(command.paras), "para_name");
      // Response definitions use response_name + paras (the same parameter schema).
      const responses = rows(command.responses); unique(responses, "response_name", 128);
      for (const response of responses) { keys(response, ["response_name", "paras"]); definitions(rows(response.paras), "para_name"); }
    }
  }
  return result;
}

export const iotdaManagement: ManagementAdapter = {
  title: "IoTDA Devices and Products",
  operations: [
    { id: "create-product", label: "Create product", description: "Create a product in a current resource space. Add its services and properties in the product model before reporting telemetry.", kind: "create", fields: [name, description, modelField, { key: "app", label: "Resource space", type: "select", required: true, source: "apps" }, { key: "deviceType", label: "Device type", required: true, max: 32, pattern: namePattern }, { key: "manufacturer", label: "Manufacturer", max: 32, pattern: namePattern }, { key: "protocol", label: "Protocol", type: "select", required: true, choices: protocols.map(p => pick(p)), defaultValue: "MQTT" }, { key: "format", label: "Data format", type: "select", required: true, choices: [pick("json", "JSON"), pick("binary", "Binary")], defaultValue: "json" }] },
    { id: "update-product", label: "Edit product metadata", description: "Change the product name and description while preserving its protocol, services, properties, and commands.", kind: "update", resourcePrefixes: ["product:"], fields: [name, description] },
    { id: "update-model", label: "Edit product service model", description: "Replace the service capabilities, properties, and commands. Protocol and metadata are preserved. Devices and codec plugins must use the same model.", kind: "action", resourcePrefixes: ["product:"], fields: [modelField], confirmation: true, impact: "Changing or removing services, properties, or commands can break connected devices and codec plugins." },
    { id: "inspect-product", label: "View product model", description: "Inspect the current services, properties, and commands defined by this product.", kind: "inspect", resourcePrefixes: ["product:"], fields: [] },
    { id: "delete-product", label: "Delete unused product", description: "Delete a product only after every registered device in its resource space has been removed.", kind: "delete", resourcePrefixes: ["product:"], fields: [], confirmation: true, impact: "The product model and its services and commands are permanently deleted." },
    { id: "create-device", label: "Register device", description: "Register a direct device or gateway child against a current product with secure secret authentication.", kind: "create", fields: [{ ...name, max: 256 }, deviceDescription, { key: "product", label: "Product and resource space", type: "select", required: true, source: "products" }, { key: "node", label: "Node identifier", required: true, max: 64, pattern: "^[A-Za-z0-9_-]+$", help: "Device serial number, IMEI, or a MAC identifier without separators." }, secret, { key: "gateway", label: "Parent gateway", type: "select", source: "gateways", help: "Optional. Parent and product must belong to the same resource space." }], impact: "Device connections and data processing can incur IoTDA charges. Keep the device secret securely." },
    { id: "update-device", label: "Edit device metadata", description: "Update the device name and description while retaining its product and authentication settings.", kind: "update", resourcePrefixes: ["device:"], fields: [{ ...name, max: 256 }, deviceDescription] },
    { id: "inspect-device", label: "View device configuration", description: "Inspect resource space, product, gateway, firmware, SDK version, and authentication mode without displaying secrets.", kind: "inspect", resourcePrefixes: ["device:"], fields: [] },
    { id: "freeze", label: "Freeze device", description: "Block this device from connecting to IoTDA.", kind: "action", resourcePrefixes: ["device:"], fields: [], confirmation: true, impact: "The device loses access to IoTDA until it is unfrozen." },
    { id: "unfreeze", label: "Unfreeze device", description: "Allow this device to authenticate and reconnect to IoTDA.", kind: "action", resourcePrefixes: ["device:"], fields: [] },
    { id: "reset-secret", label: "Reset device secret", description: "Set a known primary or secondary secret for a device using secret authentication.", kind: "action", resourcePrefixes: ["device:"], fields: [secret, { key: "secretType", label: "Secret type", type: "select", required: true, choices: [pick("PRIMARY", "Primary"), pick("SECONDARY", "Secondary")], defaultValue: "PRIMARY" }, { key: "disconnect", label: "Disconnect current connection", type: "boolean", defaultValue: true }], confirmation: true, impact: "Update the physical device with the new secret. Existing credentials may stop authenticating, and an active connection can be disconnected." },
    { id: "delete-device", label: "Delete device", description: "Remove a device registration after checking that no child devices depend on it.", kind: "delete", resourcePrefixes: ["device:"], fields: [], confirmation: true, impact: "The device registration and its cloud data are deleted. The device can no longer authenticate." },
    { id: "view-shadow", label: "View device shadow", description: "Inspect the device's reported and desired state and service versions.", kind: "inspect", resourcePrefixes: ["device:"], fields: [] },
    { id: "update-shadow", label: "Update desired device state", description: "Set desired properties for one current product service using a version check. The device must implement shadow synchronization.", kind: "action", resourcePrefixes: ["device:"], fields: [{ key: "service", label: "Product service", type: "select", required: true, source: "services" }, { key: "properties", label: "Desired properties (JSON object)", type: "textarea", required: true, max: 16384, maxBytes: 16384, defaultValue: "{}" }], impact: "Desired properties can change the physical device's behavior when it synchronizes its shadow." },
    { id: "send-command", label: "Send device command", description: "Send a synchronous command declared in the current product model. Inspect the model for required parameter names and types.", kind: "action", resourcePrefixes: ["device:"], fields: [{ key: "command", label: "Product command", type: "select", required: true, source: "commands" }, { key: "parameters", label: "Command parameters (JSON object)", type: "textarea", required: true, max: 16384, maxBytes: 16384, defaultValue: "{}" }], confirmation: true, impact: "This command can immediately change the physical device's behavior." },
  ],
  inventory: async s => {
    const [deviceRows, productRows] = await Promise.all([listIotdaDevices(s), products(s)]);
    return [...deviceRows.map(d => ({ id: `device:${d.deviceId}`, name: d.deviceName, status: d.status, values: { name: d.deviceName } })), ...productRows.map(p => ({ id: productKey(asString(p.app_id), asString(p.product_id)), name: `${firstString([p.name, p.product_id])} (${firstString([p.app_name, p.app_id])})`, values: { name: asString(p.name, ""), description: asString(p.description, ""), app: asString(p.app_id), product: asString(p.product_id) } }))];
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-product") return { apps: (await apps(s)).map(a => pick(asString(a.app_id), firstString([a.app_name, a.app_id]))) };
    if (operation === "create-device") { const [rows, devices] = await Promise.all([products(s), listIotdaDevices(s)]); return { products: rows.map(p => pick(productKey(asString(p.app_id), asString(p.product_id)), `${firstString([p.name, p.product_id])} (${firstString([p.app_name, p.app_id])})`)), gateways: devices.filter(d => d.nodeType === "GATEWAY").map(d => pick(d.deviceId, d.deviceName)) }; }
    if (resource?.id.startsWith("device:")) {
      if (operation === "update-device") { const d = await deviceDetail(s, resource); resource.values = { name: asString(d.device_name, ""), description: asString(d.description, "") }; }
      if (["send-command", "update-shadow"].includes(operation)) { const { product } = await deviceModel(s, resource); return { services: services(product).map(v => pick(asString(v.service_id))), commands: commands(product).map(v => pick(v.value, `${v.service} / ${v.command.command_name}`)) }; }
    }
    if (resource?.id.startsWith("product:") && ["update-product", "update-model"].includes(operation)) { const { app, id } = productIdentity(resource); const p = await productDetail(s, app, id); resource.values = { ...resource.values, name: asString(p.name, ""), description: asString(p.description, ""), model: JSON.stringify(p.service_capabilities ?? [], null, 2) }; }
    return {};
  },
  execute: async (s, operation, v, resource) => {
    if (operation === "create-product") {
      if (!(await apps(s)).some(a => a.app_id === v.app)) throw new ManagementInputError("Select a current resource space.");
      const r = await huaweiFetch<Record<string, unknown>>(s, "iotda", `${base(s)}/products`, { method: "POST", body: JSON.stringify({ app_id: v.app, name: v.name, description: v.description ?? "", device_type: v.deviceType, manufacturer_name: v.manufacturer ?? "", protocol_type: v.protocol, data_format: v.format, service_capabilities: model(v.model) }) });
      return { message: "Product created. Configure the device to use this product model.", resourceId: r.product_id ? productKey(String(v.app), String(r.product_id)) : undefined };
    }
    if (operation === "create-device") {
      const p = (await products(s)).find(p => productKey(asString(p.app_id), asString(p.product_id)) === v.product);
      if (!p) throw new ManagementInputError("Select a current product and resource space.");
      if (p.protocol_type === "CoAP" && !/^[0-9a-fA-F]+$/.test(String(v.secret))) throw new ManagementInputError("CoAP/NB devices require a hexadecimal secret.");
      if (v.gateway) {
        const gateway = (await listIotdaDevices(s)).find(d => d.deviceId === v.gateway && d.nodeType === "GATEWAY");
        if (!gateway) throw new ManagementInputError("Select a current gateway.");
        const d = await deviceDetail(s, { id: `device:${gateway.deviceId}`, name: gateway.deviceName });
        if (d.app_id !== p.app_id) throw new ManagementInputError("Gateway and product must belong to the same resource space.");
      }
      const r = await huaweiFetch<Record<string, unknown>>(s, "iotda", `${base(s)}/devices`, { method: "POST", body: JSON.stringify({ app_id: p.app_id, product_id: p.product_id, node_id: v.node, device_name: v.name, description: v.description ?? "", auth_info: { auth_type: "SECRET", secret: v.secret, secure_access: true, timeout: 0 }, ...(v.gateway ? { gateway_id: v.gateway } : {}) }) });
      return { message: "Device registered with secure secret authentication.", resourceId: r.device_id ? `device:${r.device_id}` : undefined };
    }
    if (!resource) throw new ManagementInputError("Select a current resource.");
    if (resource.id.startsWith("product:")) {
      const { app, id } = productIdentity(resource); const p = await productDetail(s, app, id); const path = `${base(s)}/products/${encodeURIComponent(id)}`;
      if (operation === "update-product") { await huaweiFetch(s, "iotda", path, { method: "PUT", body: JSON.stringify({ app_id: app, name: v.name, description: v.description ?? "" }) }); return { message: "Product metadata updated." }; }
      if (operation === "update-model") { await huaweiFetch(s, "iotda", path, { method: "PUT", body: JSON.stringify({ app_id: app, service_capabilities: model(v.model) }) }); return { message: "Product service model updated. Synchronize devices and any codec plugins with the new model." }; }
      if (operation === "inspect-product") return { message: "Current product model.", facts: [{ label: "Resource space", value: app }, { label: "Protocol", value: asString(p.protocol_type, "-") }, ...services(p).map(service => ({ label: asString(service.service_id), value: JSON.stringify({ properties: service.properties ?? [], commands: service.commands ?? [] }) }))] };
      if (operation === "delete-product") {
        const devices = await listIotdaDevices(s);
        for (const d of devices.filter(d => d.productId === id)) { const fresh = await deviceDetail(s, { id: `device:${d.deviceId}`, name: d.deviceName }); if (fresh.app_id === app && fresh.product_id === id) throw new ManagementInputError("Delete every device registered to this product first."); }
        await huaweiFetch(s, "iotda", `${path}?${new URLSearchParams({ app_id: app })}`, { method: "DELETE" }); return { message: "Unused product deleted." };
      }
    }
    if (!resource.id.startsWith("device:")) throw new ManagementInputError("Select a device for this operation.");
    const device = await deviceDetail(s, resource); const path = devicePath(s, resource);
    if (operation === "update-device") { await huaweiFetch(s, "iotda", path, { method: "PUT", body: JSON.stringify({ device_name: v.name, description: v.description ?? "" }) }); return { message: "Device metadata updated." }; }
    if (operation === "inspect-device") return { message: "Current device configuration. Authentication secrets are omitted.", facts: ["app_id", "product_id", "gateway_id", "node_id", "node_type", "status", "fw_version", "sw_version", "device_sdk_version"].map(key => ({ label: key.replaceAll("_", " "), value: asString(device[key], "-") })).concat([{ label: "Authentication", value: asString(asRecord(device.auth_info).auth_type, "-") }]) };
    if (["freeze", "unfreeze"].includes(operation)) { await huaweiFetch(s, "iotda", `${path}/${operation}`, { method: "POST" }); return { message: operation === "freeze" ? "Device frozen." : "Device unfrozen." }; }
    if (operation === "reset-secret") {
      if (asRecord(device.auth_info).auth_type !== "SECRET") throw new ManagementInputError("This device does not use secret authentication.");
      const p = await productDetail(s, asString(device.app_id), asString(device.product_id));
      if (p.protocol_type === "CoAP" && (!/^[0-9a-fA-F]+$/.test(String(v.secret)) || v.secretType !== "PRIMARY")) throw new ManagementInputError("CoAP/NB devices require a hexadecimal primary secret.");
      await huaweiFetch(s, "iotda", `${path}/action?action_id=resetSecret`, { method: "POST", body: JSON.stringify({ secret: v.secret, secret_type: v.secretType, force_disconnect: v.disconnect === true }) }); return { message: "Device secret reset. Update the device with the secret you supplied." };
    }
    if (operation === "delete-device") {
      if ((await listIotdaDevices(s)).some(d => d.gatewayId === device.device_id && d.deviceId !== device.device_id)) throw new ManagementInputError("Remove this gateway's child devices first.");
      await huaweiFetch(s, "iotda", path, { method: "DELETE" }); return { message: "Device deleted." };
    }
    if (operation === "view-shadow") { const r = await huaweiFetch<Record<string, unknown>>(s, "iotda", `${path}/shadow`); return { message: "Current device shadow.", facts: asArray(r.shadow).map(asRecord).map(service => ({ label: asString(service.service_id), value: JSON.stringify({ reported: service.reported, desired: service.desired, version: service.version }) })) }; }
    if (["send-command", "update-shadow"].includes(operation)) {
      const p = await productDetail(s, asString(device.app_id), asString(device.product_id));
      if (operation === "send-command") {
        const selected = commands(p).find(c => c.value === v.command);
        if (!selected) throw new ManagementInputError("This command is no longer defined by the product model.");
        const paras = jsonObject(v.parameters, "Command parameters"); validateModelValues(paras, asArray(selected.command.paras).map(asRecord), "para_name", true);
        const r = await huaweiFetch<Record<string, unknown>>(s, "iotda", `${path}/commands`, { method: "POST", body: JSON.stringify({ service_id: selected.service, command_name: selected.command.command_name, paras }) });
        return { message: "Device command submitted. Check the device's reported state to confirm its effect.", facts: r.command_id ? [{ label: "Command ID", value: String(r.command_id) }] : undefined };
      }
      const service = services(p).find(s => s.service_id === v.service);
      if (!service) throw new ManagementInputError("This service is no longer defined by the product model.");
      const properties = jsonObject(v.properties, "Desired properties"); const definitions = asArray(service.properties).map(asRecord);
      if (!Object.keys(properties).length) throw new ManagementInputError("Provide at least one desired property.");
      if (Object.keys(properties).some(key => !definitions.some(p => p.property_name === key && String(p.method).includes("W")))) throw new ManagementInputError("Desired properties must be writable in the current product model.");
      validateModelValues(properties, definitions, "property_name", false);
      const r = await huaweiFetch<Record<string, unknown>>(s, "iotda", `${path}/shadow`);
      const shadow = asArray(r.shadow).map(asRecord).find(sh => sh.service_id === v.service);
      if (!shadow || !Number.isSafeInteger(shadow.version)) throw new ManagementInputError("Refresh the device shadow before updating this service.");
      await huaweiFetch(s, "iotda", `${path}/shadow`, { method: "PUT", body: JSON.stringify({ shadow: [{ service_id: v.service, desired: properties, version: shadow.version }] }) });
      return { message: "Desired device state updated. The device must synchronize before these values take effect." };
    }
    throw new ManagementInputError("Unsupported IoTDA operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listIotdaDevices],
};
