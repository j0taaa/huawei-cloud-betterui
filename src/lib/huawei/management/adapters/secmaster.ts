import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { listSecMasterWorkspacesForProject } from "@/lib/huawei/services/secmaster";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

// SecMaster SDK v1 workspace/data-space/pipe contracts. System-defined SIEM resources are immutable here.
const base = (s: BetterUiSession) => `/v1/${s.projectId}/workspaces`;
const path = (s: BetterUiSession, r: ManagementResource) => `${base(s)}/${encodeURIComponent(r.id)}`;
const name: ManagementField = { key: "name", label: "Name", required: true, max: 64 };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 1024, allowEmpty: true };
const space: ManagementField = { key: "space", label: "Data space", type: "select", required: true, source: "spaces" };
const pipe: ManagementField = { key: "pipe", label: "Data pipe", type: "select", required: true, source: "pipes" };
const pick = (value: string, label = value): ManagementChoice => ({ value, label });
async function workspace(s: BetterUiSession, r: ManagementResource) {
  const response = await huaweiFetch<Record<string, unknown>>(s, "secmaster", path(s, r));
  const item = asRecord(response.workspace);
  if (item.id !== r.id || item.project_id !== s.projectId || item.region_id !== s.region) throw new ManagementInputError("The workspace could not be verified in this project and region.", 404);
  return item;
}
async function rows(s: BetterUiSession, r: ManagementResource, kind: "dataspaces" | "pipes", query: Record<string, string> = {}) {
  const body = await huaweiList<Record<string, unknown>>(s, "secmaster", `${path(s, r)}/siem/${kind}?${new URLSearchParams({ limit: "100", offset: "0", ...query })}`, { items: ["records"], kind: "offset", parameter: "offset", size: 100, total: ["count"] });
  return asArray(body.records).map(asRecord).filter(item => (!item.project_id || item.project_id === s.projectId) && (!item.workspace_id || item.workspace_id === r.id));
}
async function ownedSpace(s: BetterUiSession, r: ManagementResource, id: string) {
  const item = (await rows(s, r, "dataspaces")).find(item => item.dataspace_id === id);
  if (!item) throw new ManagementInputError("The data space was not found in this workspace.", 404);
  return item;
}
async function ownedPipe(s: BetterUiSession, r: ManagementResource, id: string) {
  const item = (await rows(s, r, "pipes")).find(item => item.pipe_id === id);
  if (!item) throw new ManagementInputError("The data pipe was not found in this workspace.", 404);
  return item;
}
function userDefined(item: Record<string, unknown>, kind: "dataspace" | "pipe") {
  if (item[`${kind}_type`] !== "user-defined") throw new ManagementInputError("System-defined or unverified SIEM resources cannot be changed through this workflow.", 409);
}
const pipelineNamePattern = "^(?!(?:isap_|csb_|secmaster_|sec_|s_sec_|i_sec_|l_sec_|security_))(?!.*__)[a-z](?:[a-z0-9_]*[a-z0-9])?$";
const facts = (item: Record<string, unknown>, keys: string[]) => keys.map(key => ({ label: key.replaceAll("_", " "), value: typeof item[key] === "boolean" || typeof item[key] === "number" ? String(item[key]) : asString(item[key], "-") }));

