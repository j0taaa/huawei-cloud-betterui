import { ArchiveRestore } from "lucide-react";
import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/console-shell";
import { ConsoleMain, ConsolePageHeader, ConsolePanel, ConsolePanelBody, FieldGrid, SimpleTable } from "@/components/console-ui";
import { CloudErrorBanner } from "@/components/cloud-error";
import { listCbrVaults, type CbrVault } from "@/lib/huawei/services/cbr";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { withCloudResult } from "@/lib/huawei/result";
import { getCurrentSession, getSessionProjects } from "@/lib/auth-session";
import { CbrVaultActions } from "@/components/cbr-vault-actions";

export default async function VaultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ projectId?: string }> }) {
  const { id } = await params;
  const { projectId } = await searchParams;
  const session = await getCurrentSession();
  if (session && projectId && !getSessionProjects(session).some((project) => project.projectId === projectId)) notFound();
  const result = await withCloudResult<CbrVault[]>([], listCbrVaults, cloudCacheKeys.listCbrVaults);
  const vault = result.data.find((item) => item.id === id && (!projectId || item.projectId === projectId));
  if (!vault && !result.error) notFound();
  return <ConsoleShell active="Storage"><ConsoleMain><ConsolePageHeader title={vault?.name ?? "Vault unavailable"} icon={ArchiveRestore} backHref="/services/cbr" backLabel="Back to backups" description="Vault capacity, protected resources, backup history, and policy relationships." actions={vault ? <CbrVaultActions vault={vault} /> : undefined} />
    <CloudErrorBanner error={result.error} />
    {vault ? <><ConsolePanel title="Vault"><ConsolePanelBody><FieldGrid items={[{ label: "ID", value: vault.id }, { label: "Project", value: `${vault.projectName} / ${vault.region}` }, { label: "Status", value: vault.status }, { label: "Capacity", value: `${vault.usedGb} / ${vault.sizeGb} GB` }, { label: "Backup type", value: `${vault.objectType} / ${vault.protectType}` }, { label: "Billing", value: vault.chargingMode }, { label: "Enterprise project", value: vault.enterpriseProjectId }, { label: "Policies", value: vault.policies.map((policy) => `${policy.name} (${policy.id})`).join(", ") || "No bound policy" }]} /></ConsolePanelBody></ConsolePanel>
    <ConsolePanel title="Protected resources"><SimpleTable columns={[{ header: "Resource" }, { header: "Type" }, { header: "Status" }, { header: "Size" }]} emptyState="No resources are bound to this vault." rows={vault.resources.map((resource) => ({ key: resource.id, cells: [<div key="resource">{resource.name}<p className="text-xs text-[#667085]">{resource.id}</p></div>, resource.type, resource.protectStatus, `${resource.sizeGb} GB`] }))} /></ConsolePanel>
    <ConsolePanel title="Backups"><SimpleTable columns={[{ header: "Backup" }, { header: "Resource" }, { header: "State" }, { header: "Created" }, { header: "Expiry" }]} emptyState="No backups were returned for this vault." rows={vault.backups.map((backup) => ({ key: backup.id, cells: [<div key="backup">{backup.name}<p className="text-xs text-[#667085]">{backup.id}</p></div>, backup.resourceName || backup.resourceId, backup.status, backup.createdAt, backup.expiredAt] }))} /></ConsolePanel>
    </> : null}
  </ConsoleMain></ConsoleShell>;
}
