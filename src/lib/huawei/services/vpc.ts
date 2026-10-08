import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type VpcItem = {
  cidr: string;
  id: string;
  name: string;
  status: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type SubnetItem = {
  cidr: string;
  gateway: string;
  id: string;
  name: string;
  status: string;
  vpcId: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type SecurityGroupItem = {
  description: string;
  id: string;
  name: string;
  rules: number;
  projectId: string;
  projectName: string;
  region: string;
};

export async function listVpcsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ vpcs?: unknown[] }>(
    session,
    "vpc",
    `/v3/${session.projectId}/vpc/vpcs?limit=200`,
    {
      items: ["vpcs"],
      kind: "marker",
      parameter: "marker",
      size: 200,
      next: ["page_info.next_marker", "next_marker"],
    },
  );

  return asArray(body.vpcs).map((vpc): VpcItem => {
    const item = asRecord(vpc);
    return {
      cidr: firstString([item.cidr, item.cidr_v4]),
      id: asString(item.id),
      name: asString(item.name),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "ACTIVE"),
    };
  });
}

export async function listSubnetsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ subnets?: unknown[] }>(
    session,
    "vpc",
    `/v1/${session.projectId}/subnets?limit=200`,
    {
      items: ["subnets"],
      kind: "marker",
      parameter: "marker",
      size: 200,
      next: ["page_info.next_marker", "next_marker"],
      fallbackKey: "id",
    },
  );

  return asArray(body.subnets).map((subnet): SubnetItem => {
    const item = asRecord(subnet);
    return {
      cidr: asString(item.cidr),
      gateway: asString(item.gateway_ip),
      id: asString(item.id),
      name: asString(item.name),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "ACTIVE"),
      vpcId: asString(item.vpc_id),
    };
  });
}

export async function listVpcs(session: BetterUiSession) {
  return loadAcrossProjects(session, listVpcsForProject);
}

export async function listSubnets(session: BetterUiSession) {
  return loadAcrossProjects(session, listSubnetsForProject);
}

export async function listSecurityGroupsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ security_groups?: unknown[] }>(
    session,
    "vpc",
    `/v3/${session.projectId}/vpc/security-groups?limit=200`,
    {
      items: ["security_groups"],
      kind: "marker",
      parameter: "marker",
      size: 200,
      next: ["page_info.next_marker", "next_marker"],
    },
  );

  return asArray(body.security_groups).map((group): SecurityGroupItem => {
    const item = asRecord(group);
    return {
      description: asString(item.description, ""),
      id: asString(item.id),
      name: asString(item.name),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      rules: asArray(item.security_group_rules).length,
    };
  });
}

export async function listSecurityGroups(session: BetterUiSession) {
  return loadAcrossProjects(session, listSecurityGroupsForProject);
}
