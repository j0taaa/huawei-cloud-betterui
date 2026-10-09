import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { HuaweiApiError, huaweiFetch as nativeFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString, formatBytes, numberWithUnit } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import { preserveFunctionGraphConfiguration } from "@/lib/huawei/functiongraph/configuration";
import type { ManagementAdapter } from "../types";

// Inline text is supported by these documented Python, Node.js, and PHP runtimes.
const runtimes = ["Python3.9", "Python3.10", "Python3.12", "Node.js16.17", "Node.js18.15", "Node.js20.15", "PHP7.3", "PHP8.3"];
const memorySizes = [128, 256, 512, 768, 1024, 1280, 1536, 1792, 2048, 2560, 3072, 3584, 4096];
const inlineCodeBytes = 40960;
const handlerFreeRuntimes = ["http", "Custom Image"];
const functionPrefixes = ["function:"];
const namePattern = "^[A-Za-z][A-Za-z0-9_-]{0,59}$";
const versionPattern = "^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,40}[A-Za-z0-9])?$";
const aliasPattern = "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$";
const timerPattern = "^[A-Za-z][A-Za-z0-9_-]{0,63}$";

const nameField: ManagementField = { key: "name", label: "Function name", required: true, min: 1, max: 60, pattern: namePattern, help: "1-60 letters, digits, underscores, or hyphens, starting with a letter." };
const packageField: ManagementField = { key: "package", label: "App (package)", required: true, min: 1, max: 60, pattern: namePattern, defaultValue: "default", help: "Groups related functions. Keep default unless you organize functions into apps." };
const runtimeField: ManagementField = { key: "runtime", label: "Runtime", type: "select", required: true, choices: runtimes.map((value) => ({ value, label: value })) };
const handlerField: ManagementField = { key: "handler", label: "Handler", max: 128, help: "Entry point in file.function form, for example index.handler. HTTP and custom image functions do not need one." };
const memoryField: ManagementField = { key: "memorySize", label: "Memory", type: "select", required: true, defaultValue: "128", choices: memorySizes.map((size) => ({ value: String(size), label: `${size} MB` })) };
const timeoutField: ManagementField = { key: "timeout", label: "Timeout (seconds)", type: "number", required: true, min: 3, max: 259200, defaultValue: 3 };
const codeField: ManagementField = { key: "code", label: "Inline code", type: "textarea", required: true, maxBytes: inlineCodeBytes, help: `Plain-text source up to ${inlineCodeBytes / 1024} KB, sent base64-encoded. Larger packages belong in the function workspace editor.` };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 512, allowEmpty: true };
const enterpriseProjectField: ManagementField = { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" };
const versionNameField: ManagementField = { key: "version", label: "Version name", required: true, min: 1, max: 42, pattern: versionPattern, help: "Up to 42 letters, digits, underscores, dots, and hyphens, starting and ending with a letter or digit." };
const versionSelectField: ManagementField = { key: "version", label: "Published version", type: "select", source: "versions", required: true };
const aliasNameField: ManagementField = { key: "name", label: "Alias name", required: true, min: 1, max: 64, pattern: aliasPattern };
const aliasSelectField: ManagementField = { key: "alias", label: "Version alias", type: "select", source: "aliases", required: true };
const maxInstancesField: ManagementField = { key: "maxInstances", label: "Maximum instances", type: "number", required: true, min: -1, max: 1000, help: "-1 removes the limit and 0 disables execution; otherwise the concurrent instance cap (0-1000)." };
const timerNameField: ManagementField = { key: "name", label: "Timer name", required: true, min: 1, max: 64, pattern: timerPattern };
const scheduleTypeField: ManagementField = { key: "scheduleType", label: "Schedule type", type: "select", required: true, choices: [{ value: "Rate", label: "Rate (fixed interval)" }, { value: "Cron", label: "Cron expression" }] };
const scheduleField: ManagementField = { key: "schedule", label: "Schedule", required: true, max: 64, help: "Rate: 1-60 minutes, 1-24 hours, or 1-30 days as 5m, 3h, or 1d. Cron: seconds minutes hours day-of-month month [day-of-week], for example 0 0 1 * * *. Optional CRON_TZ=Asia/Shanghai selects a time zone." };
const userEventField: ManagementField = { key: "userEvent", label: "Attached event data", type: "textarea", maxBytes: 2048, help: "Optional text delivered to the function as user_event on every timer firing. It is never shown in results or history." };
const timerStatusField: ManagementField = { key: "timerStatus", label: "Timer status", type: "select", required: true, defaultValue: "DISABLED", choices: [{ value: "ACTIVE", label: "Active" }, { value: "DISABLED", label: "Disabled" }] };

async function huaweiFetch<T>(s: BetterUiSession, service: "fg", path: string, init?: RequestInit): Promise<T> {
  try {
    const body = await nativeFetch<T>(s, service, path, init), row = asRecord(body);
    if (row.error_code || row.error) throw new HuaweiApiError("Huawei rejected this FunctionGraph request.", 502);
    return body;
  } catch (error) { if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected this FunctionGraph request.", error.status); throw new Error("Huawei returned an unverifiable FunctionGraph response. Check current state before retrying."); }
}
async function huaweiList<T>(s: BetterUiSession, service: "fg", path: string, pagination: Pagination): Promise<T> {
  return collectList(cursor => { const url = new URL(path, "https://local.invalid"); if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor)); return huaweiFetch<T>(s, service, url.pathname + url.search); }, pagination);
}

