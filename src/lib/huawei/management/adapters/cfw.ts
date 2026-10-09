import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import { cfwFetch as huaweiFetch, listNativeCloudFirewalls, verifyCfwScope as scope } from "@/lib/huawei/services/cfw-native";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { collectList } from "@/lib/huawei/pagination";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

/**
 * Cloud Firewall (CFW) management — narrow native scope over the official CFW API contracts
 * (huaweicloud-sdk-cfw v1: POST /v1/{project_id}/firewalls/list, GET /v1/{project_id}/firewall/exist,
 * /v1/{project_id}/acl-rule(s), /v1/{project_id}/address-set(s)/address-items, /v1/{project_id}/service-set(s)/service-items,
 * POST /v1/{project_id}/eip/protect/all/{fw_instance_id}/operation, POST /v1/{project_id}/firewall/east-west/protect,
 * POST/DELETE /v2/{project_id}/firewall, GET /v3/{project_id}/jobs/{job_id}).
 *
 * Verified-native semantics enforced here:
 * - Rule addresses: the native RuleAddressDto accepts any valid IPv4/IPv6 address or CIDR. The native contract
 *   has no Internet-public-only or VPC-RFC1918-only scope rule, so no such filter is invented here; only the
 *   real checks remain (valid IP/CIDR, family bit limits, same source/destination family, native object type).
 * - Rule state changes roundtrip only complete whitelisted schemas of the verified native write contract
 *   (manual and address/service-group rules). Unknown nonempty settings, masked values, and nested array
 *   objects block the update; documented read-only echo fields are the only fields ignored.
 * - Group deletion requires a numeric exact-zero ref_count plus a fresh ACL dependency proof whenever the
 *   rule list of the protection object is a known reference query (NAT border objects have none).
 * - Every post-write claim is either verified by a fresh native read or stated as accepted with a hash
 *   observer (field names plus digest, never raw values). EIP/VPC protection switches expose no queryable
 *   native job, so in-progress outcomes are honest accepted-manual-verify results, never fake polling.
 *
 * Remaining full-console gaps (intentionally not implemented here):
 * - NAT border (type 2) ACL rules and domain/region/domain-group/multi-object address rule types: only manual
 *   IP/CIDR rules are created, and rule status toggles reject any current configuration that cannot be
 *   roundtripped with exactly verified field names and types.
 * - Prepaid (yearly/monthly) procurement, renewal, upgrade, and flavor extension: order/payment contracts are
 *   out of scope. Only typed pay-per-use creation (charge_mode postPaid, Professional edition — the only
 *   documented postPaid flavor) and pay-per-use deletion are offered; prepaid deletion needs a verified
 *   order-cancellation quote and is rejected.
 * - Per-EIP protection switching, auto-protect, IPS features, black/white lists, domain groups, DNS servers,
 *   capture tasks, logs, reports, tags, multi-account management, and east-west firewall instance lifecycle.
 * - Service groups: the native list response does not echo the protection object ID, so ownership relies on the
 *   documented object_id query filter (address groups do echo object_id and are verified per record).
 * - Firewall deletion completion: CFW exposes no per-firewall detail endpoint that returns transport 404;
 *   completion is the native v3 job status plus verified absence from the complete paginated firewall inventory.
 */

function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
const createLabel = "Create pay-per-use cloud firewall";
const deleteLabel = "Delete pay-per-use firewall";
const addRuleLabel = "Add ACL rule";
const ruleStatusLabel = "Enable or disable ACL rule";
const deleteRuleLabel = "Delete ACL rule";
const firewallStatus = (value: unknown) => ({ [-1]: "Waiting for payment", 0: "Creating", 1: "Deleting", 2: "Running", 3: "Upgrading", 4: "Deleted", 5: "Freezing", 6: "Creation failed", 7: "Deletion failed", 8: "Freeze failed", 9: "Storing", 10: "Store failed", 11: "Upgrade failed" } as Record<number, string>)[integer(value) ? value : NaN] ?? "Unknown";
const chargeModeLabel = (value: unknown) => value === 1 ? "Pay-per-use" : value === 0 ? "Pre-paid (yearly/monthly)" : "Unknown";
const objectTypeLabel = (value: unknown) => ({ 0: "Internet border", 1: "VPC border", 2: "NAT border" } as Record<number, string>)[integer(value) ? value : NaN] ?? "Unknown type";
const protocolLabel = (value: unknown) => ({ [-1]: "Any", 1: "ICMP", 6: "TCP", 17: "UDP", 58: "ICMPv6" } as Record<number, string>)[integer(value) ? value : NaN] ?? "Unknown protocol";
/** Unknown native enums are never defaulted to a permit/block or enabled/disabled claim. */
const actionLabel = (value: unknown) => value === 0 ? "Allow" : value === 1 ? "Block" : "Unknown action";
const ruleStateLabel = (value: unknown) => value === 1 ? "Enabled" : value === 0 ? "Disabled" : "Unknown state";
const directionLabel = (value: unknown) => value === 0 ? "Inbound" : value === 1 ? "Outbound" : "Unknown direction";
const portText = (value: unknown) => typeof value === "string" && value.trim() ? value : integer(value) ? String(value) : "unknown";

function uniqueIds(records: Record<string, unknown>[], key: string, label: string) {
  const seen = new Set<string>();
  for (const record of records) {
    const id = asString(record[key], "");
    if (!id) throw new Error(`Huawei returned a ${label} without a nonempty ID; the inventory may be incomplete.`);
    if (seen.has(id)) throw new Error(`Huawei returned duplicate ${label} IDs; the inventory may be incomplete.`);
    seen.add(id);
  }
}

async function pagedList(s: BetterUiSession, path: string, inBody: boolean, init?: RequestInit) {
  let expectedTotal: number | undefined;
  return collectList(async cursor => {
    const url = new URL(path, "https://cfw.invalid");
    if (!inBody) url.searchParams.set("offset", String(cursor));
    const options = inBody ? { ...init, body: JSON.stringify({ ...asRecord(JSON.parse(String(init?.body ?? "{}"))), offset: cursor }) } : init;
    const body = await huaweiFetch<Record<string, unknown>>(s, "cfw", url.pathname + url.search, options);
    const { data } = verifiedPage(s, body);
    if (expectedTotal !== undefined && expectedTotal !== data.total) throw new Error("The Cloud Firewall inventory changed during pagination; refresh it before administering resources.");
    expectedTotal = data.total as number;
    return body;
  }, { items: ["data.records"], kind: "offset", parameter: "offset", size: 100, total: ["data.total"] });
}
function verifiedPage(s: BetterUiSession, body: Record<string, unknown>) {
  const data = asRecord(body.data);
  if (!Array.isArray(data.records)) throw new Error("Huawei returned an incomplete Cloud Firewall record array.");
  if (!integer(data.total) || data.total < data.records.length) throw new Error("Huawei did not report a typed page total; the inventory may be incomplete.");
  const records = data.records.map(asRecord);
  for (const row of records) scope(s, row);
  return { data, records, body };
}

async function page(s: BetterUiSession, path: string) {
  return verifiedPage(s, await pagedList(s, path, false));
}

async function firewalls(s: BetterUiSession) {
  return listNativeCloudFirewalls(s);
}

async function firewallDetail(s: BetterUiSession, fwId: string) {
  const result = await page(s, `/v1/${s.projectId}/firewall/exist?fw_instance_id=${encodeURIComponent(fwId)}&limit=100`);
  uniqueIds(result.records, "fw_instance_id", "firewall detail");
  if (result.records.length !== 1 || asString(result.records[0].fw_instance_id, "") !== fwId) throw new ManagementInputError("The firewall's protection objects could not be verified for this project.", 404);
  return result.records[0];
}

