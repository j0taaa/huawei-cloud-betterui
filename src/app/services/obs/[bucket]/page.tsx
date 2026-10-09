import { CloudErrorPage } from "@/components/cloud-error";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Box, Database, FileText, Folder, HardDrive, Layers3 } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleCallout,
  ConsoleEmptyPanelBody,
  ConsolePanel,
  ConsoleResourceLink,
  DataFreshnessText,
  MetricCard,
  MetricGrid,
  ResourceDetailHero,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import {
  CreateObsFolderButton,
  DeleteObsBucketButton,
  UploadObsObjectButton,
} from "@/components/obs-object-actions";
import { ObsObjectSearchTable } from "@/components/obs-search-tables";
import { getObsBucket, type ObsBucketDetail, withCloudResult } from "@/lib/huawei-cloud";

export default async function ObsBucketPage({
  params,
  searchParams,
}: {
  params: Promise<{ bucket: string }>;
  searchParams: Promise<{ prefix?: string }>;
}) {
  const { bucket } = await params;
  const { prefix = "" } = await searchParams;
  const result = await withCloudResult<ObsBucketDetail | null>(
    null,
    (session) => getObsBucket(session, bucket, prefix),
    `obs-bucket:${bucket}:${prefix}`,
  );
  if (!result.data && result.error) return <CloudErrorPage active="Storage" backHref="/services/obs" error={result.error} />;
  const detail = result.data;

  if (!detail) {
    notFound();
  }

  const parentPrefix = detail.currentPrefix.split("/").filter(Boolean).slice(0, -1).join("/");
  const parentHref = `/services/obs/${encodeURIComponent(detail.name)}${
    parentPrefix ? `?prefix=${encodeURIComponent(`${parentPrefix}/`)}` : ""
  }`;

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ResourceDetailHero
          actions={
            <>
            <CreateObsFolderButton bucket={detail.name} prefix={detail.currentPrefix} />
            <UploadObsObjectButton bucket={detail.name} prefix={detail.currentPrefix} />
            <DeleteObsBucketButton bucket={detail.name} redirectTo="/services/obs" />
            <RefreshButton />
            </>
          }
          backHref="/services/obs"
          backLabel="Back to OBS"
          description={
            <DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />
          }
          eyebrow="OBS bucket"
          icon={Box}
          iconClassName="bg-[#e9f8f1] text-[#16a34a]"
          title={detail.name}
        />

        {result.error ? <ConsoleCallout>{result.error}</ConsoleCallout> : null}

        <MetricGrid className="gap-3">
          <MetricCard icon={FileText} label="Objects here" value={detail.objects.length} variant="compact" />
          <MetricCard icon={Folder} iconClassName="bg-[#e9f8f1] text-[#16a34a]" label="Folders here" value={detail.commonPrefixes.length} variant="compact" />
          <MetricCard icon={HardDrive} iconClassName="bg-[#f5f3ff] text-[#7c3aed]" label="Listed size" value={detail.size} variant="compact" />
          <MetricCard icon={Database} iconClassName="bg-[#f8fafc] text-[#475467]" label="Region" value={detail.location} valueClassName="break-words" variant="compact" />
        </MetricGrid>

        {detail.currentPrefix ? (
          <ConsolePanel className="p-4 text-sm font-semibold text-[#344054] dark:text-[#cbd5e1]">
            <div className="flex flex-wrap items-center gap-2">
              <Layers3 className="size-4 text-[#2563eb]" />
              <ConsoleResourceLink href={`/services/obs/${encodeURIComponent(detail.name)}`}>
                {detail.name}
              </ConsoleResourceLink>
              <span>/</span>
              <span className="break-all">{detail.currentPrefix}</span>
              <ConsoleResourceLink className="ml-auto" href={parentHref}>
                Up one level
              </ConsoleResourceLink>
            </div>
          </ConsolePanel>
        ) : null}

        {detail.commonPrefixes.length ? (
          <ConsolePanel className="p-5">
            <h2 className="text-lg font-black text-[#101828] dark:text-white">Folders</h2>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {detail.commonPrefixes.map((folderPrefix) => (
                <Link
                  className="flex items-center gap-2 rounded-lg bg-[#f7f9fc] px-3 py-2 text-sm font-bold text-[#344054] hover:bg-[#eef4ff]"
                  href={`/services/obs/${encodeURIComponent(detail.name)}?prefix=${encodeURIComponent(folderPrefix)}`}
                  key={folderPrefix}
                >
                  <Folder className="size-4 text-[#2563eb]" />
                  <span className="break-all">
                    {folderPrefix.slice(detail.currentPrefix.length) || folderPrefix}
                  </span>
                </Link>
              ))}
            </div>
          </ConsolePanel>
        ) : null}

        <ConsolePanel
          description={`Showing up to 1,000 objects at this level${detail.isTruncated ? "; more objects exist" : ""}.`}
          title="Objects"
        >
          {detail.objects.length ? (
            <ObsObjectSearchTable
              bucketName={detail.name}
              objects={detail.objects}
              prefix={detail.currentPrefix}
            />
          ) : (
            <ConsoleEmptyPanelBody icon={FileText} title="No objects found">
              This bucket is empty or the current credentials cannot list objects.
            </ConsoleEmptyPanelBody>
          )}
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
