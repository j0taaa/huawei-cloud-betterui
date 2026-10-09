import "server-only";

import { createHash } from "node:crypto";

import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementHistoryEntry } from "@/lib/management-contract";
import { HuaweiApiError } from "@/lib/huawei/http";
import { serviceEndpoint } from "@/lib/huawei/endpoints";
import { asRecord, firstString } from "@/lib/huawei/parsers";

function rmsNativeEndpoint(region: string) {
  const verified = region === "eu-west-101" ? "https://rms.eu-west-101.myhuaweicloud.com" : "https://rms.myhuaweicloud.com";
  return (process.env.HUAWEI_RMS_ENDPOINT ?? verified).replace(/\/+$/, "");
}

function hcssNativeEndpoint(region: string) {
  return (process.env.HUAWEI_HCSS_ENDPOINT ?? `https://hcss.${region}.myhuaweicloud.com`).replace(/\/+$/, "");
}

/** Native identities and names are typed strings; they are never coerced from other JSON shapes. */
function nativeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Documented native dimensions only: real numbers or digit strings, never Number() coercion of false/null. */
function nativePositiveInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Sanitizing transport for every native Flexus request: HTTP rejections keep only their status,
 * network, stream, and non-JSON failures become generic errors, a business failure inside a 200
 * body is a definitive rejection before any write but an uncertain outcome after one, and raw
 * payloads (including request secrets) are never surfaced. A job poll body may carry its failure
 * fields only for an actual failed job state; anything else is a business failure.
 */
