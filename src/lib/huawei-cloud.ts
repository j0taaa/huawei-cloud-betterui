import "server-only";

import { getCurrentSession, type BetterUiSession } from "@/lib/auth-session";

type ServiceKey = "cce" | "ecs" | "elb" | "evs" | "rds" | "vpc";

export type CloudResult<T> =
  | { data: T; error: null; updatedAt: string }
  | { data: T; error: string; updatedAt: string };

export type CloudSummary = {
  cceClusters: number;
  ecsInstances: number;
  ecsRunning: number;
  elbLoadBalancers: number;
  errors: string[];
  evsDisks: number;
  rdsInstances: number;
  securityGroups: number;
  subnets: number;
  vpcs: number;
};

export type EcsInstance = {
  availabilityZone: string;
  createdAt: string;
  flavor: string;
  id: string;
  image: string;
  name: string;
  privateIp: string;
  publicIp: string;
  status: string;
};

export type EvsDisk = {
  availabilityZone: string;
  attachedTo: string;
  createdAt: string;
  id: string;
  name: string;
  size: string;
  status: string;
  type: string;
};

export type VpcItem = {
  cidr: string;
  id: string;
  name: string;
  status: string;
};

export type SubnetItem = {
  cidr: string;
  gateway: string;
  id: string;
  name: string;
  status: string;
  vpcId: string;
};

export type SecurityGroupItem = {
  description: string;
  id: string;
  name: string;
  rules: number;
};

export type ElbItem = {
  id: string;
  name: string;
  operatingStatus: string;
  provisioningStatus: string;
  vipAddress: string;
};

export type CceCluster = {
  id: string;
  name: string;
  status: string;
  type: string;
  version: string;
};

export type RdsInstance = {
  datastore: string;
  id: string;
  name: string;
  privateIp: string;
  status: string;
  type: string;
};

const emptySummary: CloudSummary = {
  cceClusters: 0,
  ecsInstances: 0,
  ecsRunning: 0,
  elbLoadBalancers: 0,
  errors: [],
  evsDisks: 0,
  rdsInstances: 0,
  securityGroups: 0,
  subnets: 0,
  vpcs: 0,
};

const endpointEnv: Record<ServiceKey, string> = {
  cce: "HUAWEI_CCE_ENDPOINT",
  ecs: "HUAWEI_ECS_ENDPOINT",
  elb: "HUAWEI_ELB_ENDPOINT",
  evs: "HUAWEI_EVS_ENDPOINT",
  rds: "HUAWEI_RDS_ENDPOINT",
  vpc: "HUAWEI_VPC_ENDPOINT",
};

