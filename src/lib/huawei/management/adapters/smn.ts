import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { createSmnTopic, deleteSmnTopic, listSmnTopics } from "@/lib/huawei/services/smn";
import { ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

/**
 * Bounded SMN topic management and publishing.
 * Verified against HuaweiCloud SDK python v3 SmnClient v2:
 * - POST   /v2/{project_id}/notifications/topics                                  (CreateTopicRequestBody: name, display_name)
 * - PUT    /v2/{project_id}/notifications/topics/{topic_urn}                      (UpdateTopicRequestBody: display_name)
 * - DELETE /v2/{project_id}/notifications/topics/{topic_urn}
 * - POST   /v2/{project_id}/notifications/topics/{topic_urn}/publish              (subject, message, message_structure, time_to_live)
 * - GET    /v2/{project_id}/notifications/topics/{topic_urn}/subscriptions        (offset/limit pagination, subscription_count)
 * - POST   /v2/{project_id}/notifications/topics/{topic_urn}/subscriptions        (protocol, endpoint, remark)
 * - DELETE /v2/{project_id}/notifications/subscriptions/{subscription_urn}
 *
 * Topics are the parent resource; subscriptions are chosen through a URN field validated against a fresh upstream
 * list on every submission. Topic URNs are path-encoded because they contain colons. Protocols and the keys of the
 * JSON message structure are validated against the whitelist documented by the SDK request models.
 */

const smnProtocols: ManagementChoice[] = [
  { value: "email", label: "Email address" },
  { value: "sms", label: "SMS phone number" },
  { value: "http", label: "HTTP endpoint" },
  { value: "https", label: "HTTPS endpoint" },
  { value: "functionstage", label: "FunctionGraph function" },
  { value: "functiongraph", label: "FunctionGraph workflow" },
  { value: "callnotify", label: "Voice notification" },
  { value: "wechat", label: "WeChat group robot" },
  { value: "dingding", label: "DingTalk group robot" },
  { value: "feishu", label: "Feishu group robot" },
  { value: "welink", label: "WeLink group robot" },
  { value: "dingTalkBot", label: "DingTalk individual bot" },
];
const protocolWhitelist = new Set(smnProtocols.map((protocol) => protocol.value));
const displayNameField = { key: "displayName", label: "Display name", type: "text" as const, required: true, max: 192, maxBytes: 192, help: "Shown as the sender name in email notifications. Up to 192 bytes." };

type TopicSubscription = { urn: string; protocol: string; endpoint: string; status: string };

function subscriptionStatus(raw: unknown) {
  if (raw === 0) return "awaiting confirmation";
  if (raw === 1) return "confirmed";
  return asString(raw, "unknown status");
}

/** Subscriptions are always read live so choices and deletes are validated against current upstream state. */
async function listTopicSubscriptions(session: BetterUiSession, topicUrn: string): Promise<TopicSubscription[]> {
  const body = await huaweiList<{ subscriptions?: unknown[] }>(session, "smn", `/v2/${session.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}/subscriptions?offset=0&limit=100`, {
    items: ["subscriptions"],
    kind: "offset",
    parameter: "offset",
    size: 100,
    total: ["subscription_count", "total_count"],
  });
  return asArray(body.subscriptions).map((raw) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return {
      urn: asString(item.subscription_urn, ""),
      protocol: asString(item.protocol, ""),
      endpoint: asString(item.endpoint, ""),
      status: subscriptionStatus(item.status),
    };
  }).filter((subscription) => subscription.urn);
}

function validateEndpoint(protocol: string, endpoint: string) {
  const reject = (detail: string) => { throw new ManagementInputError(`The endpoint is invalid for protocol ${protocol}: ${detail}`); };
  switch (protocol) {
    case "email":
      if (!/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(endpoint)) reject("enter a valid email address.");
      return;
    case "sms":
    case "callnotify":
      if (!/^\+[1-9]\d{5,19}$/.test(endpoint)) reject("enter a phone number with country code, e.g. +8613800000000.");
      return;
    case "http":
      if (!/^http:\/\/\S+$/.test(endpoint)) reject("must start with http:// and be a publicly reachable address.");
      return;
    case "https":
      if (!/^https:\/\/\S+$/.test(endpoint)) reject("must start with https:// and be a publicly reachable address.");
      return;
    case "wechat":
    case "feishu":
      if (!/^https?:\/\/\S+$/.test(endpoint)) reject("enter the group robot webhook URL.");
      return;
    default:
      // dingding (webhook or openConversationId), welink (group ID), functionstage/functiongraph (URNs), and
      // dingTalkBot (user ID) accept identifiers whose exact shapes only the service can fully validate.
      if (!/^[\w:./+-]+$/.test(endpoint)) reject("enter the identifier or URL expected by this protocol.");
  }
}