async function flexusNativeFetch<T>(
  base: string,
  path: string,
  token: string,
  init?: RequestInit,
  options?: { jobBody?: boolean },
): Promise<T> {
  const write = Boolean(init?.method && init.method !== "GET");
  const headers = new Headers({ "Content-Type": "application/json;charset=utf8", "X-Auth-Token": token });
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, cache: "no-store", headers });
  } catch {
    throw new Error(
      write
        ? "Huawei could not be reached for this Flexus change. The change may or may not have been applied; check the current state in the native console before retrying."
        : "Huawei could not be reached for this Flexus request. Check connectivity and retry.",
    );
  }
  if (!response.ok) {
    throw new HuaweiApiError(`Huawei rejected this Flexus console request (HTTP ${response.status}). Check the current state in the native console.`, response.status);
  }
  let payload: string;
  try {
    payload = await response.text();
  } catch {
    throw new Error(
      write
        ? "Huawei returned an unverifiable response for this Flexus change. The change may or may not have been applied; check the current state in the native console before retrying."
        : "Huawei returned an unverifiable response for this Flexus request. Check the current state in the native console.",
    );
  }
  let body: unknown;
  try {
    body = payload.trim() ? JSON.parse(payload) : {};
  } catch {
    throw new Error(
      write
        ? "Huawei returned an unverifiable response for this Flexus change. The change may or may not have been applied; check the current state in the native console before retrying."
        : "Huawei returned an unverifiable response (not valid JSON). Check the current state in the native console.",
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Huawei returned an unverifiable Flexus response shape.");
  const record = body as Record<string, unknown>;
  const businessFailureIn = (scope: Record<string, unknown>) =>
    Object.hasOwn(scope, "error") ||
    (Object.hasOwn(scope, "error_code") && scope.error_code !== 0 && scope.error_code !== "0") ||
    Object.hasOwn(scope, "error_msg");
  const businessFailure = businessFailureIn(record) || businessFailureIn(asRecord(record.data));
  if (businessFailure && !(options?.jobBody && record.status === "FAIL")) {
    if (write) throw new Error("Huawei reported a Flexus business failure. The change may or may not have been applied; verify the current state in the native console before retrying.");
    throw new ManagementInputError("Huawei rejected this Flexus request in its response body.", 409);
  }
  return body as T;
}

/**
 * The account-wide L catalog is only trusted after the account token is proven against IAM as an
 * unscoped account token: a project scope (even a null one), a mismatched user domain, or a
 * different current user all block the account plane.
 */
export async function verifyFlexusAccountDomain(session: BetterUiSession): Promise<string> {
  const accountToken = typeof session.accountToken === "string" ? session.accountToken.trim() : "";
  if (!accountToken) throw new ManagementInputError("This sign-in has no verifiable account token. Sign out and sign in again to administer Flexus.", 409);
  const body = await flexusNativeFetch<Record<string, unknown>>(session.iamEndpoint.replace(/\/+$/, ""), "/v3/auth/tokens", accountToken, {
    headers: { "X-Subject-Token": accountToken },
  });
  const token = asRecord(body.token);
  if (Object.hasOwn(token, "project")) {
    throw new ManagementInputError("The sign-in token is scoped to a project instead of the account. Sign out and sign in again to administer Flexus.", 409);
  }
  const domainId = nativeString(asRecord(token.domain).id);
  if (!domainId || typeof session.userId !== "string" || !session.userId.trim() || asRecord(asRecord(token.user).domain).id !== domainId || asRecord(token.user).id !== session.userId) {
    throw new ManagementInputError("Unable to verify this account's IAM domain for Flexus. Sign out and sign in again.", 409);
  }
  return domainId;
}

function assertFlexusProjectScope(projectId: string, container: Record<string, unknown>) {
  for (const key of ["project_id", "projectId", "tenant_id"]) if (Object.hasOwn(container, key) && container[key] !== projectId) throw new Error("Huawei returned a Flexus response outside the exactly selected project.");
}

export type FlexusLNativeInstance = {
  bundleId: string;
  serverId: string;
  name: string;
  projectId: string;
  region: string;
  chargingMode: "" | "prePaid";
};

/** Any provided domain scope (top level, data, or row) must be exactly the proven account domain. */
function assertRmsDomainScope(scope: Record<string, unknown>, domainId: string) {
  for (const key of ["domain_id", "domainId"]) {
    if (Object.hasOwn(scope, key) && scope[key] !== domainId) {
      throw new ManagementInputError("Huawei returned a Flexus L catalog outside the verified account domain.", 409);
    }
  }
}

/**
 * Native Flexus L inventory: account-wide RMS Config catalog for hcss.l-instance, strictly paged by
 * page_info.current_count plus the next_marker null terminator. This native API has no total, so a
 * total is never read or invented. Every row is validated exactly (provider, type, region, domain,
 * non-empty project, typed identity and name, no duplicates) before a valid foreign project row is
 * filtered after the account proof; rows of other projects in the region are expected and are never
 * treated as API failures, while malformed rows can never be silently skipped.
 */
async function collectNativeFlexusLInstances(session: BetterUiSession): Promise<FlexusLNativeInstance[]> {
  const domainId = await verifyFlexusAccountDomain(session);
  const accountToken = String(session.accountToken).trim();
  const base = rmsNativeEndpoint(session.region);
  const collected: FlexusLNativeInstance[] = [];
  const seenBundleIds = new Set<string>();
  const seenMarkers = new Set<string>();
  let marker: string | undefined;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ type: "hcss.l-instance", region_id: session.region, limit: "100" });
    if (marker) query.set("marker", marker);
    const body = await flexusNativeFetch<Record<string, unknown>>(
      base,
      `/v1/resource-manager/domains/${encodeURIComponent(domainId)}/all-resources?${query.toString()}`,
      accountToken,
    );
    assertRmsDomainScope(body, domainId);
    assertRmsDomainScope(asRecord(body.data), domainId);
    const rows = body.resources;
    if (!Array.isArray(rows)) throw new ManagementInputError("Huawei returned no Flexus L resource array for this page.", 409);
    const pageInfo = asRecord(body.page_info);
    const currentCount = pageInfo.current_count;
    if (typeof currentCount !== "number" || !Number.isSafeInteger(currentCount) || currentCount < 0) {
      throw new ManagementInputError("Huawei returned a Flexus L page without a verified current_count.", 409);
    }
    if (currentCount !== rows.length) throw new ManagementInputError("Huawei returned a Flexus L page whose current_count does not match its resources.", 409);
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new ManagementInputError("Huawei returned a Flexus L resource with an unexpected shape.", 409);
      }
      const record = row as Record<string, unknown>;
      if (record.provider !== "hcss" || record.type !== "l-instance") {
        throw new ManagementInputError("Huawei returned a Flexus L resource with an unexpected provider or type.", 409);
      }
      if (record.region_id !== session.region) {
        throw new ManagementInputError("Huawei returned a Flexus L resource outside the selected region.", 409);
      }
      assertRmsDomainScope(record, domainId);
      const rowProjectId = nativeString(record.project_id);
      if (!rowProjectId) throw new ManagementInputError("Huawei returned a Flexus L resource without a verified project.", 409);
      const bundleId = nativeString(record.id);
      const name = nativeString(record.name);
      if (!bundleId || !name) throw new ManagementInputError("Huawei returned a Flexus L resource without a verified identity or name.", 409);
      if (seenBundleIds.has(bundleId)) throw new ManagementInputError("Huawei returned a duplicate Flexus L bundle identity.", 409);
      seenBundleIds.add(bundleId);
      if (rowProjectId !== session.projectId) continue;
      const properties = asRecord(record.properties);
      if (!Array.isArray(properties.resources)) {
        throw new ManagementInputError("Huawei returned a Flexus L bundle without its native resources array.", 409);
      }
      const ecsLinks = properties.resources.filter((resource) => asRecord(resource).logical_resource_type === "huaweicloudinternal_ecs_instance");
      if (ecsLinks.length !== 1) {
        throw new ManagementInputError(
          ecsLinks.length === 0
            ? "Huawei returned a Flexus L bundle without its native server identity."
            : "Huawei returned a Flexus L bundle with an ambiguous native server identity.",
          409,
        );
      }
      const serverId = nativeString(asRecord(ecsLinks[0]).physical_resource_id);
      if (!serverId) throw new ManagementInputError("Huawei returned a Flexus L bundle without its native server identity.", 409);
      const metadata = asRecord(properties.metadata);
      let chargingMode: "" | "prePaid" = "";
      if (Object.hasOwn(metadata, "charging_mode")) {
        if (metadata.charging_mode !== "prePaid") throw new ManagementInputError("Huawei returned a Flexus L bundle with an unexpected charging mode.", 409);
        chargingMode = "prePaid";
      }
      collected.push({ bundleId, serverId, name, projectId: session.projectId, region: session.region, chargingMode });
    }
    const nextMarker = pageInfo.next_marker;
    if (nextMarker === null) return collected;
    if (typeof nextMarker === "string" && nextMarker) {
      if (seenMarkers.has(nextMarker)) throw new ManagementInputError("Huawei repeated a Flexus L pagination marker.", 409);
      seenMarkers.add(nextMarker);
      marker = nextMarker;
      continue;
    }
    throw new ManagementInputError("Huawei returned a Flexus L page without a verified next_marker terminator.", 409);
  }
  throw new Error("The Flexus L inventory exceeded the supported page limit.");
}

