import "server-only";
import { huaweiArrayList, huaweiFetch } from "@/lib/huawei/http";
import { asRecord, firstString } from "@/lib/huawei/parsers";
import { listCodeArtsProjects } from "@/lib/huawei/codearts-projects";
import { finishCloudLoad, settledValue } from "@/lib/huawei/errors";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

// CodeArts repositories live inside developer workspaces (32-hex IDs from projectman), never the
// IAM project of the session. Resource IDs keep workspace and numeric repository ID together.
const compositeId = /^repository:([a-f0-9]{32}):(\d+)$/i;
const uuidPattern = /^[a-f0-9]{32}$/i;

const workspaceField: ManagementField = { key: "workspace", label: "Developer workspace", type: "select", source: "workspaces", required: true, help: "CodeArts developer workspaces are separate from the IAM projects of this session." };
const repositoryNameField: ManagementField = { key: "name", label: "Repository name", required: true, max: 128, pattern: "^[A-Za-z][A-Za-z0-9_-]{0,127}$", help: "Starts with a letter; letters, digits, hyphens and underscores only." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 1024, allowEmpty: true };
const branchNameField: ManagementField = { key: "branch", label: "New branch name", required: true, max: 200, pattern: "^(?!refs/)(?![-.])(?!.*\\.lock$)[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*(?:/[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*)*$" };
const tagNameField: ManagementField = { key: "tagName", label: "New tag name", required: true, max: 200, pattern: "^(?![-.])(?!.*\\.lock$)[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$" };
const refField: ManagementField = { key: "ref", label: "Based on branch", type: "select", source: "branches", required: true };
const branchSelectField: ManagementField = { key: "branch", label: "Branch", type: "select", source: "branches", required: true };
const tagSelectField: ManagementField = { key: "tag", label: "Tag", type: "select", source: "tags", required: true };
const tagMessageField: ManagementField = { key: "message", label: "Tag message", type: "textarea", max: 1024, allowEmpty: true };
const watermarkField: ManagementField = { key: "watermark", label: "Watermark repository file views", type: "boolean", required: true };

const arrayPagination = { kind: "offset" as const, parameter: "offset", size: 100 };

/** Native v4 project repositories are bare JSON arrays with offset pagination. */
async function workspaceRepositories(scope: HuaweiProjectSession) {
  return huaweiArrayList<Record<string, unknown>>(scope, "codeartsrepo", `/v4/projects/${scope.projectId}/repositories?offset=0&limit=100&order_by=updated_at&sort=desc`, arrayPagination);
}

function repositoryBranches(scope: HuaweiProjectSession, repositoryId: string) {
  return huaweiArrayList<Record<string, unknown>>(scope, "codeartsrepo", `/v4/repositories/${repositoryId}/repository/branches?offset=0&limit=100`, arrayPagination);
}

function repositoryTags(scope: HuaweiProjectSession, repositoryId: string) {
  return huaweiArrayList<Record<string, unknown>>(scope, "codeartsrepo", `/v4/repositories/${repositoryId}/repository/tags?offset=0&limit=100`, arrayPagination);
}