type Verified = { urn: string; baseUrn: string; name: string };

function str(values: Record<string, unknown>, key: string) {
  const value = values[key];
  if (typeof value === "string") return value;
  return value === undefined || value === null ? "" : String(value);
}

function urnInfo(urn: string, s: BetterUiSession): { baseUrn: string; name: string } | null {
  const parts = urn.split(":");
  if (parts.length < 7 || parts.length > 8 || parts[0] !== "urn" || parts[1] !== "fss" || parts[4] !== "function" || !parts[2] || !parts[3] || !parts[5] || !parts[6] || (parts.length === 8 && !parts[7])) return null;
  if ((parts[2] !== s.region && parts[2] !== s.projectName) || parts[3] !== s.projectId) return null;
  if (!new RegExp(namePattern).test(parts[5]) || !new RegExp(namePattern).test(parts[6]) || (parts[7] && !/^[A-Za-z0-9_.-]+$/.test(parts[7]))) return null;
  return { baseUrn: parts.slice(0, 7).join(":"), name: parts[6] };
}

function verifiedUrn(urn: string, s: BetterUiSession): Verified {
  const info = urnInfo(urn, s);
  if (info) return { urn, ...info };
  const parts = urn.split(":");
  if (parts.length >= 7 && parts[0] === "urn" && parts[1] === "fss" && parts[4] === "function" && parts[2] && parts[2] !== s.region && parts[2] !== s.projectName) throw new ManagementInputError("The function belongs to a different region than the selected project.", 409);
  throw new ManagementInputError("Huawei returned an unverified FunctionGraph URN for this operation.", 409);
}

/** Pre-write reads must fail as rejected requests, never as uncertain accepted writes. */
async function guarded<T>(load: () => Promise<T>): Promise<T> {
  try { return await load(); } catch (error) {
    if (error instanceof HuaweiApiError || error instanceof ManagementInputError) throw error;
    throw new ManagementInputError(error instanceof Error ? error.message : "Huawei returned an invalid FunctionGraph response.", 409);
  }
}

async function listRows(s: BetterUiSession) {
  const body = await guarded(() => huaweiList<Record<string, unknown>>(s, "fg", `/v2/${s.projectId}/fgs/functions?maxitems=400`, { items: ["functions"], kind: "marker", parameter: "marker", size: 400, next: ["next_marker"], total: ["count"] }));
  const rows = asArray(body.functions).map(asRecord), urns = rows.map(row => firstString([row.func_urn], ""));
  if (new Set(urns).size !== urns.length || rows.some(row => { const info = urnInfo(firstString([row.func_urn], ""), s); return !info || info.name !== row.func_name; })) throw new ManagementInputError("Huawei returned an unverified FunctionGraph inventory.", 409);
  return rows;
}

async function current(s: BetterUiSession, resource?: ManagementResource): Promise<Verified> {
  const urn = resource?.id.startsWith("function:") ? resource.id.slice("function:".length) : "";
  if (!urn) throw new ManagementInputError("Select a FunctionGraph function.");
  const row = (await listRows(s)).find((item) => item.func_urn === urn);
  if (!row) throw new ManagementInputError("The function no longer exists in this project.", 404);
  const verified = verifiedUrn(urn, s);
  if (verified.name !== row.func_name) throw new ManagementInputError("Huawei returned a different function's identity.", 409);
  return verified;
}

async function rawConfig(s: BetterUiSession, verified: Verified) {
  const config = await guarded(() => huaweiFetch<Record<string, unknown>>(s, "fg", `/v2/${s.projectId}/fgs/functions/${encodeURI(verified.urn)}/config`));
  const info = urnInfo(firstString([config.func_urn], ""), s);
  if (!info || info.baseUrn !== verified.baseUrn) throw new ManagementInputError("Huawei returned a different function's configuration.", 409);
  if ((String(config.func_urn).split(":")[7] ?? "latest") !== (verified.urn.split(":")[7] ?? "latest")) throw new ManagementInputError("Huawei returned a different function version's configuration.", 409);
  return config;
}

