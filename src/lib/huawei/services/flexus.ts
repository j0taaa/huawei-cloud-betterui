import "server-only";

import { finishCloudLoad, settledValue } from "@/lib/huawei/errors";

import type { BetterUiSession } from "@/lib/auth-session";
import { listEcsInstances } from "@/lib/huawei/services/ecs";
import { listRdsInstances } from "@/lib/huawei/services/rds";

export type FlexusResource = {
  createdAt: string;
  id: string;
  name: string;
  privateIp: string;
  projectId: string;
  projectName: string;
  publicIp: string;
  region: string;
  signal: string;
  sourceService: "ECS" | "RDS";
  status: string;
};

export async function listFlexusResources(session: BetterUiSession) {
  const results = await Promise.allSettled([
    listEcsInstances(session),
    listRdsInstances(session),
  ]);
  const ecsInstances = settledValue(results[0], []);
  const rdsInstances = settledValue(results[1], []);
  const isFlexusSignal = (value: string) =>
    /flexus|hcss|hecs|l-instance|x-instance|taurus/i.test(value);

  return finishCloudLoad(results, [
    ...ecsInstances
      .filter((instance) =>
        [instance.flavor, instance.imageName, instance.name].some(
          isFlexusSignal,
        ),
      )
      .map((instance): FlexusResource => ({
        createdAt: instance.createdAt,
        id: instance.id,
        name: instance.name,
        privateIp: instance.privateIp,
        projectId: instance.projectId,
        projectName: instance.projectName,
        publicIp: instance.publicIp,
        region: instance.region,
        signal: instance.flavor,
        sourceService: "ECS",
        status: instance.status,
      })),
    ...rdsInstances
      .filter((instance) =>
        [instance.name, instance.datastore, instance.type].some(isFlexusSignal),
      )
      .map((instance): FlexusResource => ({
        createdAt: "-",
        id: instance.id,
        name: instance.name,
        privateIp: instance.privateIp,
        projectId: instance.projectId,
        projectName: instance.projectName,
        publicIp: "-",
        region: instance.region,
        signal:
          [instance.datastore, instance.type].filter(Boolean).join(" / ") ||
          "-",
        sourceService: "RDS",
        status: instance.status,
      })),
  ]);
}
