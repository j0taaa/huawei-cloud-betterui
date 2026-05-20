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
  ["DC", "direct-connect", "listDirectConnectConnections"],
  ["ER", "enterprise-router", "listEnterpriseRouters"],
  ["VPCEP", "vpc-endpoint", "listVpcEndpoints"],
  ["BMS", "bms", "listBmsServers"],
  ["DeH", "deh", "listDedicatedHosts"],
  ["CCI", "cci", "listCciNamespaces"],
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
  ["SecMaster", "secmaster", "listSecMasterWorkspaces"],
  ["CFW", "cfw", "listCloudFirewalls"],
  ["Workspace", "workspace", "listWorkspaceTenants"],
  ["SMN", "smn", "listSmnTopics"],
  ["CES", "ces", "listCesAlarmRules"],
  ["ModelArts", "modelarts", "listModelArtsNotebooks"],
  ["DLI", "dli", "listDliQueues"],
  ["MRS", "mrs", "listMrsClusters"],
  ["DWS", "dws", "listDwsClusters"],
  ["CSS", "css", "listCssClusters"],
  ["CBH", "cbh", "listCbhInstances"],
  ["CPH", "cph", "listCphServers"],
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

test("networking and infrastructure service loaders use read-only list endpoints", () => {
  const infrastructureEndpoints = [
    ["dc", "GET", "/v3/${session.projectId}/dcaas/direct-connects"],
    ["er", "GET", "/v3/${session.projectId}/enterprise-router/instances?limit=2000"],
    ["vpcep", "GET", "/v1/${session.projectId}/vpc-endpoints?limit=1000"],
    ["bms", "GET", "/v1/${session.projectId}/baremetalservers/detail"],
    ["deh", "GET", "/v1.0/${session.projectId}/dedicated-hosts"],
    ["cci", "GET", "/apis/cci/v2/namespaces"],
    ["cci", "GET", "/apis/cci/v2/namespaces/${encodeURIComponent(name)}/pods"],
  ];

  for (const [service, method, path] of infrastructureEndpoints) {
    assert.match(huaweiCloud, new RegExp(`"${service}"[\\s\\S]*?${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(method, "GET");
  }

  assert.doesNotMatch(huaweiCloud, /"dc"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"er"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"vpcep"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"bms"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"deh"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"cci"[\s\S]{0,300}method: "POST"/);
});

test("security and workspace service loaders use read-only inventory endpoints", () => {
  const securityEndpoints = [
    ["ces", "GET", "/v2/${session.projectId}/alarms?limit=100"],
    ["secmaster", "GET", "/v1/${session.projectId}/workspaces?offset=0&limit=100"],
    ["cfw", "POST", "/v1/${session.projectId}/firewalls/list?enterprise_project_id=all_granted_eps"],
    ["cbh", "GET", "/v2/${session.projectId}/cbs/instance/list"],
    ["workspace", "GET", "/v2/${session.projectId}/workspaces"],
    ["cph", "GET", "/v1/${session.projectId}/cloud-phone/servers?offset=0&limit=100"],
  ];

  for (const [service, method, path] of securityEndpoints) {
    assert.match(huaweiCloud, new RegExp(`"${service}"[\\s\\S]*?${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(huaweiCloud, new RegExp(`"${service}"[\\s\\S]*?method: "${method}"|${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }

  assert.doesNotMatch(huaweiCloud, /"ces"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"secmaster"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"cbh"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"workspace"[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /"cph"[\s\S]{0,300}method: "POST"/);
  assert.match(huaweiCloud, /"cfw"[\s\S]{0,300}\/firewalls\/list[\s\S]{0,300}method: "POST"/);
  assert.doesNotMatch(huaweiCloud, /\bcreate(?:Ces|SecMaster|CloudFirewall|Cbh|Workspace|Cph)\b/);
  assert.doesNotMatch(huaweiCloud, /\bdelete(?:Ces|SecMaster|CloudFirewall|Cbh|Workspace|Cph)\b/);
  assert.doesNotMatch(huaweiCloud, /\bupdate(?:Ces|SecMaster|CloudFirewall|Cbh|Workspace|Cph)\b/);
});
