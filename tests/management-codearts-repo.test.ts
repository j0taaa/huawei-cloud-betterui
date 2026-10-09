import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { codeartsRepoManagement } from "@/lib/huawei/management/adapters/codearts-repo";
import { CloudLoadError } from "@/lib/huawei/errors";
import { session } from "./fixtures/session";

const workspaceId = "a".repeat(32);
const deniedWorkspaceId = "b".repeat(32);
const repositoryUuid = "c".repeat(32);
const createdUuid = "d".repeat(32);
const repository = { id: 1001, name: "orders-service", project_id: workspaceId, project_name: "Workspace", uuid: repositoryUuid, default_branch: "master", visibility: "private", develop_mode: "normal", archived: false, created_at: "2026-01-02", updated_at: "2026-02-03", ssh_url_to_repo: "git@codehub.example:org/orders-service.git", http_url_to_repo: "https://codehub.example/org/orders-service.git", branch_count: 3, tag_count: 2, member_count: 2 };
const listRow = { id: 1001, name: "orders-service", default_branch: "master", visibility: "private" };
const branches = [
  { name: "master", default: true, can_delete: false, can_read: true, can_download: true, can_push: true },
  { name: "release", default: false, can_delete: false, can_read: true, can_download: true, can_push: false },
  { name: "feature-payments", default: false, can_delete: true, can_read: true, can_download: true, can_push: true },
];
const tags = [
  { name: "v1.0", message: "first", target: "abc123", can_delete: false },
  { name: "v2.0", message: "second", target: "def456", can_delete: true },
];
const resource = { id: `repository:${workspaceId}:1001`, name: "orders-service" };
const repoHost = `codeartsrepo.${session.region}.myhuaweicloud.com`;

function mock(t: TestContext, override: (url: URL, method: string) => unknown = () => undefined) {
  const writes: { path: string; method: string; query: string; body?: unknown }[] = [];
  const reads: string[] = [];
  let createdVisible = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const custom = override(url, method);
    if (custom instanceof Response) return custom;
    if (custom !== undefined) return Response.json(custom);
    if (method !== "GET") {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      writes.push({ path: url.pathname, method, query: url.search, ...(body !== undefined ? { body } : {}) });
      if (method === "POST" && url.pathname === "/v1/repositories") { createdVisible = true; return Response.json({ error: null, result: { repository_uuid: createdUuid }, status: "success" }); }
      if (method === "DELETE" && url.pathname === `/v1/repositories/${repositoryUuid}`) return Response.json({ error: null, result: true, status: "success" });
      if (method === "POST" && url.pathname.endsWith("/repository/branches")) return Response.json({ name: body.branch, default: false, can_delete: true });
      if (method === "DELETE" && url.pathname.endsWith("/repository/branch")) return Response.json({ status: "success" });
      if (method === "POST" && url.pathname.endsWith("/repository/tags")) return Response.json({ name: body.tag_name, message: body.message ?? "", target: "abc123" });
      if (method === "DELETE" && url.pathname.endsWith("/repository/tag")) return Response.json({});
      if (method === "PUT" && url.pathname.endsWith("/watermark")) return Response.json({ watermark: body.watermark, view_watermark: false });
      throw new Error(`Unexpected write ${method} ${url.pathname}`);
    }
    reads.push(`GET ${url.hostname}${url.pathname}`);
    if (url.pathname === "/v4/projects") return Response.json({ projects: [{ project_id: workspaceId, project_name: "Workspace" }], total: 1 });
    if (url.pathname === `/v4/projects/${workspaceId}/repositories`) return Response.json(createdVisible ? [listRow, { id: 1002, name: "billing-service" }] : [listRow]);
    if (url.pathname === "/v4/repositories/1001") return Response.json(repository);
    if (url.pathname === "/v4/repositories/1002") return Response.json({ ...repository, id: 1002, name: "billing-service", uuid: createdUuid });
    if (url.pathname === "/v4/repositories/1001/repository/branches") return Response.json(branches);
    if (url.pathname === "/v4/repositories/1001/repository/tags") return Response.json(tags);
    if (url.pathname === "/v4/repositories/1001/protected-branches") return Response.json([{ id: 1, name: "master", actions: [{ action: "CreateMergeRequest", enable: true, users: [], user_teams: [], roles: [] }] }]);
    if (url.pathname === "/v4/repositories/1001/protected-tags") return Response.json([{ id: 2, name: "v1.*", actions: [{ action: "CreateTag", enable: false, users: [], user_teams: [], roles: [] }] }]);
    if (url.pathname === "/v4/repositories/1001/general-policy") return Response.json({ disable_fork: false, generate_pre_merge_ref: false, branch_name_regex: "", tag_name_regex: "", forbidden_developer_create_branch: false, repo_encryption_enabled: false });
    if (url.pathname === "/v4/repositories/1001/watermark") return Response.json({ watermark: false, view_watermark: false });
    throw new Error(`Unexpected read ${url.hostname}${url.pathname}`);
  });
  return { writes, reads };
}

