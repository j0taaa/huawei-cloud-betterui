import { mapCloudLoad } from "@/lib/huawei/errors";
import { finishCloudLoad } from "@/lib/huawei/errors";
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

export type ElbBackendMember = {
  address: string;
  id: string;
  name: string;
  operatingStatus: string;
  protocolPort: string;
  provisioningStatus: string;
  weight: string;
};

export type ElbHealthMonitor = {
  delay: string;
  expectedCodes: string;
  id: string;
  maxRetries: string;
  name: string;
  timeout: string;
  type: string;
};

export type ElbBackendPool = {
  algorithm: string;
  healthMonitor: ElbHealthMonitor | null;
  id: string;
  members: ElbBackendMember[];
  name: string;
  operatingStatus: string;
  protocol: string;
  provisioningStatus: string;
};

export type ElbListener = {
  adminStateUp: boolean | null;
  connectionLimit: string;
  defaultPoolId: string;
  id: string;
  name: string;
  operatingStatus: string;
  protocol: string;
  protocolPort: string;
  provisioningStatus: string;
};

export type ElbItem = {
  adminStateUp: boolean | null;
  availabilityZones: string[];
  backendPoolCount: number;
  createdAt: string;
  description: string;
  eips: string[];
  enterpriseProjectId: string;
  flavor: string;
  id: string;
  ipVersion: string;
  listenerCount: number;
  name: string;
  operatingStatus: string;
  provider: string;
  projectId: string;
  projectName: string;
  provisioningStatus: string;
  region: string;
  updatedAt: string;
  vipAddress: string;
  vipPortId: string;
  vipSubnetCidrId: string;
};

export type ElbDetail = ElbItem & {
  backendPools: ElbBackendPool[];
  listeners: ElbListener[];
};

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function asCount(value: unknown) {
  return asArray(value).length;
}

function asNumberString(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number) ? String(number) : "-";
}

function idsFromRefs(value: unknown) {
  return asArray(value)
    .map((item) => firstString([asRecord(item).id], ""))
    .filter(Boolean);
}

function stringsFromArray(value: unknown) {
  return asArray(value)
    .map((item) => asString(item, ""))
    .filter(Boolean);
}

function eipsFromLoadBalancer(item: Record<string, unknown>) {
  const eips = asArray(item.publicips).flatMap((publicIp) => {
    const record = asRecord(publicIp);
    return [record.publicip_address, record.ip_address, record.eip_address];
  });

  return eips.map((value) => asString(value, "")).filter(Boolean);
}

function parseLoadBalancer(
  loadBalancer: unknown,
  session: HuaweiProjectSession,
): ElbItem {
  const item = asRecord(loadBalancer);
  const listeners = idsFromRefs(item.listeners);
  const pools = idsFromRefs(item.pools);
  const flavor = asRecord(item.flavor);
  const l4Flavor = asRecord(item.l4_flavor);
  const l7Flavor = asRecord(item.l7_flavor);

  return {
    adminStateUp: asBoolean(item.admin_state_up),
    availabilityZones: stringsFromArray(item.availability_zone_list),
    backendPoolCount: pools.length || asCount(item.pools),
    createdAt: firstString([item.created_at, item.created], "-"),
    description: asString(item.description),
    eips: eipsFromLoadBalancer(item),
    enterpriseProjectId: asString(item.enterprise_project_id),
    flavor: firstString([
      flavor.name,
      flavor.id,
      l4Flavor.name,
      l4Flavor.id,
      l7Flavor.name,
      l7Flavor.id,
    ]),
    id: asString(item.id),
    ipVersion: asNumberString(item.ip_version),
    listenerCount: listeners.length || asCount(item.listeners),
    name: asString(item.name),
    operatingStatus: asString(item.operating_status, "UNKNOWN"),
    projectId: session.projectId,
    projectName: session.projectName,
    provider: asString(item.provider),
    provisioningStatus: asString(item.provisioning_status, "UNKNOWN"),
    region: session.region,
    updatedAt: firstString([item.updated_at, item.updated], "-"),
    vipAddress: asString(item.vip_address),
    vipPortId: asString(item.vip_port_id),
    vipSubnetCidrId: asString(item.vip_subnet_cidr_id),
  };
}

export async function listElbsForProject(session: HuaweiProjectSession) {
  const loadBalancers: unknown[] = [];
  let marker: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ limit: "100" });

    if (marker) {
      query.set("marker", marker);
    }

    const body = await huaweiList<{
      loadbalancers?: unknown[];
      page_info?: { next_marker?: unknown };
    }>(
      session,
      "elb",
      `/v3/${session.projectId}/elb/loadbalancers?${query.toString()}`,
      {
        items: ["loadbalancers"],
        kind: "marker",
        parameter: "marker",
        size: 100,
        next: ["page_info.next_marker", "next_marker"],
      },
    );
    const pageItems = asArray(body.loadbalancers);

    loadBalancers.push(...pageItems);

    const nextMarker = asString(asRecord(body.page_info).next_marker, "");

    if (!nextMarker || nextMarker === marker || pageItems.length === 0) {
      break;
    }

    marker = nextMarker;
  }

  return loadBalancers.map((loadBalancer) =>
    parseLoadBalancer(loadBalancer, session),
  );
}

function parseHealthMonitor(value: unknown): ElbHealthMonitor | null {
  const item = asRecord(value);
  const id = asString(item.id, "");

  if (!id && !Object.keys(item).length) {
    return null;
  }

  return {
    delay: asNumberString(item.delay),
    expectedCodes: asString(item.expected_codes),
    id: asString(item.id),
    maxRetries: asNumberString(item.max_retries),
    name: asString(item.name),
    timeout: asNumberString(item.timeout),
    type: asString(item.type),
  };
}

