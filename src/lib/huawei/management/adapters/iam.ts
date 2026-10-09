import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiAccountFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";
const userName: ManagementField = { key: "name", label: "IAM user name", required: true, min: 1, max: 64, pattern: "^[A-Za-z_.-][A-Za-z0-9_. -]*$" };
const groupName: ManagementField = { key: "name", label: "Group name", required: true, min: 1, max: 128 };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 255, maxBytes: 255, allowEmpty: true };
const password: ManagementField = { key: "password", label: "Password", type: "password", required: true, min: 6, max: 32, help: "The account's IAM password policy also applies." };
const access: ManagementField = { key: "access", label: "Access mode", type: "select", required: true, defaultValue: "console", choices: [{ value: "console", label: "Console access" }, { value: "programmatic", label: "Programmatic access" }, { value: "default", label: "Console and programmatic access" }] };
const groupPrefixes = ["group:"]; const userPrefixes = ["user:"];
const protectedUser = (s: BetterUiSession, r: ManagementResource) => r.id.slice(5) === s.userId || r.name === s.username || r.name === s.accountName;
async function request<T = Record<string, unknown>>(s: BetterUiSession, path: string, method = "GET", body?: unknown, extraHeaders?: Record<string, string>) {
  return huaweiAccountFetch<T>({ ...s, token: s.accountToken! }, path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: extraHeaders });
}
async function domain(s: BetterUiSession) {
  const response = await request(s, "/v3/auth/tokens", "GET", undefined, { "X-Subject-Token": s.accountToken! });
  const token = asRecord(response.token); const scoped = asRecord(token.domain); const user = asRecord(token.user);
  const id = asString(scoped.id, "");
  if (!id || (s.userId && user.id !== s.userId) || asRecord(user.domain).id !== id) throw new ManagementInputError("Unable to verify this account's IAM domain. Sign in again.", 409);
  return id;
}
async function list(s: BetterUiSession, path: string, field: string) {
  const rows: Record<string, unknown>[] = []; const visited = new Set<string>(); let next: string | undefined = path;
  const endpoint = new URL(s.iamEndpoint);
  for (let page = 0; next && page < 1000; page++) {
    if (visited.has(next)) throw new Error("IAM repeated a pagination link; inventory may be incomplete.");
    visited.add(next); const response: Record<string, unknown> = await request(s, next);
    if (!Array.isArray(response[field])) throw new Error(`Invalid IAM ${field} response.`);
    rows.push(...asArray(response[field]).map(asRecord));
    const link: unknown = asRecord(response.links).next;
    if (!link) { next = undefined; break; }
    if (typeof link !== "string") throw new Error("Invalid IAM pagination link.");
    const url: URL = new URL(link, endpoint);
    if (url.origin !== endpoint.origin || url.pathname !== new URL(path, endpoint).pathname) throw new Error("IAM returned an unexpected pagination destination.");
    next = `${url.pathname}${url.search}`;
  }
  if (next) throw new Error("IAM inventory exceeded the pagination limit.");
  return rows;
}
async function identities(s: BetterUiSession, type: "users" | "groups", domainId: string) {
  return (await list(s, `/v3/${type}?domain_id=${encodeURIComponent(domainId)}`, type)).filter(r => r.domain_id === domainId);
}
async function groupMembers(s: BetterUiSession, id: string, domainId: string) {
  return (await list(s, `/v3/groups/${encodeURIComponent(id)}/users`, "users")).filter(r => r.domain_id === domainId);
}
export const iamManagement: ManagementAdapter = {
  title: "Identity and Access Management", accountWide: true,
  operations: [
    { id: "create-user", label: "Create IAM user", kind: "create", description: "Create an account-owned IAM user. Group membership and permissions can be configured separately.", fields: [userName, description, password, access], impact: "A new identity can authenticate using its configured access mode. No group permissions are assigned by this request." },
    { id: "update-user", label: "Edit IAM user", kind: "update", description: "Update the user's name and description while preserving access mode and credentials.", resourcePrefixes: userPrefixes, fields: [userName, description] },
    { id: "enable-user", label: "Enable IAM user", kind: "action", description: "Allow the user to authenticate again.", resourcePrefixes: userPrefixes, fields: [], allowedStatuses: ["Disabled"], confirmation: true, impact: "The user's existing group permissions become usable again." },
    { id: "disable-user", label: "Disable IAM user", kind: "action", description: "Disable another IAM user's authentication. The current signed-in identity is protected.", resourcePrefixes: userPrefixes, fields: [], allowedStatuses: ["Enabled"], confirmation: true, impact: "This user's access and integrations may stop working." },
    { id: "reset-password", label: "Reset IAM user password", kind: "action", description: "Set a new initial password for another user, requiring a change on first login.", resourcePrefixes: userPrefixes, fields: [password], confirmation: true, impact: "Existing password-based clients and sessions may stop working. Password policy is enforced by IAM." },
    { id: "delete-user", label: "Delete IAM user", kind: "delete", description: "Permanently delete another IAM user. The current identity and account owner are protected.", resourcePrefixes: userPrefixes, fields: [], confirmation: true, impact: "The identity and its credentials are permanently removed; applications using this user lose access." },
    { id: "create-group", label: "Create user group", kind: "create", description: "Create an empty group without permissions.", fields: [groupName, description] },
    { id: "update-group", label: "Edit user group", kind: "update", description: "Change group name and description without changing membership or permissions.", resourcePrefixes: groupPrefixes, fields: [groupName, description] },
    { id: "delete-group", label: "Delete empty user group", kind: "delete", description: "Delete an empty group after confirming that it has no members.", resourcePrefixes: groupPrefixes, fields: [], confirmation: true, impact: "The group's permission assignments are removed. The built-in admin group is protected." },
    { id: "members", label: "View group members", kind: "inspect", description: "List current account-owned members of this group.", resourcePrefixes: groupPrefixes, fields: [] },
    { id: "add-member", label: "Add user to group", kind: "action", description: "Add an existing account-owned IAM user to this group.", resourcePrefixes: groupPrefixes, fields: [{ key: "user", label: "IAM user", type: "select", source: "users", required: true }], confirmation: true, impact: "The user receives every permission assigned to this group, including any administrator permissions." },
    { id: "remove-member", label: "Remove user from group", kind: "action", description: "Remove another user's membership in this group. The current identity's memberships are protected.", resourcePrefixes: groupPrefixes, fields: [{ key: "user", label: "Current group member", type: "select", source: "members", required: true }], confirmation: true, impact: "The user loses permissions granted through this group. Existing integrations may stop working." },
  ],
  inventory: async s => {
    const id = await domain(s); const [users, groups] = await Promise.all([identities(s, "users", id), identities(s, "groups", id)]);
    return [...users.map(u => ({ id: `user:${u.id}`, name: asString(u.name), status: u.enabled === true ? "Enabled" : "Disabled", values: { name: asString(u.name), description: asString(u.description, "") } })), ...groups.map(g => ({ id: `group:${g.id}`, name: asString(g.name), status: "Available", values: { name: asString(g.name), description: asString(g.description, "") } }))];
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (!resource || !["add-member", "remove-member"].includes(operation)) return {};
    const id = await domain(s); const members = await groupMembers(s, resource.id.slice(6), id);
    if (operation === "remove-member") return { members: members.filter(u => u.id !== s.userId && u.name !== s.username && u.name !== s.accountName).map(u => ({ value: String(u.id), label: String(u.name) })) };
    const existing = new Set(members.map(m => m.id));
    return { users: (await identities(s, "users", id)).filter(u => !existing.has(u.id)).map(u => ({ value: String(u.id), label: String(u.name) })) };
  },
  invalidationKeys: () => [cloudCacheKeys.listIamUsers],
  execute: async (s, operation, v, resource) => {
    const domainId = await domain(s);
    if (operation === "create-user" || operation === "reset-password") {
      const secret = String(v.password);
      if ([/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(secret)).length < 2) throw new ManagementInputError("Use at least two character types in the IAM password.");
    }
    if (operation === "create-user") {
      const response = await request(s, "/v3.0/OS-USER/users", "POST", { user: { name: v.name, description: v.description ?? "", domain_id: domainId, password: v.password, access_mode: v.access, enabled: true, pwd_status: true } });
      return { message: "IAM user created. Configure group membership and permissions as needed.", resourceId: asRecord(response.user).id ? `user:${asRecord(response.user).id}` : undefined };
    }
    if (operation === "create-group") {
      const response = await request(s, "/v3/groups", "POST", { group: { name: v.name, description: v.description ?? "", domain_id: domainId } });
      return { message: "Empty user group created.", resourceId: asRecord(response.group).id ? `group:${asRecord(response.group).id}` : undefined };
    }
    const id = resource!.id.slice(resource!.id.indexOf(":") + 1);
    const encoded = encodeURIComponent(id);
    if (resource!.id.startsWith("user:")) {
      if (!(await identities(s, "users", domainId)).some(u => u.id === id)) throw new ManagementInputError("The user no longer belongs to this account.", 404);
      if (["update-user", "disable-user", "reset-password", "delete-user"].includes(operation) && protectedUser(s, resource!)) throw new ManagementInputError("The current signed-in identity and account owner are protected. Use their own account settings.", 409);
      if (operation === "delete-user") await request(s, `/v3/users/${encoded}`, "DELETE");
      else if (["update-user", "enable-user", "disable-user", "reset-password"].includes(operation)) {
        const user = operation === "update-user" ? { name: v.name, description: v.description ?? "" } : operation === "reset-password" ? { password: v.password, pwd_status: true } : { enabled: operation === "enable-user" };
        await request(s, `/v3.0/OS-USER/users/${encoded}`, "PUT", { user });
      } else throw new ManagementInputError("Unsupported IAM user operation.");
    } else {
      if (!(await identities(s, "groups", domainId)).some(g => g.id === id)) throw new ManagementInputError("The group no longer belongs to this account.", 404);
      if (["delete-group", "update-group"].includes(operation) && resource!.name.toLowerCase() === "admin") throw new ManagementInputError("The built-in admin group is protected.", 409);
      if (operation === "update-group") await request(s, `/v3/groups/${encoded}`, "PATCH", { group: { name: v.name, description: v.description ?? "" } });
      else if (operation === "members" || operation === "delete-group") {
        const members = await groupMembers(s, id, domainId);
        if (operation === "members") return { message: `${members.length} group members loaded.`, facts: members.map(u => ({ label: asString(u.name), value: `${u.id} · ${u.enabled === true ? "Enabled" : "Disabled"}` })) };
        if (members.length) throw new ManagementInputError("Remove every member before deleting this group.", 409);
        await request(s, `/v3/groups/${encoded}`, "DELETE");
      } else if (operation === "add-member" || operation === "remove-member") {
        const user = (await identities(s, "users", domainId)).find(u => u.id === v.user);
        if (!user) throw new ManagementInputError("The user no longer belongs to this account.", 404);
        if (operation === "remove-member" && (user.id === s.userId || user.name === s.username || user.name === s.accountName)) throw new ManagementInputError("The current identity and account owner's memberships are protected.", 409);
        const exists = (await groupMembers(s, id, domainId)).some(u => u.id === v.user);
        if (exists !== (operation === "remove-member")) throw new ManagementInputError("Group membership changed. Refresh the form.", 409);
        await request(s, `/v3/groups/${encoded}/users/${encodeURIComponent(String(v.user))}`, operation === "add-member" ? "PUT" : "DELETE");
      } else throw new ManagementInputError("Unsupported IAM group operation.");
    }
    return { message: "IAM operation completed." };
  },
};
