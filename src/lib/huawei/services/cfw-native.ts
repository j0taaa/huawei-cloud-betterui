import "server-only";
import type { HuaweiProjectSession } from "@/lib/auth-session";
import { HuaweiApiError, huaweiFetch as nativeFetch } from "@/lib/huawei/http";
import { asRecord } from "@/lib/huawei/parsers";

export function verifyCfwScope(session: HuaweiProjectSession, row: Record<string, unknown>) {
  for (const key of ["project_id", "projectId"]) if (key in row && row[key] !== session.projectId) throw new Error("Huawei returned an unverifiable Cloud Firewall project scope.");
}

/** Every read and write shares transport, business-error, and scope validation. */
export async function cfwFetch<T>(session: HuaweiProjectSession, service: "cfw", path: string, init?: RequestInit): Promise<T> {
  if (!session.projectId?.trim()) throw new Error("Select a Huawei project before using Cloud Firewall.");
  let body: Record<string, unknown>;
  try { body = await nativeFetch<Record<string, unknown>>(session, service, path, init); }
  catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected the Cloud Firewall request (HTTP ${error.status}).`, error.status);
    throw new Error("Huawei returned an unverifiable Cloud Firewall response. Verify the current cloud state before retrying.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Huawei returned an unverifiable Cloud Firewall response.");
  const data = asRecord(body.data);
  for (const row of [body, data]) {
    verifyCfwScope(session, row);
    if (("error_code" in row && row.error_code !== "0" && row.error_code !== 0) || "error_msg" in row || "error" in row) throw new Error("Huawei reported a Cloud Firewall business failure. Verify the current state before retrying.");
  }
  if (typeof init?.body === "string") {
    const expected = asRecord(JSON.parse(init.body));
    for (const row of [body, data]) for (const key of ["object_id", "set_id", "fw_instance_id"]) if (key in expected && key in row && expected[key] !== row[key]) throw new Error("Huawei returned an unexpected Cloud Firewall parent for the accepted request.");
  }
  return body as T;
}

/** Native POST inventory has data.records and a numeric data.total on every page. */
export async function listNativeCloudFirewalls(session: HuaweiProjectSession) {
  const records: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  let expectedTotal: number | undefined;
  let firstBody: Record<string, unknown> | undefined;
  for (let page = 0; page < 1000; page++) {
    const body = await cfwFetch<Record<string, unknown>>(session, "cfw", `/v1/${session.projectId}/firewalls/list?enterprise_project_id=all_granted_eps`, { method: "POST", body: JSON.stringify({ limit: 100, offset: records.length }) });
    const data = asRecord(body.data);
    if (!Array.isArray(data.records) || typeof data.total !== "number" || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error("Huawei returned an incomplete Cloud Firewall inventory page.");
    if (expectedTotal !== undefined && expectedTotal !== data.total) throw new Error("The Cloud Firewall inventory changed during pagination; refresh it before administering firewalls.");
    expectedTotal = data.total;
    firstBody ??= body;
    for (const item of data.records) {
      const row = asRecord(item);
      verifyCfwScope(session, row);
      if (typeof row.fw_instance_id !== "string" || !row.fw_instance_id.trim() || typeof row.fw_instance_name !== "string" || !row.fw_instance_name.trim()) throw new Error("Huawei returned an unverifiable Cloud Firewall identity or name.");
      if (ids.has(row.fw_instance_id)) throw new Error("Huawei returned duplicate Cloud Firewall identities.");
      ids.add(row.fw_instance_id); records.push(row);
    }
    if (records.length > expectedTotal || (!data.records.length && records.length < expectedTotal)) throw new Error("Huawei returned an incomplete Cloud Firewall inventory.");
    if (records.length === expectedTotal) return { body: firstBody, data: { ...asRecord(firstBody.data), records }, records };
  }
  throw new Error("Cloud Firewall inventory exceeded the pagination limit.");
}
