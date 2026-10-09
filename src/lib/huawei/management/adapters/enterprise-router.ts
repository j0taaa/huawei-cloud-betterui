import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listEnterpriseRoutersForProject } from "@/lib/huawei/services/enterprise-router";
import { listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

/**
 * Enterprise Router management against the documented native er v3 APIs:
 *   instances        POST/PUT/DELETE /v3/{project_id}/enterprise-router/instances[/{er_id}]
 *   availability     GET             /v3/{project_id}/enterprise-router/availability-zones
 *   route tables     POST/PUT/DELETE /v3/{project_id}/enterprise-router/{er_id}/route-tables[/{id}]
 *   associations     POST            .../route-tables/{id}/associate|disassociate, GET .../associations
 *   propagations     POST            .../route-tables/{id}/enable-propagations|disable-propagations
 *   static routes    POST/DELETE     /v3/{project_id}/enterprise-router/route-tables/{id}/static-routes[/{route_id}]
 *   vpc attachments  POST/PUT/DELETE /v3/{project_id}/enterprise-router/{er_id}/vpc-attachments[/{id}]
 *
 * Inventory mixes routers, route tables, and VPC attachments, so resource IDs
 * are tagged ("router:", "table:{erId}/", "attachment:{erId}/") and every
 * operation re-verifies the child against a fresh server query before writing.
 * ER attachments use the VPC subnet ID (virsubnet_id), never the Neutron
 * network ID.
 */

const root = (s: BetterUiSession) => `/v3/${s.projectId}/enterprise-router`;
const NAME_PATTERN = "^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}_.-]{0,62}[\\p{L}\\p{N}])?$";
const CIDR_PATTERN = "^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)/(\\d|[12]\\d|3[0-2])$";

const name: ManagementField = { key: "name", label: "Name", required: true, max: 64, pattern: NAME_PATTERN };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 255, allowEmpty: true, pattern: "^[^<>]*$" };
const attachmentField: ManagementField = { key: "attachment", label: "VPC attachment", type: "select", source: "attachments", required: true };
const routerImpact = "The enterprise router incurs recurring pay-per-use charges from creation. Attachments and route tables are billed as part of the instance.";
const tableImpact = "Associations and propagations steer traffic between attachments; changing them can interrupt cross-VPC connectivity immediately.";

type Tagged = { kind: "router" | "table" | "attachment"; erId: string; childId?: string };

function parseTagged(resource: ManagementResource | undefined, kind: Tagged["kind"], label: string): Tagged {
  const id = resource?.id ?? "";
  const childId = id.slice(kind.length + 1);
  if (!id.startsWith(`${kind}:`) || !childId) throw new ManagementInputError(`This operation needs a selected ${label}.`, 409);
  const [erId, tableId] = childId.split("/");
  if (!erId || (kind !== "router" && !tableId)) throw new ManagementInputError(`This operation needs a selected ${label}.`, 409);
  return { kind, erId, childId: tableId };
}

async function requireRouter(s: BetterUiSession, erId: string) {
  const router = (await listEnterpriseRoutersForProject(s)).find(r => r.id === erId && r.projectId === s.projectId);
  if (!router) throw new ManagementInputError("The enterprise router no longer exists in this project.", 404);
  return router;
}

type TableRecord = { id: string; name: string; description: string; isDefaultAssociation: boolean; isDefaultPropagation: boolean; state: string };
type AttachmentRecord = { id: string; name: string; state: string; description: string };

