import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { getMessagingInstance, listMessagingInstancesForProject, type MessagingEngine } from "@/lib/huawei/messaging";
import { listSubnetsForProject, listSecurityGroupsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const name: ManagementField = { key: "name", label: "Instance name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$" };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 1024 };
const password: ManagementField = { key: "password", label: "Password", type: "password", required: true, min: 8, max: 32, help: "Include at least three of uppercase letters, lowercase letters, numbers, and punctuation." };
const childName: ManagementField = { key: "childName", label: "Name", required: true, min: 1, max: 255, pattern: "^[A-Za-z0-9_.%/-]+$" };
const vhost: ManagementField = { key: "vhost", label: "Virtual host", type: "select", source: "vhosts", required: true };
const brokerFields: ManagementField[] = [{ key: "brokers", label: "Brokers", type: "list", source: "brokers", required: true, max: 100 }];
const running = ["RUNNING"];
const baseOperations: ManagementOperation[] = [
  { id: "create", label: "Create instance", kind: "create", description: "Provision a pay-per-use messaging instance with flavors and network resources from this project.", impact: "Instance compute and storage are billed while the resource exists. Confirm the selected region, flavor, and capacity before submitting.", fields: [name, description,
    { key: "offering", label: "Engine, flavor, and storage type", type: "select", source: "offerings", required: true, max: 512 },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    { key: "zones", label: "Availability zones", type: "list", source: "zones", required: true, max: 7, help: "Choose one or at least three available zones." },
    { key: "brokers", label: "Broker count", type: "number", required: true, min: 1, max: 100, defaultValue: 3 },
    { key: "storage", label: "Total storage (GB)", type: "number", required: true, min: 100, max: 3000000, defaultValue: 300, help: "Total capacity across all brokers, in multiples of 100 GB." },
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
    { key: "ssl", label: "TLS encryption", type: "boolean", defaultValue: true },
  ] },
  { id: "update", label: "Edit instance", kind: "update", description: "Change instance name and description without replacing the instance.", fields: [name, description], allowedStatuses: running },
  { id: "delete", label: "Delete instance", kind: "delete", description: "Permanently remove the instance.", fields: [], confirmation: true, impact: "The instance and its message data are permanently deleted. Connected clients stop working." },
  { id: "restart", label: "Restart instance", kind: "action", description: "Restart the messaging service.", fields: [], allowedStatuses: running, confirmation: true, impact: "Clients can disconnect while the brokers restart." },
  { id: "expand-storage", label: "Expand storage", kind: "action", description: "Increase total instance storage without changing the broker count.", allowedStatuses: running, impact: "The expanded capacity is billed and cannot be reduced through this operation.", fields: [{ key: "storage", label: "New total storage (GB)", type: "number", required: true, min: 100, max: 3000000 }] },
  { id: "tasks", label: "View cloud tasks", kind: "inspect", description: "Show background operation status from Huawei Cloud.", fields: [] },
  { id: "users", label: "View access users", kind: "inspect", description: "List access user names. Secret keys are excluded from the result.", fields: [] },
  { id: "delete-user", label: "Delete access user", kind: "action", description: "Remove one client's messaging credentials.", fields: [{ key: "user", label: "Access user", type: "select", source: "users", required: true }], confirmation: true, impact: "Applications using these credentials lose access." },
];

