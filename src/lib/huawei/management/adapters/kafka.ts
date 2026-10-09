import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementField, type ManagementOperation, type ManagementResource } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listDmsKafkaInstancesForProject } from "@/lib/huawei/services/dms-kafka";
import { listSubnetsForProject, listSecurityGroupsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const name: ManagementField = { key: "name", label: "Instance name", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$" };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", allowEmpty: true, max: 1024 };
const password: ManagementField = { key: "password", label: "Password", type: "password", min: 8, max: 32, help: "Use 8-32 characters with at least three of uppercase letters, lowercase letters, numbers, and punctuation." };
const topicName: ManagementField = { key: "topicName", label: "Topic name", required: true, min: 3, max: 200, pattern: "^[A-Za-z][A-Za-z0-9._-]{2,199}$" };
const user: ManagementField = { key: "user", label: "Access user", type: "select", source: "users", required: true };
const running = ["RUNNING"];
const operations: ManagementOperation[] = [
  { id: "create", label: "Create instance", kind: "create", description: "Provision a pay-per-use Kafka instance with live product choices and this project's network.", impact: "Instance brokers and storage are billed while the resource exists. Confirm the region, product, and capacity before submitting. Disabling SASL lets clients allowed by the security group connect without authenticating.", fields: [name, description,
    { key: "offering", label: "Product, version, and storage type", type: "select", source: "offerings", required: true, max: 512 },
    { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC." },
    { key: "securityGroup", label: "Security group", type: "select", source: "securityGroups", required: true },
    { key: "zones", label: "Availability zones", type: "list", source: "zones", required: true, max: 7, help: "Choose one or at least three available zones." },
    { key: "brokers", label: "Broker count", type: "number", required: true, min: 1, max: 100, defaultValue: 3 },
    { key: "storage", label: "Total storage (GB)", type: "number", required: true, min: 100, max: 3000000, defaultValue: 300, help: "Total capacity across all brokers, in multiples of 100 GB." },
    { key: "ssl", label: "SASL authentication", type: "boolean", defaultValue: true },
    { key: "accessUser", label: "SASL username", min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$", help: "Required when SASL authentication is enabled." },
    password,
    { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
  ] },
  { id: "update", label: "Edit instance", kind: "update", description: "Change the instance name and description.", fields: [name, description], allowedStatuses: running },
  { id: "restart", label: "Restart instance", kind: "action", description: "Restart the Kafka brokers.", fields: [], allowedStatuses: running, confirmation: true, impact: "Clients can disconnect while the brokers restart." },
  { id: "delete", label: "Delete instance", kind: "delete", description: "Permanently remove the instance.", fields: [], confirmation: true, impact: "The instance and its retained messages are permanently deleted." },
  { id: "expand-storage", label: "Expand storage", kind: "action", description: "Increase total instance storage without changing the broker count.", allowedStatuses: running, impact: "The expanded capacity is billed and cannot be reduced through this operation.", fields: [{ key: "storage", label: "New total storage (GB)", type: "number", required: true, min: 100, max: 3000000 }] },
  { id: "topics", label: "View topics", kind: "inspect", description: "Inspect topic partitions, replicas, and retention.", fields: [] },
  { id: "create-topic", label: "Create topic", kind: "action", description: "Create a topic on the instance.", allowedStatuses: running, fields: [topicName,
    { key: "partitions", label: "Partitions", type: "number", required: true, min: 1, max: 200, defaultValue: 3 },
    { key: "replication", label: "Replicas", type: "number", required: true, min: 1, max: 100, defaultValue: 3 },
    { key: "retention", label: "Retention (hours)", type: "number", required: true, min: 1, max: 720, defaultValue: 72 },
    { key: "syncReplication", label: "Synchronous replication", type: "boolean", defaultValue: false },
    { key: "syncFlush", label: "Synchronous flush", type: "boolean", defaultValue: false },
    { key: "topicDescription", label: "Description", max: 200 },
  ] },
  { id: "delete-topic", label: "Delete topic", kind: "action", description: "Delete a topic and its retained messages.", allowedStatuses: running, fields: [{ key: "topic", label: "Topic", type: "select", source: "topics", required: true }], confirmation: true, impact: "The topic and its retained messages are permanently removed." },
  { id: "users", label: "View access users", kind: "inspect", description: "List SASL access users. Credentials are excluded from the result.", fields: [] },
  { id: "create-user", label: "Create access user", kind: "action", description: "Create SASL credentials for clients.", allowedStatuses: running, fields: [
    { key: "userName", label: "Username", required: true, min: 4, max: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]{3,63}$" },
    { key: "userDescription", label: "Description", max: 200 },
    { key: "userPassword", label: "Password", type: "password", required: true, min: 8, max: 32, help: "Use 8-32 characters with at least three character groups; the password cannot match the username." },
  ] },
  { id: "delete-user", label: "Delete access user", kind: "action", description: "Remove one client's SASL credentials.", allowedStatuses: running, fields: [user], confirmation: true, impact: "Applications using these credentials lose access." },
  { id: "reset-user-password", label: "Reset user password", kind: "action", description: "Replace one access user's password.", allowedStatuses: running, fields: [user, { ...password, required: true }], confirmation: true, impact: "Update application credentials after this change." },
];

type Offering = { value: string; label: string; product: Record<string, unknown>; io: Record<string, unknown>; version: string; minBroker?: number; maxBroker?: number; minStorage?: number; maxStorage?: number };
function instancePath(session: BetterUiSession, resource?: ManagementResource) { return `/v2/${session.projectId}/instances/${encodeURIComponent(resource!.id)}`; }
function choice(value: string, label = value) { return { value, label }; }
function optionalNumber(value: unknown) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; }

async function products(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dms", "/v2/kafka/products");
  if (!Array.isArray(body.products)) throw new Error("The Kafka product catalog response is incomplete.");
  return asArray(body.products).map(asRecord);
}
function catalog(records: Record<string, unknown>[]): Offering[] {
  return records.flatMap((product) => {
    if (!asArray(product.charging_mode).some((mode) => String(mode).toLowerCase() === "hourly")) return [];
    const properties = asRecord(product.properties);
    const versions = firstString([properties.engine_versions], "").split(",").map((version) => version.trim()).filter(Boolean);
    return versions.flatMap((version) => asArray(product.ios).map((rawIo) => {
      const io = asRecord(rawIo);
      return {
        value: JSON.stringify([String(product.product_id), version, String(io.io_spec)]),
        label: `${product.product_id} · Kafka ${version} · ${io.io_spec}`,
        product, io, version,
        minBroker: optionalNumber(properties.min_broker), maxBroker: optionalNumber(properties.max_broker),
        minStorage: optionalNumber(properties.min_storage_per_node), maxStorage: optionalNumber(properties.max_storage_per_node),
      };
    }));
  });
}
async function zones(session: BetterUiSession) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dms", "/v2/available-zones");
  return asArray(body.available_zones).map(asRecord).filter((zone) => zone.sold_out !== true && String(zone.resource_availability) !== "false").map((zone) => choice(String(zone.id), firstString([zone.name, zone.code, zone.id])));
}
async function detail(session: BetterUiSession, id: string) {
  const body = await huaweiFetch<unknown>(session, "dms", `/v2/${session.projectId}/instances/${encodeURIComponent(id)}`);
  return asRecord(asRecord(body).instance ?? body);
}
async function topics(session: BetterUiSession, resource: ManagementResource) {
  const body = await huaweiList<Record<string, unknown>>(session, "dms", `${instancePath(session, resource)}/topics?limit=100&offset=0`, { items: ["topics"], kind: "offset", parameter: "offset", size: 100, total: ["total"] });
  return { rows: asArray(body.topics).map(asRecord), remainPartitions: typeof body.remain_partitions === "number" && Number.isSafeInteger(body.remain_partitions) && body.remain_partitions >= 0 ? body.remain_partitions : undefined };
}
async function users(session: BetterUiSession, resource: ManagementResource) {
  const body = await huaweiFetch<Record<string, unknown>>(session, "dms", `${instancePath(session, resource)}/users`);
  return asArray(body.users).map(asRecord);
}
function assertPassword(value: string, username: string) {
  const groups = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((expression) => expression.test(value)).length;
  if (groups < 3 || value.startsWith("-") || value === username) throw new ManagementInputError("Password must include at least three character groups, cannot start with a hyphen, and cannot match the username.");
}
function assertResults(response: Record<string, unknown>, id: string) {
  const results = asArray(response.results).map(asRecord);
  const own = results.find((result) => firstString([result.instance], "") === id);
  if (!own || own.result !== "success") throw new Error("Huawei rejected the DMS Kafka operation. Check the instance state and native task details before retrying.");
}

export const kafkaManagement: ManagementAdapter = {
  title: "DMS Kafka",
  operations,
  inventory: async (session) => (await listDmsKafkaInstancesForProject(session)).map((item) => ({ id: item.id, name: item.name, status: item.status, values: { name: item.name, description: item.description === "-" ? "" : item.description, storage: item.storage, brokers: item.brokerCount, chargingMode: item.chargingMode, projectId: item.projectId } })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [records, zoneList, subnets, groups] = await Promise.all([products(session), zones(session), listSubnetsForProject(session), listSecurityGroupsForProject(session)]);
      return { offerings: catalog(records).map(({ value, label }) => ({ value, label })), zones: zoneList, subnets: subnets.map((subnet) => choice(subnet.id, `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}`)), securityGroups: groups.map((group) => choice(group.id, group.name)) };
    }
    if (!resource) return {};
    if (operation === "delete-topic") return { topics: (await topics(session, resource)).rows.map((item) => choice(firstString([item.name], ""))).filter((item) => !!item.value) };
    if (["delete-user", "reset-user-password"].includes(operation)) return { users: (await users(session, resource)).map((item) => choice(firstString([item.user_name], ""))).filter((item) => !!item.value) };
    return {};
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listDmsKafkaInstances, cloudCacheKeys.summary, ...(resource ? [`dms-kafka-instance:${resource.id}`] : [])],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      const offering = catalog(await products(session)).find((item) => item.value === values.offering);
      const subnet = (await listSubnetsForProject(session)).find((item) => item.id === values.subnet);
      if (!offering || !subnet) throw new ManagementInputError("The selected product or subnet is no longer available.");
      const zoneIds = values.zones as string[];
      const zoneChoices = await zones(session);
      if (zoneIds.some((zone) => !zoneChoices.some((choice) => choice.value === zone))) throw new ManagementInputError("One of the selected availability zones is no longer available.");
      if (zoneIds.length === 2 || zoneIds.length > Number(values.brokers)) throw new ManagementInputError("Choose one or at least three zones, with no more zones than brokers.");
      if (asArray(offering.io.available_zones).length && zoneIds.some((zone) => !asArray(offering.io.available_zones).includes(zone))) throw new ManagementInputError("The selected storage flavor is unavailable in one of these zones.");
      const brokers = Number(values.brokers);
      if ((offering.minBroker !== undefined && brokers < offering.minBroker) || (offering.maxBroker !== undefined && brokers > offering.maxBroker)) throw new ManagementInputError(`The broker count must be between ${offering.minBroker ?? 1} and ${offering.maxBroker ?? 100} for this product.`);
      const storage = Number(values.storage);
      const perBroker = storage / brokers;
      if (storage % 100 || perBroker < (offering.minStorage ?? 100) || perBroker > (offering.maxStorage ?? 30000)) throw new ManagementInputError(`Storage must be a multiple of 100 GB with ${offering.minStorage ?? 100}-${offering.maxStorage ?? 30000} GB per broker.`);
      const ssl = values.ssl !== false;
      const accessUser = String(values.accessUser ?? "");
      const secret = String(values.password ?? "");
      if (ssl && (!accessUser || !secret)) throw new ManagementInputError("SASL username and password are required when SASL authentication is enabled.");
      if (secret) assertPassword(secret, accessUser);
      const archType = firstString([asArray(offering.product.arch_types).map(String)[0]], "");
      const response = await huaweiFetch<Record<string, unknown>>(session, "dms", `/v2/${session.projectId}/kafka/instances`, { method: "POST", body: JSON.stringify({
        name: values.name, description: values.description ?? "", engine: "kafka", engine_version: offering.version,
        broker_num: brokers, storage_space: storage, vpc_id: subnet.vpcId, subnet_id: subnet.neutronNetworkId || subnet.id,
        security_group_id: values.securityGroup, available_zones: zoneIds, product_id: String(offering.product.product_id),
        storage_spec_code: String(offering.io.io_spec), enable_publicip: false, ssl_enable: ssl,
        ...(ssl ? { access_user: accessUser, password: secret, kafka_security_protocol: "SASL_SSL", sasl_enabled_mechanisms: ["PLAIN"] } : {}),
        ...(archType ? { arch_type: archType } : {}),
        enterprise_project_id: values.enterpriseProjectId ?? "0", bss_param: { charging_mode: "postPaid" },
      }) });
      return { message: "Instance creation submitted.", resourceId: firstString([response.instance_id], "") || undefined, asynchronous: true };
    }
    const path = instancePath(session, resource);
    if (operation === "update") {
      await huaweiFetch(session, "dms", path, { method: "PUT", body: JSON.stringify({ name: values.name, description: values.description ?? "" }) });
      return { message: "Instance details updated.", resourceId: resource!.id };
    }
    if (operation === "restart") {
      const response = await huaweiFetch<Record<string, unknown>>(session, "dms", `/v2/${session.projectId}/instances/action`, { method: "POST", body: JSON.stringify({ action: "restart", instances: [resource!.id] }) });
      assertResults(response, resource!.id);
      return { message: "Instance restart submitted.", resourceId: resource!.id, asynchronous: true };
    }
    if (operation === "delete") {
      if (resource?.values?.chargingMode !== "Pay-per-use") throw new ManagementInputError("Use subscription cancellation for prepaid instances. This deletion supports pay-per-use instances only.");
      await huaweiFetch(session, "dms", path, { method: "DELETE" });
      return { message: "Instance deletion submitted.", resourceId: resource!.id, asynchronous: true };
    }
    if (operation === "expand-storage") {
      if (resource?.values?.chargingMode !== "Pay-per-use") throw new ManagementInputError("This expansion supports pay-per-use instances only. Prepaid changes require a subscription order.");
      const instance = await detail(session, resource!.id);
      const brokers = optionalNumber(instance.broker_num) ?? Number(resource?.values?.brokers ?? 0);
      const current = optionalNumber(instance.total_storage_space) ?? optionalNumber(instance.storage_space) ?? 0;
      const storage = Number(values.storage);
      if (!brokers || storage % 100 || storage <= current || storage / brokers > 30000) throw new ManagementInputError("The new total capacity must exceed current storage, be a multiple of 100 GB, and stay within 30,000 GB per broker.");
      const response = await huaweiFetch<Record<string, unknown>>(session, "dms", `/v2/${session.projectId}/kafka/instances/${encodeURIComponent(resource!.id)}/extend`, { method: "POST", body: JSON.stringify({ oper_type: "storage", new_storage_space: storage }) });
      return { message: "Storage expansion submitted.", resourceId: resource!.id, jobId: firstString([response.job_id], "") || undefined, asynchronous: true };
    }
    if (operation === "topics") {
      const { rows } = await topics(session, resource!);
      return { message: `${rows.length} topics loaded.`, facts: rows.map((item) => ({ label: firstString([item.name], "Topic"), value: [item.partition !== undefined ? `${item.partition} partitions` : "", item.replication !== undefined ? `${item.replication} replicas` : "", item.retention_time !== undefined ? `${item.retention_time} h retention` : ""].filter(Boolean).join(" · ") || "Configured" })) };
    }
    if (operation === "create-topic") {
      const instance = await detail(session, resource!.id);
      const brokers = optionalNumber(instance.broker_num) ?? 0;
      if (Number(values.replication) > brokers) throw new ManagementInputError(`Replicas cannot exceed the broker count (${brokers}).`);
      const current = await topics(session, resource!);
      if (current.remainPartitions !== undefined && Number(values.partitions) > current.remainPartitions) throw new ManagementInputError(`Only ${current.remainPartitions} partitions remain available on this instance.`);
      if (current.rows.some((item) => firstString([item.name], "") === values.topicName)) throw new ManagementInputError("A topic with this name already exists.", 409);
      const response = await huaweiFetch<Record<string, unknown>>(session, "dms", `${path}/topics`, { method: "POST", body: JSON.stringify({ id: values.topicName, partition: values.partitions, replication: values.replication, retention_time: values.retention, sync_replication: values.syncReplication ?? false, sync_message_flush: values.syncFlush ?? false, ...(values.topicDescription ? { topic_desc: values.topicDescription } : {}) }) });
      return { message: "Topic created.", resourceId: resource!.id, facts: [{ label: "Topic", value: firstString([response.name, values.topicName], "-") }] };
    }
    if (operation === "delete-topic") {
      if (!(await topics(session, resource!)).rows.some((item) => firstString([item.name], "") === values.topic)) throw new ManagementInputError("The selected topic is not in this instance.", 404);
      const response = await huaweiFetch<Record<string, unknown>>(session, "dms", `${path}/topics/delete`, { method: "POST", body: JSON.stringify({ topics: [values.topic] }) });
      const own = asArray(response.topics).map(asRecord).find((item) => firstString([item.id], "") === values.topic);
      if (!own || own.success !== true) throw new Error("Huawei rejected the topic deletion or returned no confirmation for this topic. Refresh the topic list before retrying.");
      return { message: "Topic deleted.", resourceId: resource!.id };
    }
    if (operation === "users") {
      const rows = await users(session, resource!);
      return { message: `${rows.length} access users loaded.`, facts: rows.map((item) => ({ label: firstString([item.user_name], "User"), value: [firstString([item.role], ""), firstString([item.user_desc], "")].filter(Boolean).join(" · ") || "Access credentials are hidden" })) };
    }
    if (operation === "create-user") {
      if ((await detail(session, resource!.id)).ssl_enable === false) throw new ManagementInputError("SASL authentication is disabled on this instance.");
      assertPassword(String(values.userPassword), String(values.userName));
      if ((await users(session, resource!)).some((item) => firstString([item.user_name], "") === values.userName)) throw new ManagementInputError("An access user with this name already exists.", 409);
      await huaweiFetch(session, "dms", `${path}/users`, { method: "POST", body: JSON.stringify({ user_name: values.userName, user_passwd: values.userPassword, ...(values.userDescription ? { user_desc: values.userDescription } : {}) }) });
      return { message: "Access user created.", resourceId: resource!.id };
    }
    if (operation === "delete-user") {
      if (!(await users(session, resource!)).some((item) => firstString([item.user_name], "") === values.user)) throw new ManagementInputError("The selected access user is not in this instance.", 404);
      await huaweiFetch(session, "dms", `${path}/users`, { method: "PUT", body: JSON.stringify({ action: "delete", users: [values.user] }) });
      return { message: "Access user deleted.", resourceId: resource!.id };
    }
    if (operation === "reset-user-password") {
      if (!(await users(session, resource!)).some((item) => firstString([item.user_name], "") === values.user)) throw new ManagementInputError("The selected access user is not in this instance.", 404);
      assertPassword(String(values.password), String(values.user));
      await huaweiFetch(session, "dms", `${path}/users/${encodeURIComponent(String(values.user))}`, { method: "PUT", body: JSON.stringify({ new_password: values.password }) });
      return { message: "Access user password updated.", resourceId: resource!.id };
    }
    throw new ManagementInputError("Unsupported DMS Kafka operation.");
  },
};
