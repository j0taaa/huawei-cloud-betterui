import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

// Native EventGrid v1 contracts: channels, sources, subscriptions and CloudEvents.
const base = (s: BetterUiSession) => `/v1/${s.projectId}`;
type Kind = "channels" | "sources" | "subscriptions";
const name: ManagementField = { key: "name", label: "Name", required: true, max: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 512, allowEmpty: true };
const filter: ManagementField = { key: "filter", label: "Event filter (JSON)", type: "textarea", required: true, maxBytes: 2048, defaultValue: "{}", help: "Huawei EventGrid matching rules. An empty object matches all events from the selected source." };
const deliveryImpact = "Matching events are delivered to the configured webhook, which can trigger work and receive event data. EventGrid delivery and target usage can incur charges.";
async function list(s: BetterUiSession, kind: Kind) {
  const response = await huaweiList<Record<string, unknown>>(s, "eg", `${base(s)}/${kind}?offset=0&limit=100`, { items: ["items"], kind: "offset", parameter: "offset", size: 100, total: ["total"] });
  return asArray(response.items).map(asRecord).filter(item => typeof item.id === "string" && !!item.id && (!item.project_id || item.project_id === s.projectId));
}
function selected(resource?: ManagementResource): { kind: Kind; id: string } {
  const [kind, ...parts] = (resource?.id ?? "").split(":");
  if (!["channels", "sources", "subscriptions"].includes(kind) || !parts.join(":")) throw new ManagementInputError("Select an EventGrid resource.");
  return { kind: kind as Kind, id: parts.join(":") };
}
async function detail(s: BetterUiSession, kind: Kind, id: string) {
  const current = (await list(s, kind)).find(item => item.id === id);
  if (!current) throw new ManagementInputError("The selected resource no longer exists in this project.", 404);
  const item = await huaweiFetch<Record<string, unknown>>(s, "eg", `${base(s)}/${kind}/${encodeURIComponent(id)}`);
  if (item.id !== id || (item.project_id && item.project_id !== s.projectId)) throw new ManagementInputError("Huawei returned an unverified EventGrid resource.", 404);
  return { ...current, ...item };
}
function custom(item: Record<string, unknown>) {
  if (item.provider_type !== "CUSTOM" || item.name === "default") throw new ManagementInputError("Only custom EventGrid channels and sources can be changed here.", 409);
}
function jsonObject(value: unknown, label: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { throw new ManagementInputError(`${label} must be valid JSON.`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ManagementInputError(`${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}
function webhook(value: unknown) {
  let url: URL;
  try { url = new URL(String(value)); } catch { throw new ManagementInputError("Enter an absolute HTTPS webhook URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new ManagementInputError("Enter an HTTPS webhook URL without credentials or a fragment.");
  if (Buffer.byteLength(JSON.stringify({ url: url.href })) > 1024) throw new ManagementInputError("The webhook definition exceeds Huawei's 1,024-byte limit.");
  return url.href;
}
function batchAccepted(body: Record<string, unknown>, id: string, key: "subscription_id" | "event_id") {
  const event = asArray(body.events).map(asRecord).find(event => event[key] === id);
  if (Number(body.failed_count) > 0 || event?.error_code || event?.error_msg) throw new ManagementInputError("Huawei rejected this EventGrid item. Check its state and delivery configuration.", 409);
  if (body.failed_count !== 0 || !event) throw new Error("Huawei returned no verifiable confirmation for this EventGrid item.");
}
const facts = (item: Record<string, unknown>, keys: string[]) => keys.map(key => ({ label: key.replaceAll("_", " "), value: typeof item[key] === "string" || typeof item[key] === "number" ? String(item[key]) : "-" }));

export const eventgridManagement: ManagementAdapter = {
  title: "EventGrid Channels, Sources and Subscriptions",
  operations: [
    { id: "create-channel", label: "Create custom channel", kind: "create", description: "Create an event channel in this project. Cross-account publishing is disabled.", fields: [name, description, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }] },
    { id: "create-source", label: "Create application event source", kind: "create", description: "Register an application source on a live custom channel for CloudEvents publishing.", fields: [{ ...name, pattern: "^(?!hc\\.)[a-z0-9][a-z0-9._-]*$" }, description, { key: "channel", label: "Custom channel", type: "select", source: "channels", required: true }] },
    { id: "create-subscription", label: "Create webhook subscription", kind: "create", description: "Route a current custom application source to an HTTPS webhook, with the original event payload and explicit matching rules.", fields: [name, description, { key: "source", label: "Application source and channel", type: "select", source: "sources", required: true }, { key: "url", label: "HTTPS webhook URL", required: true, max: 1000 }, filter, { key: "retries", label: "Delivery retries", type: "number", min: 0, max: 16, defaultValue: 3 }], impact: deliveryImpact },
    { id: "inspect", label: "View resource configuration", kind: "inspect", description: "Inspect resource scope and subscription delivery targets without exposing source connection credentials.", fields: [] },
    { id: "update-channel", label: "Edit custom channel description", kind: "update", description: "Change only the channel description. Cross-account policies and enterprise-project scope are preserved.", fields: [description], resourcePrefixes: ["channels:"] },
    { id: "update-source", label: "Edit custom source description", kind: "update", description: "Change only the source description, preserving connection credentials and channel association.", fields: [description], resourcePrefixes: ["sources:"] },
    { id: "update-subscription", label: "Edit subscription description", kind: "update", description: "Change only the description, preserving every source, target, filter, transform, and connection.", fields: [description], resourcePrefixes: ["subscriptions:"] },
    { id: "enable", label: "Enable subscription", kind: "action", description: "Enable delivery through a current subscription.", fields: [], resourcePrefixes: ["subscriptions:"], impact: deliveryImpact },
    { id: "disable", label: "Disable subscription", kind: "action", description: "Pause event delivery through this subscription.", fields: [], resourcePrefixes: ["subscriptions:"], confirmation: true, impact: "Matching events stop being delivered to this subscription's targets. Workflows depending on delivery can stop running." },
    { id: "delete", label: "Delete resource", kind: "delete", description: "Delete an unused custom channel or source, or an unreferenced subscription. Default and official resources are protected.", fields: [], confirmation: true, impact: "Deleting an EventGrid resource permanently removes its configuration and can stop event routing. A channel or source must have no dependent subscriptions." },
    { id: "publish", label: "Publish application event", kind: "action", description: "Publish one CloudEvents 1.0 JSON event through a current custom application source. Use a unique event ID for this source.", fields: [{ key: "eventId", label: "Unique event ID", required: true, max: 128 }, { key: "eventType", label: "Event type", required: true, max: 128 }, { key: "subject", label: "Subject", max: 128 }, { key: "data", label: "Event data (JSON)", type: "textarea", required: true, maxBytes: 32768, defaultValue: "{}" }], resourcePrefixes: ["sources:"], confirmation: true, impact: "This event is delivered to matching subscriptions and can trigger real target actions and charges. Its payload is sent to Huawei and the configured targets." },
  ],
  inventory: async s => {
    const kinds: Kind[] = ["channels", "sources", "subscriptions"];
    const resources = await Promise.all(kinds.map(kind => list(s, kind)));
    return kinds.flatMap((kind, index) => resources[index].map(item => ({ id: `${kind}:${item.id}`, name: asString(item.name), status: asString(item.status, "UNKNOWN"), values: { description: asString(item.description, ""), provider: asString(item.provider_type, ""), channel: asString(item.channel_id, "") } })));
  },
  options: async (s, operation): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-source") return { channels: (await list(s, "channels")).filter(item => item.provider_type === "CUSTOM" && item.name !== "default").map(item => ({ value: String(item.id), label: String(item.name) })) };
    if (operation === "create-subscription") {
      const [channels, sources] = await Promise.all([list(s, "channels"), list(s, "sources")]);
      const own = new Set(channels.filter(item => item.provider_type === "CUSTOM").map(item => item.id));
      return { sources: sources.filter(item => item.provider_type === "CUSTOM" && item.type === "APPLICATION" && own.has(item.channel_id)).map(item => ({ value: String(item.id), label: `${item.name} · ${item.channel_name ?? item.channel_id}` })) };
    }
    return {};
  },
  execute: async (s, operation, v, resource) => {
    const write = (path: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "eg", `${base(s)}${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (operation === "create-channel") {
      if (v.name === "default") throw new ManagementInputError("The default channel name is reserved.");
      const result = await write("/channels", "POST", { name: v.name, description: v.description ?? "", enterprise_project_id: v.enterpriseProjectId ?? "0", cross_account: false });
      if (!result.id) throw new Error("Huawei returned no channel ID.");
      return { message: "Custom event channel created.", resourceId: `channels:${result.id}` };
    }
    if (operation === "create-source") {
      custom(await detail(s, "channels", String(v.channel)));
      const result = await write("/sources", "POST", { name: v.name, description: v.description ?? "", channel_id: v.channel, type: "APPLICATION" });
      if (!result.id) throw new Error("Huawei returned no event source ID.");
      return { message: "Application event source creation accepted.", resourceId: `sources:${result.id}`, asynchronous: true };
    }
    if (operation === "create-subscription") {
      const source = await detail(s, "sources", String(v.source)); custom(source);
      if (source.type !== "APPLICATION" || !source.channel_id) throw new ManagementInputError("Select a current application event source.");
      custom(await detail(s, "channels", String(source.channel_id)));
      const match = jsonObject(v.filter, "Event filter"); const url = webhook(v.url);
      const result = await write("/subscriptions", "POST", { name: v.name, description: v.description ?? "", channel_id: source.channel_id, sources: [{ name: source.name, provider_type: "CUSTOM", filter: match }], targets: [{ name: "WEBHOOK", provider_type: "CUSTOM", detail: { url }, retry_times: v.retries ?? 3, transform: { type: "ORIGINAL" } }] });
      if (!result.id) throw new Error("Huawei returned no subscription ID.");
      return { message: "Webhook subscription creation accepted. Verify its status and delivery before relying on it.", resourceId: `subscriptions:${result.id}`, asynchronous: true };
    }
    const { kind, id } = selected(resource); const item = await detail(s, kind, id); const path = `/${kind}/${encodeURIComponent(id)}`;
    if (operation === "inspect") {
      const output = facts(item, ["name", "description", "provider_type", "type", "status", "channel_id", "channel_name", "enterprise_project_id", "created_time", "updated_time"]);
      if (kind === "subscriptions") {
        output.push(...asArray(item.sources).map(asRecord).map(source => ({ label: `Source · ${source.name}`, value: `${source.provider_type} · ${JSON.stringify(source.filter ?? {})}` })));
        output.push(...asArray(item.targets).map(asRecord).map(target => ({ label: `Target · ${target.name}`, value: `${target.provider_type} · ${target.id} · ${target.retry_times ?? "-"} retries` })));
      }
      return { message: "Current EventGrid configuration.", facts: output };
    }
    if (operation.startsWith("update-")) {
      if (operation !== `update-${kind === "subscriptions" ? "subscription" : kind === "channels" ? "channel" : "source"}`) throw new ManagementInputError("Select the correct EventGrid resource type.");
      if (kind !== "subscriptions") custom(item);
      await write(path, "PUT", { description: v.description ?? "" }); return { message: "Description updated without replacing routing configuration." };
    }
    if (["enable", "disable"].includes(operation)) {
      if (kind !== "subscriptions") throw new ManagementInputError("Select a subscription.");
      const result = await write("/subscriptions/operation", "POST", { subscription_ids: [id], operation: operation.toUpperCase() }); batchAccepted(result, id, "subscription_id");
      return { message: operation === "enable" ? "Subscription enabled." : "Subscription disabled." };
    }
    if (operation === "delete") {
      if (kind !== "subscriptions") {
        custom(item); const subscriptions = await list(s, "subscriptions");
        if (kind === "channels") {
          if (subscriptions.some(subscription => subscription.channel_id === id) || (await list(s, "sources")).some(source => source.channel_id === id)) throw new ManagementInputError("Delete this channel's sources and subscriptions first.");
        } else if (subscriptions.some(subscription => subscription.channel_id === item.channel_id && asArray(subscription.sources).map(asRecord).some(source => source.name === item.name))) throw new ManagementInputError("Delete every subscription using this source first.");
      } else if (asArray(item.used).length) throw new ManagementInputError("This subscription is managed by another resource. Remove its trigger or dependency first.");
      await write(path, "DELETE"); return { message: "EventGrid resource deleted." };
    }
    if (operation === "publish") {
      if (kind !== "sources") throw new ManagementInputError("Select an application event source."); custom(item);
      if (item.type !== "APPLICATION" || !item.channel_id) throw new ManagementInputError("Only application sources support direct CloudEvents publishing here.");
      custom(await detail(s, "channels", String(item.channel_id)));
      const data = jsonObject(v.data, "Event data");
      const result = await write(`/channels/${encodeURIComponent(String(item.channel_id))}/events`, "POST", { events: [{ id: v.eventId, source: item.name, specversion: "1.0", type: v.eventType, datacontenttype: "application/json", data, time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), ...(v.subject ? { subject: v.subject } : {}) }] });
      batchAccepted(result, String(v.eventId), "event_id"); return { message: "Event accepted for routing. Acceptance does not confirm target delivery." };
    }
    throw new ManagementInputError("Unsupported EventGrid operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listEventGridSubscriptions],
};
