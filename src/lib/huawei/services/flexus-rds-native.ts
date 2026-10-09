import "server-only";

import { createHash } from "node:crypto";

import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementHistoryEntry } from "@/lib/management-contract";
import { huaweiFetch } from "@/lib/huawei/http";
import { asRecord } from "@/lib/huawei/parsers";

/*
 * Native Flexus RDS contracts verified against the official Huawei Cloud FlexusRDS API reference
 * (intl/en-us/api-flexusrds: rds_01_0004 listing, rds_09_0004 create backup, rds_09_0005 list
 * backups, rds_09_0007 delete backup, rds_05_0027/rds_05_0028 disk autoscaling policy) plus the
 * root-verified PDF contracts for reboot and root password reset, plus the current RDS jobs Get
 * (https://support.huaweicloud.com/intl/en-us/api-rds/rds_08_0001.html):
 * - Listing: GET /v3/{project}/instances with the mandatory group_type=flexus and
 *   datastore_type=MySQL, offset/limit paging within 1..100, exact id filtering (the reserved *
 *   fuzzy form is never sent), and a native numeric total_count. The native group filter is the
 *   only Flexus discriminator; name, flavor, image, or datastore heuristics are never used.
 * - Reboot: POST /v3/{project}/instances/{id}/action {restart:{}} returns a native job_id.
 * - Root password reset: POST /v3/{project}/instances/{id}/password {db_user_pwd} acknowledges
 *   with an empty body and no job, so it stays pending manual verification.
 * - Storage autoscaling policy: GET/PUT /v3/{project}/instances/{id}/disk-auto-expansion with a
 *   boolean switch, a 40-4000 GB limit that must be no less than the current storage, a 10/15/20
 *   trigger threshold, and a 5-50% increment; the PUT acknowledges with an empty body.
 * - Backups: POST /v3/{project}/backups, GET /v3/{project}/backups?instance_id=... (mandatory),
 *   and DELETE /v3/{project}/backups/{backup_id} whose empty acknowledgement is never treated as
 *   proof of deletion.
 * - Jobs: GET /v3/{project}/jobs?id= with whitelisted
 *   Running/Completed/Failed statuses and fails closed on any unverified echo or status.
 * Explicit gaps left for root coverage because their contracts are not verified here:
 * - Minor version upgrades (api-flexusrds rds_05_0041) are not exposed.
 * - Instance creation is not exposed: the live Flexus catalog and prepaid unpaid ordering are
 *   unverified, and the native charge mode is prePaid only.
 * - Instance deletion is not exposed: prepaid instances are cancelled through subscription
 *   unsubscription, which has no verified native contract.
 */

const knownInstanceStatuses = new Set(["BUILD", "ACTIVE", "FAILED", "MODIFYING", "REBOOTING", "RESTORING", "BACKING UP", "STORAGE FULL"]);
const knownBackupStatuses = new Set(["BUILDING", "COMPLETED", "FAILED", "DELETING"]);
const knownBackupTypes = new Set(["auto", "manual", "fragment", "incremental"]);
const unknownStatusFact = "Unknown";

/** Native identities, names, and statuses are typed strings; they are never coerced from other JSON shapes. */
function nativeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nativeSafeInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return null;
  return value;
}

/** Every provided project or tenant alias must be the exactly selected project, including a provided null. */
function assertProvidedProjectScope(projectId: string, container: Record<string, unknown>) {
  for (const key of ["project_id", "projectId", "tenant_id", "tenantId"]) {
    if (Object.hasOwn(container, key) && container[key] !== projectId) {
      throw new Error("Huawei returned a Flexus RDS response outside the exactly selected project.");
    }
  }
}

/**
 * Sanitizing transport for every native Flexus RDS request: the shared huaweiFetch provides the
 * safe HTTP, network, and body errors on the project token and the rds endpoint, and this guard
 * rejects any provided business failure (error, error_msg, or an error_code that is not 0/"0",
 * even when null) before a read result or after a write acknowledgement. Raw payloads, provider
 * texts, and request secrets are never surfaced.
 */
