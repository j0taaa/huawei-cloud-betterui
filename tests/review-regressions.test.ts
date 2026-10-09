import assert from "node:assert/strict";
import { test } from "node:test";
import { CloudLoadError } from "@/lib/huawei/errors";
import {
  createRefreshableSession,
  getSessionById,
  deleteSession,
} from "@/lib/auth-session";
import { getRdsInstanceDetails } from "@/lib/huawei/services/rds";
import { getDdsInstanceDetails } from "@/lib/huawei/services/dds";
import { getDcsRedisDetails } from "@/lib/huawei/services/dcs";
import { getGaussDbDetails } from "@/lib/huawei/services/gaussdb";
import { getGeminiDbDetails } from "@/lib/huawei/services/geminidb";
import { getTaurusDbInstanceDetails } from "@/lib/huawei/services/taurusdb";
import { listCbrVaultsForProject } from "@/lib/huawei/services/cbr";
import {
  getFunctionGraphFunction,
  listFunctionGraphTriggerInventory,
  listFunctionGraphDependenciesForProject,
  getFunctionGraphMonitoring,
} from "@/lib/huawei/services/functiongraph";
import { project, session } from "./fixtures/session";

const urn = "urn:fss:sa-brazil-1:project-1:function:default:fn-1:latest";
const functionList = {
  functions: [{ func_name: "fn-1", func_urn: urn, runtime: "Python3.9" }],
};

test("session refresh replaces account and regional tokens together", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init?: RequestInit) => {
      if (input.endsWith("/v3/auth/projects"))
        return Response.json({
          projects: [{ id: project.projectId, name: "sa-brazil-1" }],
        });
      const account = !!JSON.parse(String(init?.body)).auth.scope.domain;
      return Response.json(
        {
          token: {
            expires_at: "2099-01-01T00:00:00Z",
            user: { id: "user-1" },
            ...(account
              ? {}
              : { project: { id: project.projectId, name: "sa-brazil-1" } }),
          },
        },
        {
          headers: {
            "x-subject-token": account ? "fresh-account" : "fresh-project",
          },
        },
      );
    },
  );
  const id = createRefreshableSession(
    {
      ...session,
      accountToken: "old-account",
      tokenExpiresAt: "2020-01-01T00:00:00Z",
    },
    { accountName: "test", username: "test", password: "mock-password" },
  );
  try {
    const fresh = await getSessionById(id);
    assert.equal(fresh?.accountToken, "fresh-account");
    assert.equal(fresh?.token, "fresh-project");
  } finally {
    deleteSession(id);
  }
});

for (const [service, loader] of Object.entries({
  rds: getRdsInstanceDetails,
  dds: getDdsInstanceDetails,
  dcs: getDcsRedisDetails,
  gaussdb: getGaussDbDetails,
  geminidb: getGeminiDbDetails,
  taurusdb: getTaurusDbInstanceDetails,
})) {
  test(`${service} supplementary failures preserve the instance and prevent caching incomplete details`, async (t) => {
    t.mock.method(globalThis, "fetch", async (input: string) => {
      if (/backups|components/.test(input))
        return Response.json(
          { error_msg: "backup permission denied" },
          { status: 403 },
        );
      if (service === "dcs")
        return Response.json({ id: "db-1", name: "database" });
      return Response.json({
        instances: [{ id: "db-1", name: "database" }],
        instance: { id: "db-1", name: "database" },
      });
    });
    await assert.rejects(loader(session, "db-1"), (error: unknown) => {
      assert.ok(error instanceof CloudLoadError);
      assert.match(error.message, /403/);
      const data = error.partialData as {
        instance: { id: string };
        backups: unknown[];
      };
      assert.equal(data.instance.id, "db-1");
      assert.deepEqual(data.backups, []);
      return true;
    });
  });
}

test("CBR backup failure retains vault inventory with an error", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("/backups")
      ? Response.json({ error_msg: "backup denied" }, { status: 403 })
      : Response.json({ vaults: [{ id: "vault-1", name: "vault" }] }),
  );
  await assert.rejects(listCbrVaultsForProject(project), (error: unknown) => {
    assert.ok(error instanceof CloudLoadError);
    assert.equal((error.partialData as { id: string }[])[0].id, "vault-1");
    return true;
  });
});

test("FunctionGraph config failure retains a usable function through project aggregation", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("/config")
      ? Response.json({ error_msg: "config denied" }, { status: 403 })
      : input.includes("/code")
        ? Response.json({ code_text: "source" })
        : Response.json(functionList),
  );
  await assert.rejects(
    getFunctionGraphFunction(session, urn),
    (error: unknown) => {
      assert.ok(error instanceof CloudLoadError);
      assert.equal((error.partialData as { name: string }).name, "fn-1");
      return true;
    },
  );
});

test("FunctionGraph trigger failure cannot become a successful empty inventory", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("/triggers/")
      ? Response.json({ error_msg: "trigger denied" }, { status: 403 })
      : Response.json(functionList),
  );
  await assert.rejects(
    listFunctionGraphTriggerInventory(session),
    CloudLoadError,
  );
});

test("FunctionGraph dependencies follow more than ten pages and reject a repeated marker", async (t) => {
  let page = 0;
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (input: string) => {
      const query = new URL(input).searchParams;
      assert.equal(query.get("dependency_type"), "all");
      assert.equal(query.get("limit"), "500");
      page++;
      return Response.json({
        dependencies: [{ id: `dep-${page}`, name: `dep-${page}` }],
        ...(page < 11 ? { next_marker: `marker-${page}` } : {}),
      });
    },
  );
  assert.equal(
    (await listFunctionGraphDependenciesForProject(project)).length,
    11,
  );
  fetchMock.mock.mockImplementation(async () =>
    Response.json({
      dependencies: [{ id: `dep-${++page}` }],
      next_marker: "repeated",
    }),
  );
  await assert.rejects(
    listFunctionGraphDependenciesForProject(project),
    /repeated.*cursor/,
  );
});

test("minimum FunctionGraph duration uses observed samples rather than an artificial zero", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init?: RequestInit) => {
      if (input.includes("batch-query-metric-data"))
        return Response.json({
          metrics: JSON.parse(String(init?.body)).metrics.map((m: object) => ({
            ...m,
            datapoints: [
              { timestamp: 1780000000000, min: 25 },
              { timestamp: 1780000010000, min: 50 },
            ],
          })),
        });
      if (input.includes("/metrics")) return Response.json({ metrics: [] });
      if (/config|code/.test(input)) return Response.json({});
      if (input.includes("res-fee-records"))
        return Response.json({ currency: "USD", fee_records: [] });
      return Response.json(functionList);
    },
  );
  const data = await getFunctionGraphMonitoring(session, urn);
  assert.equal(
    data?.metrics.find((m) => m.metricName === "minDuration")?.total,
    25,
  );
});
