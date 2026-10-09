import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import {
  Boxes,
  ImageIcon,
  Lock,
  Share2,
  ShieldCheck,
} from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleCallout,
  ConsolePageHeader,
  ConsolePanel,
  DataFreshnessText,
  InlineStatList,
  MetricCard,
  MetricGrid,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { ImsImagesTable } from "@/components/ims-images-table";
import { listImages, withCloudResult } from "@/lib/huawei-cloud";
import type { ImsImage } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "IMS | Huawei Cloud Better UI",
};

export default async function ImsPage() {
  const result = await withCloudResult<ImsImage[]>([], listImages, cloudCacheKeys.listImages);
  const images = result.data;
  const active = images.filter(
    (image) => image.status.toLowerCase() === "active",
  ).length;
  const privateImages = images.filter(
    (image) => image.imageType === "private" || image.visibility === "private",
  ).length;
  const sharedImages = images.filter(
    (image) => image.imageType === "shared" || image.visibility === "shared",
  ).length;
  const publicImages = images.filter((image) => image.imageType === "gold").length;
  const protectedImages = images.filter((image) => image.isProtected).length;
  const osFamilies = new Set(images.map((image) => image.os).filter(Boolean));

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsolePageHeader
          actions={
            <>
            <DisabledCloudButton title="Image creation is disabled in this read-only view.">
              <ImageIcon className="size-4" />
              Create image
            </DisabledCloudButton>
            <DisabledCloudButton title="Image sharing is disabled in this read-only view.">
              <Share2 className="size-4" />
              Share image
            </DisabledCloudButton>
            <RefreshButton />
            </>
          }
          backHref="/services/compute"
          backLabel="Back to Compute"
          description="Private, shared, public, and KooGallery image catalog with launch requirements and protected actions."
          icon={ImageIcon}
          title="Image Management Service"
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid className="gap-3">
          <MetricCard icon={ImageIcon} label="Images" value={images.length} variant="compact" />
          <MetricCard icon={ShieldCheck} iconClassName="bg-[#f0fdf4] text-[#166534]" label="Active" value={active} variant="compact" />
          <MetricCard icon={Lock} iconClassName="bg-[#fff7ed] text-[#c2410c]" label="Private" value={privateImages} variant="compact" />
          <MetricCard icon={Boxes} iconClassName="bg-[#eef4ff] text-[#2563eb]" label="Public" value={publicImages} variant="compact" />
          <MetricCard icon={ImageIcon} iconClassName="bg-[#f5f3ff] text-[#7c3aed]" label="OS families" value={osFamilies.size} variant="compact" />
        </MetricGrid>

        <ConsolePanel>
          <InlineStatList
            columns={3}
            items={[
              {
                icon: Boxes,
                label: "Shared images",
                value: sharedImages,
              },
              {
                icon: Lock,
                iconClassName: "text-[#9333ea] dark:text-[#c4b5fd]",
                label: "Protected images",
                value: protectedImages,
              },
              {
                icon: ShieldCheck,
                iconClassName: "text-[#16a34a] dark:text-[#86efac]",
                label: "KVM-ready images",
                value: images.filter((image) => image.supportKvm === "true").length,
              },
            ]}
          />
        </ConsolePanel>

        <ConsolePanel
          description={
            <DataFreshnessText
              isCached={result.isCached}
              prefix={`${images.length} images`}
              updatedAt={result.updatedAt}
            />
          }
          title="Images"
        >
          <ImsImagesTable images={images} />
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
