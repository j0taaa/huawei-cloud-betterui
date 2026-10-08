import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";

const accountName = `review-smoke-${randomUUID()}`;
const projectId = "mock-project";
const projectName = "sa-brazil-1_team";
const requests = [];
let generation = 1;
let failRds = false;
let failCosts = false;
const billingMonth = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
})
  .format(new Date())
  .slice(0, 7);
const swrId = Buffer.from(
  JSON.stringify(["sa-brazil-1", "prod", "team/api"]),
).toString("base64url");
const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://mock.invalid");
  requests.push({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
  });
  let body;
  let status = 200;
  if (url.pathname === "/v3/auth/projects")
    body = { projects: [{ id: projectId, name: projectName }] };
  else if (url.pathname === "/v3/auth/tokens") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    const scoped = !!input.auth.scope?.project;
    if (!scoped)
      assert.deepEqual(input.auth.scope, { domain: { name: accountName } });
    res.setHeader(
      "X-Subject-Token",
      scoped ? "mock-project-token" : "mock-account-token",
    );
    body = {
      token: {
        expires_at: "2099-01-01T00:00:00Z",
        user: { id: "mock-user" },
        ...(scoped ? { project: { id: projectId, name: projectName } } : {}),
      },
    };
  } else if (
    url.pathname.startsWith("/ecs/") &&
    url.pathname.endsWith("/action")
  )
    body = { job_id: "mock-job" };
  else if (url.pathname.startsWith("/ecs/")) {
    const page = Number(url.searchParams.get("offset"));
    body = {
      servers: Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({
        id: page === 1 ? `server-${i}` : "server-100",
        name: `generation-${generation}-${page}-${i}`,
        status: "ACTIVE",
      })),
    };
  } else if (url.pathname.startsWith("/evs/")) body = { cloudvolumes: [] };
  else if (url.pathname.startsWith("/vpc/"))
    body = url.pathname.includes("security-groups")
      ? { security_groups: [], page_info: {} }
      : url.pathname.includes("subnets")
        ? { subnets: [] }
        : { vpcs: [], page_info: {} };
  else if (url.pathname.startsWith("/elb/"))
    body = { loadbalancers: [], page_info: {} };
  else if (url.pathname.startsWith("/cce/")) body = { items: [] };
  else if (url.pathname.startsWith("/rds/")) {
    status = failRds ? 403 : 200;
    body = failRds
      ? { error: { message: "mock permission denied" } }
      : { instances: [] };
  } else if (
    url.pathname === `/as/autoscaling-api/v1/${projectId}/scaling_group`
  ) {
    body = {
      scaling_groups: [
        {
          scaling_group_id: "live-group",
          scaling_group_name: "Live scaling group",
          scaling_group_status: "INSERVICE",
          current_instance_number: 1,
          desire_instance_number: 2,
          scaling_configuration_id: "live-config",
        },
      ],
      total_number: 1,
    };
  } else if (
    url.pathname.includes("/as/") &&
    url.pathname.includes("scaling_group_instance")
  ) {
    body = {
      scaling_group_instances: [
        {
          instance_id: "server-0",
          instance_name: "Live member",
          health_status: "NORMAL",
        },
      ],
      total_number: 1,
    };
  } else if (
    url.pathname.includes("/as/") &&
    url.pathname.includes("scaling_policy")
  ) {
    body = {
      scaling_policies: [
        {
          scaling_policy_id: "live-policy",
          scaling_policy_name: "Live scaling policy",
          scaling_policy_type: "ALARM",
          policy_status: "INSERVICE",
        },
      ],
      total_number: 1,
    };
  } else if (
    url.pathname.includes("/as/") &&
    url.pathname.includes("scaling_configuration")
  ) {
    body = {
      scaling_configuration: {
        scaling_configuration_id: "live-config",
        scaling_configuration_name: "Live configuration",
        instance_config: { flavorRef: "s6.large", imageRef: "live-image" },
      },
    };
  } else if (url.pathname === "/swr/v3/manage/repos") {
    const second = url.searchParams.has("marker");
    body = {
      repos: [
        {
          id: second ? 2 : 1,
          name: second ? "worker" : "team/api",
          namespace_name: "prod",
          description: second ? "Second-page repository" : "Live repository",
        },
      ],
      ...(second ? {} : { nextMarker: 1 }),
    };
  } else if (
    url.pathname === "/swr/v3/manage/namespaces/prod/repos/team%24api/tags"
  ) {
    body = {
      tags: [
        {
          tag: "live-v1",
          digest: "sha256:mock-digest",
          path: "swr.sa-brazil-1.myhuaweicloud.com/prod/team/api:live-v1",
        },
      ],
      has_more: false,
    };
  } else if (url.pathname === "/bss/v2/bills/customer-bills/monthly-sum") {
    assert.equal(req.headers["x-auth-token"], "mock-account-token");
    body = {
      currency: "USD",
      consume_amount: "12.345678",
      coupon_amount: "0.5",
      debt_amount: "0",
      total_count: 1,
      bill_sums: [
        {
          service_type_name: "Live billing service",
          bill_type: 1,
          charging_mode: 3,
          consume_amount: "12.345678",
        },
      ],
    };
  } else if (url.pathname === "/bss/v4/costs/cost-analysed-bills/query") {
    assert.equal(req.headers["x-auth-token"], "mock-account-token");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const query = JSON.parse(raw);
    assert.equal(query.amount_type, "NET_AMOUNT");
    assert.equal(query.time_condition.begin_time, billingMonth);
    status = failCosts ? 403 : 200;
    body = failCosts
      ? { error_msg: "cost permission denied" }
      : {
          currency: "USD",
          total_count: 1,
          cost_data: [
            {
              dimensions: [
                { key: query.groupby[0].key, value: "Live cost group" },
              ],
              amount_by_costs:
                query.cost_type === "AMORTIZED_COST" ? "4.20" : "0.30",
              official_amount_by_costs: "0.50",
            },
          ],
        };
  } else {
    status = 500;
    body = { error: { message: `Unexpected mock path ${url.pathname}` } };
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
});
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const mockPort = mock.address().port;
const mockUrl = `http://127.0.0.1:${mockPort}`;
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const endpoints = await readFile("src/lib/huawei/endpoints.ts", "utf8");
for (const match of endpoints.matchAll(/(\w+): "(HUAWEI_[A-Z_]+_ENDPOINT)"/g))
  env[match[2]] = `${mockUrl}/${match[1]}`;
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const appPort = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(appPort),
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
app.stdout.on("data", (chunk) => (logs += chunk));
app.stderr.on("data", (chunk) => (logs += chunk));
const appUrl = `http://127.0.0.1:${appPort}`;
let cookie = "";
const request = (route, init = {}) =>
  fetch(appUrl + route, {
    ...init,
    headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
const scoped = `${JSON.stringify({ accountName, projectId, projects: [{ projectId, region: "sa-brazil-1" }], region: "sa-brazil-1", userId: "mock-user", username: "mock-user" })}`;
const keys = [
  "cloud-summary",
  "listEcsInstances",
  "ecs-instance-v2:server-0",
  "ecs-monitoring-v3:server-0",
  "listAsGroups",
  "as-group-v1:live-group",
  "listSwrRepositories",
  `swr-repository-v1:${swrId}`,
  `billing-summary-v1:${billingMonth}`,
  `cost-analysis-v1:${billingMonth}:CLOUD_SERVICE_TYPE:ORIGINAL_COST`,
  `cost-analysis-v1:${billingMonth}:CLOUD_SERVICE_TYPE:AMORTIZED_COST`,
];
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await request("/login")).status === 200) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 79) throw Error("Next did not start");
  }
  const login = await request("/api/auth/iam/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountName,
      username: "mock-user",
      password: "mock-password",
      iamEndpoint: mockUrl,
    }),
  });
  assert.equal(login.status, 200, await login.text());
  cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const session = await (await request("/api/auth/session")).json();
  assert.equal(session.region, "sa-brazil-1");
  assert.equal(session.projects[0].projectName, projectName);
  const first = await (await request("/api/cloud/summary")).json();
  assert.equal(first.error, null);
  assert.equal(first.data.ecsInstances, 101);
  assert.equal(first.isCached, false);
  const second = await (await request("/api/cloud/summary")).json();
  assert.equal(second.isCached, true);
  assert.equal(second.updatedAt, first.updatedAt);
  const list = await request("/services/ecs");
  assert.equal(list.status, 200);
  assert.match(await list.text(), /generation-1-2-0/);
  const detail = await request("/services/ecs/server-0");
  assert.equal(detail.status, 200);
  assert.match(await detail.text(), /generation-1-1-0/);
  generation = 2;
  const action = await request("/api/cloud/ecs/server-0/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", projectId }),
  });
  assert.equal(action.status, 200);
  assert.equal((await action.json()).jobId, "mock-job");
  assert.match(
    await (await request("/services/ecs")).text(),
    /generation-2-2-0/,
  );
  assert.match(
    await (await request("/services/ecs/server-0")).text(),
    /generation-2-1-0/,
  );
  const summaryAfterAction = await (await request("/api/cloud/summary")).json();
  assert.equal(summaryAfterAction.isCached, false);
  failRds = true;
  const denied = await request("/services/rds");
  assert.equal(denied.status, 200);
  assert.match(await denied.text(), /mock permission denied/);
  const deniedDetail = await request("/services/rds/missing");
  assert.equal(deniedDetail.status, 200);
  assert.match(await deniedDetail.text(), /Unable to load resource/);
  assert.equal(
    requests
      .filter((req) => req.path.includes("/cloudservers/detail"))
      .every((req) => ["1", "2"].includes(req.query.offset)),
    true,
  );
  assert.equal("accountToken" in session, false);
  assert.equal("token" in session, false);
  const renderedRoutes = [
    ["/services/as", /Live scaling group/],
    ["/services/as/live-group", /Live scaling policy/],
    ["/services/swr", /Second-page repository/],
    [`/services/swr/${swrId}`, /docker pull/],
    [`/services/billing/center?month=${billingMonth}`, /Live billing service/],
    [`/services/cost?month=${billingMonth}`, /Live cost group/],
  ];
  for (const [route, pattern] of renderedRoutes) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.match(html, pattern);
    assert.doesNotMatch(
      html,
      /Some cloud data could not be loaded|Complete data could not be retrieved/,
    );
  }
  const billingCalls = requests.filter((req) =>
    req.path.startsWith("/bss/"),
  ).length;
  assert.match(
    (
      await (
        await request(`/services/billing/center?month=${billingMonth}`)
      ).text()
    ).replace(/<!--[\s\S]*?-->/g, ""),
    /Showing cached data/,
  );
  assert.equal(
    requests.filter((req) => req.path.startsWith("/bss/")).length,
    billingCalls,
  );
  const amortized = await request(
    `/services/cost?month=${billingMonth}&type=AMORTIZED_COST`,
  );
  assert.equal(amortized.status, 200);
  assert.match(await amortized.text(), /4\.20/);
  failCosts = true;
  const deniedCost = await request(
    `/services/cost?month=${billingMonth}&group=REGION_CODE`,
  );
  assert.equal(deniedCost.status, 200);
  const deniedCostHtml = await deniedCost.text();
  assert.match(deniedCostHtml, /cost permission denied/);
  assert.doesNotMatch(deniedCostHtml, /No cost records for this month/);
  assert.match(
    await (await request(`/services/cost?month=${billingMonth}`)).text(),
    /Live cost group/,
  );
  const invalidCost = await request("/services/cost?month=2099-01");
  assert.equal(invalidCost.status, 200);
  assert.match(await invalidCost.text(), /latest 18 months/);
  console.log(
    "PASS: production HTTP login/subproject region, 101-resource pagination, persisted cache hit, ECS action invalidation of list/detail/summary, cloud error views, live SWR/AS/Billing/Cost pages, account authentication, cost-query cache isolation, and permission failures. All cloud requests used local mocks.",
  );
} catch (error) {
  console.error(error);
  console.error(logs);
  process.exitCode = 1;
} finally {
  if (cookie)
    await request("/api/auth/logout", { method: "POST" }).catch(() => {});
  if (app.exitCode === null && app.signalCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve));
    app.kill("SIGTERM");
    await exited;
  }
  await new Promise((resolve) => mock.close(resolve));
  for (const key of keys) {
    const digest = createHash("sha256")
      .update(`${key}:${scoped}`)
      .digest("hex");
    await unlink(
      path.join(".next", "cache", "huawei-cloud-data", `${digest}.json`),
    ).catch(() => {});
  }
}
