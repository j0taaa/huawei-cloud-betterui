# Huawei Cloud Better UI

A personal Huawei Cloud console built with Next.js App Router, React, TypeScript, Tailwind CSS, and shadcn/ui. It includes IAM login, inventory across accessible regional projects, resource details, OBS previews/uploads/downloads, ECS actions, and EVS snapshots. Some catalog services remain placeholders.

## Run locally

Use Node.js 24, matching the Docker image and the test runner.

```bash
npm ci
npm run dev
```

Open http://localhost:3000 and sign in with your Huawei IAM account. Service endpoints default to the session's region. Optional endpoint overrides are listed in `src/lib/huawei/endpoints.ts`; IAM uses `HUAWEI_CLOUD_IAM_ENDPOINT`, and OBS uses `HUAWEI_OBS_ENDPOINT`.

## SWR, Auto Scaling, and Billing/Cost

- **SWR** (`/services/swr`): live Basic edition repositories, organizations with repositories, image tags, digests, sizes, and pull commands. Repositories are queried once per accessible region to avoid duplicate results from IAM subprojects. Repository links include region, organization, and name; nested repository names are supported. Enterprise edition registries use a different API and are not covered by this adapter.
- **Auto Scaling** (`/services/as`): live scaling groups across projects, actual/desired/minimum/maximum capacity, member instances with links to ECS, scaling policies, and launch configuration details. Configuration parsing only retains display fields; passwords, injected files, and Cloud-Init user data are not stored or displayed.
- **Billing Center** (`/services/billing/center`): choose a month to view the account's expenditure summary, refunds/adjustments, cash coupons, and settlement/outstanding amounts. Totals come from Huawei's summary response. The query uses `method=oneself`, so enterprise member accounts are excluded.
- **Cost Center** (`/services/cost`): choose a month, original/amortized costs, and grouping by service, region, or enterprise project. It displays **net costs**, preserves decimal amounts, and sums grouped totals without floating-point arithmetic. Cost grouping values are the identifiers supplied by Huawei; Cost Center must be enabled for the account.

These views are read-only and use the existing disk cache. Billing is global and defaults to `https://bss-intl.myhuaweicloud.com`; override it with `HUAWEI_BSS_ENDPOINT` for a different Huawei site. SWR and AS overrides are `HUAWEI_SWR_ENDPOINT` and `HUAWEI_AS_ENDPOINT`. New IAM logins retain a domain-scoped account token on the server for Billing/Cost while regional services keep their project tokens. Sign out and sign in again if an existing session predates this addition.

Billing months follow Huawei's GMT+08:00 calendar. The UI validates Billing's latest 36 months and Cost's latest 18 months before sending requests. Original costs can lag by about an hour; amortized data refreshes daily and can take longer. Current-month amounts are provisional. Billing and Cost are different accounting views and their amounts need not match. Missing permissions, a disabled Cost Center, and failed requests show an error rather than a zero-spend result. Cache keys include month, cost grouping, and cost type, so filter changes cannot reuse another query's results.