async function flexusRdsFetch<T = Record<string, unknown>>(session: BetterUiSession, path: string, init?: RequestInit): Promise<T> {
  const write = Boolean(init?.method && init.method !== "GET");
  const body = await huaweiFetch<unknown>(session, "rds", path, init);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Huawei returned an unverifiable Flexus RDS response shape.");
  const record = body as Record<string, unknown>;
  const businessFailureIn = (scope: Record<string, unknown>) =>
    Object.hasOwn(scope, "error") ||
    Object.hasOwn(scope, "error_msg") ||
    (Object.hasOwn(scope, "error_code") && scope.error_code !== 0 && scope.error_code !== "0");
  if (businessFailureIn(record) || businessFailureIn(asRecord(record.data))) {
    if (write) throw new Error("Huawei reported a Flexus RDS business failure. The change may or may not have been applied; verify the current state in the native console before retrying.");
    throw new ManagementInputError("Huawei rejected this Flexus RDS request in its response body.", 409);
  }
  return body as T;
}

/**
 * Strict offset paging shared by the instance and backup listings: the items array and the native
 * numeric total_count are required on every page, the total must stay stable, a short or empty
 * page before the total is a truncated or incomplete read, an oversized or overshooting page is a
 * protocol violation, and the collected rows must equal the total exactly. Nothing is silently
 * filtered, skipped, or coerced.
 */
async function strictOffsetPages(session: BetterUiSession, itemsKey: "instances" | "backups", pagePath: (offset: number) => string): Promise<unknown[]> {
  const rows: unknown[] = [];
  let total: number | null = null;
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const body = await flexusRdsFetch<Record<string, unknown>>(session, pagePath(offset));
    assertProvidedProjectScope(session.projectId, body);
    const pageRows = body[itemsKey];
    if (!Array.isArray(pageRows)) throw new ManagementInputError(`Huawei returned no Flexus RDS ${itemsKey} array for this page.`, 409);
    if (pageRows.length > 100) throw new ManagementInputError("Huawei returned an oversized Flexus RDS page.", 409);
    const totalCount = body.total_count;
    if (typeof totalCount !== "number" || !Number.isSafeInteger(totalCount) || totalCount < 0) {
      throw new ManagementInputError("Huawei returned a Flexus RDS page without a verified total_count.", 409);
    }
    if (total === null) total = totalCount;
    else if (totalCount !== total) throw new ManagementInputError("Huawei returned an unstable Flexus RDS total_count across pages.", 409);
    rows.push(...pageRows);
    if (pageRows.length === 0) break;
    offset += pageRows.length;
    if (offset >= total) break;
    if (pageRows.length < 100) throw new ManagementInputError("Huawei returned a truncated Flexus RDS page before its total_count.", 409);
  }
  if (total === null || rows.length !== total) throw new ManagementInputError("Huawei returned an incomplete Flexus RDS inventory for its total_count.", 409);
  return rows;
}

export type NativeFlexusRdsInstance = {
  id: string;
  name: string;
  status: string;
  statusKnown: boolean;
  region: string;
  engine: "MySQL";
  version: string;
  projectId: string;
  billingVerified: boolean;
  volumeGb: number | null;
};

function parseNativeFlexusRdsInstance(row: unknown, session: BetterUiSession): NativeFlexusRdsInstance {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new ManagementInputError("Huawei returned a Flexus RDS instance with an unexpected shape.", 409);
  const record = row as Record<string, unknown>;
  if (Object.hasOwn(record, "group_type") && record.group_type !== "flexus") {
    throw new ManagementInputError("Huawei returned a Flexus RDS instance outside the native flexus group.", 409);
  }
  if (Object.hasOwn(record, "is_flexus") && record.is_flexus !== true) {
    throw new ManagementInputError("Huawei returned a Flexus RDS instance outside the native flexus group.", 409);
  }
  assertProvidedProjectScope(session.projectId, record);
  const id = nativeString(record.id);
  const name = nativeString(record.name);
  const rawStatus = nativeString(record.status);
  if (!id || !name || !rawStatus) throw new ManagementInputError("Huawei returned a Flexus RDS instance without a verified identity, name, or status.", 409);
  const region = nativeString(record.region);
  if (!region || region !== session.region) throw new ManagementInputError("Huawei returned a Flexus RDS instance outside the selected region.", 409);
  const datastore = asRecord(record.datastore);
  const engine = nativeString(datastore.type);
  const version = nativeString(datastore.version);
  if (engine === null || engine.toLowerCase() !== "mysql" || !version) {
    throw new ManagementInputError("Huawei returned a Flexus RDS instance without its verified MySQL engine and version.", 409);
  }
  let billingVerified = false;
  const chargeInfo = asRecord(record.charge_info);
  if (Object.hasOwn(chargeInfo, "charge_mode")) {
    if (chargeInfo.charge_mode !== "prePaid") throw new ManagementInputError("Huawei returned a Flexus RDS instance with an unexpected charging mode.", 409);
    billingVerified = true;
  }
  let volumeGb: number | null = null;
  const volume = asRecord(record.volume);
  if (Object.hasOwn(volume, "size")) {
    const size = nativeSafeInteger(volume.size, 1, 4000);
    if (size === null) throw new ManagementInputError("Huawei returned a Flexus RDS instance without its native storage size.", 409);
    volumeGb = size;
  }
  return {
    id,
    name,
    status: knownInstanceStatuses.has(rawStatus) ? rawStatus : unknownStatusFact,
    statusKnown: knownInstanceStatuses.has(rawStatus),
    region,
    engine: "MySQL",
    version,
    projectId: session.projectId,
    billingVerified,
    volumeGb,
  };
}