export async function listNativeFlexusLInstances(session: BetterUiSession): Promise<FlexusLNativeInstance[]> {
  return collectNativeFlexusLInstances(session);
}

/**
 * Fresh account-plane proof for every L mutation: the original bundle must still be in the selected
 * project's native catalog with its current bundle name and its original bundle-to-server linkage.
 */
export async function findNativeFlexusLBundle(session: BetterUiSession, bundleId: string): Promise<FlexusLNativeInstance> {
  const instances = await collectNativeFlexusLInstances(session);
  const bundle = instances.find((instance) => instance.bundleId === bundleId);
  if (!bundle) {
    throw new ManagementInputError("The selected Flexus L bundle is no longer in the selected project's native catalog. Refresh the inventory and try again.", 409);
  }
  return bundle;
}

const xFlavorGrammar = /^x1(e?)\.(\d+)u\.(\d+)g$/;
const documentedServiceLockActions = new Set(["changeos", "resize", "delete", "attachvolume", "detachvolume", "attachnics", "detachnics", "renewfee"]);
const knownServerStatuses = new Set([
  "ACTIVE",
  "SHUTOFF",
  "BUILD",
  "ERROR",
  "DELETING",
  "REBOOT",
  "HARD_REBOOT",
  "REBUILD",
  "MIGRATING",
  "RESIZE",
  "VERIFY_RESIZE",
  "REVERT_RESIZE",
  "PAUSED",
  "SUSPENDED",
  "FROZEN",
]);
const unknownStatusFact = "Unknown";

type XOffering = { flavor: string; vcpus: number; ramGb: number };

function xOfferingFromName(name: string): XOffering | null {
  const match = xFlavorGrammar.exec(name);
  return match ? { flavor: name, vcpus: Number(match[2]), ramGb: Number(match[3]) } : null;
}

function verifyXCatalogCorrespondence(offering: XOffering, nativeVcpus: number, nativeRamMb: number) {
  if (nativeVcpus !== offering.vcpus || nativeRamMb !== offering.ramGb * 1024) {
    throw new ManagementInputError("Huawei returned a Flexus X server whose CPU and RAM do not correspond to its documented offering.", 409);
  }
}

export type FlexusXNativeInstance = {
  serverId: string;
  name: string;
  projectId: string;
  region: string;
  flavor: string;
  vcpus: number;
  ramGb: number;
  status: string;
};

/**
 * Native Flexus X inventory: the project's ECS catalog keeps only servers whose flavor name matches
 * the documented x1.Nu.Ng / x1e.Nu.Ng grammar, and their native CPU and RAM must be documented
 * native numbers that correspond to that offering. No name or image heuristics are used, non-X ECS
 * servers are left to the ECS console, and a status outside the verified native vocabulary is shown
 * as a static Unknown instead of the raw private value.
 */
