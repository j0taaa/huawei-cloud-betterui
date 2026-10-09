import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { finishCloudLoad } from "@/lib/huawei/errors";
import { projectForId, sessionProjects } from "@/lib/huawei/projects";
import { aadDomains, aadInstances, aadPackages, aadPolicies, aadProtectedIps, aadRowName } from "./aad-native";
import { asString } from "@/lib/huawei/parsers";

export type AadProtectionResource = { id: string; name: string; kind: string; projectId: string; projectName: string; region: string };

/** CNAD is an account inventory; AAD instances/domains use separate selected-project tokens. */
export async function listAadProtection(session: BetterUiSession) {
  const loads: { context: string; run: () => Promise<AadProtectionResource[]> }[] = [
    ...([
      { list: aadPackages, prefix: "package", key: "package_id", kind: "Protection package", name: aadRowName.package },
      { list: aadPolicies, prefix: "policy", key: "id", kind: "Protection policy", name: aadRowName.policy },
      { list: aadProtectedIps, prefix: "protected-ip", key: "id", kind: "Protected IP", name: aadRowName.protectedIp },
    ]).map(plane => ({ context: `Anti-DDoS ${plane.kind.toLowerCase()} inventory`, run: async () => (await plane.list(session)).map(row => ({ id: `${plane.prefix}:${row[plane.key]}`, name: plane.name(row), kind: plane.kind, projectId: session.projectId, projectName: "Account-wide", region: asString(row.region_id, asString(row.region, "Global")) })) })),
    ...sessionProjects(session).flatMap(project => {
      const scoped = { ...session, ...projectForId(session, project.projectId), projects: [project] };
      return [
        { context: `Anti-DDoS instances in ${project.projectName}`, run: async () => (await aadInstances(scoped)).map(row => ({ id: `instance:${row.instance_id}`, name: aadRowName.instance(row), kind: "High-defense instance", projectId: project.projectId, projectName: project.projectName, region: project.region })) },
        { context: `Anti-DDoS domains in ${project.projectName}`, run: async () => (await aadDomains(scoped)).map(row => ({ id: `domain:${row.domain_id}`, name: aadRowName.domain(row), kind: "Protected domain", projectId: project.projectId, projectName: project.projectName, region: project.region })) },
      ];
    }),
  ];
  const results = await Promise.allSettled(loads.map(load => load.run()));
  return finishCloudLoad(results, results.flatMap(result => result.status === "fulfilled" ? result.value : []), loads.map(load => load.context));
}
