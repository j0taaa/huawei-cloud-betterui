import "server-only";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch, HuaweiApiError } from "@/lib/huawei/http";
import { asRecord, asString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

/** Mesh errors can contain private telemetry destinations or request configuration. */
export async function asmFetch<T>(session: HuaweiProjectSession, path: string, init?: RequestInit): Promise<T> {
  try {
    const body = await huaweiFetch<T>(session, "asm", path, init);
    const row = asRecord(body);
    if (row.errorCode || row.error_code || row.error) throw new HuaweiApiError("Huawei rejected this ASM request.", 502);
    return body;
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected this ASM request.", error.status);
    throw new Error("Huawei returned an unverifiable ASM response. Check current state before retrying.");
  }
}

export async function listAsmMeshDefinitionsForProject(session: HuaweiProjectSession) {
  const body = asRecord(await asmFetch(session, `/v1/${session.projectId}/meshes`));
  // The native v1 list has no pagination parameters.
  if (!Array.isArray(body.items)) throw new Error("Huawei returned no mesh list envelope. The mesh inventory may be incomplete.");
  const rows = body.items.map(asRecord);
  const ids = rows.map(row => asString(asRecord(row.metadata).uid, ""));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || rows.some(row => !asString(asRecord(row.metadata).name, "") || !asString(asRecord(row.spec).type, ""))) throw new Error("Huawei returned an unverified mesh inventory.");
  if (rows.some(row => {
    const clusters = asRecord(asRecord(row.spec).extendParams).clusters;
    if (!Array.isArray(clusters)) return true;
    const clusterIds = clusters.map(cluster => asString(asRecord(cluster).clusterID, ""));
    return clusterIds.some(id => !id) || new Set(clusterIds).size !== clusterIds.length;
  })) throw new Error("Huawei returned unverified mesh member clusters.");
  return rows;
}

export type AsmMesh = {
  id: string; name: string; status: string; type: string; version: string;
  clusterCount: number; projectId: string; projectName: string; region: string;
};

export async function listAsmMeshesForProject(session: HuaweiProjectSession): Promise<AsmMesh[]> {
  return (await listAsmMeshDefinitionsForProject(session)).map(row => {
    const metadata = asRecord(row.metadata), spec = asRecord(row.spec);
    const clusters = asRecord(spec.extendParams).clusters;
    return { id: asString(metadata.uid), name: asString(metadata.name), status: asString(asRecord(row.status).phase, "UNKNOWN"), type: asString(spec.type), version: asString(spec.version, "Server selected"), clusterCount: Array.isArray(clusters) ? clusters.length : 0, projectId: session.projectId, projectName: session.projectName, region: session.region };
  });
}

export async function listAsmMeshes(session: BetterUiSession) {
  return loadAcrossProjects(session, listAsmMeshesForProject);
}