async function rows(session: BetterUiSession, engine: MessagingEngine, path: string, keys: string[], parameter = "offset") {
  const query = new URLSearchParams({ [parameter]: "0", limit: "100" });
  const body = await huaweiList<Record<string, unknown>>(session, engine, `${path}?${query}`, { items: keys, kind: "offset", parameter, size: 100, total: ["total", "count"] });
  const items = keys.map((key) => body[key]).find(Array.isArray);
  return asArray(items).map(asRecord);
}
function instancePath(session: BetterUiSession, resource?: ManagementResource) { return `/v2/${session.projectId}/instances/${encodeURIComponent(resource!.id)}`; }
function amqpPath(session: BetterUiSession, resource?: ManagementResource) { return `/v2/rabbitmq/${session.projectId}/instances/${encodeURIComponent(resource!.id)}/vhosts`; }
function choice(value: string, label = value) { return { value, label }; }
function safeName(item: Record<string, unknown>) { return firstString([item.name, item.access_key, item.group_name, item.group], ""); }
async function vhosts(session: BetterUiSession, resource: ManagementResource) { return rows(session, "rabbitmq", amqpPath(session, resource), ["items"]); }
async function brokers(session: BetterUiSession, resource: ManagementResource) {
  const body = await rows(session, "rocketmq", `${instancePath(session, resource)}/brokers`, ["brokers"]);
  return body.map((item) => firstString([item.broker_name], "")).filter(Boolean);
}
function assertPassword(value: string) {
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3 || value.startsWith("-")) throw new ManagementInputError("Password must include at least three character groups and cannot start with a hyphen.");
}
async function offerings(session: BetterUiSession, engine: MessagingEngine) {
  const body = await huaweiFetch<Record<string, unknown>>(session, engine, `/v2/${engine}/products`);
  if (!Array.isArray(body.products) || !Array.isArray(body.versions)) throw new Error("The messaging product catalog response is incomplete.");
  return body.products.flatMap((raw) => {
    const product = asRecord(raw);
    if (!asArray(product.charging_mode).includes("hourly")) return [];
    const specific = firstString([asRecord(product.properties).engine_versions], "");
    const versions = specific ? specific.split(",").map((version) => version.trim()) : body.versions as string[];
    return versions.flatMap((version) => asArray(product.ios).map((rawIo) => {
      const io = asRecord(rawIo);
      const value = JSON.stringify([String(product.product_id), version, String(io.io_spec)]);
      return { value, label: `${product.product_id} · ${version} · ${io.io_spec}`, product, io, version };
    }));
  });
}

