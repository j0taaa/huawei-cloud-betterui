import "server-only";
import type { HuaweiProjectSession } from "@/lib/auth-session";
import { ManagementInputError } from "@/lib/management-contract";
import { huaweiFetch as nativeFetch, HuaweiApiError } from "@/lib/huawei/http";
import { asRecord, firstString } from "@/lib/huawei/parsers";

const knownStatuses = new Set(["SHUTOFF", "ACTIVE", "DELETING", "BUILD", "DELETED", "ERROR", "HAWAIT", "FROZEN", "UPGRADING", "UNPAID", "RESIZE", "DILATATION", "HA"]);
const knownTasks = new Set(["powering-on", "powering-off", "rebooting", "delete_wait", "frozen", "NO_TASK", "unfrozen", "alter", "updating", "configuring-ha", "data-migrating", "rollback", "traffic-switchover"]);
const knownUpdateFlags = new Set(["OLD", "NEW", "CROSS_OS", "ROLLBACK"]);
/**
 * Sanitizing transport for every native request this console issues: HTTP rejections keep their
 * status, non-JSON and network failures become generic errors, and a business failure inside a
 * 200 body is a definitive rejection before any write but an uncertain outcome after one.
 */
export async function cbhFetch<T = unknown>(session: HuaweiProjectSession, service: "cbh" | "vpc" | "eip" | "eps", path: string, init?: RequestInit): Promise<T> {
  const write = Boolean(init?.method && init.method !== "GET");
  let body: T;
  try {
    body = await nativeFetch<T>(session, service, path, init);
  } catch (error) {
    if (error instanceof HuaweiApiError) throw new HuaweiApiError(`Huawei rejected this CBH console request (HTTP ${error.status}). Check the current state in the native console.`, error.status);
    if (write) throw new Error(`Huawei ${error instanceof SyntaxError ? "returned an unverifiable response" : "could not be reached"} for this change. The change may or may not have been applied; check the current state in the native console before retrying.`);
    if (error instanceof SyntaxError) throw new Error("Huawei returned an unverifiable response (not valid JSON). Check the current state in the native console before retrying.");
    throw new Error("Huawei could not be reached for this CBH console request. Check connectivity and retry.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Huawei returned an unverifiable CBH response shape.");
  const result = asRecord(body);
  const verify = (row: Record<string, unknown>) => {
    if (service !== "eps") for (const key of ["project_id", "projectId"]) if (key in row && row[key] !== session.projectId) throw new Error("Huawei returned an CBH response outside the exactly selected project.");
    if (write) for (const key of ["server_id", "serverId"]) if (key in row) {
      const inBody = init?.body && typeof init.body === "string" ? asRecord(JSON.parse(init.body)).server_id : undefined;
      const inPath = /\/instance\/([^/]+)\/(?:eip\/|security-groups)/.exec(path)?.[1];
      const expected = inBody ?? (inPath ? decodeURIComponent(inPath) : undefined);
      if (expected !== undefined && row[key] !== expected) throw new Error("Huawei returned a different bastion for the accepted operation.");
    }
  };
  verify(result); if ("data" in result && result.data !== null) verify(asRecord(result.data));
  for (const key of ["instance", "body", "availability_zone", "subnets", "vpcs", "security_groups", "publicips"]) if (Array.isArray(result[key])) for (const row of result[key].map(asRecord)) verify(row);
  if (("error_code" in result && result.error_code !== "0" && result.error_code !== 0) || "error" in result || "error_msg" in result) {
    if (write) throw new Error("Huawei reported a CBH business failure. The change may or may not have been applied; verify the current state before retrying.");
    throw new ManagementInputError("Huawei rejected this CBH request in its response body.", 409);
  }
  return body;
}

/** Every native path is addressed to the exactly selected project; null or empty ids are never interpolated. */
export function cbhProjectScope(session: HuaweiProjectSession) {
  if (typeof session.projectId !== "string" || !session.projectId.trim()) throw new Error("The current sign-in has no exactly selected Huawei project; CBH requests cannot be addressed.");
  return session.projectId;
}

export type CbhNativeInstance = {
  serverId: string;
  instanceId: string;
  nativeResourceId: string;
  name: string;
  status: string;
  taskStatus: string;
  version: string;
  updateFlag: string;
  upgradeTime: number | null;
  specification: string;
  orderId: string;
  vpcId: string;
  subnetId: string;
  securityGroupId: string;
  publicIp: string | null;
  publicId: string | null;
  privateIp: string;
  zone: string;
  region: string;
  enterpriseProjectId: string;
  periodNum: string;
  startTime: string;
  endTime: string;
  createdTime: string;
};

/**
 * The native instance list is paged by offset: every page must carry its own instance array and a
 * known numeric total, identities stay unique across pages, and the collected rows must reach
 * exactly the reported total before the inventory is trusted.
 */
export async function listNativeCbhInstances(session: HuaweiProjectSession): Promise<CbhNativeInstance[]> {
  const projectId = cbhProjectScope(session);
  const collected: CbhNativeInstance[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedTotal: number | undefined;
  for (let page = 0; page < 100; page++) {
    const body = await cbhFetch<Record<string, unknown>>(session, "cbh", `/v2/${projectId}/cbs/instance/list?limit=100&offset=${offset}`);
    const rows = body.instance;
    if (!Array.isArray(rows)) throw new ManagementInputError("Huawei returned no CBH instance array for this page.", 409);
    const total = body.total;
    if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) throw new ManagementInputError("Huawei returned a CBH instance page without a known numeric total.", 409);
    if (expectedTotal !== undefined && total !== expectedTotal) throw new Error("The CBH inventory changed during pagination; refresh it before administering instances.");
    expectedTotal = total;
    for (const row of rows) {
      const record = asRecord(row);
      const serverId = firstString([record.server_id], "");
      if (!serverId) throw new ManagementInputError("Huawei returned an unverified CBH instance identity.", 409);
      if (seen.has(serverId)) throw new ManagementInputError("Huawei returned a duplicate CBH instance identity.", 409);
      seen.add(serverId);
      const name = firstString([record.name], "");
      if (!name) throw new ManagementInputError("Huawei returned a CBH instance without a verified name.", 409);
      if (Object.hasOwn(record, "enterprise_project_id") && (typeof record.enterprise_project_id !== "string" || !record.enterprise_project_id.trim())) throw new ManagementInputError("Huawei returned a CBH instance with an unverified enterprise project.", 409);
      if ((Object.hasOwn(record, "project_id") && record.project_id !== projectId) || (Object.hasOwn(record, "projectId") && record.projectId !== projectId)) throw new ManagementInputError("Huawei returned a CBH instance that does not belong to the exactly selected project.", 409);
      const statusInfo = asRecord(record.status_info);
      const network = asRecord(record.network);
      const resource = asRecord(record.resource_info);
      const az = asRecord(record.az_info);
      const status = firstString([statusInfo.status], "");
      const taskStatus = firstString([statusInfo.task_status], "");
      const updateFlag = firstString([record.update], "");
      const upgradeRaw = record.upgrade_time;
      collected.push({
        serverId,
        instanceId: firstString([record.instance_id], ""),
        nativeResourceId: firstString([resource.resource_id], ""),
        name,
        status: knownStatuses.has(status) ? status : "UNKNOWN",
        taskStatus: knownTasks.has(taskStatus) ? taskStatus : "UNKNOWN",
        version: firstString([record.bastion_version], ""),
        updateFlag: knownUpdateFlags.has(updateFlag) ? updateFlag : "",
        upgradeTime: typeof upgradeRaw === "number" && Number.isSafeInteger(upgradeRaw) && upgradeRaw >= 0 && upgradeRaw <= 8640000000000000 ? upgradeRaw : null,
        specification: firstString([resource.specification], ""),
        orderId: firstString([resource.order_id], ""),
        vpcId: firstString([network.vpc_id], ""),
        subnetId: firstString([network.subnet_id], ""),
        securityGroupId: firstString([network.security_group_id], ""),
        publicIp: typeof network.public_ip === "string" ? network.public_ip : null,
        publicId: typeof network.public_id === "string" ? network.public_id : null,
        privateIp: firstString([network.private_ip], ""),
        zone: firstString([az.zone], ""),
        region: firstString([az.region], ""),
        enterpriseProjectId: typeof record.enterprise_project_id === "string" ? record.enterprise_project_id : "",
        periodNum: firstString([record.period_num], ""),
        startTime: firstString([record.start_time], ""),
        endTime: firstString([record.end_time], ""),
        createdTime: firstString([record.created_time], ""),
      });
    }
    if (collected.length > total) throw new ManagementInputError("Huawei returned more CBH instances than its reported total.", 409);
    if (collected.length === total) return collected;
    if (!rows.length) throw new ManagementInputError("Huawei ended CBH pagination before its reported total.", 409);
    offset += rows.length;
  }
  throw new Error("The CBH instance list exceeded the supported page limit.");
}