export async function listNativeFlexusXInstances(session: BetterUiSession): Promise<FlexusXNativeInstance[]> {
  const base = serviceEndpoint("ecs", session.region);
  const collected: FlexusXNativeInstance[] = [];
  const seen = new Set<string>();
  let offset = 1;
  for (let page = 0; page < 100; page++) {
    const body = await flexusNativeFetch<Record<string, unknown>>(
      base,
      `/v1/${encodeURIComponent(session.projectId)}/cloudservers/detail?limit=100&offset=${offset}`,
      session.token,
    );
    assertFlexusProjectScope(session.projectId, body);
    assertFlexusProjectScope(session.projectId, asRecord(body.data));
    const rows = body.servers;
    if (!Array.isArray(rows)) throw new ManagementInputError("Huawei returned no Flexus X server array for this page.", 409);
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new ManagementInputError("Huawei returned a Flexus X server with an unexpected shape.", 409);
      }
      const record = row as Record<string, unknown>;
      if (record.tenant_id !== session.projectId) throw new ManagementInputError("Huawei returned a server outside the exactly selected project.", 409);
      assertFlexusProjectScope(session.projectId, record);
      const flavor = asRecord(record.flavor);
      const offering = xOfferingFromName(firstString([flavor.name], ""));
      if (!offering) continue;
      const nativeVcpus = nativePositiveInteger(flavor.vcpus);
      const nativeRamMb = nativePositiveInteger(flavor.ram);
      if (nativeVcpus === null || nativeRamMb === null) {
        throw new ManagementInputError("Huawei returned a Flexus X server without its native CPU and RAM numbers.", 409);
      }
      verifyXCatalogCorrespondence(offering, nativeVcpus, nativeRamMb);
      const serverId = nativeString(record.id);
      const name = nativeString(record.name);
      const rawStatus = nativeString(record.status);
      if (!serverId || !name || !rawStatus) {
        throw new ManagementInputError("Huawei returned a Flexus X server without a verified identity, name, or status.", 409);
      }
      if (seen.has(serverId)) throw new ManagementInputError("Huawei returned a duplicate Flexus X server identity.", 409);
      seen.add(serverId);
      collected.push({
        serverId,
        name,
        projectId: session.projectId,
        region: session.region,
        ...offering,
        status: knownServerStatuses.has(rawStatus) ? rawStatus : unknownStatusFact,
      });
    }
    if (rows.length < 100) return collected;
    offset += 1;
  }
  throw new Error("The Flexus X inventory exceeded the supported page limit.");
}

export type NativeFlexusServer = {
  id: string;
  name: string;
  status: string;
  statusKnown: boolean;
  taskState: string | null;
  taskStateVerified: boolean;
  tenantId: string;
  flavorName: string;
  flavorVcpus: number | null;
  flavorRamMb: number | null;
  description: string | null;
  hostname: string;
  chargingMode: string;
  lockSource: string;
  lockSourceId: string;
  serviceLocks: string[] | null;
  locked: boolean | null;
  frozen: boolean;
  zone: string;
};

