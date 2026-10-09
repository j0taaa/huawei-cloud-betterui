import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation } from "@/lib/management-contract";
import { HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { asmFetch, listAsmMeshDefinitionsForProject } from "@/lib/huawei/services/asm";
import { collectList } from "@/lib/huawei/pagination";
import { huaweiFetch as cceFetch } from "@/lib/huawei/http";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

// Mesh lifecycle uses native ASM v1. Live compatible cluster choices come from ASM v3.
// Advanced mesh configuration, release and canary upgrade APIs are separate workflows.
const base = (s: BetterUiSession) => `/v1/${s.projectId}/meshes`;
const createLabel = "Create mesh";
const deleteLabel = "Delete mesh";
const meshName: ManagementField = { key: "name", label: "Mesh name", required: true, pattern: "^[a-z][a-z0-9-]{2,62}[a-z0-9]$", help: "4-64 characters: lowercase letters, digits, and hyphens, starting with a letter and without a trailing hyphen." };
const clusterField: ManagementField = { key: "clusters", label: "CCE clusters", type: "list", source: "clusters", required: true, help: "Clusters currently offered by ASM in this project. Select control-plane nodes for each selected cluster." };
const nodesField: ManagementField = { key: "nodes", label: "Control-plane nodes", type: "list", source: "nodes", required: true, help: "Select at least one Ready node for each selected cluster. Node choices include their cluster name." };
const meshRows = listAsmMeshDefinitionsForProject;
const huaweiFetch = <T>(session: BetterUiSession, _service: "asm", path: string, init?: RequestInit) => asmFetch<T>(session, path, init);
const knownPhases = new Set(["Running", "Creating", "CreateFailed", "Deleting", "DeleteFailed", "Updating", "UpdateFailed", "Upgrading", "UpgradeFailed"]);
const phaseText = (mesh: Record<string, unknown>) => { const phase = asString(asRecord(mesh.status).phase, ""); return knownPhases.has(phase) ? phase : "unknown"; };

async function availableClusters(session: BetterUiSession) {
  const body = asRecord(await asmFetch(session, `/v3/projects/${session.projectId}/clusters-to-be-added`));
  if (!Array.isArray(body.items)) throw new ManagementInputError("Huawei returned an incomplete ASM cluster catalog.", 409);
  const rows = body.items.map(asRecord);
  const ids = rows.map(row => asString(asRecord(row.metadata).uid, ""));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ManagementInputError("Huawei returned an unverified ASM cluster catalog.", 409);
  return rows.filter(row => asRecord(row.status).phase === "Available");
}
async function clusterNodes(session: BetterUiSession, clusterId: string) {
  let body: Record<string, unknown>;
  try {
    body = await collectList(cursor => cceFetch<Record<string, unknown>>(session, "cce", `/api/v3/projects/${session.projectId}/clusters/${encodeURIComponent(clusterId)}/nodes?limit=2000${cursor ? `&marker=${encodeURIComponent(String(cursor))}` : ""}`), { items: ["items"], kind: "marker", parameter: "marker", size: 2000, next: ["pageInfo.nextMarker"] });
  } catch (error) { if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei could not load the ASM control-plane node choices.", error.status); throw error; }
  const rows = asArray(body.items).map(asRecord), ids = rows.map(row => asString(asRecord(row.metadata).uid, ""));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ManagementInputError("Huawei returned an unverified control-plane node catalog.", 409);
  return rows.filter(row => asRecord(row.status).phase === "Active");
}
function tracingAddress(value: unknown) {
  const text = asString(value, "");
  if (/^[a-zA-Z0-9.-]+$/.test(text)) return text;
  try { const url = new URL(text); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) return url.origin; } catch {}
  return "Private or unverified destination";
}

async function meshDetail(session: BetterUiSession, id: string) {
  const detail = asRecord(await huaweiFetch<Record<string, unknown>>(session, "asm", `${base(session)}/${encodeURIComponent(id)}`));
  if (asString(asRecord(detail.metadata).uid, "") !== id) throw new ManagementInputError("Huawei returned a different mesh.", 404);
  return detail;
}

async function ownedMesh(session: BetterUiSession, id: string) {
  const row = (await meshRows(session)).find(row => asString(asRecord(row.metadata).uid, "") === id);
  if (!row) throw new ManagementInputError("The mesh no longer exists in this project.", 404);
  const detail = await meshDetail(session, id);
  if (asRecord(detail.metadata).name !== asRecord(row.metadata).name || asRecord(detail.spec).type !== asRecord(row.spec).type) throw new ManagementInputError("Huawei returned a different mesh definition.", 409);
  return detail;
}

function selectorText(value: unknown, key: "namespaces" | "nodes") {
  const selector = asRecord(asRecord(asRecord(value)[key]).fieldSelector);
  const selectorKey = asString(selector.key, "");
  if (!selectorKey) return "not configured";
  return `${selectorKey} ${asString(selector.operator, "In")} [${asArray(selector.values).map((item) => asString(item, "")).filter(Boolean).join(", ")}]`;
}

const operations: ManagementOperation[] = [
  { id: "create", label: createLabel, kind: "create", description: "Create one Basic InCluster mesh from clusters currently offered by ASM. Select its control-plane nodes explicitly. Huawei selects the latest mesh version; namespace sidecar injection is configured separately.", impact: "The mesh control plane runs as billed workloads inside the selected CCE clusters, and sidecar proxies injected into cluster workloads add CPU and memory overhead and reroute traffic through the mesh. No prepaid or subscription purchase is created by this API.", fields: [
    meshName,
    clusterField,
    nodesField,
    { key: "ipv6Enable", label: "Enable IPv6 for the mesh", type: "boolean", defaultValue: false },
  ] },
  { id: "inspect", label: "Inspect mesh", kind: "inspect", description: "Show the mesh's native phase, version, member clusters, sidecar injection and control plane node selectors, proxy traffic interception, and telemetry destinations as typed facts. No raw mesh JSON is returned.", fields: [] },
  { id: "delete", label: deleteLabel, kind: "delete", description: "Permanently delete one Running mesh after exact-name confirmation. The native API has no workload guard, so mesh-managed traffic rules are removed with the mesh.", allowedStatuses: ["Running"], fields: [], confirmation: true, impact: "The mesh control plane and its sidecar configuration are removed from every member cluster. mTLS, traffic routing, and observability provided by the mesh stop; Existing injected workloads can lose connectivity and may need redeployment to remove sidecars. Cluster resources remain billed; deleting a mesh does not delete its member clusters." },
];

export const asmManagement: ManagementAdapter = {
  title: "Application Service Mesh",
  operations,
  inventory: async (session) => (await meshRows(session)).map((row) => {
    const metadata = asRecord(row.metadata);
    const spec = asRecord(row.spec);
    return {
      id: asString(metadata.uid, ""),
      name: asString(metadata.name),
      status: asString(asRecord(row.status).phase, "UNKNOWN"),
      values: {
        name: asString(metadata.name),
        version: asString(spec.version, ""),
        type: asString(spec.type, ""),
        clusters: asArray(asRecord(spec.extendParams).clusters).length,
        ipv6: spec.ipv6Enable === true,
        projectId: session.projectId,
      },
    };
  }),
  options: async (session, operation): Promise<Record<string, ManagementChoice[]>> => {
    if (operation !== "create") return {};
    const clusters = await availableClusters(session);
    const nodeGroups = await Promise.all(clusters.map(async cluster => {
      const metadata = asRecord(cluster.metadata), id = asString(metadata.uid), name = asString(metadata.alias, "") || asString(metadata.name, id);
      return (await clusterNodes(session, id)).map(node => ({ value: JSON.stringify([id, asString(asRecord(node.metadata).uid)]), label: `${name} · ${asString(asRecord(node.metadata).name, asString(asRecord(node.metadata).uid))}` }));
    }));
    return { clusters: clusters.map(cluster => { const metadata = asRecord(cluster.metadata), spec = asRecord(cluster.spec); return { value: asString(metadata.uid), label: `${asString(metadata.alias, "") || asString(metadata.name)} · ${asString(spec.version)} · ${asString(spec.flavor)}` }; }), nodes: nodeGroups.flat() };
  },
  poll: async (session, entry) => {
    // The native API has no job route; this observes the mesh's own phase and never invents completion.
    const meshId = entry.jobId ?? "";
    if (!meshId) throw new ManagementInputError("This operation has no verified mesh to observe.");
    if (entry.resourceId !== meshId || ![createLabel, deleteLabel].includes(entry.operation)) throw new ManagementInputError("This history entry has a different mesh identity or operation.");
    const deleting = entry.operation === deleteLabel;
    let detail: Record<string, unknown>;
    try {
      detail = await meshDetail(session, meshId);
    } catch (error) {
      if (error instanceof HuaweiApiError && error.status === 404) {
        if (deleting) return { state: "succeeded", message: "The mesh is no longer listed; deletion completed.", resourceId: entry.resourceId };
        return { state: "failed", message: "The mesh is no longer listed. Creation did not complete, or the mesh was removed outside this workflow." };
      }
      throw error;
    }
    if (entry.resourceName && asRecord(detail.metadata).name !== entry.resourceName) throw new ManagementInputError("Huawei returned a different mesh name.", 409);
    const phase = phaseText(detail);
    if (deleting) {
      if (phase === "DeleteFailed") return { state: "failed", message: "The mesh reports the native phase DeleteFailed. Review the mesh and its member clusters before retrying." };
      if (phase === "Running") return { state: "submitted", message: "The mesh still reports the native phase Running; deletion has not taken effect yet." };
      return { state: "submitted", message: `The mesh reports the native phase ${phase || "unknown"}.` };
    }
    if (phase === "Running") return { state: "succeeded", message: "The mesh reports the native phase Running.", resourceId: meshId };
    if (phase === "CreateFailed") return { state: "failed", message: "The mesh reports the native phase CreateFailed. Review the member cluster state before retrying." };
    return { state: "submitted", message: `The mesh reports the native phase ${phase || "unknown"}.` };
  },
  invalidationKeys: () => [cloudCacheKeys.listAsmMeshes, cloudCacheKeys.listCceClusters, cloudCacheKeys.summary],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      const name = String(values.name);
      if (!/^[a-z][a-z0-9-]{2,62}[a-z0-9]$/.test(name)) throw new ManagementInputError("Mesh names are 4-64 lowercase letters, digits, and hyphens, starting with a letter and without a trailing hyphen.");
      const selected = values.clusters as string[] | undefined;
      if (!Array.isArray(selected) || !selected.length) throw new ManagementInputError("Select at least one available CCE cluster.");
      if (new Set(selected).size !== selected.length) throw new ManagementInputError("Select each cluster only once.");
      const available = new Set((await availableClusters(session)).map(cluster => asString(asRecord(cluster.metadata).uid)));
      if (selected.some(id => !available.has(id))) throw new ManagementInputError("Every selected cluster must be an Available CCE cluster offered by ASM in this project.");
      const nodeValues = values.nodes;
      if (!Array.isArray(nodeValues) || !nodeValues.length || new Set(nodeValues).size !== nodeValues.length) throw new ManagementInputError("Select distinct control-plane nodes for every selected cluster.");
      const nodesByCluster = new Map<string, string[]>();
      for (const value of nodeValues) {
        let pair: unknown; try { pair = JSON.parse(value); } catch { throw new ManagementInputError("Select current control-plane nodes."); }
        if (!Array.isArray(pair) || pair.length !== 2 || pair.some(item => typeof item !== "string" || !item) || !selected.includes(pair[0])) throw new ManagementInputError("Each node must belong to a selected cluster.");
        if (nodesByCluster.get(pair[0])?.includes(pair[1])) throw new ManagementInputError("Select each control-plane node only once.");
        nodesByCluster.set(pair[0], [...(nodesByCluster.get(pair[0]) ?? []), pair[1]]);
      }
      for (const id of selected) {
        const selectedNodes = nodesByCluster.get(id), readyNodes = new Set((await clusterNodes(session, id)).map(node => asString(asRecord(node.metadata).uid)));
        if (!selectedNodes?.length || selectedNodes.some(node => !readyNodes.has(node))) throw new ManagementInputError("Each cluster requires currently Ready control-plane nodes from that cluster.", 409);
      }
      const response = asRecord(await huaweiFetch<Record<string, unknown>>(session, "asm", base(session), { method: "POST", body: JSON.stringify({
        apiVersion: "v1",
        kind: "Mesh",
        metadata: { name },
        spec: {
          type: "InCluster",
          extendParams: { clusters: selected.map(clusterID => ({ clusterID, installation: { nodes: { fieldSelector: { key: "UID", operator: "In", values: nodesByCluster.get(clusterID) } } } })) },
          ...(values.ipv6Enable === true ? { ipv6Enable: true } : {}),
        },
      }) }));
      const uid = asString(asRecord(response.metadata).uid, "");
      if (!uid || asString(asRecord(response.metadata).name, "") !== name) throw new Error("Huawei returned no verified mesh ID. Check the mesh list before retrying.");
      const acknowledged = asRecord(response.spec), acknowledgedClusters = asArray(asRecord(acknowledged.extendParams).clusters).map(row => asString(asRecord(row).clusterID, ""));
      if (acknowledged.type !== "InCluster" || acknowledgedClusters.length !== selected.length || selected.some(id => !acknowledgedClusters.includes(id))) throw new Error("Huawei returned an unverified mesh creation response. Check the mesh list before retrying.");
      const phase = phaseText(response);
      return { message: `Mesh creation accepted; Huawei reports the native phase ${phase || "unknown"}. The control plane deploys inside the selected clusters; refresh the mesh list to watch progress.`, resourceId: uid, jobId: uid, asynchronous: true };
    }
    const mesh = await ownedMesh(session, resource!.id);
    if (operation === "inspect") {
      const metadata = asRecord(mesh.metadata);
      const spec = asRecord(mesh.spec);
      const clusters = asArray(asRecord(spec.extendParams).clusters).map(asRecord);
      const proxy = asRecord(asRecord(spec.config).proxyConfig);
      const telemetry = asRecord(asRecord(spec.config).telemetryConfig);
      const tracing = asRecord(telemetry.tracing);
      const providers = asArray(tracing.extensionProviders).map(asRecord);
      const facts = [
        { label: "Mesh", value: `${asString(metadata.name)} · ${asString(metadata.uid)}` },
        { label: "Phase", value: asString(asRecord(mesh.status).phase, "Not reported") },
        { label: "Type and version", value: `${asString(spec.type, "Not reported")} · ${asString(spec.version, "") || "latest (server-selected)"}` },
        { label: "IPv6", value: spec.ipv6Enable === true ? "Enabled" : spec.ipv6Enable === false ? "Disabled" : "Not reported" },
        { label: "Member clusters", value: String(clusters.length) },
        ...clusters.map((cluster, index) => ({ label: `Cluster ${index + 1} · ${asString(cluster.clusterID, "unknown id")}`, value: `sidecar injection ${selectorText(cluster.injection, "namespaces")} · control plane nodes ${selectorText(cluster.installation, "nodes")}` })),
        { label: "Outbound interception", value: `ranges ${asString(proxy.includeIPRanges, "all")} · excluded ranges ${asString(proxy.excludeIPRanges, "none")} · intercept ports ${asString(proxy.includeOutboundPorts, "all")} · excluded ports ${asString(proxy.excludeOutboundPorts, "none")}` },
        { label: "Inbound interception", value: `intercept ports ${asString(proxy.includeInboundPorts, "all")} · excluded ports ${asString(proxy.excludeInboundPorts, "none")}` },
        { label: "Metrics AOM instances", value: asArray(asRecord(telemetry.metrics).aom).map(asRecord).map((item) => asString(item.instanceID, "")).filter(Boolean).join(", ") || "Not configured" },
        { label: "Access logging LTS streams", value: asArray(asRecord(telemetry.accessLogging).lts).map(asRecord).map((item) => `${asString(item.logGroupID, "")}/${asString(item.logStreamID, "")}`).filter((text) => text !== "/").join(", ") || "Not configured" },
        { label: "Tracing sampling", value: tracing.randomSamplingPercentage === undefined ? "Not configured" : `${String(tracing.randomSamplingPercentage)}%` },
        { label: "Tracing providers", value: asArray(tracing.defaultProviders).map((item) => asString(item, "")).filter(Boolean).join(", ") || "Not configured" },
        { label: "Tracing extension providers", value: providers.map((provider) => { const zipkin = asRecord(provider.zipkin); const port = zipkin.port; return `${asString(provider.name, "")} → ${tracingAddress(zipkin.service)}:${port === undefined || port === null ? "" : String(port)}`; }).filter((text) => !text.startsWith(" →")).join(", ") || "Not configured" },
        { label: "Created", value: asString(metadata.creationTimestamp, "Not reported") },
        { label: "Last native update", value: asString(asRecord(mesh.status).updateTimestamp, "Not reported") },
        { label: "Annotations and labels", value: `${Object.keys(asRecord(metadata.annotations)).length} annotation(s) · ${Object.keys(asRecord(metadata.labels)).length} label(s)` },
      ];
      return { message: "Current mesh configuration loaded from the native mesh definition.", resourceId: asString(metadata.uid, ""), facts };
    }
    if (operation === "delete") {
      if (asRecord(mesh.spec).type !== "InCluster") throw new ManagementInputError("Only verified InCluster meshes can be deleted here.", 409);
      const phase = phaseText(mesh);
      if (phase !== "Running") throw new ManagementInputError(`Only meshes in the Running state can be deleted here. This mesh reports ${phase || "an unknown state"}.`, 409);
      const response = asRecord(await huaweiFetch<Record<string, unknown>>(session, "asm", `${base(session)}/${encodeURIComponent(resource!.id)}`, { method: "DELETE" }));
      if (asString(asRecord(response.metadata).uid, "") !== resource!.id) throw new Error("Huawei returned an unverified deletion response. Check the mesh list before retrying.");
      const nextPhase = phaseText(response);
      return { message: `Mesh deletion accepted; Huawei reports the native phase ${nextPhase || "unknown"}. Mesh traffic management stops as deletion progresses; refresh the mesh list to confirm removal.`, resourceId: resource!.id, jobId: resource!.id, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported ASM operation.");
  },
};
