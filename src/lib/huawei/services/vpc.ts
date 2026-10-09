import { huaweiList } from "@/lib/huawei/http";
import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  huaweiFetch,
  loadAcrossProjects,
  projectForId,
} from "@/lib/huawei/core";

export type VpcItem = {
  cidr: string;
  createdAt: string;
  description: string;
  enterpriseProjectId: string;
  id: string;
  name: string;
  secondaryCidrs: string[];
  status: string;
  tags: string[];
  updatedAt: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type SubnetItem = {
  availabilityZone: string;
  cidr: string;
  createdAt: string;
  description: string;
  dhcpEnabled: string;
  dnsServers: string[];
  gateway: string;
  id: string;
  ipv6Cidr: string;
  ipv6Gateway: string;
  name: string;
  neutronNetworkId: string;
  neutronSubnetId: string;
  status: string;
  updatedAt: string;
  vpcId: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type SecurityGroupRuleItem = {
  action: string;
  description: string;
  direction: string;
  ethertype: string;
  id: string;
  multiport: string;
  priority: string;
  protocol: string;
  remote: string;
};

export type SecurityGroupItem = {
  createdAt: string;
  description: string;
  enterpriseProjectId: string;
  id: string;
  name: string;
  ruleItems: SecurityGroupRuleItem[];
  rules: number;
  tags: string[];
  updatedAt: string;
  projectId: string;
  projectName: string;
  region: string;
};

function stringList(value: unknown) {
  return asArray(value)
    .map((item) => (typeof item === "string" ? item : ""))
    .filter(Boolean);
}

function tagList(value: unknown) {
  return asArray(value)
    .map((tag) => {
      if (typeof tag === "string") {
        return tag;
      }

      const item = asRecord(tag);
      const key = asString(item.key, "");
      const tagValue = asString(item.value, "");

      return [key, tagValue].filter(Boolean).join("=");
    })
    .filter(Boolean);
}

function boolString(value: unknown) {
  return typeof value === "boolean" ? (value ? "Enabled" : "Disabled") : "-";
}

function securityGroupRules(value: unknown) {
  return asArray(value).map((rule): SecurityGroupRuleItem => {
    const item = asRecord(rule);
    return {
      action: firstString([item.action], "allow"),
      description: asString(item.description, ""),
      direction: asString(item.direction),
      ethertype: asString(item.ethertype),
      id: asString(item.id),
      multiport: firstString([item.multiport, item.port_range_min], "All"),
      priority: String(item.priority ?? "-"),
      protocol: firstString([item.protocol], "Any"),
      remote: firstString(
        [
          item.remote_ip_prefix,
          item.remote_group_id,
          item.remote_address_group_id,
        ],
        "Any",
      ),
    };
  });
}

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
      createdAt: firstString([item.created_at, item.createdAt], "-"),
      description: asString(item.description, ""),
      enterpriseProjectId: String(item.enterprise_project_id ?? "-"),
      id: asString(item.id),
      name: asString(item.name),
      secondaryCidrs: stringList(item.extend_cidrs ?? item.ext_cidrs),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "ACTIVE"),
      tags: tagList(item.tags),
      updatedAt: firstString([item.updated_at, item.updatedAt], "-"),
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
      availabilityZone: asString(item.availability_zone),
      cidr: asString(item.cidr),
      createdAt: firstString([item.created_at, item.createdAt], "-"),
      description: asString(item.description, ""),
      dhcpEnabled: boolString(item.dhcp_enable),
      dnsServers: stringList(item.dnsList).length
        ? stringList(item.dnsList)
        : stringList([item.primary_dns, item.secondary_dns]),
      gateway: asString(item.gateway_ip),
      id: asString(item.id),
      ipv6Cidr: firstString([item.ipv6_cidr, item.ipv6_subnet_cidr], "-"),
      ipv6Gateway: firstString([item.ipv6_gateway, item.ipv6_gateway_ip], "-"),
      name: asString(item.name),
      neutronNetworkId: asString(item.neutron_network_id),
      neutronSubnetId: asString(item.neutron_subnet_id),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "ACTIVE"),
      updatedAt: firstString([item.updated_at, item.updatedAt], "-"),
      vpcId: asString(item.vpc_id),
    };
  });
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
    const rules = securityGroupRules(item.security_group_rules);
    return {
      createdAt: firstString([item.created_at, item.createdAt], "-"),
      description: asString(item.description, ""),
      enterpriseProjectId: String(item.enterprise_project_id ?? "-"),
      id: asString(item.id),
      name: asString(item.name),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      ruleItems: rules,
      rules: rules.length,
      tags: tagList(item.tags),
      updatedAt: firstString([item.updated_at, item.updatedAt], "-"),
    };
  });
}

export async function listVpcs(session: BetterUiSession) {
  return loadAcrossProjects(session, listVpcsForProject);
}

export async function listSubnets(session: BetterUiSession) {
  return loadAcrossProjects(session, listSubnetsForProject);
}

export async function listSecurityGroups(session: BetterUiSession) {
  return loadAcrossProjects(session, listSecurityGroupsForProject);
}

export async function updateVpc(
  session: BetterUiSession,
  vpcId: string,
  input: { description?: string; name?: string; projectId?: string },
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "vpc",
    `/v1/${project.projectId}/vpcs/${vpcId}`,
    {
      body: JSON.stringify({
        vpc: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
        },
      }),
      method: "PUT",
    },
  );
}

export async function deleteVpc(
  session: BetterUiSession,
  vpcId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "vpc",
    `/v1/${project.projectId}/vpcs/${vpcId}`,
    { method: "DELETE" },
  );
}

export async function updateSubnet(
  session: BetterUiSession,
  subnetId: string,
  input: { name: string; projectId?: string; vpcId: string },
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "vpc",
    `/v1/${project.projectId}/vpcs/${input.vpcId}/subnets/${subnetId}`,
    {
      body: JSON.stringify({ subnet: { name: input.name } }),
      method: "PUT",
    },
  );
}

export async function deleteSubnet(
  session: BetterUiSession,
  subnetId: string,
  input: { projectId?: string; vpcId: string },
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "vpc",
    `/v1/${project.projectId}/vpcs/${input.vpcId}/subnets/${subnetId}`,
    { method: "DELETE" },
  );
}

export async function updateSecurityGroup(
  session: BetterUiSession,
  securityGroupId: string,
  input: { description?: string; name?: string; projectId?: string },
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "vpc",
    `/v3/${project.projectId}/vpc/security-groups/${securityGroupId}`,
    {
      body: JSON.stringify({
        security_group: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
        },
      }),
      method: "PUT",
    },
  );
}

export async function deleteSecurityGroup(
  session: BetterUiSession,
  securityGroupId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "vpc",
    `/v3/${project.projectId}/vpc/security-groups/${securityGroupId}`,
    { method: "DELETE" },
  );
}
