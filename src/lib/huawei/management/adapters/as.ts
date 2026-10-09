import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { listAsGroupsForProject, listAsInstancesForProject, listAsPoliciesForProject } from "@/lib/huawei/services/as";
import { listEcsInstancesForProject } from "@/lib/huawei/services/ecs";
import { listSubnetsForProject, listVpcsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementValues } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";
const base = (s: BetterUiSession) => `/autoscaling-api/v1/${s.projectId}`;
const name: ManagementField = { key: "name", label: "Name", required: true, max: 64, pattern: "^[A-Za-z0-9_-]+$" };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 256, allowEmpty: true };
const cooldown: ManagementField = { key: "cooldown", label: "Cooldown (seconds)", type: "number", required: true, min: 0, max: 86400, defaultValue: 300 };
const limits: ManagementField[] = [
  { key: "minimum", label: "Minimum instances", type: "number", required: true, min: 0, max: 300, defaultValue: 0 },
  { key: "desired", label: "Desired instances", type: "number", required: true, min: 0, max: 300, defaultValue: 0 },
  { key: "maximum", label: "Maximum instances", type: "number", required: true, min: 0, max: 300, defaultValue: 1 }, cooldown,
];
const configuration: ManagementField = { key: "configuration", label: "Scaling configuration", type: "select", source: "configurations", required: true };
const members: ManagementField = { key: "members", label: "Current group instances", type: "list", source: "members", required: true, max: 10 };
const policy: ManagementField = { key: "policy", label: "Current group policy", type: "select", source: "policies", required: true };
const scaleImpact = "Scaling can provision billable ECS instances or permanently release automatically created instances according to the group's existing deletion settings.";
const policyAction: ManagementField[] = [
  { key: "action", label: "Scaling action", type: "select", required: true, defaultValue: "ADD", choices: ["ADD", "REMOVE", "SET"].map(value => ({ value, label: value })) },
  { key: "count", label: "Number of instances", type: "number", required: true, min: 0, max: 300, defaultValue: 1 }, cooldown,
];
async function configs(s: BetterUiSession) {
  const response = await huaweiList<Record<string, unknown>>(s, "as", `${base(s)}/scaling_configuration?limit=100`, { items: ["scaling_configurations"], kind: "offset", parameter: "start_number", size: 100, total: ["total_number"] });
  return asArray(response.scaling_configurations).map(asRecord).map(c => ({ id: asString(c.scaling_configuration_id, ""), name: asString(c.scaling_configuration_name, "") })).filter(c => c.id);
}
function counts(v: ManagementValues) {
  if (Number(v.minimum) > Number(v.desired) || Number(v.desired) > Number(v.maximum)) throw new ManagementInputError("Minimum must not exceed desired capacity, and desired capacity must not exceed maximum.");
  return { min_instance_number: v.minimum, desire_instance_number: v.desired, max_instance_number: v.maximum, cool_down_time: v.cooldown };
}
function policyBody(v: ManagementValues) {
  if (v.action !== "SET" && Number(v.count) === 0) throw new ManagementInputError("ADD and REMOVE require at least one instance.");
  return { scaling_policy_name: v.name, scaling_policy_action: { operation: v.action, instance_number: v.count }, cool_down_time: v.cooldown };
}
const operations: ManagementOperation[] = [
  { id: "create-configuration", label: "Create configuration from ECS", kind: "create", description: "Copy an existing ECS specification into a launch configuration. This copies configuration, not the server's current disk contents. An explicit SSH key is used for future instances.", fields: [name, { key: "server", label: "Source ECS", type: "select", source: "servers", required: true }, { key: "key", label: "SSH key pair", type: "select", source: "keys", required: true }] },
  { id: "rename-configuration", label: "Rename configuration", kind: "update", description: "Change the launch configuration name.", resourcePrefixes: ["configuration:"], fields: [name] },
  { id: "delete-configuration", label: "Delete unused configuration", kind: "delete", description: "Delete a configuration after removing it from all scaling groups.", resourcePrefixes: ["configuration:"], fields: [], confirmation: true },
  { id: "create", label: "Create scaling group", kind: "create", description: "Create a group with ECS health checks, one private subnet, and an existing launch configuration. Enabling the group can start provisioning instances.", fields: [name, description, configuration, { key: "vpc", label: "VPC", type: "select", source: "vpcs", required: true }, { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true }, ...limits], impact: scaleImpact },
  { id: "update", label: "Edit capacity and cooldown", kind: "update", description: "Change group name, description, capacity limits, and cooldown without replacing network or load-balancer settings.", resourcePrefixes: ["group:"], fields: [name, description, ...limits], allowedStatuses: ["INSERVICE", "PAUSED"], impact: scaleImpact },
  { id: "configuration", label: "Change launch configuration", kind: "update", description: "Use a different configuration for future instances. Existing instances are not rebuilt.", resourcePrefixes: ["group:"], fields: [configuration], allowedStatuses: ["INSERVICE", "PAUSED"], impact: scaleImpact },
  { id: "enable", label: "Enable scaling group", kind: "action", description: "Resume health checks and automatic capacity management.", resourcePrefixes: ["group:"], fields: [], allowedStatuses: ["PAUSED"], impact: scaleImpact },
  { id: "disable", label: "Disable scaling group", kind: "action", description: "Pause automatic scaling while leaving current instances running.", resourcePrefixes: ["group:"], fields: [], allowedStatuses: ["INSERVICE"], impact: "Automatic capacity adjustments stop. Existing instances continue to incur charges." },
  { id: "delete", label: "Delete empty group", kind: "delete", description: "Delete only an empty group with no scaling activity in progress.", resourcePrefixes: ["group:"], fields: [], confirmation: true },
  { id: "members", label: "View group instances", kind: "inspect", description: "Inspect instance health, lifecycle, and scale-in protection.", resourcePrefixes: ["group:"], fields: [] },
  { id: "policies", label: "View scaling policies", kind: "inspect", description: "List all current policies and their scaling actions.", resourcePrefixes: ["group:"], fields: [] },
  { id: "activity", label: "View scaling activity", kind: "inspect", description: "Load the group's native scaling activity records.", resourcePrefixes: ["group:"], fields: [] },
  { id: "create-daily-policy", label: "Create daily policy", kind: "action", description: "Schedule a daily capacity change in UTC with an explicit expiry date.", resourcePrefixes: ["group:"], fields: [name, ...policyAction, { key: "time", label: "Daily UTC time (HH:mm)", required: true, pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" }, { key: "end", label: "Expiry in UTC (YYYY-MM-DDTHH:mmZ)", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}Z$" }], impact: scaleImpact },
  { id: "rename-policy", label: "Rename policy", kind: "update", description: "Rename one of this group's policies, preserving its schedule and action.", resourcePrefixes: ["group:"], fields: [policy, name] },
  ...(["enable", "disable", "execute", "delete"] as const).map(action => ({ id: `${action}-policy`, label: `${action[0].toUpperCase()}${action.slice(1)} policy`, kind: "action" as const, description: `${action[0].toUpperCase()}${action.slice(1)} one current policy.`, resourcePrefixes: ["group:"], fields: [policy], ...(action === "execute" || action === "enable" ? { impact: scaleImpact } : {}), ...(action === "delete" ? { confirmation: true } : {}) })),
  ...(["protect", "unprotect", "standby", "resume-member", "remove-members"] as const).map(action => ({ id: action, label: ({ protect: "Protect instances from scale-in", unprotect: "Remove scale-in protection", standby: "Put instances on standby", "resume-member": "Return instances to service", "remove-members": "Detach instances without deletion" })[action], kind: "action" as const, description: "Apply an action to up to ten current group members.", resourcePrefixes: ["group:"], fields: [members], allowedStatuses: ["INSERVICE", "PAUSED"], ...(action !== "protect" ? { impact: action === "remove-members" ? "Instances are detached without deletion, and keep running and incurring charges. Load-balancer membership may change." : scaleImpact } : {}), ...(action === "remove-members" ? { confirmation: true } : {}) })),
];
export const asManagement: ManagementAdapter = {
  title: "Auto Scaling", operations,
  inventory: async s => {
    const [groups, configurations] = await Promise.all([listAsGroupsForProject(s), configs(s)]);
    return [...groups.map(g => ({ id: `group:${g.id}`, name: g.name, status: g.status, values: { name: g.name, description: g.description, minimum: g.minimum, desired: g.desired, maximum: g.maximum, cooldown: g.cooldown, configuration: g.configurationId } })), ...configurations.map(c => ({ id: `configuration:${c.id}`, name: c.name, status: "AVAILABLE", values: { name: c.name } }))];
  },
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-configuration") {
      const [servers, keys] = await Promise.all([listEcsInstancesForProject(s), huaweiList<Record<string, unknown>>(s, "ecs", `/v2.1/${s.projectId}/os-keypairs?limit=100`, { items: ["keypairs"], kind: "marker", parameter: "marker", size: 100, fallbackKey: "keypair.name" })]);
      return { servers: servers.filter(server => ["ACTIVE", "SHUTOFF"].includes(server.status)).map(server => ({ value: server.id, label: `${server.name} · ${server.status}` })), keys: asArray(keys.keypairs).map(v => asRecord(asRecord(v).keypair)).map(key => ({ value: String(key.name), label: String(key.name) })) };
    }
    if (operation === "create") {
      const [vpcs, subnets, configurations] = await Promise.all([listVpcsForProject(s), listSubnetsForProject(s), configs(s)]);
      return { vpcs: vpcs.map(v => ({ value: v.id, label: v.name })), subnets: subnets.map(v => ({ value: v.id, label: `${v.name} · ${v.vpcId}` })), configurations: configurations.map(c => ({ value: c.id, label: c.name })) };
    }
    if (operation === "configuration") return { configurations: (await configs(s)).map(c => ({ value: c.id, label: c.name })) };
    if (!resource?.id.startsWith("group:")) return {};
    const id = resource.id.slice(6);
    if (operation.endsWith("-policy")) return { policies: (await listAsPoliciesForProject(s, id)).map(p => ({ value: p.id, label: `${p.name} · ${p.status}` })) };
    if (["protect", "unprotect", "standby", "resume-member", "remove-members"].includes(operation)) return { members: (await listAsInstancesForProject(s, id)).map(i => ({ value: i.id, label: `${i.name} · ${i.lifecycle} · ${i.protected ? "protected" : "unprotected"}` })) };
    return {};
  },
  invalidationKeys: r => [cloudCacheKeys.listAsGroups, cloudCacheKeys.listEcsInstances, ...(r?.id.startsWith("group:") ? [cloudCacheKeys.asGroup(r.id.slice(6))] : [])],
  execute: async (s, operation, v, resource) => {
    const root = base(s);
    const send = (path: string, method: string, body?: unknown) => huaweiFetch<Record<string, unknown>>(s, "as", `${root}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (operation === "create-configuration") {
      const result = await send("/scaling_configuration", "POST", { scaling_configuration_name: v.name, instance_config: { instance_id: v.server, key_name: v.key } });
      return { message: "Scaling configuration created.", resourceId: result.scaling_configuration_id ? `configuration:${result.scaling_configuration_id}` : undefined };
    }
    if (operation === "create") {
      const subnet = (await listSubnetsForProject(s)).find(item => item.id === v.subnet);
      if (!subnet || subnet.vpcId !== v.vpc) throw new ManagementInputError("Select a subnet in the selected VPC.");
      const result = await send("/scaling_group", "POST", { scaling_group_name: v.name, description: v.description ?? "", scaling_configuration_id: v.configuration, vpc_id: v.vpc, networks: [{ id: v.subnet }], ...counts(v), health_periodic_audit_method: "NOVA_AUDIT", delete_publicip: false, delete_volume: false });
      return { message: "Scaling group created. Enable the group when ready to start automatic capacity management.", resourceId: result.scaling_group_id ? `group:${result.scaling_group_id}` : undefined };
    }
    const id = resource!.id.slice(resource!.id.indexOf(":") + 1);
    const encoded = encodeURIComponent(id);
    if (operation === "rename-configuration") { await send(`/scaling_configuration/${encoded}`, "PUT", { scaling_configuration_name: v.name }); return { message: "Configuration renamed." }; }
    if (operation === "delete-configuration") {
      if ((await listAsGroupsForProject(s)).some(g => g.configurationId === id)) throw new ManagementInputError("Detach this configuration from every scaling group before deleting it.", 409);
      await send(`/scaling_configuration/${encoded}`, "DELETE"); return { message: "Configuration deleted." };
    }
    const group = (await listAsGroupsForProject(s)).find(g => g.id === id);
    if (!group) throw new ManagementInputError("The scaling group no longer exists.", 404);
    if (operation === "members") { const items = await listAsInstancesForProject(s, id); return { message: `${items.length} group instances loaded.`, facts: items.map(i => ({ label: `${i.name} · ${i.id}`, value: `${i.lifecycle} · ${i.health} · ${i.protected ? "protected" : "unprotected"}` })) }; }
    if (operation === "policies") { const items = await listAsPoliciesForProject(s, id); return { message: `${items.length} scaling policies loaded.`, facts: items.map(p => ({ label: `${p.name} · ${p.id}`, value: `${p.type} · ${p.status} · ${p.operation} ${p.instanceNumber ?? p.instancePercentage ?? ""} · ${p.schedule}` })) }; }
    if (operation === "activity") {
      const result = await huaweiList<Record<string, unknown>>(s, "as", `${root}/scaling_activity_log/${encoded}?limit=100`, { items: ["scaling_activity_log"], kind: "offset", parameter: "start_number", size: 100, total: ["total_number"] });
      const logs = asArray(result.scaling_activity_log).map(asRecord);
      return { message: `${logs.length} scaling activities loaded.`, facts: logs.map(log => ({ label: `${asString(log.start_time)} · ${asString(log.status)}`, value: asString(log.description, "") })) };
    }
    if (group.isScaling) throw new ManagementInputError("Wait for the current scaling activity to finish before changing the group.", 409);
    if (operation === "update") await send(`/scaling_group/${encoded}`, "PUT", { scaling_group_name: v.name, description: v.description ?? "", ...counts(v) });
    else if (operation === "configuration") await send(`/scaling_group/${encoded}`, "PUT", { scaling_configuration_id: v.configuration });
    else if (operation === "enable" || operation === "disable") await send(`/scaling_group/${encoded}/action`, "POST", { action: operation === "enable" ? "resume" : "pause" });
    else if (operation === "delete") {
      if (group.current !== 0 || (await listAsInstancesForProject(s, id)).length) throw new ManagementInputError("Detach all instances before deleting the group.", 409);
      await send(`/scaling_group/${encoded}?force_delete=no`, "DELETE");
    } else if (operation === "create-daily-policy") {
      const end = String(v.end); const date = new Date(end);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() || date.toISOString().slice(0, 16) + "Z" !== end) throw new ManagementInputError("Enter a valid future UTC expiry date.");
      const result = await send("/scaling_policy", "POST", { ...policyBody(v), scaling_group_id: id, scaling_policy_type: "RECURRENCE", scheduled_policy: { launch_time: v.time, recurrence_type: "Daily", end_time: end } });
      return { message: "Daily scaling policy created.", resourceId: asString(result.scaling_policy_id, "") || undefined };
    } else if (operation.endsWith("-policy")) {
      const p = (await listAsPoliciesForProject(s, id)).find(p => p.id === v.policy);
      if (!p) throw new ManagementInputError("The policy is no longer attached to this group.", 404);
      const path = `/scaling_policy/${encodeURIComponent(p.id)}`;
      if (operation === "rename-policy") await send(path, "PUT", { scaling_policy_name: v.name });
      else if (operation === "delete-policy") await send(path, "DELETE");
      else {
        if (operation === "execute-policy" && (group.status !== "INSERVICE" || p.status !== "INSERVICE")) throw new ManagementInputError("Enable both the group and policy before executing it.", 409);
        await send(`${path}/action`, "POST", { action: operation === "enable-policy" ? "resume" : operation === "disable-policy" ? "pause" : "execute" });
      }
    } else if (["protect", "unprotect", "standby", "resume-member", "remove-members"].includes(operation)) {
      const current = await listAsInstancesForProject(s, id);
      const selected = v.members as string[];
      const list = selected.map(member => current.find(i => i.id === member));
      if (list.some(member => !member)) throw new ManagementInputError("An instance is no longer a member of this group.", 404);
      if (operation === "remove-members") {
        if (group.current - selected.length < group.minimum) throw new ManagementInputError("Detaching these instances would fall below the group's minimum capacity.");
        if (list.some(member => member!.protected || member!.lifecycle !== "INSERVICE")) throw new ManagementInputError("Remove protection and return selected instances to service before detaching them.", 409);
      }
      if (operation === "standby" && list.some(member => member!.lifecycle !== "INSERVICE")) throw new ManagementInputError("Only in-service instances can enter standby.", 409);
      if (operation === "resume-member" && list.some(member => member!.lifecycle !== "STANDBY")) throw new ManagementInputError("Only standby instances can return to service.", 409);
      const action = ({ protect: "PROTECT", unprotect: "UNPROTECT", standby: "ENTER_STANDBY", "resume-member": "EXIT_STANDBY", "remove-members": "REMOVE" } as Record<string, string>)[operation];
      await send(`/scaling_group_instance/${encoded}/action`, "POST", { action, instances_id: selected, ...(operation === "remove-members" ? { instance_delete: "no" } : {}), ...(operation === "standby" ? { instance_replace: "no" } : {}) });
    } else throw new ManagementInputError("Unsupported scaling operation.");
    return { message: "Auto Scaling operation accepted. Check group state and native scaling activity for completion.", asynchronous: ["update", "enable", "disable", "execute-policy", "standby", "resume-member", "remove-members", "delete"].includes(operation) };
  },
};
