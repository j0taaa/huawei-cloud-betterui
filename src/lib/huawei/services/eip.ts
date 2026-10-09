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

export type EipItem = {
  associatedInstanceId: string;
  associatedInstanceType: string;
  bandwidthChargeMode: string;
  bandwidthId: string;
  bandwidthName: string;
  bandwidthSize: string;
  billingInfo: string;
  createdAt: string;
  description: string;
  enterpriseProjectId: string;
  id: string;
  ipAddress: string;
  ipVersion: string;
  lockStatus: string;
  name: string;
  networkType: string;
  portId: string;
  privateIpAddress: string;
  projectId: string;
  projectName: string;
  publicBorderGroup: string;
  publicIpv6Address: string;
  region: string;
  status: string;
  tags: Array<{ key: string; value: string }>;
  type: string;
  updatedAt: string;
};

function displayValue(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

export async function listEipsForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ publicips?: unknown[] }>(
    session,
    "eip",
    `/v3/${session.projectId}/eip/publicips?limit=2000`,
    {
      items: ["publicips"],
      kind: "marker",
      parameter: "marker",
      size: 2000,
      next: ["page_info.next_marker", "next_marker"],
    },
  );

  return asArray(body.publicips).map((publicIp): EipItem => {
    const item = asRecord(publicIp);
    const bandwidth = asRecord(item.bandwidth);
    const associate = asRecord(item.associate_instance_info);
    const vnic = asRecord(item.vnic);
    const tags = asArray(item.tags)
      .map((tag) => {
        const record = asRecord(tag);

        return {
          key: asString(record.key, ""),
          value: asString(record.value, ""),
        };
      })
      .filter((tag) => tag.key);
    const bandwidthSize =
      displayValue(bandwidth.size, "") || displayValue(item.bandwidth_size, "");

    return {
      associatedInstanceId: firstString(
        [item.associate_instance_id, associate.instance_id],
        "",
      ),
      associatedInstanceType: firstString(
        [item.associate_instance_type, associate.instance_type],
        "",
      ),
      bandwidthChargeMode: firstString(
        [bandwidth.charge_mode, item.bandwidth_charge_mode],
        "-",
      ),
      bandwidthId: firstString([bandwidth.id, item.bandwidth_id], ""),
      bandwidthName: asString(bandwidth.name, "-"),
      bandwidthSize: bandwidthSize ? `${bandwidthSize} Mbit/s` : "-",
      billingInfo: asString(item.billing_info, "-"),
      createdAt: firstString([item.created_at, item.createdAt]),
      description: asString(item.description, ""),
      enterpriseProjectId: asString(item.enterprise_project_id, "-"),
      id: asString(item.id),
      ipAddress: firstString([item.public_ip_address, item.publicip_address]),
      ipVersion: displayValue(item.ip_version),
      lockStatus: asString(item.lock_status, "-"),
      name: firstString([
        item.alias,
        item.name,
        item.public_ip_address,
        item.id,
      ]),
      networkType: asString(item.network_type, "-"),
      portId: firstString([item.port_id, vnic.port_id], ""),
      privateIpAddress: asString(item.private_ip_address, "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      publicBorderGroup: asString(item.public_border_group, "-"),
      publicIpv6Address: asString(item.public_ipv6_address, "-"),
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
      tags,
      type: firstString([item.type, item.ip_version], "-"),
      updatedAt: firstString([item.updated_at, item.updatedAt], "-"),
    };
  });
}

export async function listEips(session: BetterUiSession) {
  return loadAcrossProjects(session, listEipsForProject);
}

export type CreateEipInput = {
  alias?: string;
  bandwidthChargeMode?: "bandwidth" | "traffic";
  bandwidthName?: string;
  bandwidthSize?: number;
  enterpriseProjectId?: string;
  ipAddress?: string;
  ipVersion?: 4 | 6;
  portId?: string;
  projectId?: string;
  shareType?: "PER" | "WHOLE";
  sharedBandwidthId?: string;
  type?: "5_bgp" | "5_sbgp";
};

export async function createEip(
  session: BetterUiSession,
  input: CreateEipInput,
) {
  const project = projectForId(session, input.projectId);
  const shareType = input.shareType ?? "PER";
  const bandwidth: Record<string, unknown> = {
    share_type: shareType,
  };
  const publicip: Record<string, unknown> = {
    ip_version: input.ipVersion ?? 4,
    type: input.type ?? "5_bgp",
  };

  if (input.alias) {
    publicip.alias = input.alias;
  }

  if (input.ipAddress) {
    publicip.ip_address = input.ipAddress;
  }

  if (input.portId) {
    publicip.port_id = input.portId;
  }

  if (shareType === "WHOLE") {
    bandwidth.id = input.sharedBandwidthId;
  } else {
    bandwidth.name = input.bandwidthName;
    bandwidth.size = input.bandwidthSize ?? 5;
  }

  if (input.bandwidthChargeMode) {
    bandwidth.charge_mode = input.bandwidthChargeMode;
  }

  const body: Record<string, unknown> = {
    bandwidth,
    publicip,
  };

  if (input.enterpriseProjectId) {
    body.enterprise_project_id = input.enterpriseProjectId;
  }

  return huaweiFetch<{ publicip?: Record<string, unknown> }>(
    project,
    "eip",
    `/v1/${project.projectId}/publicips`,
    {
      body: JSON.stringify(body),
      method: "POST",
    },
  );
}

export async function releaseEip(
  session: BetterUiSession,
  publicIpId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  return huaweiFetch<Record<string, unknown>>(
    project,
    "eip",
    `/v1/${project.projectId}/publicips/${encodeURIComponent(publicIpId)}`,
    {
      method: "DELETE",
    },
  );
}
