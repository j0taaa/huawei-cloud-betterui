import "server-only";
import { serviceCatalog } from "@/lib/service-catalog";
import { managementAdapters } from "./registry";

// Existing service workspaces remain available alongside the new management adapters.
const existingWorkflows: Record<string, string[]> = {
  ecs: ["Start, stop, restart", "Snapshots", "Metrics"],
  functiongraph: ["Create function", "Edit code and configuration", "Delete function", "Dependencies", "Triggers", "Invoke", "Logs and metrics"],
  ims: ["Delete private image"],
  cci: ["Delete namespace"],
  obs: ["Upload and download objects", "Create folder", "Delete object", "Delete empty bucket"],
  evs: ["Create disk", "Edit and expand disk", "Attach and detach", "Delete disk", "Snapshot lifecycle", "Backup", "Metrics, tags, and activity"],
  sfs: ["Create and delete share", "Access rules"],
  cbr: ["Edit vault", "Manual checkpoint"],
  network: ["Edit and delete VPC, subnet, and security group"],
  eip: ["Allocate and release EIP"],
  nat: ["Create and delete gateway", "Create and delete SNAT rule"],
  dns: ["Create and delete public zone"],
  smn: ["Create and delete topic"],
  rds: ["Reboot instance"],
  gaussdb: ["Reboot instance"],
  taurusdb: ["Reboot instance"],
  geminidb: ["Restart instance"],
  dds: ["Restart instance"],
  dcs: ["Restart instance", "Flush data"],
  "dms-kafka": ["Restart instance"],
};
const remainingAreas: Record<string, string[]> = {
  cci: ["Services, ingress, autoscaling, pod logs/exec, and persistent storage lifecycle", "Registry credentials, Secret updates, volumes, environment injection, and advanced pod settings", "Additional networks, quotas, metrics, pricing, and cloud completion tracking"],
  css: ["Node-count changes, dedicated master/client nodes, snapshot storage setup, and restore", "Index and document workflows, engine upgrades, plugins, security configuration, and public access", "Subscription orders, tags, quotas, pricing, metrics, logs, and cloud completion tracking"],
  cce: ["Workloads, Kubernetes RBAC, networking, storage classes, and application releases", "Cluster upgrades, node lifecycle, autoscaling, Turbo, and advanced addon configuration", "Public access, kubeconfigs, prepaid orders, quotas, pricing, logs, and metrics"],
  oms: ["Task groups, synchronization, additional cloud sources, URL lists, and connectors", "Archive restore, encryption, notifications, and failed-object browsing", "Quotas, detailed metrics, pricing, and billing"],
  dds: ["Sharded clusters, node expansion, AZ migration, and version upgrades", "Restore, parameter templates, SSL and public access configuration, roles, and recycle bin", "Audit and slow logs, metrics, tags, quotas, and subscription orders"],
  apig: ["API editing, parameter mapping, additional authentication and backend types", "Consumers, grants, plugins, quotas, custom domains, certificates, and VPC channels", "Gateway scaling, prepaid orders, access logging, monitoring, pricing, and tags"],
  eventgrid: ["Cloud-service and message-broker sources; additional targets and connections", "Filters and target editing, transforms, dead-letter queues, and event schemas", "Cross-account channels, traces, metrics, pricing, and quotas"],
  dli: ["Elastic resource pools, Flink, and Spark batch jobs", "Databases, tables, data sources, catalogs, and permissions", "Billing, quotas, logs, and metrics"],
  secmaster: ["Alerts, incidents, investigations, and security dashboards", "Playbooks, workflows, collection, shipping, and indexes", "Edition purchases, protection settings, billing, and quotas"],
  "enterprise-router": ["Shared and non-VPC attachments, route policies, and flow logs", "Availability-zone changes, tags, quotas, metrics, and billing", "Cloud completion tracking"],
  "vpc-endpoint": ["Gateway endpoints, route tables, policies, and endpoint access control", "Multiple port mappings, cross-account service discovery, tags, and upgrades", "Quotas, monitoring, billing, and cloud completion tracking"],
  ims: ["Image imports, exports, full-ECS images, replication, and protection changes", "Image drivers, encryption, tags, subscriptions, pricing, and quotas"],
  rds: ["High availability, replicas, SQL Server, and advanced provisioning", "Restores, parameters, SSL, access grants, tags, maintenance, and prepaid orders", "Monitoring, diagnosis, pricing, and quotas"],
  iotda: ["Resource spaces, groups, tags, rules, and routing lifecycle", "Certificate provisioning, asynchronous commands, and OTA upgrades", "Telemetry queries, connection logs, codecs, bulk import, quotas, and billing"],
  dcs: ["Accounts, ACLs, parameter configuration, and password changes", "Replication, public access, maintenance, prepaid orders, and scaling topology", "Monitoring, diagnosis, migration, and cloud task completion tracking"],
  "dms-kafka": ["Topic editing, permissions, consumer groups, and message inspection", "Broker scaling, replication, public access, prepaid orders, and maintenance", "Monitoring, diagnosis, recovery, and cloud task completion tracking"],
  deh: ["Host tags and ECS placement or migration", "Subscription payment, renewal, cancellation, and pricing", "Quotas, monitoring, and cloud completion tracking"],
  iam: ["Role and policy lifecycle, project grants, and agencies", "Credentials, MFA, federation, and account security settings", "Complete permission analysis and audit workflows"],
  nat: ["Private NAT, transit IPs, and Direct Connect scenarios", "Port ranges, EIP changes, gateway scaling, and session configuration", "Quotas, pricing, monitoring, and cloud completion tracking"],
  as: ["Custom launch templates, multiple networks, and load-balancer configuration", "Alarm policies, lifecycle hooks, notifications, and warm pools", "Advanced scaling, quotas, pricing, and cloud completion tracking"],
  ecs: ["Rebuild, reinstall and password recovery", "NICs, attached disks and security groups", "Quotas, pricing, billing, backups and observability"],
  network: ["IPv6, route tables, DHCP and ACLs", "Peering, NICs, endpoints and flow logs", "Topology, import/export and bulk operations"],
  eip: ["Shared and prepaid bandwidth", "IPv6 and network configuration", "Quotas, pricing and cloud completion tracking"],
  elb: ["Certificate creation and complete TLS settings", "Routing policies, ACLs and advanced backend configuration", "Autoscaling, quotas, pricing, metrics and cloud completion tracking"],
  obs: ["Object versions, multipart uploads, copies and archive restore", "Encryption, WORM, replication, notifications, logging and tags", "Quotas, costs, monitoring and object operation history"],
  cbr: ["Backup restoration and replication", "Other vault resource types and advanced schedules", "Complete cloud job tracking, pricing and quotas"],
  sfs: ["SFS Turbo and file-system versions", "Encryption, snapshots, quotas and billing", "Monitoring and cloud completion tracking"],
  swr: ["Organization and repository permissions", "Replication, triggers and retention policies", "Enterprise edition and registry monitoring"],
  dns: ["Private zones, PTR, resolvers and routing lines", "Record validation, import/export and monitoring"],
  smn: ["Templates and subscriber administration", "Subscription confirmation resend and endpoint editing", "Metrics and integration configuration"],
  lts: ["Log searching, collection and ingestion", "Indexes, alarms and advanced log configuration", "Monitoring and billing"],
  dew: ["Asymmetric keys, imported material and cryptographic operations", "Secrets and credential management", "Permissions and complete key policy workflows"],
  ces: ["Alarm policy editing, dashboards and resource groups", "Custom metrics, event monitoring and notifications"],
  cts: ["Data-event tracker lifecycle", "OBS export configuration, agencies and notifications", "Extended audit search and export"],
  cdn: ["TLS, cache rules, access control and complete origin settings", "Traffic analytics, logs and task completion tracking", "Pricing and quota workflows"],
  aom: ["Cross-account monitoring", "Metric queries and dashboards", "Alarms and collection rules"],
  "enterprise-projects": ["Resource migration", "Authorization and quotas"],
  "dms-rabbitmq": ["Broker scaling", "Public access and encryption configuration", "Bindings and complete access policies", "Monitoring and recovery"],
  "dms-rocketmq": ["Broker scaling", "Public access and encryption configuration", "Topic and consumer updates", "Messages, tracing, monitoring and recovery"],
  functiongraph: ["Complete workflow and application lifecycle", "Policy and billing coverage", "Cloud job tracking"],
  evs: ["Encryption and provisioning options", "Tag changes", "Complete pricing and quota checks", "Cloud job tracking"],
  "billing/center": ["Invoices, orders, renewal and payment workflows"],
  cost: ["Budgets, alerts and cost allocation workflows"],
  flexus: ["Native Flexus provisioning and management"],
  mgc: ["Migration orchestration and task management"],
  koogallery: ["Marketplace purchases and subscription management"],
};

/** Include every catalog item, even entries without a route. No adapter implies console parity. */
export function getServiceCoverage() {
  return Object.entries(serviceCatalog).flatMap(([category, items]) => items.map((item) => {
    const service = item.href?.replace(/^\/services\//, "") ?? item.shortName.toLowerCase().replace(/\s+/g, "-");
    const adapter = Object.hasOwn(managementAdapters, service) ? managementAdapters[service] : undefined;
    const workflows = [...new Set([...(existingWorkflows[service] ?? []), ...(adapter?.operations.map((operation) => operation.label) ?? [])])];
    return { catalogId: item.shortName.toLowerCase().replace(/\s+/g, "-"), service, name: item.name, category, inventoryHref: item.href, managementHref: adapter ? `/services/${service}/manage` : undefined, workflows, status: !item.href ? "Catalog only" : workflows.length ? "Partial management" : "Inventory only", remaining: remainingAreas[service] ?? ["Complete resource lifecycle", "Configuration and policy workflows", "Observability and cloud task tracking"] };
  }));
}