test("CodeArts inventory resolves live workspaces and keeps composite repository IDs", async t => {
  const { reads } = mock(t);
  const resources = await codeartsRepoManagement.inventory(session);
  assert.deepEqual(resources.map(item => item.id), [`repository:${workspaceId}:1001`]);
  assert.equal(resources[0].name, "orders-service");
  assert.equal(resources[0].values?.workspaceName, "Workspace");
  assert.ok(reads.includes(`GET projectman-ext.${session.region}.myhuaweicloud.com/v4/projects`));
  assert.ok(reads.includes(`GET ${repoHost}/v4/projects/${workspaceId}/repositories`));
  assert.ok(reads.every(read => !read.includes(session.projectId)));
});

test("CodeArts inventory keeps successful workspaces while surfacing a denied workspace", async t => {
  mock(t, url => {
    if (url.pathname === "/v4/projects") return { projects: [{ project_id: workspaceId, project_name: "Workspace" }, { project_id: deniedWorkspaceId, project_name: "Denied" }], total: 2 };
    if (url.pathname === `/v4/projects/${deniedWorkspaceId}/repositories`) return Response.json({ error_msg: "Permission denied" }, { status: 403 });
    return undefined;
  });
  await assert.rejects(codeartsRepoManagement.inventory(session), error => error instanceof CloudLoadError && /Denied: 403.*permission denied/.test(error.message) && (error.partialData as { id: string }[])[0].id === `repository:${workspaceId}:1001`);
});

test("Repository creation offers live workspaces and posts the native private v3 body", async t => {
  const { writes } = mock(t);
  const choices = await codeartsRepoManagement.options!(session, "create-repository");
  assert.deepEqual(choices.workspaces, [{ value: workspaceId, label: "Workspace" }]);
  await assert.rejects(codeartsRepoManagement.execute(session, "create-repository", { workspace: deniedWorkspaceId, name: "billing-service" }), /no longer accessible/);
  assert.equal(writes.length, 0);
  const result = await codeartsRepoManagement.execute(session, "create-repository", { workspace: workspaceId, name: "billing-service", description: "" });
  assert.deepEqual(writes, [{ path: "/v1/repositories", method: "POST", query: "", body: { name: "billing-service", project_uuid: workspaceId, import_members: 0, visibility_level: 0, enable_readme: 0, description: "" } }]);
  assert.equal(result.resourceId, `repository:${workspaceId}:1002`);
  assert.ok(result.message.includes("Private repository billing-service"));
  assert.ok(!JSON.stringify(writes[0].body).includes("import_url"));
});

test("Repository creation rejects HTTP 200 native error envelopes", async t => {
  mock(t, (url, method) => {
    if (method === "POST" && url.pathname === "/v1/repositories") return { error: { code: "RepoDuplicateName", message: "repository name already exists" }, result: null, status: "failed" };
    return undefined;
  });
  await assert.rejects(codeartsRepoManagement.execute(session, "create-repository", { workspace: workspaceId, name: "orders-service" }), /rejected by CodeArts/);
});