const rabbitOperations: ManagementOperation[] = [
  { id: "reset-password", label: "Reset instance password", kind: "action", description: "Replace the instance access password.", allowedStatuses: running, confirmation: true, impact: "Update application credentials after this change.", fields: [password] },
  { id: "vhosts", label: "View virtual hosts", kind: "inspect", description: "List all virtual hosts in the instance.", fields: [] },
  { id: "create-vhost", label: "Create virtual host", kind: "action", description: "Create an isolated messaging namespace.", allowedStatuses: running, fields: [childName] },
  { id: "delete-vhost", label: "Delete virtual host", kind: "action", description: "Remove a virtual host and its messaging resources.", allowedStatuses: running, fields: [vhost], confirmation: true, impact: "Queues, exchanges, bindings, and messages in this virtual host are removed." },
  { id: "queues", label: "View queues", kind: "inspect", description: "Inspect queue message counts and consumers.", fields: [vhost] },
  { id: "create-queue", label: "Create queue", kind: "action", description: "Create a queue in an existing virtual host.", allowedStatuses: running, fields: [vhost, childName, { key: "durable", label: "Durable queue", type: "boolean", defaultValue: true }, { key: "autoDelete", label: "Delete when unused", type: "boolean", defaultValue: false }, { key: "ttl", label: "Message time to live (ms)", type: "number", min: 0, max: 2147483647 }] },
  { id: "delete-queue", label: "Delete queue", kind: "action", description: "Delete a named queue from the selected virtual host.", allowedStatuses: running, fields: [vhost, childName], confirmation: true, impact: "The queue and its messages are permanently removed." },
  { id: "purge-queue", label: "Purge queue", kind: "action", description: "Delete all messages from a queue while retaining the queue.", allowedStatuses: running, fields: [vhost, childName], confirmation: true, impact: "Messages in the queue are permanently removed." },
  { id: "exchanges", label: "View exchanges", kind: "inspect", description: "Inspect exchanges in the virtual host.", fields: [vhost] },
  { id: "create-exchange", label: "Create exchange", kind: "action", description: "Create a routing exchange.", allowedStatuses: running, fields: [vhost, childName, { key: "type", label: "Exchange type", type: "select", required: true, defaultValue: "direct", choices: ["direct", "fanout", "topic", "headers"].map((value) => choice(value)) }, { key: "durable", label: "Durable exchange", type: "boolean", defaultValue: true }, { key: "autoDelete", label: "Delete when unused", type: "boolean", defaultValue: false }, { key: "internal", label: "Internal exchange", type: "boolean", defaultValue: false }] },
  { id: "delete-exchange", label: "Delete exchange", kind: "action", description: "Remove an exchange and its bindings.", allowedStatuses: running, fields: [vhost, childName], confirmation: true, impact: "Messages can no longer be routed through this exchange." },
  { id: "create-user", label: "Create access user", kind: "action", description: "Create AMQP credentials scoped to one virtual host and explicit resource patterns.", allowedStatuses: running, fields: [{ ...childName, key: "user", label: "Access key", max: 64 }, { ...password, key: "secret", label: "Secret key", max: 128 }, vhost, { key: "configure", label: "Configure permission pattern", required: true, max: 512, defaultValue: "^$" }, { key: "write", label: "Write permission pattern", required: true, max: 512, defaultValue: "^$" }, { key: "read", label: "Read permission pattern", required: true, max: 512, defaultValue: "^$" }] },
];
const rocketOperations: ManagementOperation[] = [
  { id: "topics", label: "View topics", kind: "inspect", description: "Inspect topic configuration across brokers.", fields: [] },
  { id: "create-topic", label: "Create topic", kind: "action", description: "Create a topic on the selected brokers.", allowedStatuses: running, fields: [childName, ...brokerFields, { key: "queues", label: "Queues per broker", type: "number", required: true, min: 1, max: 128, defaultValue: 8 }, { key: "permission", label: "Permission", type: "select", required: true, defaultValue: "all", choices: ["all", "pub", "sub"].map((value) => choice(value)) }, { key: "messageType", label: "Message type (RocketMQ 5.x)", type: "select", choices: ["NORMAL", "FIFO", "DELAY", "TRANSACTION"].map((value) => choice(value)) }] },
  { id: "delete-topic", label: "Delete topic", kind: "action", description: "Delete a topic from the selected instance.", allowedStatuses: running, fields: [{ key: "topic", label: "Topic", type: "select", source: "topics", required: true }], confirmation: true, impact: "The topic and its retained messages are permanently removed." },
  { id: "groups", label: "View consumer groups", kind: "inspect", description: "Inspect consumer group configuration.", fields: [] },
  { id: "create-group", label: "Create consumer group", kind: "action", description: "Create a consumer group on selected brokers.", allowedStatuses: running, fields: [childName, ...brokerFields, { key: "retries", label: "Maximum retries", type: "number", required: true, min: 0, max: 16, defaultValue: 16 }, { key: "enabled", label: "Consumer group", type: "boolean", defaultValue: true }, { key: "broadcast", label: "Broadcast consumption", type: "boolean", defaultValue: false }, { key: "orderly", label: "Ordered consumption", type: "boolean", defaultValue: false }, { ...description, key: "description", label: "Group description" }] },
  { id: "delete-group", label: "Delete consumer group", kind: "action", description: "Remove a consumer group.", allowedStatuses: running, fields: [{ key: "group", label: "Consumer group", type: "select", source: "groups", required: true }], confirmation: true, impact: "Consumers using this group stop working, and its consumption state is removed." },
  { id: "create-user", label: "Create access user", kind: "action", description: "Create client credentials with explicit default permissions.", allowedStatuses: running, fields: [{ ...childName, key: "user", label: "Access key", max: 64 }, { ...password, key: "secret", label: "Secret key", max: 128 }, { key: "topicPermission", label: "Default topic permission", type: "select", required: true, defaultValue: "DENY", choices: ["DENY", "PUB", "SUB", "PUB|SUB"].map((value) => choice(value)) }, { key: "groupPermission", label: "Default group permission", type: "select", required: true, defaultValue: "DENY", choices: ["DENY", "SUB"].map((value) => choice(value)) }, { key: "whiteAddresses", label: "Allowed client IP addresses", max: 1024, help: "Comma-separated addresses accepted by RocketMQ ACL." }] },
];