function protectObjects(detailRecord: Record<string, unknown>) {
  const raw = detailRecord.protect_objects;
  if (!Array.isArray(raw)) throw new Error("Huawei returned an unreadable protection object list.");
  const objects = raw.map(asRecord);
  uniqueIds(objects, "object_id", "protection object");
  if (objects.some(item => !integer(item.type) || ![0, 1, 2].includes(item.type))) throw new Error("Huawei returned an unverifiable protection object type.");
  return objects.map(item => ({ object_id: asString(item.object_id, ""), object_name: asString(item.object_name, ""), type: Number(item.type) }));
}

async function addressSets(s: BetterUiSession, objectId: string) {
  const result = await page(s, `/v1/${s.projectId}/address-sets?object_id=${encodeURIComponent(objectId)}&query_address_set_type=0&limit=100`);
  uniqueIds(result.records, "set_id", "address group");
  for (const set of result.records) if (asString(set.object_id, "") !== objectId) throw new Error("Huawei returned an address group from a different protection object.");
  for (const set of result.records) if ("address_set_type" in set && set.address_set_type !== 0) throw new Error("Huawei returned an unverifiable custom address group type.");
  return result.records;
}

async function serviceSets(s: BetterUiSession, objectId: string) {
  const result = await page(s, `/v1/${s.projectId}/service-sets?object_id=${encodeURIComponent(objectId)}&query_service_set_type=0&limit=100`);
  uniqueIds(result.records, "set_id", "service group");
  for (const set of result.records) {
    if ("service_set_type" in set && set.service_set_type !== 0) throw new Error("Huawei returned an unverifiable custom service group type.");
    if ("object_id" in set && set.object_id !== objectId) throw new Error("Huawei returned a service group from a different protection object.");
  }
  return result.records;
}

async function addressItems(s: BetterUiSession, setId: string) {
  const result = await page(s, `/v1/${s.projectId}/address-items?set_id=${encodeURIComponent(setId)}&limit=100`);
  const echo = result.data.set_id;
  if (echo !== undefined && asString(echo, "") !== setId) throw new Error("Huawei returned address items from a different group.");
  uniqueIds(result.records, "item_id", "address item");
  for (const item of result.records) if ("set_id" in item && item.set_id !== setId) throw new Error("Huawei returned an address item from a different group.");
  return result.records;
}

async function serviceItems(s: BetterUiSession, setId: string) {
  const result = await page(s, `/v1/${s.projectId}/service-items?set_id=${encodeURIComponent(setId)}&limit=100`);
  const echo = result.data.set_id;
  if (echo !== undefined && asString(echo, "") !== setId) throw new Error("Huawei returned service items from a different group.");
  uniqueIds(result.records, "item_id", "service item");
  for (const item of result.records) if ("set_id" in item && item.set_id !== setId) throw new Error("Huawei returned a service item from a different group.");
  return result.records;
}

async function aclRules(s: BetterUiSession, objectId: string, type: number) {
  const result = await page(s, `/v1/${s.projectId}/acl-rules?object_id=${encodeURIComponent(objectId)}&type=${type}&limit=100`);
  const echo = result.data.object_id;
  if (echo !== undefined && asString(echo, "") !== objectId) throw new Error("Huawei returned rules from a different protection object.");
  uniqueIds(result.records, "rule_id", "ACL rule");
  for (const rule of result.records) if ("object_id" in rule && rule.object_id !== objectId) throw new Error("Huawei returned an ACL rule from a different protection object.");
  return result.records;
}

async function ownedFirewall(s: BetterUiSession, fwId: string, requireRunning: boolean) {
  const record = (await firewalls(s)).records.find(item => asString(item.fw_instance_id, "") === fwId);
  if (!record) throw new ManagementInputError("The firewall no longer belongs to this project.", 404);
  if (requireRunning && firewallStatus(record.status) !== "Running") throw new ManagementInputError(`The firewall is ${firewallStatus(record.status)}; wait for a stable running state before changing it.`, 409);
  return record;
}

async function ownedObject(s: BetterUiSession, fwId: string, objectId: string) {
  const object = protectObjects(await firewallDetail(s, fwId)).find(item => item.object_id === objectId);
  if (!object) throw new ManagementInputError("The protection object no longer belongs to this firewall.", 404);
  return object;
}

/** Fresh ACL dependency proof: the rule list is the known reference query for Internet/VPC border objects. */
async function referencedByAclRule(s: BetterUiSession, object: { object_id: string; type: number }, setId: string, kind: "address" | "service") {
  if (object.type !== 0 && object.type !== 1) return { proven: false, used: false };
  const rules = await aclRules(s, object.object_id, object.type);
  const references = (value: unknown, kind: "address" | "service"): string[] => {
    const row = asRecord(value);
    if (!integer(row.type) || ![0, 1, ...(kind === "address" ? [2, 3, 4, 5, 6, 7] : [])].includes(row.type)) throw new ManagementInputError("The fresh ACL rule dependencies could not be verified; inspect its references in Huawei before deleting this group.", 409);
    const ids: string[] = [];
    const scalar = kind === "address" ? "address_set_id" : "service_set_id";
    if (scalar in row && row[scalar] !== null && row[scalar] !== "") {
      if (typeof row[scalar] !== "string") throw new ManagementInputError("The fresh ACL rule dependencies could not be verified.", 409);
      ids.push(row[scalar]);
    }
    const fields = kind === "address" ? ["address_group", "predefined_group"] : ["service_group", "predefined_group"];
    for (const key of fields) if (key in row && row[key] !== null) {
      const values = row[key];
      if (!Array.isArray(values) || values.some(item => typeof item !== "string" || !item.trim())) throw new ManagementInputError("The fresh ACL rule dependencies could not be verified.", 409);
      ids.push(...values);
    }
    if (row.type === 1 && !ids.length) throw new ManagementInputError("The fresh ACL rule's group identity could not be verified.", 409);
    if (kind === "address" && row.type === 5 && !fields.every(key => Array.isArray(row[key]))) throw new ManagementInputError("The fresh multi-object ACL rule dependencies could not be verified.", 409);
    return ids;
  };
  let used = false;
  for (const rule of rules) {
    const ids = kind === "service" ? references(rule.service, "service") : [...references(rule.source, "address"), ...references(rule.destination, "address")];
    if (ids.includes(setId)) used = true;
  }
  return { proven: true, used };
}

function parseId(resource: ManagementResource | undefined, prefix: string, parents: number) {
  if (!resource?.id.startsWith(`${prefix}:`)) throw new ManagementInputError(`Select a current Cloud Firewall ${prefix === "fw" ? "firewall" : prefix === "addr" ? "address group" : "service group"}.`);
  const segments = resource.id.split(":");
  if (segments.length !== parents + 1 || segments.slice(1).some(segment => !segment)) throw new ManagementInputError("The resource identifier could not be verified.");
  return segments.slice(1);
}

async function ownedAddressSet(s: BetterUiSession, resource: ManagementResource | undefined, requireRunning: boolean) {
  const [fwId, objectId, setId] = parseId(resource, "addr", 3);
  await ownedFirewall(s, fwId, requireRunning);
  const object = await ownedObject(s, fwId, objectId);
  const set = (await addressSets(s, object.object_id)).find(item => asString(item.set_id, "") === setId);
  if (!set) throw new ManagementInputError("The address group no longer belongs to this protection object.", 404);
  if (requireRunning && set.name !== resource!.name) throw new ManagementInputError("The address group was renamed since selection. Refresh the list before changing it.", 409);
  return { fwId, object, setId, set };
}

async function ownedServiceSet(s: BetterUiSession, resource: ManagementResource | undefined, requireRunning: boolean) {
  const [fwId, objectId, setId] = parseId(resource, "svc", 3);
  await ownedFirewall(s, fwId, requireRunning);
  const object = await ownedObject(s, fwId, objectId);
  const set = (await serviceSets(s, object.object_id)).find(item => asString(item.set_id, "") === setId);
  if (!set) throw new ManagementInputError("The service group no longer belongs to this protection object.", 404);
  if (requireRunning && set.name !== resource!.name) throw new ManagementInputError("The service group was renamed since selection. Refresh the list before changing it.", 409);
  return { fwId, object, setId, set };
}

