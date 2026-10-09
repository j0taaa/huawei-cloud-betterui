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

export type NatGateway = {
  adminStateUp: boolean;
  bpsMax: number | null;
  createdAt: string;
  description: string;
  dnatRulesLimit: number | null;
  enterpriseProjectId: string;
  id: string;
  name: string;
  ngportIpAddress: string;
  ppsMax: number | null;
  projectId: string;
  projectName: string;
  region: string;
  routerId: string;
  sessionConfig: {
    icmpSessionExpireTime: number | null;
    tcpSessionExpireTime: number | null;
    tcpTimeWaitTime: number | null;
    udpSessionExpireTime: number | null;
  };
  spec: string;
  status: string;
  subnetId: string;
  type: string;
  updatedAt: string;
  vpcId: string;
};

export type NatSnatRule = {
  adminStateUp: boolean;
  cidr: string;
  createdAt: string;
  description: string;
  floatingIpAddress: string;
  floatingIpId: string;
  gatewayId: string;
  globalEipId: string;
  id: string;
  networkId: string;
  projectId: string;
  projectName: string;
  region: string;
  sourceType: number;
  status: string;
};

export type CreateNatGatewayInput = {
  description?: string;
  enterpriseProjectId?: string;
  name: string;
  projectId?: string;
  routerId: string;
  spec: string;
  subnetId: string;
};

export type CreateNatSnatRuleInput = {
  cidr?: string;
  description?: string;
  floatingIpId: string;
  gatewayId: string;
  networkId?: string;
  projectId?: string;
  sourceType: number;
};

function asBoolean(value: unknown, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function parseGateway(
  gateway: unknown,
  session: HuaweiProjectSession,
): NatGateway {
  const item = asRecord(gateway);
  const sessionConfig = asRecord(item.session_conf);

  return {
    adminStateUp: asBoolean(item.admin_state_up),
    bpsMax: asNumber(item.bps_max),
    createdAt: firstString([item.created_at, item.createdAt]),
    description: asString(item.description, ""),
    dnatRulesLimit: asNumber(item.dnat_rules_limit),
    enterpriseProjectId: asString(item.enterprise_project_id, "-"),
    id: asString(item.id),
    name: firstString([item.name, item.id]),
    ngportIpAddress: firstString([
      item.ngport_ip_address,
      item.private_ip_address,
    ]),
    ppsMax: asNumber(item.pps_max),
    projectId: firstString([item.tenant_id], session.projectId),
    projectName: session.projectName,
    region: session.region,
    routerId: firstString([item.router_id, item.vpc_id]),
    sessionConfig: {
      icmpSessionExpireTime: asNumber(sessionConfig.icmp_session_expire_time),
      tcpSessionExpireTime: asNumber(sessionConfig.tcp_session_expire_time),
      tcpTimeWaitTime: asNumber(sessionConfig.tcp_time_wait_time),
      udpSessionExpireTime: asNumber(sessionConfig.udp_session_expire_time),
    },
    spec: firstString([item.spec, item.specification], "-"),
    status: asString(item.status, "UNKNOWN"),
    subnetId: firstString([
      item.internal_network_id,
      item.network_id,
      item.subnet_id,
    ]),
    type: firstString([item.type, item.gateway_type], "public"),
    updatedAt: firstString([item.updated_at, item.updatedAt]),
    vpcId: firstString([item.vpc_id, item.router_id]),
  };
}

function parseSnatRule(
  rule: unknown,
  session: HuaweiProjectSession,
): NatSnatRule {
  const item = asRecord(rule);

  return {
    adminStateUp: asBoolean(item.admin_state_up),
    cidr: asString(item.cidr, ""),
    createdAt: firstString([item.created_at, item.createdAt]),
    description: asString(item.description, ""),
    floatingIpAddress: firstString([
      item.floating_ip_address,
      item.global_eip_address,
    ]),
    floatingIpId: firstString([item.floating_ip_id, item.global_eip_id]),
    gatewayId: asString(item.nat_gateway_id),
    globalEipId: asString(item.global_eip_id, ""),
    id: asString(item.id),
    networkId: asString(item.network_id, ""),
    projectId: firstString([item.tenant_id], session.projectId),
    projectName: session.projectName,
    region: session.region,
    sourceType: Number(item.source_type ?? 0),
    status: asString(item.status, "UNKNOWN"),
  };
}

export async function listNatGatewaysForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ nat_gateways?: unknown[] }>(
    session,
    "nat",
    `/v2/${session.projectId}/nat_gateways?limit=1000`,
    {
      items: ["nat_gateways"],
      kind: "marker",
      parameter: "marker",
      size: 1000,
      next: ["page_info.next_marker", "next_marker"],
      fallbackKey: "id",
    },
  );

  return asArray(body.nat_gateways).map((gateway) =>
    parseGateway(gateway, session),
  );
}

export async function listNatGateways(session: BetterUiSession) {
  return loadAcrossProjects(session, listNatGatewaysForProject);
}

export async function listNatSnatRulesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiFetch<{ snat_rules?: unknown[] }>(
    session,
    "nat",
    `/v2/${session.projectId}/snat_rules?limit=2000`,
  );

  return asArray(body.snat_rules).map((rule) => parseSnatRule(rule, session));
}

export async function listNatSnatRules(session: BetterUiSession) {
  return loadAcrossProjects(session, listNatSnatRulesForProject);
}

export async function getNatGateway(
  session: BetterUiSession,
  gatewayId: string,
) {
  const gateways = await listNatGateways(session);

  return gateways.find((gateway) => gateway.id === gatewayId) ?? null;
}

export async function getNatSnatRule(session: BetterUiSession, ruleId: string) {
  const rules = await listNatSnatRules(session);

  return rules.find((rule) => rule.id === ruleId) ?? null;
}

export async function createNatGateway(
  session: BetterUiSession,
  input: CreateNatGatewayInput,
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<{
    nat_gateway?: unknown;
    nat_gateway_id?: string;
    order_id?: string;
  }>(project, "nat", `/v2/${project.projectId}/nat_gateways`, {
    body: JSON.stringify({
      nat_gateway: {
        description: input.description || undefined,
        enterprise_project_id: input.enterpriseProjectId || undefined,
        internal_network_id: input.subnetId,
        name: input.name,
        router_id: input.routerId,
        spec: input.spec,
      },
    }),
    method: "POST",
  });
}

export async function deleteNatGateway(
  session: BetterUiSession,
  gatewayId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, never>>(
    project,
    "nat",
    `/v2/${project.projectId}/nat_gateways/${encodeURIComponent(gatewayId)}`,
    { method: "DELETE" },
  );
}

export async function createNatSnatRule(
  session: BetterUiSession,
  input: CreateNatSnatRuleInput,
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<{ snat_rule?: unknown }>(
    project,
    "nat",
    `/v2/${project.projectId}/snat_rules`,
    {
      body: JSON.stringify({
        snat_rule: {
          cidr: input.cidr || undefined,
          description: input.description || undefined,
          floating_ip_id: input.floatingIpId,
          nat_gateway_id: input.gatewayId,
          network_id: input.networkId || undefined,
          source_type: input.sourceType,
        },
      }),
      method: "POST",
    },
  );
}

export async function deleteNatSnatRule(
  session: BetterUiSession,
  ruleId: string,
  gatewayId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, never>>(
    project,
    "nat",
    `/v2/${project.projectId}/nat_gateways/${encodeURIComponent(gatewayId)}/snat_rules/${encodeURIComponent(ruleId)}`,
    { method: "DELETE" },
  );
}
