import "server-only";
import { isIP } from "node:net";
import { HuaweiApiError, huaweiAccountFetch, huaweiRequestHeaders } from "@/lib/huawei/http";
import { asRecord, asString } from "@/lib/huawei/parsers";
import { ManagementInputError } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";

// Native AAD/CNAD contracts pinned from Huawei's published references. IAM "supported services"
// (iam_01_0024) lists the AAD CNAD service for Global regions, so every /v1/cnad path
// authenticates with the GLOBAL account token; the AAD API reference (aad_02_0010) requires
// auth.scope.project for the /v1/aad, /v2/aad, and /v1/{project}/aad/external paths even though
// all of them share the global aad.myhuaweicloud.com hostname. CNAD calls therefore prove the
// account through IAM GET /v3/auth/tokens (X-Subject-Token: account token; token.domain.id
// identifies the account and the token must carry no project scope) and send the account token,
// while every other AAD call sends the selected project's token. Provided CNAD domain_id/domainId
// echoes at the top level, in data, or on rows must equal the authenticated domain (null or empty
// rejects), CNAD project_id values may belong to any project of the account and are never
// filtered, and provided AAD project_id/projectId echoes must equal the selected project (null or
// empty rejects) instead of being silently filtered out. Responses must be JSON objects; provided
// error_code values other than exactly 0 or "0" (including null and false), provided error_msg,
// and provided error objects are business errors; empty acknowledgements are valid.
const aadEndpoint = () => (process.env.HUAWEI_AAD_ENDPOINT ?? "https://aad.myhuaweicloud.com").replace(/\/+$/, "");

type AadScope = { kind: "account"; domainId: string } | { kind: "project"; projectId: string };

// The proof cache is keyed by the session object, so a verified account domain is reused only
// within one operation or request session and can never cross accounts.
const accountDomains = new WeakMap<BetterUiSession, Promise<string>>();

export function aadUsesAccountToken(path: string): boolean {
  return path === "/v1/cnad" || path.startsWith("/v1/cnad/");
}

export function aadVerifiedAccountDomain(session: BetterUiSession): Promise<string> {
  const cached = accountDomains.get(session);
  if (cached) return cached;
  const proof = (async () => {
    if (!session.accountToken) throw new ManagementInputError("Sign out and sign in again to obtain an account token for Anti-DDoS (CNAD).", 409);
    let response: unknown;
    try {
      response = await huaweiAccountFetch<unknown>({ ...session, token: session.accountToken }, "/v3/auth/tokens", { headers: { "X-Subject-Token": session.accountToken } });
    } catch (error) {
      if (error instanceof HuaweiApiError) throw new HuaweiApiError("Unable to verify this account's IAM domain for Anti-DDoS. Sign in again.", error.status);
      throw new ManagementInputError("Unable to verify this account's IAM domain for Anti-DDoS. Sign in again.", 409);
    }
    for (const container of [asRecord(response), asRecord(asRecord(response).data)]) {
      if (["error", "error_code", "error_msg"].some((key) => Object.hasOwn(container, key))) throw new ManagementInputError("Unable to verify this account's IAM domain for Anti-DDoS. Sign in again.", 409);
    }
    const token = asRecord(asRecord(response).token);
    if (token.project !== undefined) throw new ManagementInputError("The Anti-DDoS account token is project-scoped. Sign out and sign in again with an account token.", 409);
    const domainId = asString(asRecord(token.domain).id, "");
    const user = asRecord(token.user);
    if (typeof session.userId !== "string" || !session.userId.trim() || user.id !== session.userId || asRecord(user.domain).id !== domainId) throw new ManagementInputError("The Anti-DDoS account token identity could not be verified. Sign in again.", 409);
    if (!domainId) throw new ManagementInputError("Unable to verify this account's IAM domain for Anti-DDoS. Sign in again.", 409);
    return domainId;
  })();
  accountDomains.set(session, proof);
  return proof;
}

async function aadScopeFor(session: BetterUiSession, path: string): Promise<AadScope> {
  if (!aadUsesAccountToken(path)) return { kind: "project", projectId: session.projectId };
  return { kind: "account", domainId: await aadVerifiedAccountDomain(session) };
}

function assertScopeEcho(scope: AadScope, container: Record<string, unknown>) {
  // A global CNAD row can belong to a different valid project, but null/empty IDs are not proof.
  if (scope.kind === "account") for (const key of ["project_id", "projectId"]) {
    if (Object.hasOwn(container, key) && (typeof container[key] !== "string" || !String(container[key]).trim())) throw new Error("Huawei returned an unverifiable Anti-DDoS project identity.");
  }
  const expected = scope.kind === "account" ? scope.domainId : scope.projectId;
  for (const key of scope.kind === "account" ? ["domain_id", "domainId"] : ["project_id", "projectId"]) {
    if (container[key] !== undefined && container[key] !== expected) {
      throw new Error(scope.kind === "account"
        ? "Huawei returned an Anti-DDoS response for a different account; the request outcome is unknown."
        : "Huawei returned an Anti-DDoS response for a different project; the request outcome is unknown.");
    }
  }
}

