import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { getPurchasedApiSubscription, kooId, listPurchasedApis, listPurchasedApiSubscriptions } from "@/lib/huawei/services/koogallery-native";
import { ManagementInputError, type ManagementChoice, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

async function selected(s: BetterUiSession, resource?: ManagementResource) {
  const id = resource?.id.startsWith("subscription:") ? resource.id.slice(13) : "";
  if (!kooId(id)) throw new ManagementInputError("Select a purchased API subscription.");
  const rows = await listPurchasedApiSubscriptions(s);
  const current = rows.find(row => row.id === id);
  if (!current) throw new ManagementInputError("This purchased API subscription is no longer listed in the selected project.", 404);
  return { rows, current };
}
export const kooGalleryManagement: ManagementAdapter = {
  title: "KooGallery purchased APIs",
  operations: [
    { id: "inspect-subscription", label: "View subscription and quota", kind: "inspect", description: "Inspect the current purchased API subscription, call quotas, dates, and domains. These shared-gateway APIs cover existing API subscriptions; other Marketplace product types require their own delivery workflows.", fields: [] },
    { id: "list-apis", label: "List subscribed APIs", kind: "inspect", description: "List API definitions attached to this exact subscription without invoking vendor endpoints.", fields: [] },
    { id: "inspect-api", label: "View subscribed API", kind: "inspect", description: "Inspect one current subscribed API's identity, description, and access path.", fields: [{ key: "api", label: "Subscribed API", type: "select", source: "apis", required: true }] },
  ],
  inventory: async s => (await listPurchasedApiSubscriptions(s)).map(row => ({ id: `subscription:${row.id}`, name: row.name, values: { groupId: row.groupId, expiresAt: row.expiresAt } })),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation !== "inspect-api" || !resource) return {};
    const { rows, current } = await selected(s, resource);
    return { apis: (await listPurchasedApis(s, rows)).filter(api => api.purchaseId === current.id).map(api => ({ value: api.id, label: api.name })) };
  },
  execute: async (s, operation, values, resource) => {
    const { rows, current } = await selected(s, resource);
    if (operation === "inspect-subscription") {
      const detail = await getPurchasedApiSubscription(s, current);
      return { message: "Current purchased API subscription. Purchasing, renewal, cancellation, credentials, and vendor resource administration are not available through this workspace.", resourceId: resource!.id, facts: [
        { label: "Subscription ID", value: detail.id }, { label: "API group", value: `${detail.name} · ${detail.groupId}` }, { label: "Description", value: detail.description || "—" },
        { label: "Calls remaining", value: detail.quotaLeft === null ? "Unknown" : String(detail.quotaLeft) }, { label: "Calls used", value: detail.quotaUsed === null ? "Unknown" : String(detail.quotaUsed) },
        { label: "Ordered", value: detail.orderedAt }, { label: "Starts", value: detail.startsAt }, { label: "Expires", value: detail.expiresAt },
        { label: "Domains", value: detail.domains === null ? "Unknown" : detail.domains.length ? detail.domains.join(", ") : "None reported" },
      ] };
    }
    if (operation !== "list-apis" && operation !== "inspect-api") throw new ManagementInputError("Unsupported purchased API operation.");
    const apis = (await listPurchasedApis(s, rows)).filter(api => api.purchaseId === current.id);
    if (operation === "list-apis") return { message: `${apis.length} APIs in this subscription.`, resourceId: resource!.id, facts: apis.map(api => ({ label: api.name, value: `${api.id} · ${api.path}` })) };
    const api = apis.find(api => api.id === values.api);
    if (!api) throw new ManagementInputError("This API no longer belongs to the selected subscription.", 404);
    return { message: "Current subscribed API definition. Vendor endpoints have not been invoked.", resourceId: resource!.id, facts: [{ label: "API", value: api.name }, { label: "API ID", value: api.id }, { label: "Subscription ID", value: api.purchaseId }, { label: "Description", value: api.description || "—" }, { label: "Access path", value: api.path }] };
  },
  invalidationKeys: () => [cloudCacheKeys.listKooGalleryPurchasedApis],
};