export const secmasterManagement: ManagementAdapter = {
  title: "SecMaster Workspaces and SIEM Data",
  operations: [
    { id: "create", label: "Create workspace", description: "Create a security operations workspace in the selected project and region. This does not purchase a SecMaster edition or enable new protection services.", kind: "create", fields: [name, description, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }] },
    { id: "create-view", label: "Create workspace view", description: "Create a view associated with an existing regular workspace in the same project and region.", kind: "create", fields: [name, description, { key: "workspace", label: "Associated workspace", type: "select", required: true, source: "workspaces" }] },
    { id: "update", label: "Edit workspace", description: "Rename the workspace or update its description, preserving its view binding and enterprise-project scope.", kind: "update", fields: [name, description] },
    { id: "inspect", label: "View workspace configuration", description: "Inspect workspace scope, enterprise project, creator, and associated view.", kind: "inspect", fields: [] },
    { id: "delete", label: "Delete workspace", description: "Delete a workspace or view after checking its current project and region. Huawei checks that initialization has completed.", kind: "delete", fields: [{ key: "permanent", label: "Permanently delete workspace content", type: "boolean", defaultValue: false, help: "Off by default. Enabling this permanently removes workspace content." }], confirmation: true, impact: "Deleting a workspace stops its playbooks, workflows, and engines and removes it from security operations. Permanent deletion also destroys its assets, checks, alerts, incidents, and stored content." },
    { id: "spaces", label: "View data spaces", description: "List the workspace's system and user data spaces.", kind: "inspect", fields: [] },
    { id: "create-space", label: "Create data space", description: "Add a user data space to organize SIEM data pipes in this workspace.", kind: "action", fields: [name, description] },
    { id: "update-space", label: "Edit data space description", description: "Change a user-defined data space's description. A blank description clears it.", kind: "action", fields: [space, description] },
    { id: "delete-space", label: "Delete empty data space", description: "Delete a user-defined data space only when it contains no data pipes.", kind: "action", fields: [space], confirmation: true, impact: "The selected data space is permanently removed. System-defined data spaces are protected." },
    { id: "pipes", label: "View data pipes", description: "Inspect data-pipe ownership, data space, partition count, and retention.", kind: "inspect", fields: [] },
    { id: "create-pipe", label: "Create data pipe", description: "Create a user data pipe in a current data space with explicit partitions and retention. Ingestion, indexes, and shipping rules are configured separately.", kind: "action", fields: [
      { ...name, label: "Pipe name", max: 128, min: 1, pattern: pipelineNamePattern, help: "Lowercase letters, digits, and single internal underscores. Reserved SecMaster prefixes are unavailable." },
      description, space,
      { key: "shards", label: "Partitions", type: "number", required: true, min: 1, max: 64, defaultValue: 1 },
      { key: "retention", label: "Retention (days)", type: "number", required: true, min: 7, max: 180, defaultValue: 30, help: "180 days requires Huawei approval in regions that enforce this limit." },
      { key: "timestamp", label: "Timestamp field", max: 128, help: "Optional field used as the event timestamp." },
    ], impact: "Data ingestion, indexing, and retention can incur SecMaster charges. Confirm partition count and storage retention." },
    { id: "update-pipe", label: "Edit data pipe description", description: "Update a user pipe's description without changing its partitions or retention. Blank clears the description.", kind: "action", fields: [pipe, description] },
    { id: "pipe-retention", label: "Change data pipe retention", description: "Update a user pipe's retention while preserving other settings.", kind: "action", fields: [pipe, { key: "retention", label: "Retention (days)", type: "number", required: true, min: 1, max: 3600 }], confirmation: true, impact: "Reducing retention can permanently remove older security data; increasing retention can increase storage charges." },
    { id: "delete-pipe", label: "Delete data pipe", description: "Delete a user-defined pipe in this workspace. System-defined pipes are protected.", kind: "action", fields: [pipe], confirmation: true, impact: "This pipe and its retained security data are permanently deleted. Collection and analysis rules using it can stop working." },
  ],
  inventory: async s => (await listSecMasterWorkspacesForProject(s)).map(w => ({ id: w.id, name: w.name, values: { name: w.name, description: w.description, isView: w.isView === true } })),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-view") return { workspaces: (await listSecMasterWorkspacesForProject(s)).filter(w => w.isView === false && w.regionId === s.region).map(w => pick(w.id, w.name)) };
    if (!resource) return {};
    if (["update-space", "delete-space", "create-pipe"].includes(operation)) return { spaces: (await rows(s, resource, "dataspaces")).filter(space => operation === "create-pipe" || space.dataspace_type === "user-defined").map(space => pick(asString(space.dataspace_id), `${space.dataspace_name} · ${space.dataspace_type}`)) };
    if (["update-pipe", "pipe-retention", "delete-pipe"].includes(operation)) return { pipes: (await rows(s, resource, "pipes")).filter(pipe => pipe.pipe_type === "user-defined").map(pipe => pick(asString(pipe.pipe_id), `${pipe.pipe_name} · ${pipe.storage_period ?? "-"} days`)) };
    return {};
  },
  execute: async (s, operation, v, resource) => {
    const write = async (target: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "secmaster", target, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (["create", "create-view"].includes(operation)) {
      if (operation === "create-view") {
        const parent = (await listSecMasterWorkspacesForProject(s)).find(w => w.id === v.workspace && w.isView === false && w.regionId === s.region);
        if (!parent) throw new ManagementInputError("Select a regular workspace in this project and region.");
        const fresh = await workspace(s, { id: parent.id, name: parent.name });
        if (fresh.is_view !== false) throw new ManagementInputError("The selected workspace is now a view.");
      }
      const r = await write(base(s), "POST", { name: v.name, description: v.description ?? "", region_id: s.region, project_name: s.projectName, is_view: operation === "create-view", ...(operation === "create-view" ? { view_bind_id: v.workspace } : { enterprise_project_id: v.enterpriseProjectId ?? "0" }) });
      return { message: "Workspace creation accepted. Huawei initializes its security operations resources in the background.", resourceId: asString(r.id, "") || undefined, asynchronous: true };
    }
    if (!resource) throw new ManagementInputError("Select a current workspace.");
    const w = await workspace(s, resource); const target = path(s, resource);
    if (operation === "inspect") return { message: "Current workspace configuration.", facts: facts(w, ["name", "description", "project_name", "region_id", "enterprise_project_name", "is_view", "view_bind_id", "view_bind_name", "creator_name", "create_time", "update_time"]) };
    if (operation === "update") { await write(target, "PUT", { name: v.name, description: v.description ?? "" }); return { message: "Workspace metadata updated." }; }
    if (operation === "delete") { await write(`${target}?permanent_delete=${v.permanent === true ? "true" : "false"}`, "DELETE"); return { message: v.permanent === true ? "Permanent workspace deletion accepted." : "Workspace deletion accepted without requesting permanent content deletion.", asynchronous: true }; }
    if (w.is_view !== false) throw new ManagementInputError("Manage SIEM data in a regular workspace. Views are managed through their associated workspace.");
    if (operation === "spaces") { const spaces = await rows(s, resource, "dataspaces"); return { message: `${spaces.length} data spaces loaded.`, facts: spaces.map(space => ({ label: asString(space.dataspace_name), value: `${space.dataspace_type} · ${space.dataspace_id} · ${asString(space.description, "")}` })) }; }
    if (operation === "create-space") { const r = await write(`${target}/siem/dataspaces`, "POST", { dataspace_name: v.name, description: v.description ?? "" }); return { message: "Data space created.", resourceId: asString(r.dataspace_id, "") || undefined }; }
    if (["update-space", "delete-space"].includes(operation)) {
      const space = await ownedSpace(s, resource, String(v.space)); userDefined(space, "dataspace");
      if (operation === "update-space") { await write(`${target}/siem/dataspaces/${encodeURIComponent(String(v.space))}`, "PUT", { description: v.description ?? "" }); return { message: "Data space description updated." }; }
      if ((await rows(s, resource, "pipes", { dataspace_id: String(v.space) })).some(pipe => pipe.dataspace_id === v.space)) throw new ManagementInputError("Delete every data pipe in this space first.");
      await write(`${target}/siem/dataspaces/${encodeURIComponent(String(v.space))}`, "DELETE"); return { message: "Empty data space deleted." };
    }
    if (operation === "pipes") { const pipes = await rows(s, resource, "pipes"); return { message: `${pipes.length} data pipes loaded.`, facts: pipes.map(pipe => ({ label: asString(pipe.pipe_name), value: `${pipe.pipe_type} · ${pipe.dataspace_name ?? pipe.dataspace_id} · ${pipe.shards ?? "-"} partitions · ${pipe.storage_period ?? "-"} days · ${pipe.pipe_id}` })) }; }
    if (operation === "create-pipe") {
      await ownedSpace(s, resource, String(v.space));
      const r = await write(`${target}/siem/pipes`, "POST", { dataspace_id: v.space, pipe_name: v.name, description: v.description ?? "", shards: v.shards, storage_period: v.retention, ...(v.timestamp ? { timestamp_field: v.timestamp } : {}) });
      return { message: "Data pipe creation accepted. Check its processing status before connecting ingestion.", resourceId: asString(r.pipe_id, "") || undefined, asynchronous: true };
    }
    if (["update-pipe", "pipe-retention", "delete-pipe"].includes(operation)) {
      const pipe = await ownedPipe(s, resource, String(v.pipe)); userDefined(pipe, "pipe");
      const pipePath = `${target}/siem/pipes/${encodeURIComponent(String(v.pipe))}`;
      if (operation === "delete-pipe") { await write(pipePath, "DELETE"); return { message: "Data pipe deletion accepted.", asynchronous: true }; }
      await write(pipePath, "PUT", operation === "pipe-retention" ? { storage_period: v.retention } : { description: v.description ?? "" });
      return { message: operation === "pipe-retention" ? "Data pipe retention update accepted." : "Data pipe description update accepted.", asynchronous: true };
    }
    throw new ManagementInputError("Unsupported SecMaster operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listSecMasterWorkspaces],
};