function parseNativeFlexusServer(
  body: Record<string, unknown>,
  context: { projectId: string; kind: "l" | "x"; serverId: string; bundleId?: string },
): NativeFlexusServer {
  for (const scope of [body, asRecord(body.data), asRecord(body.server)]) assertFlexusProjectScope(context.projectId, scope);
  const record = asRecord(body.server);
  if (!Object.keys(record).length) throw new ManagementInputError("Huawei returned no native server object for this Flexus resource.", 409);
  const id = nativeString(record.id);
  if (!id || id !== context.serverId) throw new ManagementInputError("Huawei returned a different server than the requested Flexus resource.", 409);
  const tenantId = nativeString(record.tenant_id);
  if (!tenantId || tenantId !== context.projectId) throw new ManagementInputError("Huawei returned a Flexus server outside the exactly selected project.", 409);
  const name = nativeString(record.name);
  if (!name) throw new ManagementInputError("Huawei returned a Flexus server without a verified name.", 409);
  const status = nativeString(record.status);
  if (!status) throw new ManagementInputError("Huawei returned a Flexus server without a status.", 409);
  const metadata = asRecord(record.metadata);
  const flavor = asRecord(record.flavor);
  const taskStateKey = Object.hasOwn(record, "OS-EXT-STS:task_state")
    ? "OS-EXT-STS:task_state"
    : Object.hasOwn(record, "task_state")
      ? "task_state"
      : null;
  const rawTaskState = taskStateKey === null ? undefined : record[taskStateKey];
  // Idle is the native explicit null only; a missing, empty, boolean, or malformed task state never defaults to idle.
  const taskStateVerified = rawTaskState === null || nativeString(rawTaskState) !== null;
  const taskState = taskStateVerified && rawTaskState !== null ? (rawTaskState as string) : null;
  const lockSource = firstString([metadata.lockSource], "");
  const lockSourceId = firstString([metadata.lockSourceId], "");
  let chargingMode = "";
  if (context.kind === "l") {
    if (lockSource !== "hcss" || !context.bundleId || lockSourceId !== context.bundleId) {
      throw new ManagementInputError("Huawei returned a server whose native lock source does not match this Flexus L bundle.", 409);
    }
    {
      if (metadata.charging_mode !== "1") {
        throw new ManagementInputError("Huawei returned a Flexus L server with an unexpected charging mode.", 409);
      }
      chargingMode = "1";
    }
  } else {
    const rawChargingMode = nativeString(metadata.charging_mode);
    if (rawChargingMode) chargingMode = rawChargingMode;
  }
  const serviceLockRaw = metadata.OTHER_SVC_LOCK;
  const serviceLocks =
    typeof serviceLockRaw === "string" && serviceLockRaw.trim() ? serviceLockRaw.split(",").map((action) => action.trim()).filter(Boolean) : null;
  return {
    id,
    name,
    status,
    statusKnown: knownServerStatuses.has(status),
    taskState,
    taskStateVerified,
    tenantId,
    flavorName: firstString([flavor.name], ""),
    flavorVcpus: nativePositiveInteger(flavor.vcpus),
    flavorRamMb: nativePositiveInteger(flavor.ram),
    description: typeof record.description === "string" ? record.description : null,
    hostname: firstString([record.hostname], ""),
    chargingMode,
    lockSource,
    lockSourceId,
    serviceLocks,
    locked: typeof record.locked === "boolean" ? record.locked : null,
    frozen: status === "FROZEN",
    zone: firstString([record["OS-EXT-AZ:availability_zone"], record.availability_zone], ""),
  };
}

export async function getNativeFlexusLServer(session: BetterUiSession, bundleId: string, serverId: string): Promise<NativeFlexusServer> {
  const body = await flexusNativeFetch<Record<string, unknown>>(
    hcssNativeEndpoint(session.region),
    `/v1/${encodeURIComponent(session.projectId)}/cloudservers/${encodeURIComponent(serverId)}`,
    session.token,
  );
  return parseNativeFlexusServer(body, { projectId: session.projectId, kind: "l", serverId, bundleId });
}

export async function getNativeFlexusXServer(session: BetterUiSession, serverId: string): Promise<NativeFlexusServer> {
  const body = await flexusNativeFetch<Record<string, unknown>>(
    serviceEndpoint("ecs", session.region),
    `/v1/${encodeURIComponent(session.projectId)}/cloudservers/${encodeURIComponent(serverId)}`,
    session.token,
  );
  const server = parseNativeFlexusServer(body, { projectId: session.projectId, kind: "x", serverId });
  const offering = xOfferingFromName(server.flavorName);
  if (!offering) throw new ManagementInputError("This server is not a documented Flexus X offering.", 409);
  if (server.flavorVcpus === null || server.flavorRamMb === null) {
    throw new ManagementInputError("Huawei returned a Flexus X server without its native CPU and RAM numbers.", 409);
  }
  verifyXCatalogCorrespondence(offering, server.flavorVcpus, server.flavorRamMb);
  return server;
}

const operationStatuses: Record<string, readonly string[]> = {
  start: ["SHUTOFF"],
  stop: ["ACTIVE"],
  "soft-reboot": ["ACTIVE"],
  "update-server": ["ACTIVE", "SHUTOFF"],
  "reset-password": ["ACTIVE", "SHUTOFF"],
};

/**
 * Write gate: a whitelisted native status shown with a static message when unknown, a verified idle
 * task state (the native explicit null), no freeze, a native boolean lock that must be an explicit
 * false, and OTHER_SVC_LOCK honored per operation. Only documented lock actions are interpreted, so
 * documented start/stop/rename changes are not blindly blocked when the lock list does not name
 * them, while an uninterpretable lock action blocks every change. Raw unknown statuses, task
 * states, and service locks never reach public facts or errors.
 */