async function versionRows(s: BetterUiSession, verified: Verified) {
  const body = await guarded(() => huaweiList<Record<string, unknown>>(s, "fg", `/v2/${s.projectId}/fgs/functions/${encodeURI(verified.urn)}/versions?maxitems=400`, { items: ["versions"], kind: "marker", parameter: "marker", size: 400, next: ["next_marker"], total: ["count"] }));
  const rows = asArray(body.versions).map(asRecord);
  const names = rows.map(row => firstString([row.version], ""));
  if (new Set(names).size !== names.length) throw new ManagementInputError("Huawei returned duplicate function versions.", 409);
  for (const row of rows) {
    const urn = firstString([row.func_urn], ""), info = urnInfo(urn, s);
    if (!info || info.baseUrn !== verified.baseUrn || !row.version || urn.split(":")[7] !== row.version) throw new ManagementInputError("Huawei returned a version that does not belong to this function.", 409);
  }
  return rows;
}

async function aliasRows(s: BetterUiSession, verified: Verified) {
  const body = await guarded(() => huaweiFetch<unknown>(s, "fg", `/v2/${s.projectId}/fgs/functions/${encodeURI(verified.urn)}/aliases`));
  const record = asRecord(body);
  const list = Array.isArray(body) ? body : Array.isArray(record.body) ? record.body : Array.isArray(record.aliases) ? record.aliases : null;
  if (!list) throw new ManagementInputError("Huawei returned an invalid FunctionGraph alias list.", 409);
  const rows = list.map(asRecord);
  const names = rows.map(row => firstString([row.name], ""));
  if (new Set(names).size !== names.length) throw new ManagementInputError("Huawei returned duplicate function aliases.", 409);
  for (const row of rows) {
    const urn = firstString([row.alias_urn], ""), info = urnInfo(urn, s);
    if (!info || info.baseUrn !== verified.baseUrn || !row.name || !row.version || urn.split(":")[7] !== row.name) throw new ManagementInputError("Huawei returned an alias that does not belong to this function.", 409);
    if (row.additional_version_weights != null && (typeof row.additional_version_weights !== "object" || Array.isArray(row.additional_version_weights))) throw new ManagementInputError("Huawei returned unverified alias traffic weights.", 409);
  }
  return rows;
}

async function triggerRows(s: BetterUiSession, verified: Verified) {
  const body = await guarded(() => huaweiFetch<unknown>(s, "fg", `/v2/${s.projectId}/fgs/triggers/${encodeURI(verified.urn)}`));
  const record = asRecord(body);
  const list = Array.isArray(body) ? body : Array.isArray(record.body) ? record.body : Array.isArray(record.triggers) ? record.triggers : null;
  if (!list) throw new ManagementInputError("Huawei returned an invalid FunctionGraph trigger list.", 409);
  const rows = list.map(asRecord), ids = rows.map(row => firstString([row.trigger_id], ""));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || rows.some(row => !firstString([row.trigger_type_code], "") || !["ACTIVE", "DISABLED"].includes(firstString([row.trigger_status], "")) || (row.func_urn !== undefined && row.func_urn !== verified.urn))) throw new ManagementInputError("Huawei returned unverified function triggers.", 409);
  return rows;
}

