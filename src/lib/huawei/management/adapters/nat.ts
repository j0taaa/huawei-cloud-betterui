import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { createNatGateway, deleteNatGateway, listNatGatewaysForProject } from "@/lib/huawei/services/nat";
import { listEipsForProject } from "@/lib/huawei/services/eip";
import { listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";
const root = (s: BetterUiSession) => `/v2/${s.projectId}`;
const name: ManagementField = { key: "name", label: "Gateway name", required: true, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]*$" };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 255, allowEmpty: true, pattern: "^[^<>]*$" };
const eip: ManagementField = { key: "eip", label: "Elastic IP", type: "select", source: "eips", required: true };
const subnet: ManagementField = { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true };
const dnatFields: ManagementField[] = [description, eip, { key: "port", label: "Backend network port", type: "select", source: "ports", required: true }, { key: "protocol", label: "Protocol", type: "select", required: true, defaultValue: "tcp", choices: ["tcp", "udp", "any"].map(value => ({ value, label: value.toUpperCase() })) }, { key: "internal", label: "Backend port (0 for ANY)", type: "number", required: true, min: 0, max: 65535, defaultValue: 80 }, { key: "external", label: "Public port (0 for ANY)", type: "number", required: true, min: 0, max: 65535, defaultValue: 80 }];
const snatRule: ManagementField = { key: "rule", label: "SNAT rule", type: "select", source: "snatRules", required: true };
const dnatRule: ManagementField = { key: "rule", label: "DNAT rule", type: "select", source: "dnatRules", required: true };
const ruleImpact = "NAT rules change public connectivity. DNAT exposes the backend through the chosen EIP, subject to security-group and application rules. EIP bandwidth and traffic charges apply.";
async function rules(s: BetterUiSession, type: "snat" | "dnat", gateway: string) {
  const field = `${type}_rules`;
  const response = await huaweiList<Record<string, unknown>>(s, "nat", `${root(s)}/${field}?nat_gateway_id=${encodeURIComponent(gateway)}&limit=1000`, { items: [field], kind: "marker", parameter: "marker", size: 1000, fallbackKey: "id" });
  return asArray(response[field]).map(asRecord).filter(r => r.nat_gateway_id === gateway && (!r.tenant_id || r.tenant_id === s.projectId));
}
async function ports(s: BetterUiSession, vpc: string) {
  const [response, subnets] = await Promise.all([huaweiList<Record<string, unknown>>(s, "vpc", "/v2.0/ports?limit=200", { items: ["ports"], kind: "marker", parameter: "marker", size: 200, fallbackKey: "id" }), listSubnetsForProject(s)]);
  const networks = new Set(subnets.filter(subnet => subnet.vpcId === vpc && subnet.neutronNetworkId !== "-").map(subnet => subnet.neutronNetworkId));
  return asArray(response.ports).map(asRecord).filter(p => (p.tenant_id ?? p.project_id) === s.projectId && networks.has(String(p.network_id)) && ["compute:nova", "baremetal:none", ""].includes(String(p.device_owner ?? "")));
}
export const natManagement: ManagementAdapter = {
  title: "Public NAT Gateway",
  operations: [
    { id: "create", label: "Create public NAT gateway", kind: "create", description: "Create a pay-per-use public gateway in a current VPC subnet, using region-supported specifications.", fields: [name, description, { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true }, subnet, { key: "spec", label: "Gateway specification", type: "select", source: "specs", required: true }, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }], impact: "The NAT gateway incurs recurring charges. EIPs and translation rules are configured separately." },
    { id: "update", label: "Edit gateway", kind: "update", description: "Rename the gateway and edit its description while preserving specification, network, and session settings.", fields: [name, description], allowedStatuses: ["ACTIVE"] },
    { id: "delete", label: "Delete empty gateway", kind: "delete", description: "Delete the gateway after removing every SNAT and DNAT rule. EIPs remain allocated.", fields: [], confirmation: true, allowedStatuses: ["ACTIVE", "ERROR"] },
    { id: "rules", label: "View translation rules", kind: "inspect", description: "List all SNAT and DNAT rules belonging to this gateway.", fields: [] },
    { id: "create-snat", label: "Create subnet SNAT rule", kind: "action", description: "Allow a current subnet in the gateway's VPC to use an EIP for outbound access.", fields: [description, subnet, eip], allowedStatuses: ["ACTIVE"], impact: ruleImpact },
    { id: "update-snat", label: "Edit SNAT description", kind: "update", description: "Edit one current SNAT rule's description while preserving its source and EIP.", fields: [snatRule, description], allowedStatuses: ["ACTIVE"] },
    { id: "delete-snat", label: "Delete SNAT rule", kind: "action", description: "Remove a current outbound translation rule.", fields: [snatRule], confirmation: true, impact: "Outbound connections using this SNAT rule are interrupted." },
    { id: "create-dnat", label: "Create DNAT forwarding rule", kind: "action", description: "Forward TCP, UDP, or all ports from an EIP to a current backend network port in this VPC.", fields: dnatFields, allowedStatuses: ["ACTIVE"], impact: ruleImpact },
    { id: "update-dnat", label: "Edit DNAT forwarding rule", kind: "update", description: "Replace one current rule's backend, public EIP, protocol, ports, and description.", fields: [dnatRule, ...dnatFields], allowedStatuses: ["ACTIVE"], confirmation: true, impact: ruleImpact },
    { id: "delete-dnat", label: "Delete DNAT forwarding rule", kind: "action", description: "Remove a current inbound forwarding rule.", fields: [dnatRule], confirmation: true, impact: "Public connections through this forwarding rule are interrupted." },
  ],
  inventory: async s => (await listNatGatewaysForProject(s)).filter(g => g.projectId === s.projectId).map(g => ({ id: g.id, name: g.name, status: g.status, values: { name: g.name, description: g.description } })),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [vpcs, subnets, response] = await Promise.all([listVpcsForProject(s), listSubnetsForProject(s), huaweiFetch<Record<string, unknown>>(s, "nat", `${root(s)}/nat_gateway_specs`)]);
      return { vpcs: vpcs.map(v => ({ value: v.id, label: v.name })), subnets: subnets.filter(v => v.neutronNetworkId && v.neutronNetworkId !== "-").map(v => ({ value: v.id, label: `${v.name} · ${v.vpcId}` })), specs: asArray(response.specs).filter((v): v is string => typeof v === "string").map(value => ({ value, label: ({ "1": "Small", "2": "Medium", "3": "Large", "4": "Extra large", "5": "Enterprise" } as Record<string, string>)[value] ?? value })) };
    }
    if (!resource) return {};
    const gateway = (await listNatGatewaysForProject(s)).find(g => g.id === resource.id);
    if (!gateway) throw new ManagementInputError("The gateway no longer exists.", 404);
    const choices: Record<string, ManagementChoice[]> = {};
    if (operation.endsWith("snat")) choices.snatRules = (await rules(s, "snat", gateway.id)).map(r => ({ value: String(r.id), label: `${r.cidr || r.network_id || r.id} · ${r.floating_ip_address || r.floating_ip_id}` }));
    if (operation.endsWith("dnat")) choices.dnatRules = (await rules(s, "dnat", gateway.id)).map(r => ({ value: String(r.id), label: `${r.floating_ip_address}:${r.external_service_port} → ${r.private_ip || r.port_id}:${r.internal_service_port}` }));
    if (operation === "create-snat") choices.subnets = (await listSubnetsForProject(s)).filter(v => v.vpcId === gateway.vpcId && v.neutronNetworkId && v.neutronNetworkId !== "-").map(v => ({ value: v.id, label: `${v.name} · ${v.cidr}` }));
    if (["create-snat", "create-dnat", "update-dnat"].includes(operation)) {
      const [ips, snat, dnat] = await Promise.all([listEipsForProject(s), rules(s, "snat", gateway.id), rules(s, "dnat", gateway.id)]);
      const current = new Set([...snat, ...dnat].flatMap(r => String(r.floating_ip_id ?? "").split(",")));
      choices.eips = ips.filter(ip => ip.ipVersion === "4" && ["DOWN", "ACTIVE"].includes(ip.status) && (!ip.portId || current.has(ip.id))).map(ip => ({ value: ip.id, label: `${ip.ipAddress} · ${ip.name}` }));
    }
    if (["create-dnat", "update-dnat"].includes(operation)) choices.ports = (await ports(s, gateway.vpcId)).map(p => ({ value: String(p.id), label: `${p.name || p.device_id || p.id} · ${asArray(p.fixed_ips).map(ip => asRecord(ip).ip_address).join(", ")}` }));
    return choices;
  },
  invalidationKeys: () => [cloudCacheKeys.listNatGateways, cloudCacheKeys.listNatSnatRules, cloudCacheKeys.listEips],
  execute: async (s, operation, v, resource) => {
    const send = (path: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "nat", `${root(s)}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (operation === "create") {
      const selected = (await listSubnetsForProject(s)).find(subnet => subnet.id === v.subnet);
      if (!selected || selected.vpcId !== v.vpc || !selected.neutronNetworkId || selected.neutronNetworkId === "-") throw new ManagementInputError("Select a subnet with a Neutron network in the selected VPC.");
      const result = await createNatGateway(s, { name: String(v.name), description: String(v.description ?? ""), routerId: String(v.vpc), subnetId: selected.neutronNetworkId, spec: String(v.spec), enterpriseProjectId: String(v.enterpriseProjectId ?? "0"), projectId: s.projectId });
      return { message: "Public NAT gateway creation submitted.", resourceId: asString(asRecord(result.nat_gateway).id, "") || result.nat_gateway_id, asynchronous: true };
    }
    const gateway = (await listNatGatewaysForProject(s)).find(g => g.id === resource!.id && g.projectId === s.projectId);
    if (!gateway) throw new ManagementInputError("The gateway no longer exists in this project.", 404);
    if (operation === "rules" || operation === "delete") {
      const [snat, dnat] = await Promise.all([rules(s, "snat", gateway.id), rules(s, "dnat", gateway.id)]);
      if (operation === "rules") return { message: `${snat.length} SNAT and ${dnat.length} DNAT rules loaded.`, facts: [...snat.map(r => ({ label: `SNAT · ${r.id}`, value: `${r.cidr || r.network_id} → ${r.floating_ip_address || r.floating_ip_id} · ${r.status}` })), ...dnat.map(r => ({ label: `DNAT · ${r.id}`, value: `${r.floating_ip_address}:${r.external_service_port} → ${r.private_ip || r.port_id}:${r.internal_service_port} · ${r.protocol} · ${r.status}` }))] };
      if (snat.length || dnat.length) throw new ManagementInputError("Delete every SNAT and DNAT rule before deleting this gateway.", 409);
      await deleteNatGateway(s, gateway.id, s.projectId);
    } else if (operation === "update") await send(`/nat_gateways/${encodeURIComponent(gateway.id)}`, "PUT", { nat_gateway: { name: v.name, description: v.description ?? "" } });
    else {
      if (!gateway.adminStateUp) throw new ManagementInputError("The gateway is frozen or administratively unavailable.", 409);
      const type = operation.endsWith("snat") ? "snat" : "dnat";
      if (!["create-snat", "update-snat", "delete-snat", "create-dnat", "update-dnat", "delete-dnat"].includes(operation)) throw new ManagementInputError("Unsupported NAT operation.");
      if (!operation.startsWith("create-")) {
        const selected = (await rules(s, type, gateway.id)).find(r => r.id === v.rule);
        if (!selected) throw new ManagementInputError("The rule no longer belongs to this gateway.", 404);
        if (!["ACTIVE", "INACTIVE", "EIP_FREEZED"].includes(String(selected.status))) throw new ManagementInputError("Wait for this rule's current change to finish.", 409);
      }
      if (operation.startsWith("delete-")) await send(`/nat_gateways/${encodeURIComponent(gateway.id)}/${type}_rules/${encodeURIComponent(String(v.rule))}`, "DELETE");
      else if (operation === "update-snat") await send(`/snat_rules/${encodeURIComponent(String(v.rule))}`, "PUT", { snat_rule: { nat_gateway_id: gateway.id, description: v.description ?? "" } });
      else if (operation === "create-snat") {
        const selected = (await listSubnetsForProject(s)).find(subnet => subnet.id === v.subnet);
        if (!selected || selected.vpcId !== gateway.vpcId || !selected.neutronNetworkId || selected.neutronNetworkId === "-") throw new ManagementInputError("Select a subnet in this gateway's VPC.");
        const result = await send("/snat_rules", "POST", { snat_rule: { nat_gateway_id: gateway.id, network_id: selected.neutronNetworkId, source_type: 0, floating_ip_id: v.eip, description: v.description ?? "" } });
        return { message: "SNAT rule creation submitted.", resourceId: asString(asRecord(result.snat_rule).id, "") || undefined, asynchronous: true };
      } else {
        if (v.protocol === "any" ? (v.internal !== 0 || v.external !== 0) : (!v.internal || !v.external)) throw new ManagementInputError("ANY requires both ports to be zero. TCP and UDP require ports from 1 to 65535.");
        if (!(await ports(s, gateway.vpcId)).some(p => p.id === v.port)) throw new ManagementInputError("The backend port no longer belongs to this VPC.", 404);
        const payload = { dnat_rule: { nat_gateway_id: gateway.id, port_id: v.port, floating_ip_id: v.eip, protocol: v.protocol, internal_service_port: v.internal, external_service_port: v.external, description: v.description ?? "" } };
        const result = await send(operation === "create-dnat" ? "/dnat_rules" : `/dnat_rules/${encodeURIComponent(String(v.rule))}`, operation === "create-dnat" ? "POST" : "PUT", payload);
        return { message: "DNAT rule change submitted.", resourceId: asString(asRecord(result.dnat_rule).id, "") || undefined, asynchronous: true };
      }
    }
    return { message: "NAT gateway operation accepted. Refresh gateway and rule status to verify completion.", asynchronous: operation !== "update" };
  },
};
