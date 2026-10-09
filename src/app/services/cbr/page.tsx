import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  ArchiveRestore,
  Bell,
  Database,
  DatabaseBackup,
  FileClock,
  LockKeyhole,
  Server,
  ShieldCheck,
  Tag,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CbrVaultActions } from "@/components/cbr-vault-actions";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  CellStack,
  CompactInfoCardGrid,
  ConsoleCallout,
  ConsoleEmptyPanelBody,
  ConsoleFramedTable,
  ConsoleMutedText,
  ConsolePageHeader,
  ConsolePanel,
  ConsolePill,
  ConsoleSectionHeader,
  ConsoleSplitLayout,
  ConsoleSubPanel,
  ConsoleSurface,
  DataFreshnessText,
  InfoPill,
  MetricCard,
  MetricGrid,
  ResourceIdentity,
  StatusBadge,
  UsageMeter,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import { listCbrVaults, withCloudResult, type CbrVault } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CBR | Huawei Cloud Better UI",
};

function objectTypeLabel(value: string) {
  const labels: Record<string, string> = {
    disk: "EVS disk backup",
    file: "File backup",
    rds: "RDS backup",
    server: "Server backup",
    turbo: "SFS Turbo backup",
    vmware: "VMware backup",
    workspace: "Workspace backup",
  };

  return labels[value] ?? (value || "-");
}

function resourceTypeLabel(value: string) {
  const labels: Record<string, string> = {
    "OS::Cinder::Volume": "EVS disk",
    "OS::Ironic::BareMetalServer": "BMS",
    "OS::Nova::Server": "ECS",
    "OS::Sfs::Turbo": "SFS Turbo",
    "OS::Workspace::DesktopV2": "Workspace",
  };

  return labels[value] ?? (value || "-");
}

function boolLabel(value: boolean) {
  return value ? "Enabled" : "Disabled";
}

function formatGb(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  return `${value.toLocaleString()} GB`;
}

function VaultStatus({ status }: { status: string }) {
  return <StatusBadge status={status || "UNKNOWN"} />;
}

function VaultCard({ vault }: { vault: CbrVault }) {
  const usage =
    vault.sizeGb > 0
      ? Math.min(100, Math.round((vault.allocatedGb / vault.sizeGb) * 100))
      : 0;

  return (
    <ConsoleSurface
      actions={
        <>
          <CbrVaultActions
            vault={{
              allocatedGb: vault.allocatedGb,
              autoExpand: vault.autoExpand,
              chargingMode: vault.chargingMode,
              id: vault.id,
              name: vault.name,
              projectId: vault.projectId,
              sizeGb: vault.sizeGb,
              smnNotify: vault.smnNotify,
              status: vault.status,
              threshold: vault.threshold,
            }}
          />
          <DisabledCloudButton title="Manual backup creation is intentionally not enabled until checkpoint options are modeled for each resource type.">
            <DatabaseBackup className="size-4" />
            Backup
          </DisabledCloudButton>
        </>
      }
      description={
        <>
          <span className="block break-all text-xs font-semibold text-[#98a2b3]">
            {vault.id}
          </span>
          <span className="mt-2 block text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
            {vault.description || "No vault description returned."}
          </span>
        </>
      }
      status={
        <div className="flex flex-wrap items-center gap-2">
            <VaultStatus status={vault.status} />
            {vault.locked ? (
              <ConsolePill icon={<LockKeyhole className="size-3.5" />} tone="warn">
                Locked
              </ConsolePill>
            ) : null}
        </div>
      }
      title={vault.name}
    >

      <ConsoleSplitLayout className="gap-5 p-5" order="sidebar-main">
        <div className="grid gap-4 content-start">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm font-black">
              <span>Capacity</span>
              <span>{usage}% allocated</span>
            </div>
            <UsageMeter percent={usage}>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p className="font-bold text-[#667085]">
                  Allocated
                  <span className="block font-black text-[#101828]">
                    {formatGb(vault.allocatedGb)}
                  </span>
                </p>
                <p className="font-bold text-[#667085]">
                  Vault size
                  <span className="block font-black text-[#101828]">
                    {formatGb(vault.sizeGb)}
                  </span>
                </p>
              </div>
            </UsageMeter>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <InfoPill
              icon={<Server className="size-4" />}
              label="Protection"
              value={objectTypeLabel(vault.objectType)}
            />
            <InfoPill
              icon={<Database className="size-4" />}
              label="Billing"
              value={vault.chargingMode}
            />
            <InfoPill
              icon={<Bell className="size-4" />}
              label="SMN"
              value={`${boolLabel(vault.smnNotify)} / ${vault.threshold ?? "-"}%`}
            />
            <InfoPill
              icon={<LockKeyhole className="size-4" />}
              label="Auto settings"
              value={`Bind ${boolLabel(vault.autoBind)} / Expand ${boolLabel(vault.autoExpand)}`}
            />
          </div>

          <ConsoleSubPanel contentClassName="grid gap-1 p-3 text-xs font-semibold text-[#667085] dark:text-[#98a2b3]" title="Vault metadata">
            <p>Project: {vault.projectName || vault.projectId}</p>
            <p>Region: {vault.region}</p>
            <p>Enterprise project: {vault.enterpriseProjectId}</p>
            <p>Consistency: {vault.consistentLevel}</p>
            <p>Spec: {vault.specCode}</p>
            <p>
              Created: <LocalDateTime value={vault.createdAt} />
            </p>
          </ConsoleSubPanel>
        </div>

        <div className="grid gap-5">
          <section>
            <ConsoleSectionHeader
              actions={`${vault.resources.length} resources`}
              title="Associated resources"
            />
            <ConsoleFramedTable
              columns={[
                { header: "Resource" },
                { header: "Type" },
                { header: "Protect status" },
                { header: "Size" },
                { header: "Extra" },
              ]}
              emptyState={
                <ConsoleMutedText weight="semibold">
                  No resources are associated with this vault.
                </ConsoleMutedText>
              }
              minWidthClassName="min-w-[720px]"
              rows={vault.resources.map((resource) => ({
                cells: [
                  <ResourceIdentity
                    id={resource.id}
                    key="resource"
                    name={resource.name}
                  />,
                  resourceTypeLabel(resource.type),
                  <VaultStatus key="status" status={resource.protectStatus} />,
                  formatGb(resource.sizeGb),
                  resource.extraInfo.length
                    ? resource.extraInfo
                        .slice(0, 2)
                        .map((item) => `${item.key}: ${item.value}`)
                        .join(", ")
                    : "-",
                ],
                key: resource.id,
              }))}
            />
          </section>

          <section>
            <ConsoleSectionHeader
              actions={`${vault.backupCount} backups`}
              title="Recent backups"
            />
            <ConsoleFramedTable
              columns={[
                { header: "Backup" },
                { header: "Status" },
                { header: "Resource" },
                { header: "Mode" },
                { header: "Protected" },
              ]}
              emptyState={
                <ConsoleMutedText weight="semibold">
                  No backups were returned for this vault.
                </ConsoleMutedText>
              }
              minWidthClassName="min-w-[760px]"
              rows={vault.backups.map((backup) => ({
                cells: [
                  <ResourceIdentity
                    id={backup.id}
                    key="backup"
                    name={backup.name}
                  />,
                  <VaultStatus key="status" status={backup.status} />,
                  (
                    <CellStack
                      key="resource"
                      subValue={`${resourceTypeLabel(backup.resourceType)} · ${formatGb(backup.resourceSizeGb)}`}
                    >
                      {backup.resourceName}
                    </CellStack>
                  ),
                  `${backup.incremental ? "Incremental" : "Full"} · ${
                    backup.autoTriggered ? "Auto" : "Manual"
                  }`,
                  <LocalDateTime key="protected" value={backup.protectedAt || backup.createdAt} />,
                ],
                key: backup.id,
              }))}
            />
          </section>

          <CompactInfoCardGrid
            items={[
              {
                body: vault.policies.length
                  ? vault.policies.map((policy) => policy.name).join(", ")
                  : "No policy returned.",
                icon: FileClock,
                title: "Policies",
              },
              {
                body: vault.tags.length
                  ? vault.tags.map((tag) => `${tag.key}=${tag.value}`).join(", ")
                  : "No tags returned.",
                icon: Tag,
                title: "Tags",
              },
            ]}
          />
        </div>
      </ConsoleSplitLayout>
    </ConsoleSurface>
  );
}