// Optional parent echoes may appear at the top level or inside data; a provided echo must equal
// the parent identity the request targeted, and null or empty echoes reject.
export function aadVerifyEcho(body: Record<string, unknown>, key: string, expected: string) {
  for (const container of [body, asRecord(body.data)]) {
    if (container[key] !== undefined && container[key] !== expected) throw new Error("Huawei returned an Anti-DDoS response for a different resource than the request targeted; the request outcome is unknown.");
  }
}

export async function aadFetch(session: BetterUiSession, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const scope = await aadScopeFor(session, path);
  let response: Response;
  try {
    response = await fetch(`${aadEndpoint()}${path}`, { ...init, cache: "no-store", headers: huaweiRequestHeaders(scope.kind === "account" ? { ...session, token: session.accountToken! } : session, init?.headers) });
  } catch {
    throw new Error("The Huawei Anti-DDoS request could not be completed; its outcome is unknown.");
  }
  if (!response.ok) throw new HuaweiApiError(`Huawei Anti-DDoS rejected this request with HTTP ${response.status}.`, response.status);
  let payload: unknown;
  try {
    const text = await response.text();
    payload = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error("Huawei returned an invalid Anti-DDoS response; the request outcome is unknown.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Huawei returned an invalid Anti-DDoS response; the request outcome is unknown.");
  const body = payload as Record<string, unknown>;
  for (const container of [body, asRecord(body.data)]) {
    if (container.error_code !== undefined && container.error_code !== 0 && container.error_code !== "0") throw new Error("Huawei reported a business error for this Anti-DDoS request; the request outcome is unknown.");
    if (container.error_msg !== undefined || container.error !== undefined) throw new Error("Huawei reported a business error for this Anti-DDoS request; the request outcome is unknown.");
  }
  assertScopeEcho(scope, body);
  assertScopeEcho(scope, asRecord(body.data));
  return body;
}

function identifiedRows(items: unknown, idKey: string, label: string, arrayKeys: readonly string[] = []): Record<string, unknown>[] {
  if (!Array.isArray(items)) throw new Error(`Huawei returned no AAD ${label} list.`);
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const row = asRecord(item);
    const id = row[idKey];
    if (typeof id !== "string" || !id.trim()) throw new Error(`Huawei returned an AAD ${label} without a usable ID.`);
    if (seen.has(id)) throw new Error(`Huawei returned a duplicate AAD ${label} ID.`);
    seen.add(id);
    for (const key of arrayKeys) if (!Array.isArray(row[key])) throw new Error(`Huawei returned an AAD ${label} without its native ${key.replaceAll("_", " ")} list.`);
    rows.push(row);
  }
  return rows;
}

function totalOf(body: Record<string, unknown>, totalKey: string, label: string): number {
  const total = body[totalKey];
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) throw new Error(`Huawei returned no valid total for the AAD ${label} list.`);
  return total;
}

export async function aadWhole(session: BetterUiSession, path: string, itemsKey: string, totalKey: string, idKey: string, label: string, arrayKeys: readonly string[] = []): Promise<Record<string, unknown>[]> {
  const body = await aadFetch(session, path);
  const scope = await aadScopeFor(session, path);
  const rows = identifiedRows(body[itemsKey], idKey, label, arrayKeys);
  for (const row of rows) assertScopeEcho(scope, row);
  const total = totalOf(body, totalKey, label);
  if (total !== rows.length) throw new Error(`Huawei's AAD ${label} list total does not match its returned rows; inventory may be incomplete.`);
  return rows;
}

