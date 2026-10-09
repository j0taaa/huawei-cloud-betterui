import "server-only";
import { isIP } from "node:net";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listElbsForProject } from "@/lib/huawei/services/elb";
import { listSubnetsForProject } from "@/lib/huawei/services/vpc";
import { listEipsForProject } from "@/lib/huawei/services/eip";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";
const name = { key: "name", label: "Name", required: true, max: 255 };
const description = { key: "description", label: "Description", type: "textarea" as const, max: 255, allowEmpty: true };
const port = { key: "port", label: "Port", type: "number" as const, required: true, min: 1, max: 65535 };
const protocol = { key: "protocol", label: "Protocol", type: "select" as const, required: true, defaultValue: "TCP", choices: ["TCP", "UDP", "HTTP", "HTTPS"].map((value) => ({ value, label: value })) };
const poolProtocol = { ...protocol, choices: ["TCP", "UDP", "HTTP"].map((value) => ({ value, label: value })) };
const algorithm = { key: "algorithm", label: "Balancing algorithm", type: "select" as const, required: true, defaultValue: "ROUND_ROBIN", choices: ["ROUND_ROBIN", "LEAST_CONNECTIONS", "SOURCE_IP"].map((value) => ({ value, label: value.replaceAll("_", " ") })) };
const select = (key: string, label: string, source: string): ManagementField => ({ key, label, type: "select", source, required: true });
const listener = select("listener", "Listener", "listeners"), pool = select("pool", "Backend pool", "pools");
const weight = { key: "weight", label: "Traffic weight", type: "number" as const, required: true, min: 0, max: 100, defaultValue: 1 };
const monitorFields: ManagementField[] = [select("type", "Health check type", "monitorTypes"), { key: "interval", label: "Interval (seconds)", type: "number", required: true, min: 1, max: 50, defaultValue: 5 }, { key: "timeout", label: "Timeout (seconds)", type: "number", required: true, min: 1, max: 50, defaultValue: 3 }, { key: "retries", label: "Healthy threshold", type: "number", required: true, min: 1, max: 10, defaultValue: 3 }, { key: "path", label: "HTTP request path", max: 255, defaultValue: "/", pattern: "^/[^\\r\\n]*$" }];
const base = (session: BetterUiSession) => `/v3/${session.projectId}/elb`;
async function records(session: BetterUiSession, collection: string, filter?: Record<string, string>) {
  const query = new URLSearchParams({ limit: "100", ...filter });
  const field = collection.split("/").at(-1)!;
  const result = await huaweiList<Record<string, unknown>>(session, "elb", `${base(session)}/${collection}?${query}`, { items: [field], kind: "marker", parameter: "marker", size: 100, next: ["page_info.next_marker"], fallbackKey: "id" });
  return asArray(result[field]).map(asRecord);
}
function owned(items: Record<string, unknown>[], resource: ManagementResource) {
  return items.filter((item) => item.loadbalancer_id === resource.id || asArray(item.loadbalancers).some((ref) => asRecord(ref).id === resource.id));
}
async function poolsFor(session: BetterUiSession, resource: ManagementResource) { return owned(await records(session, "pools", { loadbalancer_id: resource.id }), resource); }
async function listenersFor(session: BetterUiSession, resource: ManagementResource) { return owned(await records(session, "listeners", { loadbalancer_id: resource.id }), resource); }
const choices = (items: Record<string, unknown>[]) => items.map((item) => ({ value: String(item.id), label: `${item.name || item.id} · ${item.protocol || item.type || ""}` }));
export const elbManagement: ManagementAdapter = {
  title: "Elastic Load Balance",
  operations: [
    { id: "create", label: "Create dedicated load balancer", kind: "create", description: "Create one pay-per-use dedicated load balancer with private IPv4 networking. Select at least one live L4 or L7 flavor.", fields: [name, description, select("subnet", "VIP subnet", "subnets"), select("zone", "Availability zone", "zones"), { ...select("l4", "Network flavor (L4)", "l4"), required: false }, { ...select("l7", "Application flavor (L7)", "l7"), required: false }, { ...select("eip", "Existing unbound elastic IP", "eips"), required: false }, { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" }], impact: "Dedicated load balancer capacity incurs charges. An attached elastic IP makes configured listeners publicly reachable." },
    { id: "update", label: "Edit load balancer", kind: "update", description: "Rename the load balancer and update its description.", fields: [name, description] },
    { id: "delete", label: "Delete empty load balancer", kind: "delete", description: "Delete the load balancer after removing its listeners and pools. Attached EIPs remain allocated.", fields: [], confirmation: true, impact: "The virtual IP and load balancer are permanently removed. Retained IPs can continue incurring charges." },
    { id: "topology", label: "View traffic configuration", kind: "inspect", description: "List listeners and backend pools for this load balancer.", fields: [] },
    { id: "create-listener", label: "Create listener", kind: "action", description: "Open a frontend port. HTTPS requires a current server certificate.", fields: [name, protocol, port, { ...select("certificate", "Server certificate (HTTPS)", "certificates"), required: false }], impact: "The load balancer accepts traffic on the selected port. Configure a backend pool and network access rules." },
    { id: "update-listener", label: "Rename listener", kind: "action", description: "Update a current listener's name.", fields: [listener, name] },
    { id: "enable-listener", label: "Enable listener", kind: "action", description: "Enable incoming traffic for this listener.", fields: [listener], impact: "This listener resumes accepting frontend traffic." },
    { id: "disable-listener", label: "Disable listener", kind: "action", description: "Stop incoming traffic for this listener.", fields: [listener], confirmation: true, impact: "Traffic through this listener is interrupted." },
    { id: "delete-listener", label: "Delete listener", kind: "action", description: "Remove a listener from this load balancer.", fields: [listener], confirmation: true, impact: "The listener's frontend port stops accepting traffic." },
    { id: "create-pool", label: "Create backend pool", kind: "action", description: "Create a backend pool for this load balancer. Assign it to a listener after adding members.", fields: [name, poolProtocol, algorithm] },
    { id: "update-pool", label: "Configure backend pool", kind: "action", description: "Update the pool name and balancing algorithm.", fields: [pool, name, algorithm], impact: "The changed balancing algorithm affects traffic distribution to all pool members." },
    { id: "delete-pool", label: "Delete backend pool", kind: "action", description: "Remove an unassigned pool after removing members and health checks.", fields: [pool], confirmation: true, impact: "The backend pool configuration is permanently removed." },
    { id: "assign-pool", label: "Assign listener backend pool", kind: "action", description: "Set this listener's default backend pool.", fields: [listener, pool], confirmation: true, impact: "New traffic for this listener is sent to the selected pool." },
    { id: "members", label: "View backend members", kind: "inspect", description: "List current servers in a backend pool.", fields: [pool] },
    { id: "add-member", label: "Add backend server", kind: "action", description: "Add an IPv4 backend in a current subnet of this load balancer's VPC.", fields: [pool, name, select("subnet", "Backend subnet", "subnets"), { key: "address", label: "Private IPv4 address", required: true, max: 15 }, port, weight], impact: "This backend becomes eligible to receive application traffic. Verify its service and network access." },
    { id: "update-member", label: "Change backend weight", kind: "action", description: "Change a member's relative traffic weight. Zero drains it from new weighted traffic.", fields: [pool, select("member", "Backend member", "members"), weight], impact: "Traffic distribution changes for this pool. Established connections may continue." },
    { id: "delete-member", label: "Remove backend server", kind: "action", description: "Detach a member from its backend pool without deleting the server.", fields: [pool, select("member", "Backend member", "members")], confirmation: true, impact: "The member stops receiving new pool traffic; active connections may be interrupted." },
    { id: "health", label: "View health checks", kind: "inspect", description: "Read current pool health checks.", fields: [pool] },
    { id: "create-health", label: "Create health check", kind: "action", description: "Create a health check for the selected pool.", fields: [pool, ...monitorFields], impact: "Unhealthy members are excluded from traffic according to this health check." },
    { id: "delete-health", label: "Delete health check", kind: "action", description: "Remove this pool's current health check.", fields: [pool], confirmation: true, impact: "The pool stops detecting backend health with this check." },
  ],
  inventory: async (session) => (await listElbsForProject(session)).map((lb) => ({ id: lb.id, name: lb.name, status: lb.provisioningStatus, values: { name: lb.name, description: lb.description, subnet: lb.vipSubnetCidrId } })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [flavors, zonesResult, subnets, ips] = await Promise.all([records(session, "flavors"), huaweiFetch<Record<string, unknown>>(session, "elb", `${base(session)}/availability-zones`), listSubnetsForProject(session), listEipsForProject(session)]);
      const zones = asArray(zonesResult.availability_zones).flatMap((item) => Array.isArray(item) ? item : [item]).map(asRecord).filter((zone) => zone.state === "ACTIVE");
      return { l4: choices(flavors.filter((flavor) => flavor.type === "L4" && flavor.flavor_sold_out !== true)), l7: choices(flavors.filter((flavor) => flavor.type === "L7" && flavor.flavor_sold_out !== true)), zones: [...new Map(zones.map((zone) => [String(zone.code), { value: String(zone.code), label: String(zone.code) }])).values()], subnets: subnets.filter((subnet) => subnet.status === "ACTIVE").map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr}` })), eips: ips.filter((ip) => !ip.portId && ip.status === "DOWN").map((ip) => ({ value: ip.id, label: ip.ipAddress })) };
    }
    if (!resource) return {};
    const result: Record<string, ManagementChoice[]> = {};
    if (operation.includes("listener") || operation === "assign-pool") result.listeners = choices(await listenersFor(session, resource));
    if (operation === "create-listener") result.certificates = choices((await records(session, "certificates")).filter((cert) => cert.type === "server"));
    if (operation.includes("pool") || ["members", "add-member", "update-member", "delete-member", "health", "create-health", "delete-health"].includes(operation)) result.pools = choices(await poolsFor(session, resource));
    if (["update-member", "delete-member"].includes(operation)) {
      const pools = await poolsFor(session, resource);
      const members = await Promise.all(pools.map(async (pool) => ({ pool, items: await records(session, `pools/${encodeURIComponent(String(pool.id))}/members`) })));
      result.members = members.flatMap(({ pool, items }) => items.map((member) => ({ value: String(member.id), label: `${pool.name || pool.id} · ${member.address}:${member.protocol_port}` })));
    }
    if (operation === "add-member") {
      const lb = await huaweiFetch<{ loadbalancer?: unknown }>(session, "elb", `${base(session)}/loadbalancers/${encodeURIComponent(resource.id)}`);
      result.subnets = (await listSubnetsForProject(session)).filter((subnet) => subnet.vpcId === asRecord(lb.loadbalancer).vpc_id).map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr}` }));
    }
    result.monitorTypes = ["TCP", "UDP_CONNECT", "HTTP", "HTTPS"].map((value) => ({ value, label: value }));
    return result;
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listElbs, cloudCacheKeys.listEips, ...(resource ? [cloudCacheKeys.elb(resource.id)] : [])],
  execute: async (session, operation, values, resource) => {
    const root = base(session);
    if (operation === "create") {
      if (!values.l4 && !values.l7) throw new ManagementInputError("Select at least one network or application flavor.");
      const subnet = (await listSubnetsForProject(session)).find((subnet) => subnet.id === values.subnet);
      if (!subnet) throw new ManagementInputError("The subnet no longer exists.", 404);
      const availability = await huaweiFetch<Record<string, unknown>>(session, "elb", `${root}/availability-zones`);
      const zone = asArray(availability.availability_zones).flatMap((row) => Array.isArray(row) ? row : [row]).map(asRecord).find((zone) => zone.code === values.zone && zone.state === "ACTIVE" && (!values.l4 || asArray(zone.protocol).includes("L4")) && (!values.l7 || asArray(zone.protocol).includes("L7")));
      if (!zone) throw new ManagementInputError("The selected flavors are unavailable in this availability zone.", 409);
      const result = await huaweiFetch<{ loadbalancer?: unknown }>(session, "elb", `${root}/loadbalancers`, { method: "POST", body: JSON.stringify({ loadbalancer: { name: values.name, description: values.description ?? "", guaranteed: true, vpc_id: subnet.vpcId, vip_subnet_cidr_id: subnet.id, availability_zone_list: [values.zone], ...(values.l4 ? { l4_flavor_id: values.l4 } : {}), ...(values.l7 ? { l7_flavor_id: values.l7 } : {}), ...(values.eip ? { publicip_ids: [values.eip] } : {}), enterprise_project_id: values.enterpriseProjectId ?? "0" } }) });
      return { message: "Load balancer creation submitted.", resourceId: firstString([asRecord(result.loadbalancer).id], "") || undefined, asynchronous: true };
    }
    const lbPath = `${root}/loadbalancers/${encodeURIComponent(resource!.id)}`;
    if (operation === "update") { await huaweiFetch(session, "elb", lbPath, { method: "PUT", body: JSON.stringify({ loadbalancer: { name: values.name, description: values.description ?? "" } }) }); return { message: "Load balancer updated." }; }
    if (["delete", "topology"].includes(operation)) {
      const [listeners, pools] = await Promise.all([listenersFor(session, resource!), poolsFor(session, resource!)]);
      if (operation === "topology") return { message: "Load balancer traffic configuration loaded.", facts: [...listeners.map((item) => ({ label: `Listener ${item.name || item.id}`, value: `${item.protocol}:${item.protocol_port} · ${item.id}` })), ...pools.map((item) => ({ label: `Pool ${item.name || item.id}`, value: `${item.protocol} · ${item.lb_algorithm} · ${item.id}` }))] };
      if (listeners.length || pools.length) throw new ManagementInputError("Remove listeners and pools before deleting the load balancer.", 409);
      await huaweiFetch(session, "elb", lbPath, { method: "DELETE" }); return { message: "Load balancer deletion submitted.", asynchronous: true };
    }
    let selectedListener: Record<string, unknown> | undefined, selectedPool: Record<string, unknown> | undefined;
    if (values.listener) { selectedListener = (await listenersFor(session, resource!)).find((item) => item.id === values.listener); if (!selectedListener) throw new ManagementInputError("The listener is not attached to this load balancer.", 404); }
    if (values.pool) { selectedPool = (await poolsFor(session, resource!)).find((item) => item.id === values.pool); if (!selectedPool) throw new ManagementInputError("The pool is not attached to this load balancer.", 404); }
    const poolPath = `${root}/pools/${encodeURIComponent(String(values.pool))}`;
    let path: string, method = "POST", payload: Record<string, unknown> | undefined;
    if (operation === "create-listener") {
      if (values.protocol === "HTTPS" && !values.certificate) throw new ManagementInputError("HTTPS listeners require a server certificate.");
      path = `${root}/listeners`; payload = { listener: { name: values.name, loadbalancer_id: resource!.id, protocol: values.protocol, protocol_port: values.port, ...(values.protocol === "HTTPS" ? { default_tls_container_ref: values.certificate } : {}) } };
    } else if (["update-listener", "enable-listener", "disable-listener", "delete-listener", "assign-pool"].includes(operation)) {
      path = `${root}/listeners/${encodeURIComponent(String(values.listener))}`; method = operation === "delete-listener" ? "DELETE" : "PUT";
      if (operation === "assign-pool" && (selectedListener?.protocol === "HTTPS" ? selectedPool?.protocol !== "HTTP" : selectedListener?.protocol !== selectedPool?.protocol)) throw new ManagementInputError("The listener and backend pool protocols are incompatible.");
      payload = operation === "delete-listener" ? undefined : { listener: operation === "assign-pool" ? { default_pool_id: values.pool } : operation === "update-listener" ? { name: values.name } : { admin_state_up: operation === "enable-listener" } };
    } else if (operation === "create-pool") { path = `${root}/pools`; payload = { pool: { name: values.name, protocol: values.protocol, lb_algorithm: values.algorithm, loadbalancer_id: resource!.id } }; }
    else if (operation === "update-pool") { path = poolPath; method = "PUT"; payload = { pool: { name: values.name, lb_algorithm: values.algorithm } }; }
    else if (operation === "delete-pool") { path = poolPath; method = "DELETE"; }
    else if (operation === "members" || operation === "update-member" || operation === "delete-member") {
      const members = await records(session, `pools/${encodeURIComponent(String(values.pool))}/members`);
      if (operation === "members") return { message: `${members.length} backend members loaded.`, facts: members.map((member) => ({ label: `${member.name || member.id} · ${member.address}:${member.protocol_port}`, value: `${member.operating_status} · weight ${member.weight} · ${member.id}` })) };
      if (!members.some((member) => member.id === values.member)) throw new ManagementInputError("The member does not belong to the selected pool.", 404);
      path = `${poolPath}/members/${encodeURIComponent(String(values.member))}`; method = operation === "delete-member" ? "DELETE" : "PUT"; payload = operation === "delete-member" ? undefined : { member: { weight: values.weight } };
    } else if (operation === "add-member") {
      const subnet = (await listSubnetsForProject(session)).find((subnet) => subnet.id === values.subnet);
      const address = String(values.address);
      const lb = asRecord((await huaweiFetch<{ loadbalancer?: unknown }>(session, "elb", lbPath)).loadbalancer);
      if (!subnet || subnet.vpcId !== lb.vpc_id || isIP(address) !== 4) throw new ManagementInputError("Use a valid IPv4 address and subnet inside this load balancer's VPC.");
      const [network, prefix] = subnet.cidr.split("/");
      const integer = (value: string) => value.split(".").reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
      const mask = (0xffffffff << (32 - Number(prefix))) >>> 0;
      if ((integer(address) & mask) >>> 0 !== (integer(network) & mask) >>> 0) throw new ManagementInputError("The backend address must belong to the selected subnet.");
      path = `${poolPath}/members`; payload = { member: { name: values.name, address, protocol_port: values.port, subnet_cidr_id: subnet.id, weight: values.weight } };
    } else if (["health", "create-health", "delete-health"].includes(operation)) {
      const monitors = (await records(session, "healthmonitors", { pool_id: String(values.pool) })).filter((monitor) => monitor.pool_id === values.pool || monitor.id === selectedPool?.healthmonitor_id || asArray(monitor.pools).some((pool) => asRecord(pool).id === values.pool));
      if (operation === "health") return { message: `${monitors.length} health checks loaded.`, facts: monitors.map((monitor) => ({ label: String(monitor.type), value: `${monitor.delay}s interval · ${monitor.timeout}s timeout · ${monitor.id}` })) };
      if (operation === "delete-health") { if (monitors.length !== 1) throw new ManagementInputError("Select a pool with one current health check.", 409); path = `${root}/healthmonitors/${encodeURIComponent(String(monitors[0].id))}`; method = "DELETE"; }
      else {
        if (monitors.length) throw new ManagementInputError("The pool already has a health check.", 409);
        if (Number(values.timeout) > Number(values.interval)) throw new ManagementInputError("The timeout cannot exceed the check interval.");
        if ((selectedPool?.protocol === "UDP" && values.type !== "UDP_CONNECT") || (selectedPool?.protocol !== "UDP" && values.type === "UDP_CONNECT")) throw new ManagementInputError("The health check type is incompatible with the pool protocol.");
        path = `${root}/healthmonitors`; payload = { healthmonitor: { pool_id: values.pool, type: values.type, delay: values.interval, timeout: values.timeout, max_retries: values.retries, ...(values.type === "HTTP" || values.type === "HTTPS" ? { http_method: "GET", url_path: values.path || "/", expected_codes: "200" } : {}) } };
      }
    } else throw new ManagementInputError("Unsupported load balancer operation.");
    await huaweiFetch(session, "elb", path, { method, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { message: "Load balancer configuration submitted.", asynchronous: true };
  },
};
