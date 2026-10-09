import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCloudCache } from "@/lib/huawei/cache-store";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { CloudLoadError } from "@/lib/huawei/errors";
import { serviceEndpoint } from "@/lib/huawei/endpoints";
import {
  getAsGroup,
  listAsGroupsForProject,
  listAsInstancesForProject,
  listAsPoliciesForProject,
} from "@/lib/huawei/services/as";
import {
  getSwrRepository,
  listSwrRepositories,
  listSwrRepositoriesForProject,
  listSwrTagsForProject,
} from "@/lib/huawei/services/swr";
import {
  emptyCostReport,
  getBillingSummary,
  getCostReport,
} from "@/lib/huawei/services/billing";
import {
  currentBillingMonth,
  readCostQuery,
  validateBillingMonth,
} from "@/lib/billing-query";
import { decimalAmount, formatMoney, sumAmounts } from "@/lib/billing-format";
import { project, session } from "./fixtures/session";

const month = currentBillingMonth();

test("SWR follows numeric repository markers and keeps names and numeric IDs", async (t) => {
  const markers: (string | null)[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    assert.equal(url.pathname, "/v3/manage/repos");
    markers.push(url.searchParams.get("marker"));
    return Response.json({
      repos: [
        {
          id: markers.length,
          name: `team/image-${markers.length}`,
          namespace_name: "prod",
          is_public: false,
        },
      ],
      ...(markers.length === 1 ? { nextMarker: 17 } : {}),
    });
  });
  const repositories = await listSwrRepositoriesForProject(project);
  assert.equal(repositories.length, 2);
  assert.equal(repositories[0].repositoryId, "1");
  assert.equal(repositories[0].name, "team/image-1");
  assert.deepEqual(
    JSON.parse(Buffer.from(repositories[0].id, "base64url").toString()),
    [project.region, "prod", "team/image-1"],
  );
  assert.deepEqual(markers, [null, "17"]);
});

test("SWR queries once per region and keeps repositories with identical IDs in different regions", async (t) => {
  const hosts: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    hosts.push(new URL(input).hostname);
    return Response.json({
      repos: [{ id: 1, name: "api", namespace_name: "prod" }],
    });
  });
  const repositories = await listSwrRepositories({
    ...session,
    projects: [
      project,
      { ...project, projectId: "subproject-2" },
      { ...project, projectId: "eu-project", region: "eu-west-0" },
    ],
  });
  assert.equal(repositories.length, 2);
  assert.equal(
    new Set(repositories.map((repository) => repository.id)).size,
    2,
  );
  assert.deepEqual(hosts, [
    "swr.sa-brazil-1.myhuaweicloud.com",
    "swr.eu-west-0.myhuaweicloud.com",
  ]);
});

test("SWR tags encode nested names with dollars and obey has_more on the final page", async (t) => {
  const markers: (string | null)[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    assert.equal(
      decodeURIComponent(url.pathname),
      "/v3/manage/namespaces/prod/repos/team$api/tags",
    );
    markers.push(url.searchParams.get("marker"));
    return Response.json({
      tags: [
        {
          tag: `v${markers.length}`,
          digest: "sha256:abc",
          path: "swr.example/prod/team/api:v1",
          size: 123,
        },
      ],
      has_more: markers.length === 1,
      nextMarker: "a+/b%",
    });
  });
  const tags = await listSwrTagsForProject(project, "prod", "team/api");
  assert.equal(tags.length, 2);
  assert.equal(tags[0].pullPath, "swr.example/prod/team/api:v1");
  assert.deepEqual(markers, [null, "a+/b%"]);
});

test("SWR rejects an incomplete tag page and preserves the repository on permission errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ tags: [{ tag: "v1" }], has_more: true }),
  );
  await assert.rejects(
    listSwrTagsForProject(project, "prod", "api"),
    /more results without a usable/,
  );
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async (input: string) =>
    new URL(input).pathname.endsWith("/tags")
      ? Response.json({ error_msg: "tag permission denied" }, { status: 403 })
      : Response.json({
          repos: [{ id: 1, name: "api", namespace_name: "prod" }],
        }),
  );
  const id = Buffer.from(
    JSON.stringify([project.region, "prod", "api"]),
  ).toString("base64url");
  await assert.rejects(getSwrRepository(session, id), (error: unknown) => {
    assert.ok(error instanceof CloudLoadError);
    assert.match(error.message, /Image tags: 403.*permission denied/);
    assert.equal(error.partialData.repository.name, "api");
    assert.deepEqual(error.partialData.tags, []);
    return true;
  });
});

