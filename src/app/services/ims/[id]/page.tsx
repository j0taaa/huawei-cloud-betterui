import { CloudErrorPage } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import {
  Cpu,
  HardDrive,
  ImageIcon,
  Lock,
  Server,
  ShieldCheck,
  Tag,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsolePanel,
  ConsoleResponsiveGrid,
  DataFreshnessText,
  FactGrid,
  FieldGrid,
  ResourceDetailHero,
  StatusBadge,
  TagList,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { DeleteImsImageButton } from "@/components/ims-image-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { getImage, withCloudResult } from "@/lib/huawei-cloud";
import type { ImsImage } from "@/lib/huawei-cloud";

type DetailItem = {
  label: string;
  value: React.ReactNode;
};

function imageTypeLabel(type: string) {
  const labels: Record<string, string> = {
    gold: "Public",
    market: "KooGallery",
    private: "Private",
    shared: "Shared",
  };

  return labels[type] ?? (type || "-");
}

export default async function ImsImagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const cacheKey = `ims-image:${id}:${query.projectId ?? "default"}`;
  const result = await withCloudResult<ImsImage | null>(
    null,
    (session) => getImage(session, id, query.projectId),
    cacheKey,
  );
  if (!result.data && result.error) return <CloudErrorPage active="Compute" backHref="/services/ims" error={result.error} />;
  const image = result.data;

  if (!image) notFound();

  const summary: DetailItem[] = [
    { label: "Status", value: image.status },
    { label: "Type", value: imageTypeLabel(image.imageType) },
    { label: "Visibility", value: image.visibility },
    { label: "Protected", value: image.isProtected ? "Yes" : "No" },
    { label: "Full-ECS image", value: image.isWholeImage ? "Yes" : "No" },
    { label: "Registered", value: image.isRegistered },
    { label: "Owner", value: image.owner },
    { label: "Project", value: `${image.projectName} / ${image.region}` },
    { label: "Created", value: <LocalDateTime value={image.createdAt} /> },
    { label: "Updated", value: <LocalDateTime value={image.updatedAt} /> },
  ];
  const requirements: DetailItem[] = [
    { label: "Minimum Disk", value: image.minDisk },
    { label: "Minimum RAM", value: image.minRam },
    { label: "Image Size", value: image.size },
    { label: "OS", value: image.os },
    { label: "OS Type", value: image.osType },
    { label: "OS Bit", value: image.osBit !== "-" ? `${image.osBit}-bit` : "-" },
    { label: "Platform", value: image.platform },
    { label: "Architecture", value: image.architecture },
  ];
  const formats: DetailItem[] = [
    { label: "Disk Format", value: image.diskFormat },
    { label: "Container Format", value: image.containerFormat },
    { label: "Virtualization", value: image.virtualEnvType },
    { label: "KVM Support", value: image.supportKvm },
    { label: "XEN Support", value: image.supportXen },
    { label: "Member Status", value: image.memberStatus },
    { label: "Enterprise Project", value: image.enterpriseProjectId },
    { label: "Checksum", value: image.checksum },
  ];
  const freshness = <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />;

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ResourceDetailHero
          actions={
            <>
              <DeleteImsImageButton
                imageId={image.id}
                imageName={image.name}
                imageType={image.imageType}
                isProtected={image.isProtected}
                projectId={image.projectId}
                status={image.status}
                visibility={image.visibility}
              />
              <RefreshButton />
            </>
          }
          backHref="/services/ims"
          backLabel="Back to IMS"
          description={freshness}
          eyebrow="IMS image"
          icon={ImageIcon}
          id={image.id}
          title={image.name}
        />

        <FactGrid
          className="xl:grid-cols-5"
          items={[
            { label: "Catalog", value: imageTypeLabel(image.imageType) },
            { label: "Status", value: <StatusBadge status={image.status} /> },
            { label: "OS", value: image.os },
            { label: "Minimum Disk", value: image.minDisk },
            { label: "Image Size", value: image.size },
          ]}
        />

        <ConsoleResponsiveGrid variant="lg-3">
          <ConsolePanel icon={Server} title="Image Summary">
            <FieldGrid items={summary} />
          </ConsolePanel>

          <ConsolePanel icon={Cpu} iconClassName="text-[#16a34a]" title="Launch Compatibility">
            <FieldGrid items={requirements} />
          </ConsolePanel>

          <ConsolePanel icon={HardDrive} iconClassName="text-[#9333ea]" title="Format and Metadata">
            <FieldGrid items={formats} />
          </ConsolePanel>
        </ConsoleResponsiveGrid>

        <ConsoleResponsiveGrid variant="lg-1.1-0.9">
          <ConsolePanel icon={Tag} title="Tags and Description">
            <div className="p-5">
            <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-[#475467]">
              {image.description || "No description set."}
            </p>
            <div className="mt-4">
              <TagList emptyState="No tags returned." items={image.tags} />
            </div>
            </div>
          </ConsolePanel>

          <ConsolePanel
            description="Delete is only available for unprotected private images and requires exact name confirmation."
            icon={ShieldCheck}
            iconClassName="text-[#039855]"
            title="Action Guardrails"
          >
            <div className="grid gap-3 p-5 text-sm font-bold text-[#344054]">
              <p className="inline-flex items-center gap-2">
                <Lock className="size-4 text-[#9333ea]" />
                Protected: {image.isProtected ? "yes" : "no"}
              </p>
              <p className="inline-flex items-center gap-2">
                <ImageIcon className="size-4 text-[#2563eb]" />
                Visibility: {image.visibility}
              </p>
            </div>
          </ConsolePanel>
        </ConsoleResponsiveGrid>
      </ConsoleMain>
    </ConsoleShell>
  );
}