async function reservedCapacity(s: BetterUiSession, verified: Verified) {
  const body = await guarded(() => huaweiList<Record<string, unknown>>(s, "fg", `/v2/${s.projectId}/fgs/functions/reservedinstances?limit=100`, { items: ["reservedinstances"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker"], total: ["count"] }));
  const rows = asArray(body.reservedinstances).map(asRecord);
  const count = Number(body.count);
  if (Number.isFinite(count) && count >= 0 && rows.length < count) throw new ManagementInputError("Huawei returned an incomplete reserved instance list; the deletion was not sent.", 409);
  const urns = rows.map(row => firstString([row.func_urn], ""));
  if (new Set(urns).size !== urns.length || rows.some(row => !urnInfo(firstString([row.func_urn], ""), s) || !Number.isSafeInteger(row.count) || Number(row.count) < 0)) throw new ManagementInputError("Huawei returned unverified reserved capacity; deletion was not sent.", 409);
  return rows.filter(row => urnInfo(firstString([row.func_urn], ""), s)?.baseUrn === verified.baseUrn).reduce((sum, row) => sum + Number(row.count), 0);
}

function timerSchedule(scheduleType: string, schedule: string) {
  if (scheduleType === "Rate") {
    const match = schedule.match(/^(\d{1,3})([mhd])$/);
    const bounds: Record<string, number> = { m: 60, h: 24, d: 30 };
    if (!match || !bounds[match[2]] || Number(match[1]) < 1 || Number(match[1]) > bounds[match[2]]) throw new ManagementInputError("Rate schedules are 1-60 minutes (m), 1-24 hours (h), or 1-30 days (d), for example 5m.");
    return;
  }
  if (scheduleType === "Cron") {
    const fields = schedule.trim().split(/\s+/);
    const invalid = () => new ManagementInputError("Enter a cron expression as seconds minutes hours day-of-month month [day-of-week], for example 0 0 1 * * *. Use valid ranges and an optional CRON_TZ time zone.");
    if (fields[0]?.startsWith("CRON_TZ=")) {
      const zone = fields.shift()!.slice(8);
      try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); } catch { throw invalid(); }
      if (!zone) throw invalid();
    }
    if (![5, 6].includes(fields.length)) throw invalid();
    const bounds = [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
    const monthNames = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
    const dayNames = "SUN MON TUE WED THU FRI SAT".split(" ");
    for (let index = 0; index < fields.length; index++) {
      const [min, max] = bounds[index];
      const number = (text: string) => /^\d+$/.test(text) ? Number(text) : index === 4 && monthNames.includes(text.toUpperCase()) ? monthNames.indexOf(text.toUpperCase()) + 1 : index === 5 && dayNames.includes(text.toUpperCase()) ? dayNames.indexOf(text.toUpperCase()) : NaN;
      for (const piece of fields[index].split(",")) {
        if (piece === "?" && [3, 5].includes(index)) continue;
        const parts = piece.split("/"), range = parts[0];
        if (parts.length > 2 || (parts.length === 2 && (!/^\d+$/.test(parts[1]) || Number(parts[1]) < 1 || Number(parts[1]) > max))) throw invalid();
        if (range === "*") continue;
        const values = range.split("-").map(number);
        if (!values.length || values.length > 2 || values.some(value => !Number.isSafeInteger(value) || value < min || value > max) || (values.length === 2 && values[0] > values[1])) throw invalid();
      }
    }
    if (fields[3] === "?" && fields[5] === "?") throw invalid();
    return;
  }
  throw new ManagementInputError("Select a schedule type.");
}

const operations: ManagementOperation[] = [
  { id: "create", label: "Create function", kind: "create", description: "Create one pay-per-use function with inline text code in this project. Code editing, dependencies, and zip packages remain in the function workspace.", impact: "FunctionGraph bills per request and per GB-second once the function runs, and reserved capacity bills while configured. This request creates the function and never invokes it.", fields: [nameField, packageField, runtimeField, handlerField, memoryField, timeoutField, codeField, descriptionField, enterpriseProjectField] },
  { id: "inspect", label: "View function configuration", kind: "inspect", description: "Show the current native configuration from a whitelist of non-private fields. Code, environment values, encrypted data, and code or image locations are never displayed.", fields: [], resourcePrefixes: functionPrefixes },
  { id: "update", label: "Edit description, timeout, and memory", kind: "update", description: "Change the description, timeout, or memory. Every other native setting is read back and re-sent unchanged; the update is refused when private settings cannot be preserved.", fields: [descriptionField, timeoutField, memoryField], resourcePrefixes: functionPrefixes, impact: "Timeout and memory change execution limits and per-invocation billing. All other settings are preserved from the read-back configuration." },
  { id: "versions", label: "View published versions", kind: "inspect", description: "List the function's published versions. Published versions retain their code snapshot and can be deleted individually.", fields: [], resourcePrefixes: functionPrefixes },
  { id: "publish-version", label: "Publish version", kind: "action", description: "Publish the function's current code and configuration as a new immutable version.", fields: [versionNameField, descriptionField], resourcePrefixes: functionPrefixes, impact: "The published version snapshots the current code and configuration and can be targeted by aliases and triggers." },
  { id: "delete-version", label: "Delete published version", kind: "action", description: "Delete one current published version by its original qualified URN. The latest version cannot be deleted. Remove its aliases, triggers, and reserved instances first.", fields: [versionSelectField], resourcePrefixes: functionPrefixes, confirmation: true, impact: "The selected version's code and configuration are permanently removed and calls to that version fail. The function and its other versions remain available." },
  { id: "aliases", label: "View version aliases", kind: "inspect", description: "List the function's version aliases and the version each one routes to.", fields: [], resourcePrefixes: functionPrefixes },
  { id: "create-alias", label: "Create version alias", kind: "action", description: "Point a new alias at a version published by this function.", fields: [aliasNameField, versionSelectField, descriptionField], resourcePrefixes: functionPrefixes, impact: "Aliases route traffic by name; anything invoking this alias starts executing the selected version." },
  { id: "update-alias", label: "Retarget version alias", kind: "action", description: "Move an existing alias of this function to another version it published.", fields: [aliasSelectField, versionSelectField, descriptionField], resourcePrefixes: functionPrefixes, confirmation: true, impact: "Invocations through the alias immediately start executing the new version." },
  { id: "delete-alias", label: "Delete version alias", kind: "action", description: "Remove one alias of this function. Callers using the alias lose their route.", fields: [aliasSelectField], resourcePrefixes: functionPrefixes, confirmation: true, impact: "Invocations addressed to the alias stop routing and fail. The versions themselves are untouched." },
  { id: "max-instances", label: "Set maximum instances", kind: "update", description: "Cap the function's concurrent instances, disable execution, or remove the cap.", fields: [maxInstancesField], resourcePrefixes: functionPrefixes, confirmation: true, impact: "0 disables execution entirely, -1 removes the limit, and positive values throttle invocations beyond the cap. Throttled requests are rejected while reserved capacity keeps billing." },
  { id: "create-timer", label: "Create timer trigger", kind: "action", description: "Add a TIMER trigger that invokes this function on a fixed interval or cron schedule.", fields: [timerNameField, scheduleTypeField, scheduleField, userEventField, timerStatusField], resourcePrefixes: functionPrefixes, confirmation: true, impact: "An active timer invokes the function automatically, generating real executions, side effects, and charges. Creating the trigger does not run the function immediately." },
  { id: "delete", label: "Delete function", kind: "delete", description: "Permanently delete the whole function and every published version. The deletion is refused while triggers, aliases, or reserved capacity still exist.", fields: [], resourcePrefixes: functionPrefixes, confirmation: true, impact: "The function, its code, configuration, and all published versions are permanently removed. Existing triggers, aliases, and reserved capacity must be removed first." },
];

export const functionGraphManagement: ManagementAdapter = {
  title: "FunctionGraph Functions",
  operations,
  inventory: async (s) => (await listRows(s)).map((row) => ({
    id: `function:${row.func_urn}`,
    name: String(row.func_name),
    values: { runtime: firstString([row.runtime], ""), package: firstString([row.package], ""), memorySize: Number(row.memory_size) || 0, timeout: Number(row.timeout) || 0, codeType: firstString([row.code_type], ""), version: firstString([row.version], "") },
  })),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (!resource || !["create-alias", "update-alias", "delete-alias", "delete-version"].includes(operation)) return {};
    const verified = await current(s, resource);
    const aliases = () => aliasRows(s, verified).then((rows) => rows.map((row) => ({ value: firstString([row.name], ""), label: `${firstString([row.name], "-")} → ${firstString([row.version], "-")}` })).filter((choice) => choice.value));
    if (operation === "delete-alias") return { aliases: await aliases() };
    const versions = (await versionRows(s, verified)).filter(row => row.version !== "latest").map((row) => ({ value: firstString([row.version], ""), label: firstString([row.version], "-") })).filter((choice) => choice.value);
    if (operation === "delete-version") return { versions };
    if (operation === "create-alias") return { versions };
    return { versions, aliases: await aliases() };
  },
  invalidationKeys: (resource) => {
    const urn = resource?.id.startsWith("function:") ? resource.id.slice("function:".length) : "";
    return [cloudCacheKeys.listFunctionGraphFunctions, cloudCacheKeys.functionGraphTriggers, cloudCacheKeys.summary, ...(urn ? [cloudCacheKeys.functionGraph(urn), cloudCacheKeys.functionGraphCode(urn)] : [])];
  },
  execute: async (s, operation, values, resource) => {
    const functionsPath = `/v2/${s.projectId}/fgs/functions`;
    if (operation === "create") {
      const name = str(values, "name");
      if (!new RegExp(namePattern).test(name)) throw new ManagementInputError("Function names are 1-60 letters, digits, underscores, or hyphens and start with a letter.");
      const packageName = str(values, "package") || "default";
      if (!new RegExp(namePattern).test(packageName)) throw new ManagementInputError("App names are 1-60 letters, digits, underscores, or hyphens and start with a letter.");
      const runtime = str(values, "runtime");
      if (!runtimes.includes(runtime)) throw new ManagementInputError("Select a supported runtime.");
      const memorySize = Number(values.memorySize);
      if (!memorySizes.includes(memorySize)) throw new ManagementInputError("Select a supported memory size.");
      const timeout = Number(values.timeout);
      if (!Number.isSafeInteger(timeout) || timeout < 3 || timeout > 259200) throw new ManagementInputError("Timeout must be a whole number of 3-259200 seconds.");
      const handler = str(values, "handler").trim();
      const needsHandler = !handlerFreeRuntimes.includes(runtime);
      if (needsHandler && !handler) throw new ManagementInputError("Enter the function's handler entry point.");
      if (needsHandler && runtime !== "Custom" && !handler.includes(".")) throw new ManagementInputError("The handler must be in file.function form, for example index.handler.");
      const code = str(values, "code");
      if (!code) throw new ManagementInputError("Enter the function's inline code.");
      if (Buffer.byteLength(code, "utf8") > inlineCodeBytes) throw new ManagementInputError("Inline code exceeds the 40 KB limit. Larger code belongs in the function workspace editor.");
      if ((await listRows(s)).some((row) => row.func_name === name)) throw new ManagementInputError("A function with this name already exists in this project.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(s, "fg", functionsPath, { method: "POST", body: JSON.stringify({
        func_name: name, package: packageName, runtime, timeout, memory_size: memorySize,
        code_type: "inline", func_code: { file: Buffer.from(code, "utf8").toString("base64"), link: "" },
        description: str(values, "description"), type: "v2", enterprise_project_id: str(values, "enterpriseProjectId") || "0",
        ...(needsHandler ? { handler } : {}),
      }) });
      const createdUrn = firstString([response.func_urn], "");
      const info = urnInfo(createdUrn, s);
      if (!info || info.name !== name || createdUrn.split(":")[5] !== packageName) throw new Error("Huawei returned no verifiable identity for the created function.");
      return { message: "Function created with inline code. This request does not invoke it; run it from the function workspace or with a trigger.", resourceId: `function:${createdUrn}` };
    }
    const verified = await current(s, resource);
    const urnPath = `${functionsPath}/${encodeURI(verified.urn)}`;
    if (operation === "inspect") {
      const config = await rawConfig(s, verified);
      const strategy = asRecord(config.strategy_config);
      return { message: "Current FunctionGraph configuration.", facts: [
        { label: "Name", value: firstString([config.func_name], verified.name) },
        { label: "App (package)", value: firstString([config.package], "-") },
        { label: "Runtime", value: firstString([config.runtime], "-") },
        { label: "Handler", value: firstString([config.handler], "-") },
        { label: "Memory", value: `${Number(config.memory_size) || 0} MB` },
        { label: "Timeout", value: `${Number(config.timeout) || 0} s` },
        { label: "Code type", value: firstString([config.code_type], "-") },
        { label: "Code size", value: formatBytes(config.code_size) },
        { label: "Description", value: firstString([config.description], "") || "No description" },
        { label: "Version", value: firstString([config.version], "-") },
        { label: "Function type", value: firstString([config.type], "-") },
        { label: "Ephemeral storage", value: numberWithUnit(config.ephemeral_storage, "MB") },
        { label: "Initializer", value: firstString([config.initializer_handler], "-") },
        { label: "Initializer timeout", value: numberWithUnit(config.initializer_timeout, "s") },
        { label: "Pre-stop handler", value: firstString([config.pre_stop_handler], "-") },
        { label: "Concurrency", value: strategy.concurrency !== undefined ? String(strategy.concurrency) : "-" },
        { label: "Network", value: Object.keys(asRecord(config.func_vpc)).length ? "VPC attached" : "No VPC" },
        { label: "Mounts", value: Object.keys(asRecord(config.mount_config)).length ? "Attached" : "None" },
        { label: "LTS log", value: config.enable_lts_log === true ? "Enabled" : "Not enabled" },
        { label: "Enterprise project", value: firstString([config.enterprise_project_id], "-") },
        { label: "Last modified", value: firstString([config.last_modified], "-") },
      ] };
    }
    if (operation === "update") {
      const timeout = Number(values.timeout);
      if (!Number.isSafeInteger(timeout) || timeout < 3 || timeout > 259200) throw new ManagementInputError("Timeout must be a whole number of 3-259200 seconds.");
      const memorySize = Number(values.memorySize);
      if (!memorySizes.includes(memorySize)) throw new ManagementInputError("Select a supported memory size.");
      const config = await rawConfig(s, verified);
      const body = preserveFunctionGraphConfiguration(config, { description: str(values, "description"), timeout, memory_size: memorySize });
      const response = await huaweiFetch<Record<string, unknown>>(s, "fg", `${urnPath}/config`, { method: "PUT", body: JSON.stringify(body) });
      const info = urnInfo(firstString([response.func_urn], ""), s);
      if (!info || info.baseUrn !== verified.baseUrn) throw new Error("Huawei returned no verifiable confirmation for the configuration update.");
      return { message: "Configuration updated. Every other native setting was preserved from the read-back configuration.", resourceId: resource!.id };
    }
    if (operation === "versions") {
      const rows = await versionRows(s, verified);
      return { message: `${rows.length} published versions loaded. Published versions can be deleted individually; latest cannot be deleted.`, facts: rows.map((row) => ({ label: `${firstString([row.version], "-")} · ${firstString([row.last_modified], "-")}`, value: `${firstString([row.description], "") || "No description"} · ${formatBytes(row.code_size)}` })) };
    }
    if (operation === "publish-version") {
      const version = str(values, "version");
      if (!new RegExp(versionPattern).test(version)) throw new ManagementInputError("Version names are up to 42 letters, digits, underscores, dots, and hyphens, starting and ending with a letter or digit.");
      if ((await versionRows(s, verified)).some((row) => row.version === version)) throw new ManagementInputError("This version name is already published.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(s, "fg", `${urnPath}/versions`, { method: "POST", body: JSON.stringify({ version, description: str(values, "description") }) });
      const publishedUrn = firstString([response.func_urn], "");
      const info = urnInfo(publishedUrn, s);
      if (!info || info.baseUrn !== verified.baseUrn || publishedUrn.split(":")[7] !== version) throw new Error("Huawei returned no verifiable confirmation for the published version.");
      return { message: `Version ${version} published from the current code and configuration.`, resourceId: resource!.id };
    }
    if (operation === "aliases") {
      const rows = await aliasRows(s, verified);
      return { message: `${rows.length} version aliases loaded.`, facts: rows.map((row) => ({ label: `${firstString([row.name], "-")} → ${firstString([row.version], "-")}`, value: firstString([row.description], "") || "No description" })) };
    }
    if (operation === "delete-version") {
      const version = str(values, "version");
      if (!version || version.toLowerCase() === "latest") throw new ManagementInputError("The latest version cannot be deleted.", 409);
      const row = (await versionRows(s, verified)).find(item => item.version === version);
      if (!row) throw new ManagementInputError("The selected published version no longer exists on this function.", 404);
      const versionUrn = firstString([row.func_urn], ""), qualified = { ...verified, urn: versionUrn };
      const aliases = await aliasRows(s, verified);
      if (aliases.some(alias => alias.version === version || Object.hasOwn(asRecord(alias.additional_version_weights), version))) throw new ManagementInputError("Remove aliases routing to this version before deleting it.", 409);
      if ((await triggerRows(s, qualified)).length) throw new ManagementInputError("Remove this version's triggers before deleting it.", 409);
      const capacity = await reservedCapacity(s, qualified);
      // The account list is verified, and a positive count anywhere on the function blocks deletion conservatively.
      if (capacity > 0) throw new ManagementInputError("Release this function's reserved instances before deleting a version.", 409);
      await huaweiFetch(s, "fg", `${functionsPath}/${encodeURI(versionUrn)}`, { method: "DELETE" });
      return { message: `Published version ${version} deleted. The function and its other versions remain available.`, resourceId: resource!.id };
    }
    if (operation === "create-alias") {
      const name = str(values, "name");
      if (!new RegExp(aliasPattern).test(name)) throw new ManagementInputError("Alias names are up to 64 letters, digits, underscores, or hyphens.");
      const version = str(values, "version");
      const [versions, aliases] = await Promise.all([versionRows(s, verified), aliasRows(s, verified)]);
      if (!versions.some((row) => row.version === version)) throw new ManagementInputError("Select a version published by this function.", 404);
      if (aliases.some((row) => row.name === name)) throw new ManagementInputError("This function already has an alias with this name.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(s, "fg", `${urnPath}/aliases`, { method: "POST", body: JSON.stringify({ name, version, description: str(values, "description") }) });
      if (firstString([response.name], "") !== name || firstString([response.version], "") !== version) throw new Error("Huawei returned no verifiable confirmation for the alias.");
      const aliasUrn = firstString([response.alias_urn], "");
      if (urnInfo(aliasUrn, s)?.baseUrn !== verified.baseUrn || aliasUrn.split(":")[7] !== name) throw new Error("Huawei returned an unverified alias identity. Check current aliases before retrying.");
      return { message: `Alias ${name} now routes to version ${version}.`, resourceId: resource!.id };
    }
    if (operation === "update-alias") {
      const alias = str(values, "alias");
      const version = str(values, "version");
      const [versions, aliases] = await Promise.all([versionRows(s, verified), aliasRows(s, verified)]);
      const currentAlias = aliases.find(row => row.name === alias);
      if (currentAlias && Object.keys(asRecord(currentAlias.additional_version_weights)).length) throw new ManagementInputError("This alias has weighted version routing that cannot be preserved by this workflow.", 409);
      if (!currentAlias) throw new ManagementInputError("The selected alias no longer exists on this function.", 404);
      if (!versions.some((row) => row.version === version)) throw new ManagementInputError("Select a version published by this function.", 404);
      const response = await huaweiFetch<Record<string, unknown>>(s, "fg", `${urnPath}/aliases/${encodeURIComponent(alias)}`, { method: "PUT", body: JSON.stringify({ version, description: str(values, "description") }) });
      if (firstString([response.name], "") !== alias || firstString([response.version], "") !== version) throw new Error("Huawei returned no verifiable confirmation for the alias update.");
      const aliasUrn = firstString([response.alias_urn], "");
      if (urnInfo(aliasUrn, s)?.baseUrn !== verified.baseUrn || aliasUrn.split(":")[7] !== alias) throw new Error("Huawei returned an unverified alias identity. Check current aliases before retrying.");
      return { message: `Alias ${alias} now routes to version ${version}.`, resourceId: resource!.id };
    }
    if (operation === "delete-alias") {
      const alias = str(values, "alias");
      if (!(await aliasRows(s, verified)).some((row) => row.name === alias)) throw new ManagementInputError("The selected alias no longer exists on this function.", 404);
      const response = await huaweiFetch<Record<string, unknown>>(s, "fg", `${urnPath}/aliases/${encodeURIComponent(alias)}`, { method: "DELETE" });
      const name = firstString([response.name], "");
      if (name && name !== alias) throw new Error("Huawei returned a different alias for this deletion.");
      return { message: `Version alias ${alias} deleted.`, resourceId: resource!.id };
    }
    if (operation === "max-instances") {
      const maxInstances = Number(values.maxInstances);
      if (!Number.isSafeInteger(maxInstances) || (maxInstances !== -1 && (maxInstances < 0 || maxInstances > 1000))) throw new ManagementInputError("Maximum instances must be -1 (no limit) or a whole number from 0 (disabled) to 1000.");
      const response = await huaweiFetch<Record<string, unknown>>(s, "fg", `${urnPath}/config-max-instance`, { method: "PUT", body: JSON.stringify({ max_instance_num: maxInstances }) });
      const info = urnInfo(firstString([response.func_urn], ""), s);
      if (!info || info.baseUrn !== verified.baseUrn) throw new Error("Huawei returned no verifiable confirmation for the maximum instance configuration.");
      return { message: maxInstances === -1 ? "Maximum instance limit removed." : maxInstances === 0 ? "Function execution disabled (maximum instances set to zero)." : `Maximum instances set to ${maxInstances}.`, resourceId: resource!.id };
    }
    if (operation === "create-timer") {
      const name = str(values, "name");
      if (!new RegExp(timerPattern).test(name)) throw new ManagementInputError("Timer names are 1-64 letters, digits, underscores, or hyphens and start with a letter.");
      const scheduleType = str(values, "scheduleType");
      const schedule = str(values, "schedule");
      timerSchedule(scheduleType, schedule);
      const status = str(values, "timerStatus") || "DISABLED";
      if (!["ACTIVE", "DISABLED"].includes(status)) throw new ManagementInputError("Select the timer status.");
      const userEvent = str(values, "userEvent");
      if (Buffer.byteLength(userEvent, "utf8") > 2048) throw new ManagementInputError("Attached event data exceeds 2 KB.");
      const triggers = await triggerRows(s, verified);
      if (triggers.some((row) => row.trigger_type_code === "TIMER" && firstString([asRecord(row.event_data).name], "") === name)) throw new ManagementInputError("This function already has a timer with this name.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(s, "fg", `/v2/${s.projectId}/fgs/triggers/${encodeURI(verified.urn)}`, { method: "POST", body: JSON.stringify({
        trigger_type_code: "TIMER", trigger_status: status,
        event_data: { name, schedule_type: scheduleType, schedule, ...(userEvent ? { user_event: userEvent } : {}) },
      }) });
      const event = asRecord(response.event_data);
      if (!firstString([response.trigger_id], "") || response.trigger_type_code !== "TIMER" || event.name !== name || event.schedule !== schedule || event.schedule_type !== scheduleType || response.trigger_status !== status || (response.func_urn !== undefined && response.func_urn !== verified.urn)) throw new Error("Huawei returned no verifiable confirmation for the timer trigger.");
      return { message: status === "DISABLED" ? `Timer ${name} created disabled.` : `Timer ${name} created active; the function now runs on this schedule.`, resourceId: resource!.id };
    }
    if (operation === "delete") {
      const versions = await versionRows(s, verified);
      const qualifiers = new Set([verified.urn, ...versions.map(row => firstString([row.func_urn], ""))]);
      for (const urn of qualifiers) {
        const triggers = await triggerRows(s, { ...verified, urn });
        if (triggers.length) throw new ManagementInputError(`This function version still has ${triggers.length} trigger(s). Delete them in the function workspace's trigger workflow first.`, 409);
      }
      const aliases = await aliasRows(s, verified);
      if (aliases.length) throw new ManagementInputError(`Delete the function's ${aliases.length} version alias(es) first.`, 409);
      const capacity = await reservedCapacity(s, verified);
      if (capacity > 0) throw new ManagementInputError(`This function has ${capacity} reserved instance(s). Release the reserved capacity (set its count to zero) before deleting the function.`, 409);
      const response = await huaweiFetch<Record<string, unknown>>(s, "fg", `${functionsPath}/${encodeURI(verified.baseUrn)}`, { method: "DELETE" });
      const urn = firstString([response.func_urn], "");
      if (urn && urnInfo(urn, s)?.baseUrn !== verified.baseUrn) throw new Error("Huawei returned a different function for this deletion.");
      return { message: "Function deleted together with every published version.", resourceId: resource!.id };
    }
    throw new ManagementInputError("Unsupported FunctionGraph operation.");
  },
};
