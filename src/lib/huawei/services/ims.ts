import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  formatBytes,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects } from "@/lib/huawei/projects";

export type ImsImage = {
  createdAt: string;
  id: string;
  imageType: string;
  minDisk: string;
  name: string;
  os: string;
  projectId: string;
  projectName: string;
  region: string;
  size: string;
  status: string;
  visibility: string;
};

export async function getImageNameForProject(
  session: HuaweiProjectSession,
  imageId: string,
) {
  if (!imageId || imageId === "-") {
    return "-";
  }

  const body = await huaweiFetch<Record<string, unknown>>(
    session,
    "ims",
    `/v2/cloudimages/${imageId}`,
  );
  const image = asRecord(body.image ?? body);

  return firstString([image.name, imageId]);
}

export async function listImagesForProject(session: HuaweiProjectSession) {
  const body = await huaweiList<{ images?: unknown[] }>(
    session,
    "ims",
    "/v2/cloudimages?__imagetype=private&limit=100&sort_key=created_at&sort_dir=desc",
    {
      items: ["images"],
      kind: "marker",
      parameter: "marker",
      size: 100,
      next: ["page_info.next_marker", "next_marker"],
      fallbackKey: "id",
    },
  );

  return asArray(body.images).map((image): ImsImage => {
    const item = asRecord(image);

    return {
      createdAt: firstString([item.created_at, item.createdAt]),
      id: asString(item.id),
      imageType: firstString([
        item.__imagetype,
        item.imagetype,
        item.image_type,
      ]),
      minDisk: `${Number(item.min_disk ?? 0)} GB`,
      name: firstString([item.name, item.id]),
      os: firstString([
        item.__os_version,
        item.os_version,
        item.__os_type,
        item.os_type,
      ]),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      size: formatBytes(item.size),
      status: asString(item.status, "UNKNOWN"),
      visibility: asString(item.visibility, "-"),
    };
  });
}

export async function listImages(session: BetterUiSession) {
  return loadAcrossProjects(session, listImagesForProject);
}
