import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listDmsRabbitMqInstances,
  listDmsRabbitMqInstancesForProject,
  getDmsRabbitMqInstance,
} from "@/lib/huawei/services/dms-rabbitmq";
import {
  listDmsRocketMqInstancesForProject,
  getDmsRocketMqInstance,
} from "@/lib/huawei/services/dms-rocketmq";
import { listAomPrometheusInstancesForProject } from "@/lib/huawei/services/aom";
import { listEnterpriseProjects } from "@/lib/huawei/services/enterprise-projects";
import { serviceEndpoint } from "@/lib/huawei/endpoints";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { CloudLoadError } from "@/lib/huawei/errors";
import { searchServices } from "@/lib/service-catalog";
import { project, session } from "./fixtures/session";

for (const [engine, loader] of [
  ["rabbitmq", listDmsRabbitMqInstancesForProject],
  ["rocketmq", listDmsRocketMqInstancesForProject],
] as const) {
  test(`${engine} paginates using its own endpoint, engine filter, and project token`, async (t) => {
    const offsets: number[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string, init: RequestInit) => {
        const url = new URL(input);
        assert.equal(url.hostname, `dms.${project.region}.myhuaweicloud.com`);
        assert.equal(url.pathname, `/v2/${project.projectId}/instances`);
        assert.equal(url.searchParams.get("engine"), engine);
        assert.equal(url.searchParams.get("limit"), "50");
        assert.equal(
          new Headers(init.headers).get("X-Auth-Token"),
          project.token,
        );
        const offset = Number(url.searchParams.get("offset"));
        offsets.push(offset);
        return Response.json({
          instance_num: 51,
          instances: Array.from({ length: offset === 0 ? 50 : 1 }, (_, i) => ({
            instance_id: `instance-${offset + i}`,
            name: `Message broker ${offset + i}`,
            status: "RUNNING",
            broker_num: 3,
            storage_space: 100,
            used_storage_space: 0,
            ssl_enable: false,
            enable_publicip: false,
            ...(engine === "rocketmq"
              ? {
                  namesrv_address: "10.0.0.1:9876",
                  connect_address: "unrelated",
                  broker_address: "10.0.0.2:10911",
                }
              : {
                  connect_address: "10.0.0.1",
                  connect_domain_name: "broker.local",
                }),
          })),
        });
      },
    );
    const instances = await loader(project);
    assert.equal(instances.length, 51);
    assert.equal(instances[50].id, "instance-50");
    assert.deepEqual(offsets, [0, 50]);
    assert.equal(instances[0].usedStorageGb, 0);
    assert.equal(instances[0].sslEnabled, false);
    assert.equal(instances[0].publicAccess, false);
    assert.equal(
      instances[0].privateAddress,
      engine === "rocketmq" ? "10.0.0.1:9876" : "broker.local",
    );
    assert.equal(instances[0].projectId, project.projectId);
  });
  test(`${engine} accepts an empty inventory but rejects malformed responses`, async (t) => {
    const mock = t.mock.method(globalThis, "fetch", async () =>
      Response.json({ instances: [], instance_num: 0 }),
    );
    assert.deepEqual(await loader(project), []);
    mock.mock.mockImplementation(async () =>
      Response.json({ message: "missing list" }),
    );
    await assert.rejects(loader(project), /Invalid list response/);
    mock.mock.mockImplementation(async () =>
      Response.json({ instances: [{ name: "no ID" }] }),
    );
    await assert.rejects(loader(project), /instance ID/);
  });
}

test("messaging inventory keeps duplicate IDs in different projects and retains partial data on denial", async (t) => {
  const second = {
    ...project,
    projectId: "project-2",
    projectName: "second",
    token: "second-token",
  };
  let denied = false;
  t.mock.method(globalThis, "fetch", async (input: string) =>
    new URL(input).pathname.includes("project-2") && denied
      ? Response.json({ error_msg: "permission denied" }, { status: 403 })
      : Response.json({
          instances: [{ instance_id: "same-id", name: "Broker" }],
          instance_num: 1,
        }),
  );
  const selected = { ...session, projects: [project, second] };
  assert.deepEqual(
    (await listDmsRabbitMqInstances(selected)).map((item) => item.projectId),
    ["project-1", "project-2"],
  );
  denied = true;
  await assert.rejects(listDmsRabbitMqInstances(selected), (error) => {
    assert.ok(error instanceof CloudLoadError);
    assert.match(error.message, /second.*403 permission denied/);
    assert.equal((error.partialData as unknown[]).length, 1);
    return true;
  });
});

