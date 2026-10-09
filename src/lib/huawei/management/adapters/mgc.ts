import "server-only";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { CloudLoadError, finishCloudLoad, settledValue } from "@/lib/huawei/errors";
import { ManagementInputError, type ManagementResource } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";
import { smsManagement } from "./sms";
import { omsManagement } from "./oms";
import { cdmManagement } from "./cdm";

// BetterUI's existing MgC page is a rollup of SMS, OMS and CDM. These are their
// actual typed workflows; this does not impersonate native MgC orchestration.
const children: Record<string, ManagementAdapter> = { sms: smsManagement, oms: omsManagement, cdm: cdmManagement };
const prefix = (service: string, id: string) => `${service}:${id}`;
function split(value: string) {
  const separator = value.indexOf(":");
  const service = value.slice(0, separator), id = value.slice(separator + 1);
  if (separator < 1 || !Object.hasOwn(children, service) || !id) throw new ManagementInputError("Select a supported SMS, OMS, or CDM workflow.");
  return { service, id, adapter: children[service] };
}
function nativeResource(service: string, resource?: ManagementResource) {
  if (!resource) return undefined;
  const selected = split(resource.id);
  if (selected.service !== service) throw new ManagementInputError("This resource belongs to a different migration service.", 409);
  return { ...resource, id: selected.id };
}
function scopedResource(service: string, resource: ManagementResource) {
  return { ...resource, id: prefix(service, resource.id), values: { ...resource.values, migrationService: service.toUpperCase() } };
}

export const mgcManagement: ManagementAdapter = {
  title: "Migration Center Rollup",
  operations: Object.entries(children).flatMap(([service, adapter]) => adapter.operations.map(operation => ({
    ...operation,
    id: prefix(service, operation.id),
    label: `${service.toUpperCase()} · ${operation.label}`,
    description: `${service.toUpperCase()} workflow. ${operation.description}`,
    resourcePrefixes: operation.kind === "create" ? undefined : operation.resourcePrefixes?.map(id => prefix(service, id)) ?? [`${service}:`],
    excludedResourceIds: operation.excludedResourceIds?.map(id => prefix(service, id)),
  }))),
  inventory: async session => {
    const services = Object.keys(children);
    const results = await Promise.allSettled(services.map(async service => {
      try { return (await children[service].inventory(session)).map(resource => scopedResource(service, resource)); }
      catch (error) {
        if (error instanceof CloudLoadError && Array.isArray(error.partialData)) throw new CloudLoadError(error.message, (error.partialData as ManagementResource[]).map(resource => scopedResource(service, resource)));
        throw error;
      }
    }));
    return finishCloudLoad(results, results.flatMap(result => settledValue(result, [])), services.map(service => service.toUpperCase()));
  },
  options: async (session, operation, resource) => {
    const child = split(operation);
    if (!child.adapter.operations.some(operation => operation.id === child.id)) throw new ManagementInputError("Unsupported migration workflow.");
    return child.adapter.options?.(session, child.id, nativeResource(child.service, resource)) ?? {};
  },
  execute: async (session, operation, values, resource) => {
    const child = split(operation);
    const definition = child.adapter.operations.find(operation => operation.id === child.id);
    if (!definition) throw new ManagementInputError("Unsupported migration workflow.");
    let selected = nativeResource(child.service, resource);
    if (definition.kind !== "create") {
      selected = (await child.adapter.inventory(session)).find(item => item.id === selected?.id);
      if (!selected) throw new ManagementInputError("The selected migration resource no longer exists.", 404);
      if (definition.resourcePrefixes && !definition.resourcePrefixes.some(id => selected!.id.startsWith(id))) throw new ManagementInputError("Select the correct migration resource type.", 409);
      if (definition.excludedResourceIds?.includes(selected.id) || (definition.allowedStatuses && !definition.allowedStatuses.includes(selected.status ?? "UNKNOWN"))) throw new ManagementInputError("The migration resource's current state does not allow this workflow.", 409);
    }
    const outcome = await child.adapter.execute(session, child.id, values, selected);
    return { ...outcome, ...(outcome.resourceId ? { resourceId: prefix(child.service, outcome.resourceId) } : {}), ...(outcome.jobId ? { jobId: prefix(child.service, outcome.jobId) } : {}) };
  },
  poll: async (session, entry) => {
    const child = split(entry.jobId ?? "");
    const definition = child.adapter.operations.find(operation => `${child.service.toUpperCase()} · ${operation.label}` === entry.operation);
    if (!definition || !child.adapter.poll) throw new ManagementInputError("This workflow has no verified native progress check.");
    const selected = nativeResource(child.service, entry.resourceId ? { id: entry.resourceId, name: entry.resourceName ?? entry.resourceId } : undefined);
    const outcome = await child.adapter.poll(session, { ...entry, service: child.service, operation: definition.label, resourceId: selected?.id, jobId: child.id });
    return { ...outcome, ...(outcome.resourceId ? { resourceId: prefix(child.service, outcome.resourceId) } : {}) };
  },
  invalidationKeys: resource => {
    if (resource) {
      const child = split(resource.id);
      return [...new Set([cloudCacheKeys.listMgcMigrationItems, ...child.adapter.invalidationKeys(nativeResource(child.service, resource))])];
    }
    return [...new Set([cloudCacheKeys.listMgcMigrationItems, ...Object.values(children).flatMap(adapter => adapter.invalidationKeys())])];
  },
};
