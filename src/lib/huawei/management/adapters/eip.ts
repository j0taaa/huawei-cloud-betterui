import "server-only";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { createEip, listEipsForProject, releaseEip } from "@/lib/huawei/services/eip";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";

const name = { key: "name", label: "Name", required: true, max: 64, pattern: "^[\\p{L}\\p{N}_.-]{1,64}$" };
const size = { key: "size", label: "Bandwidth (Mbit/s)", type: "number" as const, required: true, min: 1, max: 2000, defaultValue: 5 };
const charge = { key: "charge", label: "Bandwidth billing", type: "select" as const, required: true, defaultValue: "traffic", choices: [{ value: "traffic", label: "Pay for traffic" }, { value: "bandwidth", label: "Pay for bandwidth" }] };

export const eipManagement: ManagementAdapter = {
  title: "Elastic IP",
  operations: [
    { id: "create", label: "Allocate elastic IP", kind: "create", description: "Allocate an IPv4 EIP with dedicated pay-per-use bandwidth.", fields: [name, size, charge, { key: "type", label: "Network type", type: "select", required: true, defaultValue: "5_bgp", choices: [{ value: "5_bgp", label: "Dynamic BGP" }, { value: "5_sbgp", label: "Static BGP (where available)" }] }, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }], impact: "Allocated IP addresses and bandwidth incur charges until released. Network types and bandwidth quotas vary by region." },
    { id: "rename", label: "Rename elastic IP", kind: "update", description: "Update the IP alias while keeping its existing binding.", fields: [name] },
    { id: "bandwidth", label: "Resize dedicated bandwidth", kind: "update", description: "Adjust pay-per-use dedicated bandwidth. Shared and prepaid bandwidth need their own billing workflow.", fields: [size, charge], impact: "Changing bandwidth size or billing changes recurring charges and the traffic capacity of this address." },
    { id: "bind", label: "Bind elastic IP", kind: "action", description: "Attach this unbound EIP to a current private network port in this project.", fields: [{ key: "port", label: "Network port", type: "select", source: "ports", required: true }], allowedStatuses: ["DOWN"], confirmation: true, impact: "The selected resource becomes reachable through a public address, subject to its security group and application settings." },
    { id: "unbind", label: "Unbind elastic IP", kind: "action", description: "Detach the public address while keeping the allocation.", fields: [], confirmation: true, impact: "Connections through this public address are interrupted. The IP continues incurring allocation charges." },
    { id: "delete", label: "Release elastic IP", kind: "delete", description: "Release an unbound pay-per-use elastic IP. The same address may not be available again.", fields: [], confirmation: true, impact: "This public address is returned to Huawei's allocation pool." },
  ],
  inventory: async (session) => (await listEipsForProject(session)).map((ip) => ({ id: ip.id, name: ip.name, status: ip.status, values: { name: ip.name, size: Number.parseInt(ip.bandwidthSize) || 5, charge: ip.bandwidthChargeMode, port: ip.portId, bandwidthId: ip.bandwidthId, billingInfo: ip.billingInfo, lock: ip.lockStatus } })),
  options: async (session, operation): Promise<Record<string, ManagementChoice[]>> => {
    if (operation !== "bind") return {};
    const result = await huaweiList<Record<string, unknown>>(session, "vpc", "/v2.0/ports?limit=200", { items: ["ports"], kind: "marker", parameter: "marker", size: 200, fallbackKey: "id" });
    return { ports: asArray(result.ports).map(asRecord).filter((port) => ["compute:nova", ""].includes(String(port.device_owner ?? "")) && (port.tenant_id ?? port.project_id) === session.projectId).map((port) => ({ value: String(port.id), label: `${port.name || port.device_id || port.id} · ${asArray(port.fixed_ips).map((ip) => asRecord(ip).ip_address).join(", ")}` })) };
  },
  invalidationKeys: () => [cloudCacheKeys.listEips, cloudCacheKeys.listEcsInstances, cloudCacheKeys.listElbs],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      const result = await createEip(session, { alias: String(values.name), bandwidthName: String(values.name), bandwidthSize: Number(values.size), bandwidthChargeMode: values.charge as "traffic" | "bandwidth", type: values.type as "5_bgp" | "5_sbgp", enterpriseProjectId: String(values.enterpriseProjectId ?? "0"), projectId: session.projectId });
      return { message: "Elastic IP allocation submitted.", resourceId: firstString([asRecord(result.publicip).id], "") || undefined, asynchronous: true };
    }
    const ip = (await listEipsForProject(session)).find((item) => item.id === resource?.id);
    if (!ip) throw new ManagementInputError("The elastic IP no longer exists in this project.", 404);
    const path = `/v1/${session.projectId}/publicips/${encodeURIComponent(ip.id)}`;
    if (operation === "bandwidth") {
      if (ip.billingInfo !== "-" && ip.billingInfo !== "") throw new ManagementInputError("Prepaid bandwidth changes require a renewal or order workflow.", 409);
      const result = await huaweiFetch<{ bandwidth?: unknown }>(session, "eip", `/v1/${session.projectId}/bandwidths/${encodeURIComponent(ip.bandwidthId)}`);
      const bandwidth = asRecord(result.bandwidth);
      if (bandwidth.share_type !== "PER") throw new ManagementInputError("This is shared bandwidth. Updating it affects multiple addresses; use a shared-bandwidth workflow.", 409);
      const amount = Number(values.size);
      if ((amount > 300 && amount <= 1000 && amount % 50) || (amount > 1000 && amount % 500)) throw new ManagementInputError("Above 300 Mbit/s use steps of 50; above 1000 use steps of 500.");
      await huaweiFetch(session, "eip", `/v1/${session.projectId}/bandwidths/${encodeURIComponent(ip.bandwidthId)}`, { method: "PUT", body: JSON.stringify({ bandwidth: { size: amount, charge_mode: values.charge } }) });
    } else if (operation === "delete") {
      if (ip.portId || (ip.billingInfo !== "-" && ip.billingInfo !== "")) throw new ManagementInputError("Unbind this IP first. Prepaid addresses require their billing release workflow.", 409);
      await releaseEip(session, ip.id, session.projectId);
    } else if (["rename", "bind", "unbind"].includes(operation)) {
      if (operation === "bind" && ip.portId) throw new ManagementInputError("Unbind the existing network port first.", 409);
      // The native API treats a missing port_id as unbinding. Alias changes must stay separate.
      const publicip = operation === "rename" ? { alias: values.name } : { port_id: operation === "bind" ? values.port : "" };
      await huaweiFetch(session, "eip", path, { method: "PUT", body: JSON.stringify({ publicip }) });
    } else throw new ManagementInputError("Unsupported elastic IP operation.");
    return { message: "Elastic IP operation accepted.", resourceId: ip.id, asynchronous: operation !== "rename" };
  },
};