/** The native RuleAddressDto accepts any valid IPv4/IPv6 address or CIDR; no border scope is invented here. */
function ipOrCidr(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  const [address, prefix, extra] = text.split("/");
  const version = isIP(address);
  if (!text || !version || extra !== undefined) throw new ManagementInputError(`${label} must be one valid IPv4/IPv6 address or CIDR.`);
  const bits = version === 4 ? 32 : 128;
  if (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > bits)) throw new ManagementInputError(`${label} must be one valid IPv4/IPv6 address or CIDR.`);
  return text;
}

function portRange(value: unknown, label: string) {
  const text = String(value ?? "0").trim() || "0";
  const single = text.match(/^(\d{1,5})$/);
  if (single) {
    if (Number(single[1]) > 65535) throw new ManagementInputError(`${label} must be one port (0-65535) or a port range such as 1000-2000.`);
    return text;
  }
  const range = text.match(/^(\d{1,5})-(\d{1,5})$/);
  if (range) {
    const from = Number(range[1]), to = Number(range[2]);
    if (from > to || to > 65535) throw new ManagementInputError(`${label} must be one port (0-65535) or a port range such as 1000-2000.`);
    return text;
  }
  throw new ManagementInputError(`${label} must be one port (0-65535) or a port range such as 1000-2000.`);
}

/** Verification fingerprints retain only field names and a digest, never raw values. */
function verification(changes: Record<string, unknown>) {
  const fields = Object.keys(changes).sort();
  return { fields, digest: createHash("sha256").update(JSON.stringify(fields.map(field => [field, changes[field]]))).digest("hex") };
}
function converged(fresh: Record<string, unknown> | undefined, expected: Record<string, unknown>) {
  if (!fresh) return false;
  const typesKnown = Object.keys(expected).every(field => field === "name" ? typeof fresh[field] === "string" && !!(fresh[field] as string).trim() : integer(fresh[field]));
  return typesKnown && verification(Object.fromEntries(Object.keys(expected).map(field => [field, fresh[field]]))).digest === verification(expected).digest;
}

type FieldRule = { type: "string" | "number" | "boolean" | "string[]" | "number[]"; required?: boolean };
/** A masked current value can never be safely preserved by a rewrite. */
function isMaskedText(value: string) { return /^\*+$/.test(value); }

/**
 * Copy only fields of the exact verified native write contract with their documented types.
 * Documented read-only echo fields are the only ignored fields; any other unknown nonempty
 * setting, masked value, or nested array object blocks the update instead of being dropped.
 */
function copyVerified(source: Record<string, unknown>, schema: Record<string, FieldRule>, readonlyKeys: string[], label: string) {
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (!(key in source)) continue;
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (rule.type === "number[]") {
      if (!Array.isArray(value) || value.some(item => !integer(item) || ![-1, 1, 6, 17, 58].includes(item))) throw new ManagementInputError(`The ${label} field ${key} could not be verified for a safe update.`);
      out[key] = value;
      continue;
    }
    if (rule.type === "string[]") {
      if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) throw new ManagementInputError(`The ${label} field ${key} could not be verified for a safe update.`);
      out[key] = value;
      continue;
    }
    if (rule.type === "string") {
      if (typeof value !== "string") throw new ManagementInputError(`The ${label} field ${key} could not be verified for a safe update.`);
      if (isMaskedText(value)) throw new ManagementInputError(`The ${label} field ${key} is masked; its current value cannot be safely preserved.`);
      if (rule.required && !value.trim()) throw new ManagementInputError(`The ${label} field ${key} could not be verified for a safe update.`);
      out[key] = value;
      continue;
    }
    if ((rule.type === "number" && !integer(value)) || typeof value !== rule.type) throw new ManagementInputError(`The ${label} field ${key} could not be verified for a safe update.`);
    out[key] = value;
  }
  for (const [key, rule] of Object.entries(schema)) if (rule.required && !(key in out)) throw new ManagementInputError(`The ${label} field ${key} is required for a safe update but is missing.`);
  for (const key of Object.keys(source)) {
    if (key in schema || readonlyKeys.includes(key)) continue;
    const value = source[key];
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) continue;
    throw new ManagementInputError(`The ${label} has an unverifiable field ${key}; change the rule in the Huawei console.`);
  }
  return out;
}

const RULE_SCHEMA: Record<string, FieldRule> = {
  name: { type: "string", required: true },
  description: { type: "string" },
  direction: { type: "number" },
  action_type: { type: "number", required: true },
  address_type: { type: "number", required: true },
  applications: { type: "string[]" },
  long_connect_enable: { type: "number" },
  long_connect_time: { type: "number" },
  long_connect_time_hour: { type: "number" },
  long_connect_time_minute: { type: "number" },
  long_connect_time_second: { type: "number" },
  type: { type: "number", required: true },
};
/** Read-only echoes and the sub-objects handled separately are the only ignored top-level fields. */
const RULE_READONLY = ["rule_id", "order_id", "created_date", "modified_date", "status", "source", "destination", "service", "tag"];
const TAG_SCHEMA: Record<string, FieldRule> = { tag_id: { type: "string" }, tag_key: { type: "string" }, tag_value: { type: "string" } };
const ADDRESS_READONLY: string[] = [];

function roundtripAddress(source: Record<string, unknown>, label: string) {
  const type = source.type;
  if (!integer(type) || (type !== 0 && type !== 1)) throw new ManagementInputError(`This rule's ${label} uses a reference type that cannot be safely preserved here; change the rule in the Huawei console.`);
  const schema: Record<string, FieldRule> = type === 0
    ? { type: { type: "number", required: true }, address_type: { type: "number", required: true }, address: { type: "string", required: true } }
    : { type: { type: "number", required: true }, address_type: { type: "number", required: true }, address_set_id: { type: "string", required: true }, address_set_name: { type: "string" }, address_set_type: { type: "number" } };
  return copyVerified(source, schema, ADDRESS_READONLY, `rule ${label}`);
}

function roundtripService(source: Record<string, unknown>) {
  const type = source.type;
  if (!integer(type) || (type !== 0 && type !== 1)) throw new ManagementInputError("This rule's service configuration cannot be safely preserved here; change the rule in the Huawei console.");
  const schema: Record<string, FieldRule> = type === 0
    ? { type: { type: "number", required: true }, protocol: { type: "number", required: true }, protocols: { type: "number[]" }, source_port: { type: "string" }, dest_port: { type: "string" } }
    : { type: { type: "number", required: true }, protocols: { type: "number[]" }, service_set_id: { type: "string", required: true }, service_set_name: { type: "string" }, service_set_type: { type: "number" } };
  return copyVerified(source, schema, [], "rule service");
}

/** Enable/disable must preserve the current configuration without dropping or rewriting unverifiable fields. */
function roundtripRule(record: Record<string, unknown>, status: number) {
  const body = copyVerified(record, RULE_SCHEMA, RULE_READONLY, "rule");
  if (record.source === undefined || record.source === null || record.destination === undefined || record.destination === null || record.service === undefined || record.service === null) throw new ManagementInputError("The rule's current match configuration could not be verified for a safe update.");
  body.source = roundtripAddress(asRecord(record.source), "source");
  body.destination = roundtripAddress(asRecord(record.destination), "destination");
  body.service = roundtripService(asRecord(record.service));
  if (record.tag !== undefined && record.tag !== null) {
    const tag = copyVerified(asRecord(record.tag), TAG_SCHEMA, [], "rule tag");
    if (Object.keys(tag).length) body.tag = tag;
  }
  body.status = status;
  return body;
}

function describeAddress(value: unknown) {
  const address = asRecord(value);
  const type = integer(address.type) ? address.type : NaN;
  if (type === 0) return asString(address.address, "manual address");
  if (type === 1) return asString(address.address_set_name, asString(address.address_set_id, "address group"));
  if (type === 2 || type === 7) return asString(address.domain_address_name, "domain");
  if (type === 4 || type === 6) return asString(address.domain_set_name, "domain group");
  if (type === 3) return "region list";
  return "custom reference";
}

