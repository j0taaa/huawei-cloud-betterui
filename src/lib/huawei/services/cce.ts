import { mapCloudLoad } from "@/lib/huawei/errors";
import { finishCloudLoad } from "@/lib/huawei/errors";
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
import type { CceCluster } from "@/lib/huawei/services/cce.types";

export type CceNode = {
  availabilityZone: string;
  billingMode: string;
  createdAt: string;
  flavor: string;
  id: string;
  name: string;
  os: string;
  privateIp: string;
  publicIp: string;
  serverId: string;
  status: string;
};

export type CceAddon = {
  alias: string;
  category: string;
  createdAt: string;
  description: string;
  id: string;
  message: string;
  name: string;
  reason: string;
  status: string;
  templateName: string;
  templateType: string;
  updatedAt: string;
  version: string;
};

export type CceClusterDetail = CceCluster & {
  addons: CceAddon[];
  nodes: CceNode[];
};

function asNumber(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function asNumberString(value: unknown, suffix = "") {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return "-";
  }

  return `${number}${suffix}`;
}

function stringsFromArray(value: unknown) {
  return asArray(value)
    .map((item) => asString(item, ""))
    .filter(Boolean);
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;

  return asArray(parsed);
}

function safeJsonArray(value: unknown) {
  try {
    return parseJsonArray(value);
  } catch {
    return [];
  }
}

function parseCluster(
  cluster: unknown,
  session: HuaweiProjectSession,
): CceCluster {
  const item = asRecord(cluster);
  const metadata = asRecord(item.metadata);
  const spec = asRecord(item.spec);
  const status = asRecord(item.status);
  const hostNetwork = asRecord(spec.hostNetwork);
  const containerNetwork = asRecord(spec.containerNetwork);
  const authentication = asRecord(spec.authentication);
  const billingMode = asNumber(spec.billingMode);
  const annotations = asRecord(metadata.annotations);
  const installedAddons = safeJsonArray(
    annotations.installedAddonInstances ??
      annotations["cluster.install.addons.external/install"],
  );
  const nodeCount = asNumber(
    annotations.totalNodesNumber ??
      annotations["cluster.cce.io/node-count"] ??
      status.totalNodesNumber,
  );
  const activeNodes = asNumber(
    annotations.activeNodesNumber ??
      annotations["cluster.cce.io/active-node-count"] ??
      status.activeNodesNumber,
  );

  return {
    activeNodes,
    addOnCount: installedAddons.length,
    alias: asString(metadata.alias),
    authenticationMode: asString(authentication.mode),
    billingMode:
      billingMode === 0
        ? "Pay-per-use"
        : billingMode === 1
          ? "Yearly/Monthly"
          : asString(spec.billingMode),
    containerNetworkCidr: firstString([
      containerNetwork.cidr,
      containerNetwork.cidrs,
    ]),
    containerNetworkMode: asString(containerNetwork.mode),
    createdAt: asString(metadata.creationTimestamp),
    description: asString(spec.description, ""),
    enterpriseProjectId: asString(spec.enterpriseProjectId),
    flavor: firstString([spec.flavor, spec.clusterFlavor, spec.clusterType]),
    id: asString(metadata.uid ?? metadata.id),
    name: asString(metadata.name),
    nodeCount,
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    securityGroupId: asString(hostNetwork.SecurityGroup),
    status: asString(status.phase, "UNKNOWN"),
    subnetId: firstString([hostNetwork.subnet, hostNetwork.subnetID]),
    totalCpu: asNumberString(annotations.totalNodesCPU, " vCPU"),
    totalMemory: asNumberString(annotations.totalNodesMemory, " GiB"),
    type: asString(spec.type),
    updatedAt: asString(metadata.updateTimestamp),
    version: asString(spec.version),
    vpcId: asString(hostNetwork.vpc),
  };
}

export async function listCceClustersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ items?: unknown[] }>(
    session,
    "cce",
    `/api/v3/projects/${session.projectId}/clusters?detail=true`,
  );

  return asArray(body.items).map((cluster) => parseCluster(cluster, session));
}

async function getCceClusterForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const body = await huaweiFetch<unknown>(
    session,
    "cce",
    `/api/v3/projects/${session.projectId}/clusters/${encodeURIComponent(id)}?detail=true`,
  );

  return parseCluster(body, session);
}

