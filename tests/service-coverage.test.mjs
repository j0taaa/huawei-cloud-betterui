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
  ["WAF", "waf", "listWafInstances"],
  ["DEW", "dew", "listDewKeys"],
  ["HSS", "hss", "listHssHosts"],
  ["SMN", "smn", "listSmnTopics"],
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
