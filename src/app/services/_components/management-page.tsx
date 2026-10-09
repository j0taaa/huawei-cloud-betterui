import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/console-shell";
import { ServiceManagementWorkspace } from "@/components/service-management-workspace";
import { managementAdapters } from "@/lib/huawei/management/registry";
import { serviceCatalog, type ServiceCategory } from "@/lib/service-catalog";

export type ManagementSearch = Promise<{ projectId?: string | string[]; resourceId?: string | string[]; operation?: string | string[] }>;
export async function ManagementPageForService({ service, searchParams }: { service: string; searchParams: ManagementSearch }) {
  if (!Object.hasOwn(managementAdapters, service)) notFound();
  const query = await searchParams;
  const active = Object.entries(serviceCatalog).find(([, items]) => items.some((item) => item.href === `/services/${service}`))?.[0] as ServiceCategory | undefined;
  return <ConsoleShell active={active ?? "Compute"}><ServiceManagementWorkspace service={service} initialProjectId={typeof query.projectId === "string" ? query.projectId : undefined} initialResourceId={typeof query.resourceId === "string" ? query.resourceId : undefined} initialOperationId={typeof query.operation === "string" && managementAdapters[service].operations.some(operation => operation.id === query.operation) ? query.operation : undefined} /></ConsoleShell>;
}
