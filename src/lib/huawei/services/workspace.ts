import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";
import { workspaceManagement } from "@/lib/huawei/management/adapters/workspace";

export type WorkspaceTenant = {
  accessMode: string;
  configStatus: string;
  desktopSecurityGroup: string;
  enterpriseId: string;
  id: string;
  internetAccessAddress: string;
  isGlobal: boolean | null;
  managementSubnetCidr: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  subnetCount: number;
  vpcId: string;
  vpcName: string;
};

export async function listWorkspaceTenantsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiFetch<Record<string, unknown>>(
    session,
    "workspace",
    `/v2/${session.projectId}/workspaces`,
  );
  const subnets = asArray(body.subnet_ids ?? body.subnets);
  const desktopSecurityGroup = asRecord(body.desktop_security_group);

  return [
    {
      accessMode: firstString([body.access_mode], "-"),
      configStatus: String(body.config_status ?? "-"),
      desktopSecurityGroup: firstString(
        [desktopSecurityGroup.name, desktopSecurityGroup.id],
        "-",
      ),
      enterpriseId: asString(body.enterprise_id, "-"),
      id: firstString([body.id, body.enterprise_id, session.projectId]),
      internetAccessAddress: firstString(
        [body.internet_access_address, body.dedicated_access_address],
        "-",
      ),
      isGlobal: typeof body.is_global === "boolean" ? body.is_global : null,
      managementSubnetCidr: asString(body.management_subnet_cidr, "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: firstString([body.status, body.config_status], "UNKNOWN"),
      subnetCount: subnets.length,
      vpcId: asString(body.vpc_id, "-"),
      vpcName: asString(body.vpc_name, "-"),
    } satisfies WorkspaceTenant,
  ];
}

export async function listWorkspaceTenants(session: BetterUiSession) {
  return loadAcrossProjects(session, listWorkspaceTenantsForProject);
}

/** Load complete native desktop/user/pool inventory separately for each selected project. */
export async function listWorkspaceResources(session: BetterUiSession) {
  return loadAcrossProjects(session, async project => (await workspaceManagement.inventory({ ...session, ...project, projects: [project] })).map(resource => ({ ...resource, projectId: project.projectId, projectName: project.projectName, region: project.region })));
}
