import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { createDnsZone, deleteDnsZone, listDnsZones } from "@/lib/huawei/services/dns";
import { ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

/**
 * Bounded DNS management for PUBLIC zones only.
 * Verified against HuaweiCloud SDK python v3 DnsClient v2:
 * - POST   /v2/zones                                   (CreatePublicZoneReq: name, zone_type, description, email, ttl)
 * - PATCH  /v2/zones/{zone_id}                         (UpdatePublicZoneInfo: description, email, ttl)
 * - DELETE /v2/zones/{zone_id}
 * - GET    /v2/zones/{zone_id}/recordsets?limit=500    (marker pagination, metadata.total_count)
 * - POST   /v2/zones/{zone_id}/recordsets              (CreateRecordSetRequestBody)
 * - PUT    /v2/zones/{zone_id}/recordsets/{recordset_id} (UpdateRecordSetReq: name and type stay unchanged)
 * - DELETE /v2/zones/{zone_id}/recordsets/{recordset_id}
 *
 * Private zones are intentionally not offered: the canonical inventory lists public zones only, and private-zone
 * creation requires a VPC router association that this adapter does not validate. Updating or deleting a zone or
 * recordset requires the framework's parent resource, so the zone is the inventory unit and recordsets are chosen
 * through an ID field that is validated against a fresh upstream list on every submission.
 */

const recordsetTypes = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA", "NS"] as const;
const fqdnPattern = "^(?:\\*\\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,63}\\.$";
const zoneNameField = { key: "name", label: "Zone name", type: "text" as const, required: true, max: 254, pattern: fqdnPattern, help: "Fully qualified public zone name ending with a dot, e.g. example.com." };
const recordsetNameField = { key: "name", label: "Recordset name", type: "text" as const, required: true, max: 254, pattern: "^(?:\\*\\.)?(?:[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?\\.)+[a-zA-Z]{2,63}\\.$", help: "Full record name ending with the zone name and a final dot, e.g. www.example.com. Use the zone name itself for the apex record. Wildcards such as *.example.com. are supported." };
const ttlField = { key: "ttl", label: "TTL (seconds)", type: "number" as const, min: 1, max: 2147483647 };

type ZoneRecordset = {
  id: string;
  name: string;
  type: string;
  description: string;
  records: string[];
  systemManaged: boolean;
};

/** Recordsets are always read live: recordset choices and revalidation must never use cached data. */
async function listZoneRecordsets(session: BetterUiSession, zoneId: string): Promise<ZoneRecordset[]> {
  const body = await huaweiList<{ recordsets?: unknown[] }>(session, "dns", `/v2/zones/${encodeURIComponent(zoneId)}/recordsets?limit=500`, {
    items: ["recordsets"],
    kind: "marker",
    parameter: "marker",
    size: 500,
    fallbackKey: "id",
    total: ["metadata.total_count"],
  });
  return asArray(body.recordsets).map((raw) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return {
      id: asString(item.id, ""),
      name: asString(item.name, ""),
      type: asString(item.type, ""),
      description: asString(item.description, ""),
      records: asArray(item.records).map((record) => String(record)),
      // The NS and SOA recordsets Huawei creates with every public zone are system managed and cannot be edited.
      systemManaged: item.default === true || asString(item.type, "") === "SOA",
    };
  }).filter((recordset) => recordset.id);
}

async function findRecordset(session: BetterUiSession, zoneId: string, recordsetId: string): Promise<ZoneRecordset> {
  const recordset = (await listZoneRecordsets(session, zoneId)).find((item) => item.id === recordsetId);
  if (!recordset) throw new ManagementInputError("The recordset was not found in this zone. Refresh the form and select a current recordset.", 404);
  if (recordset.systemManaged) throw new ManagementInputError("System recordsets (NS, SOA) cannot be modified through this workflow.", 409);
  return recordset;
}

