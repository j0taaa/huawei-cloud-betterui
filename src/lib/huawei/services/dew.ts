import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type DewKey = {
  alias: string;
  createdAt: string;
  id: string;
  keyId: string;
  keyState: string;
  keyType: string;
  origin: string;
  projectId: string;
  projectName: string;
  region: string;
};

export async function listDewKeysForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ keys?: unknown[]; key_details?: unknown[] }>(
    session,
    "dew",
    `/v1.0/${session.projectId}/kms/list-keys`,
    {
      items: ["key_details", "keys"],
      kind: "marker",
      parameter: "marker",
      size: 100,
      next: ["page_info.next_marker", "next_marker"],
      inBody: true,
    },
    {
      body: JSON.stringify({ limit: "100" }),
      method: "POST",
    },
  );

  return asArray(body.key_details ?? body.keys).map((key): DewKey => {
    const item = asRecord(key);

    return {
      alias: firstString([item.key_alias, item.alias], "-"),
      createdAt: item.creation_date
        ? new Date(Number(item.creation_date)).toISOString()
        : firstString([item.created_at, item.createdAt]),
      id: firstString([item.key_id, item.id]),
      keyId: firstString([item.key_id, item.id]),
      keyState: String(item.key_state ?? item.state ?? "-"),
      keyType: firstString([item.key_type, item.type], "-"),
      origin: firstString([item.origin, item.key_origin], "-"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
    };
  });
}

export async function listDewKeys(session: BetterUiSession) {
  return loadAcrossProjects(session, listDewKeysForProject);
}