export default async function CbrPage() {
  const result = await withCloudResult<CbrVault[]>([], listCbrVaults, cloudCacheKeys.listCbrVaults);
  const vaults = result.data;
  const available = vaults.filter(
    (vault) => vault.status.toLowerCase() === "available",
  ).length;
  const resources = vaults.reduce(
    (total, vault) => total + vault.resources.length,
    0,
  );
  const backups = vaults.reduce((total, vault) => total + vault.backupCount, 0);
  const allocatedGb = vaults.reduce((total, vault) => total + vault.allocatedGb, 0);
  const sizeGb = vaults.reduce((total, vault) => total + vault.sizeGb, 0);
  const objectTypes = new Set(vaults.map((vault) => vault.objectType).filter(Boolean));

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title="Vault creation is disabled in this read-only view.">
              <DatabaseBackup className="size-4" />
              Create vault
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/services/storage"
          backLabel="Back to Storage"
          description="Vault capacity, policies, protected resources, recent backups, and safe vault settings."
          icon={ArchiveRestore}
          title="Cloud Backup and Recovery"
        />

        {result.error ? (
          <ConsoleCallout>{result.error}</ConsoleCallout>
        ) : null}

        <MetricGrid className="gap-3">
          {[
            ["Vaults", vaults.length],
            ["Available", available],
            ["Protected resources", resources],
            ["Backups", backups],
            ["Object types", objectTypes.size],
            ["Allocated", formatGb(allocatedGb)],
            ["Total capacity", formatGb(sizeGb)],
          ].map(([label, value]) => (
            <MetricCard
              key={label}
              label={label}
              value={value}
              variant="compact"
            />
          ))}
        </MetricGrid>

        <div>
          <div className="mb-3">
            <h2 className="text-lg font-black">Vault inventory</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              <DataFreshnessText
                isCached={result.isCached}
                prefix={`${vaults.length} vaults`}
                updatedAt={result.updatedAt}
              />
            </p>
          </div>
          {vaults.length ? (
            <div className="grid gap-5">
              {vaults.map((vault) => (
                <VaultCard key={vault.id} vault={vault} />
              ))}
            </div>
          ) : (
            <ConsolePanel className="border-dashed">
              <ConsoleEmptyPanelBody icon={ShieldCheck} title="No CBR vaults found">
                No backup vaults were returned for this account, or this IAM
                user cannot list CBR vaults.
              </ConsoleEmptyPanelBody>
            </ConsolePanel>
          )}
        </div>
      </ConsoleMain>
    </ConsoleShell>
  );
}
