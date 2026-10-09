import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listEcsInstancesForProject } from "@/lib/huawei/services/ecs";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

const imagePrefix = "image:";
const sharedPrefix = "shared:";
const imagePrefixes = [imagePrefix];
const sharedPrefixes = [sharedPrefix];
const nameField: ManagementField = { key: "name", label: "Image name", required: true, min: 1, max: 128, pattern: "^[A-Za-z0-9_.\\-\\p{L}](?:[A-Za-z0-9_.\\-\\p{L} ]*[A-Za-z0-9_.\\-\\p{L}])?$" };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 1024, allowEmpty: true, pattern: "^[^<>\\r\\n]*$" };

type ManagedImage = { id: string; name: string; status: string; description: string; isProtected: boolean; whole: boolean; osType: string };
type ImageMember = { memberId: string; status: string; memberType: string; createdAt: string };

function parseManagedImage(raw: unknown): ManagedImage {
  const item = asRecord(raw);
  return {
    id: asString(item.id),
    name: firstString([item.name, item.id]),
    status: asString(item.status, "unknown").toLowerCase(),
    description: firstString([item.__description, item.description], ""),
    isProtected: item.protected === true || item.protected === "true",
    whole: item.__whole_image === true || item.__whole_image === "true",
    osType: firstString([item.__os_type, item.os_type], ""),
  };
}