test("Repository creation rejects a failed native status without an error object", async t => {
  mock(t, (url, method) => (method === "POST" && url.pathname === "/v1/repositories" ? { error: null, result: null, status: "failed" } : undefined));
  await assert.rejects(codeartsRepoManagement.execute(session, "create-repository", { workspace: workspaceId, name: "billing-service" }), /status failed/);
});

test("Repository creation without a verified UUID is never reported as a located resource", async t => {
  mock(t, (url, method) => (method === "POST" && url.pathname === "/v1/repositories" ? { error: null, result: {}, status: "success" } : undefined));
  await assert.rejects(codeartsRepoManagement.execute(session, "create-repository", { workspace: workspaceId, name: "billing-service" }), /no verified repository UUID/);
});

test("Repository inspection verifies live workspace ownership and reports native metadata", async t => {
  const { reads } = mock(t);
  const result = await codeartsRepoManagement.execute(session, "inspect", {}, resource);
  assert.ok(result.facts!.some(fact => fact.label === "uuid" && fact.value === repositoryUuid));
  assert.ok(result.facts!.some(fact => fact.label === "default branch" && fact.value === "master"));
  assert.ok(result.message.includes("developer workspace Workspace"));
  assert.ok(reads.includes(`GET ${repoHost}/v4/repositories/1001`));
});

test("Repository operations refuse missing workspaces, lost ownership and parent mismatches", async t => {
  let emptyProjects = true, emptyRepos = false, foreignParent = false;
  const { writes } = mock(t, url => {
    if (emptyProjects && url.pathname === "/v4/projects") return { projects: [], total: 0 };
    if (emptyRepos && url.pathname === `/v4/projects/${workspaceId}/repositories`) return [];
    if (foreignParent && url.pathname === "/v4/repositories/1001") return { ...repository, project_id: deniedWorkspaceId };
    return undefined;
  });
  await assert.rejects(codeartsRepoManagement.execute(session, "delete", {}, resource), /workspace is no longer accessible/);
  emptyProjects = false; emptyRepos = true;
  await assert.rejects(codeartsRepoManagement.execute(session, "delete", {}, resource), /no longer belongs/);
  emptyRepos = false; foreignParent = true;
  await assert.rejects(codeartsRepoManagement.execute(session, "delete", {}, resource), /scope could not be verified/);
  assert.equal(writes.length, 0);
});

test("Repository deletion resolves the v3 UUID and never sends the numeric ID", async t => {
  const { writes } = mock(t);
  await codeartsRepoManagement.execute(session, "delete", {}, resource);
  assert.deepEqual(writes, [{ path: `/v1/repositories/${repositoryUuid}`, method: "DELETE", query: "" }]);
  assert.ok(writes.every(write => write.path !== "/v1/repositories/1001"));
});

test("Repository deletion refuses unverified UUIDs and unconfirmed native results", async t => {
  let missingUuid = true, nativeReject = false, silentResult = false;
  mock(t, (url, method) => {
    if (missingUuid && url.pathname === "/v4/repositories/1001") return { ...repository, uuid: undefined };
    if (nativeReject && method === "DELETE" && url.pathname === `/v1/repositories/${repositoryUuid}`) return { error: { message: "repository has running pipelines" }, result: false, status: "success" };
    if (silentResult && method === "DELETE" && url.pathname === `/v1/repositories/${repositoryUuid}`) return { error: null, result: false, status: "success" };
    return undefined;
  });
  await assert.rejects(codeartsRepoManagement.execute(session, "delete", {}, resource), /UUID could not be verified/);
  missingUuid = false; nativeReject = true;
  await assert.rejects(codeartsRepoManagement.execute(session, "delete", {}, resource), /rejected by CodeArts/);
  nativeReject = false; silentResult = true;
  await assert.rejects(codeartsRepoManagement.execute(session, "delete", {}, resource), /did not confirm repository deletion/);
});