function parseNode(node: unknown): CceNode {
  const item = asRecord(node);
  const metadata = asRecord(item.metadata);
  const spec = asRecord(item.spec);
  const status = asRecord(item.status);
  const login = asRecord(spec.login);

  return {
    availabilityZone: asString(spec.az),
    billingMode:
      asNumber(spec.billingMode) === 0
        ? "Pay-per-use"
        : asNumber(spec.billingMode) === 1
          ? "Yearly/Monthly"
          : asString(spec.billingMode),
    createdAt: asString(metadata.creationTimestamp),
    flavor: asString(spec.flavor),
    id: asString(metadata.uid ?? metadata.id),
    name: asString(metadata.name),
    os: firstString([spec.os, login.userPassword?.toString()]),
    privateIp: asString(status.privateIP),
    publicIp: asString(status.publicIP),
    serverId: asString(status.serverId),
    status: asString(status.phase, "UNKNOWN"),
  };
}

export async function listCceNodesForProject(
  session: HuaweiProjectSession,
  clusterId: string,
) {
  const nodes: unknown[] = [];
  let marker = "";

  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ limit: "2000" });

    if (marker) {
      query.set("marker", marker);
    }

    const body = await huaweiFetch<{
      items?: unknown[];
      pageInfo?: { nextMarker?: unknown };
    }>(
      session,
      "cce",
      `/api/v3/projects/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/nodes?${query.toString()}`,
    );
    const pageItems = asArray(body.items);

    nodes.push(...pageItems);

    const nextMarker = asString(asRecord(body.pageInfo).nextMarker, "");

    if (!nextMarker || nextMarker === marker || pageItems.length === 0) {
      break;
    }

    marker = nextMarker;
  }

  return nodes.map(parseNode);
}

function parseAddon(addon: unknown): CceAddon {
  const item = asRecord(addon);
  const metadata = asRecord(item.metadata);
  const spec = asRecord(item.spec);
  const status = asRecord(item.status);
  const currentVersion = asRecord(status.currentVersion);

  return {
    alias: asString(metadata.alias),
    category: stringsFromArray(spec.addonTemplateLabels).join(", ") || "-",
    createdAt: firstString([
      metadata.creationTimestamp,
      currentVersion.creationTimestamp,
    ]),
    description: asString(spec.description, ""),
    id: asString(metadata.uid ?? metadata.id),
    message: asString(status.message, ""),
    name: asString(metadata.name),
    reason: firstString([status.Reason, status.reason], ""),
    status: asString(status.status, "UNKNOWN"),
    templateName: asString(spec.addonTemplateName),
    templateType: asString(spec.addonTemplateType),
    updatedAt: firstString([
      metadata.updateTimestamp,
      currentVersion.updateTimestamp,
    ]),
    version: firstString([spec.version, currentVersion.version]),
  };
}

export async function listCceAddonsForProject(
  session: HuaweiProjectSession,
  clusterId: string,
) {
  const query = new URLSearchParams({ cluster_id: clusterId });
  const body = await huaweiFetch<{ items?: unknown[] }>(
    session,
    "cce",
    `/api/v3/addons?${query.toString()}`,
  );

  return asArray(body.items).map(parseAddon);
}

export async function getCceCluster(
  session: BetterUiSession,
  id: string,
): Promise<CceClusterDetail | null> {
  return mapCloudLoad(
    () => listCceClusters(session),
    async (clusters) => {
      const existing = clusters.find((cluster) => cluster.id === id);

      if (!existing) {
        return null;
      }

      const project = projectForId(session, existing.projectId);
      const [cluster, nodes, addons] = await Promise.allSettled([
        getCceClusterForProject(project, id),
        listCceNodesForProject(project, id),
        listCceAddonsForProject(project, id),
      ]);

      return finishCloudLoad(
        [cluster, nodes, addons],
        {
          ...(cluster.status === "fulfilled" ? cluster.value : existing),
          addons: addons.status === "fulfilled" ? addons.value : [],
          nodes: nodes.status === "fulfilled" ? nodes.value : [],
        },
        ["Cluster", "Nodes", "Addons"],
      );
    },
  );
}

export async function listCceClusters(session: BetterUiSession) {
  return loadAcrossProjects(session, listCceClustersForProject);
}

export type * from "@/lib/huawei/services/cce.types";