test("messaging details use the linked project's token and reject unknown projects before requesting", async (t) => {
  const second = { ...project, projectId: "project-2", token: "second-token" };
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      const url = new URL(input);
      calls.push(url.pathname);
      assert.equal(
        new Headers(init.headers).get("X-Auth-Token"),
        "second-token",
      );
      assert.equal(url.pathname, "/v2/project-2/instances/broker%20id");
      return Response.json({
        instance_id: "broker id",
        name: "Broker",
        total_storage_space: 200,
        storage_space: 180,
      });
    },
  );
  const selected = { ...session, projects: [project, second] };
  assert.equal(
    (await getDmsRabbitMqInstance(selected, "broker id", second.projectId))
      .storageGb,
    200,
  );
  await getDmsRocketMqInstance(selected, "broker id", second.projectId);
  await assert.rejects(
    getDmsRabbitMqInstance(selected, "broker id", "unauthorized-project"),
    /not part of this session/,
  );
  assert.equal(calls.length, 2);
});

test("messaging detail rejects a different returned instance", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ instance_id: "different" }),
  );
  await assert.rejects(
    getDmsRocketMqInstance(session, "requested"),
    /different instance/,
  );
});

test("AOM sends all-granted-enterprise-project scope and parses retention without inventing pagination", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.pathname, `/v1/${project.projectId}/aom/prometheus`);
      assert.equal(url.search, "");
      assert.equal(
        new Headers(init.headers).get("Enterprise-Project-Id"),
        "all_granted_eps",
      );
      return Response.json({
        prometheus: [
          {
            prom_id: "prom-1",
            prom_name: "Monitoring",
            prom_status: "NORMAL",
            prom_type: "CCE",
            prom_version: "2",
            enterprise_project_id: "0",
            prom_limits: { compactor_blocks_retention_period: "30" },
          },
        ],
      });
    },
  );
  const [instance] = await listAomPrometheusInstancesForProject(project);
  assert.equal(instance.retention, "30");
  assert.equal(instance.enterpriseProjectId, "0");
  assert.equal(instance.type, "CCE");
});

test("AOM handles empty, malformed, and denied responses distinctly", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ prometheus: [] }),
  );
  assert.deepEqual(await listAomPrometheusInstancesForProject(project), []);
  mock.mock.mockImplementation(async () => Response.json({}));
  await assert.rejects(
    listAomPrometheusInstancesForProject(project),
    /Prometheus instance list/,
  );
  mock.mock.mockImplementation(async () =>
    Response.json({ error_msg: "aom permission denied" }, { status: 403 }),
  );
  await assert.rejects(
    listAomPrometheusInstancesForProject(project),
    /403 aom permission denied/,
  );
});

test("EPS uses one account token across multiple selected projects and paginates the account inventory", async (t) => {
  const offsets: number[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.hostname, "eps.myhuaweicloud.com");
      assert.equal(
        new Headers(init.headers).get("X-Auth-Token"),
        "account-token",
      );
      const offset = Number(url.searchParams.get("offset"));
      offsets.push(offset);
      return Response.json({
        total_count: 101,
        enterprise_projects: Array.from(
          { length: offset === 0 ? 100 : 1 },
          (_, i) => ({
            id: String(offset + i),
            name: `Enterprise ${offset + i}`,
            status: offset === 0 ? 1 : 2,
            type: offset === 0 ? "prod" : "poc",
          }),
        ),
      });
    },
  );
  const projects = await listEnterpriseProjects({
    ...session,
    accountToken: "account-token",
    projects: [project, { ...project, projectId: "second" }],
  });
  assert.equal(projects.length, 101);
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(projects[0].id, "0");
  assert.equal(projects[0].status, "Enabled");
  assert.equal(projects[100].status, "Disabled");
  assert.equal(projects[100].type, "Test");
});

test("EPS requires an account token and distinguishes empty inventory from denial", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ enterprise_projects: [], total_count: 0 }),
  );
  await assert.rejects(listEnterpriseProjects(session), /account token/);
  assert.equal(mock.mock.callCount(), 0);
  const account = { ...session, accountToken: "account-token" };
  assert.deepEqual(await listEnterpriseProjects(account), []);
  mock.mock.mockImplementation(async () =>
    Response.json(
      { error: { error_msg: "EPS permission denied" } },
      { status: 403 },
    ),
  );
  await assert.rejects(
    listEnterpriseProjects(account),
    /403 EPS permission denied/,
  );
});

test("new services participate in command search and messaging cache keys isolate engine and project", () => {
  for (const [query, href] of [
    ["amqp", "/services/dms-rabbitmq"],
    ["rocketmq", "/services/dms-rocketmq"],
    ["prometheus", "/services/aom"],
    ["eps", "/services/enterprise-projects"],
  ])
    assert.ok(searchServices(query).some((service) => service.href === href));
  assert.notEqual(
    cloudCacheKeys.messagingInstance("rabbitmq", "same", "project-1"),
    cloudCacheKeys.messagingInstance("rabbitmq", "same", "project-2"),
  );
  assert.notEqual(
    cloudCacheKeys.messagingInstance("rabbitmq", "same", "project-1"),
    cloudCacheKeys.messagingInstance("rocketmq", "same", "project-1"),
  );
  assert.equal(
    serviceEndpoint("aom", project.region),
    "https://aom.sa-brazil-1.myhuaweicloud.com",
  );
});
