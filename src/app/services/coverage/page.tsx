import Link from "next/link";
import { ListChecks } from "lucide-react";
import { ConsoleShell } from "@/components/console-shell";
import { ConsoleMain, ConsolePageHeader, ConsolePanel, SimpleTable, StatusBadge } from "@/components/console-ui";
import { getServiceCoverage } from "@/lib/huawei/management/coverage";

export default function ServiceCoveragePage() {
  const coverage = getServiceCoverage();
  return <ConsoleShell active="Dashboard"><ConsoleMain><ConsolePageHeader backHref="/" backLabel="Back to dashboard" title="Service coverage" icon={ListChecks} description={`All ${coverage.length} catalog services are tracked here. Coverage is partial until each service's lifecycle, configuration, policy, observability, and task workflows have been verified.`} />
    <ConsolePanel title="Available workflows and remaining coverage"><SimpleTable columns={[{ header: "Service" }, { header: "Coverage" }, { header: "Available workflows" }, { header: "Remaining console areas" }]} emptyState="No services in the catalog." rows={coverage.map((item) => ({ key: item.catalogId, cells: [<div key="service"><p className="font-bold">{item.inventoryHref ? <Link className="text-[#2563eb]" href={item.inventoryHref}>{item.name}</Link> : item.name}</p><p className="mt-1 text-xs text-[#667085]">{item.category}</p>{item.managementHref ? <Link className="mt-2 inline-block text-xs font-bold text-[#2563eb]" href={item.managementHref}>Open management</Link> : null}</div>, <StatusBadge key="status" tone="warn">{item.status}</StatusBadge>, <div key="workflows" className="max-w-md text-xs leading-6">{item.workflows.length ? item.workflows.join(" · ") : item.inventoryHref ? "Resource inventory" : "No resource workspace yet"}</div>, <div key="remaining" className="max-w-md text-xs leading-6">{item.remaining.join(" · ")}</div>] }))} /></ConsolePanel>
  </ConsoleMain></ConsoleShell>;
}
