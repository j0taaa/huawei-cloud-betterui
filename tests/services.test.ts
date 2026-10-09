import { CloudLoadError } from "@/lib/huawei/errors";
import { huaweiFetch } from "@/lib/huawei/http";
import { loadAcrossProjects } from "@/lib/huawei/projects";
import { projectRegion } from "@/lib/huawei/regions";
import { listBmsServersForProject } from "@/lib/huawei/services/bms";
import { listCloudFirewallsForProject } from "@/lib/huawei/services/cfw";
import { listCodeArtsBuildJobsForProject } from "@/lib/huawei/services/codearts-build";
import { listCodeArtsDeployApplicationsForProject } from "@/lib/huawei/services/codearts-deploy";
import { listEcsInstancesForProject } from "@/lib/huawei/services/ecs";
import { listEvsDisksForProject } from "@/lib/huawei/services/evs";
import {
  getFunctionGraphFunction,
  listFunctionGraphFunctionsForProject,
} from "@/lib/huawei/services/functiongraph";
import { listIotdaDevicesForProject } from "@/lib/huawei/services/iotda";
import {
  getRdsInstance,
  listRdsInstancesForProject,
} from "@/lib/huawei/services/rds";
import { listVpcsForProject } from "@/lib/huawei/services/vpc";
import assert from "node:assert/strict";
import { test } from "node:test";
import { project, session } from "./fixtures/session";

test("ECS and BMS use one-based page offsets, not row offsets", async (t) => {
  for (const [loader, size] of [
    [listEcsInstancesForProject, 100],
    [listBmsServersForProject, 1000],
  ] as const) {
    const pages: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: string) => {
      pages.push(new URL(input).searchParams.get("offset")!);
      return Response.json({
        servers: Array.from(
          { length: pages.length === 1 ? size : 1 },
          (_, index) => ({ id: `${pages.length}-${index}` }),
        ),
      });
    });
    assert.equal((await loader(project)).length, size + 1);
    assert.deepEqual(pages, ["1", "2"]);
    t.mock.restoreAll();
  }
});

test("EVS and RDS include resources after the first hundred", async (t) => {
  for (const [loader, field] of [
    [listEvsDisksForProject, "cloudvolumes"],
    [listRdsInstancesForProject, "instances"],
  ] as const) {
    const offsets: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: string) => {
      offsets.push(new URL(input).searchParams.get("offset")!);
      return Response.json({
        [field]: Array.from(
          { length: offsets.length === 1 ? 100 : 1 },
          (_, index) => ({ id: `${offsets.length}-${index}`, name: "test" }),
        ),
      });
    });
    const data = await loader(project);
    assert.equal(data.length, 101);
    assert.equal(data.at(-1)?.id, "2-0");
    assert.deepEqual(offsets, ["0", "100"]);
    t.mock.restoreAll();
  }
});

test("FunctionGraph uses numeric next_marker and includes later functions", async (t) => {
  const markers: (string | null)[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    markers.push(new URL(input).searchParams.get("marker"));
    return Response.json({
      functions: [{ func_urn: `urn-${markers.length}`, func_name: "fn" }],
      next_marker: markers.length === 1 ? 400 : 0,
    });
  });
  assert.equal((await listFunctionGraphFunctionsForProject(project)).length, 2);
  assert.deepEqual(markers, [null, "400"]);
});

test("IoTDA follows page.marker and VPC follows page_info.next_marker", async (t) => {
  for (const [loader, field, pageField, markerField] of [
    [listIotdaDevicesForProject, "devices", "page", "marker"],
    [listVpcsForProject, "vpcs", "page_info", "next_marker"],
  ] as const) {
    const markers: (string | null)[] = [];
    t.mock.method(globalThis, "fetch", async (input: string) => {
      markers.push(new URL(input).searchParams.get("marker"));
      return Response.json({
        [field]: [{ id: `item-${markers.length}` }],
        [pageField]: { [markerField]: markers.length === 1 ? "a+/b%" : "" },
      });
    });
    assert.equal((await loader(project)).length, 2);
    assert.deepEqual(markers, [null, "a+/b%"]);
    t.mock.restoreAll();
  }
});

test("CodeArts page requests and CFW offsets preserve their read-only POST payloads", async (t) => {
  for (const [loader, parameter, first, field] of [
    [listCodeArtsDeployApplicationsForProject, "page", 1, "applications"],
    [listCloudFirewallsForProject, "offset", 0, "records"],
  ] as const) {
    const positions: number[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (_input: string, init: RequestInit) => {
        assert.equal(init.method, "POST");
        const body = JSON.parse(String(init.body));
        positions.push(body[parameter]);
        if (parameter === "page")
          assert.equal(body.project_id, project.projectId);
        const rows = Array.from(
          { length: positions.length === 1 ? 100 : 1 },
          (_, index) => ({ id: `${positions.length}-${index}` }),
        );
        return Response.json(
          field === "records"
            ? { data: { records: rows } }
            : { result: { applications: rows } },
        );
      },
    );
    assert.equal((await loader(project)).length, 101);
    assert.deepEqual(
      positions,
      parameter === "page" ? [first, 2] : [first, 100],
    );
    t.mock.restoreAll();
  }
});