export function assertNativeFlexusServerReady(server: NativeFlexusServer, operation: string) {
  if (!server.statusKnown) {
    throw new ManagementInputError("The server status is not a verified native state; this operation is unavailable until it is verified.", 409);
  }
  if (server.frozen) throw new ManagementInputError("The server is frozen by Huawei. Resolve the account or billing state in the native console first.", 409);
  if (server.locked === null) {
    throw new ManagementInputError("The server's native lock state is unverified; this operation is unavailable until it is verified.", 409);
  }
  if (server.locked) throw new ManagementInputError("The server is locked by Huawei. Resolve the lock in the native console first.", 409);
  if (!server.taskStateVerified || server.taskState !== null) {
    throw new ManagementInputError("The server is running a native task; wait for it to finish before changing it.", 409);
  }
  if (server.serviceLocks?.some((action) => !documentedServiceLockActions.has(action))) {
    throw new ManagementInputError("The server carries a service lock this console cannot interpret. Review the lock in the native console before changing the server.", 409);
  }
  const allowedStatuses = operationStatuses[operation];
  if (allowedStatuses && !allowedStatuses.includes(server.status)) {
    throw new ManagementInputError(`This operation is unavailable while the server status is ${server.status}.`, 409);
  }
}

export async function runNativeFlexusServerAction(
  session: BetterUiSession,
  kind: "l" | "x",
  serverId: string,
  action: "os-start" | "os-stop" | "reboot",
): Promise<string> {
  const base = kind === "l" ? hcssNativeEndpoint(session.region) : serviceEndpoint("ecs", session.region);
  const body =
    action === "os-start"
      ? { "os-start": { servers: [{ id: serverId }] } }
      : action === "os-stop"
        ? { "os-stop": { servers: [{ id: serverId }], type: "SOFT" } }
        : { reboot: { servers: [{ id: serverId }], type: "SOFT" } };
  const response = await flexusNativeFetch<Record<string, unknown>>(
    base,
    `/v1/${encodeURIComponent(session.projectId)}/cloudservers/action`,
    session.token,
    { method: "POST", body: JSON.stringify(body) },
  );
  assertFlexusProjectScope(session.projectId, response);
  assertFlexusProjectScope(session.projectId, asRecord(response.data));
  if (Object.hasOwn(response, "server_id") && response.server_id !== serverId) throw new Error("Huawei acknowledged a different Flexus server.");
  const jobId = nativeString(response.job_id);
  if (!jobId) {
    throw new Error("Huawei accepted the power operation but returned no verifiable job. The change may be in progress; check the server state in the native console before retrying.");
  }
  return jobId;
}

/** The stored fingerprint keeps field names in the clear and hashes the values; no raw description is stored. */
export function flexusUpdateFingerprint(patch: { name?: string; description?: string }): { fields: string[]; digest: string } {
  const fields = Object.keys(patch).sort();
  const digest = createHash("sha256")
    .update(JSON.stringify(fields.map((field) => [field, patch[field as keyof typeof patch]])))
    .digest("hex");
  return { fields, digest };
}

/**
 * Native metadata update: the acknowledged server object is optional, but when the native write
 * acknowledgement provides its parent server and project identities they must match exactly,
 * including a null or missing value.
 */
export async function updateNativeFlexusServer(
  session: BetterUiSession,
  kind: "l" | "x",
  serverId: string,
  patch: { name?: string; description?: string },
): Promise<void> {
  const base = kind === "l" ? hcssNativeEndpoint(session.region) : serviceEndpoint("ecs", session.region);
  const response = await flexusNativeFetch<Record<string, unknown>>(
    base,
    `/v1/${encodeURIComponent(session.projectId)}/cloudservers/${encodeURIComponent(serverId)}`,
    session.token,
    { method: "PUT", body: JSON.stringify({ server: patch }) },
  );
  assertFlexusProjectScope(session.projectId, response);
  assertFlexusProjectScope(session.projectId, asRecord(response.data));
  if (Object.hasOwn(response, "server_id") && response.server_id !== serverId) throw new Error("Huawei acknowledged a different Flexus server.");
  const acknowledged = asRecord(response.server);
  if (Object.keys(acknowledged).length && (acknowledged.id !== serverId || acknowledged.tenant_id !== session.projectId)) {
    throw new Error("Huawei acknowledged a different server or project for the accepted update. The change may or may not have been applied; verify the server in the native console before retrying.");
  }
}

const administratorFragments = (() => {
  const target = "administrator";
  return [
    ...Array.from({ length: target.length - 2 }, (_, index) => target.slice(index, index + 3)),
    target,
    [...target].reverse().join(""),
    "root",
    [..."root"].reverse().join(""),
  ];
})();