function validateInstanceRows(session: BetterUiSession, rows: unknown[], exactId?: string): NativeFlexusRdsInstance[] {
  const seen = new Set<string>();
  const instances: NativeFlexusRdsInstance[] = [];
  for (const row of rows) {
    const instance = parseNativeFlexusRdsInstance(row, session);
    if (seen.has(instance.id)) throw new ManagementInputError("Huawei returned a duplicate Flexus RDS instance identity.", 409);
    seen.add(instance.id);
    if (exactId && instance.id !== exactId) throw new ManagementInputError("Huawei returned a different instance than the exact native identity requested.", 409);
    instances.push(instance);
  }
  return instances;
}

/**
 * Native Flexus RDS inventory: the project's MySQL instances selected by the mandatory native
 * group_type=flexus filter, strictly paged, exactly counted, and positively projected. Unknown
 * native statuses become a static Unknown; raw private values never surface.
 */
export async function listNativeFlexusRdsInstances(session: BetterUiSession): Promise<NativeFlexusRdsInstance[]> {
  const rows = await strictOffsetPages(session, "instances", (offset) => {
    const query = new URLSearchParams({ datastore_type: "MySQL", group_type: "flexus", offset: String(offset), limit: "100" });
    return `/v3/${encodeURIComponent(session.projectId)}/instances?${query.toString()}`;
  });
  return validateInstanceRows(session, rows);
}

/**
 * Fresh exact-identity read used before every operation: the original instance id is sent as the
 * exact id filter (never the reserved * fuzzy form) with the same mandatory native group filter,
 * and the single returned object must carry that exact identity or the read fails closed.
 */
export async function getNativeFlexusRdsInstance(session: BetterUiSession, instanceId: string): Promise<NativeFlexusRdsInstance> {
  const rows = await strictOffsetPages(session, "instances", (offset) => {
    const query = new URLSearchParams({ datastore_type: "MySQL", group_type: "flexus", id: instanceId, offset: String(offset), limit: "100" });
    return `/v3/${encodeURIComponent(session.projectId)}/instances?${query.toString()}`;
  });
  const instances = validateInstanceRows(session, rows, instanceId);
  const instance = instances[0];
  if (!instance) {
    throw new ManagementInputError("The selected Flexus RDS instance is no longer in the selected project's native catalog. Refresh the inventory and try again.", 409);
  }
  return instance;
}

/**
 * Write gate: mutations require a whitelisted native ACTIVE status and the verified native prepaid
 * billing state. Unknown statuses and unverified billing never become a default writable state.
 */
export function assertNativeFlexusRdsInstanceMutable(instance: NativeFlexusRdsInstance) {
  if (!instance.statusKnown) {
    throw new ManagementInputError("The instance status is not a verified native state; this operation is unavailable until it is verified.", 409);
  }
  if (instance.status !== "ACTIVE") {
    throw new ManagementInputError(`This operation is unavailable while the instance status is ${instance.status}.`, 409);
  }
  if (!instance.billingVerified) {
    throw new ManagementInputError("The instance's native prepaid billing state is unverified; this operation is unavailable until it is verified.", 409);
  }
}

export type NativeFlexusRdsBackup = {
  id: string;
  name: string;
  status: string;
  statusKnown: boolean;
  type: string;
  typeKnown: boolean;
  instanceId: string;
  beginTime: string | null;
  sizeKb: number | null;
};

