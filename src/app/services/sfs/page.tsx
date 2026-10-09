import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  FolderTree,
  HardDrive,
  Lock,
  Network,
} from "lucide-react";

import {
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  AccentStatGrid,
  ConsoleCard,
  ConsoleCallout,
  ConsolePageHeader,
  ConsoleMutedText,
  ConsolePanel,
  ConsoleResponsiveGrid,
  DataFreshnessText,
  InlineStatList,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import {
  CreateSfsShareButton,
} from "@/components/sfs-share-actions";
import { formatBytes, SfsSharesTable } from "@/components/sfs-shares-table";
import { getCurrentSession, getSessionProjects } from "@/lib/auth-session";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";
import type { BetterUiSession } from "@/lib/auth-session";

export const metadata: Metadata = {
  title: "SFS | Huawei Cloud Better UI",
};

type SfsShare = {
  availabilityZone: string;
  createdAt: string;
  description: string;
  exportLocation: string;
  host: string;
  id: string;
  isPublic: boolean;
  metadata: Record<string, string>;
  name: string;
  projectId: string;
  projectName: string;
  protocol: string;
  region: string;
  shareType: string;
  sizeGb: number;
  status: string;
  updatedAt: string;
  usedBytes: number;
};

type ListSfsShares = (session: BetterUiSession) => Promise<SfsShare[]>;

const listSfsShares =
  (huaweiCloud as typeof huaweiCloud & { listSfsShares?: ListSfsShares })
    .listSfsShares ??
  (async () => {
    throw new Error(
      "listSfsShares is not exported from @/lib/huawei-cloud yet.",
    );
  });

export default async function SfsPage() {
  const session = await getCurrentSession();
  const result = await withCloudResult<SfsShare[]>([], listSfsShares, cloudCacheKeys.listSfsShares);
  const shares = result.data;
  const totalGb = shares.reduce((total, share) => total + share.sizeGb, 0);
  const usedBytes = shares.reduce((total, share) => total + share.usedBytes, 0);
  const available = shares.filter(
    (share) => share.status.toLowerCase() === "available",
  ).length;
  const withExports = shares.filter((share) => share.exportLocation !== "-").length;
  const protocols = new Set(shares.map((share) => share.protocol).filter(Boolean));
  const projects =
    session
      ? getSessionProjects(session).map((project) => ({
          label: `${project.projectName || project.projectId} · ${project.region}`,
          value: project.projectId,
        }))
      : [];

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <CreateSfsShareButton projects={projects} />
            <RefreshButton />
            </>
          }
          backHref="/services/storage"
          backLabel="Back to Storage"
          description="Shared file systems, export paths, protocols, capacity, and availability zones."
          icon={FolderTree}
          iconClassName="bg-[#e9f8f1] text-[#16a34a]"
          title="Scalable File Service"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <ConsoleResponsiveGrid variant="lg-1.1-0.9">
          <ConsoleCard>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black">Fleet capacity</h2>
                <ConsoleMutedText className="mt-1" weight="semibold">
                  {shares.length} file systems · {Math.round(totalGb)} GB provisioned
                </ConsoleMutedText>
              </div>
              <HardDrive className="size-6 text-[#16a34a]" />
            </div>
            <AccentStatGrid
              className="mt-5"
              items={[
                {
                  accentClassName: "border-[#16a34a]",
                  label: "Available",
                  value: available,
                },
                {
                  label: "Used",
                  value: formatBytes(usedBytes),
                },
                {
                  accentClassName: "border-[#9333ea]",
                  label: "Protocols",
                  value: protocols.size,
                },
              ]}
            />
          </ConsoleCard>

          <ConsoleCard>
            <h2 className="text-lg font-black">Mount readiness</h2>
            <InlineStatList
              className="mt-4"
              items={[
                {
                  icon: Network,
                  label: "NFS shares",
                  value: shares.filter((share) => share.protocol === "NFS").length,
                },
                {
                  icon: FolderTree,
                  iconClassName: "text-[#16a34a] dark:text-[#86efac]",
                  label: "Export path returned",
                  value: withExports,
                },
                {
                  icon: Lock,
                  iconClassName: "text-[#9333ea] dark:text-[#c4b5fd]",
                  label: "Needs access rules before mount",
                  value: shares.length,
                },
              ]}
            />
          </ConsoleCard>
        </ConsoleResponsiveGrid>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${shares.length} shares`}
              updatedAt={result.updatedAt}
            />
          }
          title="File systems"
        >
          <SfsSharesTable shares={shares} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