test("all AS list contracts use row offsets, including short pages with totals", async (t) => {
  for (const [field, loader] of [
    ["scaling_groups", () => listAsGroupsForProject(project)],
    [
      "scaling_group_instances",
      () => listAsInstancesForProject(project, "group-1"),
    ],
    ["scaling_policies", () => listAsPoliciesForProject(project, "group-1")],
  ] as const) {
    const offsets: string[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string, init: RequestInit) => {
        const url = new URL(input);
        assert.ok(
          url.pathname.startsWith(`/autoscaling-api/v1/${project.projectId}/`),
        );
        assert.equal(
          new Headers(init.headers).get("X-Auth-Token"),
          project.token,
        );
        offsets.push(url.searchParams.get("start_number")!);
        return Response.json({
          [field]: [
            {
              scaling_group_id: `group-${offsets.length}`,
              instance_id: `instance-${offsets.length}`,
              scaling_policy_id: `policy-${offsets.length}`,
            },
          ],
          total_number: 2,
        });
      },
    );
    assert.equal((await loader()).length, 2);
    assert.deepEqual(offsets, ["0", "1"]);
    t.mock.restoreAll();
  }
});

test("AS details use the group's project and whitelist configuration fields", async (t) => {
  const other = {
    ...project,
    projectId: "project-2",
    region: "eu-west-0",
    token: "other-token",
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/scaling_group"))
        return Response.json({
          scaling_groups: url.hostname.includes("eu-west-0")
            ? [
                {
                  scaling_group_id: "g",
                  scaling_configuration_id: "config",
                  desire_instance_number: 2,
                },
              ]
            : [],
          total_number: url.hostname.includes("eu-west-0") ? 1 : 0,
        });
      assert.equal(
        new Headers(init.headers).get("X-Auth-Token"),
        "other-token",
      );
      assert.ok(url.pathname.includes("project-2"));
      if (url.pathname.includes("scaling_group_instance"))
        return Response.json({
          scaling_group_instances: [
            { instance_id: "server", protect_from_scaling_down: true },
          ],
          total_number: 1,
        });
      if (url.pathname.includes("scaling_policy"))
        return Response.json({
          scaling_policies: [
            {
              scaling_policy_id: "policy",
              scaling_policy_action: { operation: "SET", instance_number: 0 },
              scheduled_policy: {
                launch_time: "02:00",
                recurrence_type: "Daily",
              },
            },
          ],
          total_number: 1,
        });
      return Response.json({
        scaling_configuration: {
          scaling_configuration_id: "config",
          instance_config: {
            flavorRef: "s6.large",
            imageRef: "image",
            adminPass: "secret-password",
            user_data: "secret-user-data",
            personality: [{ content: "secret-file" }],
            disk: [{ disk_type: "SYS", volume_type: "SSD", size: 40 }],
          },
        },
      });
    },
  );
  const detail = await getAsGroup(
    { ...session, projects: [project, other] },
    "g",
  );
  assert.equal(detail?.group.desired, 2);
  assert.equal(detail?.instances[0].protected, true);
  assert.equal(detail?.policies[0].instanceNumber, 0);
  assert.equal(detail?.configuration?.flavor, "s6.large");
  assert.doesNotMatch(JSON.stringify(detail), /secret/);
});

test("AS policy failure remains an error with usable group and member details", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const path = new URL(input).pathname;
    if (path.endsWith("/scaling_group"))
      return Response.json({
        scaling_groups: [{ scaling_group_id: "g" }],
        total_number: 1,
      });
    if (path.includes("scaling_policy"))
      return Response.json(
        { error_msg: "policy permission denied" },
        { status: 403 },
      );
    return Response.json({
      scaling_group_instances: [{ instance_id: "server" }],
      total_number: 1,
    });
  });
  await assert.rejects(getAsGroup(session, "g"), (error: unknown) => {
    assert.ok(error instanceof CloudLoadError);
    assert.match(error.message, /Scaling policies: 403/);
    assert.equal(error.partialData.group.id, "g");
    assert.equal(error.partialData.instances.length, 1);
    assert.deepEqual(error.partialData.policies, []);
    return true;
  });
});