function describeService(value: unknown) {
  const service = asRecord(value);
  if (service.type === 1) return asString(service.service_set_name, asString(service.service_set_id, "service group"));
  return `${protocolLabel(service.protocol)} ${portText(service.source_port)}\u2192${portText(service.dest_port)}`;
}

const protectionObjectField: ManagementField = { key: "protectionObject", label: "Protection object", type: "select", source: "protectionObjects", required: true };
const ruleSelectField: ManagementField = { key: "rule", label: "ACL rule", type: "select", source: "aclRules", required: true };
const ruleConfirmField: ManagementField = { key: "confirmName", label: "Rule name confirmation", required: true, max: 255, help: "Type the rule's current name exactly as shown above. Deletion is refused when the current name differs." };
const ruleNameField: ManagementField = { key: "name", label: "Rule name", required: true, max: 255 };
const descriptionField: ManagementField = { key: "description", label: "Description", max: 255 };
const groupNameField: ManagementField = { key: "name", label: "Group name", required: true, max: 255 };
const addressHelp = "One IPv4/IPv6 address or CIDR; source and destination must use the same family. 0.0.0.0/0 or ::/0 means any address.";
const portHelp = "One port such as 443 or a range such as 1000-2000; 0 means any port.";
const protocolField: ManagementField = { key: "protocol", label: "Protocol", type: "select", required: true, defaultValue: "6", choices: [{ value: "6", label: "TCP" }, { value: "17", label: "UDP" }, { value: "1", label: "ICMP" }, { value: "58", label: "ICMPv6" }, { value: "-1", label: "Any" }] };
const sourcePortField: ManagementField = { key: "sourcePort", label: "Source port", max: 11, defaultValue: "0", help: portHelp };
const destPortField: ManagementField = { key: "destPort", label: "Destination port", max: 11, defaultValue: "0", help: portHelp };
const ruleImpact = "The rule filters traffic of the selected protection object immediately. Blocking rules can deny legitimate traffic; allowing rules can bypass other restrictions.";