function parseNativeFlexusRdsBackup(row: unknown, instanceId: string, projectId: string): NativeFlexusRdsBackup {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new ManagementInputError("Huawei returned a Flexus RDS backup with an unexpected shape.", 409);
  const record = row as Record<string, unknown>;
  assertProvidedProjectScope(projectId, record);
  const id = nativeString(record.id);
  const name = nativeString(record.name);
  const rawStatus = nativeString(record.status);
  const rawType = nativeString(record.type);
  const rowInstanceId = nativeString(record.instance_id);
  if (!id || !name || !rawStatus || !rawType) {
    throw new ManagementInputError("Huawei returned a Flexus RDS backup without a verified identity, name, status, or type.", 409);
  }
  if (!rowInstanceId || rowInstanceId !== instanceId) {
    throw new ManagementInputError("Huawei returned a Flexus RDS backup outside the requested instance.", 409);
  }
  const size = record.size;
  if (size !== undefined && (typeof size !== "number" || !Number.isFinite(size) || size < 0)) {
    throw new ManagementInputError("Huawei returned a Flexus RDS backup with an unexpected size.", 409);
  }
  return {
    id,
    name,
    status: knownBackupStatuses.has(rawStatus) ? rawStatus : unknownStatusFact,
    statusKnown: knownBackupStatuses.has(rawStatus),
    type: knownBackupTypes.has(rawType) ? rawType : unknownStatusFact,
    typeKnown: knownBackupTypes.has(rawType),
    instanceId,
    beginTime: nativeString(record.begin_time),
    sizeKb: typeof size === "number" ? size : null,
  };
}

/**
 * Strict native backup list for one instance: the instance_id filter is mandatory on the wire,
 * every returned backup must belong to that instance, identities must be unique, statuses and
 * types outside the documented native vocabularies become a static Unknown, and paging follows the
 * same exact total_count discipline as the instance inventory.
 */
export async function listNativeFlexusRdsBackups(session: BetterUiSession, instanceId: string): Promise<NativeFlexusRdsBackup[]> {
  const rows = await strictOffsetPages(session, "backups", (offset) => {
    const query = new URLSearchParams({ instance_id: instanceId, offset: String(offset), limit: "100" });
    return `/v3/${encodeURIComponent(session.projectId)}/backups?${query.toString()}`;
  });
  const seen = new Set<string>();
  const backups: NativeFlexusRdsBackup[] = [];
  for (const row of rows) {
    const backup = parseNativeFlexusRdsBackup(row, instanceId, session.projectId);
    if (seen.has(backup.id)) throw new ManagementInputError("Huawei returned a duplicate Flexus RDS backup identity.", 409);
    seen.add(backup.id);
    backups.push(backup);
  }
  return backups;
}

/** Native reboot: the acknowledged job id must be a typed non-empty string or the outcome stays uncertain. */
export async function rebootNativeFlexusRdsInstance(session: BetterUiSession, instanceId: string): Promise<string> {
  const body = await flexusRdsFetch<Record<string, unknown>>(
    session,
    `/v3/${encodeURIComponent(session.projectId)}/instances/${encodeURIComponent(instanceId)}/action`,
    { method: "POST", body: JSON.stringify({ restart: {} }) },
  );
  assertProvidedProjectScope(session.projectId, body);
  if (Object.hasOwn(body, "instance_id") && body.instance_id !== instanceId) throw new Error("Huawei acknowledged a different Flexus RDS instance.");
  const jobId = nativeString(body.job_id);
  if (!jobId) {
    throw new Error("Huawei accepted the reboot but returned no verifiable job. The change may be in progress; check the instance state in the native console before retrying.");
  }
  return jobId;
}