test("billing is account-wide, uses the account token, pages bills, and retains API totals and refunds", async (t) => {
  const offsets: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.hostname, "bss-intl.myhuaweicloud.com");
      assert.equal(url.searchParams.get("bill_cycle"), month);
      assert.equal(url.searchParams.get("method"), "oneself");
      assert.equal(
        new Headers(init.headers).get("X-Auth-Token"),
        "account-token",
      );
      offsets.push(url.searchParams.get("offset")!);
      return Response.json({
        currency: "USD",
        total_count: 2,
        consume_amount: "12.345678",
        debt_amount: "1.2",
        coupon_amount: "0",
        bill_sums: [
          {
            service_type_code: "hws.service.type.ecs",
            bill_type: offsets.length === 1 ? 1 : 2,
            consume_amount: offsets.length === 1 ? "20" : "-7.654322",
            charging_mode: 3,
          },
        ],
      });
    },
  );
  const summary = await getBillingSummary(
    {
      ...session,
      accountToken: "account-token",
      projects: [project, { ...project, projectId: "second" }],
    },
    month,
  );
  assert.deepEqual(offsets, ["0", "1"]);
  assert.equal(summary.amount, "12.345678");
  assert.equal(summary.rows[1].kind, "Refund");
  assert.equal(summary.rows[1].amount, "-7.654322");
  assert.equal(summary.rows[0].chargingMode, "Pay-per-use");
});

test("cost pagination preserves POST query and sums decimal amounts exactly", async (t) => {
  const offsets: number[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      assert.equal(
        new URL(input).pathname,
        "/v4/costs/cost-analysed-bills/query",
      );
      assert.equal(init.method, "POST");
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.time_condition, {
        time_measure_id: 2,
        begin_time: month,
        end_time: month,
      });
      assert.deepEqual(body.groupby, [
        { type: "dimension", key: "ENTERPRISE_PROJECT_ID" },
      ]);
      assert.equal(body.cost_type, "AMORTIZED_COST");
      assert.equal(body.amount_type, "NET_AMOUNT");
      assert.equal(new Headers(init.headers).get("X-Language"), "en_US");
      offsets.push(body.offset);
      return Response.json({
        currency: "USD",
        total_count: 2,
        cost_data: [
          {
            dimensions: [
              {
                key: "ENTERPRISE_PROJECT_ID",
                value: `project-${offsets.length}`,
              },
            ],
            amount_by_costs: offsets.length === 1 ? "0.1" : "0.2",
            official_amount_by_costs: "0.5",
          },
        ],
      });
    },
  );
  const report = await getCostReport({ ...session, accountToken: "account-token" }, {
    month,
    group: "ENTERPRISE_PROJECT_ID",
    type: "AMORTIZED_COST",
  });
  assert.deepEqual(offsets, [0, 1]);
  assert.equal(report.amount, "0.3");
  assert.equal(report.rows[1].dimension, "project-2");
});

test("billing and costs distinguish successful empty data from failures and missing amounts", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      currency: "USD",
      bill_sums: [],
      cost_data: [],
      total_count: 0,
    }),
  );
  assert.equal((await getBillingSummary({ ...session, accountToken: "account-token" }, month)).amount, null);
  assert.equal(
    (
      await getCostReport({ ...session, accountToken: "account-token" }, {
        month,
        group: "REGION_CODE",
        type: "ORIGINAL_COST",
      })
    ).amount,
    "0",
  );
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error_msg: "billing permission denied" }, { status: 403 }),
  );
  await assert.rejects(
    getBillingSummary({ ...session, accountToken: "account-token" }, month),
    /403.*permission denied/,
  );
  await assert.rejects(
    getCostReport({ ...session, accountToken: "account-token" }, {
      month,
      group: "REGION_CODE",
      type: "ORIGINAL_COST",
    }),
    /403.*permission denied/,
  );
});

test("billing month validation uses Huawei's timezone and rejects unsupported queries before HTTP", async (t) => {
  assert.equal(
    currentBillingMonth(new Date("2026-09-30T17:00:00Z")),
    "2026-10",
  );
  assert.equal(
    validateBillingMonth("2025-05", 18, new Date("2026-10-08")),
    "2025-05",
  );
  assert.throws(
    () => validateBillingMonth("2025-04", 18, new Date("2026-10-08")),
    /latest 18 months/,
  );
  assert.throws(() => validateBillingMonth("2026-13"), /YYYY-MM/);
  assert.throws(
    () => readCostQuery({ month, group: "not-supported" }),
    /supported cost grouping/,
  );
  assert.throws(
    () => readCostQuery({ month, type: "not-supported" }),
    /original or amortized/,
  );
  const mock = t.mock.method(globalThis, "fetch", async () => {
    throw Error("should not request");
  });
  await assert.rejects(
    getBillingSummary({ ...session, accountToken: "account-token" }, "2099-01"),
    /latest 36 months/,
  );
  await assert.rejects(
    getCostReport({ ...session, accountToken: "account-token" }, {
      month: "invalid",
      group: "REGION_CODE",
      type: "ORIGINAL_COST",
    }),
    /YYYY-MM/,
  );
  assert.equal(mock.mock.callCount(), 0);
});

