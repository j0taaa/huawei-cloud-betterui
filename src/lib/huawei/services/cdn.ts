import "server-only";

import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { sessionProjects } from "@/lib/huawei/projects";

export type CdnDomain = {
  businessType: string;
  cname: string;
  createdAt: string;
  domainName: string;
  id: string;
  originHost: string;
  region: string;
  serviceArea: string;
  status: string;
  updatedAt: string;
};

export async function listCdnDomains(session: BetterUiSession) {
  const project = sessionProjects(session)[0];
  const body = await huaweiList<{ domains?: unknown[] }>(
    project,
    "cdn",
    "/v1.0/cdn/domains?page_size=100&page_number=1",
    {
      items: ["domains"],
      kind: "page",
      parameter: "page_number",
      size: 100,
      first: 1,
    },
  );

  return asArray(body.domains).map((domain): CdnDomain => {
    const item = asRecord(domain);
    const originHost = asRecord(item.origin_host);

    return {
      businessType: asString(item.business_type, "-"),
      cname: firstString([item.cname, item.cname_target], "-"),
      createdAt: firstString([
        item.create_time,
        item.created_at,
        item.createdAt,
      ]),
      domainName: firstString([item.domain_name, item.name]),
      id: firstString([item.id, item.domain_id, item.domain_name]),
      originHost: firstString(
        [originHost.domain_name, item.origin_host, item.origin_host_name],
        "-",
      ),
      region: project.region,
      serviceArea: asString(item.service_area, "-"),
      status: asString(item.domain_status, "UNKNOWN"),
      updatedAt: firstString([
        item.update_time,
        item.updated_at,
        item.updatedAt,
      ]),
    };
  });
}