test("CodeArts Build retains its zero-based page index", async (t) => {
  const pages: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    pages.push(new URL(input).searchParams.get("page_index")!);
    return Response.json({
      total: 101,
      jobs: Array.from(
          { length: pages.length === 1 ? 100 : 1 },
          (_, index) => ({ id: `${pages.length}-${index}` }),
        ),
    });
  });
  assert.equal((await listCodeArtsBuildJobsForProject(project)).length, 101);
  assert.deepEqual(pages, ["0", "1"]);
});

test("project failures report project and region while retaining successful partial data", async () => {
  const multi = {
    ...session,
    projects: [
      project,
      {
        ...project,
        projectId: "denied",
        projectName: "eu-west-0_team",
        region: "eu-west-0",
      },
    ],
  };
  await assert.rejects(
    loadAcrossProjects(multi, async (item) => {
      if (item.projectId === "denied") throw Error("403 permission denied");
      return [{ id: "ok" }];
    }),
    (error: unknown) => {
      assert.ok(error instanceof CloudLoadError);
      assert.match(error.message, /eu-west-0_team \(eu-west-0\).*403/);
      assert.deepEqual(error.partialData, [{ id: "ok" }]);
      return true;
    },
  );
  assert.deepEqual(await loadAcrossProjects(session, async () => []), []);
});

test("all failed projects are distinguishable from an empty inventory", async () => {
  await assert.rejects(
    loadAcrossProjects(session, async () => {
      throw Error("401 expired token");
    }),
    /401 expired token/,
  );
});

test("detail loaders preserve object-shaped partial data rather than leaking inventory arrays", async (t) => {
  const multi = {
    ...session,
    projects: [project, { ...project, projectId: "denied" }],
  };
  t.mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("/denied/")
      ? Response.json({ error: { message: "denied" } }, { status: 403 })
      : Response.json({ instances: [{ id: "instance-1", name: "db" }] }),
  );
  await assert.rejects(
    getRdsInstance(multi, "instance-1"),
    (error: unknown) => {
      assert.ok(error instanceof CloudLoadError);
      assert.equal(Array.isArray(error.partialData), false);
      assert.equal((error.partialData as { id: string }).id, "instance-1");
      return true;
    },
  );
});

test("FunctionGraph config/code failures remain visible on detail loads", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input.includes("/code"))
      return Response.json(
        { error: { message: "code denied" } },
        { status: 403 },
      );
    if (input.includes("/config"))
      return Response.json({ func_name: "fn", func_urn: "urn-1" });
    return Response.json({
      functions: [{ func_urn: "urn-1", func_name: "fn" }],
      next_marker: 0,
    });
  });
  await assert.rejects(
    getFunctionGraphFunction(session, "urn-1"),
    /code denied/,
  );
});

test("malformed JSON in a successful HTTP response is not an empty inventory", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON"));
  await assert.rejects(huaweiFetch(project, "ecs", "/test"), SyntaxError);
});

test("regional subprojects retain their names while using their parent region's endpoint", () => {
  assert.equal(projectRegion("sa-brazil-1_team"), "sa-brazil-1");
  assert.equal(projectRegion("eu-west-0"), "eu-west-0");
  assert.equal(
    projectRegion("custom-name", "ap-southeast-3"),
    "ap-southeast-3",
  );
});

test("DeH uses the last dedicated_host_id and VPN follows a timestamp marker", async (t) => {
  const { listDedicatedHostsForProject } =
    await import("@/lib/huawei/services/deh");
  const { listVpnConnectionsForProject } =
    await import("@/lib/huawei/services/vpn");
  for (const kind of ["deh", "vpn"] as const) {
    const cursors: (string | null)[] = [];
    const next = kind === "deh" ? "host-99" : "2026-01-01T00:00:00.000Z";
    t.mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input);
      assert.equal(url.searchParams.has("offset"), false);
      cursors.push(url.searchParams.get("marker"));
      if (kind === "vpn")
        return Response.json({
          vpn_connections: [{ id: `vpn-${cursors.length}` }],
          page_info: { next_marker: cursors.length === 1 ? next : "" },
        });
      return Response.json({
        dedicated_hosts: Array.from(
          { length: cursors.length === 1 ? 100 : 1 },
          (_, i) => ({
            dedicated_host_id: cursors.length === 1 ? `host-${i}` : "last",
          }),
        ),
      });
    });
    const items = await (kind === "deh"
      ? listDedicatedHostsForProject(project)
      : listVpnConnectionsForProject(project));
    assert.equal(items.length, kind === "deh" ? 101 : 2);
    assert.deepEqual(cursors, [null, next]);
    t.mock.restoreAll();
  }
});