/** Native root password contract: 8-32 characters, three-plus character groups, and the documented special-character set. */
export function assertNativeFlexusRdsPassword(value: string) {
  if (value.length < 8 || value.length > 32) throw new ManagementInputError("The password must be 8 to 32 characters long.");
  if (!/^[A-Za-z0-9~!@#$%^*\-_=+?,()&]+$/.test(value)) {
    throw new ManagementInputError("The password uses characters outside the supported set of letters, digits, and the special characters ~!@#$%^*-_=+?,()&");
  }
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[~!@#$%^*\-_=+?,()&]/].filter((pattern) => pattern.test(value)).length;
  if (groups < 3) {
    throw new ManagementInputError("The password must combine at least three of lowercase letters, uppercase letters, digits, and the supported special characters.");
  }
}

/**
 * Native root password reset: the acknowledgement is empty and carries no job, so the reset stays
 * pending manual verification. An optional job echo is kept only when it is a typed, non-empty,
 * bounded opaque id; a malformed echo is never treated as a verifiable job.
 */
export async function resetNativeFlexusRdsRootPassword(session: BetterUiSession, instanceId: string, newPassword: string): Promise<string | undefined> {
  const body = await flexusRdsFetch<Record<string, unknown>>(
    session,
    `/v3/${encodeURIComponent(session.projectId)}/instances/${encodeURIComponent(instanceId)}/password`,
    { method: "POST", body: JSON.stringify({ db_user_pwd: newPassword }) },
  );
  assertProvidedProjectScope(session.projectId, body);
  if (Object.hasOwn(body, "instance_id") && body.instance_id !== instanceId) throw new Error("Huawei acknowledged a different Flexus RDS instance.");
  if (!Object.hasOwn(body, "job_id")) return undefined;
  const jobId = nativeString(body.job_id);
  if (!jobId || jobId.length > 64) return undefined;
  return jobId;
}

/**
 * Native manual backup creation: the acknowledgement must carry a typed backup id, the exact
 * instance id and requested name, a whitelisted native status, and — when provided — the manual
 * type. Anything else is an unverifiable acknowledgement for a write that may have been applied.
 */
export async function createNativeFlexusRdsBackup(
  session: BetterUiSession,
  instanceId: string,
  name: string,
  description?: string,
): Promise<{ id: string; status: string }> {
  const body = await flexusRdsFetch<Record<string, unknown>>(session, `/v3/${encodeURIComponent(session.projectId)}/backups`, {
    method: "POST",
    body: JSON.stringify({ instance_id: instanceId, name, ...(description ? { description } : {}) }),
  });
  assertProvidedProjectScope(session.projectId, body);
  const backup = asRecord(body.backup);
  if (!Object.keys(backup).length) {
    throw new Error("Huawei returned an unverifiable manual backup acknowledgement. The backup may have been created; verify it in the native console before retrying.");
  }
  assertProvidedProjectScope(session.projectId, backup);
  const id = nativeString(backup.id);
  const instanceEcho = nativeString(backup.instance_id);
  const nameEcho = nativeString(backup.name);
  const status = nativeString(backup.status);
  const unverifiable =
    !id ||
    !instanceEcho ||
    instanceEcho !== instanceId ||
    !nameEcho ||
    nameEcho !== name ||
    !status ||
    !knownBackupStatuses.has(status) ||
    (Object.hasOwn(backup, "type") && backup.type !== "manual");
  if (unverifiable) {
    throw new Error("Huawei returned an unverifiable manual backup acknowledgement. The backup may have been created; verify it in the native console before retrying.");
  }
  return { id, status };
}

/**
 * Native manual backup deletion: the acknowledgement is empty and is never proof of deletion; the
 * caller must read the backup list back before reporting the backup gone.
 */
export async function deleteNativeFlexusRdsBackup(session: BetterUiSession, backupId: string): Promise<void> {
  const body = await flexusRdsFetch<Record<string, unknown>>(
    session,
    `/v3/${encodeURIComponent(session.projectId)}/backups/${encodeURIComponent(backupId)}`,
    { method: "DELETE" },
  );
  assertProvidedProjectScope(session.projectId, body);
  for (const key of ["id", "backup_id"]) {
    if (Object.hasOwn(body, key) && body[key] !== backupId) throw new Error("Huawei acknowledged a different Flexus RDS backup.");
  }
}

export type NativeFlexusRdsStoragePolicy = {
  switchOption: boolean;
  limitSizeGb: number | null;
  triggerThreshold: number | null;
  stepPercent: number | null;
};

/**
 * Native disk autoscaling policy read: the boolean switch is required and every provided dimension
 * must be a documented native number in its documented range; nothing is coerced.
 */
export async function getNativeFlexusRdsStoragePolicy(session: BetterUiSession, instanceId: string): Promise<NativeFlexusRdsStoragePolicy> {
  const body = await flexusRdsFetch<Record<string, unknown>>(
    session,
    `/v3/${encodeURIComponent(session.projectId)}/instances/${encodeURIComponent(instanceId)}/disk-auto-expansion`,
  );
  assertProvidedProjectScope(session.projectId, body);
  if (Object.hasOwn(body, "instance_id") && body.instance_id !== instanceId) throw new Error("Huawei returned a policy for a different Flexus RDS instance.");
  if (typeof body.switch_option !== "boolean") {
    throw new ManagementInputError("Huawei returned a Flexus RDS autoscaling policy without a verified switch.", 409);
  }
  const dimension = (key: "limit_size" | "step_percent", min: number, max: number) => {
    if (!Object.hasOwn(body, key)) return null;
    const parsed = nativeSafeInteger(body[key], min, max);
    if (parsed === null) throw new ManagementInputError("Huawei returned a Flexus RDS autoscaling policy with an unverified dimension.", 409);
    return parsed;
  };
  let triggerThreshold: 10 | 15 | 20 | null = null;
  if (Object.hasOwn(body, "trigger_threshold")) {
    if (body.trigger_threshold !== 10 && body.trigger_threshold !== 15 && body.trigger_threshold !== 20) {
      throw new ManagementInputError("Huawei returned a Flexus RDS autoscaling policy with an unverified dimension.", 409);
    }
    triggerThreshold = body.trigger_threshold;
  }
  return {
    switchOption: body.switch_option,
    limitSizeGb: dimension("limit_size", 40, 4000),
    triggerThreshold,
    stepPercent: dimension("step_percent", 5, 50),
  };
}

export type NativeFlexusRdsPolicyPatch = { switch_option: boolean; limit_size?: number; trigger_threshold?: number; step_percent?: number };

/** Native disk autoscaling policy write: the empty acknowledgement carries only optional echoes that must match exactly. */
export async function updateNativeFlexusRdsStoragePolicy(session: BetterUiSession, instanceId: string, patch: NativeFlexusRdsPolicyPatch): Promise<void> {
  const body = await flexusRdsFetch<Record<string, unknown>>(
    session,
    `/v3/${encodeURIComponent(session.projectId)}/instances/${encodeURIComponent(instanceId)}/disk-auto-expansion`,
    { method: "PUT", body: JSON.stringify(patch) },
  );
  assertProvidedProjectScope(session.projectId, body);
  if (Object.hasOwn(body, "instance_id") && body.instance_id !== instanceId) throw new Error("Huawei acknowledged a different Flexus RDS instance.");
}

/** The stored fingerprint keeps field names in the clear and hashes the values; no raw policy payload is stored beyond them. */
export function flexusRdsPolicyFingerprint(patch: Record<string, boolean | number>): { fields: string[]; digest: string } {
  const fields = Object.keys(patch).sort();
  const digest = createHash("sha256").update(JSON.stringify(fields.map((field) => [field, patch[field]]))).digest("hex");
  return { fields, digest };
}

/** The backup observer binds a pending entry to its original native backup identity; rows are never matched by name heuristics. */
export function flexusRdsBackupFingerprint(backupId: string): { fields: string[]; digest: string } {
  return { fields: ["backup"], digest: createHash("sha256").update(JSON.stringify([["backup", backupId]])).digest("hex") };
}

export function parseFlexusRdsResourceId(id: string | undefined): string {
  const value = typeof id === "string" ? id.trim() : "";
  if (!value) throw new ManagementInputError("Select a Flexus RDS instance.", 404);
  const parts = value.split(":");
  if (parts[0] === "rds" && parts.length === 2 && parts.every(Boolean)) return parts[1];
  throw new ManagementInputError("Select a Flexus RDS instance with its original native identity.", 409);
}

type FlexusRdsPollOutcome = { state: "submitted" | "succeeded" | "failed"; message?: string; resourceId?: string; observedTask?: string };

const polledOperationLabels = new Set(["Reboot instance", "Reset root password", "Create manual backup", "Delete manual backup", "Configure storage autoscaling policy"]);

function assertPollProjectScope(session: BetterUiSession, entry: ManagementHistoryEntry) {
  if (entry.projectId !== session.projectId) {
    throw new ManagementInputError("This history entry belongs to a different project than the selected session.", 409);
  }
}

function requireBackupObserver(entry: ManagementHistoryEntry, backupId: string) {
  const verification = entry.verification;
  if (!verification || JSON.stringify(verification) !== JSON.stringify(flexusRdsBackupFingerprint(backupId))) {
    throw new ManagementInputError("This history entry has no verifiable original backup observation.", 409);
  }
}

/**
 * Observer for a pending manual backup: the entry's observation id is the ORIGINAL native backup id (the
 * creation acknowledgement carries no job), and the backup is only matched by that identity. The
 * creation is confirmed when the original backup completes, fails when the native status is
 * FAILED, and stays pending while it builds; any other or vanished state fails closed.
 */
async function pollBackupObserver(session: BetterUiSession, entry: ManagementHistoryEntry, instanceId: string): Promise<FlexusRdsPollOutcome> {
  const backupId = typeof entry.observationId === "string" ? entry.observationId.trim() : "";
  if (!backupId) throw new ManagementInputError("This history entry has no original backup to observe.", 409);
  requireBackupObserver(entry, backupId);
  const backups = await listNativeFlexusRdsBackups(session, instanceId);
  const backup = backups.find((item) => item.id === backupId);
  if (!backup) throw new Error("The original manual backup is no longer observable on the instance; verify backups in the native console.");
  if (backup.status === "COMPLETED") return { state: "succeeded", message: "The manual backup completed.", resourceId: entry.resourceId };
  if (backup.status === "BUILDING") return { state: "submitted", message: "The manual backup is still building.", observedTask: "BUILDING" };
  if (backup.status === "FAILED") return { state: "failed", message: "The manual backup failed. Review backups in the native console before retrying." };
  throw new Error("The original manual backup has an unverified state; verify backups in the native console.");
}

/**
 * Observer for a pending manual backup deletion: the empty delete acknowledgement is never proof,
 * so the deletion is confirmed only when the original backup identity is gone from the fresh
 * backup list and stays pending while the backup is still observable.
 */
async function pollBackupDeletedObserver(session: BetterUiSession, entry: ManagementHistoryEntry, instanceId: string): Promise<FlexusRdsPollOutcome> {
  const backupId = typeof entry.observationId === "string" ? entry.observationId.trim() : "";
  if (!backupId) throw new ManagementInputError("This history entry has no original backup to observe.", 409);
  requireBackupObserver(entry, backupId);
  const backups = await listNativeFlexusRdsBackups(session, instanceId);
  const backup = backups.find((item) => item.id === backupId);
  if (!backup) return { state: "succeeded", message: "The manual backup was deleted.", resourceId: entry.resourceId };
  if (backup.status === "DELETING") return { state: "submitted", message: "The manual backup is still being deleted.", observedTask: "DELETING" };
  if (backup.statusKnown) return { state: "submitted", message: "The manual backup deletion is not visible on the fresh backup list yet." };
  throw new Error("The manual backup has an unverified state; verify backups in the native console.");
}

/**
 * Observer for a pending autoscaling policy change: the entry's observation id is the ORIGINAL instance id
 * (the policy write carries no job), and the change is confirmed only when the fresh policy's
 * field values hash to the stored fingerprint over the same field schema.
 */
async function pollPolicyObserver(session: BetterUiSession, entry: ManagementHistoryEntry, instanceId: string): Promise<FlexusRdsPollOutcome> {
  if (typeof entry.observationId !== "string" || entry.observationId.trim() !== instanceId) {
    throw new ManagementInputError("This history entry is not a pending Flexus RDS policy observation.", 409);
  }
  const verification = entry.verification;
  const policyFields = ["switch_option", "limit_size", "trigger_threshold", "step_percent"];
  if (
    !verification ||
    !Array.isArray(verification.fields) ||
    !verification.fields.length ||
    new Set(verification.fields).size !== verification.fields.length ||
    verification.fields.some((field) => !policyFields.includes(field)) ||
    typeof verification.digest !== "string" ||
    !verification.digest
  ) {
    throw new ManagementInputError("This history entry has no verifiable policy fingerprint.", 409);
  }
  const policy = await getNativeFlexusRdsStoragePolicy(session, instanceId);
  const current: Record<string, boolean | number> = {};
  for (const field of verification.fields) {
    if (field === "switch_option") current.switch_option = policy.switchOption;
    else if (field === "limit_size") {
      if (policy.limitSizeGb === null) return { state: "submitted", message: "The requested autoscaling limit is not verifiable on the fresh policy yet." };
      current.limit_size = policy.limitSizeGb;
    } else if (field === "trigger_threshold") {
      if (policy.triggerThreshold === null) return { state: "submitted", message: "The requested trigger threshold is not verifiable on the fresh policy yet." };
      current.trigger_threshold = policy.triggerThreshold;
    } else {
      if (policy.stepPercent === null) return { state: "submitted", message: "The requested autoscaling increment is not verifiable on the fresh policy yet." };
      current.step_percent = policy.stepPercent;
    }
  }
  if (flexusRdsPolicyFingerprint(current).digest === verification.digest) {
    return { state: "succeeded", message: "The storage autoscaling policy now matches the requested change.", resourceId: entry.resourceId };
  }
  return { state: "submitted", message: "The requested storage autoscaling policy is not visible on the fresh policy yet." };
}

/**
 * Polls only whitelisted Flexus RDS operations in their original scope: a provided entry project
 * must match the selected session exactly, every identity the native job body provides (job id,
 * project aliases, instance id, resource ids) must match exactly and is never filtered —
 * including null or malformed echoes — native job states map to fixed console messages, and raw
 * statuses or failure texts are never surfaced. A password reset accepted without a native job
 * stays pending manual verification instead of being polled or marked succeeded.
 */
export async function pollNativeFlexusRdsJob(session: BetterUiSession, entry: ManagementHistoryEntry): Promise<FlexusRdsPollOutcome> {
  if (!polledOperationLabels.has(entry.operation)) throw new ManagementInputError("This history entry is not a polled Flexus RDS operation.", 409);
  assertPollProjectScope(session, entry);
  const instanceId = parseFlexusRdsResourceId(entry.resourceId);
  if (entry.operation === "Create manual backup") return pollBackupObserver(session, entry, instanceId);
  if (entry.operation === "Delete manual backup") return pollBackupDeletedObserver(session, entry, instanceId);
  if (entry.operation === "Configure storage autoscaling policy") return pollPolicyObserver(session, entry, instanceId);
  const jobId = typeof entry.jobId === "string" ? entry.jobId.trim() : "";
  if (!jobId) {
    if (entry.operation === "Reset root password") {
      return { state: "submitted", message: "The password reset is pending manual verification; connect with the new password to confirm it." };
    }
    throw new ManagementInputError("This history entry has no native job to poll.", 409);
  }
  const body = await flexusRdsFetch<Record<string, unknown>>(
    session,
    `/v3/${encodeURIComponent(session.projectId)}/jobs?${new URLSearchParams({ id: jobId }).toString()}`,
  );
  const job = asRecord(body.job);
  if (!Object.keys(job).length) throw new Error("Huawei returned no verified job object for this Flexus RDS operation.");
  if (job.id !== jobId) throw new Error("Huawei returned a different job than the one this console submitted.");
  for (const parent of [body, job, asRecord(job.entities)]) {
    if (Object.hasOwn(parent, "instance")) {
      const instance = asRecord(parent.instance);
      if (instance.id !== instanceId) throw new Error("Huawei returned a job for a different instance than the one this console changed.");
      assertProvidedProjectScope(session.projectId, instance);
    }
  }
  const scopes = [body, job, asRecord(job.entities)];
  for (const scope of scopes) assertProvidedProjectScope(session.projectId, scope);
  for (const scope of scopes) {
    if (Object.hasOwn(scope, "instance_id") && scope.instance_id !== instanceId) {
      throw new Error("Huawei returned a job for a different instance than the one this console changed.");
    }
  }
  for (const parent of [body, job]) {
    const entities = asRecord(parent.entities);
    if (!Object.hasOwn(entities, "resource_ids")) continue;
    const resourceIds = entities.resource_ids;
    if (!Array.isArray(resourceIds) || !resourceIds.length || resourceIds.some((resourceId) => resourceId !== instanceId)) {
      throw new Error("Huawei returned a job for a different instance than the one this console changed.");
    }
  }
  const status = nativeString(job.status);
  if (!status) throw new Error("Huawei returned a Flexus RDS job without a verified status.");
  const normalized = status.toLowerCase();
  if (normalized === "completed") return { state: "succeeded", message: "The Flexus RDS cloud job completed successfully.", resourceId: entry.resourceId };
  if (normalized === "failed") return { state: "failed", message: "The Flexus RDS cloud job failed. Review the instance in the native console before retrying." };
  if (normalized === "running") return { state: "submitted", message: "The Flexus RDS cloud job is running.", observedTask: "Running" };
  throw new Error("Huawei reported an unverified Flexus RDS job status.");
}
