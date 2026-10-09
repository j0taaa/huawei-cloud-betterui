import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { HuaweiApiError, huaweiFetch } from "@/lib/huawei/http";
import { asRecord, firstString, timestampMillis } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

// Verified native DataArts Studio contract (official huaweicloudsdkdataartsstudio v1):
//   GET /v1/{project_id}/instances -> ListDataArtsStudioInstancesResponse
//   { billing_check: boolean, count: integer, commodity_orders: ApigCommodityOrder[] },
//   paginated by limit/offset. Primary documentation:
//   https://support.huaweicloud.com/intl/en-us/api-dataartsstudio/ListDataArtsStudioInstances.html
//   ApigCommodityOrder rows carry resource_id (native instance ID), resource_name, project_id,
//   region_id, domain_id, resource_spec_code, charge_type, status (integer 1-6), create_time
//   (float milliseconds), eps_id and order_id. The response has no instances[] array, and the
//   native rows report neither a version nor a workspace count.

export type DataArtsInstance = {
  chargingMode: string;
  createdAt: string;
  domainId: string;
  edition: string;
  epsId: string;
  id: string;
  name: string;
  orderId: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
  version: string;
  workspaceCount: number | null;
};

// Exact native ApigCommodityOrder.status integers; any other value is reported as UNKNOWN.
const instanceStatuses: Record<number, string> = {
  1: "not effective",
  2: "in effect",
  3: "deleted",
  4: "frozen",
  5: "grace",
  6: "deleting",
};

function instanceStatus(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value in instanceStatuses
    ? instanceStatuses[value]
    : "UNKNOWN";
}

// Shared sanitized transport for every DataArts Studio request: HTTP statuses, brand text and
// native payload details never reach user-facing messages. The HTTP status stays on the error
// object so the management framework can still tell a rejection from an uncertain outcome.
export function dataArtsScope(session: HuaweiProjectSession, row: Record<string, unknown>) {
  for (const key of ["project_id", "projectId"]) if (key in row && row[key] !== session.projectId) throw new Error("Huawei returned an unverifiable DataArts project scope.");
  for (const key of ["region_id", "regionId"]) if (key in row && row[key] !== session.region) throw new Error("Huawei returned an unverifiable DataArts region scope.");
}

export async function dataArtsFetch<T>(
  session: HuaweiProjectSession,
  path: string,
  init?: RequestInit,
): Promise<T> {
  try {
    const response = await huaweiFetch<unknown>(session, "dataarts", path, init);
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("Invalid native shape");
    const body = response as Record<string, unknown>;
    for (const row of [body, asRecord(body.data)]) {
      dataArtsScope(session, row);
      if (("error_code" in row && row.error_code !== "0" && row.error_code !== 0) || "error_msg" in row || "error" in row) throw new Error("Native business error");
      const workspace = new Headers(init?.headers).get("workspace");
      for (const key of ["workspace", "workspace_id"]) if (workspace && key in row && row[key] !== workspace) throw new Error("Unexpected workspace");
      const instance = path.match(/^\/v1\/[^/]+\/workspaces\/([^/?]+)/u)?.[1] ?? path.match(/^\/v1\/[^/]+\/([^/?]+)\/workspaces\/batch-delete/u)?.[1];
      if (instance && "instance_id" in row && row.instance_id !== decodeURIComponent(instance)) throw new Error("Unexpected instance");
      if (typeof init?.body === "string") {
        const expected = asRecord(JSON.parse(init.body));
        for (const key of ["eps_id", "workspace_ids"]) if (key in expected && key in row && JSON.stringify(expected[key]) !== JSON.stringify(row[key])) throw new Error("Unexpected request identity");
      }
    }
    return response as T;
  } catch (error) {
    if (error instanceof HuaweiApiError) {
      throw new HuaweiApiError(
        error.status >= 500
          ? "The DataArts Studio request could not be completed. Retry after checking the service."
          : "The DataArts Studio request was rejected. Check the resource and permissions before retrying.",
        error.status,
      );
    }
    throw new Error(error instanceof Error && error.message === "Native business error" ? "Huawei reported a DataArts Studio business error. Verify the current resource state before retrying." : "The DataArts Studio request returned an unverifiable response or scope. Verify the current resource state before retrying.");
  }
}