test("Branch deletion preserves the default and protected branches and stale choices", async t => {
  const { writes } = mock(t);
  const choices = await codeartsRepoManagement.options!(session, "delete-branch", resource);
  assert.deepEqual(choices.branches?.map(choice => choice.value), ["master", "release", "feature-payments"]);
  await assert.rejects(codeartsRepoManagement.execute(session, "delete-branch", { branch: "master" }, resource), /default branch/);
  await assert.rejects(codeartsRepoManagement.execute(session, "delete-branch", { branch: "release" }, resource), /protected/);
  await assert.rejects(codeartsRepoManagement.execute(session, "delete-branch", { branch: "gone" }, resource), /no longer exists/);
  assert.equal(writes.length, 0);
  await codeartsRepoManagement.execute(session, "delete-branch", { branch: "feature-payments" }, resource);
  assert.deepEqual(writes, [{ path: "/v4/repositories/1001/repository/branch", method: "DELETE", query: "?branch_name=feature-payments" }]);
});

test("Branch and tag creation use fresh parent refs and native bodies", async t => {
  const { writes } = mock(t);
  await assert.rejects(codeartsRepoManagement.execute(session, "create-branch", { branch: "feature/billing", ref: "gone" }, resource), /parent branch no longer exists/);
  await assert.rejects(codeartsRepoManagement.execute(session, "create-branch", { branch: "master", ref: "master" }, resource), /already exists/);
  assert.equal(writes.length, 0);
  await codeartsRepoManagement.execute(session, "create-branch", { branch: "feature/billing", ref: "master" }, resource);
  await codeartsRepoManagement.execute(session, "create-tag", { tagName: "v3.0", ref: "master", message: "Release 3" }, resource);
  await codeartsRepoManagement.execute(session, "create-tag", { tagName: "v3.1", ref: "release" }, resource);
  assert.deepEqual(writes, [
    { path: "/v4/repositories/1001/repository/branches", method: "POST", query: "", body: { branch: "feature/billing", ref: "master" } },
    { path: "/v4/repositories/1001/repository/tags", method: "POST", query: "", body: { tag_name: "v3.0", ref: "master", message: "Release 3" } },
    { path: "/v4/repositories/1001/repository/tags", method: "POST", query: "", body: { tag_name: "v3.1", ref: "release" } },
  ]);
});

test("Tag deletion honours the current can_delete flag and stale choices", async t => {
  const { writes } = mock(t);
  await assert.rejects(codeartsRepoManagement.execute(session, "delete-tag", { tag: "v1.0" }, resource), /not deletable/);
  await assert.rejects(codeartsRepoManagement.execute(session, "delete-tag", { tag: "gone" }, resource), /no longer exists/);
  assert.equal(writes.length, 0);
  await codeartsRepoManagement.execute(session, "delete-tag", { tag: "v2.0" }, resource);
  assert.deepEqual(writes, [{ path: "/v4/repositories/1001/repository/tag", method: "DELETE", query: "?tag_name=v2.0" }]);
});

test("Protected refs and settings inspection read the documented native endpoints", async t => {
  const { reads } = mock(t);
  const protectedRefs = await codeartsRepoManagement.execute(session, "protected-refs", {}, resource);
  assert.ok(protectedRefs.facts!.some(fact => fact.label === "protected branch · master" && fact.value.includes("CreateMergeRequest")));
  assert.ok(protectedRefs.facts!.some(fact => fact.label === "protected tag · v1.*" && fact.value.includes("CreateTag (disabled)")));
  const settings = await codeartsRepoManagement.execute(session, "settings", {}, resource);
  assert.ok(settings.facts!.some(fact => fact.label === "watermark" && fact.value === "false"));
  for (const suffix of ["protected-branches", "protected-tags", "general-policy", "watermark"]) assert.ok(reads.includes(`GET ${repoHost}/v4/repositories/1001/${suffix}`));
});

