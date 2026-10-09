import "server-only";
import { createHash } from "node:crypto";
import { HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { maFetch, maList, notebooks, requireRows, requireOwner, requireWorkspaceScope, requireProject, sanitize } from "@/lib/huawei/services/modelarts-native";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

// Native ModelArts v1 notebook lifecycle only (list/show/create/update/start/stop/delete plus the
// live accessible-workspace, notebook-flavor and dev-image catalogs). Outside the verified subset
// and explicitly unsupported here: free CodeLab instances (the native DEFAULT feature) and
// notebooks in dedicated resource pools, dev-servers, flavor switching on existing notebooks,
// lease renewal, notebook tags, saving or syncing images, mounting OBS/OBSFS/EFS storage, custom
// specs, user VPC injection, SSH endpoints, agencies and authorizations, resource pools, datasets,
// training jobs, workflows, model deployment/services and every other ModelArts plane. No agency,
// authorization, grant, order or payment is ever created automatically; creation sends only the
// typed native fields verified here. Huawei's native failure reasons (fail_reason), notebook
// access URLs and session tokens never reach facts, messages or history, and native HTTP error
// payloads are replaced with sanitized messages that preserve the HTTP status.

// Exact native NotebookResp.status values from the public ModelArts v1 API.
const statuses = ["INIT", "CREATING", "STARTING", "STOPPING", "DELETING", "RUNNING", "STOPPED", "SNAPSHOTTING", "CREATE_FAILED", "START_FAILED", "DELETE_FAILED", "ERROR", "DELETED", "FROZEN"] as const;
type Status = (typeof statuses)[number];
const stable: Status[] = ["RUNNING", "STOPPED"];
const deletable: Status[] = ["RUNNING", "STOPPED", "CREATE_FAILED", "START_FAILED", "DELETE_FAILED", "ERROR"];
const ackFailures: Status[] = ["CREATE_FAILED", "START_FAILED", "DELETE_FAILED", "ERROR", "DELETED", "FROZEN"];
const billingImpact = "A billed ModelArts notebook flavor and its EVS disk are charged pay-per-use while the notebook exists and, for compute, while it runs.";
const nameField: ManagementField = { key: "name", label: "Notebook name", required: true, min: 1, max: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", help: "1-128 characters starting with a letter or digit; letters, digits, hyphens, and underscores." };
const descriptionField: ManagementField = { key: "description", label: "Description", type: "textarea", max: 512, allowEmpty: true, pattern: "^[^<>]*$", help: "Up to 512 characters without the special characters < and >." };

function statusOf(item: Record<string, unknown>): Status | "UNKNOWN" {
  const status = asString(item.status, "");
  return (statuses as readonly string[]).includes(status) ? status as Status : "UNKNOWN";
}
async function detail(s: BetterUiSession, id: string) {
  const body = await maFetch<Record<string, unknown>>(s, `/notebooks/${encodeURIComponent(id)}`, undefined, "The notebook was not found in this project.");
  if (body.id !== id) throw new ManagementInputError("Huawei returned a different or unverified notebook identity.", 409);
  requireOwner(body, "user_id", undefined, "notebook");
  if ("workspace_id" in body && (typeof body.workspace_id !== "string" || !body.workspace_id)) throw new Error("Huawei returned a notebook with an invalid workspace.");
  return body;
}
function knownWorkspace(item: Record<string, unknown>) {
  return typeof item.workspace_id === "string" && item.workspace_id ? item.workspace_id : undefined;
}
async function selectedNotebook(s: BetterUiSession, resource?: ManagementResource): Promise<Record<string, unknown>> {
  const id = resource?.id ?? "";
  if (!id) throw new ManagementInputError("Select a notebook.");
  const current = (await notebooks(s)).find(item => item.id === id);
  if (!current) throw new ManagementInputError("The notebook is no longer in this project.", 404);
  const item = await detail(s, id);
  if ("user_id" in current && item.user_id !== current.user_id) throw new Error("The notebook creator changed between native reads; refresh before managing it.");
  const merged: Record<string, unknown> = { ...item, status: statusOf(item) };
  // Only the billed NOTEBOOK feature is managed here; free CodeLab instances and dedicated
  // resource pool notebooks are foreign products outside this verified contract and are never
  // modified or deleted by this adapter.
  if (merged.feature !== "NOTEBOOK") throw new ManagementInputError("Only billed NOTEBOOK notebooks are managed here. Free CodeLab instances are an explicit gap of this adapter.", 409);
  if ("pool" in merged && merged.pool !== null && (typeof merged.pool !== "object" || Array.isArray(merged.pool))) throw new ManagementInputError("The notebook resource pool could not be verified.", 409);
  const pool = asRecord(merged.pool);
  if ("id" in pool && typeof pool.id !== "string") throw new ManagementInputError("The notebook resource pool could not be verified.", 409);
  if (typeof pool.id === "string" && pool.id) throw new ManagementInputError("Notebooks in dedicated resource pools are an explicit gap of this adapter.", 409);
  if ("pool" in merged && merged.pool !== null) throw new ManagementInputError("The notebook resource pool could not be verified.", 409);
  return merged;
}
function requireStatus(item: Record<string, unknown>, allowed: readonly string[], label: string) {
  const status = statusOf(item);
  // An unrecognised native status blocks the write instead of guessing that it is safe.
  if (!allowed.includes(status)) throw new ManagementInputError(`${label} is unavailable while the notebook status is ${status}.`, 409);
}
async function workspaces(s: BetterUiSession) {
  // GET /v1/{project_id}/workspaces is natively offset/limit paginated, reports total_count and
  // supports filter_accessible to hide workspaces the current user cannot access.
  const body = await maList<{ workspaces?: unknown; total_count?: unknown }>(s, "/workspaces?limit=50&filter_accessible=true", { items: ["workspaces"], kind: "offset", parameter: "offset", size: 50, total: ["total_count"] });
  if (typeof body.total_count !== "number") throw new Error("Huawei omitted the native total of the workspace list; the catalog may be incomplete.");
  const rows = asArray(body.workspaces).map(asRecord);
  requireRows(rows, "workspace");
  for (const row of rows) {
    if (typeof row.name !== "string" || !row.name) throw new Error("Huawei returned a workspace without a valid name.");
    if ("owner" in row && (typeof row.owner !== "string" || !row.owner)) throw new Error("Huawei returned a workspace with an invalid owner.");
  }
  return rows;
}
async function flavors(s: BetterUiSession) {
  // GET /v1/{project_id}/notebooks/flavors returns the whole catalog by default.
  const body = await maFetch<Record<string, unknown>>(s, "/notebooks/flavors");
  if (!Array.isArray(body.flavors)) throw new Error("Huawei returned no native notebook flavor catalog.");
  const rows = body.flavors.map(asRecord);
  requireRows(rows, "notebook flavor");
  for (const row of rows) requireProject(s, row);
  return rows;
}
async function images(s: BetterUiSession, workspaceId: string) {
  // GET /v1/{project_id}/images is natively offset/limit paginated, reports a total and is
  // workspace-scoped; every returned row is checked against the requested workspace.
  const query = new URLSearchParams({ workspace_id: workspaceId, limit: "50" });
  const body = await maList<{ data?: unknown; total?: unknown }>(s, `/images?${query}`, { items: ["data"], kind: "offset", parameter: "offset", size: 50, total: ["total"] });
  if (typeof body.total !== "number") throw new Error("Huawei omitted the native total of the image list; the catalog may be incomplete.");
  const rows = asArray(body.data).map(asRecord);
  requireRows(rows, "image");
  for (const row of rows) requireWorkspaceScope(row, workspaceId, "image");
  // Only dev-environment image service types are offered for notebooks; inference, training and
  // unset service types belong to other ModelArts planes.
  return rows.filter(row => row.type === "BUILD_IN" && (row.service_type === "DEV" || row.service_type === "COMMON") && (! ("status" in row) || row.status === "ACTIVE"));
}
function evsLimit(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : undefined;
}
function usableFlavor(row: Record<string, unknown>) {
  // A flavor is selectable only when Huawei documents it as a billed NOTEBOOK flavor that is on
  // sale (free and sold_out both exactly false), supports managed EVS storage and reports a known
  // positive integer EVS limit; unknown or malformed limits are never guessed; the native limit is a decimal string.
  return row.feature === "NOTEBOOK" && row.free === false && row.sold_out === false
    && asArray(row.storages).some(storage => storage === "EVS")
    && evsLimit(row.evs_max_size) !== undefined;
}
function billedFlavor(rows: Record<string, unknown>[], id: string) {
  const flavor = rows.find(item => item.id === id);
  if (!flavor) throw new ManagementInputError("Select a current notebook flavor.", 404);
  if (!usableFlavor(flavor)) throw new ManagementInputError("Only on-sale billed NOTEBOOK flavors with managed EVS storage and a known EVS capacity limit can be selected.", 409);
  const limit = evsLimit(flavor.evs_max_size);
  if (limit === undefined) throw new ManagementInputError("The flavor's EVS capacity limit could not be verified.", 409);
  return { flavor, limit };
}
function archOf(row: Record<string, unknown>) {
  // Native flavor architectures are x86_64/aarch64 while native image architectures are
  // X86_64/AARCH64; compatibility is compared case-insensitively.
  const arch = typeof row.arch === "string" ? row.arch.toLowerCase() : "";
  return ["x86_64", "aarch64"].includes(arch) ? arch : undefined;
}
function compatibleImage(flavor: Record<string, unknown>, image: Record<string, unknown>) {
  const categories = image.support_res_categories ?? image.resource_categories;
  return compatibleArch(archOf(flavor), archOf(image)) && ["CPU", "GPU", "ASCEND"].includes(String(flavor.category))
    && Array.isArray(categories) && categories.includes(flavor.category);
}
function compatibleArch(flavorArch: string | undefined, imageArch: string | undefined) {
  return flavorArch !== undefined && imageArch !== undefined && flavorArch === imageArch;
}
function wholeNumber(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new ManagementInputError(`${label} must be a whole number between ${min} and ${max}.`);
  return value;
}
function flavorLabel(item: Record<string, unknown>) {
  const flavor = asRecord(item.flavor);
  return firstString([flavor.name, flavor.code, item.flavor, item.flavor_id], "");
}
function imageLabel(item: Record<string, unknown>) {
  const image = asRecord(item.image);
  return firstString([image.name, image.id, item.image_name, item.image_id], "");
}
const fact = (label: string, value: unknown) => ({ label, value: typeof value === "string" || typeof value === "number" ? String(value) : "-" });
const imageChoices = (rows: Record<string, unknown>[]) => rows.map(item => ({ value: String(item.id), label: `${asString(item.name, String(item.id))} · ${asString(item.arch, "")}` }));

// Fingerprints retain only the desired field names and a digest, never their values.
function verification(changes: Record<string, unknown>) {
  const fields = Object.keys(changes).sort();
  return { fields, digest: createHash("sha256").update(JSON.stringify(fields.map(field => [field, changes[field]]))).digest("hex") };
}

// Every post-write anomaly is an uncertain plain Error, never an input error: the request already
// reached Huawei, so the caller must verify the cloud state instead of retrying blindly.
function verifyAck(ack: Record<string, unknown>, expect: { id?: string; workspaceId?: string; feature?: string; userId?: string; ignoreStatus?: boolean }) {
  if ((typeof ack.error_code === "string" && ack.error_code) || (typeof ack.error_msg === "string" && ack.error_msg) || Object.keys(asRecord(ack.error)).length) throw new Error("Huawei reported a business error for this ModelArts write. Verify the notebook in ModelArts before retrying.");
  if (expect.id !== undefined) {
    if (ack.id !== expect.id) throw new Error("Huawei returned a different notebook for this operation. The request may have affected another resource; verify it in ModelArts.");
  } else if (typeof ack.id !== "string" || !ack.id) throw new Error("Huawei returned no notebook ID for this creation.");
  if (expect.workspaceId !== undefined && "workspace_id" in ack && ack.workspace_id !== expect.workspaceId) throw new Error("Huawei returned a notebook outside the expected workspace for this operation. Verify it in ModelArts.");
  if (expect.feature !== undefined && "feature" in ack && ack.feature !== expect.feature) throw new Error("Huawei returned a notebook with an unexpected feature for this operation. Verify it in ModelArts.");
  if (expect.userId !== undefined && "user_id" in ack && (typeof ack.user_id !== "string" || !ack.user_id || ack.user_id !== expect.userId)) throw new Error("Huawei returned a notebook owned by a different user for this operation. Verify it in ModelArts.");
  if ("billing_items" in ack && !Array.isArray(ack.billing_items)) throw new Error("Huawei returned an invalid billing report for this operation.");
  const status = statusOf(ack);
  if (!expect.ignoreStatus && status !== "UNKNOWN" && (ackFailures as readonly string[]).includes(status)) throw new Error(`Huawei reported the notebook in the ${status} state after this operation. Verify it in ModelArts before retrying.`);
}

export const modelartsManagement: ManagementAdapter = {
  title: "ModelArts Notebooks",
  operations: [
    { id: "create", label: "Create notebook", kind: "create", description: "Create one billed notebook from current accessible workspace, flavor, image and EVS storage catalogs. Free CodeLab instances, dedicated pools and custom saved images are not created here.", fields: [nameField, descriptionField, { key: "workspace", label: "Workspace", type: "select", source: "workspaces", required: true, help: "ModelArts workspaces accessible to this user in this project." }, { key: "flavor", label: "Flavor", type: "select", source: "flavors", required: true, help: "Current on-sale billed notebook flavors with managed EVS storage." }, { key: "image", label: "Image", type: "select", source: "images", required: true, help: "Current dev-environment images across all accessible workspaces; the image is rechecked for the selected workspace." }, { key: "storageSize", label: "EVS storage capacity (GB)", type: "number", required: true, min: 5, max: 4096, help: "Managed EVS disk capacity. The flavor's native EVS limit is rechecked before creation." }], impact: `${billingImpact} Creation starts compute immediately when the notebook becomes available.` },
    { id: "inspect", label: "View notebook configuration", kind: "inspect", description: "Inspect the notebook's flavor, image, storage and status without exposing its access URL, session token or native failure reason.", fields: [] },
    { id: "update", label: "Rename or edit description", kind: "update", description: "Change only the notebook name or description. Flavor, image, storage, network and workspace configuration are preserved.", fields: [{ ...nameField, required: false }, descriptionField], allowedStatuses: stable },
    { id: "change-image", label: "Switch image", kind: "action", description: "Switch a stopped notebook to another current dev-environment image compatible with its flavor. All other configuration is preserved.", fields: [{ key: "image", label: "New image", type: "select", source: "images", required: true }], allowedStatuses: ["STOPPED"], confirmation: true, impact: "The notebook uses the new image the next time it starts. Files outside the persistent EVS storage can be replaced by the new image." },
    { id: "expand-storage", label: "Expand EVS storage", kind: "action", description: "Increase the managed EVS disk of a stopped notebook. Capacity can only grow, never shrink.", fields: [{ key: "storageNewSize", label: "New EVS capacity (GB)", type: "number", required: true, min: 5, max: 4096 }], allowedStatuses: ["STOPPED"], confirmation: true, impact: "The expanded EVS capacity is billed immediately at pay-per-use rates and cannot be reduced later." },
    { id: "start", label: "Start notebook", kind: "action", description: "Start a stopped notebook with an optional automatic stop timer.", fields: [{ key: "autoStopHours", label: "Automatic stop after hours", type: "number", min: 1, max: 72, help: "Leave empty to use Huawei's default one-hour automatic stop." }], allowedStatuses: ["STOPPED", "START_FAILED"], confirmation: true, impact: `${billingImpact} Compute charges resume while the notebook runs.` },
    { id: "stop", label: "Stop notebook", kind: "action", description: "Stop a running notebook. The EVS disk and its data are kept.", fields: [], allowedStatuses: ["RUNNING"], confirmation: true, impact: "Compute charges stop once the notebook is stopped, while EVS storage charges continue. Unsaved in-memory work and processes are lost." },
    { id: "delete", label: "Delete notebook", kind: "delete", description: "Permanently delete a notebook together with its managed EVS disk.", fields: [], allowedStatuses: deletable, confirmation: true, impact: "The notebook and every file on its EVS disk are permanently deleted. Charges stop only after deletion completes." },
  ],
  inventory: async s => {
    const rows = await notebooks(s);
    return rows.map(item => {
      const volume = asRecord(item.volume);
      return { id: String(item.id), name: asString(item.name, String(item.id)), status: statusOf(item), values: { flavor: flavorLabel(item), image: imageLabel(item), feature: asString(item.feature, ""), storage: typeof volume.capacity === "number" ? volume.capacity : "", workspace: asString(item.workspace_id, "") } };
    });
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [workspaceRows, flavorRows] = await Promise.all([workspaces(s), flavors(s)]);
      const usable = flavorRows.filter(usableFlavor);
      // Images are offered as the union across every fresh accessible workspace so non-default
      // workspaces remain usable; execute rechecks the image in the selected workspace.
      const lists = await Promise.all(workspaceRows.map(row => images(s, String(row.id))));
      const union: Record<string, unknown>[] = [];
      for (const list of lists) for (const row of list) {
        const previous = union.find(seen => seen.id === row.id);
        if (previous && (previous.arch !== row.arch || JSON.stringify(previous.support_res_categories ?? previous.resource_categories) !== JSON.stringify(row.support_res_categories ?? row.resource_categories))) throw new Error("Huawei returned conflicting native image identities across workspaces.");
        if (!previous) union.push(row);
      }
      return {
        workspaces: workspaceRows.map(item => ({ value: String(item.id), label: String(item.name) })),
        flavors: usable.map(item => ({ value: String(item.id), label: `${asString(item.name, String(item.id))} · ${asString(item.category, "")} · ${asString(item.vcpus, "")} vCPU` })),
        images: imageChoices(union.filter(row => usable.some(flavor => compatibleImage(flavor, row)))),
      };
    }
    if (operation === "change-image") {
      const item = await selectedNotebook(s, resource);
      const workspaceId = knownWorkspace(item);
      if (!workspaceId) return {};
      const [imageRows, flavorRows] = await Promise.all([images(s, workspaceId), flavors(s)]);
      const flavor = flavorRows.find(row => row.id === item.flavor) ?? {};
      return { images: imageChoices(imageRows.filter(row => compatibleImage(flavor, row))) };
    }
    return {};
  },
  execute: async (s, operation, v, resource) => {
    const write = (path: string, method: string, body?: unknown) => maFetch<Record<string, unknown>>(s, path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (operation === "create") {
      const size = wholeNumber(v.storageSize, "EVS storage capacity", 5, 4096);
      const workspaceId = String(v.workspace);
      const [workspaceRows, flavorRows, imageRows] = await Promise.all([workspaces(s), flavors(s), images(s, workspaceId)]);
      if (!workspaceRows.some(item => item.id === workspaceId)) throw new ManagementInputError("Select a current accessible workspace of this project.", 404);
      const { flavor, limit } = billedFlavor(flavorRows, String(v.flavor));
      const image = imageRows.find(item => item.id === v.image);
      if (!image) throw new ManagementInputError("The selected image is not available for the selected workspace. Select a current dev-environment image.", 404);
      if (!compatibleImage(flavor, image)) throw new ManagementInputError("The selected image's processor architecture does not match the selected flavor, or its supported resource category could not be verified.", 409);
      if (size > limit) throw new ManagementInputError(`This flavor supports at most ${limit} GB of EVS storage.`);
      const ack = await write("/notebooks", "POST", { name: v.name, description: typeof v.description === "string" ? v.description : "", feature: "NOTEBOOK", flavor: v.flavor, image_id: v.image, volume: { category: "EVS", capacity: size }, workspace_id: workspaceId });
      verifyAck(ack, { workspaceId, feature: "NOTEBOOK", userId: s.userId });
      return { message: "Notebook creation accepted. Compute billing starts when it becomes available; verify its status before relying on it.", resourceId: String(ack.id), jobId: String(ack.id), asynchronous: true };
    }
    const item = await selectedNotebook(s, resource);
    const id = String(item.id);
    const expect = { id, workspaceId: knownWorkspace(item), feature: "NOTEBOOK", userId: typeof item.user_id === "string" ? item.user_id : undefined };
    if (operation === "inspect") {
      const volume = asRecord(item.volume);
      return {
        message: "Current ModelArts notebook configuration. The native access URL, session token and failure reason are not shown.",
        facts: [
          fact("Name", item.name), fact("Status", item.status), fact("Feature", item.feature), fact("Description", item.description),
          fact("Flavor", flavorLabel(item) || undefined), fact("Image", imageLabel(item) || undefined),
          fact("Storage category", volume.category), fact("Storage capacity (GB)", volume.capacity), fact("Storage status", volume.status), fact("Mount path", volume.mount_path),
          fact("Workspace ID", item.workspace_id), fact("Billing items", asArray(item.billing_items).join(", ") || undefined),
        ],
      };
    }
    if (operation === "update") {
      requireStatus(item, stable, "Editing metadata");
      // The native update accepts only the provided fields; every other setting keeps its current value.
      const changes: Record<string, unknown> = {};
      if (v.name !== undefined) changes.name = v.name;
      if (v.description !== undefined) changes.description = v.description;
      if (!Object.keys(changes).length) throw new ManagementInputError("Enter a new name or description.");
      const ack = await write(`/notebooks/${encodeURIComponent(id)}`, "PUT", changes);
      verifyAck(ack, expect);
      return { message: "Notebook metadata update accepted. Completion waits for the requested fields in a fresh native read.", resourceId: id, jobId: id, asynchronous: true, verification: verification(changes) };
    }
    if (operation === "change-image") {
      requireStatus(item, ["STOPPED"], "Switching the image");
      const workspaceId = knownWorkspace(item);
      // The notebook's own workspace is used; a missing workspace never defaults to the "0" space.
      if (!workspaceId) throw new ManagementInputError("The notebook's workspace could not be verified. Image switching is blocked.", 409);
      const [imageRows, flavorRows] = await Promise.all([images(s, workspaceId), flavors(s)]);
      const image = imageRows.find(row => row.id === v.image);
      if (!image) throw new ManagementInputError("The selected image is not available for this notebook's workspace.", 404);
      const currentFlavor = flavorRows.find(row => row.id === item.flavor) ?? {};
      if (!compatibleImage(currentFlavor, image)) throw new ManagementInputError("The selected image's processor architecture does not match this notebook's flavor.", 409);
      const ack = await write(`/notebooks/${encodeURIComponent(id)}`, "PUT", { image_id: v.image });
      verifyAck(ack, expect);
      return { message: "Image switch accepted. Completion waits for a fresh native read of the selected image; it is used on the next start.", resourceId: id, jobId: id, asynchronous: true, verification: verification({ image_id: v.image }) };
    }
    if (operation === "expand-storage") {
      requireStatus(item, ["STOPPED"], "Expanding storage");
      const volume = asRecord(item.volume);
      if (asString(volume.category, "") !== "EVS") throw new ManagementInputError("Only managed EVS storage can be expanded here.", 409);
      const current = volume.capacity;
      if (typeof current !== "number" || !Number.isSafeInteger(current) || current <= 0) throw new ManagementInputError("The notebook's current EVS capacity could not be verified. Expansion is blocked.", 409);
      const size = wholeNumber(v.storageNewSize, "New EVS capacity", 5, 4096);
      if (size <= current) throw new ManagementInputError(`Enter a capacity greater than the current ${current} GB. Storage can only be expanded.`);
      // The limit comes from the notebook's native flavor ID, never its display label, and an
      // unknown limit blocks the expansion instead of guessing a safe maximum.
      const flavor = (await flavors(s)).find(row => row.id === item.flavor);
      if (!flavor) throw new ManagementInputError("The notebook's current flavor could not be verified. Expansion is blocked.", 409);
      const limit = evsLimit(flavor.evs_max_size);
      if (limit === undefined) throw new ManagementInputError("The flavor's EVS capacity limit could not be verified. Expansion is blocked.", 409);
      if (!["COMMON", "INTERNATIONAL"].includes(String(flavor.grow_support_type))) throw new ManagementInputError("The flavor does not report EVS expansion support for the international site.", 409);
      if (size > limit) throw new ManagementInputError(`This flavor supports at most ${limit} GB of EVS storage.`);
      const ack = await write(`/notebooks/${encodeURIComponent(id)}`, "PUT", { storage_new_size: size });
      verifyAck(ack, expect);
      return { message: `EVS expansion to ${size} GB accepted. The larger capacity can increase storage charges; completion waits for the native capacity to change.`, resourceId: id, jobId: id, asynchronous: true, verification: verification({ storage_new_size: size }) };
    }
    if (operation === "start") {
      requireStatus(item, ["STOPPED", "START_FAILED"], "Starting");
      let query = "";
      if (v.autoStopHours !== undefined) {
        const hours = wholeNumber(v.autoStopHours, "Automatic stop hours", 1, 72);
        query = `?duration=${hours * 3_600_000}&type=TIMING`;
      }
      const ack = await write(`/notebooks/${encodeURIComponent(id)}/start${query}`, "POST");
      verifyAck(ack, expect);
      return { message: "Notebook start accepted. Compute billing resumes once it runs.", resourceId: id, jobId: id, asynchronous: true };
    }
    if (operation === "stop") {
      requireStatus(item, ["RUNNING"], "Stopping");
      const ack = await write(`/notebooks/${encodeURIComponent(id)}/stop`, "POST");
      verifyAck(ack, expect);
      return { message: "Notebook stop accepted. EVS storage and its data are kept and continue to be billed.", resourceId: id, jobId: id, asynchronous: true };
    }
    if (operation === "delete") {
      requireStatus(item, deletable, "Deletion");
      if (asRecord(item.volume).category !== "EVS" || ("data_volumes" in item && (!Array.isArray(item.data_volumes) || item.data_volumes.length))) throw new ManagementInputError("Deletion with other storage types or additional data volumes requires their native storage workflow.", 409);
      // Exact fresh name comparison immediately before the destructive write.
      const freshName = typeof item.name === "string" ? item.name : "";
      if (!resource?.name || freshName !== resource.name) throw new ManagementInputError("The notebook's current name does not match the selected name. Refresh the inventory and confirm the deletion again.", 409);
      const ack = await write(`/notebooks/${encodeURIComponent(id)}`, "DELETE");
      verifyAck(ack, { ...expect, ignoreStatus: true });
      return { message: "Notebook deletion accepted. The notebook and its EVS data are removed permanently; charges stop once deletion completes.", resourceId: id, jobId: id, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported ModelArts operation.");
  },
  poll: async (s, entry) => {
    const label = entry.operation;
    if (!["Create notebook", "Start notebook", "Stop notebook", "Delete notebook", "Rename or edit description", "Switch image", "Expand EVS storage"].includes(label)) throw new ManagementInputError("This ModelArts operation is not polled.");
    // The original native notebook ID is the poll identity for every asynchronous notebook operation.
    const id = entry.jobId;
    if (!id || entry.resourceId !== id) throw new ManagementInputError("The ModelArts poll is missing its original notebook identity.");
    let item: Record<string, unknown>;
    try {
      // The raw transport error is required here: only a genuine native 404 confirms deletion.
      item = await maFetch<Record<string, unknown>>(s, `/notebooks/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof HuaweiApiError && error.status === 404) {
        if (label === "Delete notebook") return { state: "succeeded", message: "The notebook was deleted together with its EVS disk.", resourceId: id };
        return { state: "submitted", message: "The notebook is currently missing. This does not establish the original operation result; inspect ModelArts.", resourceId: id };
      }
      const clean = sanitize(error);
      if (clean !== error) throw clean;
      throw error;
    }
    if (item.id !== id) throw new ManagementInputError("Huawei returned a different notebook for this operation.");
    requireOwner(item, "user_id", undefined, "notebook");
    if (item.feature !== "NOTEBOOK") throw new Error("Huawei returned an unverifiable notebook feature for this operation.");
    if (["Rename or edit description", "Switch image", "Expand EVS storage"].includes(label)) {
      const check = entry.verification;
      const allowed = label === "Rename or edit description" ? ["name", "description"] : label === "Switch image" ? ["image_id"] : ["storage_new_size"];
      if (!check || !Array.isArray(check.fields) || !check.fields.length || check.fields.some(field => !allowed.includes(field)) || new Set(check.fields).size !== check.fields.length || !/^[a-f0-9]{64}$/.test(check.digest)) throw new ManagementInputError("The ModelArts configuration observer is missing or invalid.");
      const actual: Record<string, unknown> = {};
      for (const field of check.fields) actual[field] = field === "image_id" ? asRecord(item.image).id : field === "storage_new_size" ? asRecord(item.volume).capacity : item[field];
      const typesKnown = check.fields.every(field => field === "storage_new_size" ? typeof actual[field] === "number" && Number.isSafeInteger(actual[field]) && asRecord(item.volume).category === "EVS" : typeof actual[field] === "string");
      if (typesKnown && verification(actual).digest === check.digest) return { state: "succeeded", message: "A fresh native read verifies the requested notebook configuration.", resourceId: id };
      return { state: "submitted", message: "The requested notebook configuration is not yet verified by a fresh native read.", resourceId: id };
    }
    const status = statusOf(item);
    const failed = (message: string) => ({ state: "failed" as const, message, resourceId: id });
    if (status === "FROZEN") return failed("The notebook is frozen. Resolve the account or resource state in ModelArts first.");
    if (label === "Create notebook") {
      if (status === "RUNNING") return { state: "succeeded", message: "The notebook was created and is running. Compute billing is active.", resourceId: id };
      if (status === "STOPPED") return { state: "succeeded", message: "The notebook was created and is currently stopped.", resourceId: id };
      if (["CREATE_FAILED", "ERROR", "DELETED", "DELETING"].includes(status)) return failed(`The notebook was not created successfully (status ${status}). Review the notebook in ModelArts before retrying.`);
      return { state: "submitted", message: `Notebook creation is ${status === "UNKNOWN" ? "still processing" : `in progress (${status})`}.` };
    }
    if (label === "Start notebook") {
      if (status === "RUNNING") return { state: "succeeded", message: "The notebook is running. Compute billing is active.", resourceId: id };
      if (status === "START_FAILED" || status === "ERROR") return failed(`The notebook failed to start (status ${status}). Review the notebook in ModelArts before retrying.`);
      // A stale STOPPED status right after acceptance is not a failure: the native status can lag
      // behind the accepted start, so the poll stays submitted until RUNNING or a terminal failure.
      if (["DELETED", "DELETING", "CREATE_FAILED", "DELETE_FAILED"].includes(status)) return failed(`The notebook cannot start because it is ${status}.`);
      return { state: "submitted", message: `The notebook start is ${status === "UNKNOWN" ? "still processing" : `in progress (currently ${status})`}.` };
    }
    if (label === "Stop notebook") {
      if (status === "STOPPED") return { state: "succeeded", message: "The notebook is stopped. Compute billing paused; EVS storage and its data are kept.", resourceId: id };
      if (status === "ERROR") return failed("Stopping the notebook failed. Review the notebook in ModelArts before retrying.");
      if (["DELETED", "DELETING", "CREATE_FAILED", "START_FAILED", "DELETE_FAILED"].includes(status)) return failed(`The notebook cannot be stopped because it is ${status}.`);
      return { state: "submitted", message: `The notebook stop is ${status === "UNKNOWN" ? "still processing" : `in progress (currently ${status})`}.` };
    }
    if (status === "DELETED") return { state: "succeeded", message: "The notebook was deleted together with its EVS disk.", resourceId: id };
    if (status === "DELETE_FAILED" || status === "ERROR") return failed(`Deleting the notebook failed (status ${status}). Review the notebook in ModelArts before retrying.`);
    return { state: "submitted", message: `Notebook deletion is ${status === "UNKNOWN" ? "still processing" : `in progress (currently ${status})`}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listModelArtsNotebooks, cloudCacheKeys.summary],
};
