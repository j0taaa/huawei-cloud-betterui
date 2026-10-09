# Service Capability Roadmap

This roadmap is derived from a read-only capability inventory of the Huawei Cloud console. It deliberately does not reproduce Huawei's visual design. The goal is a denser, clearer operational console with equivalent lifecycle coverage and stronger cross-service context.

Account-specific screenshots and raw captures are kept outside this repository in `/home/huawei-cloud-console-research/2026-07-14`.

## Research Evidence

The 2026-07-14/15 session produced 341 validated screenshots, including 286 interactive full-page states across 24 service folders. The longest captured page is 4,523 px. The private gallery and machine-readable manifest are available at:

- `/home/huawei-cloud-console-research/2026-07-14/index.html`
- `/home/huawei-cloud-console-research/2026-07-14/manifest.json`
- `/home/huawei-cloud-console-research/2026-07-14/NOTES.md`

Coverage is strongest for EVS, VPC/networking, OBS, FunctionGraph, RDS/database families, CBR, Cloud Eye, DNS, SMN, IAM, CDN, and WAF. The notes explicitly track permission-gated, resource-dependent, and browser-interrupted gaps for a later shared-browser session. Treat those as research gaps, not evidence that the official service lacks a capability.

## Product Model

Every mature service workspace should expose the parts that apply to its domain:

1. **Overview**: health, cost, quota, capacity, alarms, and recent operations.
2. **Inventory**: searchable, filterable, paginated resources with bulk actions and export.
3. **Create**: a dedicated workspace for complex resources; dialogs only for small objects.
4. **Details**: summary plus domain-specific tabs and named related-resource links.
5. **Operations**: lifecycle actions with eligibility, impact, progress, and job tracking.
6. **Observability**: metrics, logs, alarms, events, and audit activity in resource context.
7. **Policies**: backup, retention, parameters, access, lifecycle, and automation where relevant.
8. **History**: task center, operation log, failures, and recycle-bin/restoration flows.

The shared interface should stay small. Service-owned modules decide which capabilities apply and provide domain-specific content behind reusable workspace, task, form, and monitoring modules.

## Shared Modules First

### Resource Workspace

Create a service workspace module that owns secondary navigation, counters, loading/error states, and URL state. It should support overview, inventory, policy, task, and activity views without forcing every service into identical content.

### Operation Jobs

Introduce one operation-job model for asynchronous Huawei actions:

- queued, running, succeeded, failed, cancelled;
- affected resource and initiating action;
- Huawei job/task identifier;
- timestamps, progress, error details, and retry/navigation actions.

Expose jobs through a global task drawer and service-level task views. Replace isolated success strings such as "Job submitted" with persistent operation state.

### Creation Workspace

Provide a deep form module with section navigation, validation summary, dependent field loading, configuration review, estimated price, quota warnings, and preserved draft state. Service create modules supply schemas and domain content rather than rebuilding workflow mechanics.

### Resource Relationships

Standardize named links among ECS, EVS, VPC, subnet, security group, EIP, ELB, CBR, FunctionGraph, SMN, and LTS. Raw IDs should be secondary copyable metadata.

### Observability

Create a reusable resource-observability module for time ranges, metric aggregation, empty-data diagnosis, alarms, logs, and events. Service modules provide namespaces, dimensions, and metric definitions.

## Priority 1: Finish EVS as the Reference Service

EVS is already the deepest BetterUI implementation and should become the reference vertical slice.

Implementation progress (2026-07-21):

- Completed create-disk-from-snapshot with server-side snapshot ownership and minimum-size validation.
- Completed the dedicated searchable, paginated snapshot inventory with source-disk links, selection, bulk deletion, rollback, create-disk, and delete actions.
- Completed CSV export for the global and per-disk snapshot inventories.
- Completed URL-addressable Overview, Snapshots, Backups, Monitoring, Tags, and Activity tabs on EVS disk details.
- Completed CBR vault/policy relationships, backup inventory, and guarded manual checkpoint creation for vault-bound disks.
- Completed six-hour Cloud Eye charts for EVS read/write bandwidth and IOPS using `SYS.EVS` and the documented `disk_name` dimension.
- Completed read-only EVS tags and recent disk-scoped CTS activity.
- Tag mutation, richer billing/renewal metadata, creation options, and persistent operation jobs below remain open.