export const dnsManagement: ManagementAdapter = {
  title: "DNS Public Zones",
  operations: [
    { id: "create-zone", label: "Create public zone", description: "Add a public zone for a domain you control. Huawei creates the NS and SOA system recordsets automatically.", kind: "create", fields: [zoneNameField,
      { key: "description", label: "Description", type: "textarea", max: 255 },
      { key: "email", label: "Administrator email", type: "text", max: 254, pattern: "^[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+$", help: "Optional mailbox used in the zone's SOA record." },
      { ...ttlField, defaultValue: 300, help: "How long resolvers may cache this zone's records. Default 300 seconds." },
    ], impact: "The zone becomes publicly resolvable through Huawei DNS name servers once its delegation is configured at your registrar." },
    { id: "update-zone", label: "Edit zone settings", description: "Change the description, SOA email, or default TTL of the selected public zone. Omitted fields keep their current values.", kind: "update", fields: [
      { key: "description", label: "Description", type: "textarea", max: 255 },
      { key: "email", label: "Administrator email", type: "text", max: 254, pattern: "^[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+$" },
      ttlField,
    ], allowedStatuses: ["ACTIVE"] },
    { id: "delete-zone", label: "Delete public zone", description: "Permanently remove the selected public zone and every recordset it still contains.", kind: "delete", fields: [], confirmation: true, allowedStatuses: ["ACTIVE"], impact: "The zone and its remaining recordsets are permanently removed and DNS resolution for the zone stops." },
    { id: "list-recordsets", label: "View recordsets", description: "Inspect the recordsets that currently exist in the selected public zone.", kind: "inspect", fields: [] },
    { id: "create-recordset", label: "Create recordset", description: "Add a new recordset to the selected public zone.", kind: "action", fields: [recordsetNameField,
      { key: "type", label: "Record type", type: "select", required: true, defaultValue: "A", choices: recordsetTypes.map((value) => ({ value, label: value })) },
      { ...ttlField, required: true, defaultValue: 300 },
      { key: "records", label: "Record values", type: "list", required: true, max: 20, help: "Comma-separated record values for this type, e.g. 203.0.113.10, 203.0.113.11 for A records. Up to 20 values." },
      { key: "description", label: "Description", type: "textarea", max: 255 },
    ], allowedStatuses: ["ACTIVE"] },
    { id: "update-recordset", label: "Edit recordset", description: "Replace the values, TTL, or description of an existing recordset in the selected public zone. The record name and type cannot change.", kind: "action", fields: [
      { key: "recordsetId", label: "Recordset", type: "select", required: true, source: "recordsets", help: "Validated against the zone's current recordsets when the operation is submitted." },
      { ...ttlField, required: true, defaultValue: 300 },
      { key: "records", label: "Record values", type: "list", required: true, max: 20, help: "The recordset's full new value list; existing values are replaced. Comma-separated, up to 20 values." },
      { key: "description", label: "Description", type: "textarea", max: 255 },
    ], allowedStatuses: ["ACTIVE"] },
    { id: "delete-recordset", label: "Delete recordset", description: "Remove one recordset from the selected public zone.", kind: "action", fields: [
      { key: "recordsetId", label: "Recordset", type: "select", required: true, source: "recordsets" },
    ], confirmation: true, allowedStatuses: ["ACTIVE"], impact: "The recordset stops resolving and any client still caching it keeps the old value until its TTL expires." },
  ],
  inventory: async (session) => (await listDnsZones(session)).filter((zone) => zone.type.toLowerCase() === "public").map((zone) => {
    const ttl = Number(zone.ttl);
    return {
      id: zone.id,
      name: zone.name,
      status: zone.status.toUpperCase(),
      values: { zoneType: zone.type, description: zone.description, ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : "" },
    };
  }),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (!["update-recordset", "delete-recordset"].includes(operation) || !resource) return {};
    const recordsets = await listZoneRecordsets(session, resource.id);
    return {
      recordsets: recordsets.filter((recordset) => !recordset.systemManaged).map((recordset) => ({
        value: recordset.id,
        label: `${recordset.name} (${recordset.type}, ${recordset.records.length} value${recordset.records.length === 1 ? "" : "s"})`,
      })),
    };
  },
  execute: async (session, operation, values, resource) => {
    const zone = resource!;
    if (operation === "create-zone") {
      const body = await createDnsZone(session, {
        name: String(values.name),
        ...(values.description !== undefined ? { description: String(values.description) } : {}),
        ...(values.email !== undefined ? { email: String(values.email) } : {}),
        ...(values.ttl !== undefined ? { ttl: Number(values.ttl) } : {}),
        projectId: session.projectId,
      });
      const created = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      return { message: "Public zone created.", resourceId: asString(created.id, "") || undefined, facts: [{ label: "Zone", value: asString(created.name, String(values.name)) }] };
    }
    if (operation === "update-zone") {
      const body: Record<string, unknown> = {};
      if (values.description !== undefined) body.description = String(values.description);
      if (values.email !== undefined) body.email = String(values.email);
      if (values.ttl !== undefined) body.ttl = Number(values.ttl);
      if (!Object.keys(body).length) throw new ManagementInputError("Change at least one field to update the zone.");
      await huaweiFetch(session, "dns", `/v2/zones/${encodeURIComponent(zone.id)}`, { method: "PATCH", body: JSON.stringify(body) });
      return { message: "Zone settings updated." };
    }
    if (operation === "delete-zone") {
      await deleteDnsZone(session, zone.id, session.projectId);
      return { message: "Public zone deletion accepted.", asynchronous: true };
    }
    if (operation === "list-recordsets") {
      const recordsets = await listZoneRecordsets(session, zone.id);
      const limited = recordsets;
      return {
        message: `The zone has ${recordsets.length} recordset${recordsets.length === 1 ? "" : "s"}.`,
        facts: limited.map((recordset) => ({ label: `${recordset.name} (${recordset.type}${recordset.systemManaged ? ", system" : ""})`, value: recordset.records.length ? recordset.records.join(" | ") : "no values" })),
      };
    }
    if (operation === "create-recordset") {
      const name = String(values.name);
      if (name.toLowerCase() !== zone.name.toLowerCase() && !name.toLowerCase().endsWith(`.${zone.name.toLowerCase()}`)) throw new ManagementInputError(`The recordset name must equal the zone name or end with ".${zone.name}".`);
      const body = await huaweiFetch<Record<string, unknown>>(session, "dns", `/v2/zones/${encodeURIComponent(zone.id)}/recordsets`, {
        method: "POST",
        body: JSON.stringify({ name, type: String(values.type), ttl: Number(values.ttl), records: values.records, ...(values.description !== undefined ? { description: String(values.description) } : {}) }),
      });
      return { message: "Recordset created.", resourceId: asString(body.id, "") || undefined, facts: [{ label: "Recordset", value: `${name} (${String(values.type)})` }] };
    }
    if (operation === "update-recordset") {
      const recordset = await findRecordset(session, zone.id, String(values.recordsetId));
      // The API requires name and type on update but rejects changes to them, so the fresh values are resent unchanged.
      await huaweiFetch(session, "dns", `/v2/zones/${encodeURIComponent(zone.id)}/recordsets/${encodeURIComponent(recordset.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: recordset.name,
          type: recordset.type,
          ttl: Number(values.ttl),
          records: values.records,
          ...(values.description !== undefined ? { description: String(values.description) } : {}),
        }),
      });
      return { message: "Recordset updated.", resourceId: recordset.id };
    }
    if (operation === "delete-recordset") {
      const recordset = await findRecordset(session, zone.id, String(values.recordsetId));
      await huaweiFetch(session, "dns", `/v2/zones/${encodeURIComponent(zone.id)}/recordsets/${encodeURIComponent(recordset.id)}`, { method: "DELETE" });
      return { message: "Recordset deletion accepted.", resourceId: recordset.id, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listDnsZones],
};
