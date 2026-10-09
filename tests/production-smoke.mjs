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
let showRdsDetails = false;
let failRdsBackups = false;
let failAom = true;
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
  else if (url.pathname === "/v3/auth/tokens" && req.method === "GET") {
    assert.equal(req.headers["x-auth-token"], "mock-account-token");
    body = { token: { domain: { id: "mock-domain" }, user: { id: "mock-user", domain: { id: "mock-domain" } } } };
  } else if (url.pathname === "/sms/v3/tasks") body = { tasks: [], count: 0 };
  else if (url.pathname === "/sms/v3/sources") body = { source_servers: [], count: 0 };
  else if (url.pathname.startsWith("/dws/")) body = url.pathname.endsWith("/node-types") ? { node_types: [] } : url.pathname.endsWith("/availability-zones") ? { availability_zones: [] } : { clusters: [] };
  else if (url.pathname === "/v3/users") body = { users: [{ id: "mock-user", name: "mock-user", domain_id: "mock-domain", enabled: true }], links: { next: null } };
  else if (url.pathname === "/v3/groups") body = { groups: [], links: { next: null } };
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
  else if (url.pathname.startsWith("/ecs/") && (url.pathname.endsWith("/flavors") || url.pathname.endsWith("/flavors/detail"))) body = { flavors: [{ id: "flavor-1", name: "General purpose", vcpus: 2, ram: 4096 }] };
  else if (url.pathname.startsWith("/ecs/") && url.pathname.endsWith("os-availability-zone")) body = { availabilityZoneInfo: [{ zoneName: "az-1", zoneState: { available: true } }] };
  else if (url.pathname.startsWith("/ecs/") && url.pathname.endsWith("os-keypairs")) body = { keypairs: [{ keypair: { name: "key-1" } }] };
  else if (url.pathname.startsWith("/servicestage/")) body = { applications: [], environments: [], components: [], runtime_stacks: [], resources: [], records: [], count: 0, total: 0 };
  else if (url.pathname.startsWith("/asm/")) body = { items: [] };
  else if (url.pathname.startsWith("/cph/")) body = { servers: [], phones: [], phone_models: [], models: [], phone_images: [], count: 0, page_info: { next_marker: "" } };
  else if (url.pathname.startsWith("/bms/")) body = url.pathname.endsWith("/flavors") ? { flavors: [] } : { servers: [], count: 0 };
  else if (url.pathname.startsWith("/deh/")) body = url.pathname.endsWith("dedicated-host-types") ? { dedicated_host_types: [{ host_type: "c6", host_type_name: "General purpose" }] } : { dedicated_hosts: [] };
  else if (url.pathname.startsWith("/nat/")) body = url.pathname.endsWith("nat_gateway_specs") ? { specs: ["1"] } : { nat_gateways: [], snat_rules: [], dnat_rules: [] };
  else if (url.pathname.startsWith("/ecs/")) {
    const page = Number(url.searchParams.get("offset"));
    body = {
      servers: Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({
        id: page === 1 ? `server-${i}` : "server-100",
        name: `generation-${generation}-${page}-${i}`,
        status: "ACTIVE",
      })),
    };
  } else if (url.pathname.startsWith("/evs/")) body = url.pathname.endsWith("types") ? { volume_types: [{ name: "SSD", is_public: true }] } : url.pathname.endsWith("os-availability-zone") ? { availabilityZoneInfo: [{ zoneName: "az-1", zoneState: { available: true } }] } : { cloudvolumes: [], cloudsnapshots: [] };
  else if (
    url.pathname.startsWith("/rabbitmq/") ||
    url.pathname.startsWith("/rocketmq/")
  ) {
    const engine = url.pathname.startsWith("/rabbitmq/")
      ? "rabbitmq"
      : "rocketmq";
    const instance = {
      instance_id: `${engine}-1`,
      name: `Live ${engine} broker`,
      status: "RUNNING",
      engine_version: "5.0",
      broker_num: 3,
      storage_space: 100,
      used_storage_space: 0,
      connect_address: "10.0.0.10",
      namesrv_address: "10.0.0.20:9876",
      grpc_address: "10.0.0.20:8081",
      vpc_id: "vpc-1",
      ssl_enable: true,
    };
    if (url.pathname.endsWith("/products")) {
      body = { products: [], versions: ["5.0"] };
    } else if (url.pathname.endsWith("/available-zones")) {
      body = { available_zones: [] };
    } else if (url.pathname.endsWith("/denied")) {
      status = 403;
      body = { error_msg: "broker permission denied" };
    } else if (url.pathname.endsWith("/instances")) {
      assert.equal(url.searchParams.get("engine"), engine);
      assert.equal(req.headers["x-auth-token"], "mock-project-token");
      body = { instances: [instance], instance_num: 1 };
    } else body = instance;
  } else if (url.pathname.startsWith("/aom/")) {
    if (req.method !== "GET") {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const mutation = raw ? JSON.parse(raw) : {};
      requests.at(-1).body = mutation;
      if (req.method === "POST") { assert.equal(req.headers.region, "sa-brazil-1"); assert.equal(mutation.project_id, projectId); }
      else assert.equal(req.headers["enterprise-project-id"], "0");
      body = { prometheus: [{ prom_id: "created-prom" }] };
    } else {
      assert.equal(req.headers["enterprise-project-id"], "all_granted_eps");
    status = failAom ? 403 : 200;
    body = failAom
      ? { error_msg: "AOM permission denied" }
      : {
          prometheus: [
            {
              prom_id: "prom-1",
              prom_name: "Live Prometheus",
              prom_type: "CCE",
              prom_status: "NORMAL",
              prom_limits: { compactor_blocks_retention_period: "30" },
            },
          ],
        };
    }
  } else if (url.pathname.startsWith("/eps/")) {
    assert.equal(req.headers["x-auth-token"], "mock-account-token");
    body = {
      enterprise_projects: [
        { id: "0", name: "Live enterprise project", status: 1, type: "prod" },
      ],
      total_count: 1,
    };
  } else if (url.pathname.startsWith("/vpc/"))
    body = url.pathname.endsWith("/ports") ? { ports: [] } : url.pathname.includes("security-groups")
      ? { security_groups: [], page_info: {} }
      : url.pathname.includes("subnets")
        ? { subnets: [] }
        : { vpcs: [], page_info: {} };
  else if (url.pathname.startsWith("/elb/"))
    body = url.pathname.endsWith("/flavors") ? { flavors: [], page_info: {} } : url.pathname.endsWith("/availability-zones") ? { availability_zones: [] } : { loadbalancers: [], page_info: {} };
  else if (url.pathname.startsWith("/obs/")) body = `<ListAllMyBucketsResult><Buckets><Bucket><Name>live-bucket</Name><Location>sa-brazil-1</Location></Bucket></Buckets></ListAllMyBucketsResult>`;
  else if (url.pathname.startsWith("/eip/")) body = { publicips: [] };
  else if (url.pathname.startsWith("/cbr/")) body = { vaults: [], backups: [], policies: [], count: 0 };
  else if (url.pathname.startsWith("/sfs/")) body = { shares: [] };
  else if (url.pathname === "/swr/v2/manage/namespaces") body = { namespaces: [{ name: "prod" }] };
  else if (url.pathname.endsWith("/OS-CREDENTIAL/securitytokens")) body = { credential: { access: "test-access", secret: "test-secret", securitytoken: "test-token" } };
  else if (url.pathname.startsWith("/dns/")) body = { zones: [], metadata: { total_count: 0 } };
  else if (url.pathname.startsWith("/smn/")) body = { topics: [], total_count: 0 };
  else if (url.pathname.startsWith("/lts/")) body = { log_groups: [] };
  else if (url.pathname.startsWith("/dew/")) body = { key_details: [] };
  else if (url.pathname.startsWith("/ces/")) body = url.pathname.endsWith("metrics") ? { metrics: [] } : { alarms: [], count: 0 };
  else if (url.pathname.startsWith("/cts/")) body = { trackers: [] };
  else if (url.pathname.startsWith("/cdn/")) body = { domains: [], total: 0 };
  else if (url.pathname.startsWith("/ims/")) body = { images: url.searchParams.get("__imagetype") === "shared" ? [] : [{ id: "image-1", name: "System image", status: "active", __imagetype: "private", owner: projectId, __description: "Image description", protected: false }] };
  else if (url.pathname.startsWith("/dcs/")) body = url.pathname.endsWith("/flavors") ? { flavors: [{ engine: "Redis", engine_version: "4.0", spec_code: "redis.ha.large.4", capacity: [32], billing_mode: ["hourly"], flavors_available_zones: [{ capacity: "32", az_codes: ["az-1"] }] }] } : url.pathname.endsWith("/available-zones") ? { available_zones: [{ code: "az-1", name: "Zone 1", resource_availability: "true" }] } : { instances: [], instance_num: 0 };
  else if (url.pathname.startsWith("/dms/")) body = url.pathname.endsWith("/products") ? { products: [{ product_id: "kafka.cluster.s1", charging_mode: ["hourly"], properties: { engine_versions: "2.7", min_broker: 3, max_broker: 30 }, ios: [{ io_spec: "dms.storage.high", available_zones: ["az-1"] }] }] } : url.pathname.endsWith("/available-zones") ? { available_zones: [{ id: "az-1", name: "Zone 1", resource_availability: "true" }] } : { instances: [], total_count: 0 };
  else if (url.pathname.startsWith("/iotda/")) body = url.pathname.endsWith("/apps") ? { applications: [{ app_id: "app-1", app_name: "Devices" }] } : url.pathname.endsWith("/products") ? { products: [{ app_id: "app-1", product_id: "product-1", name: "Sensors", protocol_type: "MQTT" }] } : { devices: [] };
  else if (url.pathname.startsWith("/dli/")) body = { is_success: true, queues: [], count: 0 };
  else if (url.pathname.startsWith("/secmaster/")) body = { workspaces: [], total_count: 0 };
  else if (url.pathname.startsWith("/er/")) body = url.pathname.endsWith("/availability-zones") ? { availability_zones: [{ code: "az-1", state: "available" }] } : { instances: [], page_info: {} };
  else if (url.pathname.startsWith("/vpcep/")) body = { endpoint_services: [], endpoints: [], total_count: 0 };
  else if (url.pathname.startsWith("/eg/")) body = { items: [], total: 0 };
  else if (url.pathname.startsWith("/oms/")) body = { tasks: [], count: 0 };
  else if (url.pathname.startsWith("/dds/")) body = url.pathname.endsWith("/versions") ? { versions: ["4.0"] } : url.pathname.endsWith("/flavors") ? { flavors: [{ type: "replica", vcpus: "2", ram: "4", spec_code: "dds.replica", az_status: { "az-1": "normal" }, engine_versions: ["4.0"] }] } : url.pathname.endsWith("/storage-type") ? { storage_type: [{ name: "ULTRAHIGH", az_status: { "az-1": "normal" } }] } : { instances: [], total_count: 0 };
  else if (url.pathname.startsWith("/apig/")) body = url.pathname.endsWith("/available-zones") ? { available_zones: [{ id: "az-1", name: "Zone 1", specs: { BASIC: true, PROFESSIONAL: true } }] } : { instances: [], total: 0 };
  else if (url.pathname.startsWith("/projectman/")) body = { projects: [{ project_id: "a".repeat(32), project_name: "CodeArts workspace" }], total: 1 };
  else if (url.pathname.startsWith("/codeartsrepo/")) body = [];
  else if (url.pathname.startsWith("/codeartsbuild/")) body = url.pathname.endsWith("/officialtemplates") ? { status: "success", error: null, result: { items: [], total_size: 0 } } : { jobs: [], total: 0 };
  else if (url.pathname.startsWith("/codeartspipeline/")) body = url.pathname.includes("/pipeline-templates/") ? { templates: [], total: 0 } : { pipelines: [], total: 0 };
  else if (url.pathname.startsWith("/codeartsdeploy/")) body = { result: [], total_num: 0 };
  else if (url.pathname.startsWith("/gaussdb/")) body = url.pathname.endsWith("/versions") ? { database_versions: [{ software_version: "506.2.0" }], total: 1 } : url.pathname.endsWith("/flavors") ? { flavors: [{ spec_code: "gaussdb.spec", vcpus: "4", ram: "32", group_type: "general", az_status: { "az-1": "normal" } }], total: 1 } : url.pathname.endsWith("/storage-type") ? { storage_type: [{ name: "ULTRAHIGH", support_compute_group_type: ["general"], az_status: { "az-1": "normal" } }] } : { instances: [], total_count: 0 };
  else if (url.pathname.startsWith("/taurusdb/")) body = url.pathname.includes("/datastores/") ? { datastores: [{ version: "8.0" }] } : url.pathname.includes("/flavors/") ? { flavors: [{ spec_code: "taurus.spec", vcpus: "4", ram: 32, version_name: "8.0", instance_mode: "Cluster", az_status: { "az-1": "normal" } }] } : { instances: [], total_count: 0 };
  else if (url.pathname.startsWith("/geminidb/")) body = url.pathname.endsWith("/versions") ? { versions: [url.pathname.includes("/mongodb/") ? "4.0" : "3.11"] } : url.pathname.endsWith("/flavors") ? { flavors: [{ engine_name: url.searchParams.get("engine_name"), engine_version: url.searchParams.get("engine_name") === "mongodb" ? "4.0" : "3.11", spec_code: "geminidb." + url.searchParams.get("engine_name"), vcpus: "4", ram: "16384", az_status: { "az-1": "normal" } }] } : { instances: [], total_count: 0 };
  else if (url.pathname.startsWith("/waf/")) body = { items: [], total: 0 };
  else if (url.pathname.startsWith("/cdm/")) body = url.pathname.endsWith("/datastores") ? { datastores: [{ id: "cdm", name: "cdm", versions: [{ name: "2.9", active: "1" }] }] } : url.pathname.endsWith("/flavors") ? { id: "cdm", dbname: "cdm", versions: [{ name: "2.9", id: "cdm-version", flavors: [{ str_id: "cdm-flavor", name: "cdm.medium", status: "normal", region: "all", cpu: 4, ram: 8 }] }] } : url.pathname.endsWith("/availability_zones") ? { availableZones: [{ availableZoneCode: "az-1", availableZoneName: "Zone 1", azStatus: "Available" }] } : { clusters: [] };
  else if (url.pathname.startsWith("/sdrs/")) body = url.pathname.endsWith("/active-domains") ? { domains: [{ id: "domain-1", name: "Recovery zones", sold_out: false, local_replication_cluster: { availability_zone: "az-1" }, remote_replication_cluster: { availability_zone: "az-2" } }] } : { server_groups: [], protected_instances: [], replications: [], disaster_recovery_drills: [], count: 0 };
  else if (url.pathname.startsWith("/cci/")) body = { items: [], metadata: {} };
  else if (url.pathname.startsWith("/css/")) body = url.pathname.endsWith("/es-flavors") ? { versions: [{ version: "7.10.2", type: "ess", flavors: [{ name: "ess.spec", flavor_id: "css-flavor", cpu: 2, ram: 8, diskrange: "40,800", availableAZ: "az-1" }] }] } : { clusters: [], total_count: 0 };
  else if (url.pathname.startsWith("/cce/")) body = { items: [] };
  else if (url.pathname.startsWith("/rds/")) {
    if (url.pathname.includes("/flavors/")) body = { flavors: [{ instance_mode: "single", version_name: ["8.0"], spec_code: "rds.single", vcpus: "2", ram: 4096, az_status: { "az-1": "normal" }, az_desc: { "az-1": "Zone 1" } }] };
    else if (url.pathname.includes("/storage-type/")) body = { storage_type: [{ name: "ULTRAHIGH", az_status: { "az-1": "normal" } }] };
    else if (showRdsDetails) {
      const backups = url.pathname.includes("/backups");
      status = backups && failRdsBackups ? 403 : 200;
      body = backups
        ? failRdsBackups
          ? { error_msg: "backup permission denied" }
          : { backups: [{ id: "backup-1", name: "Review backup" }] }
        : {
            instances: [
              { id: "review-db", name: "Review database", nodes: [] },
            ],
          };
    } else {
      status = failRds ? 403 : 200;
      body = failRds
        ? { error: { message: "mock permission denied" } }
        : { instances: [] };
    }
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
      scaling_configurations: [{ scaling_configuration_id: "live-config", scaling_configuration_name: "Live configuration" }], total_number: 1,
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
  res.end(typeof body === "string" ? body : JSON.stringify(body));
});
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const mockPort = mock.address().port;
const mockUrl = `http://127.0.0.1:${mockPort}`;
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", BETTERUI_SMOKE_OBS_URL: mockUrl, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${path.resolve("tests/fixtures/production-obs.mjs")}` };
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
  "listDmsRabbitMqInstances",
  "listDmsRocketMqInstances",
  "listAomPrometheusInstances",
  "listEnterpriseProjects",
  ...["rabbitmq", "rocketmq"].map((engine) =>
    JSON.stringify(["messaging-instance-v1", engine, projectId, `${engine}-1`]),
  ),
  "cloud-summary",
  "rds-instance:review-db",
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
  for (const [body, status] of [
    [{ action: "delete", projectId }, 400],
    [{ action: "start", projectId }, 409],
    [{ action: "stop", projectId: "another-project" }, 400],
  ]) {
    const rejected = await request("/api/cloud/ecs/server-0/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(rejected.status, status);
  }
  assert.equal(
    requests.filter(
      (req) => req.path.startsWith("/ecs/") && req.path.endsWith("/action"),
    ).length,
    0,
  );
  generation = 2;
  const action = await request("/api/cloud/ecs/server-0/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "stop", projectId }),
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
  showRdsDetails = true;
  failRdsBackups = true;
  const partialRds = await request("/services/rds/review-db");
  assert.equal(partialRds.status, 200);
  const partialHtml = await partialRds.text();
  assert.match(partialHtml, /Review database/);
  assert.match(partialHtml, /backup permission denied/);
  assert.doesNotMatch(partialHtml, /Unable to load resource/);
  failRdsBackups = false;
  const completeRds = await (await request("/services/rds/review-db")).text();
  assert.match(completeRds, /Review backup/);
  assert.doesNotMatch(completeRds, /backup permission denied/);
  for (const engine of ["rabbitmq", "rocketmq"]) {
    const inventory = await request(`/services/dms-${engine}`);
    assert.equal(inventory.status, 200);
    const html = await inventory.text();
    assert.match(html, new RegExp(`Live ${engine} broker`));
    assert.ok(html.includes(`projectId=${projectId}`));
    const detail = await request(
      `/services/dms-${engine}/${engine}-1?projectId=${projectId}`,
    );
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), /Connection endpoints/);
    assert.match(
      await (
        await request(`/services/dms-${engine}/denied?projectId=${projectId}`)
      ).text(),
      /broker permission denied/,
    );
    assert.match(
      await (
        await request(`/services/dms-${engine}/${engine}-1?projectId=unknown`)
      ).text(),
      /not part of this session/,
    );
  }
  const aomDenied = await (await request("/services/aom")).text();
  assert.match(aomDenied, /AOM permission denied/);
  assert.doesNotMatch(aomDenied, /No Prometheus instances/);
  failAom = false;
  const aomHtml = await (await request("/services/aom")).text();
  assert.match(aomHtml, /Live Prometheus/);
  assert.match(aomHtml, /30 days/);
  assert.doesNotMatch(aomHtml, /AOM permission denied/);
  assert.match(
    await (await request("/services/enterprise-projects")).text(),
    /Live enterprise project/,
  );
  for (const service of ["codearts-repo", "codearts-build", "codearts-pipeline", "codearts-deploy"]) {
    const inventory = await request(`/services/${service}`);
    assert.equal(inventory.status, 200);
    assert.doesNotMatch(await inventory.text(), /expected a JSON array|Unexpected mock path/);
  }
  assert.ok(requests.some(entry => entry.path === `/codeartsrepo/v4/projects/${"a".repeat(32)}/repositories`));
  const serviceSearch = await request("/services/databases");
  assert.match(await serviceSearch.text(), /dms-rabbitmq/);
  for (const service of ["ecs", "aom", "enterprise-projects", "dms-rabbitmq", "dms-rocketmq", "network", "dns", "smn", "lts", "dew", "ces", "cts", "cdn", "eip", "elb", "cbr", "sfs", "swr", "obs", "as", "nat", "evs", "iam", "deh", "dcs", "dms-kafka", "iotda", "rds", "ims", "dli", "secmaster", "enterprise-router", "vpc-endpoint", "eventgrid", "apig", "oms", "dds", "cce", "css", "cci", "waf", "gaussdb", "taurusdb", "geminidb", "sdrs", "codearts-repo", "codearts-build", "cdm", "codearts-pipeline", "sms", "dws", "codearts-deploy", "bms", "mgc", "cph", "servicestage", "asm"]) {
    const managementPage = await request(`/services/${service}/manage`);
    assert.equal(managementPage.status, 200, `${service} management route`);
    assert.match(await managementPage.text(), /Loading management controls/);
    const serviceContext = await request(`/api/cloud/management/${service}?projectId=${projectId}`);
    assert.equal(serviceContext.status, 200, `${service}: ${await serviceContext.clone().text()}`);
    const definition = await serviceContext.json();
    assert.ok(definition.operations.length, service);
    const formContext = await request(`/api/cloud/management/${service}?projectId=${projectId}&operation=${definition.operations[0].id}`);
    assert.equal(formContext.status, 200, `${service} management form: ${await formContext.text()}`);
  }
  const context = await request(`/api/cloud/management/aom?projectId=${projectId}&operation=update&resourceId=prom-1`);
  assert.equal(context.status, 200, await context.clone().text());
  assert.equal((await context.json()).resources[0].name, "Live Prometheus");
  const requestId = randomUUID();
  const mutation = { requestId, operation: "create", projectId, acknowledgedImpact: true, values: { name: "Browser-Monitor", type: "REMOTE_WRITE", enterpriseProjectId: "0" } };
  const create = await request("/api/cloud/management/aom", { method: "POST", headers: { "Content-Type": "application/json", Origin: appUrl }, body: JSON.stringify(mutation) });
  assert.equal(create.status, 200, await create.clone().text());
  assert.equal((await create.json()).resourceId, "created-prom");
  const replay = await request("/api/cloud/management/aom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
  assert.equal((await replay.json()).replayed, true);
  assert.equal(requests.filter((entry) => entry.method === "POST" && entry.path.startsWith("/aom/")).length, 1);
  assert.match(await (await request("/tasks")).text(), /Create Prometheus instance/);
  assert.equal((await request("/services/coverage")).status, 200);
  if (process.env.BETTERUI_BROWSER_HOOK) {
    const browser = await fetch(process.env.BETTERUI_BROWSER_HOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appUrl, cookie, projectId }), signal: AbortSignal.timeout(120000) });
    assert.equal(browser.status, 200, await browser.text());
  }
  console.log(
    "PASS: production HTTP login/subproject region, 101-resource pagination, persisted cache hit, ECS action invalidation of list/detail/summary, cloud error views, live SWR/AS/Billing/Cost pages, account authentication, cost-query cache isolation, permission failures, and cross-bundle partial detail errors. All cloud requests used local mocks.",
  );
  console.log(
    "PASS: RabbitMQ/RocketMQ inventory and project-scoped details, denied/unknown-project errors, AOM permission recovery and retention, and account-wide EPS inventory.",
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
