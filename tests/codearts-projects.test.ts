import assert from "node:assert/strict";
import { test } from "node:test";
import { listCodeArtsProjects, loadAcrossCodeArtsProjects } from "@/lib/huawei/codearts-projects";
import { listCodeArtsRepositories } from "@/lib/huawei/services/codearts-repo";
import { listCodeArtsBuildJobs } from "@/lib/huawei/services/codearts-build";
import { listCodeArtsPipelines } from "@/lib/huawei/services/codearts-pipeline";
import { listCodeArtsDeployApplications } from "@/lib/huawei/services/codearts-deploy";
import { CloudLoadError } from "@/lib/huawei/errors";
import { huaweiArrayList } from "@/lib/huawei/http";
import { session } from "./fixtures/session";

const workspaceId = "a".repeat(32);
const workspace = { project_id: workspaceId, project_name: "Developer workspace" };

test("CodeArts inventory resolves developer workspace IDs before reading each service", async t => {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url.pathname, body });
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    if (url.pathname === "/v4/projects") {
      assert.equal(url.hostname, `projectman-ext.${session.region}.myhuaweicloud.com`);
      return Response.json({ projects: [workspace], total: 1 });
    }
    if (url.pathname.endsWith("/repositories")) return Response.json([{ id: 123, name: "repo" }]);
    if (url.pathname.endsWith("/list") && url.pathname.includes("/job/")) return Response.json({ result: { job_list: [{ id: "job", name: "Build" }] } });
    if (url.pathname.includes("/pipelines/")) return Response.json({ pipelines: [{ pipeline_id: "pipeline", name: "Pipeline" }], total: 1 });
    if (url.pathname === "/v1/applications/list") return Response.json({ applications: [{ id: "app", name: "App" }] });
    throw new Error(`Unexpected route ${url.pathname}`);
  });
  for (const loader of [listCodeArtsRepositories, listCodeArtsBuildJobs, listCodeArtsPipelines, listCodeArtsDeployApplications]) {
    const rows = await loader(session);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].projectId, workspaceId);
    assert.equal(rows[0].projectName, workspace.project_name);
  }
  assert.ok(calls.some(call => call.path === `/v4/projects/${workspaceId}/repositories`));
  assert.ok(calls.some(call => call.path === `/v1/job/${workspaceId}/list`));
  assert.ok(calls.some(call => call.path === `/v5/${workspaceId}/api/pipelines/list` && call.body?.project_id === workspaceId));
  assert.ok(calls.some(call => call.path === "/v1/applications/list" && call.body?.project_id === workspaceId));
  assert.ok(calls.every(call => !call.path.includes(session.projectId)));
});

test("CodeArts resolves each region once even when IAM has multiple subprojects there", async t => {
  let projectReads = 0;
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => {
    projectReads++;
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    return Response.json({ projects: [workspace], total: 1 });
  });
  const result = await loadAcrossCodeArtsProjects({ ...session, projects: [{ ...session.projects[0], projectId: "another-iam-project", token: "other-token" }, session.projects[0]] }, async scope => [scope.projectId]);
  assert.deepEqual(result, [workspaceId]);
  assert.equal(projectReads, 1);
});

test("CodeArts project pagination reaches later workspaces and rejects malformed IDs", async t => {
  let malformed = false;
  const positions: number[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const offset = Number(new URL(input).searchParams.get("offset")); positions.push(offset);
    return Response.json({ projects: malformed ? [{ ...workspace, project_id: "IAM-project" }] : offset === 0 ? Array.from({ length: 100 }, (_, i) => ({ project_id: i.toString(16).padStart(32, "0"), project_name: `Workspace ${i}` })) : [workspace], total: malformed ? 1 : 101 });
  });
  assert.equal((await listCodeArtsProjects(session.projects[0])).length, 101);
  assert.deepEqual(positions, [0, 100]);
  malformed = true;
  await assert.rejects(listCodeArtsProjects(session.projects[0]), /verified workspace ID/);
});

test("CodeArts retains successful workspaces while surfacing a denied workspace", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ projects: [workspace, { project_id: "b".repeat(32), project_name: "Denied workspace" }], total: 2 }));
  await assert.rejects(loadAcrossCodeArtsProjects(session, async scope => {
    if (scope.projectId !== workspaceId) throw new Error("Permission denied");
    return [{ id: "repo", projectId: scope.projectId }];
  }), error => error instanceof CloudLoadError && /Denied workspace: Permission denied/.test(error.message) && (error.partialData as { id: string }[])[0].id === "repo");
});

test("CodeArts project-list permissions are errors, not empty inventory", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error_msg: "Project permission denied" }, { status: 403 }));
  await assert.rejects(listCodeArtsRepositories(session), /Project permission denied/);
});

test("native array pagination reaches later repositories and rejects repeated pages or object envelopes", async t => {
  let mode = "normal";
  const offsets: number[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const offset = Number(new URL(input).searchParams.get("offset")); offsets.push(offset);
    return Response.json(mode === "envelope" ? { repositories: [] } : offset === 0 || mode === "repeated" ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }]);
  });
  const load = () => huaweiArrayList(session, "codeartsrepo", `/v4/projects/${workspaceId}/repositories?limit=2`, { kind: "offset", parameter: "offset", size: 2 });
  assert.equal((await load()).length, 3);
  assert.deepEqual(offsets, [0, 2]);
  mode = "repeated";
  await assert.rejects(load(), /repeated a page/);
  mode = "envelope";
  await assert.rejects(load(), /expected a JSON array/);
});
