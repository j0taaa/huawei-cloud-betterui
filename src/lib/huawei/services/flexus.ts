import "server-only";

import { finishCloudLoad } from "@/lib/huawei/errors";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { projectForId, sessionProjects } from "@/lib/huawei/projects";
import {
  listNativeFlexusLInstances,
  listNativeFlexusXInstances,
  type FlexusLNativeInstance,
  type FlexusXNativeInstance,
} from "@/lib/huawei/services/flexus-native";

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

/*
 * Native Flexus inventory across every session project: Flexus L bundles come from the account RMS
 * catalog with their exact l:bundle:server identity, and Flexus X servers come from the project ECS
 * catalog with the documented x1/x1e flavor grammar. No name, image, or datastore heuristic is
 * used; Flexus RDS has no verified native contract yet and stays an explicit gap, so every resource
 * is ECS-backed. Created times and IP addresses stay unknown ("-") until a verified fresh source
 * provides them, and per-plane load failures stay visible while the remaining partial inventory is
 * still shown.
 */

function flexusProjectSession(session: BetterUiSession, projectId: string): BetterUiSession {
  const project = projectForId(session, projectId);
  return { ...session, ...project, projects: [project] };
}

function flexusLResource(projectName: string, instance: FlexusLNativeInstance): FlexusResource {
  return {
    createdAt: "-",
    id: `l:${instance.bundleId}:${instance.serverId}`,
    name: instance.name,
    privateIp: "-",
    projectId: instance.projectId,
    projectName,
    publicIp: "-",
    region: instance.region,
    signal: "L",
    sourceService: "ECS",
    status: "-",
  };
}

function flexusXResource(projectName: string, instance: FlexusXNativeInstance): FlexusResource {
  return {
    createdAt: "-",
    id: `x:${instance.serverId}`,
    name: instance.name,
    privateIp: "-",
    projectId: instance.projectId,
    projectName,
    publicIp: "-",
    region: instance.region,
    signal: "X",
    sourceService: "ECS",
    status: instance.status,
  };
}

export async function listFlexusResources(session: BetterUiSession) {
  const projects = sessionProjects(session);
  const loads = projects.flatMap((project: HuaweiProjectSession) => {
    const projectSession = flexusProjectSession(session, project.projectId);
    return [
      {
        context: `Flexus L in ${project.projectName} (${project.region})`,
        run: async () => (await listNativeFlexusLInstances(projectSession)).map((instance) => flexusLResource(projectSession.projectName, instance)),
      },
      {
        context: `Flexus X in ${project.projectName} (${project.region})`,
        run: async () => (await listNativeFlexusXInstances(projectSession)).map((instance) => flexusXResource(projectSession.projectName, instance)),
      },
    ];
  });
  const results = await Promise.allSettled(loads.map((load) => load.run()));
  const resources = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  return finishCloudLoad(results, resources, loads.map((load) => load.context));
}
