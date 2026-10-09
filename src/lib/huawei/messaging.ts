import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "./http";
import { asArray, asRecord, firstString } from "./parsers";
import { sessionProjects } from "./projects";

export type MessagingEngine = "rabbitmq" | "rocketmq";
export type MessagingInstance = {
  id: string;
  name: string;
  engineVersion: string;
  status: string;
  specification: string;
  brokerCount: number | null;
  storageGb: number | null;
  usedStorageGb: number | null;
  privateAddress: string;
  publicAddress: string;
  grpcAddress: string;
  brokerAddress: string;
  publicBrokerAddress: string;
  publicAccess: boolean | null;
  sslEnabled: boolean | null;
  vpcId: string;
  vpcName: string;
  subnetId: string;
  securityGroupId: string;
  enterpriseProjectId: string;
  availabilityZones: string[];
  description: string;
  projectId: string;
  projectName: string;
  region: string;
};

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseInstance(
  value: unknown,
  session: HuaweiProjectSession,
  engine: MessagingEngine,
): MessagingInstance {
  const item = asRecord(value);
  const id = firstString([item.instance_id, item.id], "");
  if (!id)
    throw new Error("Messaging response did not include an instance ID.");
  return {
    id,
    name: firstString([item.name], id),
    engineVersion: firstString([item.engine_version]),
    status: firstString([item.status], "UNKNOWN"),
    specification: firstString([item.specification]),
    brokerCount: numberOrNull(item.broker_num),
    storageGb: numberOrNull(item.total_storage_space ?? item.storage_space),
    usedStorageGb: numberOrNull(item.used_storage_space),
    privateAddress: firstString(
      engine === "rocketmq"
        ? [item.namesrv_address]
        : [item.connect_domain_name, item.connect_address],
    ),
    publicAddress: firstString(
      engine === "rocketmq"
        ? [item.public_namesrv_address]
        : [item.public_connect_domain_name, item.public_connect_address],
    ),
    grpcAddress: firstString([item.grpc_address]),
    brokerAddress: firstString([item.broker_address]),
    publicBrokerAddress: firstString([item.public_broker_address]),
    publicAccess:
      typeof item.enable_publicip === "boolean" ? item.enable_publicip : null,
    sslEnabled: typeof item.ssl_enable === "boolean" ? item.ssl_enable : null,
    vpcId: firstString([item.vpc_id]),
    vpcName: firstString([item.vpc_name, item.vpc_id]),
    subnetId: firstString([item.subnet_id]),
    securityGroupId: firstString([item.security_group_id]),
    enterpriseProjectId: firstString([item.enterprise_project_id]),
    availabilityZones: asArray(
      item.available_zone_names ?? item.available_zones,
    ).filter((value): value is string => typeof value === "string"),
    description: firstString([item.description]),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
  };
}

/** Both DMS engines use this lifecycle API; keep the engine and endpoint explicit. */
export async function listMessagingInstancesForProject(
  session: HuaweiProjectSession,
  engine: MessagingEngine,
) {
  const query = new URLSearchParams({ engine, offset: "0", limit: "50" });
  const body = await huaweiList<Record<string, unknown>>(
    session,
    engine,
    `/v2/${session.projectId}/instances?${query}`,
    {
      items: ["instances"],
      kind: "offset",
      parameter: "offset",
      size: 50,
      total: ["instance_num"],
    },
  );
  return asArray(body.instances).map((item) =>
    parseInstance(item, session, engine),
  );
}

export async function getMessagingInstance(
  session: BetterUiSession,
  engine: MessagingEngine,
  id: string,
  projectId?: string,
) {
  const project = sessionProjects(session).find(
    (project) => project.projectId === (projectId ?? session.projectId),
  );
  if (!project)
    throw new Error("The selected project is not part of this session.");
  const body = await huaweiFetch<Record<string, unknown>>(
    project,
    engine,
    `/v2/${project.projectId}/instances/${encodeURIComponent(id)}`,
  );
  const instance = parseInstance(body, project, engine);
  if (instance.id !== id)
    throw new Error("Messaging response returned a different instance.");
  return instance;
}
