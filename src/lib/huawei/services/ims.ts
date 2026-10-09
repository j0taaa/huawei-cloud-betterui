import { finishCloudLoad, settledValue } from "@/lib/huawei/errors";
import { huaweiList } from "@/lib/huawei/http";
import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  formatBytes,
  huaweiFetch,
  loadAcrossProjects,
  projectForId,
} from "@/lib/huawei/core";

export type ImsImage = {
  architecture: string;
  checksum: string;
  containerFormat: string;
  createdAt: string;
  description: string;
  diskFormat: string;
  enterpriseProjectId: string;
  file: string;
  id: string;
  imageType: string;
  isProtected: boolean;
  isRegistered: string;
  isWholeImage: boolean;
  memberStatus: string;
  minDisk: string;
  minRam: string;
  name: string;
  os: string;
  osBit: string;
  osType: string;
  owner: string;
  platform: string;
  projectId: string;
  projectName: string;
  rawMinDiskGb: number;
  rawMinRamMb: number;
  rawSizeBytes: number;
  region: string;
  size: string;
  status: string;
  supportKvm: string;
  supportXen: string;
  tags: string[];
  updatedAt: string;
  virtualEnvType: string;
  visibility: string;
};

const imageCatalogQueries = [
  { imageType: "private", params: {} },
  {
    imageType: "shared",
    params: { member_status: "accepted", visibility: "shared" },
  },
  { imageType: "gold", params: { protected: "true" } },
  { imageType: "market", params: {} },
];

function parseBoolean(value: unknown) {
  return value === true || value === "true";
}

function parseTags(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((tag) => (typeof tag === "string" ? tag : ""))
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function parseImage(
  image: unknown,
  session: HuaweiProjectSession,
  fallbackImageType = "",
): ImsImage {
  const item = asRecord(image);
  const properties = asRecord(item.properties);
  const minDisk = Number(item.min_disk ?? properties.min_disk ?? 0);
  const minRam = Number(item.min_ram ?? properties.min_ram ?? 0);
  const size = Number(item.size ?? 0);
  const imageType = firstString(
    [item.__imagetype, item.imagetype, item.image_type, fallbackImageType],
    "-",
  );

  return {
    architecture: firstString([item.architecture, properties.architecture]),
    checksum: asString(item.checksum),
    containerFormat: firstString([item.container_format, item.containerFormat]),
    createdAt: firstString([item.created_at, item.createdAt]),
    description: asString(item.description, ""),
    diskFormat: firstString([item.disk_format, item.diskFormat]),
    enterpriseProjectId: firstString([
      item.enterprise_project_id,
      properties.enterprise_project_id,
    ]),
    file: asString(item.file),
    id: asString(item.id),
    imageType,
    isProtected: parseBoolean(item.protected),
    isRegistered: firstString([item.__isregistered, item.isregistered]),
    isWholeImage: parseBoolean(item.__whole_image),
    memberStatus: firstString([item.member_status, item.memberStatus]),
    minDisk: minDisk > 0 ? `${minDisk} GB` : "-",
    minRam: minRam > 0 ? `${minRam} MB` : "-",
    name: firstString([item.name, item.id]),
    os: firstString([
      item.__os_version,
      properties.__os_version,
      item.os_version,
      item.__os_type,
      properties.__os_type,
      item.os_type,
    ]),
    osBit: firstString([item.__os_bit, properties.__os_bit]),
    osType: firstString([item.__os_type, properties.__os_type, item.os_type]),
    owner: asString(item.owner),
    platform: firstString([item.__platform, properties.__platform]),
    projectId: session.projectId,
    projectName: session.projectName,
    rawMinDiskGb: Number.isFinite(minDisk) ? minDisk : 0,
    rawMinRamMb: Number.isFinite(minRam) ? minRam : 0,
    rawSizeBytes: Number.isFinite(size) ? size : 0,
    region: session.region,
    size: formatBytes(item.size),
    status: asString(item.status, "UNKNOWN"),
    supportKvm: firstString([item.__support_kvm, properties.__support_kvm]),
    supportXen: firstString([item.__support_xen, properties.__support_xen]),
    tags: parseTags(item.tags ?? properties.tags),
    updatedAt: firstString([item.updated_at, item.updatedAt]),
    virtualEnvType: firstString([
      item.virtual_env_type,
      properties.virtual_env_type,
    ]),
    visibility: asString(item.visibility, "-"),
  };
}

export async function listImagesForProject(session: HuaweiProjectSession) {
  const results = await Promise.allSettled(
    imageCatalogQueries.map(async ({ imageType, params }) => {
      const queryParams = {
        __imagetype: imageType,
        __isregistered: "true",
        limit: "100",
        sort_dir: "desc",
        sort_key: "created_at",
        ...params,
      };
      const query = new URLSearchParams();

      for (const [key, value] of Object.entries(queryParams)) {
        if (typeof value === "string") {
          query.set(key, value);
        }
      }

      const body = await huaweiList<{ images?: unknown[] }>(
        session,
        "ims",
        `/v2/cloudimages?${query.toString()}`,
        {
          items: ["images"],
          kind: "marker",
          parameter: "marker",
          size: 100,
          next: ["page_info.next_marker", "next_marker"],
          fallbackKey: "id",
        },
      );

      return asArray(body.images).map((image) =>
        parseImage(image, session, imageType),
      );
    }),
  );

  const images = results.flatMap((result) => settledValue(result, []));
  const uniqueImages = new Map<string, ImsImage>();

  for (const image of images) {
    uniqueImages.set(`${image.region}:${image.projectId}:${image.id}`, image);
  }

  return finishCloudLoad(results, Array.from(uniqueImages.values()));
}

export async function listImages(session: BetterUiSession) {
  return loadAcrossProjects(session, listImagesForProject);
}

export async function getImage(
  session: BetterUiSession,
  imageId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  try {
    const image = await huaweiFetch<Record<string, unknown>>(
      project,
      "ims",
      `/v2/images/${encodeURIComponent(imageId)}`,
    );

    return parseImage(image, project);
  } catch {
    const images = await listImages(session);

    return (
      images.find(
        (image) =>
          image.id === imageId && (!projectId || image.projectId === projectId),
      ) ?? null
    );
  }
}

export async function deleteImage(
  session: BetterUiSession,
  imageId: string,
  projectId?: string,
) {
  const project = projectForId(session, projectId);

  const body = await huaweiFetch<{ images?: unknown[] }>(
    project,
    "ims",
    `/v2/images/${encodeURIComponent(imageId)}`,
    { method: "DELETE" },
  );

  return body;
}

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
