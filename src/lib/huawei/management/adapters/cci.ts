import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import { huaweiFetch, huaweiList, HuaweiApiError } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { listSecurityGroupsForProject, listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const namespaceRoot = "/apis/cci/v2/namespaces";
const name: ManagementField = { key: "name", label: "Resource name", required: true, max: 63, pattern: "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", help: "1-63 lowercase letters, digits, and hyphens, without leading or trailing hyphens." };
const deployment: ManagementField = { key: "deployment", label: "Deployment", type: "select", source: "deployments", required: true };
const image: ManagementField = { key: "image", label: "Container image", required: true, max: 512, help: "An image reference reachable from the namespace's VPC, such as registry.example/app:version. Private registries require a current image-pull Secret." };
const replicas: ManagementField = { key: "replicas", label: "Replica count", type: "number", required: true, min: 0, max: 1000, defaultValue: 1 };
const configuration: ManagementField = { key: "data", label: "Configuration entries (JSON)", type: "textarea", required: true, maxBytes: 65536, help: "An object of string values, for example {\"MODE\":\"production\"}. Store sensitive values in Secrets." };
const billed = "Running pod CPU and memory are billed. Rollouts can temporarily run additional replicas. Image downloads require reachable registry access; no public IP or load balancer is created.";
const namespacePath = (ns: string, network = false) => `${network ? "/apis/yangtse/v2/namespaces" : namespaceRoot}/${encodeURIComponent(ns)}`;
const metadata = (item: Record<string, unknown>) => asRecord(item.metadata);
function usableName(value: unknown) { return typeof value === "string" && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(value); }
async function rows(s: BetterUiSession, path: string) {
  const body = await huaweiList<Record<string, unknown>>(s, "cci", `${path}?limit=100`, { items: ["items"], kind: "marker", parameter: "continue", size: 100, next: ["metadata.continue"] });
  return asArray(body.items).map(asRecord);
}
async function namespaces(s: BetterUiSession) {
  return (await rows(s, namespaceRoot)).filter(item => {
    const project = asRecord(metadata(item).annotations)["tenant.kubernetes.io/project-id"];
    return !project || project === s.projectId;
  });
}
async function owned(s: BetterUiSession, resource?: ManagementResource) {
  if (!resource) throw new ManagementInputError("Select a current namespace.");
  const ns = (await namespaces(s)).find(item => metadata(item).uid === resource.id);
  if (!ns || !usableName(metadata(ns).name)) throw new ManagementInputError("The namespace no longer belongs to this project.", 404);
  if (metadata(ns).deletionTimestamp || asRecord(ns.status).phase === "Terminating") throw new ManagementInputError("The namespace is terminating.", 409);
  return ns;
}
async function child(s: BetterUiSession, ns: string, collection: string, value: unknown, network = false) {
  const item = (await rows(s, `${namespacePath(ns, network)}/${collection}`)).find(row => metadata(row).name === value && metadata(row).namespace === ns);
  if (!item || !metadata(item).uid) throw new ManagementInputError("The selected resource no longer belongs to this namespace.", 404);
  return item;
}
function imageReference(value: unknown) {
  const ref = String(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*(?:@sha256:[a-f0-9]{64})?$/.test(ref) || ref.includes("://") || ref.includes("//")) throw new ManagementInputError("Use a container image reference without URLs or embedded credentials.");
  return ref;
}
function config(value: unknown) {
  let parsed: unknown; try { parsed = JSON.parse(String(value)); } catch { throw new ManagementInputError("Enter a JSON object of configuration strings."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.entries(parsed).some(([key, val]) => !/^[A-Za-z0-9._-]{1,253}$/.test(key) || typeof val !== "string")) throw new ManagementInputError("Configuration keys must contain letters, digits, dots, hyphens, or underscores, and values must be strings.");
  return parsed;
}
async function empty(s: BetterUiSession, ns: string) {
  // These collections are documented in CCI 2.0. Never cascade a namespace with workload, configuration, or storage resources.
  for (const type of ["pods", "deployments", "replicasets", "services", "configmaps", "secrets", "persistentvolumeclaims", "horizontalpodautoscalers"]) {
    if ((await rows(s, `${namespacePath(ns)}/${type}`)).length) throw new ManagementInputError(`The namespace still contains ${type}. Remove its resources before deleting it.`, 409);
  }
  if ((await rows(s, `${namespacePath(ns, true)}/networks`)).length) throw new ManagementInputError("Remove the namespace's networks before deleting it.", 409);
}
function choiceRows(items: Record<string, unknown>[], ns: string): ManagementChoice[] { return items.filter(item => metadata(item).namespace === ns && usableName(metadata(item).name)).map(item => ({ value: String(metadata(item).name), label: String(metadata(item).name) })); }
export const cciManagement: ManagementAdapter = {
  title: "Cloud Container Instance 2.0",
  operations: [
    { id: "create", label: "Create namespace", kind: "create", description: "Create a CCI 2.0 namespace. Create its private network before deploying workloads.", fields: [{ ...name, label: "Namespace name" }] },
    { id: "inspect", label: "View namespace resources", kind: "inspect", description: "List deployments, pods, services, networks, and configuration names without exposing Secret values.", fields: [] },
    { id: "delete", label: "Delete empty namespace", kind: "delete", description: "Delete an empty namespace after removing its workloads, networks, configuration, and storage claims.", fields: [], confirmation: true, excludedResourceIds: ["default", "kube-system", "kube-public"], impact: "The namespace is permanently removed. This workflow blocks deletion while known workload, configuration, network, or storage resources remain." },
    { id: "create-network", label: "Create private network", kind: "action", description: "Map this namespace to one current subnet and security group. Mark it as the default network for new pods.", fields: [name, { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true }, { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true }], impact: "CCI reserves network interfaces and IP addresses in the selected subnet. No public IP or load balancer is created." },
    { id: "delete-network", label: "Delete unused network", kind: "action", description: "Delete a namespace-owned network only after all pods and deployments have been removed.", fields: [{ key: "network", label: "Network", type: "select", source: "networks", required: true }], confirmation: true, impact: "The private network mapping is removed. New workloads cannot start until an appropriate network is created." },
    { id: "create-deployment", label: "Deploy container", kind: "action", description: "Create a Deployment with one container, fixed resource requests and limits, and a rolling update strategy.", fields: [name, image, replicas, { key: "size", label: "CPU and memory per replica", type: "select", required: true, defaultValue: "500m:1024Mi", choices: [{ value: "250m:512Mi", label: "0.25 vCPU · 512 MiB" }, { value: "500m:1024Mi", label: "0.5 vCPU · 1 GiB" }, { value: "1000m:2048Mi", label: "1 vCPU · 2 GiB" }, { value: "2000m:4096Mi", label: "2 vCPU · 4 GiB" }] }, { key: "pullSecret", label: "Registry image-pull Secret", type: "select", source: "pullSecrets", help: "Optional for publicly accessible images; current dockerconfigjson Secrets only." }], impact: billed },
    { id: "scale", label: "Scale deployment", kind: "update", description: "Change the desired replica count. Zero stops its pods while keeping configuration.", fields: [deployment, replicas], confirmation: true, impact: "Reducing replicas terminates pods and loses their local data. Increasing replicas adds billed CPU and memory. Persistent storage follows its own reclaim policy." },
    { id: "change-image", label: "Roll out container image", kind: "update", description: "Replace one selected container's image while preserving every other container and pod setting.", fields: [{ key: "container", label: "Deployment and container", type: "select", source: "containers", required: true }, image], confirmation: true, impact: billed },
    { id: "delete-deployment", label: "Delete deployment", kind: "action", description: "Delete one deployment and its pods.", fields: [deployment], confirmation: true, impact: "Pods and their local data are removed. Persistent volumes and claims are retained according to their own policies and can remain billed." },
    { id: "create-configmap", label: "Create ConfigMap", kind: "action", description: "Create a namespace-owned ConfigMap of configuration strings.", fields: [name, configuration] },
    { id: "update-configmap", label: "Replace ConfigMap entries", kind: "update", description: "Replace the entries of one current ConfigMap, preserving its identity and metadata.", fields: [{ key: "configmap", label: "ConfigMap", type: "select", source: "configmaps", required: true }, configuration], confirmation: true, impact: "Every existing entry is replaced. Mounted configuration may update; environment variables take effect when pods restart." },
    { id: "delete-configmap", label: "Delete ConfigMap", kind: "action", description: "Delete one namespace-owned ConfigMap.", fields: [{ key: "configmap", label: "ConfigMap", type: "select", source: "configmaps", required: true }], confirmation: true, impact: "Workloads that reference this ConfigMap may fail to start or read configuration." },
    { id: "create-secret", label: "Create opaque Secret", kind: "action", description: "Create a Secret with one sensitive value. Values are sent to Huawei and omitted from history.", fields: [name, { key: "key", label: "Secret key", required: true, max: 253, pattern: "^[A-Za-z0-9._-]+$" }, { key: "value", label: "Secret value", type: "password", required: true, maxBytes: 65536 }] },
    { id: "delete-secret", label: "Delete Secret", kind: "action", description: "Delete a namespace-owned Secret without displaying its value.", fields: [{ key: "secret", label: "Secret", type: "select", source: "secrets", required: true }], confirmation: true, impact: "Workloads using this Secret may lose credentials or fail image downloads. Secret values cannot be recovered through this workspace." },
  ],
  inventory: async s => (await namespaces(s)).filter(ns => metadata(ns).uid && usableName(metadata(ns).name)).map(ns => ({ id: String(metadata(ns).uid), name: String(metadata(ns).name), status: asString(asRecord(ns.status).phase, "Unknown") })),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (["create", "inspect", "delete", "create-configmap", "create-secret"].includes(operation)) return {};
    const ns = String(metadata(await owned(s, resource)).name);
    if (operation === "create-network") {
      const [subnets, groups] = await Promise.all([listSubnetsForProject(s), listSecurityGroupsForProject(s)]);
      return { subnets: subnets.filter(subnet => !["", "-"].includes(subnet.neutronSubnetId)).map(subnet => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })), securityGroups: groups.map(group => ({ value: group.id, label: group.name })) };
    }
    if (operation === "delete-network") return { networks: choiceRows(await rows(s, `${namespacePath(ns, true)}/networks`), ns) };
    if (operation === "create-deployment") return { pullSecrets: choiceRows((await rows(s, `${namespacePath(ns)}/secrets`)).filter(secret => secret.type === "kubernetes.io/dockerconfigjson"), ns) };
    if (operation === "scale" || operation === "delete-deployment") return { deployments: choiceRows(await rows(s, `${namespacePath(ns)}/deployments`), ns) };
    if (operation === "change-image") return { containers: (await rows(s, `${namespacePath(ns)}/deployments`)).filter(item => metadata(item).namespace === ns).flatMap(item => asArray(asRecord(asRecord(asRecord(item.spec).template).spec).containers).map(asRecord).map(container => ({ value: JSON.stringify([metadata(item).name, container.name]), label: `${metadata(item).name} · ${container.name}` }))) };
    if (operation.includes("configmap")) return { configmaps: choiceRows(await rows(s, `${namespacePath(ns)}/configmaps`), ns) };
    if (operation === "delete-secret") return { secrets: choiceRows(await rows(s, `${namespacePath(ns)}/secrets`), ns) };
    return {};
  },
  execute: async (s, operation, v, resource) => {
    const write = (path: string, method: string, body?: unknown, headers?: Record<string, string>) => huaweiFetch<Record<string, unknown>>(s, "cci", path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers });
    if (operation === "create") {
      if (["default", "kube-system", "kube-public"].includes(String(v.name))) throw new ManagementInputError("Choose an application namespace name.");
      const result = await write(namespaceRoot, "POST", { apiVersion: "cci/v2", kind: "Namespace", metadata: { name: v.name } });
      if (!metadata(result).uid || metadata(result).name !== v.name) throw new Error("Huawei returned no verified namespace. Check namespaces before retrying.");
      return { message: "Namespace creation accepted. Create its private network before deploying containers.", resourceId: String(metadata(result).uid), asynchronous: true };
    }
    const current = await owned(s, resource); const ns = String(metadata(current).name); const path = namespacePath(ns);

    if (operation === "inspect") {
      const types = ["deployments", "pods", "services", "configmaps", "secrets"];
      const lists = await Promise.all(types.map(type => rows(s, `${path}/${type}`)));
      const networks = await rows(s, `${namespacePath(ns, true)}/networks`);
      return { message: "Current namespace resources. Secret values and container environment values are omitted.", facts: [...lists.map((items, i) => ({ label: types[i], value: items.map(item => String(metadata(item).name)).join(", ") || "None" })), { label: "Networks", value: networks.map(item => `${metadata(item).name} · ${asRecord(item.status).status ?? "Unknown"}`).join(", ") || "None" }] };
    }
    if (operation === "delete") {
      if (["default", "kube-system", "kube-public"].includes(ns)) throw new ManagementInputError("System and default namespaces are protected.", 409);
      await empty(s, ns); await write(path, "DELETE"); return { message: "Empty namespace deletion accepted.", asynchronous: true };
    }
    if (operation === "create-network") {
      const existing = await rows(s, `${namespacePath(ns, true)}/networks`);
      if (existing.length) throw new ManagementInputError("This workflow creates the namespace's first default network only.", 409);
      const [subnets, groups] = await Promise.all([listSubnetsForProject(s), listSecurityGroupsForProject(s)]);
      const subnet = subnets.find(subnet => subnet.id === v.subnet);
      if (!subnet || ["", "-"].includes(subnet.neutronSubnetId) || !groups.some(group => group.id === v.securityGroup)) throw new ManagementInputError("Select a current subnet with a Neutron subnet ID and a current security group.");
      const annotations = asRecord(metadata(current).annotations); const domain = annotations["tenant.kubernetes.io/domain-id"];
      if (typeof domain !== "string" || !domain || annotations["tenant.kubernetes.io/project-id"] !== s.projectId) throw new ManagementInputError("The namespace account and project could not be verified.");
      await write(`${namespacePath(ns, true)}/networks`, "POST", { apiVersion: "yangtse/v2", kind: "Network", metadata: { name: v.name, namespace: ns, annotations: { "yangtse.io/domain-id": domain, "yangtse.io/project-id": s.projectId } }, spec: { defaultNetwork: true, networkType: "underlay_neutron", securityGroups: [v.securityGroup], subnets: [{ subnetID: subnet.neutronSubnetId }] } });
      return { message: "Private default network creation accepted. Wait for Ready before deploying pods.", asynchronous: true };
    }
    if (operation === "delete-network") {
      await child(s, ns, "networks", v.network, true);
      if ((await rows(s, `${path}/pods`)).length || (await rows(s, `${path}/deployments`)).length) throw new ManagementInputError("Remove all pods and deployments before deleting this network.", 409);
      await write(`${namespacePath(ns, true)}/networks/${encodeURIComponent(String(v.network))}`, "DELETE");
      return { message: "Unused network deletion accepted.", asynchronous: true };
    }
    if (operation === "create-deployment") {
      const ref = imageReference(v.image);
      const networks = await rows(s, `${namespacePath(ns, true)}/networks`);
      if (!networks.some(net => asRecord(net.spec).defaultNetwork === true && asRecord(net.status).status === "Ready" && metadata(net).namespace === ns)) throw new ManagementInputError("Wait for a namespace-owned default network in Ready state.");
      if (v.pullSecret) { const secret = await child(s, ns, "secrets", v.pullSecret); if (secret.type !== "kubernetes.io/dockerconfigjson") throw new ManagementInputError("Select a current dockerconfigjson Secret."); }
      const sizes = ["250m:512Mi", "500m:1024Mi", "1000m:2048Mi", "2000m:4096Mi"]; if (!sizes.includes(String(v.size))) throw new ManagementInputError("Select a supported CPU and memory combination.");
      const [cpu, memory] = String(v.size).split(":"); const labels = { "app.kubernetes.io/name": String(v.name) };
      await write(`${path}/deployments`, "POST", { apiVersion: "cci/v2", kind: "Deployment", metadata: { name: v.name, namespace: ns }, spec: { replicas: Number(v.replicas), selector: { matchLabels: labels }, strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } }, template: { metadata: { labels }, spec: { containers: [{ name: v.name, image: ref, resources: { requests: { cpu, memory }, limits: { cpu, memory } } }], restartPolicy: "Always", ...(v.pullSecret ? { imagePullSecrets: [{ name: v.pullSecret }] } : {}) } } } });
      return { message: "Container deployment accepted. Check deployment and pod states for scheduling and image-pull progress.", asynchronous: true };
    }
    if (["scale", "change-image", "delete-deployment"].includes(operation)) {
      let deploymentName: unknown = v.deployment; let containerName: unknown;
      if (operation === "change-image") { let parsed: unknown; try { parsed = JSON.parse(String(v.container)); } catch { throw new ManagementInputError("Select a current deployment container."); } [deploymentName, containerName] = Array.isArray(parsed) ? parsed : []; }
      const item = await child(s, ns, "deployments", deploymentName); const target = `${path}/deployments/${encodeURIComponent(String(deploymentName))}`;
      if (operation === "delete-deployment") { await write(target, "DELETE"); return { message: "Deployment and pod deletion accepted. Persistent claims are retained.", asynchronous: true }; }
      if (!metadata(item).resourceVersion) throw new ManagementInputError("The deployment's current revision could not be verified.");
      const spec: Record<string, unknown> = operation === "scale" ? { replicas: Number(v.replicas) } : {};
      if (operation === "change-image") {
        const template = asRecord(asRecord(item.spec).template); const containers = asArray(asRecord(template.spec).containers).map(asRecord);
        if (!containers.some(container => container.name === containerName)) throw new ManagementInputError("The container no longer belongs to this deployment.");
        spec.template = { spec: { containers: containers.map(container => container.name === containerName ? { ...container, image: imageReference(v.image) } : container) } };
      }
      await write(target, "PATCH", { metadata: { resourceVersion: metadata(item).resourceVersion }, spec }, { "Content-Type": "application/merge-patch+json" });
      return { message: operation === "scale" ? "Replica count change accepted. Check pod state for completion." : "Image rollout accepted. Existing container settings are preserved.", asynchronous: true };
    }
    if (operation === "create-configmap") { await write(`${path}/configmaps`, "POST", { apiVersion: "cci/v2", kind: "ConfigMap", metadata: { name: v.name, namespace: ns }, data: config(v.data) }); return { message: "ConfigMap created." }; }
    if (operation === "update-configmap" || operation === "delete-configmap") {
      const item = await child(s, ns, "configmaps", v.configmap); const target = `${path}/configmaps/${encodeURIComponent(String(v.configmap))}`;
      if (operation === "delete-configmap") await write(target, "DELETE");
      else { if (!metadata(item).resourceVersion) throw new ManagementInputError("The ConfigMap's current revision could not be verified."); await write(target, "PUT", { apiVersion: "cci/v2", kind: "ConfigMap", metadata: metadata(item), data: config(v.data), ...(item.binaryData ? { binaryData: item.binaryData } : {}) }); }
      return { message: operation === "delete-configmap" ? "ConfigMap deleted." : "ConfigMap entries replaced." };
    }
    if (operation === "create-secret") {
      try { await write(`${path}/secrets`, "POST", { apiVersion: "cci/v2", kind: "Secret", metadata: { name: v.name, namespace: ns }, type: "Opaque", data: { [String(v.key)]: Buffer.from(String(v.value)).toString("base64") } }); }
      catch (error) { if (error instanceof HuaweiApiError) throw new HuaweiApiError("Huawei rejected Secret creation. Check namespace permissions and resource limits.", error.status); throw new Error("Secret creation has an uncertain outcome. Check its name before retrying."); }
      return { message: "Opaque Secret created. Its value is omitted from history." };
    }
    if (operation === "delete-secret") { await child(s, ns, "secrets", v.secret); await write(`${path}/secrets/${encodeURIComponent(String(v.secret))}`, "DELETE"); return { message: "Secret deleted." }; }
    throw new ManagementInputError("Unsupported CCI operation.");
  },
  invalidationKeys: () => [cloudCacheKeys.listCciNamespaces],
};
