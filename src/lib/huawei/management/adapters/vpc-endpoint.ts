import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import { listVpcEndpointsForProject } from "@/lib/huawei/services/vpc-endpoint";
import { listElbsForProject } from "@/lib/huawei/services/elb";
import { listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource, type ManagementValues } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

/**
 * VPC Endpoint management against the documented native vpcep v1 APIs:
 *   services         POST/PUT/DELETE /v1/{project_id}/vpc-endpoint-services[/{id}]
 *   permissions      GET/POST        /v1/{project_id}/vpc-endpoint-services/{id}/permissions[/action]
 *   connections      GET/POST        /v1/{project_id}/vpc-endpoint-services/{id}/connections[/action]
 *   public services  GET             /v1/{project_id}/vpc-endpoint-services/public
 *   endpoints        POST/GET/DELETE /v1/{project_id}/vpc-endpoints[/{id}]
 *
 * Inventory mixes endpoint services and endpoints, so resource IDs are tagged
 * ("service:", "endpoint:") and every operation re-verifies the selection
 * against a fresh server query before writing. Endpoint subnet_id is the
 * Neutron network ID of the VPC subnet, while service backends are live ELB
 * VIP ports or ECS Neutron ports. Permission entries are validated
 * iam:domain principals and are explicitly labeled cross-account grants.
 */

const root = (s: BetterUiSession) => `/v1/${s.projectId}`;
const SERVICE_NAME_PATTERN = "^[A-Za-z0-9_-]{1,16}$";
const DOMAIN_PERMISSION_PATTERN = "^iam:domain::[0-9a-fA-F]{32}$";

const serviceName: ManagementField = { key: "name", label: "Service name suffix", required: true, max: 16, pattern: SERVICE_NAME_PATTERN, help: "Up to 16 letters, digits, underscores, or hyphens. The region and service ID are added automatically." };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 255, allowEmpty: true, pattern: "^[^<>]*$" };
const connectionImpact = "Accepting a connection lets the requester's VPC endpoint reach this service's backend. Rejecting or deleting interrupts that access.";

type ServiceRecord = { id: string; serviceName: string; serverType: string; vpcId: string; approvalEnabled: boolean; status: string; serviceType: string; description: string; portId: string };

function parseTagged(resource: ManagementResource | undefined, kind: "service" | "endpoint", label: string) {
  const id = resource?.id ?? "";
  const childId = id.slice(kind.length + 1);
  if (!id.startsWith(`${kind}:`) || !childId) throw new ManagementInputError(`This operation needs a selected ${label}.`, 409);
  return childId;
}