test("DLI's unpaginated queue list is loaded once even with more than a hundred items", async (t) => {
  const { listDliQueuesForProject } = await import("@/lib/huawei/services/dli");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.searchParams.has("current-page"), false);
    assert.equal(url.searchParams.get("queue_type"), "all");
    return Response.json({
      queues: Array.from({ length: 101 }, (_, i) => ({
        queue_name: `queue-${i}`,
      })),
    });
  });
  assert.equal((await listDliQueuesForProject(project)).length, 101);
  assert.equal(calls, 1);
});

test("CBH and ModelArts include later pages with their configured limits", async (t) => {
  const { listCbhInstancesForProject } =
    await import("@/lib/huawei/services/cbh");
  const { listModelArtsNotebooksForProject } =
    await import("@/lib/huawei/services/modelarts");
  for (const [loader, field, size] of [
    [listCbhInstancesForProject, "instance", 100],
    [listModelArtsNotebooksForProject, "data", 50],
  ] as const) {
    const offsets: (string | null)[] = [];
    t.mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input);
      assert.equal(url.searchParams.get("limit"), String(size));
      offsets.push(url.searchParams.get("offset"));
      return Response.json({
        total: size + 1,
        [field]: Array.from(
          { length: offsets.length === 1 ? size : 1 },
          (_, i) => field === "instance" ? { server_id: `${offsets.length}-${i}`, name: `Bastion ${offsets.length}-${i}` } : { id: `${offsets.length}-${i}` },
        ),
      });
    });
    assert.equal((await loader(project)).length, size + 1);
    assert.deepEqual(offsets, ["0", String(size)]);
    t.mock.restoreAll();
  }
});

test("IAM session creation resolves subproject regions without changing project names", async (t) => {
  const { createHuaweiIamSession } = await import("@/lib/huawei-iam");
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      if (input.endsWith("/v3/auth/projects"))
        return Response.json({
          projects: [{ id: "subproject", name: "sa-brazil-1_team" }],
        });
      const body = JSON.parse(String(init.body));
      const scoped = body.auth.scope?.project;
      if (!scoped)
        assert.deepEqual(body.auth.scope, { domain: { name: "account" } });
      return Response.json(
        {
          token: {
            expires_at: "2099-01-01T00:00:00Z",
            user: { id: "test-user" },
            ...(scoped
              ? { project: { id: "subproject", name: "sa-brazil-1_team" } }
              : {}),
          },
        },
        {
          headers: {
            "X-Subject-Token": scoped ? "project-token" : "account-token",
          },
        },
      );
    },
  );
  const result = await createHuaweiIamSession({
    accountName: "account",
    username: "user",
    password: "test-password",
    iamEndpoint: "https://iam.example.invalid",
  });
  assert.equal(result.projects[0].projectName, "sa-brazil-1_team");
  assert.equal(result.projects[0].region, "sa-brazil-1");
  assert.equal(result.accountToken, "account-token");
});

test("ECS monitoring retains its object shape when metric discovery partially fails", async (t) => {
  const { getEcsMonitoring } = await import("@/lib/huawei/services/ecs");
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input.includes("cloudservers/detail"))
      return Response.json({ servers: [{ id: "server-1" }] });
    if (input.includes("cloudvolumes"))
      return Response.json({ cloudvolumes: [] });
    if (input.includes("batch-query-metric-data"))
      return Response.json({ metrics: [] });
    if (new URL(input).searchParams.get("namespace") === "AGT.ECS")
      return Response.json(
        { error: { message: "agent metrics denied" } },
        { status: 403 },
      );
    return Response.json({ metrics: [] });
  });
  await assert.rejects(
    getEcsMonitoring(session, "server-1"),
    (error: unknown) => {
      assert.ok(error instanceof CloudLoadError);
      assert.match(error.message, /agent metrics denied/);
      assert.equal(Array.isArray(error.partialData), false);
      assert.ok(
        Array.isArray((error.partialData as { metrics: unknown[] }).metrics),
      );
      return true;
    },
  );
});

 test("ModelArts inventory uses native capacity and rejects malformed project-scoped pages", async t => {
  const { listModelArtsNotebooksForProject } = await import("@/lib/huawei/services/modelarts");
  let response: Record<string, unknown> = { data: [{ id: "notebook-1", volume: { category: "EVS", capacity: 50 } }], total: 1 };
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  assert.equal((await listModelArtsNotebooksForProject(project))[0].storage, "50 GB");
  response = { data: [], total: null }; await assert.rejects(listModelArtsNotebooksForProject(project), /native total/);
  response = { total: 0 }; await assert.rejects(listModelArtsNotebooksForProject(project), /incomplete/);
  response = { data: [{ id: "notebook-1", project_id: "foreign" }], total: 1 }; await assert.rejects(listModelArtsNotebooksForProject(project), /project scope/);
 });
