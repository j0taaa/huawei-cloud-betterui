import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const catalog = readFileSync(join(root, "src/lib/service-catalog.ts"), "utf8");
const commandSearch = readFileSync(join(root, "src/components/service-command-search.tsx"), "utf8");
const huaweiCloud = readFileSync(join(root, "src/lib/huawei-cloud.ts"), "utf8");

const services = [
  ["EIP", "eip", "listEips"],
  ["NAT", "nat", "listNatGateways"],
  ["VPN", "vpn", "listVpnConnections"],
  ["CBR", "cbr", "listCbrVaults"],
  ["SFS", "sfs", "listSfsShares"],
  ["IMS", "ims", "listImages"],
  ["IAM", "iam", "listIamUsers"],
  ["CTS", "cts", "listCtsTrackers"],
  ["LTS", "lts", "listLtsLogGroups"],
  ["DNS", "dns", "listDnsZones"],
  ["CDN", "cdn", "listCdnDomains"],
  ["APIG", "apig", "listApigInstances"],
  ["DMS Kafka", "dms-kafka", "listDmsKafkaInstances"],
  ["DCS", "dcs", "listDcsRedisInstances"],
  ["DRS", "drs", "listDrsJobs"],
  ["GaussDB", "gaussdb", "listGaussDbInstances"],
  ["DDS", "dds", "listDdsInstances"],
  ["TaurusDB", "taurusdb", "listTaurusDbInstances"],
  ["GeminiDB", "geminidb", "listGeminiDbInstances"],
  ["WAF", "waf", "listWafInstances"],
  ["DEW", "dew", "listDewKeys"],
  ["HSS", "hss", "listHssHosts"],
  ["SMN", "smn", "listSmnTopics"],
  ["ModelArts", "modelarts", "listModelArtsNotebooks"],
  ["DLI", "dli", "listDliQueues"],
  ["MRS", "mrs", "listMrsClusters"],
  ["DWS", "dws", "listDwsClusters"],
  ["CSS", "css", "listCssClusters"],
];

test("new Huawei service routes are present and linked", () => {
  for (const [shortName, route] of services) {
    assert.equal(
      existsSync(join(root, `src/app/services/${route}/page.tsx`)),
      true,
      `${route} page should exist`,
    );
    assert.match(catalog, new RegExp(`shortName: "${shortName}"[\\s\\S]*?href: "/services/${route}"`));
    assert.match(commandSearch, new RegExp(`shortName: "${shortName}"[\\s\\S]*?href: "/services/${route}"`));
  }
});

test("new Huawei service pages use read-only loaders", () => {
  for (const [, route, loader] of services) {
    const page = readFileSync(join(root, `src/app/services/${route}/page.tsx`), "utf8");

    assert.match(huaweiCloud, new RegExp(`export async function ${loader}\\(`));
    assert.match(page, /withCloudResult/);
    assert.match(page, new RegExp(`\\b${loader}\\b`));
    assert.doesNotMatch(page, /\bcreate[A-Z]|\bdelete[A-Z]|\bupdate[A-Z]/);
  }
});

test("database service loaders use read-only list endpoints", () => {
  const databaseEndpoints = [
    ["drs", "GET", "/v5/${session.projectId}/jobs?limit=100"],
    ["gaussdb", "GET", "/v3/${session.projectId}/instances?limit=100"],
    ["dds", "GET", "/v3/${session.projectId}/instances?limit=100"],
    ["taurusdb", "GET", "/v3/${session.projectId}/instances?limit=100"],
    ["geminidb", "GET", "/v3/${session.projectId}/instances?limit=100"],
  ];

  for (const [service, method, path] of databaseEndpoints) {
    assert.match(huaweiCloud, new RegExp(`"${service}"[\\s\\S]*?${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(method, "GET");
  }

  assert.doesNotMatch(huaweiCloud, /"drs"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"gaussdb"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"dds"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"taurusdb"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"geminidb"[\s\S]{0,300}method: "POST"/);
});

test("analytics and search service loaders use read-only list endpoints", () => {
  const analyticsEndpoints = [
    ["modelarts", "GET", "/v1/${session.projectId}/notebooks/all?limit=100"],
    ["dli", "GET", "/v1.0/${session.projectId}/queues?queue_type=all&with-charge-info=true&page-size=100&current-page=1"],
    ["mrs", "GET", "/v1.1/${session.projectId}/cluster_infos?pageSize=100&currentPage=1&clusterState=existing"],
    ["dws", "GET", "/v1.0/${session.projectId}/clusters"],
    ["css", "GET", "/v1.0/${session.projectId}/clusters?limit=100"],
  ];

  for (const [service, method, path] of analyticsEndpoints) {
    assert.match(huaweiCloud, new RegExp(`"${service}"[\\s\\S]*?${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(method, "GET");
  }

  assert.doesNotMatch(huaweiCloud, /"modelarts"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"dli"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"mrs"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"dws"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"css"[\s\S]{0,300}method: "POST"/);
});