function text(value: ManagementValues[string] | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function fetchServices(s: BetterUiSession): Promise<ServiceRecord[]> {
  const body = await huaweiList<Record<string, unknown>>(s, "vpcep", `${root(s)}/vpc-endpoint-services?limit=1000`, { items: ["endpoint_services"], kind: "offset", parameter: "offset", size: 1000, total: ["total_count", "total"] });
  return asArray(body.endpoint_services).map(raw => {
    const item = asRecord(raw);
    return { id: asString(item.id, ""), serviceName: asString(item.service_name), serverType: asString(item.server_type, "-"), vpcId: asString(item.vpc_id, "-"), approvalEnabled: item.approval_enabled === true, status: firstString([item.status], "UNKNOWN"), serviceType: asString(item.service_type, "interface"), description: asString(item.description), portId: asString(item.port_id, "-") };
  }).filter(service => service.id);
}

async function requireService(s: BetterUiSession, serviceId: string) {
  const service = (await fetchServices(s)).find(item => item.id === serviceId);
  if (!service) throw new ManagementInputError("The endpoint service no longer exists in this project.", 404);
  return service;
}

async function fetchPermissions(s: BetterUiSession, serviceId: string) {
  const body = await huaweiList<Record<string, unknown>>(s, "vpcep", `${root(s)}/vpc-endpoint-services/${encodeURIComponent(serviceId)}/permissions?limit=1000`, { items: ["permissions"], kind: "offset", parameter: "offset", size: 1000, total: ["total_count", "total"] });
  return asArray(body.permissions).map(raw => {
    const item = asRecord(raw);
    return { id: asString(item.id, ""), permission: asString(item.permission, ""), permissionType: asString(item.permission_type, "domainId") };
  }).filter(p => p.id && p.permission);
}

async function fetchConnections(s: BetterUiSession, serviceId: string) {
  const body = await huaweiList<Record<string, unknown>>(s, "vpcep", `${root(s)}/vpc-endpoint-services/${encodeURIComponent(serviceId)}/connections?limit=1000`, { items: ["connections"], kind: "offset", parameter: "offset", size: 1000, total: ["total_count", "total"] });
  return asArray(body.connections).map(raw => {
    const item = asRecord(raw);
    return { id: asString(item.id, ""), domainId: asString(item.domain_id, "-"), status: firstString([item.status], "UNKNOWN"), description: asString(item.description) };
  }).filter(c => c.id);
}

async function fetchPublicServices(s: BetterUiSession) {
  const body = await huaweiList<Record<string, unknown>>(s, "vpcep", `${root(s)}/vpc-endpoint-services/public?limit=1000`, { items: ["endpoint_services"], kind: "offset", parameter: "offset", size: 1000, total: ["total_count", "total"] });
  return asArray(body.endpoint_services).map(raw => {
    const item = asRecord(raw);
    return { id: asString(item.id, ""), serviceName: asString(item.service_name), serviceType: asString(item.service_type, "interface"), owner: asString(item.owner, "-"), isCharge: item.is_charge === true };
  }).filter(service => service.id);
}

/** Live ELB VIP ports and ECS Neutron ports that can back an endpoint service. */
async function fetchBackends(s: BetterUiSession) {
  const [elbs, ports, subnets] = await Promise.all([
    listElbsForProject(s),
    huaweiList<Record<string, unknown>>(s, "vpc", "/v2.0/ports?limit=200", { items: ["ports"], kind: "marker", parameter: "marker", size: 200, fallbackKey: "id" }),
    listSubnetsForProject(s),
  ]);
  const vpcBySubnetId = new Map(subnets.filter(subnet => subnet.neutronSubnetId && subnet.neutronSubnetId !== "-").map(subnet => [subnet.neutronSubnetId, subnet.vpcId]));
  const vpcByNetworkId = new Map(subnets.filter(subnet => subnet.neutronNetworkId && subnet.neutronNetworkId !== "-").map(subnet => [subnet.neutronNetworkId, subnet.vpcId]));
  const lbBackends = elbs.filter(elb => elb.vipPortId && elb.vipPortId !== "-").map(elb => ({ portId: elb.vipPortId, label: `ELB ${elb.name} · ${elb.vipAddress}`, vpcId: vpcBySubnetId.get(elb.vipSubnetCidrId) ?? "" }));
  const vmBackends = asArray(ports.ports).map(asRecord).filter(p => asString(p.id, "") && (p.tenant_id ?? p.project_id) === s.projectId && String(p.device_owner ?? "") === "compute:nova").map(p => ({ portId: asString(p.id, ""), label: `ECS port ${firstString([p.name, p.device_id], asString(p.id, ""))} · ${asArray(p.fixed_ips).map(ip => asRecord(ip).ip_address).join(", ")}`, vpcId: vpcByNetworkId.get(asString(p.network_id, "")) ?? "" }));
  return { lbBackends, vmBackends };
}

function ipv4Number(ip: string): number | null {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(ip)) return null;
  const octets = ip.split(".").map(Number);
  if (octets.some(n => n > 255)) return null;
  return octets.reduce((number, octet) => number * 256 + octet, 0);
}
function ipv4Range(cidr: string): [number, number] | null {
  const [ip, prefix] = cidr.split("/"); const address = ipv4Number(ip); const bits = Number(prefix);
  if (address === null || !/^\d{1,2}$/.test(prefix ?? "") || bits < 0 || bits > 32) return null;
  const size = 2 ** (32 - bits); const start = Math.floor(address / size) * size;
  return [start, start + size - 1];
}