async function catalogImages(session: BetterUiSession, filters: Record<string, string>) {
  const query = new URLSearchParams({ __isregistered: "true", limit: "100", sort_key: "created_at", sort_dir: "desc", ...filters });
  const body = await huaweiList<Record<string, unknown>>(session, "ims", `/v2/cloudimages?${query.toString()}`, { items: ["images"], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker", "next_marker"], fallbackKey: "id" });
  return asArray(body.images).map(asRecord).filter(image => (!image.__imagetype || image.__imagetype === filters.__imagetype) && (filters.__imagetype !== "private" || !image.owner || image.owner === session.projectId)).map(parseManagedImage);
}

function ownedPrivateImages(session: BetterUiSession) {
  return catalogImages(session, { __imagetype: "private" });
}

function pendingSharedImages(session: BetterUiSession) {
  return catalogImages(session, { __imagetype: "shared", visibility: "shared", member_status: "pending" });
}

async function requireOwnedImage(session: BetterUiSession, resource?: ManagementResource) {
  const imageId = resource?.id.startsWith(imagePrefix) ? resource.id.slice(imagePrefix.length) : "";
  const image = (await ownedPrivateImages(session)).find((image) => image.id === imageId);
  if (!image) throw new ManagementInputError("The image was not found in this project's private images.", 404);
  return image;
}

async function requirePendingShare(session: BetterUiSession, resource?: ManagementResource) {
  const imageId = resource?.id.startsWith(sharedPrefix) ? resource.id.slice(sharedPrefix.length) : "";
  const image = (await pendingSharedImages(session)).find((image) => image.id === imageId);
  if (!image) throw new ManagementInputError("This image is no longer shared with this project as pending.", 404);
  return image;
}

async function imageMembers(session: BetterUiSession, imageId: string) {
  const body = await huaweiList<Record<string, unknown>>(session, "ims", `/v1/${session.projectId}/cloudimages/${encodeURIComponent(imageId)}/members?limit=1000`, { items: ["members"], kind: "marker", parameter: "marker", size: 1000, next: ["page_info.next_marker"], fallbackKey: "member_id" });
  return asArray(body.members).map(asRecord).map((member): ImageMember => ({ memberId: asString(member.member_id), status: asString(member.status, "pending").toLowerCase(), memberType: firstString([member.member_type], "project").toLowerCase(), createdAt: firstString([member.created_at], "") }));
}

export const imsManagement: ManagementAdapter = {
  title: "Image Management Service",
  operations: [
    { id: "create", label: "Create image from server", kind: "create", description: "Create a private system disk image from a running or stopped cloud server in this project.", fields: [nameField, descriptionField, { key: "instance", label: "Source server", type: "select", source: "instances", required: true, help: "The server's system disk is copied into the image; the server itself keeps running." }], impact: "The server's system disk is copied into a new private image that counts against the project image quota. Creation runs as a cloud job." },
    { id: "update", label: "Edit image", kind: "update", resourcePrefixes: imagePrefixes, allowedStatuses: ["active"], description: "Rename this private image or change its description.", fields: [nameField, descriptionField] },
    { id: "delete", label: "Delete image", kind: "delete", resourcePrefixes: imagePrefixes, description: "Permanently delete this private image. Protected images must be unprotected first.", fields: [], confirmation: true, impact: "The image is permanently removed and can no longer be used to create servers. Backups behind full-ECS images are retained." },
    { id: "members", label: "View share recipients", kind: "inspect", resourcePrefixes: imagePrefixes, description: "List the projects this private image is currently shared with.", fields: [] },
    { id: "share-add", label: "Share with projects", kind: "action", resourcePrefixes: imagePrefixes, description: "Share this private image with other project IDs so they can create servers from it.", fields: [{ key: "projects", label: "Recipient project IDs", type: "list", required: true, help: "One 32-character hexadecimal project ID per line." }], impact: "The selected projects can see this image and use it to create servers after accepting it. Sharing runs as a cloud job." },
    { id: "share-delete", label: "Stop sharing", kind: "action", resourcePrefixes: imagePrefixes, description: "Stop sharing this image with selected recipient projects.", fields: [{ key: "projects", label: "Share recipients", type: "list", source: "members", required: true }], confirmation: true, impact: "The selected projects lose access to this image. Servers already created from it keep running." },
    { id: "accept", label: "Accept shared image", kind: "action", resourcePrefixes: sharedPrefixes, description: "Accept an image that another project shared with this project.", fields: [], confirmation: true, impact: "The image becomes visible in this project's image list and can be used to create servers. Only accept images from trusted sources." },
    { id: "reject", label: "Reject shared image", kind: "action", resourcePrefixes: sharedPrefixes, description: "Reject an image that another project shared with this project.", fields: [], impact: "The image is hidden from this project's image list. It can still be used directly by its ID." },
  ],
  inventory: async (session) => {
    const [owned, pending] = await Promise.all([ownedPrivateImages(session), pendingSharedImages(session)]);
    return [
      ...owned.map((image) => ({ id: `${imagePrefix}${image.id}`, name: image.name, status: image.status, values: { name: image.name, description: image.description, protected: image.isProtected, wholeImage: image.whole, osType: image.osType, projectId: session.projectId } })),
      ...pending.map((image) => ({ id: `${sharedPrefix}${image.id}`, name: image.name, status: image.status, values: { osType: image.osType, wholeImage: image.whole, memberStatus: "pending", projectId: session.projectId } })),
    ];
  },
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const servers = await listEcsInstancesForProject(session);
      return { instances: servers.filter((server) => ["ACTIVE", "SHUTOFF"].includes(server.status)).map((server) => ({ value: server.id, label: `${server.name} · ${server.status} · ${server.osType}` })) };
    }
    if (operation === "share-delete" && resource?.id.startsWith(imagePrefix)) {
      const members = await imageMembers(session, resource.id.slice(imagePrefix.length));
      return { members: members.filter((member) => member.memberType === "project").map((member) => ({ value: member.memberId, label: `${member.memberId} · ${member.status}` })) };
    }
    return {};
  },
  invalidationKeys: (resource) => [
    cloudCacheKeys.listImages,
    cloudCacheKeys.summary,
    ...(resource?.id.startsWith(imagePrefix) && typeof resource.values?.projectId === "string" ? [`ims-image:${resource.id.slice(imagePrefix.length)}:${resource.values.projectId}`] : []),
  ],
  poll: async (session, entry) => {
    const job = await huaweiFetch<Record<string, unknown>>(session, "ims", `/v1/cloudimages/job/${encodeURIComponent(entry.jobId!)}`);
    const status = firstString([job.status], "").toUpperCase();
    const entities = asRecord(job.entities);
    const imageId = firstString([entities.image_id], "");
    const state = status === "SUCCESS" ? "succeeded" : status === "FAIL" ? "failed" : "submitted";
    return {
      state,
      message: state === "failed" ? firstString([job.fail_reason, job.error_code], "The image job failed.") : state === "succeeded" ? "The image job completed successfully." : `The image job is ${status ? status.toLowerCase() : "processing"}.`,
      resourceId: imageId && imageId !== "-" ? `${imagePrefix}${imageId}` : undefined,
    };
  },
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      const server = (await listEcsInstancesForProject(session)).find((server) => server.id === values.instance);
      if (!server) throw new ManagementInputError("The selected server is no longer available in this project.", 404);
      if (!["ACTIVE", "SHUTOFF"].includes(server.status)) throw new ManagementInputError("The selected server is not in a state that allows image creation.", 409);
      const response = await huaweiFetch<{ job_id?: unknown }>(session, "ims", "/v2/cloudimages/action", { method: "POST", body: JSON.stringify({ name: String(values.name), ...(values.description ? { description: String(values.description) } : {}), instance_id: server.id }) });
      return { message: "Image creation submitted. Track the job status to see the new image.", jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "accept" || operation === "reject") {
      const image = await requirePendingShare(session, resource);
      if (operation === "accept" && image.whole) throw new ManagementInputError("Accepting a shared full-ECS image requires selecting a CBR vault, which this workflow does not support.", 409);
      const response = await huaweiFetch<{ job_id?: unknown }>(session, "ims", "/v1/cloudimages/members", { method: "PUT", body: JSON.stringify({ images: [image.id], project_id: session.projectId, status: operation === "accept" ? "accepted" : "rejected" }) });
      return { message: `Shared image ${operation === "accept" ? "acceptance" : "rejection"} submitted.`, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    const image = await requireOwnedImage(session, resource);
    if (operation === "update") {
      if (image.status !== "active") throw new ManagementInputError("Only active images can be updated.", 409);
      const patch: Array<{ op: "replace"; path: string; value: string }> = [];
      if (values.name !== undefined) patch.push({ op: "replace", path: "/name", value: String(values.name) });
      if (values.description !== undefined) patch.push({ op: "replace", path: "/__description", value: String(values.description) });
      if (!patch.length) throw new ManagementInputError("Enter a new image name or description.");
      await huaweiFetch(session, "ims", `/v2/cloudimages/${encodeURIComponent(image.id)}`, { method: "PATCH", body: JSON.stringify(patch) });
      return { message: "Image updated.", resourceId: `${imagePrefix}${image.id}` };
    }
    if (operation === "delete") {
      if (image.isProtected) throw new ManagementInputError("This image is protected. Unprotect it before deleting it.", 409);
      await huaweiFetch(session, "ims", `/v2/images/${encodeURIComponent(image.id)}`, { method: "DELETE" });
      return { message: "Image deleted.", resourceId: `${imagePrefix}${image.id}` };
    }
    if (operation === "members") {
      const members = await imageMembers(session, image.id);
      return { message: `${members.length} share recipient${members.length === 1 ? "" : "s"} loaded.`, facts: members.map((member) => ({ label: `${member.memberId} · ${member.memberType}`, value: `${member.status} · ${member.createdAt}` })) };
    }
    if (operation === "share-add" || operation === "share-delete") {
      const projects = values.projects as string[];
      if (operation === "share-add") {
        if (projects.some((projectId) => !/^[a-f0-9]{32}$/.test(projectId))) throw new ManagementInputError("Enter recipient project IDs with 32 hexadecimal characters.", 400);
      } else {
        const members = await imageMembers(session, image.id);
        if (projects.some((projectId) => !members.some((member) => member.memberId === projectId && member.memberType === "project"))) throw new ManagementInputError("Select recipients this image is currently shared with.", 409);
      }
      const response = await huaweiFetch<{ job_id?: unknown }>(session, "ims", "/v1/cloudimages/members", { method: operation === "share-add" ? "POST" : "DELETE", body: JSON.stringify({ images: [image.id], projects }) });
      return { message: operation === "share-add" ? "Image sharing submitted. Recipients must accept the image before using it." : "Share removal submitted.", jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported image operation.");
  },
};
