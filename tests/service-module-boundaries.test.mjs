import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const huaweiCloud = readFileSync(join(root, "src/lib/huawei-cloud.ts"), "utf8");

test("migrated service clients live in service-owned modules", () => {
  for (const service of [
    "bms",
    "cbr",
    "cbh",
    "cph",
    "cce",
    "cci",
    "ces",
    "cfw",
    "cdm",
    "cdn",
    "codearts-build",
    "codearts-deploy",
    "codearts-pipeline",
    "codearts-repo",
    "css",
    "cts",
    "dataarts",
    "deh",
    "dew",
    "direct-connect",
    "dcs",
    "dds",
    "dli",
    "dms-kafka",
    "dns",
    "drs",
    "dws",
    "ecs",
    "eip",
    "elb",
    "enterprise-router",
    "eventgrid",
    "evs",
    "flexus",
    "functiongraph",
    "gaussdb",
    "geminidb",
    "hss",
    "iam",
    "ims",
    "iotda",
    "koogallery",
    "lts",
    "mgc",
    "modelarts",
    "mrs",
    "nat",
    "obs",
    "oms",
    "rds",
    "sdrs",
    "secmaster",
    "servicestage",
    "sfs",
    "smn",
    "sms",
    "taurusdb",
    "vpc",
    "vpc-endpoint",
    "vpn",
    "waf",
    "workspace",
  ]) {
    assert.equal(
      existsSync(join(root, `src/lib/huawei/services/${service}.ts`)),
      true,
      `${service} should have a dedicated cloud client module`,
    );
  }

  assert.doesNotMatch(huaweiCloud, /function listEvsDisksForProject/);
  assert.doesNotMatch(huaweiCloud, /function listRdsInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listBmsServersForProject/);
  assert.doesNotMatch(huaweiCloud, /function listApigInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCbhInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCbrVaultsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCceClustersForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCciNamespacesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCesAlarmRulesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCloudFirewallsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCdmClustersForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCodeArtsBuildJobsForProject/);
  assert.doesNotMatch(
    huaweiCloud,
    /function listCodeArtsDeployApplicationsForProject/,
  );
  assert.doesNotMatch(huaweiCloud, /function listCodeArtsPipelinesForProject/);
  assert.doesNotMatch(
    huaweiCloud,
    /function listCodeArtsRepositoriesForProject/,
  );
  assert.doesNotMatch(huaweiCloud, /function listCphServersForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCssClustersForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCtsTrackersForProject/);
  assert.doesNotMatch(huaweiCloud, /function listCtsTracesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listDataArtsInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listDcsRedisInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listDdsInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listDedicatedHostsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listDewKeysForProject/);
  assert.doesNotMatch(
    huaweiCloud,
    /function listDirectConnectConnectionsForProject/,
  );
  assert.doesNotMatch(huaweiCloud, /function listDliQueuesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listDmsKafkaInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listDrsJobsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listDwsClustersForProject/);
  assert.doesNotMatch(huaweiCloud, /function listEcsInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listEipsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listElbsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listEnterpriseRoutersForProject/);
  assert.doesNotMatch(
    huaweiCloud,
    /function listEventGridSubscriptionsForProject/,
  );
  assert.doesNotMatch(
    huaweiCloud,
    /function listFunctionGraphFunctionsForProject/,
  );
  assert.doesNotMatch(huaweiCloud, /function listGaussDbInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listGeminiDbInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listHssHostsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listImagesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listIotdaDevicesForProject/);
  assert.doesNotMatch(
    huaweiCloud,
    /function listKooGalleryPurchasedApisForProject/,
  );
  assert.doesNotMatch(huaweiCloud, /function listLtsLogGroupsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listModelArtsNotebooksForProject/);
  assert.doesNotMatch(huaweiCloud, /function listMrsClustersForProject/);
  assert.doesNotMatch(huaweiCloud, /function listNatGatewaysForProject/);
  assert.doesNotMatch(huaweiCloud, /function parseObsBuckets/);
  assert.doesNotMatch(huaweiCloud, /function listOmsMigrationTasksForProject/);
  assert.doesNotMatch(
    huaweiCloud,
    /function listSecMasterWorkspacesForProject/,
  );
  assert.doesNotMatch(
    huaweiCloud,
    /function listServiceStageApplicationsForProject/,
  );
  assert.doesNotMatch(huaweiCloud, /function listSecurityGroupsForProject/);
  assert.doesNotMatch(
    huaweiCloud,
    /function listSdrsProtectedInstancesForProject/,
  );
  assert.doesNotMatch(huaweiCloud, /function listSfsSharesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listSmnTopicsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listSmsTasksForProject/);
  assert.doesNotMatch(huaweiCloud, /function listSubnetsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listTaurusDbInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listVpcEndpointsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listVpcsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listVpnConnectionsForProject/);
  assert.doesNotMatch(huaweiCloud, /function listWafInstancesForProject/);
  assert.doesNotMatch(huaweiCloud, /function listWorkspaceTenantsForProject/);
  assert.doesNotMatch(huaweiCloud, /export async function listDnsZones/);
  assert.doesNotMatch(huaweiCloud, /export async function listCdnDomains/);
  assert.doesNotMatch(huaweiCloud, /export async function listFlexusResources/);
  assert.doesNotMatch(huaweiCloud, /export async function listIamUsers/);
  assert.doesNotMatch(
    huaweiCloud,
    /export async function listMgcMigrationItems/,
  );
  assert.doesNotMatch(huaweiCloud, /export async function listObsBuckets/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/apig"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/bms"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/cbr"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/cbh"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/cce"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/cdn"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/ces"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/cfw"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/cci"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/cdm"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/codearts-build"/,
  );
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/codearts-deploy"/,
  );
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/codearts-pipeline"/,
  );
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/codearts-repo"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/cph"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/css"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/cts"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/dataarts"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/deh"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/dew"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/direct-connect"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/dcs"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/dds"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/dli"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/dms-kafka"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/dns"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/drs"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/dws"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/ecs"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/eip"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/elb"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/enterprise-router"/,
  );
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/eventgrid"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/evs"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/flexus"/,
  );
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/functiongraph"/,
  );
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/gaussdb"/,
  );
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/geminidb"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/hss"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/iam"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/ims"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/iotda"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/koogallery"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/lts"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/mgc"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/modelarts"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/mrs"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/nat"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/obs"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/oms"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/rds"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/sdrs"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/secmaster"/,
  );
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/servicestage"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/sfs"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/smn"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/sms"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/taurusdb"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/vpc"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/vpc-endpoint"/,
  );
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/vpn"/);
  assert.match(huaweiCloud, /export \* from "@\/lib\/huawei\/services\/waf"/);
  assert.match(
    huaweiCloud,
    /export \* from "@\/lib\/huawei\/services\/workspace"/,
  );
});