/** Native ECS password contract: 8-26 allowed characters, three-plus character groups, and no root/Administrator material. */
export function assertNativeFlexusPassword(value: string) {
  if (value.length < 8 || value.length > 26) throw new ManagementInputError("The password must be 8 to 26 characters long.");
  if (!/^[A-Za-z0-9!@%\-_=+\[\]:./?]+$/.test(value)) {
    throw new ManagementInputError("The password uses characters outside the supported set of letters, digits, and the special characters !@%-_=+[]:./?");
  }
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[!@%\-_=+\[\]:./?]/].filter((pattern) => pattern.test(value)).length;
  if (groups < 3) throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and the supported special characters.");
  const lowered = value.toLowerCase();
  if (administratorFragments.some((fragment) => lowered.includes(fragment))) {
    throw new ManagementInputError("The password cannot contain root, Administrator, their reverses, or three consecutive characters of Administrator.");
  }
}

/**
 * Native one-click password reset: the native acknowledgement is empty and carries no job, which is
 * accepted as a pending manual verification. An optional job is kept only when it is a typed,
 * non-empty, bounded opaque id; a malformed or oversized echo is never treated as a verifiable job.
 */
export async function resetNativeFlexusServerPassword(
  session: BetterUiSession,
  kind: "l" | "x",
  serverId: string,
  newPassword: string,
): Promise<string | undefined> {
  const base = kind === "l" ? hcssNativeEndpoint(session.region) : serviceEndpoint("ecs", session.region);
  const response = await flexusNativeFetch<Record<string, unknown>>(
    base,
    `/v1/${encodeURIComponent(session.projectId)}/cloudservers/${encodeURIComponent(serverId)}/os-reset-password`,
    session.token,
    { method: "PUT", body: JSON.stringify({ "reset-password": { new_password: newPassword, is_check_password: true } }) },
  );
  assertFlexusProjectScope(session.projectId, response);
  assertFlexusProjectScope(session.projectId, asRecord(response.data));
  if (Object.hasOwn(response, "server_id") && response.server_id !== serverId) throw new Error("Huawei acknowledged a different Flexus server.");
  if (!Object.hasOwn(response, "job_id")) return undefined;
  const jobId = nativeString(response.job_id);
  if (!jobId || jobId.length > 64) return undefined;
  return jobId;
}

export type FlexusResourceTarget = { kind: "l" | "x"; bundleId?: string; serverId: string };

export function parseFlexusResourceId(id: string | undefined): FlexusResourceTarget {
  const value = typeof id === "string" ? id.trim() : "";
  if (!value) throw new ManagementInputError("Select a Flexus resource.", 404);
  const parts = value.split(":");
  if (parts[0] === "l" && parts.length === 3 && parts.every(Boolean)) return { kind: "l", bundleId: parts[1], serverId: parts[2] };
  if (parts[0] === "x" && parts.length === 2 && parts.every(Boolean)) return { kind: "x", serverId: parts[1] };
  throw new ManagementInputError("Select a Flexus L or Flexus X resource with its original native identity.", 409);
}

const jobPollOperationLabels = new Set(["Start server", "Stop server", "Soft reboot", "Reset administrator password"]);

type FlexusPollOutcome = { state: "submitted" | "succeeded" | "failed"; message?: string; resourceId?: string; observedTask?: string };

function assertPollProjectScope(session: BetterUiSession, entry: ManagementHistoryEntry) {
  if (entry.projectId !== session.projectId) {
    throw new ManagementInputError("This history entry belongs to a different project than the selected session.", 409);
  }
}

/**
 * Observer for a pending rename/describe change: the observation id is the ORIGINAL server id (no
 * native job exists for metadata updates), and the change is confirmed only when the fresh server's
 * current values hash to the stored fingerprint over the same field schema.
 */