export function messagingManagement(engine: MessagingEngine): ManagementAdapter {
  const operations = baseOperations.map((operation) => operation.id === "create" && engine === "rabbitmq" ? { ...operation, fields: [...operation.fields, { key: "accessUser", label: "Initial access user", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$" }, password] } : operation);
  return {
    title: engine === "rabbitmq" ? "DMS RabbitMQ" : "DMS RocketMQ",
    operations: [...operations, ...(engine === "rabbitmq" ? rabbitOperations : rocketOperations)],
    inventory: async (session) => (await listMessagingInstancesForProject(session, engine)).map((item) => ({ id: item.id, name: item.name, status: item.status, values: { name: item.name, description: item.description === "-" ? "" : item.description, storage: item.storageGb ?? 0, projectId: item.projectId } })),
    options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
      if (operation === "create") {
        const [products, zones, subnets, groups] = await Promise.all([offerings(session, engine), huaweiFetch<Record<string, unknown>>(session, engine, "/v2/available-zones"), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
        return { offerings: products.map(({ value, label }) => ({ value, label })), zones: asArray(zones.available_zones).map(asRecord).filter((zone) => zone.sold_out !== true && zone.resource_availability !== "false").map((zone) => choice(String(zone.id), firstString([zone.name, zone.code, zone.id]))), subnets: subnets.map((subnet) => choice(subnet.id, `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}`)), securityGroups: groups.map((group) => choice(group.id, group.name)) };
      }
      if (!resource) return {};
      if (operation === "delete-user") return { users: (await rows(session, engine, `${instancePath(session, resource)}/users`, ["users"])).map((item) => choice(safeName(item))).filter((item) => !!item.value) };
      if (engine === "rabbitmq" && ["delete-vhost", "queues", "create-queue", "delete-queue", "purge-queue", "exchanges", "create-exchange", "delete-exchange", "create-user"].includes(operation)) return { vhosts: (await vhosts(session, resource)).map((item) => choice(safeName(item))).filter((item) => !!item.value) };
      if (engine === "rocketmq") {
        if (["create-topic", "create-group"].includes(operation)) return { brokers: (await brokers(session, resource)).map((name) => choice(name)) };
        if (operation === "delete-topic") return { topics: (await rows(session, engine, `${instancePath(session, resource)}/topics`, ["topics"])).map((item) => choice(safeName(item))).filter((item) => !!item.value) };
        if (operation === "delete-group") return { groups: (await rows(session, engine, `${instancePath(session, resource)}/groups`, ["groups"])).map((item) => choice(safeName(item))).filter((item) => !!item.value) };
      }
      return {};
    },
    invalidationKeys: (resource) => [engine === "rabbitmq" ? cloudCacheKeys.listDmsRabbitMqInstances : cloudCacheKeys.listDmsRocketMqInstances, cloudCacheKeys.summary, ...(resource ? [cloudCacheKeys.messagingInstance(engine, resource.id), cloudCacheKeys.messagingInstance(engine, resource.id, String(resource.values?.projectId ?? ""))] : [])],
    execute: async (session, operation, values, resource) => {
      const path = resource ? instancePath(session, resource) : `/v2/${engine}/${session.projectId}/instances`;
      let method = "POST";
      let url = path;
      let input: Record<string, unknown> | undefined;
      if (operation === "create") {
        const product = (await offerings(session, engine)).find((item) => item.value === values.offering);
        const subnet = (await listSubnetsForProject(session)).find((item) => item.id === values.subnet);
        if (!product || !subnet) throw new ManagementInputError("The selected flavor or subnet is no longer available.");
        const zones = values.zones as string[];
        if (zones.length === 2 || zones.length > Number(values.brokers)) throw new ManagementInputError("Choose one or at least three zones, with no more zones than brokers.");
        if (asArray(product.io.available_zones).length && zones.some((zone) => !asArray(product.io.available_zones).includes(zone))) throw new ManagementInputError("The selected storage flavor is unavailable in one of these zones.");
        const count = Number(values.brokers);
        if ((String(product.product.type).includes("single") && count !== 1) || (engine === "rabbitmq" && String(product.product.type).includes("cluster") && ![3, 5, 7].includes(count))) throw new ManagementInputError("The broker count does not match the selected flavor.");
        if (Number(values.storage) % 100 || Number(values.storage) < count * 100 || Number(values.storage) > count * 30000) throw new ManagementInputError("Storage must be a multiple of 100 GB with 100–30,000 GB per broker.");
        if (engine === "rabbitmq") assertPassword(String(values.password));
        input = { name: values.name, description: values.description ?? "", engine, engine_version: product.version, product_id: product.product.product_id, storage_spec_code: product.io.io_spec, storage_space: values.storage, broker_num: count, available_zones: zones, vpc_id: subnet.vpcId, subnet_id: subnet.neutronNetworkId || subnet.id, security_group_id: values.securityGroup, enterprise_project_id: values.enterpriseProjectId ?? "0", ssl_enable: values.ssl ?? true, enable_publicip: false, ...(engine === "rabbitmq" ? { access_user: values.accessUser, password: values.password } : {}) };
      } else if (operation === "update") { method = "PUT"; input = { name: values.name, description: values.description ?? "" }; }
      else if (operation === "delete") method = "DELETE";
      else if (operation === "restart") {
        if (engine === "rabbitmq") { url = `/v2/${session.projectId}/instances/action`; input = { action: "restart", instances: [resource!.id] }; }
        else url = `/v2/${session.projectId}/rocketmq/instances/${encodeURIComponent(resource!.id)}/restart`;
      } else if (operation === "expand-storage") {
        const detail = await getMessagingInstance(session, engine, resource!.id, session.projectId);
        if (Number(values.storage) % 100 || Number(values.storage) <= (detail.storageGb ?? 0)) throw new ManagementInputError("The new total capacity must exceed current storage and be a multiple of 100 GB.");
        url = `/v2/${engine}/${session.projectId}/instances/${encodeURIComponent(resource!.id)}/extend`; input = { oper_type: "storage", new_storage_space: values.storage };
      } else if (["tasks", "users", "topics", "groups", "vhosts", "queues", "exchanges"].includes(operation)) {
        let data: Record<string, unknown>[];
        if (operation === "vhosts") data = await vhosts(session, resource!);
        else if (["queues", "exchanges"].includes(operation)) data = await rows(session, engine, `${amqpPath(session, resource)}/${encodeURIComponent(String(values.vhost))}/${operation}`, ["items"]);
        else data = await rows(session, engine, `${path}/${operation}`, operation === "tasks" ? ["tasks"] : [operation], operation === "tasks" ? "start" : "offset");
        return { message: `${data.length} ${operation} loaded.`, facts: data.map((item) => ({ label: firstString([item.name, item.access_key, item.task_name, item.id], "Item"), value: operation === "users" ? "Access credentials are hidden" : [item.status, item.state, item.messages !== undefined ? `${item.messages} messages` : undefined, item.consumers !== undefined ? `${item.consumers} consumers` : undefined].filter((value) => value !== undefined).join(" · ") || firstString([item.id], "Configured") })) };
      } else if (operation === "delete-user") { method = "DELETE"; url = `${path}/users/${encodeURIComponent(String(values.user))}`; }
      else if (operation === "reset-password") { assertPassword(String(values.password)); url = `${path}/password`; input = { new_password: values.password }; }
      else if (operation === "create-user") { url = `${path}/users`; input = { access_key: values.user, secret_key: values.secret, ...(engine === "rabbitmq" ? { vhosts: [{ vhost: values.vhost, conf: values.configure, write: values.write, read: values.read }] } : { admin: false, default_topic_perm: values.topicPermission, default_group_perm: values.groupPermission, ...(values.whiteAddresses ? { white_remote_address: values.whiteAddresses } : {}) }) }; }
      else if (operation === "create-vhost") { method = "PUT"; url = amqpPath(session, resource); input = { name: values.childName }; }
      else if (operation === "delete-vhost") { url = amqpPath(session, resource); input = { name: [values.vhost] }; }
      else if (["create-queue", "delete-queue", "purge-queue", "create-exchange", "delete-exchange"].includes(operation)) {
        const family = operation.includes("queue") ? "queues" : "exchanges";
        url = `${amqpPath(session, resource)}/${encodeURIComponent(String(values.vhost))}/${family}`;
        if (operation.startsWith("create")) {
          method = "PUT"; input = { name: values.childName, durable: values.durable ?? true, auto_delete: values.autoDelete ?? false, ...(family === "queues" ? (values.ttl !== undefined ? { message_ttl: values.ttl } : {}) : { type: values.type, internal: values.internal ?? false }) };
        } else {
          const children = await rows(session, engine, url, ["items"]);
          if (!children.some((item) => safeName(item) === values.childName)) throw new ManagementInputError(`The selected ${family === "queues" ? "queue" : "exchange"} is not in this virtual host.`, 404);
          if (operation === "purge-queue") { method = "DELETE"; url += `/${encodeURIComponent(String(values.childName))}/contents`; }
          else input = { name: [values.childName] };
        }
      } else if (operation === "create-topic") { url = `${path}/topics`; const detail = await getMessagingInstance(session, engine, resource!.id, session.projectId); input = { name: values.childName, brokers: values.brokers, queue_num: values.queues, permission: values.permission, ...(detail.engineVersion.startsWith("5") ? { message_type: values.messageType ?? "NORMAL" } : {}) }; }
      else if (operation === "delete-topic") { method = "DELETE"; url = `${path}/topics/${encodeURIComponent(String(values.topic))}`; }
      else if (operation === "create-group") { url = `${path}/groups`; input = { name: values.childName, brokers: values.brokers, retry_max_time: values.retries, enabled: values.enabled ?? true, broadcast: values.broadcast ?? false, consume_orderly: values.orderly ?? false, group_desc: values.description ?? "" }; }
      else if (operation === "delete-group") { method = "DELETE"; url = `${path}/groups/${encodeURIComponent(String(values.group))}`; }
      else throw new ManagementInputError("Unsupported messaging operation.");
      const response = await huaweiFetch<Record<string, unknown>>(session, engine, url, { method, ...(input ? { body: JSON.stringify(input) } : {}) });
      const results = asArray(response.results).map(asRecord);
      const rejected = results.filter((result) => result.result === "failed" || result.success === false || (result.error_code && result.error_code !== "0"));
      if (rejected.length) throw new Error("Huawei rejected the messaging operation. Check the instance state and native task details before retrying.");
      return { message: `${operations.concat(engine === "rabbitmq" ? rabbitOperations : rocketOperations).find((item) => item.id === operation)?.label ?? "Messaging operation"} ${["create", "delete", "restart", "expand-storage"].includes(operation) ? "submitted" : "completed"}.`, resourceId: firstString([response.instance_id, response.id, resource?.id], "") || undefined, jobId: firstString([response.job_id, response.task_id], "") || undefined, asynchronous: ["create", "delete", "restart", "expand-storage"].includes(operation) };
    },
  };
}