export const vpcEndpointManagement: ManagementAdapter = {
  title: "VPC Endpoint",
  operations: [
    { id: "create-service", label: "Create endpoint service", kind: "create", description: "Expose a live ELB or ECS backend as an interface endpoint service with one port mapping.", fields: [serviceName, description, { key: "backend", label: "Backend port", type: "select", source: "backends", required: true, help: "The ELB VIP port or ECS NIC port that receives endpoint traffic." }, { key: "clientPort", label: "Port accessed through the endpoint", type: "number", required: true, min: 1, max: 65535 }, { key: "serverPort", label: "Backend port", type: "number", required: true, min: 1, max: 65535 }, { key: "protocol", label: "Protocol", type: "select", required: true, defaultValue: "TCP", choices: [{ value: "TCP", label: "TCP" }, { value: "UDP", label: "UDP" }] }, { key: "approvalEnabled", label: "Require connection approval", type: "boolean", defaultValue: true }], impact: "The backend becomes reachable through VPC endpoints whose connections you approve. Approved endpoints consume endpoint resources on the requester side." },
    { id: "update-service", label: "Edit endpoint service", kind: "update", description: "Rename the service, edit its description, or change whether connections need approval. Leave the suffix blank to preserve the name.", fields: [{ ...serviceName, required: false }, description, { key: "approvalEnabled", label: "Require connection approval", type: "boolean" }], allowedStatuses: ["available"], resourcePrefixes: ["service:"], impact: "Disabling approval allows permitted accounts to connect without your approval. Existing connections and backend mappings are preserved." },
    { id: "delete-service", label: "Delete endpoint service", kind: "delete", description: "Delete the endpoint service after its endpoint connections are gone.", fields: [], confirmation: true, allowedStatuses: ["available", "failed"], resourcePrefixes: ["service:"], impact: "Endpoints connected to this service stop working permanently." },
    { id: "inspect-service", label: "View service details, permissions, connections", kind: "inspect", description: "Show the service's backend, port mappings, whitelist, and endpoint connections.", fields: [], resourcePrefixes: ["service:"] },
    { id: "add-permission", label: "Add whitelist domain", kind: "action", description: "Allow one IAM domain to create endpoints for this service.", fields: [{ key: "permission", label: "IAM domain (cross-account permission)", required: true, max: 64, pattern: DOMAIN_PERMISSION_PATTERN, help: "Full form iam:domain:: followed by the 32-character domain ID. This grants another account access." }, description], allowedStatuses: ["available"], resourcePrefixes: ["service:"], impact: "The listed domain can create endpoints to this service; this is an explicit cross-account grant." },
    { id: "remove-permission", label: "Remove whitelist domain", kind: "action", description: "Remove one current whitelist entry from this service.", fields: [{ key: "permission", label: "Whitelist entry", type: "select", source: "permissions", required: true }], confirmation: true, allowedStatuses: ["available"], resourcePrefixes: ["service:"], impact: "New endpoints from this domain are rejected; existing endpoints keep working." },
    { id: "accept-connection", label: "Accept endpoint connection", kind: "action", description: "Approve one pending endpoint connection to this service.", fields: [{ key: "connection", label: "Pending connection", type: "select", source: "connections", required: true }], allowedStatuses: ["available"], resourcePrefixes: ["service:"], impact: connectionImpact },
    { id: "reject-connection", label: "Reject endpoint connection", kind: "action", description: "Reject one pending endpoint connection to this service.", fields: [{ key: "connection", label: "Pending connection", type: "select", source: "connections", required: true }], confirmation: true, allowedStatuses: ["available"], resourcePrefixes: ["service:"], impact: connectionImpact },
    { id: "create-endpoint", label: "Create endpoint", kind: "create", description: "Connect a current VPC subnet to a live approved interface endpoint service.", fields: [{ key: "service", label: "Endpoint service", type: "select", source: "endpointServices", required: true }, { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true }, { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true }, { key: "portIp", label: "Endpoint private IPv4 address", required: true, max: 15, help: "An unused address in the selected subnet; Huawei checks address availability." }, { key: "enableDns", label: "Create endpoint DNS", type: "boolean" }, description], impact: "The endpoint occupies a private address in the subnet. Services marked requester-paid bill this account for the endpoint and its traffic; DNS entries resolve the service name inside the VPC when enabled." },
    { id: "inspect-endpoint", label: "View endpoint details", kind: "inspect", description: "Show the endpoint's status, address, service, and DNS state.", fields: [], resourcePrefixes: ["endpoint:"] },
    { id: "delete-endpoint", label: "Delete endpoint", kind: "delete", description: "Delete the endpoint and its private address.", fields: [], confirmation: true, allowedStatuses: ["creating", "pendingAcceptance", "accepted", "rejected", "failed"], resourcePrefixes: ["endpoint:"], impact: "Workloads using this endpoint lose connectivity to the target service." },
  ],
  inventory: async s => {
    const [services, endpoints] = await Promise.all([fetchServices(s), listVpcEndpointsForProject(s)]);
    return [
      ...services.map(service => ({ id: `service:${service.id}`, name: service.serviceName, status: service.status, values: { name: "", description: service.description, serverType: service.serverType, approvalEnabled: service.approvalEnabled } })),
      ...endpoints.filter(endpoint => endpoint.projectId === s.projectId).map(endpoint => ({ id: `endpoint:${endpoint.id}`, name: endpoint.endpointServiceName !== "-" ? endpoint.endpointServiceName : endpoint.id, status: endpoint.status, values: { service: endpoint.endpointServiceName, ip: endpoint.ip, vpc: endpoint.vpcId, subnet: endpoint.subnetId, dns: endpoint.dnsEnabled } })),
    ];
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-service") {
      const { lbBackends, vmBackends } = await fetchBackends(s);
      return { backends: [...lbBackends.map(b => ({ value: `lb:${b.portId}`, label: b.label })), ...vmBackends.map(b => ({ value: `vm:${b.portId}`, label: b.label }))] };
    }
    if (operation === "create-endpoint") {
      const [own, publicServices, vpcs, subnets] = await Promise.all([fetchServices(s), fetchPublicServices(s), listVpcsForProject(s), listSubnetsForProject(s)]);
      const seen = new Set<string>();
      const choices: ManagementChoice[] = [];
      for (const choice of [
        ...own.filter(service => service.status === "available" && service.serviceType === "interface").map(service => ({ value: service.id, label: `${service.serviceName} · owned by this project` })),
        ...publicServices.filter(service => service.serviceType === "interface").map(service => ({ value: service.id, label: `${service.serviceName} · ${service.owner}${service.isCharge ? " · requester pays" : ""}` })),
      ]) {
        if (!seen.has(choice.value)) {
          seen.add(choice.value);
          choices.push(choice);
        }
      }
      return { endpointServices: choices, vpcs: vpcs.map(vpc => ({ value: vpc.id, label: `${vpc.name} (${vpc.cidr})` })), subnets: subnets.map(subnet => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · VPC ${subnet.vpcId}` })) };
    }
    if (!resource) return {};
    if (resource.id.startsWith("endpoint:")) return {};
    const serviceId = parseTagged(resource, "service", "endpoint service");
    if (operation === "add-permission") return {};
    await requireService(s, serviceId);
    if (operation === "remove-permission") return { permissions: (await fetchPermissions(s, serviceId)).map(p => ({ value: p.permission, label: `${p.permission} · ${p.permissionType}` })) };
    if (["accept-connection", "reject-connection"].includes(operation)) return { connections: (await fetchConnections(s, serviceId)).filter(c => c.status === "pendingAcceptance").map(c => ({ value: c.id, label: `${c.id} · ${c.domainId} · ${c.status}` })) };
    return {};
  },
  invalidationKeys: () => [cloudCacheKeys.listVpcEndpoints, cloudCacheKeys.listVpcs, cloudCacheKeys.listSubnets, cloudCacheKeys.listElbs],
  execute: async (s, operation, v, resource) => {
    const send = (path: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "vpcep", `${root(s)}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (operation === "create-service") {
      const [type, portId] = String(v.backend).split(":");
      if (!["lb", "vm"].includes(type) || !portId) throw new ManagementInputError("Select a backend port from this project's live resources.");
      const { lbBackends, vmBackends } = await fetchBackends(s);
      const backend = (type === "lb" ? lbBackends : vmBackends).find(b => b.portId === portId);
      if (!backend) throw new ManagementInputError("The selected backend port no longer belongs to this project.", 404);
      if (!backend.vpcId) throw new ManagementInputError("The backend port's VPC could not be resolved; verify its subnet.", 409);
      const body = await send("/vpc-endpoint-services", "POST", { port_id: portId, service_name: String(v.name), vpc_id: backend.vpcId, approval_enabled: v.approvalEnabled === true, server_type: type === "lb" ? "LB" : "VM", ports: [{ client_port: v.clientPort, server_port: v.serverPort, protocol: String(v.protocol ?? "TCP") }], ...(text(v.description) ? { description: text(v.description) } : {}) });
      return { message: "Endpoint service creation submitted. It becomes connectable once its status is available.", resourceId: asString(body.id, "") || undefined, asynchronous: true };
    }
    if (operation === "create-endpoint") {
      const [own, publicServices, vpcs, subnets] = await Promise.all([fetchServices(s), fetchPublicServices(s), listVpcsForProject(s), listSubnetsForProject(s)]);
      const target = own.find(service => service.id === v.service && service.status === "available" && service.serviceType === "interface") ?? publicServices.find(service => service.id === v.service && service.serviceType === "interface");
      if (!target) throw new ManagementInputError("The endpoint service is not available to this project.", 404);
      if (!vpcs.some(vpc => vpc.id === v.vpc)) throw new ManagementInputError("The selected VPC no longer exists in this project.", 404);
      const subnet = subnets.find(item => item.id === v.subnet);
      if (!subnet || subnet.vpcId !== v.vpc || !subnet.neutronNetworkId || subnet.neutronNetworkId === "-") throw new ManagementInputError("Select a subnet with a Neutron network inside the selected VPC.", 404);
      const ip = String(v.portIp ?? "");
      const range = ipv4Range(subnet.cidr); const address = ipv4Number(ip); const excluded = ipv4Range("198.19.128.0/17")!;
      if (!range || address === null || address <= range[0] || address >= range[1] || ip === subnet.gateway) throw new ManagementInputError("Choose a usable IPv4 address inside the selected subnet, excluding its gateway.");
      if (range[0] <= excluded[1] && range[1] >= excluded[0]) throw new ManagementInputError("Endpoint subnets cannot overlap 198.19.128.0/17.");
      const body = await send("/vpc-endpoints", "POST", { port_ip: ip, subnet_id: subnet.neutronNetworkId, endpoint_service_id: target.id, vpc_id: String(v.vpc), enable_dns: v.enableDns === true, ...(text(v.description) ? { description: text(v.description) } : {}) });
      const chargeNote = "isCharge" in target && target.isCharge ? " This service is requester-paid; endpoint usage bills this project." : "";
      return { message: `Endpoint creation submitted.${chargeNote}`, resourceId: asString(body.id, "") || undefined, asynchronous: true };
    }
    if (operation === "inspect-endpoint" || operation === "delete-endpoint") {
      const endpointId = parseTagged(resource, "endpoint", "endpoint");
      if (operation === "delete-endpoint") {
        await send(`/vpc-endpoints/${encodeURIComponent(endpointId)}`, "DELETE");
        return { message: "Endpoint deletion submitted.", resourceId: endpointId, asynchronous: true };
      }
      const body = await send(`/vpc-endpoints/${encodeURIComponent(endpointId)}`, "GET");
      const item = asRecord(body);
      return { message: `Endpoint ${endpointId} details loaded.`, facts: [
        { label: "Status", value: firstString([item.status], "UNKNOWN") },
        { label: "Endpoint service", value: asString(item.endpoint_service_name) },
        { label: "Private address", value: firstString([item.ip, item.private_ip_address], "-") },
        { label: "VPC / subnet", value: `${asString(item.vpc_id, "-")} / ${asString(item.subnet_id, "-")}` },
        { label: "DNS", value: item.enable_dns === true ? "enabled" : "disabled" },
        { label: "Marker ID", value: String(item.marker_id ?? "-") },
      ] };
    }
    const serviceId = parseTagged(resource, "service", "endpoint service");
    const service = await requireService(s, serviceId);
    const servicePath = `/vpc-endpoint-services/${encodeURIComponent(service.id)}`;
    if (operation === "update-service") {
      const name = text(v.name);
      const payload: Record<string, unknown> = {};
      if (name) payload.service_name = name;
      if (typeof v.description === "string") payload.description = v.description;
      if (typeof v.approvalEnabled === "boolean") payload.approval_enabled = v.approvalEnabled;
      if (!Object.keys(payload).length) throw new ManagementInputError("Enter a new name, description, or approval setting.");
      await send(servicePath, "PUT", payload);
      return { message: "Endpoint service updated.", resourceId: service.id };
    }
    if (operation === "delete-service") {
      const connections = (await fetchConnections(s, service.id)).filter(c => ["pendingAcceptance", "creating", "accepted"].includes(c.status));
      if (connections.length) throw new ManagementInputError(`${connections.length} endpoint connection(s) still target this service. Delete or wait for them before deleting the service.`, 409);
      await send(servicePath, "DELETE");
      return { message: "Endpoint service deletion submitted.", resourceId: service.id, asynchronous: true };
    }
    if (operation === "inspect-service") {
      const [detail, permissions, connections] = await Promise.all([send(servicePath, "GET"), fetchPermissions(s, service.id), fetchConnections(s, service.id)]);
      const item = asRecord(detail);
      const ports = asArray(item.ports).map(p => { const port = asRecord(p); return `${port.client_port}→${port.server_port} ${asString(port.protocol, "TCP")}`; });
      return { message: `Service ${service.serviceName} loaded with ${permissions.length} whitelist entr(ies) and ${connections.length} connection(s).`, facts: [
        { label: "Status", value: firstString([item.status], service.status) },
        { label: "Backend", value: `${asString(item.server_type, service.serverType)} · ${asString(item.port_id, service.portId)}` },
        { label: "Port mappings", value: ports.join(", ") || "-" },
        { label: "Approval", value: item.approval_enabled === true ? "required" : "not required" },
        ...permissions.map(p => ({ label: `Whitelist · ${p.permissionType}`, value: p.permission })),
        ...connections.map(c => ({ label: `Connection · ${c.id}`, value: `${c.domainId} · ${c.status}` })),
      ] };
    }
    if (operation === "add-permission") {
      const permission = String(v.permission);
      if (!new RegExp(DOMAIN_PERMISSION_PATTERN, "u").test(permission)) throw new ManagementInputError("Enter the full form iam:domain:: followed by the 32-character domain ID.");
      if ((await fetchPermissions(s, service.id)).some(p => p.permission === permission)) throw new ManagementInputError("This domain is already whitelisted for the service.", 409);
      await send(`${servicePath}/permissions/action`, "POST", { permissions: [permission], permission_type: "domainId", action: "add" });
      return { message: "Cross-account whitelist entry submitted.", resourceId: service.id, asynchronous: true };
    }
    if (operation === "remove-permission") {
      const entry = (await fetchPermissions(s, service.id)).find(p => p.permission === v.permission);
      if (!entry) throw new ManagementInputError("The whitelist entry no longer belongs to this service.", 404);
      await send(`${servicePath}/permissions/action`, "POST", { permissions: [entry.permission], permission_type: entry.permissionType === "orgPath" ? "orgPath" : "domainId", action: "remove" });
      return { message: "Whitelist entry removal submitted.", resourceId: service.id, asynchronous: true };
    }
    if (operation === "accept-connection" || operation === "reject-connection") {
      const connection = (await fetchConnections(s, service.id)).find(c => c.id === v.connection);
      if (!connection) throw new ManagementInputError("The connection no longer targets this service.", 404);
      if (connection.status !== "pendingAcceptance") throw new ManagementInputError(`The connection is no longer pending acceptance (status ${connection.status}).`, 409);
      await send(`${servicePath}/connections/action`, "POST", { action: operation === "accept-connection" ? "receive" : "reject", endpoints: [connection.id] });
      return { message: operation === "accept-connection" ? "Connection acceptance submitted." : "Connection rejection submitted.", resourceId: service.id, asynchronous: true };
    }
    throw new ManagementInputError("Unsupported VPC endpoint operation.");
  },
};