export const cfwManagement: ManagementAdapter = {
  title: "Cloud Firewall",
  operations: [
    { id: "create-firewall", label: createLabel, kind: "create", description: "Create one pay-per-use Professional edition cloud firewall for this project. Protection stays off until EIPs or VPCs are protected.", fields: [{ key: "name", label: "Firewall name", required: true, max: 64, pattern: "^[A-Za-z0-9_-]{1,64}$" }], impact: "Pay-per-use billing for the Professional edition starts when creation succeeds. The firewall filters nothing until protection is enabled for EIPs or VPCs." },
    { id: "delete-firewall", label: deleteLabel, kind: "delete", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "Permanently release a pay-per-use firewall and its protection configuration.", fields: [], confirmation: true, impact: "All firewall protection, rules, address groups, and service groups are permanently removed. Protected EIPs and VPCs lose filtering. Prepaid firewalls cannot be deleted here." },
    { id: "inspect", label: "Inspect firewall and protection objects", kind: "inspect", resourcePrefixes: ["fw:"], description: "Inspect the exact firewall status, billing mode, capacity, and protection objects.", fields: [] },
    { id: "rules", label: "View ACL rules", kind: "inspect", resourcePrefixes: ["fw:"], description: "List the ACL rules of one protection object with direction, action, and state.", fields: [protectionObjectField] },
    { id: "create-rule", label: addRuleLabel, kind: "action", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "Create one enabled manual IP/CIDR access-control rule on one protection object.", fields: [protectionObjectField, ruleNameField, { key: "action", label: "Action", type: "select", required: true, defaultValue: "1", choices: [{ value: "0", label: "Allow (permit)" }, { value: "1", label: "Block (deny)" }] }, { key: "direction", label: "Direction", type: "select", choices: [{ value: "0", label: "Inbound (internet to VPC)" }, { value: "1", label: "Outbound (VPC to internet)" }], help: "Required for Internet border rules; not used by VPC border rules." }, { key: "source", label: "Source address", required: true, max: 64, help: addressHelp }, { key: "destination", label: "Destination address", required: true, max: 64, help: addressHelp }, protocolField, sourcePortField, destPortField, descriptionField], confirmation: true, impact: ruleImpact },
    { id: "rule-status", label: ruleStatusLabel, kind: "update", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "Change the enabled state of one rule while preserving its verified current configuration.", fields: [ruleSelectField, { key: "enabled", label: "Enable rule", type: "boolean", defaultValue: true }], confirmation: true, impact: "Disabling stops the rule from filtering traffic; enabling starts it again. Other rules keep filtering." },
    { id: "delete-rule", label: deleteRuleLabel, kind: "action", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "Permanently delete one ACL rule of this firewall after typing its current name.", fields: [ruleSelectField, ruleConfirmField], confirmation: true, impact: "The rule stops filtering permanently. Traffic it allowed or blocked is then governed only by the remaining rules." },
    { id: "protect-eip", label: "Restore EIP protection", kind: "action", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "One-key restore of protection for every EIP of this firewall.", fields: [], confirmation: true, impact: "Internet border filtering resumes for the firewall's EIPs. Rules can reject traffic that passed while protection was bypassed." },
    { id: "bypass-eip", label: "Bypass EIP protection", kind: "action", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "One-key bypass of protection for every EIP of this firewall.", fields: [], confirmation: true, impact: "All EIP traffic bypasses the firewall without filtering until protection is restored. This exposes origins directly to the internet." },
    { id: "protect-vpc", label: "Enable VPC border protection", kind: "action", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "Enable VPC boundary (east-west) protection for this firewall.", fields: [], confirmation: true, impact: "East-west traffic between VPCs starts being filtered by the VPC border rules. Rules can reject traffic that previously passed." },
    { id: "bypass-vpc", label: "Disable VPC border protection", kind: "action", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "Disable VPC boundary (east-west) protection for this firewall.", fields: [], confirmation: true, impact: "East-west traffic between VPCs is no longer filtered until protection is enabled again." },
    { id: "create-addr-set", label: "Create address group", kind: "action", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "Create one custom IP address group under a protection object.", fields: [protectionObjectField, groupNameField, { key: "addressType", label: "Address type", type: "select", required: true, defaultValue: "0", choices: [{ value: "0", label: "IPv4" }, { value: "1", label: "IPv6" }] }, descriptionField], impact: "The group starts empty and bills nothing on its own; rules can reference it after addresses are added." },
    { id: "create-svc-set", label: "Create service group", kind: "action", resourcePrefixes: ["fw:"], allowedStatuses: ["Running"], description: "Create one custom service group under a protection object.", fields: [protectionObjectField, groupNameField, descriptionField], impact: "The group starts empty and bills nothing on its own; rules can reference it after services are added." },
    { id: "inspect-addr", label: "Inspect address group", kind: "inspect", resourcePrefixes: ["addr:"], description: "Inspect the group's address type, rule references, and item count.", fields: [] },
    { id: "addr-items", label: "View address items", kind: "inspect", resourcePrefixes: ["addr:"], description: "List the IP addresses and CIDRs of this group.", fields: [] },
    { id: "add-addr-item", label: "Add address item", kind: "action", resourcePrefixes: ["addr:"], description: "Add one IP address or CIDR to this group.", fields: [{ key: "address", label: "IP address or CIDR", required: true, max: 64 }, descriptionField], confirmation: true, impact: "Every rule referencing this group immediately applies to the added address." },
    { id: "delete-addr-item", label: "Remove address item", kind: "action", resourcePrefixes: ["addr:"], description: "Remove one address from this group.", fields: [{ key: "item", label: "Address item", type: "select", source: "addressItems", required: true }], confirmation: true, impact: "Every rule referencing this group immediately stops applying to the removed address." },
    { id: "rename-addr", label: "Rename address group", kind: "update", resourcePrefixes: ["addr:"], description: "Change the group's name and description without touching its addresses.", fields: [groupNameField, descriptionField] },
    { id: "delete-addr", label: "Delete address group", kind: "delete", resourcePrefixes: ["addr:"], description: "Permanently delete an unreferenced custom address group and its addresses.", fields: [], confirmation: true, impact: "The group and its addresses are permanently removed. Groups referenced by rules must be cleared from those rules first." },
    { id: "inspect-svc", label: "Inspect service group", kind: "inspect", resourcePrefixes: ["svc:"], description: "Inspect the group's rule references, protocols, and item count.", fields: [] },
    { id: "svc-items", label: "View service items", kind: "inspect", resourcePrefixes: ["svc:"], description: "List the protocol and port definitions of this group.", fields: [] },
    { id: "add-svc-item", label: "Add service item", kind: "action", resourcePrefixes: ["svc:"], description: "Add one protocol/port definition to this group.", fields: [protocolField, sourcePortField, destPortField, descriptionField], confirmation: true, impact: "Every rule referencing this group immediately applies to the added service definition." },
    { id: "delete-svc-item", label: "Remove service item", kind: "action", resourcePrefixes: ["svc:"], description: "Remove one service definition from this group.", fields: [{ key: "item", label: "Service item", type: "select", source: "serviceItems", required: true }], confirmation: true, impact: "Every rule referencing this group immediately stops applying to the removed service definition." },
    { id: "rename-svc", label: "Rename service group", kind: "update", resourcePrefixes: ["svc:"], description: "Change the group's name and description without touching its services.", fields: [groupNameField, descriptionField] },
    { id: "delete-svc", label: "Delete service group", kind: "delete", resourcePrefixes: ["svc:"], description: "Permanently delete an unreferenced custom service group and its service definitions.", fields: [], confirmation: true, impact: "The group and its service definitions are permanently removed. Groups referenced by rules must be cleared from those rules first." },
  ],
  inventory: async s => {
    const result = await firewalls(s);
    const resources: ManagementResource[] = result.records.map(record => ({ id: `fw:${asString(record.fw_instance_id, "")}`, name: asString(record.fw_instance_name, asString(record.fw_instance_id, "")), status: firewallStatus(record.status), values: { chargeMode: chargeModeLabel(record.charge_mode) } }));
    for (const record of result.records) {
      const fwId = asString(record.fw_instance_id, "");
      for (const object of protectObjects(await firewallDetail(s, fwId))) {
        const [groups, services] = await Promise.all([addressSets(s, object.object_id), serviceSets(s, object.object_id)]);
        resources.push(...groups.map(set => ({ id: `addr:${fwId}:${object.object_id}:${asString(set.set_id, "")}`, name: asString(set.name, asString(set.set_id, "")), values: { addressType: integer(set.address_type) ? set.address_type : -1, refCount: integer(set.ref_count) ? set.ref_count : -1 } })));
        resources.push(...services.map(set => ({ id: `svc:${fwId}:${object.object_id}:${asString(set.set_id, "")}`, name: asString(set.name, asString(set.set_id, "")), values: { refCount: integer(set.ref_count) ? set.ref_count : -1 } })));
      }
    }
    return resources;
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (resource?.id.startsWith("fw:")) {
      const objects = protectObjects(await firewallDetail(s, resource.id.slice(3)));
      if (operation === "rule-status" || operation === "delete-rule") {
        const rules = (await Promise.all(objects.filter(object => object.type === 0 || object.type === 1).map(async object => (await aclRules(s, object.object_id, object.type)).map(rule => ({ value: `${object.object_id}:${asString(rule.rule_id, "")}`, label: `${asString(rule.name, "Unnamed rule")} \u00b7 ${objectTypeLabel(object.type)} \u00b7 ${actionLabel(rule.action_type)} \u00b7 ${ruleStateLabel(rule.status)}` }))))).flat();
        return { aclRules: rules };
      }
      if (["rules", "create-rule", "create-addr-set", "create-svc-set"].includes(operation)) return { protectionObjects: objects.map(object => ({ value: object.object_id, label: `${object.object_name || "Protection object"} \u00b7 ${objectTypeLabel(object.type)}` })) };
      return {};
    }
    if (resource?.id.startsWith("addr:") && operation === "delete-addr-item") {
      const { setId } = await ownedAddressSet(s, resource, false);
      return { addressItems: (await addressItems(s, setId)).map(item => ({ value: asString(item.item_id, ""), label: `${asString(item.address, "Unknown address")} \u00b7 ${item.address_type === 1 ? "IPv6" : item.address_type === 0 ? "IPv4" : "Unknown family"}` })) };
    }
    if (resource?.id.startsWith("svc:") && operation === "delete-svc-item") {
      const { setId } = await ownedServiceSet(s, resource, false);
      return { serviceItems: (await serviceItems(s, setId)).map(item => ({ value: asString(item.item_id, ""), label: `${protocolLabel(item.protocol)} ${portText(item.source_port)}\u2192${portText(item.dest_port)}` })) };
    }
    return {};
  },
  execute: async (s, operation, v: ManagementValues, resource) => {
    const write = async (path: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "cfw", path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (operation === "create-firewall") {
      const list = await firewalls(s);
      if (list.body.is_support_postpaid !== true) throw new ManagementInputError("Pay-per-use cloud firewalls are not available for this account or region.");
      const result = await write(`/v2/${s.projectId}/firewall`, "POST", { name: v.name, flavor: { version: "Professional" }, charge_info: { charge_mode: "postPaid" } });
      const jobId = asString(result.job_id, "");
      if (!jobId) throw new Error("Huawei returned no verified creation job. Check firewalls before retrying.");
      return { message: `Pay-per-use cloud firewall creation submitted for "${v.name}".`, jobId, asynchronous: true };
    }
    if (operation === "delete-firewall") {
      const [fwId] = parseId(resource, "fw", 1);
      const record = await ownedFirewall(s, fwId, true);
      if (asString(record.fw_instance_name, "") !== resource!.name) throw new ManagementInputError("The firewall was renamed since selection. Refresh the list and delete again.");
      if (record.charge_mode !== 1) throw new ManagementInputError("Only pay-per-use firewalls can be deleted here. Prepaid firewalls require order cancellation in billing.", 409);
      const resourceId = fwId;
      if ("resource_id" in record && record.resource_id !== fwId) throw new ManagementInputError("The native firewall/resource identity could not be verified.", 409);
      const result = await write(`/v2/${s.projectId}/firewall/${encodeURIComponent(resourceId)}`, "DELETE");
      const jobId = asString(result.data, "");
      if (!jobId) throw new Error("Huawei returned no verified deletion job. Check the firewall before retrying.");
      return { message: "Pay-per-use firewall deletion started. All protection stops when deletion completes.", resourceId: resource!.id, jobId, asynchronous: true };
    }
    if (["inspect", "rules", "create-rule", "rule-status", "delete-rule", "protect-eip", "bypass-eip", "protect-vpc", "bypass-vpc", "create-addr-set", "create-svc-set"].includes(operation)) {
      const [fwId] = parseId(resource, "fw", 1);
      const mutation = operation !== "inspect" && operation !== "rules";
      const record = await ownedFirewall(s, fwId, mutation);
      if (mutation && record.fw_instance_name !== resource!.name) throw new ManagementInputError("The firewall was renamed since selection. Refresh the inventory before changing it.", 409);
      if (operation === "inspect") {
        const objects = protectObjects(await firewallDetail(s, fwId));
        const flavor = asRecord(record.flavor);
        return { message: "Current cloud firewall state.", facts: [{ label: "Firewall", value: asString(record.fw_instance_name, fwId) }, { label: "Status", value: firewallStatus(record.status) }, { label: "Billing", value: chargeModeLabel(record.charge_mode) }, { label: "EIP protection capacity", value: String(flavor.eip_count ?? "Unknown") }, { label: "VPC protection capacity", value: String(flavor.vpc_count ?? "Unknown") }, { label: "Bandwidth", value: String(flavor.bandwidth ?? "Unknown") }, { label: "Log storage", value: String(flavor.log_storage ?? "Unknown") }, ...objects.map(object => ({ label: `Protection object \u00b7 ${objectTypeLabel(object.type)}`, value: object.object_name || object.object_id }))] };
      }
      if (operation === "rules") {
        const object = await ownedObject(s, fwId, String(v.protectionObject));
        if (object.type !== 0 && object.type !== 1) throw new ManagementInputError("Rules of this protection object cannot be listed here.");
        const rules = await aclRules(s, object.object_id, object.type);
        return { message: `${rules.length} ACL rules for the ${objectTypeLabel(object.type)} protection object.`, facts: rules.map(rule => ({ label: `${asString(rule.name, "Unnamed rule")} \u00b7 ${actionLabel(rule.action_type)} \u00b7 ${ruleStateLabel(rule.status)}${rule.direction !== undefined && rule.direction !== null ? ` \u00b7 ${directionLabel(rule.direction)}` : ""}`, value: `${describeAddress(rule.source)} \u2192 ${describeAddress(rule.destination)} \u00b7 ${describeService(rule.service)}` })) };
      }
      if (operation === "create-rule") {
        const object = await ownedObject(s, fwId, String(v.protectionObject));
        if (object.type !== 0 && object.type !== 1) throw new ManagementInputError("NAT border rules are not supported here; manage them in the Huawei console.");
        if (String(v.action) !== "0" && String(v.action) !== "1") throw new ManagementInputError("Select an action.");
        if (!["6", "17", "1", "58", "-1"].includes(String(v.protocol))) throw new ManagementInputError("Select a protocol.");
        const source = ipOrCidr(v.source, "Source address");
        const destination = ipOrCidr(v.destination, "Destination address");
        const sourceFamily = isIP(source.split("/")[0]), destinationFamily = isIP(destination.split("/")[0]);
        if (sourceFamily !== destinationFamily) throw new ManagementInputError("The source and destination must use the same IP version.");
        const addressType = sourceFamily === 6 ? 1 : 0;
        const rule: Record<string, unknown> = { name: v.name, address_type: addressType, action_type: Number(v.action), status: 1, description: v.description ?? "", source: { type: 0, address_type: addressType, address: source }, destination: { type: 0, address_type: addressType, address: destination }, service: { type: 0, protocol: Number(v.protocol), source_port: portRange(v.sourcePort ?? "0", "Source port"), dest_port: portRange(v.destPort ?? "0", "Destination port") } };
        if (object.type === 0) {
          if (v.direction === undefined || v.direction === null || String(v.direction) === "") throw new ManagementInputError("Direction is required for Internet border rules.");
          if (String(v.direction) !== "0" && String(v.direction) !== "1") throw new ManagementInputError("Select a direction.");
          rule.direction = Number(v.direction);
        }
        const result = await write(`/v1/${s.projectId}/acl-rule`, "POST", { object_id: object.object_id, type: object.type, rules: [rule] });
        const created = asArray(asRecord(result.data).rules).map(asRecord);
        if (created.length !== 1 || !asString(created[0].id, "")) throw new Error("Huawei returned no verified ACL rule. Check the protection object's rules before retrying.");
        const ruleId = asString(created[0].id, "");
        if (asString(created[0].name, "") !== v.name) throw new Error("Huawei returned an unverified ACL rule creation. Check the protection object's rules before retrying.");
        if ("object_id" in created[0] && created[0].object_id !== object.object_id) throw new Error("Huawei returned an ACL rule for a different protection object. Check the rules before retrying.");
        const expected = { name: String(v.name), status: 1, action_type: Number(v.action) };
        if (converged((await aclRules(s, object.object_id, object.type)).find(item => asString(item.rule_id, "") === ruleId), expected)) return { message: "ACL rule created and enabled, verified by a fresh native read.", resourceId: resource!.id };
        return { message: "ACL rule creation accepted. Completion waits for a fresh native read to verify the rule.", resourceId: resource!.id, jobId: `${object.object_id}:${ruleId}`, asynchronous: true, verification: verification(expected) };
      }
      if (operation === "rule-status" || operation === "delete-rule") {
        const segments = String(v.rule).split(":");
        const [objectId, ruleId] = segments;
        if (segments.length !== 2 || !objectId || !ruleId) throw new ManagementInputError("Select a current ACL rule.");
        const object = await ownedObject(s, fwId, objectId);
        if (object.type !== 0 && object.type !== 1) throw new ManagementInputError("Rules of this protection object cannot be managed here.");
        const record = (await aclRules(s, object.object_id, object.type)).find(item => asString(item.rule_id, "") === ruleId);
        if (!record) throw new ManagementInputError("The rule no longer belongs to this protection object.", 404);
        if (operation === "delete-rule") {
          const typed = String(v.confirmName ?? "").trim();
          if (!typed) throw new ManagementInputError("Type the rule's current name to confirm deletion.");
          if (asString(record.name, "") !== typed) throw new ManagementInputError("The typed name does not match the rule's current name. Refresh the rules and review the rule before deleting it.");
          const result = await write(`/v1/${s.projectId}/acl-rule/${encodeURIComponent(ruleId)}`, "DELETE");
          if (asString(asRecord(result.data).id, "") !== ruleId) throw new Error("Huawei returned an unverified rule deletion. Check the protection object's rules before retrying.");
          if (!(await aclRules(s, object.object_id, object.type)).some(item => asString(item.rule_id, "") === ruleId)) return { message: "ACL rule deleted, verified by a fresh native read.", resourceId: resource!.id };
          return { message: "ACL rule deletion accepted. Completion waits for a fresh native read to verify the rule is gone.", resourceId: resource!.id, jobId: `${object.object_id}:${ruleId}`, asynchronous: true };
        }
        if (typeof v.enabled !== "boolean") throw new ManagementInputError("Select whether the rule should be enabled.");
        const status = v.enabled ? 1 : 0;
        if (integer(record.status) && record.status === status) return { message: `The rule is already ${status === 1 ? "enabled" : "disabled"}.`, resourceId: resource!.id };
        if (record.type !== object.type || ![0, 1].includes(Number(record.action_type)) || !integer(record.action_type) || ![0, 1].includes(Number(record.address_type)) || !integer(record.address_type)) throw new ManagementInputError("The rule's native match or protection type could not be verified for a safe update.", 409);
        const result = await write(`/v1/${s.projectId}/acl-rule/${encodeURIComponent(ruleId)}`, "PUT", roundtripRule(record, status));
        if (asString(asRecord(result.data).id, "") !== ruleId) throw new Error("Huawei returned an unverified rule update. Check the rule before retrying.");
        if (converged((await aclRules(s, object.object_id, object.type)).find(item => asString(item.rule_id, "") === ruleId), { status })) return { message: `ACL rule ${status === 1 ? "enabled" : "disabled"}, verified by a fresh native read.`, resourceId: resource!.id };
        return { message: `ACL rule ${status === 1 ? "enable" : "disable"} accepted. Completion waits for a fresh native read to verify the state.`, resourceId: resource!.id, jobId: `${object.object_id}:${ruleId}`, asynchronous: true, verification: verification({ status }) };
      }
      if (operation === "protect-eip" || operation === "bypass-eip") {
        const objects = protectObjects(await firewallDetail(s, fwId));
        const result = await write(`/v1/${s.projectId}/eip/protect/all/${encodeURIComponent(fwId)}/operation`, "POST", { bypass_operation: operation === "bypass-eip" ? 1 : 0 });
        if (asString(result.fail_reason, "")) throw new Error("Huawei reported that the EIP protection switch failed. Verify the protection state before retrying.");
        const data = asRecord(result.data);
        const id = asString(data.id, ""), objectId = asString(data.object_id, "");
        if (!id || id !== fwId) throw new Error("Huawei did not verify which firewall's protection changed. Check the protection state before retrying.");
        if (objectId && !objects.some(object => object.object_id === objectId)) throw new Error("Huawei returned a protection object from a different firewall. Check the protection state before retrying.");
        const status = integer(data.protection_status) ? data.protection_status : NaN;
        // No queryable native job exists for this switch: in-progress outcomes are honest accepted results.
        if (operation === "bypass-eip") {
          if (status === 2) return { message: "EIP protection bypassed for every protected EIP of this firewall.", resourceId: resource!.id };
          if (status === 1) return { message: "EIP protection bypass was accepted and is in progress. Huawei exposes no queryable job for this switch; verify the protection state before relying on it.", resourceId: resource!.id, asynchronous: true };
          throw new Error("Huawei did not confirm the EIP protection bypass. Check the protection state before retrying.");
        }
        if (status === 0) return { message: "EIP protection restored for this firewall.", resourceId: resource!.id };
        if (status === 4) return { message: "EIP protection restore was accepted and is in progress. Huawei exposes no queryable job for this switch; verify the protection state before relying on it.", resourceId: resource!.id, asynchronous: true };
        throw new Error("Huawei did not confirm the EIP protection restore. Check the protection state before retrying.");
      }
      if (operation === "protect-vpc" || operation === "bypass-vpc") {
        const vpcObjects = protectObjects(await firewallDetail(s, fwId)).filter(object => object.type === 1);
        if (vpcObjects.length !== 1) throw new ManagementInputError(vpcObjects.length ? "The firewall has multiple VPC border objects; its VPC protection cannot be switched unambiguously here." : "The firewall has no VPC border protection object.", 409);
        const result = await write(`/v1/${s.projectId}/firewall/east-west/protect`, "POST", { object_id: vpcObjects[0].object_id, status: operation === "bypass-vpc" ? 1 : 0 });
        if (asString(asRecord(result.data).id, "") !== vpcObjects[0].object_id) throw new Error("Huawei returned an unverified VPC protection switch. Check the protection state before retrying.");
        return { message: `VPC border protection ${operation === "bypass-vpc" ? "disable" : "enable"} was accepted for the VPC border protection object. Huawei returns no queryable status for this switch; verify east-west filtering before relying on it.`, resourceId: resource!.id, asynchronous: true };
      }
      const object = await ownedObject(s, fwId, String(v.protectionObject));
      if (operation === "create-addr-set") {
        if (String(v.addressType) !== "0" && String(v.addressType) !== "1") throw new ManagementInputError("Select an address type.");
        const result = await write(`/v1/${s.projectId}/address-set`, "POST", { object_id: object.object_id, name: v.name, description: v.description ?? "", address_type: Number(v.addressType) });
        const data = asRecord(result.data);
        if (!asString(data.id, "") || asString(data.name, "") !== v.name) throw new Error("Huawei returned no verified address group. Check address groups before retrying.");
        return { message: "Address group created.", resourceId: `addr:${fwId}:${object.object_id}:${asString(data.id, "")}` };
      }
      if (operation === "create-svc-set") {
        const result = await write(`/v1/${s.projectId}/service-set`, "POST", { object_id: object.object_id, name: v.name, description: v.description ?? "" });
        const data = asRecord(result.data);
        if (!asString(data.id, "") || asString(data.name, "") !== v.name) throw new Error("Huawei returned no verified service group. Check service groups before retrying.");
        return { message: "Service group created.", resourceId: `svc:${fwId}:${object.object_id}:${asString(data.id, "")}` };
      }
    }
    if (["inspect-addr", "addr-items", "add-addr-item", "delete-addr-item", "rename-addr", "delete-addr"].includes(operation)) {
      const { object, setId, set } = await ownedAddressSet(s, resource, operation !== "inspect-addr" && operation !== "addr-items");
      if (operation === "inspect-addr") {
        const items = await addressItems(s, setId);
        return { message: "Current address group state.", facts: [{ label: "Group", value: asString(set.name, "") }, { label: "Description", value: asString(set.description, "None") }, { label: "Address type", value: set.address_type === 1 ? "IPv6" : set.address_type === 0 ? "IPv4" : "Unknown" }, { label: "Rule references", value: integer(set.ref_count) ? String(set.ref_count) : "Unknown" }, { label: "Protection object", value: `${object.object_name || object.object_id} \u00b7 ${objectTypeLabel(object.type)}` }, { label: "Addresses", value: String(items.length) }] };
      }
      if (operation === "addr-items") {
        const items = await addressItems(s, setId);
        return { message: `${items.length} address items in this group.`, facts: items.map(item => ({ label: `${asString(item.address, "Unknown address")} \u00b7 ${item.address_type === 1 ? "IPv6" : item.address_type === 0 ? "IPv4" : "Unknown family"}`, value: asString(item.description, "No description") })) };
      }
      if (operation === "add-addr-item") {
        const address = ipOrCidr(v.address, "Address");
        const addressType = integer(set.address_type) ? set.address_type : NaN;
        if (addressType !== 0 && addressType !== 1) throw new ManagementInputError("The group's address type could not be verified.");
        if (addressType !== (isIP(address.split("/")[0]) === 6 ? 1 : 0)) throw new ManagementInputError(`The address is ${isIP(address.split("/")[0]) === 6 ? "IPv6" : "IPv4"} but the group holds ${addressType === 1 ? "IPv6" : "IPv4"} addresses.`);
        const result = await write(`/v1/${s.projectId}/address-items`, "POST", { set_id: setId, address_items: [{ address_type: addressType, address, description: v.description ?? "" }] });
        const data = asRecord(result.data);
        const items = asArray(data.items).map(asRecord);
        if (items.length !== 1 || !asString(items[0].id, "")) throw new Error("Huawei returned no verified address item. Check the group's addresses before retrying.");
        const wrongParent = [data, items[0]].some(row => "set_id" in row && row.set_id !== setId);
        if (wrongParent) throw new Error("Huawei returned an address item for a different group. Check the group's addresses before retrying.");
        return { message: "Address added to the group.", resourceId: resource!.id };
      }
      if (operation === "delete-addr-item") {
        if (!(await addressItems(s, setId)).some(item => asString(item.item_id, "") === String(v.item))) throw new ManagementInputError("The address item no longer belongs to this group.", 404);
        const result = await write(`/v1/${s.projectId}/address-items/${encodeURIComponent(String(v.item))}`, "DELETE");
        if (asString(asRecord(result.data).id, "") !== String(v.item)) throw new Error("Huawei returned an unverified address deletion. Check the group's addresses before retrying.");
        return { message: "Address removed from the group.", resourceId: resource!.id };
      }
      if (operation === "rename-addr") {
        const result = await write(`/v1/${s.projectId}/address-sets/${encodeURIComponent(setId)}`, "PUT", { name: v.name, description: v.description ?? "" });
        const data = asRecord(result.data);
        if (asString(data.id, "") !== setId || asString(data.name, "") !== v.name) throw new Error("Huawei returned an unverified address group update. Check address groups before retrying.");
        return { message: "Address group renamed.", resourceId: resource!.id };
      }
      if (asString(set.name, "") !== resource!.name) throw new ManagementInputError("The address group was renamed since selection. Refresh the list and delete again.");
      const refCount = set.ref_count;
      if (!integer(refCount) || refCount !== 0) throw new ManagementInputError("The group's rule references could not be verified as zero. Remove rule references before deleting it.", 409);
      const proof = await referencedByAclRule(s, object, setId, "address");
      if (proof.used) throw new ManagementInputError("A fresh ACL rule check still references this address group. Remove the rule references before deleting it.", 409);
      const result = await write(`/v1/${s.projectId}/address-sets/${encodeURIComponent(setId)}`, "DELETE");
      if (asString(asRecord(result.data).id, "") !== setId) throw new Error("Huawei returned an unverified address group deletion. Check address groups before retrying.");
      return { message: "Unreferenced address group deleted.", resourceId: resource!.id };
    }
    if (["inspect-svc", "svc-items", "add-svc-item", "delete-svc-item", "rename-svc", "delete-svc"].includes(operation)) {
      const { object, setId, set } = await ownedServiceSet(s, resource, operation !== "inspect-svc" && operation !== "svc-items");
      if (operation === "inspect-svc") {
        const items = await serviceItems(s, setId);
        return { message: "Current service group state.", facts: [{ label: "Group", value: asString(set.name, "") }, { label: "Description", value: asString(set.description, "None") }, { label: "Rule references", value: integer(set.ref_count) ? String(set.ref_count) : "Unknown" }, { label: "Protocols", value: asArray(set.protocols).map(protocolLabel).join(", ") || "None" }, { label: "Protection object", value: `${object.object_name || object.object_id} \u00b7 ${objectTypeLabel(object.type)}` }, { label: "Services", value: String(items.length) }] };
      }
      if (operation === "svc-items") {
        const items = await serviceItems(s, setId);
        return { message: `${items.length} service items in this group.`, facts: items.map(item => ({ label: `${protocolLabel(item.protocol)} ${portText(item.source_port)}\u2192${portText(item.dest_port)}`, value: asString(item.description, "No description") })) };
      }
      if (operation === "add-svc-item") {
        if (!["6", "17", "1", "58", "-1"].includes(String(v.protocol))) throw new ManagementInputError("Select a protocol.");
        const result = await write(`/v1/${s.projectId}/service-items`, "POST", { set_id: setId, service_items: [{ protocol: Number(v.protocol), source_port: portRange(v.sourcePort ?? "0", "Source port"), dest_port: portRange(v.destPort ?? "0", "Destination port"), description: v.description ?? "" }] });
        const data = asRecord(result.data);
        const items = asArray(data.items).map(asRecord);
        if (items.length !== 1 || !asString(items[0].id, "")) throw new Error("Huawei returned no verified service item. Check the group's services before retrying.");
        const wrongParent = [data, items[0]].some(row => "set_id" in row && row.set_id !== setId);
        if (wrongParent) throw new Error("Huawei returned a service item for a different group. Check the group's services before retrying.");
        return { message: "Service added to the group.", resourceId: resource!.id };
      }
      if (operation === "delete-svc-item") {
        if (!(await serviceItems(s, setId)).some(item => asString(item.item_id, "") === String(v.item))) throw new ManagementInputError("The service item no longer belongs to this group.", 404);
        const result = await write(`/v1/${s.projectId}/service-items/${encodeURIComponent(String(v.item))}`, "DELETE");
        if (asString(asRecord(result.data).id, "") !== String(v.item)) throw new Error("Huawei returned an unverified service deletion. Check the group's services before retrying.");
        return { message: "Service removed from the group.", resourceId: resource!.id };
      }
      if (operation === "rename-svc") {
        const result = await write(`/v1/${s.projectId}/service-sets/${encodeURIComponent(setId)}`, "PUT", { name: v.name, description: v.description ?? "" });
        const data = asRecord(result.data);
        if (asString(data.id, "") !== setId || asString(data.name, "") !== v.name) throw new Error("Huawei returned an unverified service group update. Check service groups before retrying.");
        return { message: "Service group renamed.", resourceId: resource!.id };
      }
      if (asString(set.name, "") !== resource!.name) throw new ManagementInputError("The service group was renamed since selection. Refresh the list and delete again.");
      const refCount = set.ref_count;
      if (!integer(refCount) || refCount !== 0) throw new ManagementInputError("The group's rule references could not be verified as zero. Remove rule references before deleting it.", 409);
      const proof = await referencedByAclRule(s, object, setId, "service");
      if (proof.used) throw new ManagementInputError("A fresh ACL rule check still references this service group. Remove the rule references before deleting it.", 409);
      const result = await write(`/v1/${s.projectId}/service-sets/${encodeURIComponent(setId)}`, "DELETE");
      if (asString(asRecord(result.data).id, "") !== setId) throw new Error("Huawei returned an unverified service group deletion. Check service groups before retrying.");
      return { message: "Unreferenced service group deleted.", resourceId: resource!.id };
    }
    throw new ManagementInputError("Unsupported Cloud Firewall operation for this resource.");
  },
  poll: async (s, entry) => {
    const label = entry.operation;
    if (label === createLabel || label === deleteLabel) {
      if (!entry.jobId || typeof entry.jobId !== "string") throw new ManagementInputError("No verified native cloud firewall job ID is stored.");
      const job = asRecord((await huaweiFetch<Record<string, unknown>>(s, "cfw", `/v3/${s.projectId}/jobs/${encodeURIComponent(entry.jobId)}`)).data);
      if (asString(job.id, "") !== entry.jobId) throw new Error("Huawei returned a different cloud firewall job. Verify the firewall state before retrying.");
      const status = asString(job.status, "");
      if (status === "Running") return { state: "submitted", message: "The cloud firewall job is running." };
      if (status === "Failed") return { state: "failed", message: "The cloud firewall job failed. Review the firewall state in Huawei before retrying." };
      if (status !== "Success") return { state: "submitted", message: "The cloud firewall job has not reported a verified completion state." };
      if (label === deleteLabel) {
        if (!entry.resourceId?.startsWith("fw:")) throw new ManagementInputError("No verified firewall resource is stored for this deletion.");
        const present = (await firewalls(s)).records.some(record => asString(record.fw_instance_id, "") === entry.resourceId!.slice(3));
        return present ? { state: "submitted", message: "The firewall is still being released." } : { state: "succeeded", message: "The pay-per-use cloud firewall was deleted." };
      }
      return { state: "succeeded", message: "The native cloud firewall creation job succeeded. Refresh the inventory to locate the new firewall; Huawei does not return its resource ID in this job." };
    }
    if (label === addRuleLabel || label === ruleStatusLabel || label === deleteRuleLabel) {
      // The observer identity retains the original protection object and rule IDs; it is not a native job.
      const segments = String(entry.jobId ?? "").split(":");
      if (!entry.resourceId?.startsWith("fw:") || segments.length !== 2 || segments.some(segment => !segment)) throw new ManagementInputError("The ACL rule progress check is missing its original firewall or rule identity.");
      const [objectId, ruleId] = segments;
      const allowed = label === addRuleLabel ? ["action_type", "name", "status"] : label === ruleStatusLabel ? ["status"] : [];
      if (allowed.length) {
        const check = entry.verification;
        if (!check || !Array.isArray(check.fields) || check.fields.length !== allowed.length || check.fields.some(field => !allowed.includes(field)) || new Set(check.fields).size !== check.fields.length || !/^[a-f0-9]{64}$/.test(check.digest)) throw new ManagementInputError("The ACL rule verification observer is missing or invalid.");
      }
      const fwId = entry.resourceId.slice(3);
      await ownedFirewall(s, fwId, false);
      const object = protectObjects(await firewallDetail(s, fwId)).find(item => item.object_id === objectId);
      if (!object) throw new ManagementInputError("The protection object no longer belongs to this firewall.", 404);
      if (object.type !== 0 && object.type !== 1) throw new ManagementInputError("Rules of this protection object cannot be verified here.");
      const fresh = (await aclRules(s, object.object_id, object.type)).find(item => asString(item.rule_id, "") === ruleId);
      if (label === deleteRuleLabel) {
        return fresh
          ? { state: "submitted", message: "The ACL rule is still present in a fresh native read." }
          : { state: "succeeded", message: "A fresh native read verifies the ACL rule is deleted.", resourceId: entry.resourceId };
      }
      if (!fresh) return { state: "submitted", message: "The ACL rule is not yet visible in a fresh native read; this does not establish the result." };
      const check = entry.verification!;
      const actual: Record<string, unknown> = {};
      for (const field of check.fields) actual[field] = field === "name" ? asString(fresh[field], "") : fresh[field];
      const typesKnown = check.fields.every(field => field === "name" ? typeof actual[field] === "string" && !!(actual[field] as string) : integer(actual[field]));
      if (typesKnown && verification(actual).digest === check.digest) return { state: "succeeded", message: "A fresh native read verifies the requested ACL rule state.", resourceId: entry.resourceId };
      return { state: "submitted", message: "The requested ACL rule state is not yet verified by a fresh native read." };
    }
    throw new ManagementInputError("Only cloud firewall creation, deletion, and ACL rule verification support this progress check.");
  },
  invalidationKeys: () => [cloudCacheKeys.listCloudFirewalls, cloudCacheKeys.summary],
};
