import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type EnterpriseRouter = {
  asn: string;
  autoAcceptSharedAttachments: string;
  createdAt: string;
  defaultAssociation: string;
  defaultPropagation: string;
  description: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  routeTableId: string;
  status: string;
  updatedAt: string;
};

export async function listEnterpriseRoutersForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{ instances?: unknown[] }>(
    session,
    "er",
    `/v3/${session.projectId}/enterprise-router/instances?limit=2000`,
    {
      items: ["instances"],
      kind: "marker",
      parameter: "marker",
      size: 2000,
      next: ["page_info.next_marker", "next_marker"],
    },
  );

  return asArray(body.instances).map((router): EnterpriseRouter => {
    const item = asRecord(router);

    return {
      asn: String(item.asn ?? "-"),
      autoAcceptSharedAttachments: String(
        item.auto_accept_shared_attachments ?? "-",
      ),
      createdAt: firstString([item.created_at, item.createdAt]),
      defaultAssociation: String(item.enable_default_association ?? "-"),
      defaultPropagation: String(item.enable_default_propagation ?? "-"),
      description: asString(item.description, ""),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      routeTableId: firstString(
        [
          item.default_association_route_table_id,
          item.default_propagation_route_table_id,
        ],
        "-",
      ),
      status: firstString([item.state, item.status], "UNKNOWN"),
      updatedAt: firstString([
        item.updated_at,
        item.created_at,
        item.createdAt,
      ]),
    };
  });
}

export async function listEnterpriseRouters(session: BetterUiSession) {
  return loadAcrossProjects(session, listEnterpriseRoutersForProject);
}