async function pollFlexusUpdateObserver(session: BetterUiSession, entry: ManagementHistoryEntry): Promise<FlexusPollOutcome> {
  assertPollProjectScope(session, entry);
  const target = parseFlexusResourceId(entry.resourceId);
  // Keep previously persisted rename observations refreshable.
  const reference = entry.observationId ?? entry.jobId;
  const observerId = typeof reference === "string" ? reference.trim() : "";
  if (!observerId || observerId !== target.serverId) {
    throw new ManagementInputError("This history entry is not a pending Flexus rename observation.", 409);
  }
  const verification = entry.verification;
  if (
    !verification ||
    !Array.isArray(verification.fields) ||
    !verification.fields.length ||
    verification.fields.some((field) => field !== "name" && field !== "description") ||
    typeof verification.digest !== "string" ||
    !verification.digest
  ) {
    throw new ManagementInputError("This history entry has no verifiable change fingerprint.", 409);
  }
  const server =
    target.kind === "l"
      ? await getNativeFlexusLServer(session, target.bundleId!, target.serverId)
      : await getNativeFlexusXServer(session, target.serverId);
  const current: { name?: string; description?: string } = {};
  for (const field of verification.fields) {
    if (field === "name") current.name = server.name;
    else if (typeof server.description !== "string") {
      return { state: "submitted", message: "The requested description is not verifiable on the fresh server state yet." };
    } else current.description = server.description;
  }
  const { digest } = flexusUpdateFingerprint(current);
  if (digest === verification.digest) {
    return { state: "succeeded", message: "The server name and description now match the requested change.", resourceId: entry.resourceId };
  }
  return { state: "submitted", message: "The requested name and description are not visible on the fresh server state yet." };
}

/**
 * Polls only whitelisted Flexus operations in their original scope: a provided entry project must
 * match the selected session exactly, every identity the native job body provides (job id, project,
 * domain, member server ids, sub-job members) must match exactly and is never filtered — including
 * null or malformed echoes — native job states map to fixed console messages, and raw failure text
 * is never surfaced. A password reset accepted without a native job stays pending manual
 * verification instead of being polled or marked succeeded.
 */
export async function pollNativeFlexusJob(session: BetterUiSession, entry: ManagementHistoryEntry): Promise<FlexusPollOutcome> {
  if (entry.operation === "Rename or describe server") return pollFlexusUpdateObserver(session, entry);
  if (!jobPollOperationLabels.has(entry.operation)) throw new ManagementInputError("This history entry is not a polled Flexus operation.", 409);
  assertPollProjectScope(session, entry);
  const jobId = typeof entry.jobId === "string" ? entry.jobId.trim() : "";
  if (!jobId) {
    if (entry.operation === "Reset administrator password") {
      return { state: "submitted", message: "The password reset is pending manual verification; sign in with the new password to confirm it." };
    }
    throw new ManagementInputError("This history entry has no native job to poll.", 409);
  }
  const target = parseFlexusResourceId(entry.resourceId);
  const base = target.kind === "l" ? hcssNativeEndpoint(session.region) : serviceEndpoint("ecs", session.region);
  const body = await flexusNativeFetch<Record<string, unknown>>(
    base,
    `/v1/${encodeURIComponent(session.projectId)}/jobs/${encodeURIComponent(jobId)}`,
    session.token,
    undefined,
    { jobBody: true },
  );
  if (Object.hasOwn(body, "job_id") && body.job_id !== jobId) {
    throw new Error("Huawei returned a different job than the one this console submitted.");
  }
  const scopes = [body, asRecord(body.data), asRecord(body.entities)];
  for (const parent of [body, asRecord(body.entities)]) {
    if (!Object.hasOwn(parent, "sub_jobs")) continue;
    if (!Array.isArray(parent.sub_jobs)) throw new Error("Huawei returned a malformed Flexus job sub-job list.");
    for (const child of parent.sub_jobs) {
      if (!child || typeof child !== "object" || Array.isArray(child)) throw new Error("Huawei returned a malformed Flexus job sub-job list.");
      scopes.push(asRecord(child), asRecord(asRecord(child).entities));
    }
  }
  let domainId: string | undefined;
  for (const scope of scopes) {
    assertFlexusProjectScope(session.projectId, scope);
    if (Object.hasOwn(scope, "server_id") && scope.server_id !== target.serverId) throw new Error("Huawei returned a job for a different server than the one this console changed.");
    for (const key of ["domain_id", "domainId"]) if (Object.hasOwn(scope, key)) {
      domainId ??= await verifyFlexusAccountDomain(session);
      if (scope[key] !== domainId) throw new Error("Huawei returned a job outside the verified account domain.");
    }
  }
  const status = body.status;
  if (status === "SUCCESS") {
    return { state: "succeeded", message: "The Flexus cloud job completed successfully.", resourceId: entry.resourceId };
  }
  if (status === "FAIL") return { state: "failed", message: "The Flexus cloud job failed. Review the server in the native console before retrying." };
  if (status === "RUNNING" || status === "INIT") {
    return { state: "submitted", message: `The Flexus cloud job is ${status === "INIT" ? "initializing" : "running"}.`, observedTask: status };
  }
  throw new Error("Huawei reported an unverified Flexus job status.");
}
