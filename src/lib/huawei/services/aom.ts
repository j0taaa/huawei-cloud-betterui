import "server-only";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch } from "@/lib/huawei/http";
import { asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type AomPrometheusInstance = {
  id: string;
  name: string;
  status: string;
  type: string;
  version: string;
  retention: string;
  enterpriseProjectId: string;
  projectId: string;
  projectName: string;
  region: string;
};

export async function listAomPrometheusInstancesForProject(
  session: HuaweiProjectSession,
) {
  // The API returns the complete list and defines no pagination parameters.
  const body = await huaweiFetch<Record<string, unknown>>(
    session,
    "aom",
    `/v1/${session.projectId}/aom/prometheus`,
    { headers: { "Enterprise-Project-Id": "all_granted_eps" } },
  );
  if (!Array.isArray(body.prometheus))
    throw new Error("AOM response did not include a Prometheus instance list.");
  return body.prometheus.map((value): AomPrometheusInstance => {
    const item = asRecord(value);
    const id = firstString([item.prom_id], "");
    if (!id)
      throw new Error("AOM response did not include a Prometheus instance ID.");
    return {
      id,
      name: firstString([item.prom_name], id),
      status: firstString([item.prom_status], "UNKNOWN"),
      type: firstString([item.prom_type]),
      version: firstString([item.prom_version]),
      retention: firstString([
        asRecord(item.prom_limits).compactor_blocks_retention_period,
      ]),
      enterpriseProjectId: firstString([item.enterprise_project_id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
    };
  });
}
export async function listAomPrometheusInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listAomPrometheusInstancesForProject);
}
