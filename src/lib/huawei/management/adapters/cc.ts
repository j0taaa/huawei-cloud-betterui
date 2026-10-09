import "server-only";
import { isIP } from "node:net";
import { getSessionProjects, type BetterUiSession, type HuaweiProjectSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { huaweiAccountFetch, huaweiFetch as nativeFetch, huaweiList as nativeList, HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { collectList, type Pagination } from "@/lib/huawei/pagination";
import type { ManagementAdapter } from "../types";

// Native Cloud Connect v3 contracts (account-scoped /v3/{domain_id}/ccaas endpoints,
// GlobalCredentials) verified against Huawei's published API references:
// cloud-connections, network-instances, inter-region-bandwidths, bandwidth-packages
// association, cloud-connection-routes, and regions. inter_region_ids carries
// exactly two region IDs and native inter_regions reports directional records;
// ListRegions reports each region's area_id, and a package's local_area_id and
// remote_area_id must cover the selected regions' areas. billing_mode is the exact
// native integer: 1 and 2 are yearly-monthly prepaid packages (the only ones managed
// here), 3 and 4 are pay-per-use, and 5 through 8 are percentile modes; every
// package operation additionally requires status ACTIVE, admin_state_up exactly
// true, and charge_mode "bandwidth". A package's bandwidth bounds the SUM of all
// inter-region bandwidths allocated from it, not a single allocation. Prepaid
// packages are purchased in the Cloud Connect console and never ordered here;
// central networks, global connection bandwidths, package orders and renewals,
// tags, cross-account authorisations, cross-border approvals, enterprise router,
// and full CIDR workflows remain out of scope.
const ccService = "cc";
const active = ["ACTIVE"];
const markerPagination = (items: string[]): Pagination => ({ items, kind: "marker", parameter: "marker", size: 200, next: ["page_info.next_marker", "next_marker"] });
const nameField: ManagementField = { key: "name", label: "Name", required: true, min: 1, max: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$", help: "1-64 letters, digits, underscores, or hyphens, starting with a letter or digit." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 1024, allowEmpty: true, pattern: "^[^<>]*$", help: "Up to 1024 characters. Angle brackets are not supported." };
const cloudConnectionField: ManagementField = { key: "cloudConnection", label: "Cloud connection", type: "select", source: "cloudConnections", required: true };
const instanceField: ManagementField = { key: "instance", label: "Network instance", type: "select", source: "instances", required: true, help: "Only VPCs and Direct Connect virtual gateways that are ACTIVE and owned by this account's accessible projects are offered." };
const cidrsField: ManagementField = { key: "cidrs", label: "Published routes", type: "list", source: "instanceCidrs", required: true, max: 50, help: "The instance CIDRs routed through the cloud connection." };
const bandwidthField: ManagementField = { key: "bandwidth", label: "Bandwidth (Mbit/s)", type: "number", required: true, min: 1, max: 2147483647 };
const packageField: ManagementField = { key: "package", label: "Bandwidth package", type: "select", source: "packages", required: true, help: "Only unbound prepaid yearly-monthly packages with bandwidth charging that are ACTIVE and administratively enabled are offered. Packages are purchased in the Cloud Connect console; this operation never orders a new one." };

function knownStatus(value: unknown) { return typeof value === "string" && ["ACTIVE", "ERROR", "BUILD", "PENDING", "DELETING"].includes(value) ? value : "UNKNOWN"; }

function typedString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function knownCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function sortedPair(pair: readonly string[]) {
  return [...pair].sort().join("|");
}

async function verifiedDomainId(session: BetterUiSession) {
  if (!session.accountToken) throw new ManagementInputError("Sign out and sign in again to obtain an account token.", 409);
  let response: { token?: unknown };
  try {
    response = await huaweiAccountFetch<{ token?: unknown }>({ ...session, token: session.accountToken }, "/v3/auth/tokens", { headers: { "X-Subject-Token": session.accountToken } });
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError("Unable to verify this account's IAM domain. Sign in again.", error.status);
    throw new ManagementInputError("Unable to verify this account's IAM domain. Sign in again.", 409);
  }
  const token = asRecord(response.token);
  const id = asString(asRecord(token.domain).id, "");
  const user = asRecord(token.user);
  if (!id || (session.userId && user.id !== session.userId) || asRecord(user.domain).id !== id) throw new ManagementInputError("Unable to verify this account's IAM domain. Sign in again.", 409);
  return id;
}

async function ccFetch<T>(session: BetterUiSession, domainId: string, path: string, init?: RequestInit): Promise<T> {
  try {
    const body = await nativeFetch<T>({ ...session, token: session.accountToken! }, ccService, `/v3/${encodeURIComponent(domainId)}/ccaas${path}`, init);
    const row = asRecord(body);
    if (row.error_code || row.error) throw new HuaweiApiError("Huawei rejected this Cloud Connect request.", 502);
    return body;
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected this Cloud Connect request.", error.status);
    throw new Error("Huawei returned an unverifiable Cloud Connect response. Check native state before retrying.");
  }
}

async function ccList<T>(session: BetterUiSession, domainId: string, path: string, pagination: Pagination): Promise<T> {
  return collectList(cursor => {
    const url = new URL(path, "https://local.invalid");
    if (cursor !== undefined) url.searchParams.set(pagination.parameter, String(cursor));
    return ccFetch<T>(session, domainId, url.pathname + url.search);
  }, pagination);
}

function ccQuery(filters: Record<string, string | undefined>) {
  const params = new URLSearchParams({ limit: "200" });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return `?${params.toString()}`;
}

function verifiedRows(value: unknown, label: string, domainId: string) {
  if (!Array.isArray(value)) throw new ManagementInputError(`Huawei returned an incomplete ${label} inventory.`, 409);
  const rows = value.map(asRecord);
  const ids = rows.map(row => typedString(row.id) ?? "");
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ManagementInputError(`Huawei returned an unverified ${label} inventory.`, 409);
  for (const row of rows) {
    const owner = typedString(row.domain_id);
    if (!owner) throw new ManagementInputError(`Huawei returned an unverified ${label} inventory.`, 409);
    if (owner !== domainId) throw new ManagementInputError(`The ${label} does not belong to this account.`, 409);
  }
  return rows;
}

function verifiedCatalogRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new ManagementInputError(`Huawei returned an incomplete ${label} catalog.`, 409);
  const rows = value.map(asRecord);
  const ids = rows.map(row => typedString(row.id) ?? "");
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ManagementInputError(`Huawei returned an unverified ${label} catalog.`, 409);
  return rows;
}

function assertRecordDomain(record: Record<string, unknown>, domainId: string, label: string) {
  const owner = typedString(record.domain_id);
  if (!owner) throw new ManagementInputError(`Huawei returned an unverified ${label}.`, 409);
  if (owner !== domainId) throw new ManagementInputError(`The ${label} does not belong to this account.`, 409);
}

function assertOwnedInstance(record: Record<string, unknown>, domainId: string) {
  if (record.instance_domain_id !== domainId) throw new ManagementInputError("This network instance was loaded from another account and cannot be changed here.", 409);
}

function assertReady(record: Record<string, unknown>, label: string, statuses = active) {
  const status = knownStatus(record.status);
  if (!statuses.includes(status)) throw new ManagementInputError(`The ${label} is ${status || "in an unknown state"}; retry when it is ${statuses.join(" or ")}.`, 409);
}

function assertExactName(record: Record<string, unknown>, resource: ManagementResource, label: string) {
  const name = firstString([record.name], asString(record.id));
  if (name !== resource.name) throw new ManagementInputError(`The ${label} was renamed or replaced since it was selected. Refresh the list and confirm the exact name before deleting.`, 409);
}

function dependencyCount(record: Record<string, unknown>, key: string) {
  const count = knownCount(record[key]);
  if (count === undefined) throw new ManagementInputError("Huawei returned unverified cloud connection dependency counts.", 409);
  return count;
}

function verifiedAcknowledgement(response: Record<string, unknown>, field: string, domainId: string, expected?: string) {
  const record = asRecord(response[field]);
  const id = typedString(record.id) ?? "";
  if (!id || (expected && id !== expected)) throw new Error("Huawei returned an unverified Cloud Connect acknowledgement. Check native state before retrying.");
  const owner = typedString(record.domain_id);
  if (!owner || owner !== domainId) throw new Error("Huawei returned an unverified Cloud Connect acknowledgement. Check native state before retrying.");
  return { id, record };
}

function connectionIdOf(resource?: ManagementResource) {
  const id = resource?.id ?? "";
  if (!id.startsWith("cc:")) throw new ManagementInputError("Select a cloud connection for this operation.", 409);
  return id.slice(3);
}

function instanceIdOf(resource?: ManagementResource) {
  const id = resource?.id ?? "";
  if (!id.startsWith("ni:")) throw new ManagementInputError("Select a network instance for this operation.", 409);
  return id.slice(3);
}

function bandwidthIdOf(resource?: ManagementResource) {
  const id = resource?.id ?? "";
  if (!id.startsWith("irb:")) throw new ManagementInputError("Select an inter-region bandwidth for this operation.", 409);
  return id.slice(4);
}

async function connectionRows(session: BetterUiSession, domainId: string) {
  const body = await ccList<Record<string, unknown>>(session, domainId, `/cloud-connections${ccQuery({})}`, markerPagination(["cloud_connections"]));
  return verifiedRows(body.cloud_connections, "cloud connection", domainId);
}

async function instanceRows(session: BetterUiSession, domainId: string, cloudConnectionId?: string) {
  const body = await ccList<Record<string, unknown>>(session, domainId, `/network-instances${ccQuery({ cloud_connection_id: cloudConnectionId })}`, markerPagination(["network_instances"]));
  const rows = verifiedRows(body.network_instances, "network instance", domainId);
  for (const row of rows) {
    const parent = typedString(row.cloud_connection_id);
    if (!parent || (cloudConnectionId && parent !== cloudConnectionId)) throw new ManagementInputError("Huawei returned an unverified network instance parent.", 409);
  }
  return rows;
}

function regionPairOf(row: Record<string, unknown>) {
  if (!Array.isArray(row.inter_regions)) throw new ManagementInputError("Huawei returned an unverified inter-region bandwidth region pair.", 409);
  const pair = row.inter_regions.map(asRecord);
  if (pair.length < 1 || pair.length > 2) throw new ManagementInputError("Huawei returned an unverified inter-region bandwidth region pair.", 409);
  const local = typedString(pair[0].local_region_id), remote = typedString(pair[0].remote_region_id);
  if (!local || !remote || local === remote || (pair.length === 2 && (pair[1].local_region_id !== remote || pair[1].remote_region_id !== local))) throw new ManagementInputError("Huawei returned an unverified inter-region bandwidth region pair.", 409);
  return [local, remote];
}

async function interRegionRows(session: BetterUiSession, domainId: string, cloudConnectionId?: string) {
  const body = await ccList<Record<string, unknown>>(session, domainId, `/inter-region-bandwidths${ccQuery({ cloud_connection_id: cloudConnectionId })}`, markerPagination(["inter_region_bandwidths"]));
  const rows = verifiedRows(body.inter_region_bandwidths, "inter-region bandwidth", domainId);
  for (const row of rows) {
    const parent = typedString(row.cloud_connection_id);
    if (!parent || (cloudConnectionId && parent !== cloudConnectionId)) throw new ManagementInputError("Huawei returned an unverified inter-region bandwidth parent.", 409);
    if (!typedString(row.bandwidth_package_id)) throw new ManagementInputError("Huawei returned an unverified inter-region bandwidth parent.", 409);
    if (knownCount(row.bandwidth) === undefined) throw new ManagementInputError("Huawei returned an unverified inter-region bandwidth allocation.", 409);
    regionPairOf(row);
  }
  return rows;
}

async function packageRows(session: BetterUiSession, domainId: string, resourceId?: string) {
  const body = await ccList<Record<string, unknown>>(session, domainId, `/bandwidth-packages${ccQuery({ resource_id: resourceId })}`, markerPagination(["bandwidth_packages"]));
  const rows = verifiedRows(body.bandwidth_packages, "bandwidth package", domainId);
  for (const row of rows) {
    const binding = typedString(row.resource_id);
    if (binding === undefined || (resourceId && binding !== resourceId)) throw new ManagementInputError("Huawei returned an unverified bandwidth package inventory.", 409);
  }
  return rows;
}

async function regionRows(session: BetterUiSession, domainId: string) {
  const body = await ccList<Record<string, unknown>>(session, domainId, `/regions?limit=2000`, { items: ["regions"], kind: "marker", parameter: "marker", size: 2000, next: ["page_info.next_marker", "next_marker"] });
  return verifiedCatalogRows(body.regions, "region");
}

async function routeRows(session: BetterUiSession, domainId: string, cloudConnectionId: string) {
  const body = await ccList<Record<string, unknown>>(session, domainId, `/cloud-connection-routes${ccQuery({ cloud_connection_id: cloudConnectionId })}`, markerPagination(["cloud_connection_routes"]));
  const rows = verifiedRows(body.cloud_connection_routes, "cloud connection route", domainId);
  if (rows.some(row => row.cloud_connection_id !== cloudConnectionId)) throw new ManagementInputError("Huawei returned routes from another cloud connection.", 409);
  return rows;
}

async function connectionRecord(session: BetterUiSession, domainId: string, id: string) {
  const body = await ccFetch<Record<string, unknown>>(session, domainId, `/cloud-connections/${encodeURIComponent(id)}`);
  const record = asRecord(body.cloud_connection);
  if (typedString(record.id) !== id) throw new ManagementInputError("The cloud connection was not found in this account.", 404);
  assertRecordDomain(record, domainId, "cloud connection");
  return record;
}

async function instanceRecord(session: BetterUiSession, domainId: string, id: string) {
  const body = await ccFetch<Record<string, unknown>>(session, domainId, `/network-instances/${encodeURIComponent(id)}`);
  const record = asRecord(body.network_instance);
  if (typedString(record.id) !== id) throw new ManagementInputError("The network instance was not found in this account.", 404);
  assertRecordDomain(record, domainId, "network instance");
  return record;
}

async function interRegionRecord(session: BetterUiSession, domainId: string, id: string) {
  const body = await ccFetch<Record<string, unknown>>(session, domainId, `/inter-region-bandwidths/${encodeURIComponent(id)}`);
  const record = asRecord(body.inter_region_bandwidth);
  if (typedString(record.id) !== id) throw new ManagementInputError("The inter-region bandwidth was not found in this account.", 404);
  assertRecordDomain(record, domainId, "inter-region bandwidth");
  return record;
}

function prepaidPackage(pkg: Record<string, unknown>) {
  return pkg.status === "ACTIVE" && pkg.admin_state_up === true && (pkg.billing_mode === 1 || pkg.billing_mode === 2) && pkg.charge_mode === "bandwidth" && pkg.interflow_mode === "Area" && (pkg.resource_type === "cloud_connection" || (pkg.resource_id === "" && pkg.resource_type === ""));
}

function assertPrepaidPackage(pkg: Record<string, unknown>) {
  if (!prepaidPackage(pkg)) throw new ManagementInputError("Only prepaid yearly-monthly bandwidth packages with bandwidth charging that are ACTIVE and administratively enabled can be managed here. Pay-per-use, percentile, Region-mode, and unrelated resource packages are excluded.", 409);
}

function packageCapacity(pkg: Record<string, unknown>) {
  const capacity = knownCount(pkg.bandwidth);
  if (capacity === undefined || capacity < 1) throw new ManagementInputError("Huawei returned an unverified bandwidth package capacity.", 409);
  return capacity;
}

function packageAreas(pkg: Record<string, unknown>) {
  const local = typedString(pkg.local_area_id);
  const remote = typedString(pkg.remote_area_id);
  return local && remote ? [local, remote] : null;
}

function regionArea(row: Record<string, unknown>) {
  const area = typedString(row.area_id);
  if (!area) throw new ManagementInputError("Huawei returned a region without a verifiable area. Select different regions.", 409);
  return area;
}

async function packageAllocations(session: BetterUiSession, domainId: string, packageId: string, excludeId?: string) {
  const rows = await interRegionRows(session, domainId);
  let total = 0;
  const pairs: string[][] = [];
  for (const row of rows) {
    if (excludeId && asString(row.id) === excludeId) continue;
    if (row.bandwidth_package_id === packageId) {
      total += row.bandwidth as number;
      pairs.push(regionPairOf(row));
    }
  }
  return { total, pairs };
}

async function verifiedInterRegionParents(session: BetterUiSession, domainId: string, record: Record<string, unknown>) {
  const cloudConnectionId = typedString(record.cloud_connection_id);
  const packageId = typedString(record.bandwidth_package_id);
  if (!cloudConnectionId || !packageId) throw new ManagementInputError("Huawei returned an unverified inter-region bandwidth parent.", 409);
  const connection = await connectionRecord(session, domainId, cloudConnectionId);
  if (connection.status !== "ACTIVE" || connection.admin_state_up !== true) throw new ManagementInputError("The cloud connection for this inter-region bandwidth must be ACTIVE and administratively enabled.", 409);
  const pkg = (await packageRows(session, domainId)).find(row => asString(row.id) === packageId);
  if (!pkg) throw new ManagementInputError("The bandwidth package for this inter-region bandwidth is no longer available.", 404);
  if (typedString(pkg.resource_id) !== cloudConnectionId) throw new ManagementInputError("The bandwidth package is no longer bound to this inter-region bandwidth's cloud connection.", 409);
  assertPrepaidPackage(pkg);
  const pair = regionPairOf(record);
  const regions = await regionRows(session, domainId);
  for (const region of pair) if (!regions.some(row => asString(row.id) === region)) throw new ManagementInputError(`Region ${region} is not in the native Cloud Connect region catalog.`, 404);
  const areas = packageAreas(pkg), selectedAreas = pair.map(region => regionArea(regions.find(row => row.id === region)!));
  if (!areas || sortedPair(areas) !== sortedPair(selectedAreas)) throw new ManagementInputError("The current package does not cover the inter-region bandwidth regions.", 409);
  return { packageId, pkg, pair };
}

function interRegionConfigComplete(record: Record<string, unknown>) {
  try { regionPairOf(record); } catch { return false; }
  return !!typedString(record.cloud_connection_id) && !!typedString(record.bandwidth_package_id) && typeof record.bandwidth === "number" && Number.isSafeInteger(record.bandwidth) && record.bandwidth >= 1;
}

type OwnedInstance = { type: "vpc" | "vgw"; projectId: string; region: string; instanceId: string; name: string; cidrs: string[] };

async function virtualGatewayRows(project: HuaweiProjectSession) {
  const body = await collectList<Record<string, unknown>>(async cursor => {
    const url = new URL(`/v3/${project.projectId}/dcaas/virtual-gateways?limit=100`, "https://local.invalid");
    if (cursor !== undefined) url.searchParams.set("marker", String(cursor));
    try {
      return await nativeFetch<Record<string, unknown>>(project, "dc", url.pathname + url.search);
    } catch (error) {
      if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected this Direct Connect catalog request.", error.status);
      throw new Error("Huawei returned an unverifiable Direct Connect catalog response.");
    }
  }, { items: ["virtual_gateways"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker", "next_marker"] });
  if (body.error_code || body.error) throw new Error("Huawei returned an unverifiable Direct Connect catalog response.");
  const rows = asArray(body.virtual_gateways).map(asRecord);
  const ids = rows.map(row => typedString(row.id) ?? "");
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ManagementInputError("Huawei returned an unverified virtual gateway catalog.", 409);
  return rows.filter(row => row.status === "ACTIVE" && row.tenant_id === project.projectId && (row.project_id === undefined || row.project_id === project.projectId));
}

async function sanitizedCatalog<T>(load: () => Promise<T>, label: string): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected this ${label} catalog request.`, error.status);
    throw new Error(`Huawei returned an unverifiable ${label} catalog response.`);
  }
}

async function verifiedVpcs(project: HuaweiProjectSession) {
  const body = await nativeList<Record<string, unknown>>(project, "vpc", `/v3/${project.projectId}/vpc/vpcs?limit=200`, markerPagination(["vpcs"]));
  if (body.error_code || body.error) throw new Error("The VPC catalog was rejected.");
  return verifiedCatalogRows(body.vpcs, "VPC").filter(row => row.status === "ACTIVE" && (!Object.hasOwn(row, "project_id") || row.project_id === project.projectId)).map(row => ({ id: asString(row.id), name: asString(row.name, asString(row.id)), status: "ACTIVE", cidr: firstString([row.cidr, row.cidr_v4], ""), secondaryCidrs: asArray(row.extend_cidrs ?? row.ext_cidrs).filter((cidr): cidr is string => typeof cidr === "string") }));
}

async function ownedInstanceCatalog(session: BetterUiSession): Promise<OwnedInstance[]> {
  const projects = getSessionProjects(session);
  const perProject = await Promise.all(projects.map(async (project) => {
    const [vpcs, subnets, gateways] = await Promise.all([
      sanitizedCatalog(() => verifiedVpcs(project), "VPC"),
      sanitizedCatalog(() => listSubnetsForProject(project), "subnet"),
      virtualGatewayRows(project),
    ]);
    const instances: OwnedInstance[] = [];
    for (const vpc of vpcs) {
      if (vpc.status !== "ACTIVE") continue;
      const cidrs = [vpc.cidr, ...vpc.secondaryCidrs, ...subnets.filter(subnet => subnet.vpcId === vpc.id).map(subnet => subnet.cidr)].filter(cidr => cidr && cidr !== "-");
      instances.push({ type: "vpc", projectId: project.projectId, region: project.region, instanceId: vpc.id, name: vpc.name, cidrs: [...new Set(cidrs)] });
    }
    for (const gateway of gateways) {
      const cidrs = [...asArray(gateway.local_ep_group).map(String), ...asArray(gateway.local_ep_group_ipv6).map(String)].filter(Boolean);
      instances.push({ type: "vgw", projectId: project.projectId, region: project.region, instanceId: asString(gateway.id), name: firstString([gateway.name], asString(gateway.id)), cidrs: [...new Set(cidrs)] });
    }
    return instances;
  }));
  return perProject.flat();
}

function assertCidr(value: string, label: string) {
  const [address, prefix = "", extra] = value.split("/");
  if (extra !== undefined) throw new ManagementInputError(`${label} must contain one CIDR prefix.`);
  const family = isIP(address);
  const size = Number(prefix);
  if (!family || !/^\d+$/.test(prefix) || size < 0 || size > (family === 6 ? 128 : 32)) throw new ManagementInputError(`${label} must be an IPv4 or IPv6 CIDR such as 172.16.0.0/16.`);
}

function parseInstanceSelection(selection: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(selection); } catch { throw new ManagementInputError("Select a network instance from the provided list."); }
  if (!Array.isArray(parsed) || parsed.length !== 4 || parsed.some(item => typeof item !== "string" || !item)) throw new ManagementInputError("Select a network instance from the provided list.");
  const [type, projectId, region, instanceId] = parsed as string[];
  if (type !== "vpc" && type !== "vgw") throw new ManagementInputError("Select a network instance from the provided list.");
  return { type, projectId, region, instanceId };
}

function parseCidrSelection(selection: string[], instance: OwnedInstance) {
  const cidrs: string[] = [];
  for (const item of selection) {
    let parsed: unknown;
    try { parsed = JSON.parse(item); } catch { throw new ManagementInputError("Select routes from the provided network instance list."); }
    if (!Array.isArray(parsed) || parsed.length !== 5 || parsed.some(part => typeof part !== "string" || !part)) throw new ManagementInputError("Select routes from the provided network instance list.");
    const [type, projectId, region, instanceId, cidr] = parsed as string[];
    if (type !== instance.type || projectId !== instance.projectId || region !== instance.region || instanceId !== instance.instanceId) throw new ManagementInputError("Every published route must belong to the selected network instance.", 409);
    assertCidr(cidr, "Published route");
    if (!cidrs.includes(cidr)) cidrs.push(cidr);
  }
  return cidrs;
}

function instanceCidrChoices(catalog: OwnedInstance[]): ManagementChoice[] {
  return catalog.flatMap(instance => instance.cidrs.map(cidr => ({ value: JSON.stringify([instance.type, instance.projectId, instance.region, instance.instanceId, cidr]), label: `${cidr} · ${instance.name}` })));
}

function connectionChoices(rows: Record<string, unknown>[]) {
  return rows.filter(row => row.status === "ACTIVE" && row.admin_state_up === true).map(row => ({ value: asString(row.id), label: `${firstString([row.name], asString(row.id))} · ${firstString([row.used_scene], "")}` }));
}

function selectedRegions(value: unknown) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item)) throw new ManagementInputError("Select exactly two different regions for the inter-region bandwidth.");
  const selected = [...new Set(value as string[])];
  if (selected.length !== 2) throw new ManagementInputError("Select exactly two different regions for the inter-region bandwidth.");
  return selected;
}

const operations: ManagementOperation[] = [
  { id: "create-connection", label: "Create cloud connection", kind: "create", description: "Create an account-scoped cloud connection container for cross-region networking.", fields: [nameField, descriptionField, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }], impact: "A cloud connection has no hourly cost. Charges arise only from prepaid bandwidth packages and inter-region bandwidth configured on it later." },
  { id: "inspect-connection", label: "View cloud connection", kind: "inspect", description: "Show the connection's scope, associated resource counts, and propagated routes.", fields: [], resourcePrefixes: ["cc:"] },
  { id: "update-connection", label: "Edit cloud connection", kind: "update", description: "Rename the cloud connection or change its description without touching routing.", fields: [nameField, descriptionField], allowedStatuses: active, resourcePrefixes: ["cc:"] },
  { id: "delete-connection", label: "Delete cloud connection", kind: "delete", description: "Permanently delete a cloud connection after exact-name confirmation, verified dependency counts, and confirmed empty inventories.", fields: [], allowedStatuses: active, resourcePrefixes: ["cc:"], impact: "The cloud connection and its routing configuration are permanently removed. Cross-region connectivity through it stops. Loaded instances, inter-region bandwidths, and bound packages must be removed or unbound first." },
  { id: "attach-instance", label: "Load network instance", kind: "create", description: "Load one of this account's VPCs or Direct Connect virtual gateways into a cloud connection with selected published routes.", fields: [cloudConnectionField, instanceField, cidrsField, descriptionField], impact: "Published routes from this instance propagate through the cloud connection, changing cross-region routing and traffic. Inter-region traffic consumes assigned prepaid bandwidth." },
  { id: "inspect-instance", label: "View network instance", kind: "inspect", description: "Show the instance's type, region, project, published routes, and owning account.", fields: [], resourcePrefixes: ["ni:"] },
  { id: "update-instance", label: "Edit network instance", kind: "update", description: "Rename an owned network instance, change its description, or replace its published routes. Leave routes empty to keep the current ones.", fields: [nameField, descriptionField, { ...cidrsField, required: false, help: "Leave empty to keep the current published routes." }], allowedStatuses: active, resourcePrefixes: ["ni:"], confirmation: true, impact: "Replacing published routes rewrites which CIDRs are routed through the cloud connection. Removed routes stop forwarding immediately." },
  { id: "detach-instance", label: "Unload network instance", kind: "delete", description: "Unload an owned network instance from its cloud connection after exact-name confirmation.", fields: [], allowedStatuses: active, resourcePrefixes: ["ni:"], impact: "Routes published by this instance stop propagating and traffic to those CIDRs through the cloud connection is interrupted." },
  { id: "create-inter-region-bandwidth", label: "Configure inter-region bandwidth", kind: "create", description: "Allocate bandwidth from a prepaid package bound to the cloud connection between two native regions whose areas match the package's areas.", fields: [cloudConnectionField, { key: "bandwidthPackage", label: "Bandwidth package", type: "select", source: "bandwidthPackages", required: true, help: "Only prepaid yearly-monthly packages with bandwidth charging that are ACTIVE, administratively enabled, and already bound to a cloud connection are offered. Packages are purchased in the Cloud Connect console; this operation never orders a new one." }, { key: "regions", label: "Regions", type: "list", source: "regions", required: true, max: 2, help: "Select exactly two different regions whose areas match the package's configured areas." }, bandwidthField], impact: "Allocates prepaid bandwidth from the bound package between the two regions. Inter-region traffic up to this bandwidth starts flowing and consumes the package's capacity, which is shared across all of its inter-region bandwidths." },
  { id: "inspect-bandwidth", label: "View inter-region bandwidth", kind: "inspect", description: "Show the bandwidth's connection, package, regions, and size.", fields: [], resourcePrefixes: ["irb:"] },
  { id: "update-bandwidth", label: "Resize inter-region bandwidth", kind: "update", description: "Change the bandwidth allocated between the two regions within the package's unused capacity.", fields: [bandwidthField], resourcePrefixes: ["irb:"], confirmation: true, impact: "Changing the allocated bandwidth adjusts how much inter-region traffic can flow and how the prepaid package's shared capacity is consumed." },
  { id: "delete-bandwidth", label: "Remove inter-region bandwidth", kind: "delete", description: "Remove an inter-region bandwidth allocation from its cloud connection after exact-name confirmation.", fields: [], resourcePrefixes: ["irb:"], impact: "Inter-region traffic between the two regions is interrupted. The package capacity becomes available for other allocations." },
  { id: "bind-package", label: "Bind bandwidth package", kind: "action", description: "Bind an existing unbound prepaid bandwidth package to this cloud connection.", fields: [packageField], allowedStatuses: active, resourcePrefixes: ["cc:"], impact: "Binds an existing prepaid bandwidth package to this cloud connection. No new purchase is made; the package's prepaid capacity becomes allocatable here." },
  { id: "unbind-package", label: "Unbind bandwidth package", kind: "action", description: "Unbind a bandwidth package that has no inter-region bandwidths on this cloud connection.", fields: [packageField], allowedStatuses: active, resourcePrefixes: ["cc:"], confirmation: true, impact: "Unbinds the prepaid bandwidth package. Its capacity can no longer be allocated to this cloud connection." },
];

export const cloudConnectManagement: ManagementAdapter = {
  title: "Cloud Connect",
  accountWide: true,
  operations,
  inventory: async session => {
    const domainId = await verifiedDomainId(session);
    const [connections, instances, bandwidths] = await Promise.all([connectionRows(session, domainId), instanceRows(session, domainId), interRegionRows(session, domainId)]);
    return [
      ...connections.map(connection => ({
        id: `cc:${asString(connection.id)}`,
        name: firstString([connection.name], asString(connection.id)),
        status: knownStatus(connection.status),
        values: {
          name: firstString([connection.name], ""),
          description: firstString([connection.description], ""),
          usedScene: firstString([connection.used_scene], ""),
          networkInstances: Number(connection.network_instance_number) || 0,
          bandwidthPackages: Number(connection.bandwidth_package_number) || 0,
          interRegionBandwidths: Number(connection.inter_region_bandwidth_number) || 0,
        },
      })),
      ...instances.map(instance => ({
        id: `ni:${asString(instance.id)}`,
        name: firstString([instance.name], asString(instance.id)),
        status: knownStatus(instance.status),
        values: {
          type: firstString([instance.type], ""),
          instanceId: firstString([instance.instance_id], ""),
          region: firstString([instance.region_id], ""),
          project: firstString([instance.project_id], ""),
          cloudConnection: firstString([instance.cloud_connection_id], ""),
          owned: instance.instance_domain_id === domainId,
          cidrs: asArray(instance.cidrs).map(String).join(", "),
        },
      })),
      ...bandwidths.map(bandwidth => {
        const [local, remote] = regionPairOf(bandwidth);
        return {
          id: `irb:${asString(bandwidth.id)}`,
          name: firstString([bandwidth.name], asString(bandwidth.id)),
          status: "Available",
          values: {
            cloudConnection: firstString([bandwidth.cloud_connection_id], ""),
            bandwidthPackage: firstString([bandwidth.bandwidth_package_id], ""),
            regions: `${local}/${remote}`,
            bandwidth: bandwidth.bandwidth as number,
          },
        };
      }),
    ];
  },
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "attach-instance") {
      const domainId = await verifiedDomainId(session);
      const [connections, catalog] = await Promise.all([connectionRows(session, domainId), ownedInstanceCatalog(session)]);
      return {
        cloudConnections: connectionChoices(connections),
        instances: catalog.map(instance => ({ value: JSON.stringify([instance.type, instance.projectId, instance.region, instance.instanceId]), label: `${instance.name} · ${instance.type === "vpc" ? "VPC" : "Virtual gateway"} · ${instance.region}` })),
        instanceCidrs: instanceCidrChoices(catalog),
      };
    }
    if (operation === "create-inter-region-bandwidth") {
      const domainId = await verifiedDomainId(session);
      const [connections, packages, regions] = await Promise.all([connectionRows(session, domainId), packageRows(session, domainId), regionRows(session, domainId)]);
      const names = new Map(connections.map(row => [asString(row.id), firstString([row.name], asString(row.id))]));
      return {
        cloudConnections: connectionChoices(connections),
        bandwidthPackages: packages.filter(row => !!typedString(row.resource_id) && prepaidPackage(row) && !!packageAreas(row) && knownCount(row.bandwidth) !== undefined).map(row => {
          const binding = typedString(row.resource_id)!;
          const areas = packageAreas(row)!;
          return { value: asString(row.id), label: `${firstString([row.name], asString(row.id))} · ${knownCount(row.bandwidth)} Mbit/s · ${areas[0]} ↔ ${areas[1]} · bound to ${names.get(binding) ?? binding}` };
        }),
        regions: regions.filter(row => !!typedString(row.area_id)).map(row => ({ value: asString(row.id), label: `${firstString([row.name], asString(row.id))} · ${asString(row.id)} · ${asArray(row.used_scenes).map(String).join("/") || "vpc"}` })),
      };
    }
    if (operation === "bind-package" || operation === "unbind-package") {
      if (!resource) return {};
      const cloudConnectionId = connectionIdOf(resource);
      const domainId = await verifiedDomainId(session);
      if (operation === "unbind-package") {
        const packages = await packageRows(session, domainId, cloudConnectionId);
        return { packages: packages.filter(row => typedString(row.resource_id) === cloudConnectionId && prepaidPackage(row)).map(row => ({ value: asString(row.id), label: `${firstString([row.name], asString(row.id))} · ${knownCount(row.bandwidth) ?? 0} Mbit/s` })) };
      }
      const packages = await packageRows(session, domainId);
      return { packages: packages.filter(row => !typedString(row.resource_id) && prepaidPackage(row)).map(row => ({ value: asString(row.id), label: `${firstString([row.name], asString(row.id))} · ${knownCount(row.bandwidth) ?? 0} Mbit/s · unbound` })) };
    }
    if (operation === "update-instance" && resource) {
      const domainId = await verifiedDomainId(session);
      const record = await instanceRecord(session, domainId, instanceIdOf(resource));
      if (record.instance_domain_id !== domainId) return {};
      const instanceId = typedString(record.instance_id) ?? "";
      const type = typedString(record.type) ?? "";
      const projectId = typedString(record.project_id) ?? "";
      const region = typedString(record.region_id) ?? "";
      if (!instanceId || (type !== "vpc" && type !== "vgw") || !projectId || !region) return {};
      const instance = (await ownedInstanceCatalog(session)).find(candidate => candidate.instanceId === instanceId && candidate.type === type && candidate.projectId === projectId && candidate.region === region);
      if (!instance) return {};
      return { instanceCidrs: instanceCidrChoices([instance]) };
    }
    return {};
  },
  invalidationKeys: () => [cloudCacheKeys.listCloudConnections, cloudCacheKeys.summary],
  poll: async (session, entry) => {
    const target = entry.resultResourceId ?? entry.resourceId ?? "";
    const creating = ["Create cloud connection", "Load network instance", "Configure inter-region bandwidth"].includes(entry.operation);
    const deleting = ["Delete cloud connection", "Unload network instance", "Remove inter-region bandwidth"].includes(entry.operation);
    if (!creating && !deleting) throw new ManagementInputError("This operation has no Cloud Connect resource-state observation.");
    const prefix = entry.operation.includes("cloud connection") ? "cc:" : entry.operation.includes("network instance") ? "ni:" : "irb:";
    if (!target.startsWith(prefix)) throw new ManagementInputError("This history entry has a different Cloud Connect operation identity.");
    const nativeId = target.slice(prefix.length);
    if (!nativeId || nativeId !== entry.jobId) throw new ManagementInputError("This history entry has a different Cloud Connect resource identity.");
    const domainId = await verifiedDomainId(session);
    let record: Record<string, unknown>;
    try {
      if (prefix === "cc:") record = await connectionRecord(session, domainId, nativeId);
      else if (prefix === "ni:") record = await instanceRecord(session, domainId, nativeId);
      else record = await interRegionRecord(session, domainId, nativeId);
    } catch (error) {
      if (error instanceof HuaweiApiError && error.status === 404) return deleting ? { state: "succeeded", message: "The original resource is no longer present in native inventory.", resourceId: target } : { state: "failed", message: "The original resource is no longer present in native inventory." };
      throw error;
    }
    if (deleting) return { state: "submitted", message: "Deletion was accepted, but the original resource is still present." };
    if (prefix === "ni:") {
      const status = firstString([record.status], "");
      if (status === "ACTIVE") return { state: "succeeded", message: "The original network instance reports ACTIVE. This confirms cloud configuration; reachability also depends on inter-region bandwidth and routes.", resourceId: target };
      if (status === "ERROR") return { state: "failed", message: "The original network instance reports an unsuccessful native state. Inspect its configuration before retrying." };
      return { state: "submitted", message: "The original network instance has not reached a verified ACTIVE state." };
    }
    if (prefix === "cc:") {
      if (firstString([record.status], "") === "ACTIVE") return { state: "succeeded", message: "The original cloud connection reports ACTIVE.", resourceId: target };
      return { state: "submitted", message: "The original cloud connection has not reached a verified ACTIVE state." };
    }
    if (interRegionConfigComplete(record)) return { state: "succeeded", message: "The original inter-region bandwidth reports a complete native configuration. Inter-region forwarding also depends on the bound package and loaded instances.", resourceId: target };
    return { state: "submitted", message: "The original inter-region bandwidth has not reported a complete native configuration." };
  },
  execute: async (session, operation, values, resource) => {
    const domainId = await verifiedDomainId(session);
    if (operation === "create-connection") {
      const body: Record<string, unknown> = { name: String(values.name), enterprise_project_id: String(values.enterpriseProjectId ?? "0") };
      if (values.description !== undefined) body.description = String(values.description);
      const response = await ccFetch<Record<string, unknown>>(session, domainId, "/cloud-connections", { method: "POST", body: JSON.stringify({ cloud_connection: body }) });
      const { id } = verifiedAcknowledgement(response, "cloud_connection", domainId);
      return { message: "Cloud connection creation accepted. Observe its native status before loading network instances.", resourceId: `cc:${id}`, jobId: id, asynchronous: true };
    }
    if (operation === "inspect-connection") {
      const id = connectionIdOf(resource);
      const [record, routes] = await Promise.all([connectionRecord(session, domainId, id), routeRows(session, domainId, id)]);
      return { message: "Cloud connection details loaded.", facts: [
        { label: "Status", value: knownStatus(record.status) },
        { label: "Admin state", value: record.admin_state_up === false ? "Down" : record.admin_state_up === true ? "Up" : "Unknown" },
        { label: "Used scene", value: firstString([record.used_scene], "-") },
        { label: "Enterprise project", value: firstString([record.enterprise_project_id], "-") },
        { label: "Network instances", value: String(record.network_instance_number ?? "-") },
        { label: "Bandwidth packages", value: String(record.bandwidth_package_number ?? "-") },
        { label: "Inter-region bandwidths", value: String(record.inter_region_bandwidth_number ?? "-") },
        { label: "Created", value: firstString([record.created_at], "-") },
        { label: "Updated", value: firstString([record.updated_at], "-") },
        ...routes.map(route => ({ label: `Route · ${firstString([route.destination], "-")}`, value: `${firstString([route.region_id], "-")} · ${firstString([route.type], "-")}` })),
      ] };
    }
    if (operation === "update-connection") {
      const id = connectionIdOf(resource);
      const record = await connectionRecord(session, domainId, id);
      assertReady(record, "cloud connection");
      const body: Record<string, unknown> = { name: String(values.name) };
      if (values.description !== undefined) body.description = String(values.description);
      const response = await ccFetch<Record<string, unknown>>(session, domainId, `/cloud-connections/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ cloud_connection: body }) });
      verifiedAcknowledgement(response, "cloud_connection", domainId, id);
      return { message: "Cloud connection metadata update accepted. Inspect the cloud connection to verify the change.", resourceId: resource!.id };
    }
    if (operation === "delete-connection") {
      const id = connectionIdOf(resource);
      const record = await connectionRecord(session, domainId, id);
      assertExactName(record, resource!, "cloud connection");
      assertReady(record, "cloud connection");
      const [instances, bandwidths, packages] = await Promise.all([instanceRows(session, domainId, id), interRegionRows(session, domainId, id), packageRows(session, domainId, id)]);
      const instanceCount = dependencyCount(record, "network_instance_number");
      const bandwidthCount = dependencyCount(record, "inter_region_bandwidth_number");
      const packageCount = dependencyCount(record, "bandwidth_package_number");
      if (instanceCount !== instances.length || bandwidthCount !== bandwidths.length || packageCount !== packages.length) throw new ManagementInputError("Huawei reported dependency counts that disagree with the fresh inventories. Refresh the cloud connection list and retry.", 409);
      if (instances.length) throw new ManagementInputError(`The cloud connection still has ${instances.length} loaded network instance${instances.length === 1 ? "" : "s"}. Unload them first.`, 409);
      if (bandwidths.length) throw new ManagementInputError(`The cloud connection still has ${bandwidths.length} inter-region bandwidth${bandwidths.length === 1 ? "" : "s"}. Remove them first.`, 409);
      if (packages.length) throw new ManagementInputError(`The cloud connection still has ${packages.length} bound bandwidth package${packages.length === 1 ? "" : "s"}. Unbind them first.`, 409);
      await ccFetch(session, domainId, `/cloud-connections/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { message: "Cloud connection deletion accepted; observe removal from native inventory.", resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    if (operation === "attach-instance") {
      const cloudConnectionId = String(values.cloudConnection ?? "");
      const connections = await connectionRows(session, domainId);
      const connection = connections.find(row => asString(row.id) === cloudConnectionId);
      if (!connection) throw new ManagementInputError("The selected cloud connection is no longer available.", 404);
      if (connection.status !== "ACTIVE" || connection.admin_state_up !== true) throw new ManagementInputError(`The cloud connection is ${knownStatus(connection.status)}; wait until it is ACTIVE.`, 409);
      const selection = parseInstanceSelection(String(values.instance ?? ""));
      const instance = (await ownedInstanceCatalog(session)).find(candidate => candidate.type === selection.type && candidate.projectId === selection.projectId && candidate.region === selection.region && candidate.instanceId === selection.instanceId);
      if (!instance) throw new ManagementInputError("The selected network instance is no longer available in this account's projects.", 404);
      const cidrSelection = Array.isArray(values.cidrs) ? values.cidrs : [];
      if (cidrSelection.some(item => typeof item !== "string")) throw new ManagementInputError("Select routes from the provided network instance list.");
      const cidrs = parseCidrSelection(cidrSelection as string[], instance);
      if (!cidrs.length) throw new ManagementInputError("Select at least one route to publish.");
      for (const cidr of cidrs) if (!instance.cidrs.includes(cidr)) throw new ManagementInputError(`The route ${cidr} is no longer available on the selected network instance.`, 404);
      const loaded = await instanceRows(session, domainId, cloudConnectionId);
      if (loaded.some(row => row.instance_id === instance.instanceId && row.type === instance.type)) throw new ManagementInputError("This network instance is already loaded in the selected cloud connection.", 409);
      const response = await ccFetch<Record<string, unknown>>(session, domainId, "/network-instances", { method: "POST", body: JSON.stringify({ network_instance: {
        name: instance.name,
        ...(values.description ? { description: String(values.description) } : {}),
        instance_id: instance.instanceId,
        instance_domain_id: domainId,
        project_id: instance.projectId,
        region_id: instance.region,
        cloud_connection_id: cloudConnectionId,
        type: instance.type,
        cidrs,
      } }) });
      const { id, record } = verifiedAcknowledgement(response, "network_instance", domainId);
      const ackCidrs = asArray(record.cidrs);
      if (record.cloud_connection_id !== cloudConnectionId || record.instance_id !== instance.instanceId || record.type !== instance.type || record.project_id !== instance.projectId || record.region_id !== instance.region || record.instance_domain_id !== domainId || ackCidrs.length !== cidrs.length || ackCidrs.some(item => typeof item !== "string") || !cidrs.every(cidr => ackCidrs.includes(cidr))) throw new Error("Huawei returned an unverified network instance acknowledgement. Check native state before retrying.");
      return { message: "Network instance loading accepted. Observe its native status; published routes propagate through the cloud connection.", resourceId: `ni:${id}`, jobId: id, asynchronous: true };
    }
    if (operation === "inspect-instance") {
      const record = await instanceRecord(session, domainId, instanceIdOf(resource));
      return { message: "Network instance details loaded.", facts: [
        { label: "Type", value: record.type === "vgw" ? "Virtual gateway" : "VPC" },
        { label: "Instance", value: firstString([record.instance_id], "-") },
        { label: "Region", value: firstString([record.region_id], "-") },
        { label: "Project", value: firstString([record.project_id], "-") },
        { label: "Cloud connection", value: firstString([record.cloud_connection_id], "-") },
        { label: "Owning account", value: record.instance_domain_id === domainId ? "This account" : firstString([record.instance_domain_id], "-") },
        { label: "Published routes", value: asArray(record.cidrs).map(String).join(", ") || "None" },
        { label: "Status", value: knownStatus(record.status) },
        { label: "Created", value: firstString([record.created_at], "-") },
        { label: "Updated", value: firstString([record.updated_at], "-") },
      ] };
    }
    if (operation === "update-instance") {
      const id = instanceIdOf(resource);
      const record = await instanceRecord(session, domainId, id);
      assertOwnedInstance(record, domainId);
      assertReady(record, "network instance");
      const parentId = typedString(record.cloud_connection_id);
      if (!parentId) throw new ManagementInputError("Huawei returned an unverified network instance parent.", 409);
      const parent = await connectionRecord(session, domainId, parentId);
      if (parent.status !== "ACTIVE" || parent.admin_state_up !== true) throw new ManagementInputError("The cloud connection for this network instance is not ACTIVE.", 409);
      const instanceId = typedString(record.instance_id) ?? "";
      const type = typedString(record.type) ?? "";
      const projectId = typedString(record.project_id) ?? "";
      const region = typedString(record.region_id) ?? "";
      const instance = (await ownedInstanceCatalog(session)).find(candidate => candidate.instanceId === instanceId && candidate.type === type && candidate.projectId === projectId && candidate.region === region);
      if (!instance) throw new ManagementInputError("The network instance's live source is no longer accessible in this session.", 409);
      const body: Record<string, unknown> = { name: String(values.name) };
      if (values.description !== undefined) body.description = String(values.description);
      if (Array.isArray(values.cidrs) && values.cidrs.length) {
        if (values.cidrs.some(item => typeof item !== "string")) throw new ManagementInputError("Select routes from the provided network instance list.");
        const cidrs = parseCidrSelection(values.cidrs as string[], instance);
        for (const cidr of cidrs) if (!instance.cidrs.includes(cidr)) throw new ManagementInputError(`The route ${cidr} is no longer available on the network instance.`, 404);
        body.cidrs = cidrs;
      }
      const response = await ccFetch<Record<string, unknown>>(session, domainId, `/network-instances/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ network_instance: body }) });
      verifiedAcknowledgement(response, "network_instance", domainId, id);
      return { message: "Network instance update accepted. Inspect its current routes to verify the change.", resourceId: resource!.id };
    }
    if (operation === "detach-instance") {
      const id = instanceIdOf(resource);
      const record = await instanceRecord(session, domainId, id);
      assertOwnedInstance(record, domainId);
      assertReady(record, "network instance");
      assertExactName(record, resource!, "network instance");
      await ccFetch(session, domainId, `/network-instances/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { message: "Network instance unload accepted. Published routes stop propagating; observe native removal.", resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    if (operation === "create-inter-region-bandwidth") {
      const cloudConnectionId = String(values.cloudConnection ?? "");
      const connections = await connectionRows(session, domainId);
      const connection = connections.find(row => asString(row.id) === cloudConnectionId);
      if (!connection) throw new ManagementInputError("The selected cloud connection is no longer available.", 404);
      if (connection.status !== "ACTIVE" || connection.admin_state_up !== true) throw new ManagementInputError(`The cloud connection is ${knownStatus(connection.status)}; wait until it is ACTIVE.`, 409);
      const packageId = String(values.bandwidthPackage ?? "");
      const pkg = (await packageRows(session, domainId)).find(row => asString(row.id) === packageId);
      if (!pkg) throw new ManagementInputError("The selected bandwidth package is no longer available.", 404);
      if (typedString(pkg.resource_id) !== cloudConnectionId) throw new ManagementInputError("The selected bandwidth package is not bound to this cloud connection. Bind it first.", 409);
      assertPrepaidPackage(pkg);
      const capacity = packageCapacity(pkg);
      const areas = packageAreas(pkg);
      const regions = await regionRows(session, domainId);
      const selected = selectedRegions(values.regions);
      for (const region of selected) if (!regions.some(row => asString(row.id) === region)) throw new ManagementInputError(`Region ${region} is not in the native Cloud Connect region catalog.`, 404);
      const selectedAreas = selected.map(region => regionArea(regions.find(row => asString(row.id) === region)!));
      if (!areas || sortedPair(areas) !== sortedPair(selectedAreas)) throw new ManagementInputError("The bandwidth package does not cover the selected regions' areas. Select two regions within the package's configured areas.", 409);
      const bandwidth = values.bandwidth;
      if (typeof bandwidth !== "number" || !Number.isSafeInteger(bandwidth) || bandwidth < 1) throw new ManagementInputError("Enter the inter-region bandwidth in Mbit/s (at least 1).");
      const { total, pairs } = await packageAllocations(session, domainId, packageId);
      if (pairs.some(pair => sortedPair(pair) === sortedPair(selected))) throw new ManagementInputError("An inter-region bandwidth between these regions already exists for this package.", 409);
      if (total + bandwidth > capacity) throw new ManagementInputError(`The requested bandwidth exceeds the package's unused capacity. The package has ${capacity} Mbit/s total capacity and ${total} Mbit/s is already allocated to inter-region bandwidths.`, 409);
      const response = await ccFetch<Record<string, unknown>>(session, domainId, "/inter-region-bandwidths", { method: "POST", body: JSON.stringify({ inter_region_bandwidth: { cloud_connection_id: cloudConnectionId, bandwidth_package_id: packageId, bandwidth, inter_region_ids: selected } }) });
      const { id, record } = verifiedAcknowledgement(response, "inter_region_bandwidth", domainId);
      let ackPair: string[];
      try { ackPair = regionPairOf(record); } catch { throw new Error("Huawei returned an unverified inter-region bandwidth acknowledgement. Check native state before retrying."); }
      if (record.cloud_connection_id !== cloudConnectionId || record.bandwidth_package_id !== packageId || record.bandwidth !== bandwidth || sortedPair(ackPair) !== sortedPair(selected)) throw new Error("Huawei returned an unverified inter-region bandwidth acknowledgement. Check native state before retrying.");
      return { message: "Inter-region bandwidth configuration accepted. Observe native state; inter-region traffic uses the package's prepaid capacity.", resourceId: `irb:${id}`, jobId: id, asynchronous: true };
    }
    if (operation === "inspect-bandwidth") {
      const record = await interRegionRecord(session, domainId, bandwidthIdOf(resource));
      const [local, remote] = regionPairOf(record);
      return { message: "Inter-region bandwidth details loaded.", facts: [
        { label: "Cloud connection", value: firstString([record.cloud_connection_id], "-") },
        { label: "Bandwidth package", value: firstString([record.bandwidth_package_id], "-") },
        { label: "Regions", value: `${local} ↔ ${remote}` },
        { label: "Bandwidth", value: record.bandwidth ? `${Number(record.bandwidth)} Mbit/s` : "-" },
        { label: "Created", value: firstString([record.created_at], "-") },
        { label: "Updated", value: firstString([record.updated_at], "-") },
      ] };
    }
    if (operation === "update-bandwidth") {
      const id = bandwidthIdOf(resource);
      const record = await interRegionRecord(session, domainId, id);
      const { pkg } = await verifiedInterRegionParents(session, domainId, record);
      const bandwidth = values.bandwidth;
      if (typeof bandwidth !== "number" || !Number.isSafeInteger(bandwidth) || bandwidth < 1) throw new ManagementInputError("Enter the inter-region bandwidth in Mbit/s (at least 1).");
      if (bandwidth === record.bandwidth) throw new ManagementInputError(`The new bandwidth must differ from the current ${String(record.bandwidth)} Mbit/s.`, 409);
      const capacity = packageCapacity(pkg);
      const { total } = await packageAllocations(session, domainId, asString(record.bandwidth_package_id), id);
      if (total + bandwidth > capacity) throw new ManagementInputError(`The requested bandwidth exceeds the package's unused capacity. The package has ${capacity} Mbit/s total capacity and ${total} Mbit/s is already allocated to other inter-region bandwidths.`, 409);
      const response = await ccFetch<Record<string, unknown>>(session, domainId, `/inter-region-bandwidths/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ inter_region_bandwidth: { bandwidth } }) });
      verifiedAcknowledgement(response, "inter_region_bandwidth", domainId, id);
      return { message: "Inter-region bandwidth update accepted. Inspect it to verify the new allocation.", resourceId: resource!.id };
    }
    if (operation === "delete-bandwidth") {
      const id = bandwidthIdOf(resource);
      const record = await interRegionRecord(session, domainId, id);
      assertExactName(record, resource!, "inter-region bandwidth");
      await verifiedInterRegionParents(session, domainId, record);
      await ccFetch(session, domainId, `/inter-region-bandwidths/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { message: "Inter-region bandwidth removal accepted. Inter-region traffic between its regions stops; observe native removal.", resourceId: resource!.id, jobId: id, asynchronous: true };
    }
    if (operation === "bind-package") {
      const cloudConnectionId = connectionIdOf(resource);
      const connection = await connectionRecord(session, domainId, cloudConnectionId);
      assertReady(connection, "cloud connection");
      if (connection.admin_state_up !== true) throw new ManagementInputError("The cloud connection must be administratively enabled.", 409);
      const packageId = String(values.package ?? "");
      const pkg = (await packageRows(session, domainId)).find(row => asString(row.id) === packageId);
      if (!pkg) throw new ManagementInputError("The selected bandwidth package is no longer available.", 404);
      if (typedString(pkg.resource_id)) throw new ManagementInputError("The selected bandwidth package is already bound to a cloud connection.", 409);
      assertPrepaidPackage(pkg);
      const response = await ccFetch<Record<string, unknown>>(session, domainId, `/bandwidth-packages/${encodeURIComponent(packageId)}/associate`, { method: "POST", body: JSON.stringify({ bandwidth_package: { resource_id: cloudConnectionId, resource_type: "cloud_connection" } }) });
      const { record } = verifiedAcknowledgement(response, "bandwidth_package", domainId, packageId);
      if (record.resource_id !== cloudConnectionId || record.resource_type !== "cloud_connection") throw new Error("Huawei returned an unverified bandwidth package binding. Check native state before retrying.");
      return { message: "Bandwidth package bound to this cloud connection. No new purchase was made.", resourceId: resource!.id };
    }
    if (operation === "unbind-package") {
      const cloudConnectionId = connectionIdOf(resource);
      const connection = await connectionRecord(session, domainId, cloudConnectionId);
      assertReady(connection, "cloud connection");
      if (connection.admin_state_up !== true) throw new ManagementInputError("The cloud connection must be administratively enabled.", 409);
      const packageId = String(values.package ?? "");
      const pkg = (await packageRows(session, domainId, cloudConnectionId)).find(row => asString(row.id) === packageId);
      if (!pkg) throw new ManagementInputError("The selected bandwidth package is no longer bound to this cloud connection.", 404);
      if (typedString(pkg.resource_id) !== cloudConnectionId) throw new ManagementInputError("The selected bandwidth package is bound to a different cloud connection.", 409);
      assertPrepaidPackage(pkg);
      const bandwidths = await interRegionRows(session, domainId, cloudConnectionId);
      if (bandwidths.some(row => row.bandwidth_package_id === packageId)) throw new ManagementInputError("Remove the inter-region bandwidths using this package first.", 409);
      const response = await ccFetch<Record<string, unknown>>(session, domainId, `/bandwidth-packages/${encodeURIComponent(packageId)}/disassociate`, { method: "POST", body: JSON.stringify({ bandwidth_package: { resource_id: cloudConnectionId, resource_type: "cloud_connection" } }) });
      const { record } = verifiedAcknowledgement(response, "bandwidth_package", domainId, packageId);
      const remaining = typedString(record.resource_id);
      if (remaining === undefined || remaining === cloudConnectionId) throw new Error("Huawei returned an unverified bandwidth package unbinding. Check native state before retrying.");
      return { message: "Bandwidth package unbound from this cloud connection.", resourceId: resource!.id };
    }
    throw new ManagementInputError("Unsupported Cloud Connect operation.");
  },
};
