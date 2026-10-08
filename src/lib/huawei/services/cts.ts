import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type CtsTracker = {
  bucketName: string;
  filePrefix: string;
  id: string;
  isLtsEnabled: string;
  ltsGroupId: string;
  name: string;
  projectId: string;
  projectName: string;
  region: string;
  status: string;
};

export type CtsTrace = {
  code: string;
  id: string;
  recordedAt: string;
  resourceName: string;
  resourceType: string;
  serviceType: string;
  sourceIp: string;
  traceName: string;
  traceRating: string;
  traceType: string;
  userName: string;
};

export async function listCtsTrackersForProject(session: HuaweiProjectSession) {
  const body = await huaweiFetch<{ trackers?: unknown[] }>(
    session,
    "cts",
    `/v3/${session.projectId}/trackers`,
  );

  return asArray(body.trackers).map((tracker): CtsTracker => {
    const item = asRecord(tracker);
    const obs = asRecord(item.obs_info);
    const lts = asRecord(item.lts);

    return {
      bucketName: asString(obs.bucket_name, "-"),
      filePrefix: asString(obs.file_prefix_name, "-"),
      id: firstString([item.id, item.tracker_name]),
      isLtsEnabled: String(item.is_lts_enabled ?? lts.is_lts_enabled ?? "-"),
      ltsGroupId: firstString([item.group_id, lts.log_group_id], "-"),
      name: firstString([item.tracker_name, item.name]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      status: asString(item.status, "UNKNOWN"),
    };
  });
}

export async function listCtsTrackers(session: BetterUiSession) {
  return loadAcrossProjects(session, listCtsTrackersForProject);
}

export async function listCtsTracesForProject(session: HuaweiProjectSession) {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const body = await huaweiFetch<{ traces?: unknown[] }>(
    session,
    "cts",
    `/v1.0/${session.projectId}/system/trace?from=${oneDayAgo}&to=${now}&limit=50`,
  );

  return asArray(body.traces).map((trace): CtsTrace => {
    const item = asRecord(trace);
    const user = asRecord(item.user);

    return {
      code: firstString([item.code, item.request_id], "-"),
      id: firstString([item.trace_id, item.id, item.request_id]),
      recordedAt: firstString([item.time, item.record_time, item.trace_time]),
      resourceName: firstString([item.resource_name, item.resource_id], "-"),
      resourceType: asString(item.resource_type, "-"),
      serviceType: asString(item.service_type, "-"),
      sourceIp: firstString([item.source_ip, item.user_ip], "-"),
      traceName: asString(item.trace_name, "-"),
      traceRating: asString(item.trace_rating, "-"),
      traceType: asString(item.trace_type, "-"),
      userName: firstString([user.name, item.user_name], "-"),
    };
  });
}

export async function listCtsTraces(session: BetterUiSession) {
  return (await loadAcrossProjects(session, listCtsTracesForProject))
    .sort(
      (a, b) =>
        new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
    )
    .slice(0, 50);
}