API contracts: [SWR repositories](https://support.huaweicloud.com/intl/en-us/api-swr/swr_02_0126.html), [SWR tags](https://support.huaweicloud.com/intl/en-us/api-swr/swr_02_0125.html), [AS groups](https://support.huaweicloud.com/intl/en-us/api-as/as_06_0102.html), [AS instances](https://support.huaweicloud.com/intl/en-us/api-as/as_06_0301.html), [AS policies](https://support.huaweicloud.com/intl/en-us/api-as/as_06_0405.html), [billing summaries](https://support.huaweicloud.com/intl/en-us/api-oce/mbc_00008.html), [cost analysis and data delays](https://support.huaweicloud.com/intl/en-us/api-oce/costm_00014.html), and [global IAM token scope](https://support.huaweicloud.com/intl/en-us/api-iam/iam_02_0510.html).

```bash
npm run check     # lint, TypeScript, behavioral tests, build, and production HTTP smoke test
npm run start     # serve the completed build
```

Individual checks are `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. After building, `npm run test:production` starts temporary local app/API servers and verifies login, cache hits, paginated inventory, mutation invalidation, and error pages in the compiled app. Tests use mocked HTTP responses and temporary cache directories; they do not need cloud credentials or modify cloud resources.

## Additional messaging, monitoring, and governance services

- **DMS for RabbitMQ** (`/services/dms-rabbitmq`): instance inventory and details with version, brokers, storage, TLS, connection endpoints, and network placement.
- **DMS for RocketMQ** (`/services/dms-rocketmq`): instance inventory and details with broker capacity, NameServer/gRPC endpoints, storage, TLS, and network placement.
- **AOM** (`/services/aom`): Prometheus instance inventory across selected projects and all granted enterprise projects, including source type, status, version, and metric retention.
- **Enterprise Project Management** (`/services/enterprise-projects`): account-wide project inventory, enabled/disabled state, commercial/test classification, descriptions, and timestamps.

These additions are read-only. Messaging detail links retain the owning IAM project; cache keys include engine, instance, and project. Missing permissions remain visible as errors, including when another selected project succeeds. EPS requires the account token retained by current IAM logins and makes one account-wide paginated query, rather than repeating requests per regional project.

Endpoint overrides are `HUAWEI_RABBITMQ_ENDPOINT`, `HUAWEI_ROCKETMQ_ENDPOINT`, `HUAWEI_AOM_ENDPOINT`, and `HUAWEI_EPS_ENDPOINT`. EPS defaults to `https://eps.myhuaweicloud.com`; override it for another Huawei site.

API references: [RabbitMQ instances](https://support.huaweicloud.com/intl/en-us/api-rabbitmq/ListInstances.html), [RocketMQ instances](https://support.huaweicloud.com/intl/en-us/api-hrm/ListInstances.html), [AOM Prometheus instances](https://support.huaweicloud.com/intl/en-us/api-aom/ListPromInstance.html), and [enterprise projects](https://support.huaweicloud.com/intl/en-us/api-em/en-us_topic_0121230880.html).

## Code organization

| Location                               | Responsibility                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/lib/huawei/services/<service>.ts` | One service's public types, API requests, response parsing, and operations                   |
| `src/lib/huawei/http.ts`               | Authenticated JSON transport and explicitly configured list requests                         |
| `src/lib/huawei/pagination.ts`         | Offset, page-number, and marker collection with loop protection                              |
| `src/lib/huawei/projects.ts`           | Project selection and aggregation with contextual errors                                     |
| `src/lib/huawei/errors.ts`             | Partial results and transformations that preserve their public shape                         |
| `src/lib/huawei/cache-store.ts`        | Disk cache, request deduplication, refreshes, and invalidation                               |
| `src/lib/huawei/result.ts`             | Session-scoped cache integration for server pages                                            |
| `src/lib/huawei/cache-keys.ts`         | Stable keys shared by pages and mutation handlers                                            |
| `src/lib/huawei-cloud.ts`              | Public exports for existing callers; add exports here without implementing services here     |
| `src/lib/service-catalog.ts`           | Shared navigation and command-search metadata, including aliases and icons                   |
| `src/app/services`                     | Server pages that render typed loader results                                                |
| `src/app/api/cloud`                    | Validated mutation/download handlers                                                         |
| `tests`                                | Behavioral tests for cache, API pagination/errors, OBS keys, IAM regions, and catalog routes |

Implementations and public contracts live only under `src/lib/huawei/`. The old `src/lib/huawei-cloud/` paths are one-way compatibility exports. Service-owned `.types.ts` files contain contracts shared with client components; `huawei-cloud/types.ts` only re-exports those contracts.

FunctionGraph uses separate modules for package editing (`src/lib/functiongraph/package.ts`), dependency manifests, transport, and CES authentication. Its configuration, trigger, and monitoring panels are separate client components. Code editing preserves every ZIP entry, including binary assets and files outside the 30-file text preview. ZIPs remain ZIPs after saving. Dependency edits preserve the complete archive as well. Invalid, unsupported, or oversized packages fail before submission; the editing limit is 7 MB of uncompressed data.

Server adapters are marked `server-only`. Client components can use `import type` for their data types; they should not import loaders. Keep service-specific parsing in its adapter and share helpers only when multiple services use the same behavior. API versions differ by service, so keep their contracts explicit instead of forcing every resource into one generic model.

## Cache behavior

The existing disk location (`.next/cache/huawei-cloud-data`), SHA-256 filenames, identity scope, and `{ data, updatedAt }` records are preserved. Reader and mutation keys come from `cloudCacheKeys`, so minification does not change invalidation behavior.

- Fresh entries return immediately without a cloud request.
- After 15 seconds, entries return their cached data while one background request refreshes them. Requests for the same key share the active refresh, and retries are throttled to 15 seconds.
- Failed or partial loads never overwrite the last complete result. Errors remain visible, and the original successful timestamp remains attached to cached data. A cold miss can show partial data with an error, without storing that partial result.
- Stale data remains available during outages; there is intentionally no hard expiry. Refreshing pages polls until the active request completes.
- Writes use temporary files and atomic rename. Corrupt records recover as cache misses. Generation checks prevent a refresh started before invalidation from recreating the old entry.
- Mutations invalidate their affected inventory/detail keys. ECS actions also invalidate the dashboard summary; OBS uploads invalidate bucket inventory and that object's detail.

The cache and sessions target one running Node process, as in this personal project. Refresh deduplication and generation tracking are process-local. Clearing `.next` clears cached results; restarting the server clears in-memory sessions.

## Add a service

1. Read the Huawei API reference for the exact endpoint version, response shape, page-size limits, and pagination protocol. For Next.js changes, also read the installed guides in `node_modules/next/dist/docs/`, as required by `AGENTS.md`.
2. Add the service endpoint mapping in `endpoints.ts` if necessary. Create a focused adapter in `services/` with its public resource type and a project-scoped loader.
3. Use `huaweiList` for paginated endpoints. Specify array paths, cursor parameter, size, and any documented next-marker/total fields. ECS/BMS `offset` is a one-based page number; EVS/RDS `offset` is a row offset. DeH/IMS can use the final resource ID when no next marker is returned. DLI's queue endpoint is unpaginated and uses `huaweiFetch`.
4. Aggregate regional inventory with `loadAcrossProjects`. Propagate failures. Use `finishCloudLoad` for composite loaders and `mapCloudLoad` when transforming partial inventory into a different result type, such as a detail object.
   Account-wide services such as Billing/Cost must be queried once using the account token. Region-wide services such as SWR must avoid duplicating inventory across IAM subprojects in the same region.
5. Export the public type and loader from `huawei-cloud.ts`; add an explicit stable key in `cache-keys.ts`.
6. Create a server page using `withCloudResult(fallback, loader, cloudCacheKeys.listYourResources)`. Use the adapter's type rather than duplicating it in the page. Render errors and cache freshness; only return a resource-not-found view after a successful lookup.
   Reuse `ServiceInventoryPage`, `InventoryTable`, and `ResourceFacts` from `src/app/services/_components/service-inventory.tsx` for inventory and detail views. Include every API query option in cache keys for filtered loaders.
7. Add one catalog entry with its route, aliases, and icon. Command search derives its entries from that catalog automatically.
8. If adding a mutation, validate its input and invalidate all affected keys. Test a later page, an empty list, permissions failure, and the service's relevant parsing. Run `npm run check`.

Pagination tests should exercise the actual adapter with mocked fetch responses, including the second page and its preserved filters/headers. The shared collector rejects repeated pages/cursors and inventories exceeding 1,000 pages instead of silently caching a truncated result. CTS traces intentionally show the most recent 50 records in a 24-hour window.

## Dependencies

Next.js and its ESLint configuration are updated together. shadcn is a development tool; generated UI components remain in the application source. Use `npm audit --omit=dev` to check runtime dependencies separately from developer tooling, and avoid forced downgrades that would break the supported framework/tool versions.
