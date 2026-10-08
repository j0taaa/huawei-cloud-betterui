import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type HssHost = {
  agentStatus: string;
  baselineRiskCount: number;
  detectResult: string;
  groupName: string;
  id: string;
  intrusionCount: number;
  name: string;
  os: string;
  policyGroupName: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  publicIp: string;
  region: string;
  riskCount: number;
  version: string;
  vulnerabilityCount: number;
};

export async function listHssHostsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ data_list?: unknown[]; hosts?: unknown[] }>(
    session,
    "hss",
    `/v5/${session.projectId}/host-management/hosts?limit=100`,
    {
      items: ["data_list", "hosts"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
  );

  return asArray(body.data_list ?? body.hosts).map((host): HssHost => {
    const item = asRecord(host);
    const asset = asRecord(item.asset_info);
    const risk = asRecord(item.risk_info);
    const agent = asRecord(item.agent_info);

    return {
      agentStatus: firstString(
        [item.agent_status, agent.agent_status, agent.status],
        "UNKNOWN",
      ),
      baselineRiskCount: Number(
        item.baseline_num ?? risk.baseline_num ?? risk.baseline_risk_count ?? 0,
      ),
      detectResult: firstString(
        [item.detect_result, item.risk_status, risk.detect_result],
        "-",
      ),
      groupName: firstString([item.group_name, asset.group_name], "-"),
      id: firstString([item.host_id, item.id, item.server_id]),
      intrusionCount: Number(
        item.intrusion_num ?? risk.intrusion_num ?? risk.intrusion_count ?? 0,
      ),
      name: firstString([item.host_name, item.name, item.server_name, item.id]),
      os: firstString([item.os_type, item.os_name, asset.os], "-"),
      policyGroupName: firstString(
        [item.policy_group_name, item.policy_name],
        "-",
      ),
      privateIp: firstString(
        [item.private_ip, item.private_ip_address, asset.private_ip],
        "-",
      ),
      projectId: session.projectId,
      projectName: session.projectName,
      publicIp: firstString(
        [item.public_ip, item.public_ip_address, asset.public_ip],
        "-",
      ),
      region: session.region,
      riskCount: Number(item.risk_num ?? risk.risk_num ?? risk.risk_count ?? 0),
      version: firstString([item.version, item.edition, agent.version], "-"),
      vulnerabilityCount: Number(
        item.vul_num ?? item.vulnerability_num ?? risk.vul_num ?? 0,
      ),
    };
  });
}

export async function listHssHosts(session: BetterUiSession) {
  return loadAcrossProjects(session, listHssHostsForProject);
}