function repositoryResource(row: unknown, workspace: { id: string; name: string }): ManagementResource {
  const item = asRecord(row);
  const id = typeof item.id === "number" ? item.id : typeof item.id === "string" && /^\d+$/.test(item.id) ? Number(item.id) : undefined;
  if (id === undefined || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new Error("Huawei returned a CodeArts repository without a verified numeric ID.");
  const name = firstString([item.name, item.repository_name], "");
  if (!name) throw new Error("Huawei returned a CodeArts repository without a name.");
  return {
    id: `repository:${workspace.id}:${id}`,
    name,
    status: firstString([item.status], item.archived === true ? "archived" : "") || undefined,
    values: { workspace: workspace.id, workspaceName: workspace.name, repositoryId: id, defaultBranch: firstString([item.default_branch], "-"), visibility: firstString([item.visibility, item.repository_type], "-") },
  };
}

/** v3 endpoints answer HTTP 200 with an error/status/result envelope; a native rejection is never success. */
function v3Outcome(body: unknown, action: string) {
  const record = asRecord(body);
  if (typeof record.error === "string" && record.error.trim()) throw new ManagementInputError(`${action} was rejected by CodeArts: ${record.error}`, 409);
  const error = asRecord(record.error);
  if (Object.keys(error).length) throw new ManagementInputError(`${action} was rejected by CodeArts. Check the repository state and native task details before retrying.`, 409);
  const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  if (status && status !== "success") throw new ManagementInputError(`${action} was rejected by CodeArts (status ${record.status}).`, 409);
  if (!status) throw new Error(`${action} returned no verified success status. Check the repository before submitting another request.`);
  return record.result;
}

type VerifiedRepository = { scope: HuaweiProjectSession; workspaceName: string; repositoryId: string; repository: Record<string, unknown> };

/** Re-verify live workspace membership and repository ownership before every repository access. */
async function verifiedRepository(session: BetterUiSession, resource?: ManagementResource): Promise<VerifiedRepository> {
  const match = resource?.id.match(compositeId);
  if (!match) throw new ManagementInputError("Select a CodeArts repository.");
  const workspaceId = match[1].toLowerCase();
  const repositoryId = match[2];
  const workspace = (await listCodeArtsProjects(session)).find((item) => item.id.toLowerCase() === workspaceId);
  if (!workspace) throw new ManagementInputError("The repository's developer workspace is no longer accessible to this account.", 404);
  const scope: HuaweiProjectSession = { ...session, projectId: workspace.id, projectName: workspace.name };
  if (!(await workspaceRepositories(scope)).some((row) => String(asRecord(row).id) === repositoryId)) throw new ManagementInputError("The repository no longer belongs to this developer workspace.", 404);
  const repository = asRecord(await huaweiFetch<unknown>(scope, "codeartsrepo", `/v4/repositories/${repositoryId}`));
  if (String(repository.id) !== repositoryId || firstString([repository.project_id], "") !== workspace.id) throw new ManagementInputError("The repository's workspace scope could not be verified.", 404);
  return { scope, workspaceName: workspace.name, repositoryId, repository };
}

async function writableRepository(session: BetterUiSession, resource?: ManagementResource) {
  const verified = await verifiedRepository(session, resource);
  if (verified.repository.archived !== false) throw new ManagementInputError("The repository is archived or its writable state is unverified; check CodeArts before changing it.", 409);
  return verified;
}

function refNames(rows: Record<string, unknown>[]) {
  return rows.map((row) => firstString([row.name], "")).filter(Boolean);
}

function branchChoices(rows: Record<string, unknown>[]): ManagementChoice[] {
  return rows.filter((row) => firstString([row.name], "")).map((row) => ({ value: String(row.name), label: row.default === true ? `${String(row.name)} · default` : String(row.name) }));
}

function tagChoices(rows: Record<string, unknown>[]): ManagementChoice[] {
  return rows.filter((row) => firstString([row.name], "")).map((row) => ({ value: String(row.name), label: String(row.name) }));
}

const facts = (item: Record<string, unknown>, keys: string[]) => keys.map((key) => ({ label: key.replaceAll("_", " "), value: typeof item[key] === "string" || typeof item[key] === "number" || typeof item[key] === "boolean" ? String(item[key]) : "-" }));

export const codeartsRepoManagement: ManagementAdapter = {
  title: "CodeArts Repositories",
  operations: [
    { id: "create-repository", label: "Create private repository", kind: "create", description: "Create a private repository in a live CodeArts developer workspace. Project members are not imported and no remote repository is imported.", fields: [workspaceField, repositoryNameField, descriptionField] },
    { id: "inspect", label: "View repository metadata", kind: "inspect", resourcePrefixes: ["repository:"], description: "Inspect the repository's workspace, UUID, default branch, visibility and access URLs.", fields: [] },
    { id: "branches", label: "List branches", kind: "inspect", resourcePrefixes: ["repository:"], description: "List current branches with their default and deletion flags.", fields: [] },
    { id: "create-branch", label: "Create branch", kind: "action", resourcePrefixes: ["repository:"], description: "Create a branch from a current branch of this repository.", fields: [branchNameField, refField] },
    { id: "delete-branch", label: "Delete branch", kind: "action", resourcePrefixes: ["repository:"], description: "Delete a current branch that is neither the default branch nor protected.", fields: [branchSelectField], confirmation: true, impact: "The branch and its open merge requests are permanently removed. Commits reachable only from this branch become unreachable." },
    { id: "tags", label: "List tags", kind: "inspect", resourcePrefixes: ["repository:"], description: "List current tags with their target commits and deletion flags.", fields: [] },
    { id: "create-tag", label: "Create tag", kind: "action", resourcePrefixes: ["repository:"], description: "Create a tag on a current branch of this repository.", fields: [tagNameField, refField, tagMessageField] },
    { id: "delete-tag", label: "Delete tag", kind: "action", resourcePrefixes: ["repository:"], description: "Delete a current tag that is not protected.", fields: [tagSelectField], confirmation: true, impact: "The tag reference is permanently removed. Releases and pipelines pinned to this tag can no longer resolve it." },
    { id: "protected-refs", label: "View protected branches and tags", kind: "inspect", resourcePrefixes: ["repository:"], description: "Inspect native protected branch and tag rules with their configured actions.", fields: [] },
    { id: "settings", label: "View repository settings", kind: "inspect", resourcePrefixes: ["repository:"], description: "Inspect the documented repository general policy and watermark settings.", fields: [] },
    { id: "update-settings", label: "Update watermark setting", kind: "update", resourcePrefixes: ["repository:"], description: "Enable or disable the documented repository watermark setting.", fields: [watermarkField] },
    { id: "delete", label: "Delete repository", kind: "delete", resourcePrefixes: ["repository:"], description: "Permanently delete this repository from its developer workspace after exact-name confirmation.", fields: [], confirmation: true, impact: "All branches, tags, commits, merge requests and repository settings are permanently destroyed. CodeArts Build tasks and pipelines that clone this repository will fail immediately. Deleted repositories cannot be restored." },
  ],
  inventory: async (session) => {
    const workspaces = await listCodeArtsProjects(session);
    const loads = await Promise.allSettled(workspaces.map(async (workspace) => {
      const scope: HuaweiProjectSession = { ...session, projectId: workspace.id, projectName: workspace.name };
      return (await workspaceRepositories(scope)).map((row) => repositoryResource(row, workspace));
    }));
    return finishCloudLoad(loads, loads.flatMap((load) => settledValue(load, [] as ManagementResource[])), workspaces.map((workspace) => workspace.name));
  },
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-repository") return { workspaces: (await listCodeArtsProjects(session)).map((workspace) => ({ value: workspace.id, label: workspace.name })) };
    if (!resource) return {};
    if (operation === "create-branch" || operation === "delete-branch" || operation === "create-tag") {
      const { scope, repositoryId } = await verifiedRepository(session, resource);
      return { branches: branchChoices(await repositoryBranches(scope, repositoryId)) };
    }
    if (operation === "delete-tag") {
      const { scope, repositoryId } = await verifiedRepository(session, resource);
      return { tags: tagChoices(await repositoryTags(scope, repositoryId)) };
    }
    return {};
  },
  invalidationKeys: () => [cloudCacheKeys.listCodeArtsRepositories],
  execute: async (session, operation, values, resource) => {
    if (operation === "create-repository") {
      const workspaceId = String(values.workspace);
      const workspace = (await listCodeArtsProjects(session)).find((item) => item.id === workspaceId);
      if (!workspace) throw new ManagementInputError("The selected developer workspace is no longer accessible to this account.", 404);
      const scope: HuaweiProjectSession = { ...session, projectId: workspace.id, projectName: workspace.name };
      // Native v3 create body: private, no member import, no README generation, no remote import.
      const body = { name: values.name, project_uuid: workspace.id, import_members: 0, visibility_level: 0, enable_readme: 0, description: values.description ?? "" };
      const response = await huaweiFetch<unknown>(scope, "codeartsrepo", "/v1/repositories", { method: "POST", body: JSON.stringify(body) });
      const result = asRecord(v3Outcome(response, "Repository creation"));
      const uuid = firstString([result.repository_uuid], "");
      if (!uuidPattern.test(uuid)) throw new Error("CodeArts accepted the repository but returned no verified repository UUID; check the workspace before retrying.");
      // Best effort: resolve the numeric v4 ID so history points at the canonical composite resource.
      let resourceId: string | undefined;
      try {
        // RepositoryBasicDto does not contain UUID. Resolve the numeric ID by name,
        // then match the creation UUID and workspace against the full native detail.
        const candidate = (await workspaceRepositories(scope)).map(asRecord).find(row => row.name === values.name);
        if (candidate && Number.isSafeInteger(candidate.id) && Number(candidate.id) >= 1 && Number(candidate.id) <= 2147483647) {
          const detail = asRecord(await huaweiFetch<unknown>(scope, "codeartsrepo", `/v4/repositories/${candidate.id}`));
          if (detail.id === candidate.id && detail.project_id === workspace.id && detail.uuid === uuid) resourceId = `repository:${workspace.id}:${candidate.id}`;
        }
      } catch { /* The repository exists; inventory refresh will reveal its numeric ID. */ }
      return { message: `Private repository ${values.name} created in workspace ${workspace.name}. Repository members were not imported; grant access in CodeArts.`, resourceId, facts: [{ label: "repository uuid", value: uuid }] };
    }
    if (operation === "inspect") {
      const { repository, workspaceName } = await verifiedRepository(session, resource);
      return { message: `Repository ${firstString([repository.name], String(resource?.name))} in developer workspace ${workspaceName}.`, facts: facts(repository, ["name", "uuid", "project_id", "project_name", "default_branch", "visibility", "develop_mode", "archived", "created_at", "updated_at", "ssh_url_to_repo", "http_url_to_repo", "branch_count", "tag_count", "member_count"]) };
    }
    if (operation === "branches" || operation === "create-branch" || operation === "delete-branch") {
      const verified = operation === "branches" ? await verifiedRepository(session, resource) : await writableRepository(session, resource);
      const branches = await repositoryBranches(verified.scope, verified.repositoryId);
      if (operation === "branches") return { message: `${branches.length} branches loaded.`, facts: branches.filter((branch) => firstString([branch.name], "")).map((branch) => ({ label: String(branch.name), value: [branch.default === true ? "default branch" : "", branch.can_delete === true ? "deletable" : "deletion permission unavailable"].filter(Boolean).join(" · ") })) };
      if (operation === "create-branch") {
        const ref = String(values.ref);
        if (!refNames(branches).includes(ref)) throw new ManagementInputError("The selected parent branch no longer exists in this repository.", 404);
        if (refNames(branches).includes(String(values.branch))) throw new ManagementInputError("A branch with this name already exists in the repository.", 409);
        const created = asRecord(await huaweiFetch<unknown>(verified.scope, "codeartsrepo", `/v4/repositories/${verified.repositoryId}/repository/branches`, { method: "POST", body: JSON.stringify({ branch: values.branch, ref }) }));
        if (created.name !== values.branch) throw new Error("CodeArts did not confirm the new branch name; check the repository before retrying.");
        return { message: `Branch ${values.branch} created from ${ref}.` };
      }
      const branch = branches.find((item) => item.name === values.branch);
      if (!branch) throw new ManagementInputError("The branch no longer exists in this repository.", 404);
      if (branch.default === true || branch.name === verified.repository.default_branch) throw new ManagementInputError("The default branch cannot be deleted. Change the default branch first.", 409);
      if (branch.can_delete !== true || branch.default !== false) throw new ManagementInputError("The branch is protected, not deletable, or its deletion flags could not be verified.", 409);
      const deleted = asRecord(await huaweiFetch<unknown>(verified.scope, "codeartsrepo", `/v4/repositories/${verified.repositoryId}/repository/branch?branch_name=${encodeURIComponent(String(values.branch))}`, { method: "DELETE" }));
      if (deleted.status !== "success") throw new Error("CodeArts did not confirm branch deletion. Refresh the repository before retrying.");
      return { message: `Branch ${values.branch} deleted.` };
    }
    if (operation === "tags" || operation === "create-tag" || operation === "delete-tag") {
      const verified = operation === "tags" ? await verifiedRepository(session, resource) : await writableRepository(session, resource);
      const tags = await repositoryTags(verified.scope, verified.repositoryId);
      if (operation === "tags") return { message: `${tags.length} tags loaded.`, facts: tags.filter((tag) => firstString([tag.name], "")).map((tag) => ({ label: String(tag.name), value: `${firstString([tag.target], "-")} · ${tag.can_delete === true ? "deletable" : "deletion permission unavailable"}` })) };
      if (operation === "create-tag") {
        const branches = await repositoryBranches(verified.scope, verified.repositoryId);
        const ref = String(values.ref);
        if (!refNames(branches).includes(ref)) throw new ManagementInputError("The selected parent branch no longer exists in this repository.", 404);
        if (refNames(tags).includes(String(values.tagName))) throw new ManagementInputError("A tag with this name already exists in the repository.", 409);
        const body: Record<string, unknown> = { tag_name: values.tagName, ref };
        if (typeof values.message === "string" && values.message) body.message = values.message;
        const created = asRecord(await huaweiFetch<unknown>(verified.scope, "codeartsrepo", `/v4/repositories/${verified.repositoryId}/repository/tags`, { method: "POST", body: JSON.stringify(body) }));
        if (created.name !== values.tagName) throw new Error("CodeArts did not confirm the new tag name; check the repository before retrying.");
        return { message: `Tag ${values.tagName} created from ${ref}.` };
      }
      const tag = tags.find((item) => item.name === values.tag);
      if (!tag) throw new ManagementInputError("The tag no longer exists in this repository.", 404);
      if (tag.can_delete !== true) throw new ManagementInputError("The tag is protected, not deletable, or its deletion permission could not be verified.", 409);
      await huaweiFetch<unknown>(verified.scope, "codeartsrepo", `/v4/repositories/${verified.repositoryId}/repository/tag?tag_name=${encodeURIComponent(String(values.tag))}`, { method: "DELETE" });
      return { message: `Tag ${values.tag} deleted.` };
    }
    if (operation === "protected-refs") {
      const { scope, repositoryId } = await verifiedRepository(session, resource);
      const [protectedBranches, protectedTags] = await Promise.all([
        huaweiArrayList<Record<string, unknown>>(scope, "codeartsrepo", `/v4/repositories/${repositoryId}/protected-branches?offset=0&limit=100`, arrayPagination),
        huaweiArrayList<Record<string, unknown>>(scope, "codeartsrepo", `/v4/repositories/${repositoryId}/protected-tags?offset=0&limit=100`, arrayPagination),
      ]);
      const actionSummary = (row: Record<string, unknown>) => (Array.isArray(row.actions) ? row.actions.map(asRecord).map((action) => `${String(action.action)}${action.enable === false ? " (disabled)" : ""}`).join(", ") : "-");
      return {
        message: `${protectedBranches.length} protected branches and ${protectedTags.length} protected tags loaded.`,
        facts: [
          ...protectedBranches.filter((row) => firstString([row.name], "")).map((row) => ({ label: `protected branch · ${String(row.name)}`, value: actionSummary(row) })),
          ...protectedTags.filter((row) => firstString([row.name], "")).map((row) => ({ label: `protected tag · ${String(row.name)}`, value: actionSummary(row) })),
        ],
      };
    }
    if (operation === "settings") {
      const { scope, repositoryId } = await verifiedRepository(session, resource);
      const [policy, watermark] = await Promise.all([
        huaweiFetch<Record<string, unknown>>(scope, "codeartsrepo", `/v4/repositories/${repositoryId}/general-policy`),
        huaweiFetch<Record<string, unknown>>(scope, "codeartsrepo", `/v4/repositories/${repositoryId}/watermark`),
      ]);
      return { message: "Current repository settings.", facts: [...facts(policy, ["disable_fork", "generate_pre_merge_ref", "branch_name_regex", "tag_name_regex", "forbidden_developer_create_branch", "repo_encryption_enabled"]), ...facts(watermark, ["watermark", "view_watermark"])] };
    }
    if (operation === "update-settings") {
      const { scope, repositoryId } = await writableRepository(session, resource);
      const changed = asRecord(await huaweiFetch<unknown>(scope, "codeartsrepo", `/v4/repositories/${repositoryId}/watermark`, { method: "PUT", body: JSON.stringify({ watermark: values.watermark }) }));
      if (changed.watermark !== values.watermark) throw new Error("CodeArts did not confirm the new watermark setting. Refresh repository settings before retrying.");
      return { message: `Repository watermark ${values.watermark ? "enabled" : "disabled"}.` };
    }
    if (operation === "delete") {
      const { scope, repositoryId, repository } = await verifiedRepository(session, resource);
      // Native v3 deletion is a UUID route: resolve and verify the UUID, never send the numeric v4 ID.
      const uuid = firstString([repository.uuid], "");
      if (!uuidPattern.test(uuid) || uuid === repositoryId) throw new ManagementInputError("The repository UUID could not be verified for deletion.", 409);
      const response = await huaweiFetch<unknown>(scope, "codeartsrepo", `/v1/repositories/${uuid}`, { method: "DELETE" });
      if (v3Outcome(response, "Repository deletion") !== true) throw new Error("CodeArts did not confirm repository deletion; check the workspace before retrying.");
      return { message: `Repository ${resource?.name} deleted from its developer workspace.` };
    }
    throw new ManagementInputError("Unsupported CodeArts repository operation.");
  },
};