function parseBackendMember(value: unknown): ElbBackendMember {
  const item = asRecord(value);

  return {
    address: asString(item.address),
    id: asString(item.id),
    name: asString(item.name),
    operatingStatus: asString(item.operating_status, "UNKNOWN"),
    protocolPort: asNumberString(item.protocol_port),
    provisioningStatus: asString(item.provisioning_status, "UNKNOWN"),
    weight: asNumberString(item.weight),
  };
}

function parseBackendPool(value: unknown): ElbBackendPool {
  const item = asRecord(value);

  return {
    algorithm: asString(item.lb_algorithm),
    healthMonitor: parseHealthMonitor(
      item.healthmonitor ?? item.health_monitor,
    ),
    id: asString(item.id),
    members: asArray(item.members).map(parseBackendMember),
    name: asString(item.name),
    operatingStatus: asString(item.operating_status, "UNKNOWN"),
    protocol: asString(item.protocol),
    provisioningStatus: asString(item.provisioning_status, "UNKNOWN"),
  };
}

function parseListener(value: unknown): ElbListener {
  const item = asRecord(value);

  return {
    adminStateUp: asBoolean(item.admin_state_up),
    connectionLimit: asNumberString(item.connection_limit),
    defaultPoolId: asString(item.default_pool_id),
    id: asString(item.id),
    name: asString(item.name),
    operatingStatus: asString(item.operating_status, "UNKNOWN"),
    protocol: asString(item.protocol),
    protocolPort: asNumberString(item.protocol_port),
    provisioningStatus: asString(item.provisioning_status, "UNKNOWN"),
  };
}

function mergeListeners(
  statusListeners: ElbListener[],
  apiListeners: ElbListener[],
) {
  const merged = new Map(
    statusListeners.map((listener) => [listener.id, listener]),
  );
  const preferKnown = (current: string | undefined, fallback: string) =>
    current && current !== "-" ? current : fallback;

  for (const apiListener of apiListeners) {
    const current = merged.get(apiListener.id);

    merged.set(apiListener.id, {
      ...apiListener,
      ...current,
      adminStateUp: current?.adminStateUp ?? apiListener.adminStateUp,
      connectionLimit: preferKnown(
        current?.connectionLimit,
        apiListener.connectionLimit,
      ),
      defaultPoolId: preferKnown(
        current?.defaultPoolId,
        apiListener.defaultPoolId,
      ),
      protocol: preferKnown(current?.protocol, apiListener.protocol),
      protocolPort: preferKnown(
        current?.protocolPort,
        apiListener.protocolPort,
      ),
    });
  }

  return Array.from(merged.values()).filter((listener) => listener.id !== "-");
}

async function getLoadBalancerStatus(
  session: HuaweiProjectSession,
  id: string,
) {
  const body = await huaweiFetch<{ statuses?: unknown }>(
    session,
    "elb",
    `/v3/${session.projectId}/elb/loadbalancers/${id}/statuses`,
  );
  const loadBalancer = asRecord(asRecord(body.statuses).loadbalancer);
  const listeners = asArray(loadBalancer.listeners);

  return {
    backendPools: listeners.flatMap((listener) =>
      asArray(asRecord(listener).pools).map(parseBackendPool),
    ),
    listeners: listeners.map(parseListener),
  };
}

async function listListenersForLoadBalancer(
  session: HuaweiProjectSession,
  id: string,
) {
  const query = new URLSearchParams({ limit: "100", loadbalancer_id: id });
  const body = await huaweiFetch<{ listeners?: unknown[] }>(
    session,
    "elb",
    `/v3/${session.projectId}/elb/listeners?${query.toString()}`,
  );

  return asArray(body.listeners).map(parseListener);
}

async function showLoadBalancer(session: HuaweiProjectSession, id: string) {
  const body = await huaweiFetch<{ loadbalancer?: unknown }>(
    session,
    "elb",
    `/v3/${session.projectId}/elb/loadbalancers/${id}`,
  );

  return parseLoadBalancer(body.loadbalancer, session);
}

export async function getElb(session: BetterUiSession, id: string) {
  return mapCloudLoad(
    () => listElbs(session),
    async (elbs) => {
      const summary = elbs.find((elb) => elb.id === id);

      if (!summary) {
        return null;
      }

      const project = projectForId(session, summary.projectId);
      const [loadBalancerResult, statusResult, listenersResult] =
        await Promise.allSettled([
          showLoadBalancer(project, id),
          getLoadBalancerStatus(project, id),
          listListenersForLoadBalancer(project, id),
        ]);
      const loadBalancer =
        loadBalancerResult.status === "fulfilled"
          ? loadBalancerResult.value
          : summary;
      const status =
        statusResult.status === "fulfilled"
          ? statusResult.value
          : { backendPools: [], listeners: [] };
      const apiListeners =
        listenersResult.status === "fulfilled" ? listenersResult.value : [];

      return finishCloudLoad(
        [loadBalancerResult, statusResult, listenersResult],
        {
          ...summary,
          ...loadBalancer,
          backendPools: status.backendPools,
          backendPoolCount:
            status.backendPools.length ||
            loadBalancer.backendPoolCount ||
            summary.backendPoolCount,
          listenerCount:
            status.listeners.length ||
            apiListeners.length ||
            loadBalancer.listenerCount,
          listeners: mergeListeners(status.listeners, apiListeners),
        } satisfies ElbDetail,
        ["Load balancer", "Status", "Listeners"],
      );
    },
  );
}

export async function listElbs(session: BetterUiSession) {
  return loadAcrossProjects(session, listElbsForProject);
}