async function fetchTables(s: BetterUiSession, erId: string): Promise<TableRecord[]> {
  const body = await huaweiList<Record<string, unknown>>(s, "er", `${root(s)}/${encodeURIComponent(erId)}/route-tables?limit=500`, { items: ["route_tables"], kind: "marker", parameter: "marker", size: 500, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  return asArray(body.route_tables).map(raw => {
    const item = asRecord(raw);
    return { id: asString(item.id, ""), name: asString(item.name), description: asString(item.description), isDefaultAssociation: item.is_default_association === true, isDefaultPropagation: item.is_default_propagation === true, state: firstString([item.state, item.status], "UNKNOWN") };
  }).filter(t => t.id);
}

async function fetchAttachments(s: BetterUiSession, erId: string): Promise<AttachmentRecord[]> {
  const body = await huaweiList<Record<string, unknown>>(s, "er", `${root(s)}/${encodeURIComponent(erId)}/vpc-attachments?limit=500`, { items: ["attachments", "vpc_attachments"], kind: "marker", parameter: "marker", size: 500, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  return asArray(body.attachments ?? body.vpc_attachments).map(raw => {
    const item = asRecord(raw);
    return { id: asString(item.id, ""), name: asString(item.name), state: firstString([item.state, item.status], "UNKNOWN"), description: asString(item.description) };
  }).filter(a => a.id);
}

async function fetchAssociations(s: BetterUiSession, erId: string, tableId: string) {
  const body = await huaweiList<Record<string, unknown>>(s, "er", `${root(s)}/${encodeURIComponent(erId)}/route-tables/${encodeURIComponent(tableId)}/associations?limit=500`, { items: ["associations"], kind: "marker", parameter: "marker", size: 500, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  return asArray(body.associations).map(raw => {
    const item = asRecord(raw);
    return { id: asString(item.id, ""), attachmentId: asString(item.attachment_id, ""), state: firstString([item.state, item.status], "UNKNOWN") };
  }).filter(a => a.id);
}

async function fetchPropagations(s: BetterUiSession, erId: string, tableId: string) {
  const body = await huaweiList<Record<string, unknown>>(s, "er", `${root(s)}/${encodeURIComponent(erId)}/route-tables/${encodeURIComponent(tableId)}/propagations?limit=500`, { items: ["propagations"], kind: "marker", parameter: "marker", size: 500, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  return asArray(body.propagations).map(raw => {
    const item = asRecord(raw);
    return { id: asString(item.id, ""), attachmentId: asString(item.attachment_id, ""), state: firstString([item.state, item.status], "UNKNOWN") };
  }).filter(p => p.id);
}

async function fetchStaticRoutes(s: BetterUiSession, tableId: string) {
  const body = await huaweiList<Record<string, unknown>>(s, "er", `${root(s)}/route-tables/${encodeURIComponent(tableId)}/static-routes?limit=500`, { items: ["routes"], kind: "marker", parameter: "marker", size: 500, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  return asArray(body.routes).map(raw => {
    const item = asRecord(raw);
    return { id: asString(item.id, ""), destination: asString(item.destination, ""), isBlackhole: item.is_blackhole === true, nextHop: asArray(item.attachments).map(a => asString(asRecord(a).resource_id, "")).filter(Boolean).join(","), state: firstString([item.state, item.status], "UNKNOWN"), description: asString(item.description) };
  }).filter(r => r.id);
}

async function requireTable(s: BetterUiSession, erId: string, tableId: string) {
  const table = (await fetchTables(s, erId)).find(t => t.id === tableId);
  if (!table) throw new ManagementInputError("The route table no longer belongs to this enterprise router.", 404);
  return table;
}

async function requireAttachment(s: BetterUiSession, erId: string, attachmentId: string) {
  const attachment = (await fetchAttachments(s, erId)).find(a => a.id === attachmentId);
  if (!attachment) throw new ManagementInputError("The VPC attachment no longer belongs to this enterprise router.", 404);
  return attachment;
}

/** Live availability zones; sold-out or disabled zones are refused for creation. */
async function fetchAvailableZones(s: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(s, "er", `${root(s)}/availability-zones`);
  return asArray(body.availability_zones).map(asRecord)
    .map(z => ({ code: asString(z.code, ""), state: firstString([z.state], "available") }))
    .filter(z => z.code && !/sold|unavailable|disable/i.test(z.state))
    .map(z => z.code);
}

export const enterpriseRouterManagement: ManagementAdapter = {
  title: "Enterprise Router",
  operations: [
    { id: "create", label: "Create enterprise router", kind: "create", description: "Create a pay-per-use enterprise router in live availability zones with a private BGP ASN.", fields: [name, description, { key: "asn", label: "BGP ASN", type: "number", required: true, min: 64512, max: 65534, defaultValue: 64512, help: "Private ASN range supported by the console." }, { key: "availabilityZones", label: "Availability zones", type: "list", required: true, max: 2, source: "availabilityZones", help: "One or two live availability zones for this region." }, { key: "enableDefaultAssociation", label: "Enable default route table association", type: "boolean" }, { key: "enableDefaultPropagation", label: "Enable default route table propagation", type: "boolean" }], impact: routerImpact },
    { id: "update", label: "Edit router", kind: "update", description: "Rename the router and edit its description while preserving ASN and network settings.", fields: [name, description], allowedStatuses: ["available"], resourcePrefixes: ["router:"] },
    { id: "delete", label: "Delete empty router", kind: "delete", description: "Delete the router after removing every VPC attachment. Route tables are removed with the instance.", fields: [], confirmation: true, allowedStatuses: ["available", "failed"], resourcePrefixes: ["router:"], impact: "The router, its route tables, and routes are permanently removed. In-flight cross-VPC traffic is interrupted." },
    { id: "inspect", label: "View route tables and attachments", kind: "inspect", description: "List the router's route tables and VPC attachments with their current states.", fields: [], resourcePrefixes: ["router:"] },
    { id: "create-table", label: "Create route table", kind: "action", description: "Add a custom route table to this router.", fields: [name, description], allowedStatuses: ["available"], resourcePrefixes: ["router:"] },
    { id: "update-table", label: "Edit route table", kind: "update", description: "Rename the route table or edit its description.", fields: [name, description], allowedStatuses: ["available"], resourcePrefixes: ["table:"] },
    { id: "delete-table", label: "Delete route table", kind: "delete", description: "Delete a custom route table with no associations, propagations, or dependencies.", fields: [], confirmation: true, allowedStatuses: ["available"], resourcePrefixes: ["table:"], impact: "Routes in this table stop forwarding immediately. Default association and propagation tables cannot be deleted." },
    { id: "inspect-table", label: "View table associations, propagations, routes", kind: "inspect", description: "List the associations, propagations, and static routes of this route table.", fields: [], resourcePrefixes: ["table:"] },
    { id: "associate", label: "Associate attachment with table", kind: "action", description: "Associate one of this router's VPC attachments with the route table.", fields: [attachmentField], allowedStatuses: ["available"], resourcePrefixes: ["table:"], impact: tableImpact },
    { id: "disassociate", label: "Disassociate attachment from table", kind: "action", description: "Remove one current association from this route table.", fields: [{ key: "association", label: "Association", type: "select", source: "associations", required: true }], allowedStatuses: ["available"], resourcePrefixes: ["table:"], impact: tableImpact },
    { id: "enable-propagation", label: "Enable propagation from attachment", kind: "action", description: "Propagate the attachment's routes into this route table.", fields: [attachmentField], allowedStatuses: ["available"], resourcePrefixes: ["table:"], impact: tableImpact },
    { id: "disable-propagation", label: "Disable propagation from attachment", kind: "action", description: "Stop propagating one attachment's routes into this route table.", fields: [{ key: "propagation", label: "Propagation", type: "select", source: "propagations", required: true }], allowedStatuses: ["available"], resourcePrefixes: ["table:"], impact: tableImpact },
    { id: "create-route", label: "Create static route", kind: "action", description: "Add a static route with a native CIDR destination to this table, forwarding to a current attachment or to a black hole.", fields: [{ key: "destination", label: "Destination CIDR", required: true, max: 18, pattern: CIDR_PATTERN, help: "For example 192.168.200.0/24." }, { key: "nextHopType", label: "Next hop", type: "select", required: true, defaultValue: "attachment", choices: [{ value: "attachment", label: "Current VPC attachment" }, { value: "blackhole", label: "Black hole (drop traffic)" }] }, { key: "attachment", label: "Next-hop VPC attachment", type: "select", source: "attachments", help: "Required unless the next hop is a black hole." }, description], allowedStatuses: ["available"], resourcePrefixes: ["table:"], impact: tableImpact },
    { id: "delete-route", label: "Delete static route", kind: "action", description: "Remove one current static route from this table.", fields: [{ key: "route", label: "Static route", type: "select", source: "routes", required: true }], confirmation: true, allowedStatuses: ["available"], resourcePrefixes: ["table:"], impact: "Traffic matching this route's destination stops being forwarded by it." },
    { id: "create-attachment", label: "Create VPC attachment", kind: "action", description: "Attach a current VPC subnet to this router using its VPC subnet ID.", fields: [name, description, { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true }, { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true }, { key: "autoCreateVpcRoutes", label: "Auto-create VPC routes to the router", type: "boolean" }], allowedStatuses: ["available"], resourcePrefixes: ["router:"], impact: "The attachment connects the VPC to this router; with auto-created routes, VPC traffic to router destinations is redirected." },
    { id: "update-attachment", label: "Edit VPC attachment", kind: "update", description: "Rename the VPC attachment or edit its description.", fields: [name, description], allowedStatuses: ["available"], resourcePrefixes: ["attachment:"] },
    { id: "delete-attachment", label: "Delete VPC attachment", kind: "delete", description: "Detach the VPC from this router. Routes and associations using it stop working.", fields: [], confirmation: true, allowedStatuses: ["available", "failed"], resourcePrefixes: ["attachment:"], impact: "Cross-VPC traffic through this attachment is interrupted and auto-created VPC routes are removed." },
  ],
  inventory: async s => {
    const routers = (await listEnterpriseRoutersForProject(s)).filter(r => r.projectId === s.projectId);
    const children = await Promise.all(routers.map(async router => {
      const [tables, attachments] = await Promise.all([fetchTables(s, router.id), fetchAttachments(s, router.id)]);
      return { tables, attachments };
    }));
    return routers.flatMap((router, index) => [
      { id: `router:${router.id}`, name: router.name, status: router.status, values: { name: router.name, description: router.description, asn: router.asn } },
      ...children[index].tables.map(table => ({ id: `table:${router.id}/${table.id}`, name: table.name, status: table.state, values: { name: table.name, description: table.description, default: table.isDefaultAssociation || table.isDefaultPropagation } })),
      ...children[index].attachments.map(attachment => ({ id: `attachment:${router.id}/${attachment.id}`, name: attachment.name, status: attachment.state, values: { name: attachment.name, description: attachment.description } })),
    ]);
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      return { availabilityZones: (await fetchAvailableZones(s)).map(code => ({ value: code, label: code })) };
    }
    if (operation === "create-attachment") {
      const [vpcs, subnets] = await Promise.all([listVpcsForProject(s), listSubnetsForProject(s)]);
      return { vpcs: vpcs.map(v => ({ value: v.id, label: `${v.name} (${v.cidr})` })), subnets: subnets.map(subnet => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · VPC ${subnet.vpcId}` })) };
    }
    if (!resource) return {};
    if (operation === "create-table" || operation === "inspect") return {};
    if (resource.id.startsWith("router:") || resource.id.startsWith("attachment:")) return {};
    const tagged = parseTagged(resource, "table", "route table");
    await requireRouter(s, tagged.erId);
    const table = await requireTable(s, tagged.erId, tagged.childId!);
    const choices: Record<string, ManagementChoice[]> = {};
    if (["associate", "enable-propagation", "create-route"].includes(operation)) choices.attachments = (await fetchAttachments(s, tagged.erId)).map(a => ({ value: a.id, label: `${a.name} · ${a.state}` }));
    if (operation === "disassociate") choices.associations = (await fetchAssociations(s, tagged.erId, table.id)).map(a => ({ value: a.id, label: `${a.attachmentId} · ${a.state}` }));
    if (operation === "disable-propagation") choices.propagations = (await fetchPropagations(s, tagged.erId, table.id)).map(p => ({ value: p.id, label: `${p.attachmentId} · ${p.state}` }));
    if (operation === "delete-route") choices.routes = (await fetchStaticRoutes(s, table.id)).map(r => ({ value: r.id, label: `${r.destination} → ${r.isBlackhole ? "black hole" : r.nextHop || "attachment"} · ${r.state}` }));
    return choices;
  },
  invalidationKeys: () => [cloudCacheKeys.listEnterpriseRouters, cloudCacheKeys.listVpcs, cloudCacheKeys.listSubnets],
  execute: async (s, operation, v, resource) => {
    const send = (path: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "er", `${root(s)}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (operation === "create") {
      const zones = await fetchAvailableZones(s);
      const selected = Array.isArray(v.availabilityZones) ? v.availabilityZones : [];
      if (!selected.length || selected.some(zone => !zones.includes(zone))) throw new ManagementInputError("Select available zones from this region's current list.");
      const body = await send("/instances", "POST", { instance: { name: String(v.name), description: String(v.description ?? ""), asn: typeof v.asn === "number" ? v.asn : 64512, enable_default_association: v.enableDefaultAssociation === true, enable_default_propagation: v.enableDefaultPropagation === true, availability_zone_ids: selected } });
      return { message: "Enterprise router creation submitted. It becomes usable once its status is available.", resourceId: asString(asRecord(body.instance).id, "") || undefined, asynchronous: true };
    }
    if (operation === "create-attachment") {
      const tagged = parseTagged(resource, "router", "router");
      await requireRouter(s, tagged.erId);
      const [vpcs, subnets] = await Promise.all([listVpcsForProject(s), listSubnetsForProject(s)]);
      if (!vpcs.some(item => item.id === v.vpc)) throw new ManagementInputError("The selected VPC no longer exists in this project.", 404);
      const subnet = subnets.find(item => item.id === v.subnet);
      if (!subnet || subnet.vpcId !== v.vpc) throw new ManagementInputError("Select a subnet inside the selected VPC.", 404);
      const body = await send(`/${encodeURIComponent(tagged.erId)}/vpc-attachments`, "POST", { vpc_attachment: { name: String(v.name), description: String(v.description ?? ""), vpc_id: String(v.vpc), virsubnet_id: subnet.id, auto_create_vpc_routes: v.autoCreateVpcRoutes === true } });
      return { message: "VPC attachment creation submitted.", resourceId: asString(asRecord(body.vpc_attachment).id, "") || undefined, asynchronous: true };
    }
    if (operation === "update" || operation === "delete" || operation === "inspect" || operation === "create-table") {
      const tagged = parseTagged(resource, "router", "router");
      const router = await requireRouter(s, tagged.erId);
      if (operation === "update") await send(`/instances/${encodeURIComponent(router.id)}`, "PUT", { instance: { name: String(v.name), description: String(v.description ?? "") } });
      else if (operation === "delete") {
        const attachments = await fetchAttachments(s, router.id);
        if (attachments.length) throw new ManagementInputError(`Delete the ${attachments.length} VPC attachment(s) before deleting this router.`, 409);
        await send(`/instances/${encodeURIComponent(router.id)}`, "DELETE");
        return { message: "Enterprise router deletion submitted.", resourceId: router.id, asynchronous: true };
      } else if (operation === "create-table") {
        const body = await send(`/${encodeURIComponent(router.id)}/route-tables`, "POST", { route_table: { name: String(v.name), description: String(v.description ?? "") } });
        return { message: "Route table creation submitted.", resourceId: asString(asRecord(body.route_table).id, "") || undefined, asynchronous: true };
      } else {
        const [tables, attachments] = await Promise.all([fetchTables(s, router.id), fetchAttachments(s, router.id)]);
        return { message: `${tables.length} route table(s) and ${attachments.length} VPC attachment(s) loaded.`, facts: [...tables.map(t => ({ label: `Route table · ${t.name}`, value: `${t.id} · ${t.state}${t.isDefaultAssociation ? " · default association" : ""}${t.isDefaultPropagation ? " · default propagation" : ""}` })), ...attachments.map(a => ({ label: `Attachment · ${a.name}`, value: `${a.id} · ${a.state}` }))] };
      }
      return { message: "Enterprise router updated.", resourceId: router.id };
    }
    if (operation === "update-attachment" || operation === "delete-attachment") {
      const tagged = parseTagged(resource, "attachment", "VPC attachment");
      await requireRouter(s, tagged.erId);
      const attachment = await requireAttachment(s, tagged.erId, tagged.childId!);
      if (operation === "delete-attachment") {
        await send(`/${encodeURIComponent(tagged.erId)}/vpc-attachments/${encodeURIComponent(attachment.id)}`, "DELETE");
        return { message: "VPC attachment deletion submitted.", resourceId: attachment.id, asynchronous: true };
      }
      await send(`/${encodeURIComponent(tagged.erId)}/vpc-attachments/${encodeURIComponent(attachment.id)}`, "PUT", { vpc_attachment: { name: String(v.name), description: String(v.description ?? "") } });
      return { message: "VPC attachment updated.", resourceId: attachment.id };
    }
    const tagged = parseTagged(resource, "table", "route table");
    await requireRouter(s, tagged.erId);
    const table = await requireTable(s, tagged.erId, tagged.childId!);
    const tablePath = `/${encodeURIComponent(tagged.erId)}/route-tables/${encodeURIComponent(table.id)}`;
    if (operation === "update-table") {
      await send(tablePath, "PUT", { route_table: { name: String(v.name), description: String(v.description ?? "") } });
      return { message: "Route table updated.", resourceId: table.id };
    }
    if (operation === "delete-table") {
      if (table.isDefaultAssociation || table.isDefaultPropagation) throw new ManagementInputError("The default association or propagation route table cannot be deleted.", 409);
      const [associations, propagations] = await Promise.all([fetchAssociations(s, tagged.erId, table.id), fetchPropagations(s, tagged.erId, table.id)]);
      if (associations.length || propagations.length) throw new ManagementInputError("Remove every association and propagation before deleting this route table.", 409);
      await send(tablePath, "DELETE");
      return { message: "Route table deletion submitted.", resourceId: table.id, asynchronous: true };
    }
    if (operation === "inspect-table") {
      const [associations, propagations, routes] = await Promise.all([fetchAssociations(s, tagged.erId, table.id), fetchPropagations(s, tagged.erId, table.id), fetchStaticRoutes(s, table.id)]);
      return { message: `${associations.length} association(s), ${propagations.length} propagation(s), ${routes.length} static route(s) loaded.`, facts: [...associations.map(a => ({ label: `Association · ${a.id}`, value: `${a.attachmentId} · ${a.state}` })), ...propagations.map(p => ({ label: `Propagation · ${p.id}`, value: `${p.attachmentId} · ${p.state}` })), ...routes.map(r => ({ label: `Route · ${r.id}`, value: `${r.destination} → ${r.isBlackhole ? "black hole" : r.nextHop || "attachment"} · ${r.state}` }))] };
    }
    if (operation === "associate" || operation === "enable-propagation") {
      const attachment = await requireAttachment(s, tagged.erId, String(v.attachment));
      if (operation === "associate") {
        if ((await fetchAssociations(s, tagged.erId, table.id)).some(a => a.attachmentId === attachment.id)) throw new ManagementInputError("This attachment is already associated with the route table.", 409);
        const body = await send(`${tablePath}/associate`, "POST", { attachment_id: attachment.id });
        return { message: "Association submitted.", resourceId: asString(asRecord(body.association).id, "") || table.id, asynchronous: true };
      }
      if ((await fetchPropagations(s, tagged.erId, table.id)).some(p => p.attachmentId === attachment.id)) throw new ManagementInputError("This attachment already propagates into the route table.", 409);
      const body = await send(`${tablePath}/enable-propagations`, "POST", { attachment_id: attachment.id });
      return { message: "Propagation submitted.", resourceId: asString(asRecord(body.propagation).id, "") || table.id, asynchronous: true };
    }
    if (operation === "disassociate" || operation === "disable-propagation") {
      const current = operation === "disassociate" ? (await fetchAssociations(s, tagged.erId, table.id)).find(a => a.id === v.association) : (await fetchPropagations(s, tagged.erId, table.id)).find(p => p.id === v.propagation);
      if (!current) throw new ManagementInputError("The selected entry no longer belongs to this route table.", 404);
      await send(`${tablePath}/${operation === "disassociate" ? "disassociate" : "disable-propagations"}`, "POST", { attachment_id: current.attachmentId });
      return { message: operation === "disassociate" ? "Disassociation submitted." : "Propagation disable submitted.", resourceId: table.id, asynchronous: true };
    }
    if (operation === "create-route") {
      const destination = String(v.destination);
      const isBlackhole = v.nextHopType === "blackhole";
      const route: Record<string, unknown> = { destination, description: String(v.description ?? "") };
      if (isBlackhole) route.is_blackhole = true;
      else {
        if (!v.attachment) throw new ManagementInputError("Select the next-hop VPC attachment.");
        const attachment = await requireAttachment(s, tagged.erId, String(v.attachment));
        route.attachment_id = attachment.id;
      }
      const body = await send(`/route-tables/${encodeURIComponent(table.id)}/static-routes`, "POST", { route });
      return { message: "Static route creation submitted.", resourceId: asString(asRecord(body.route).id, "") || table.id, asynchronous: true };
    }
    if (operation === "delete-route") {
      const route = (await fetchStaticRoutes(s, table.id)).find(r => r.id === v.route);
      if (!route) throw new ManagementInputError("The static route no longer belongs to this route table.", 404);
      await send(`/route-tables/${encodeURIComponent(table.id)}/static-routes/${encodeURIComponent(route.id)}`, "DELETE");
      return { message: "Static route deletion submitted.", resourceId: route.id, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported enterprise router operation.");
  },
};