test("Watermark updates write only the documented setting and refuse archived repositories", async t => {
  let archived = true;
  const { writes } = mock(t, url => (archived && url.pathname === "/v4/repositories/1001" ? { ...repository, archived: true } : undefined));
  await assert.rejects(codeartsRepoManagement.execute(session, "update-settings", { watermark: true }, resource), /archived/);
  assert.equal(writes.length, 0);
  archived = false;
  await codeartsRepoManagement.execute(session, "update-settings", { watermark: true }, resource);
  assert.deepEqual(writes, [{ path: "/v4/repositories/1001/watermark", method: "PUT", query: "", body: { watermark: true } }]);
});

test("Branch and repository lists reject synthetic envelopes instead of guessing", async t => {
  mock(t, url => (url.pathname === "/v4/repositories/1001/repository/branches" ? { branches } : undefined));
  await assert.rejects(codeartsRepoManagement.execute(session, "branches", {}, resource), /expected a JSON array/);
  mock(t, url => (url.pathname === `/v4/projects/${workspaceId}/repositories` ? { repositories: [listRow] } : undefined));
  await assert.rejects(codeartsRepoManagement.inventory(session), /expected a JSON array/);
});

test("Repository numeric IDs respect the documented positive 32-bit range", async t => {
  for (const id of [0, -1, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
    mock(t, url => url.pathname === `/v4/projects/${workspaceId}/repositories` ? [{ ...listRow, id }] : undefined);
    await assert.rejects(codeartsRepoManagement.inventory(session), /verified numeric ID/);
  }
});

test("Repository refs with missing deletion permissions or incorrect default flags are preserved", async t => {
  const { writes } = mock(t, url => url.pathname.endsWith("/repository/branches") ? [{ ...branches[0], default: false, can_delete: true }, { ...branches[2], can_delete: null }] : url.pathname.endsWith("/repository/tags") ? [{ ...tags[1], can_delete: null }] : undefined);
  await assert.rejects(codeartsRepoManagement.execute(session, "delete-branch", { branch: "master" }, resource), /default branch/);
  await assert.rejects(codeartsRepoManagement.execute(session, "delete-branch", { branch: "feature-payments" }, resource), /could not be verified/);
  await assert.rejects(codeartsRepoManagement.execute(session, "delete-tag", { tag: "v2.0" }, resource), /could not be verified/);
  assert.equal(writes.length, 0);
});

test("Repository writes require actual native success identities and setting acknowledgements", async t => {
  mock(t, (url, method) => method === "POST" && url.pathname === "/v1/repositories" ? { result: { repository_uuid: createdUuid } } : method === "POST" && url.pathname.endsWith("/repository/branches") ? {} : method === "POST" && url.pathname.endsWith("/repository/tags") ? {} : method === "PUT" ? { watermark: false } : method === "DELETE" && url.pathname.endsWith("/repository/branch") ? { status: "failed" } : undefined);
  await assert.rejects(codeartsRepoManagement.execute(session, "create-repository", { workspace: workspaceId, name: "billing-service" }), /verified success status/);
  await assert.rejects(codeartsRepoManagement.execute(session, "create-branch", { branch: "new-branch", ref: "master" }, resource), /confirm the new branch/);
  await assert.rejects(codeartsRepoManagement.execute(session, "create-tag", { tagName: "v3.0", ref: "master" }, resource), /confirm the new tag/);
  await assert.rejects(codeartsRepoManagement.execute(session, "update-settings", { watermark: true }, resource), /confirm the new watermark/);
  await assert.rejects(codeartsRepoManagement.execute(session, "delete-branch", { branch: "feature-payments" }, resource), /confirm branch deletion/);
});

test("Repository creation never locates a different UUID after a same-name inventory race", async t => {
  mock(t, url => url.pathname === "/v4/repositories/1002" ? { ...repository, id: 1002, name: "billing-service", uuid: "e".repeat(32) } : undefined);
  const result = await codeartsRepoManagement.execute(session, "create-repository", { workspace: workspaceId, name: "billing-service" });
  assert.equal(result.resourceId, undefined); assert.ok(result.message.includes("created"));
});