/** The JSON message structure must be an object with a "default" entry and protocol keys from the SMN whitelist. */
function parseMessageStructure(raw: unknown): string {
  const text = String(raw);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ManagementInputError("Protocol-specific messages must be valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ManagementInputError("Protocol-specific messages must be a JSON object keyed by protocol.");
  const record = parsed as Record<string, unknown>;
  if (typeof record.default !== "string" || !record.default.trim()) throw new ManagementInputError('Protocol-specific messages must include a non-empty "default" entry.');
  for (const [key, value] of Object.entries(record)) {
    if (key !== "default" && !protocolWhitelist.has(key)) throw new ManagementInputError(`"${key}" is not a supported message protocol key.`);
    if (typeof value !== "string" || !value) throw new ManagementInputError(`The message for "${key}" must be non-empty text.`);
  }
  return text;
}

export const smnManagement: ManagementAdapter = {
  title: "SMN Topics",
  operations: [
    { id: "create-topic", label: "Create topic", description: "Create a notification topic in the selected project. Subscriptions are added afterwards.", kind: "create", fields: [
      { key: "name", label: "Topic name", type: "text", required: true, max: 255, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,254}$", help: "Letters, digits, hyphens, and underscores; must start with a letter or digit." },
      displayNameField,
    ] },
    { id: "update-topic", label: "Edit topic display name", description: "Change the display name shown to email subscribers. This is the only attribute the SMN update API accepts.", kind: "update", fields: [displayNameField] },
    { id: "delete-topic", label: "Delete topic", description: "Permanently remove the topic and all of its subscriptions.", kind: "delete", fields: [], confirmation: true, impact: "Subscribers stop receiving messages and every subscription of the topic is removed." },
    { id: "publish", label: "Publish message", confirmation: true, impact: "This message is delivered to the topic’s confirmed subscribers. Notification charges may apply.", description: "Send one message to every confirmed subscriber of the topic.", kind: "action", fields: [
      { key: "subject", label: "Subject", type: "text", max: 512, maxBytes: 512, help: "Used as the email subject for email subscribers. Up to 512 bytes." },
      { key: "message", label: "Message", type: "textarea", required: true, max: 262144, maxBytes: 262144, help: "Plain-text message body (UTF-8, up to 256 KiB). Carriers may truncate SMS text around 490 characters." },
      { key: "messageStructure", label: "Protocol-specific messages", type: "textarea", max: 262144, maxBytes: 262144, help: 'Optional JSON object with a mandatory "default" entry and optional protocol keys (email, sms, http, https, dingding, wechat, feishu, welink, dingTalkBot, functionstage, functiongraph). Overrides the plain message when present.' },
      { key: "timeToLive", label: "Retention (seconds)", type: "number", min: 1, max: 86400, help: "How long SMN keeps retrying delivery. Default 3600." },
    ] },
    { id: "list-subscriptions", label: "View subscriptions", description: "Inspect the endpoints currently subscribed to the topic and their confirmation state.", kind: "inspect", fields: [] },
    { id: "create-subscription", label: "Add subscription", description: "Subscribe one endpoint to the topic. Email, SMS, HTTP, and robot endpoints must confirm before delivery starts.", kind: "action", fields: [
      { key: "protocol", label: "Protocol", type: "select", required: true, choices: smnProtocols },
      { key: "endpoint", label: "Endpoint", type: "text", required: true, max: 512, help: "The address for the chosen protocol, e.g. user@example.com, +8613800000000, or an https:// webhook." },
      { key: "remark", label: "Remark", type: "text", max: 128 },
    ] },
    { id: "delete-subscription", label: "Delete subscription", description: "Remove one endpoint from the topic's subscriber list.", kind: "action", fields: [
      { key: "subscriptionUrn", label: "Subscription", type: "select", required: true, source: "subscriptions", help: "Validated against the topic's current subscriptions when the operation is submitted." },
    ], confirmation: true, impact: "The endpoint stops receiving messages published to this topic." },
  ],
  inventory: async (session) => (await listSmnTopics(session)).map((topic) => ({
    // Every SMN topic API path addresses the topic by URN, so the URN is the stable resource identifier here.
    id: topic.topicUrn || topic.id,
    name: topic.name,
    values: { topicUrn: topic.topicUrn, displayName: topic.displayName },
  })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation !== "delete-subscription" || !resource) return {};
    const subscriptions = await listTopicSubscriptions(session, resource.id);
    return {
      subscriptions: subscriptions.map((subscription) => ({
        value: subscription.urn,
        label: `${subscription.endpoint} (${subscription.protocol}, ${subscription.status})`,
      })),
    };
  },
  execute: async (session, operation, values, resource) => {
    const topicUrn = resource?.id ?? "";
    if (operation === "create-topic") {
      const body = await createSmnTopic(session, { name: String(values.name), displayName: values.displayName === undefined ? undefined : String(values.displayName), projectId: session.projectId });
      return { message: "Topic created.", resourceId: asString(body.topic_urn, "") || undefined, facts: [{ label: "Topic URN", value: asString(body.topic_urn, "unavailable in response") }] };
    }
    if (operation === "update-topic") {
      if (values.displayName === undefined) throw new ManagementInputError("Enter a display name to update.");
      await huaweiFetch(session, "smn", `/v2/${session.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}`, { method: "PUT", body: JSON.stringify({ display_name: String(values.displayName) }) });
      return { message: "Topic display name updated." };
    }
    if (operation === "delete-topic") {
      await deleteSmnTopic(session, topicUrn, session.projectId);
      return { message: "Topic deleted." };
    }
    if (operation === "publish") {
      const body: Record<string, unknown> = { message: String(values.message) };
      if (values.subject !== undefined) body.subject = String(values.subject);
      if (values.messageStructure !== undefined) body.message_structure = parseMessageStructure(values.messageStructure);
      if (values.timeToLive !== undefined) body.time_to_live = String(values.timeToLive);
      const response = await huaweiFetch<{ message_id?: unknown; request_id?: unknown }>(session, "smn", `/v2/${session.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}/publish`, { method: "POST", body: JSON.stringify(body) });
      return { message: "Message published to the topic.", jobId: asString(response.message_id, "") || undefined, facts: [{ label: "Message ID", value: asString(response.message_id, "unavailable in response") }] };
    }
    if (operation === "list-subscriptions") {
      const subscriptions = await listTopicSubscriptions(session, topicUrn);
      const limited = subscriptions;
      return {
        message: `The topic has ${subscriptions.length} subscription${subscriptions.length === 1 ? "" : "s"}.`,
        facts: limited.map((subscription) => ({ label: `${subscription.endpoint} (${subscription.protocol})`, value: subscription.status })),
      };
    }
    if (operation === "create-subscription") {
      const protocol = String(values.protocol);
      const endpoint = String(values.endpoint);
      validateEndpoint(protocol, endpoint);
      const body: Record<string, unknown> = { protocol, endpoint };
      if (values.remark !== undefined) body.remark = String(values.remark);
      const response = await huaweiFetch<{ subscription_urn?: unknown }>(session, "smn", `/v2/${session.projectId}/notifications/topics/${encodeURIComponent(topicUrn)}/subscriptions`, { method: "POST", body: JSON.stringify(body) });
      return {
        message: "Subscription created. Endpoints that require confirmation receive no messages until the owner confirms.",
        resourceId: asString(response.subscription_urn, "") || undefined,
        facts: [{ label: "Endpoint", value: `${endpoint} (${protocol})` }],
      };
    }
    if (operation === "delete-subscription") {
      const subscriptionUrn = String(values.subscriptionUrn);
      const current = (await listTopicSubscriptions(session, topicUrn)).find((subscription) => subscription.urn === subscriptionUrn);
      if (!current) throw new ManagementInputError("The subscription was not found on this topic. Refresh the form and select a current subscription.", 404);
      await huaweiFetch(session, "smn", `/v2/${session.projectId}/notifications/subscriptions/${encodeURIComponent(subscriptionUrn)}`, { method: "DELETE" });
      return { message: "Subscription deleted.", facts: [{ label: "Removed endpoint", value: `${current.endpoint} (${current.protocol})` }] };
    }
    throw new ManagementInputError("Unsupported operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listSmnTopics],
};
