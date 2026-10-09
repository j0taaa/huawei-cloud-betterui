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

const manilaHeaders = {
  Accept: "application/json",
  "X-Openstack-Manila-Api-Version": "2.9",
};

export type SfsShare = {
  availabilityZone: string;
  createdAt: string;
  description: string;
  exportLocation: string;
  host: string;
  id: string;
  isPublic: boolean;
  metadata: Record<string, string>;
  name: string;
  projectId: string;
  projectName: string;
  protocol: string;
  region: string;
  shareType: string;
  sizeGb: number;
  status: string;
  updatedAt: string;
  usedBytes: number;
};

export type SfsAccessRule = {
  accessLevel: string;
  accessTo: string;
  accessType: string;
  createdAt: string;
  id: string;
  state: string;
  updatedAt: string;
};

export type CreateSfsShareInput = {
  availabilityZone?: string;
  description?: string;
  enterpriseProjectId?: string;
  isPublic?: boolean;
  name: string;
  projectId?: string;
  shareType?: string;
  sizeGb: number;
};

export type CreateSfsAccessRuleInput = {
  accessLevel: "ro" | "rw";
  accessTo: string;
  projectId?: string;
  shareId: string;
};

export async function listSfsSharesForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ shares?: unknown[] }>(
    session,
    "sfs",
    `/v2/${session.projectId}/shares/detail?limit=100`,
    {
      items: ["shares"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count", "total", "data.total", "result.total"],
    },
    {
      headers: manilaHeaders,
    },
  );

  return asArray(body.shares).map((share): SfsShare => {
    const item = asRecord(share);
    const metadata = asRecord(item.metadata);
    const exportLocations = asArray(item.export_locations);
    const firstExport = asRecord(exportLocations[0]);
    const sizeGb = Number(item.size ?? 0);

    return {
      availabilityZone: asString(item.availability_zone),
      createdAt: firstString([item.created_at, item.createdAt]),
      description: firstString([item.description], ""),
      exportLocation: firstString(
        [item.export_location, firstExport.path, firstExport.export_location],
        "-",
      ),
      host: firstString([item.host], "-"),
      id: asString(item.id),
      isPublic: item.is_public === true,
      metadata: Object.fromEntries(
        Object.entries(metadata).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : [],
        ),
      ),
      name: firstString([item.name, item.id]),
      projectId: session.projectId,
      projectName: session.projectName,
      protocol: asString(item.share_proto),
      region: session.region,
      shareType: firstString([item.share_type, item.share_type_name]),
      sizeGb: Number.isFinite(sizeGb) ? sizeGb : 0,
      status: asString(item.status, "UNKNOWN"),
      updatedAt: firstString([item.updated_at, item.updatedAt], "-"),
      usedBytes: Number(metadata.share_used ?? 0) || 0,
    };
  });
}

export async function listSfsShares(session: BetterUiSession) {
  return loadAcrossProjects(session, listSfsSharesForProject);
}

export async function getSfsShare(
  session: BetterUiSession,
  id: string,
  projectId?: string,
) {
  const shares = await listSfsShares(session);

  return shares.find(
    (share) => share.id === id && (!projectId || share.projectId === projectId),
  );
}

export async function createSfsShare(
  session: BetterUiSession,
  input: CreateSfsShareInput,
) {
  const project = projectForId(session, input.projectId);
  const metadata: Record<string, string> = {};

  if (input.enterpriseProjectId) {
    metadata.enterprise_project_id = input.enterpriseProjectId;
  }

  const share: Record<string, unknown> = {
    description: input.description || undefined,
    is_public: input.isPublic ?? false,
    name: input.name,
    share_network_id: null,
    share_proto: "NFS",
    size: input.sizeGb,
  };

  if (input.availabilityZone) {
    share.availability_zone = input.availabilityZone;
  }

  if (input.shareType) {
    share.share_type = input.shareType;
  }

  if (Object.keys(metadata).length) {
    share.metadata = metadata;
  }

  return huaweiFetch<{ share?: unknown }>(
    project,
    "sfs",
    `/v2/${project.projectId}/shares`,
    {
      body: JSON.stringify({ share }),
      headers: manilaHeaders,
      method: "POST",
    },
  );
}

export async function deleteSfsShare(
  session: BetterUiSession,
  id: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, never>>(
    project,
    "sfs",
    `/v2/${project.projectId}/shares/${encodeURIComponent(id)}`,
    {
      headers: manilaHeaders,
      method: "DELETE",
    },
  );
}

export async function listSfsAccessRules(
  session: BetterUiSession,
  shareId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);
  const body = await huaweiFetch<{ access_list?: unknown[] }>(
    project,
    "sfs",
    `/v2/${project.projectId}/shares/${encodeURIComponent(shareId)}/action`,
    {
      body: JSON.stringify({ "os-access_list": null }),
      headers: manilaHeaders,
      method: "POST",
    },
  );

  return asArray(body.access_list).map((rule): SfsAccessRule => {
    const item = asRecord(rule);

    return {
      accessLevel: asString(item.access_level),
      accessTo: asString(item.access_to),
      accessType: asString(item.access_type),
      createdAt: firstString([item.created_at], "-"),
      id: asString(item.id),
      state: asString(item.state, "UNKNOWN"),
      updatedAt: firstString([item.updated_at], "-"),
    };
  });
}

export async function createSfsAccessRule(
  session: BetterUiSession,
  input: CreateSfsAccessRuleInput,
) {
  const project = projectForId(session, input.projectId);

  return huaweiFetch<{ access?: unknown }>(
    project,
    "sfs",
    `/v2/${project.projectId}/shares/${encodeURIComponent(input.shareId)}/action?vpc_ip_base_acl=enable`,
    {
      body: JSON.stringify({
        "os-allow_access": {
          access_level: input.accessLevel,
          access_to: input.accessTo,
          access_type: "cert",
        },
      }),
      headers: manilaHeaders,
      method: "POST",
    },
  );
}

export async function deleteSfsAccessRule(
  session: BetterUiSession,
  shareId: string,
  ruleId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, never>>(
    project,
    "sfs",
    `/v2/${project.projectId}/shares/${encodeURIComponent(shareId)}/action`,
    {
      body: JSON.stringify({
        "os-deny_access": {
          access_id: ruleId,
        },
      }),
      headers: manilaHeaders,
      method: "POST",
    },
  );
}