test("monetary formatting preserves large decimals, negative adjustments, and unknown values", () => {
  assert.equal(
    sumAmounts(["99999999999999999.99", "0.01", "-0.10"]),
    "99999999999999999.9",
  );
  assert.equal(sumAmounts(["0.1", "-0.4"]), "-0.3");
  assert.match(
    formatMoney("99999999999999999.99", "USD"),
    /99,999,999,999,999,999.99/,
  );
  assert.equal(formatMoney(null, "USD"), "—");
  assert.equal(decimalAmount(undefined), null);
  assert.equal(decimalAmount(0.0000001), "0.0000001");
  assert.equal(decimalAmount(-0.00000012), "-0.00000012");
  assert.equal(decimalAmount(1e21), "1000000000000000000000");
  assert.throws(() => decimalAmount("invalid"), /Invalid monetary/);
});

test("new service cache keys separate months, cost types, and groupings; billing endpoint stays global", () => {
  assert.notEqual(
    cloudCacheKeys.billing("2026-09"),
    cloudCacheKeys.billing("2026-10"),
  );
  const original = cloudCacheKeys.costs(
    month,
    "CLOUD_SERVICE_TYPE",
    "ORIGINAL_COST",
  );
  assert.notEqual(
    original,
    cloudCacheKeys.costs(month, "REGION_CODE", "ORIGINAL_COST"),
  );
  assert.notEqual(
    original,
    cloudCacheKeys.costs(month, "CLOUD_SERVICE_TYPE", "AMORTIZED_COST"),
  );
  assert.equal(
    serviceEndpoint("bss", "sa-brazil-1"),
    serviceEndpoint("bss", "eu-west-0"),
  );
});

test("a failed later cost page preserves the successful cached report and other cost queries", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "huawei-cost-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = Date.now();
  let failSecondPage = false;
  const cache = createCloudCache({ directory, now: () => time });
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: string, init: RequestInit) => {
      const query = JSON.parse(String(init.body));
      if (failSecondPage && query.offset === 1)
        return Response.json(
          { error_msg: "later cost page denied" },
          { status: 403 },
        );
      return Response.json({
        currency: "USD",
        total_count: 2,
        cost_data: [
          {
            dimensions: [
              { key: "CLOUD_SERVICE_TYPE", value: `service-${query.offset}` },
            ],
            amount_by_costs:
              query.cost_type === "AMORTIZED_COST" ? "2.1" : "0.1",
          },
        ],
      });
    },
  );
  const originalKey = cloudCacheKeys.costs(
    month,
    "CLOUD_SERVICE_TYPE",
    "ORIGINAL_COST",
  );
  const amortizedKey = cloudCacheKeys.costs(
    month,
    "CLOUD_SERVICE_TYPE",
    "AMORTIZED_COST",
  );
  const loadOriginal = () =>
    getCostReport({ ...session, accountToken: "account-token" }, {
      month,
      group: "CLOUD_SERVICE_TYPE",
      type: "ORIGINAL_COST",
    });
  const loadAmortized = () =>
    getCostReport({ ...session, accountToken: "account-token" }, {
      month,
      group: "CLOUD_SERVICE_TYPE",
      type: "AMORTIZED_COST",
    });
  const original = await cache.get(originalKey, emptyCostReport, loadOriginal);
  await cache.get(amortizedKey, emptyCostReport, loadAmortized);
  assert.equal(original.data.amount, "0.2");
  time += 16000;
  failSecondPage = true;
  await assert.rejects(
    cache.refresh(originalKey, loadOriginal),
    /403.*permission denied/,
  );
  const stale = await cache.get(originalKey, emptyCostReport, loadOriginal);
  assert.equal(stale.data.amount, "0.2");
  assert.equal(stale.updatedAt, original.updatedAt);
  assert.equal(stale.isCached, true);
  assert.match(stale.error!, /403.*permission denied/);
  // A restarted process reads the unchanged successful disk records.
  const restarted = createCloudCache({
    directory,
    now: () => Date.parse(original.updatedAt),
  });
  assert.equal(
    (await restarted.get(originalKey, emptyCostReport, loadOriginal)).data
      .amount,
    "0.2",
  );
  assert.equal(
    (await restarted.get(amortizedKey, emptyCostReport, loadAmortized)).data
      .amount,
    "4.2",
  );
});