- Extend disk creation with source selection, performance-aware disk types, encryption, sharing, device type, automatic CBR backup, tags, quantity, quota, and price estimate.
- Add create-disk-from-snapshot.
- Add a dedicated snapshot inventory view with rollback, create disk, delete, bulk selection, and export.
- Add Backups, Monitoring, Tags, and Activity tabs to disk details.
- Add CBR vault/policy relationships and manual backup creation.
- Show renewal, expiration, billing mode, and lifecycle eligibility together.
- Track create, expand, attach, detach, delete, snapshot, and rollback jobs persistently.

Completion criterion: every action visible in the observed EVS disk and snapshot workflows is either implemented or clearly marked unsupported by the Huawei interface/region, with no inert buttons.

## Priority 2: Networking Workspace

Build one networking workspace with service-owned views rather than unrelated single pages.

- VPC creation with CIDR validation, endpoint access, initial subnets, IPv6, route/DNS/NTP/DHCP settings, tags, and descriptions.
- Subnet creation and editing, route-table reassignment, IPv6 enablement, ACL association, and deletion eligibility.
- Security-group rule and instance management, import/export, cloning, and bulk rule operations.
- Route tables, NICs, peering, ACLs, IP groups, EIPs/shared bandwidth, NAT, and VPC endpoints.
- VPC topology and named related-resource counts.
- Flow logs, traffic mirroring, and troubleshooting entry points.

The visual design should favor a network map plus dense resource panes, not the official console's long navigation tree.

## Priority 3: OBS and RDS

### OBS

- Complete bucket creation: redundancy, storage class, public-access block, policy, direct Archive reads, encryption, WORM, and tags.
- Bucket details: objects/versions, lifecycle, access policy, CORS, encryption, replication, events, logging, monitoring, tags, and cost.
- Add task history for uploads, copies, deletes, restores, and multipart operations.

### RDS

- Add the full create workspace for engine, topology, storage, class, AZs, networking, security, parameters, credentials, encryption, replicas, billing, and renewal.
- Add backup creation/deletion/restoration and retention configuration.
- Add parameter-template compare/apply/import flows.
- Add logs, events, metrics/alarms, task center, recycle bin, DR, and connection guidance.
- Expand actions beyond reboot to lifecycle and specification operations supported by each engine/state.

## Priority 4: CBR, Cloud Eye, DNS, and SMN

### CBR

- Create vaults by protected resource type.
- Associate/disassociate resources, run backups, restore, expand capacity, and manage billing.
- Create/edit/enable/disable/import/export policies with schedule preview and retention rules.
- Add persistent task history.

### Cloud Eye

- Health overview with severity, resource coverage, and persistent alarms.
- Dashboards, resource groups, alarm rules/history, custom metrics, event monitoring, and tasks.
- Embed the observability module into service resource details.

### DNS

- Add private zones, PTR records, resolvers, and custom lines.
- Add zone details with record-set CRUD, batch import/export, checks, enable/disable, tags, and activity.

### SMN

- Add subscriptions, subscribers, templates, publishing, confirmation resend, and endpoint editing.
- Resolve FunctionGraph endpoints to function names and links.
- Add monitoring and CTS/LTS ingestion configuration.

## Priority 5: Database, Container, and Delivery Families

- DCS: creation, migration, backup/restore, parameters, diagnosis, failover, resize, logs, tasks, and recycle bin.
- DDS/GaussDB/GeminiDB: backups, parameters, logs, events, tasks, recycle bin, DR, upgrades, and connection administration.
- CCE: cluster creation, nodes, workloads, networking, storage, add-ons, permissions, scaling, monitoring, and cost governance.
- SWR: organizations, repositories/tags, login command, permissions, replication, triggers, storage, and traffic.
- DMS Kafka: topics, users/SASL, consumer groups, connections/certificates, configuration, alarms, tasks, and recycle bin.
- CDN: domains, purge/prefetch, cache/security rules, analytics, logs, certificates, data export, and billing risk.
- WAF: website onboarding, policies, events, objects, reports, and instance management.
- IMS: public/private/shared inventories, image creation/import/export/share/replication, metadata, and server creation.

## Delivery Rules

- Implement vertical slices end to end: cloud adapter, route, domain types, UI, action state, and focused tests.
- Keep Huawei request/response details inside service-owned cloud modules.
- Reuse shared workspace mechanics while retaining service-specific information architecture and visuals.
- Never add a visible action without an implemented outcome or an explicit, evidence-based unsupported state.
- Test lifecycle eligibility and error mapping at module interfaces; use browser tests only for high-risk interactions or regressions.
- Keep account-specific research artifacts outside Git.