function serviceEndpoint(service: ServiceKey, region: string) {
  return (
    process.env[endpointEnv[service]] ??
    `https://${service}.${region}.myhuaweicloud.com`
  ).replace(/\/+$/, "");
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function firstString(values: unknown[], fallback = "-") {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return fallback;
}

function firstIp(addresses: unknown, kind: "private" | "public") {
  const pools = Object.values(asRecord(addresses));

  for (const pool of pools) {
    for (const address of asArray(pool)) {
      const item = asRecord(address);
      const osType = item["OS-EXT-IPS:type"];
      const ip = item.addr;

      if (
        typeof ip === "string" &&
        ((kind === "private" && osType === "fixed") ||
          (kind === "public" && osType === "floating"))
      ) {
        return ip;
      }
    }
  }

  return "-";
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Huawei Cloud API request failed.";
}

async function parseError(response: Response) {
  const body = (await response.json().catch(() => null)) as unknown;
  const record = asRecord(body);
  const error = asRecord(record.error ?? record.Error);
  const message = firstString(
    [
      error.message,
      error.error_msg,
      record.message,
      record.error_msg,
      response.statusText,
    ],
    "Huawei Cloud API request failed.",
  );

  return `${response.status} ${message}`;
}

async function huaweiFetch<T>(
  session: BetterUiSession,
  service: ServiceKey,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(
    `${serviceEndpoint(service, session.region)}${path}`,
    {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json;charset=utf8",
        "X-Auth-Token": session.token,
        ...init?.headers,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json().catch(() => ({}))) as T;
}

export async function withCloudResult<T>(
  fallback: T,
  loader: (session: BetterUiSession) => Promise<T>,
): Promise<CloudResult<T>> {
  const updatedAt = new Date().toISOString();
  const session = await getCurrentSession();

  if (!session) {
    return { data: fallback, error: "Not signed in.", updatedAt };
  }

  try {
    return { data: await loader(session), error: null, updatedAt };
  } catch (error) {
    return { data: fallback, error: normalizeError(error), updatedAt };
  }
}

export async function listEcsInstances(session: BetterUiSession) {
  const body = await huaweiFetch<{ servers?: unknown[] }>(
    session,
    "ecs",
    `/v1/${session.projectId}/cloudservers/detail?limit=100`,
  );

  return asArray(body.servers).map((server): EcsInstance => {
    const item = asRecord(server);
    const flavor = asRecord(item.flavor);
    const image = asRecord(item.image);

    return {
      availabilityZone: firstString([
        item["OS-EXT-AZ:availability_zone"],
        item.availability_zone,
      ]),
      createdAt: asString(item.created, "-"),
      flavor: firstString([flavor.name, flavor.id]),
      id: asString(item.id),
      image: firstString([image.name, image.id]),
      name: asString(item.name),
      privateIp: firstIp(item.addresses, "private"),
      publicIp: firstIp(item.addresses, "public"),
      status: asString(item.status, "UNKNOWN"),
    };
  });
}

export async function getEcsInstance(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<{ server?: unknown }>(
    session,
    "ecs",
    `/v1/${session.projectId}/cloudservers/${id}`,
  );

  const [server] = asArray(body.server ? [body.server] : []);
  return server ? listEcsInstancesFromRaw([server])[0] : null;
}

function listEcsInstancesFromRaw(servers: unknown[]) {
  return servers.map((server): EcsInstance => {
    const item = asRecord(server);
    const flavor = asRecord(item.flavor);
    const image = asRecord(item.image);

    return {
      availabilityZone: firstString([
        item["OS-EXT-AZ:availability_zone"],
        item.availability_zone,
      ]),
      createdAt: asString(item.created, "-"),
      flavor: firstString([flavor.name, flavor.id]),
      id: asString(item.id),
      image: firstString([image.name, image.id]),
      name: asString(item.name),
      privateIp: firstIp(item.addresses, "private"),
      publicIp: firstIp(item.addresses, "public"),
      status: asString(item.status, "UNKNOWN"),
    };
  });
}

export async function runEcsAction(
  session: BetterUiSession,
  id: string,
  action: "restart" | "start" | "stop",
) {
  const payload =
    action === "start"
      ? { "os-start": { servers: [{ id }] } }
      : action === "stop"
        ? { "os-stop": { servers: [{ id }], type: "SOFT" } }
        : { reboot: { servers: [{ id }], type: "SOFT" } };

  return huaweiFetch<{ job_id?: string }>(
    session,
    "ecs",
    `/v1/${session.projectId}/cloudservers/action`,
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
  );
}

export async function listEvsDisks(session: BetterUiSession) {
  const body = await huaweiFetch<{ cloudvolumes?: unknown[]; volumes?: unknown[] }>(
    session,
    "evs",
    `/v2/${session.projectId}/cloudvolumes/detail?limit=100`,
  );

  return asArray(body.cloudvolumes ?? body.volumes).map((volume): EvsDisk => {
    const item = asRecord(volume);
    const attachments = asArray(item.attachments);
    const firstAttachment = asRecord(attachments[0]);
    return {
      attachedTo: firstString([firstAttachment.server_id, firstAttachment.device]),
      availabilityZone: asString(item.availability_zone),
      createdAt: asString(item.created_at),
      id: asString(item.id),
      name: firstString([item.name, item.id]),
      size: `${Number(item.size ?? 0)} GB`,
      status: asString(item.status, "UNKNOWN"),
      type: asString(item.volume_type),
    };
  });
}

export async function getEvsDisk(session: BetterUiSession, id: string) {
  const disks = await listEvsDisks(session);
  return disks.find((disk) => disk.id === id) ?? null;
}

export async function listVpcs(session: BetterUiSession) {
  const body = await huaweiFetch<{ vpcs?: unknown[] }>(
    session,
    "vpc",
    `/v3/${session.projectId}/vpc/vpcs?limit=200`,
  );

  return asArray(body.vpcs).map((vpc): VpcItem => {
    const item = asRecord(vpc);
    return {
      cidr: firstString([item.cidr, item.cidr_v4]),
      id: asString(item.id),
      name: asString(item.name),
      status: asString(item.status, "ACTIVE"),
    };
  });
}

export async function listSubnets(session: BetterUiSession) {
  const body = await huaweiFetch<{ subnets?: unknown[] }>(
    session,
    "vpc",
    `/v1/${session.projectId}/subnets?limit=200`,
  );

  return asArray(body.subnets).map((subnet): SubnetItem => {
    const item = asRecord(subnet);
    return {
      cidr: asString(item.cidr),
      gateway: asString(item.gateway_ip),
      id: asString(item.id),
      name: asString(item.name),
      status: asString(item.status, "ACTIVE"),
      vpcId: asString(item.vpc_id),
    };
  });
}

export async function listSecurityGroups(session: BetterUiSession) {
  const body = await huaweiFetch<{ security_groups?: unknown[] }>(
    session,
    "vpc",
    `/v3/${session.projectId}/vpc/security-groups?limit=200`,
  );

  return asArray(body.security_groups).map((group): SecurityGroupItem => {
    const item = asRecord(group);
    return {
      description: asString(item.description, ""),
      id: asString(item.id),
      name: asString(item.name),
      rules: asArray(item.security_group_rules).length,
    };
  });
}

export async function listElbs(session: BetterUiSession) {
  const body = await huaweiFetch<{ loadbalancers?: unknown[] }>(
    session,
    "elb",
    `/v3/${session.projectId}/elb/loadbalancers?limit=100`,
  );

  return asArray(body.loadbalancers).map((loadBalancer): ElbItem => {
    const item = asRecord(loadBalancer);
    return {
      id: asString(item.id),
      name: asString(item.name),
      operatingStatus: asString(item.operating_status, "UNKNOWN"),
      provisioningStatus: asString(item.provisioning_status, "UNKNOWN"),
      vipAddress: asString(item.vip_address),
    };
  });
}

export async function getElb(session: BetterUiSession, id: string) {
  const elbs = await listElbs(session);
  return elbs.find((elb) => elb.id === id) ?? null;
}

export async function listCceClusters(session: BetterUiSession) {
  const body = await huaweiFetch<{ items?: unknown[] }>(
    session,
    "cce",
    `/api/v3/projects/${session.projectId}/clusters`,
  );

  return asArray(body.items).map((cluster): CceCluster => {
    const item = asRecord(cluster);
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    return {
      id: asString(metadata.uid ?? metadata.id),
      name: asString(metadata.name),
      status: asString(status.phase, "UNKNOWN"),
      type: asString(spec.type),
      version: asString(spec.version),
    };
  });
}

export async function getCceCluster(session: BetterUiSession, id: string) {
  const clusters = await listCceClusters(session);
  return clusters.find((cluster) => cluster.id === id) ?? null;
}

export async function listRdsInstances(session: BetterUiSession) {
  const body = await huaweiFetch<{ instances?: unknown[] }>(
    session,
    "rds",
    `/v3/${session.projectId}/instances?limit=100`,
  );

  return asArray(body.instances).map((instance): RdsInstance => {
    const item = asRecord(instance);
    const datastore = asRecord(item.datastore);
    return {
      datastore: firstString([datastore.type, item.datastore_type]),
      id: asString(item.id),
      name: asString(item.name),
      privateIp: firstString(asArray(item.private_ips), "-"),
      status: asString(item.status, "UNKNOWN"),
      type: asString(item.type),
    };
  });
}

export async function getRdsInstance(session: BetterUiSession, id: string) {
  const instances = await listRdsInstances(session);
  return instances.find((instance) => instance.id === id) ?? null;
}

export async function loadCloudSummary() {
  return withCloudResult(emptySummary, async (session) => {
    const [ecs, evs, vpcs, subnets, securityGroups, elbs, cce, rds] =
      await Promise.allSettled([
        listEcsInstances(session),
        listEvsDisks(session),
        listVpcs(session),
        listSubnets(session),
        listSecurityGroups(session),
        listElbs(session),
        listCceClusters(session),
        listRdsInstances(session),
      ]);

    const errors = [
      ecs,
      evs,
      vpcs,
      subnets,
      securityGroups,
      elbs,
      cce,
      rds,
    ]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => normalizeError(result.reason));

    const ecsData = ecs.status === "fulfilled" ? ecs.value : [];

    return {
      cceClusters: cce.status === "fulfilled" ? cce.value.length : 0,
      ecsInstances: ecsData.length,
      ecsRunning: ecsData.filter((instance) => instance.status === "ACTIVE").length,
      elbLoadBalancers: elbs.status === "fulfilled" ? elbs.value.length : 0,
      errors,
      evsDisks: evs.status === "fulfilled" ? evs.value.length : 0,
      rdsInstances: rds.status === "fulfilled" ? rds.value.length : 0,
      securityGroups:
        securityGroups.status === "fulfilled" ? securityGroups.value.length : 0,
      subnets: subnets.status === "fulfilled" ? subnets.value.length : 0,
      vpcs: vpcs.status === "fulfilled" ? vpcs.value.length : 0,
    };
  });
}