// Strict native pagination shared by the service and the management adapter: every page must
// carry its native array and an integer total, the total must stay stable across pages, and the
// accumulated rows must reach that total exactly. Truncated, repeated or oversized pagination
// is a hard error instead of a silent partial inventory.
export async function dataArtsList(
  session: HuaweiProjectSession,
  path: string,
  itemsKey: string,
  totalKey: string,
  label: string,
  init?: RequestInit,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let total: number | undefined;
  let offset = 0;
  for (;;) {
    const url = new URL(path, "https://dataarts.invalid");
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String(offset));
    const body = asRecord(
      await dataArtsFetch<unknown>(
        session,
        `${url.pathname}${url.search}`,
        init,
      ),
    );
    const page = body[itemsKey];
    if (!Array.isArray(page)) {
      throw new Error(
        `Huawei returned an invalid ${label} page without its native array.`,
      );
    }
    const reported = body[totalKey];
    if (
      typeof reported !== "number" ||
      !Number.isSafeInteger(reported) ||
      reported < 0
    ) {
      throw new Error(
        `Huawei omitted the native total or returned an invalid ${label} page total.`,
      );
    }
    if (total === undefined) total = reported;
    else if (reported !== total) {
      throw new Error(`Huawei returned an unstable ${label} page total.`);
    }
    if (offset + page.length > total) {
      throw new Error(
        `Huawei returned more ${label} rows than its reported total.`,
      );
    }
    const nativeRows = page.map(asRecord);
    for (const row of nativeRows) {
      if (!Object.keys(row).length) throw new Error("Huawei returned an invalid DataArts inventory row.");
      dataArtsScope(session, row);
      const workspace = new Headers(init?.headers).get("workspace");
      for (const key of ["workspace", "workspace_id"]) if (workspace && key in row && row[key] !== workspace) throw new Error("Huawei returned a DataArts row from another workspace.");
    }
    rows.push(...nativeRows);
    if (rows.length === total) return rows;
    if (!page.length) {
      throw new Error(
        `Huawei ended ${label} pagination before its reported total; the inventory may be incomplete.`,
      );
    }
    offset += itemsKey === "commodity_orders" ? 1 : page.length;
    if (offset >= (itemsKey === "commodity_orders" ? 1000 : 100000)) {
      throw new Error(`The ${label} exceeds the supported page limit.`);
    }
  }
}

export async function listDataArtsInstancesForProject(
  session: HuaweiProjectSession,
) {
  const rows = await dataArtsList(
    session,
    `/v1/${session.projectId}/instances`,
    "commodity_orders",
    "count",
    "DataArts Studio instance list",
  );
  const seen = new Set<string>();
  return rows.map((row): DataArtsInstance => {
    const id = row.resource_id;
    if (typeof id !== "string" || !id) {
      throw new Error(
        "Huawei returned a DataArts Studio instance without a valid native ID.",
      );
    }
    if (seen.has(id)) {
      throw new Error(
        "Huawei returned duplicate native IDs for DataArts Studio instances.",
      );
    }
    seen.add(id);
    if (typeof row.resource_name !== "string" || !row.resource_name) {
      throw new Error(
        "Huawei returned a DataArts Studio instance without a valid name.",
      );
    }
    // The native project and region echoes must match this session exactly; a missing, null,
    // empty or foreign scope can never enter the inventory silently.
    const projectId = row.project_id;
    if (typeof projectId !== "string" || !projectId) {
      throw new Error(
        "Huawei returned a DataArts Studio instance without its native project scope.",
      );
    }
    if (projectId !== session.projectId) {
      throw new Error(
        "Huawei returned a DataArts Studio instance scoped to a different project.",
      );
    }
    const region = row.region_id;
    if (typeof region !== "string" || !region) {
      throw new Error(
        "Huawei returned a DataArts Studio instance without its native region scope.",
      );
    }
    if (region !== session.region) {
      throw new Error(
        "Huawei returned a DataArts Studio instance scoped to a different region.",
      );
    }
    if ("domain_id" in row && (typeof row.domain_id !== "string" || !row.domain_id.trim())) throw new Error("Huawei returned an unverifiable DataArts instance account scope.");
    return {
      chargingMode: "Unknown",
      createdAt: typeof row.create_time === "number" && Number.isFinite(row.create_time) && row.create_time >= 0 ? timestampMillis(row.create_time) : "-",
      domainId: firstString([row.domain_id]),
      edition: firstString([row.resource_spec_code]),
      epsId: firstString([row.eps_id]),
      id,
      name: row.resource_name,
      orderId: firstString([row.order_id]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: instanceStatus(row.status),
      // The native instance list reports neither a version nor a workspace count: the version
      // column shows "-" and the workspace count stays null (unknown) instead of defaulting
      // to a fabricated zero.
      version: "-",
      workspaceCount: null,
    };
  });
}

export async function listDataArtsInstances(session: BetterUiSession) {
  return loadAcrossProjects(session, listDataArtsInstancesForProject);
}