// Offset pagination is validated on every page: totals must be safe nonnegative integers that stay
// stable across pages, the collected rows may never exceed the total, the list must be complete,
// duplicate IDs block management, and rows are never silently filtered out.
export async function aadPage(session: BetterUiSession, path: string, itemsKey: string, totalKey: string, idKey: string, label: string, arrayKeys: readonly string[] = []): Promise<Record<string, unknown>[]> {
  const separator = path.includes("?") ? "&" : "?";
  const scope = await aadScopeFor(session, path);
  const rows: Record<string, unknown>[] = [];
  let total: number | undefined;
  for (let page = 0; page < 1000; page++) {
    const body = await aadFetch(session, `${path}${separator}offset=${rows.length}&limit=100`);
    const items = identifiedRows(body[itemsKey], idKey, label, arrayKeys);
    for (const row of items) assertScopeEcho(scope, row);
    const pageTotal = totalOf(body, totalKey, label);
    if (total === undefined) total = pageTotal;
    else if (pageTotal !== total) throw new Error(`Huawei's AAD ${label} list total changed between pages; inventory may be incomplete.`);
    rows.push(...items);
    if (rows.length > total) throw new Error(`Huawei's AAD ${label} list exceeds its reported total; inventory may be incomplete.`);
    if (rows.length === total) break;
    if (!items.length) throw new Error(`Huawei returned an incomplete AAD ${label} list before its reported total; inventory may be incomplete.`);
  }
  if (rows.length !== total) throw new Error(`Huawei's AAD ${label} list ended before its reported total; inventory may be incomplete.`);
  return identifiedRows(rows, idKey, label, arrayKeys);
}

export type AadProtectedIpRow = Record<string, unknown> & { policy_name: string };

export const aadRowName = {
  package: (row: Record<string, unknown>) => asString(row.package_name, String(row.package_id)),
  policy: (row: Record<string, unknown>) => asString(row.name, String(row.id)),
  protectedIp: (row: Record<string, unknown>) => asString(row.name, asString(row.ip, String(row.id))),
  instance: (row: Record<string, unknown>) => asString(row.instance_name, String(row.instance_id)),
  domain: (row: Record<string, unknown>) => asString(row.domain_name, String(row.domain_id)),
};

export const aadPackages = (session: BetterUiSession) => aadWhole(session, "/v1/cnad/packages", "items", "total", "package_id", "package");
export const aadPolicies = (session: BetterUiSession) => aadPage(session, "/v1/cnad/policies", "items", "total", "id", "policy");
export const aadUnboundIps = (session: BetterUiSession, packageId: string) => aadPage(session, `/v1/cnad/packages/${encodeURIComponent(packageId)}/unbound-protected-ips`, "ips", "total", "id", "unbound protected IP");
export const aadInstances = (session: BetterUiSession) => aadWhole(session, "/v1/aad/instances", "items", "count", "instance_id", "instance", ["ips"]);
export const aadDomains = (session: BetterUiSession) => aadPage(session, "/v1/aad/protected-domains", "items", "count", "domain_id", "protected domain", ["protocol"]);
export const aadInstanceRules = (session: BetterUiSession, instanceId: string, ip: string) => aadPage(session, `/v1/aad/instances/${encodeURIComponent(instanceId)}/${encodeURIComponent(ip)}/rules`, "rules", "total", "rule_id", "forwarding rule");

export async function aadProtectedIps(session: BetterUiSession, packageId?: string): Promise<AadProtectedIpRow[]> {
  const path = packageId === undefined ? "/v1/cnad/protected-ips" : `/v1/cnad/protected-ips?package_id=${encodeURIComponent(packageId)}`;
  const rows = await aadPage(session, path, "items", "total", "id", "protected IP");
  for (const row of rows) {
    if (typeof row.policy_name !== "string") throw new Error("Huawei returned a protected IP without a usable policy binding.");
    if (packageId !== undefined && row.package_id !== packageId) throw new Error("Huawei returned protected IPs from a different package; the package filter could not be verified.");
  }
  return rows as AadProtectedIpRow[];
}

// ListWhiteBlackIpRuleV2 takes only type and instance_id, never paginates, and answers with
// {total, ips:[{ip, desc}]}. The total must equal the row count exactly, entries must be unique
// valid IPs, a provided instance_id echo must match, and descriptions are never surfaced.
export async function aadInstanceBlackwhite(session: BetterUiSession, instanceId: string, type: "black" | "white"): Promise<string[]> {
  const body = await aadFetch(session, `/v2/aad/policies/ddos/blackwhite-list?type=${type}&instance_id=${encodeURIComponent(instanceId)}`);
  aadVerifyEcho(body, "instance_id", instanceId);
  const total = totalOf(body, "total", `instance ${type} list`);
  const entries = body.ips;
  if (!Array.isArray(entries)) throw new Error(`Huawei returned no AAD instance ${type} list.`);
  if (total !== entries.length) throw new Error(`Huawei's AAD instance ${type} list total does not match its returned rows.`);
  const ips: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    assertScopeEcho({ kind: "project", projectId: session.projectId }, asRecord(entry));
    const ip = asRecord(entry).ip;
    if (typeof ip !== "string" || !isIP(ip)) throw new Error(`Huawei returned an invalid entry in the AAD instance ${type} list.`);
    if (seen.has(ip)) throw new Error(`Huawei returned a duplicate entry in the AAD instance ${type} list.`);
    seen.add(ip);
    ips.push(ip);
  }
  return ips;
}
