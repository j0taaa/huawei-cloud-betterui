import { ObsObjectDetails, Preview } from "@/components/obs-object-detail";
import { CloudErrorPage } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleCallout,
  ConsoleDetailHeader,
  ConsoleLinkButton,
  ConsoleMain,
  ConsoleSplitLayout,
  DataFreshnessText,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { DeleteObsObjectButton } from "@/components/obs-object-actions";
import { getObsObjectDetail, type ObsObjectDetail, withCloudResult } from "@/lib/huawei-cloud";

export default async function ObsObjectPage({
  params,
}: {
  params: Promise<{ bucket: string; key: string[] }>;
}) {
  const { bucket, key } = await params;
  const objectKey = key.join("/");
  const result = await withCloudResult<ObsObjectDetail | null>(
    null,
    (session) => getObsObjectDetail(session, bucket, objectKey),
    `obs-object:${bucket}:${objectKey}`,
  );
  if (!result.data && result.error) return <CloudErrorPage active="Storage" backHref="/services/obs" error={result.error} />;
  const object = result.data;

  if (!object) {
    notFound();
  }

  const downloadUrl = `/api/cloud/obs/objects?bucket=${encodeURIComponent(object.bucket)}&key=${encodeURIComponent(object.key)}`;

  return (
    <ConsoleShell active="Storage">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ConsoleDetailHeader
          actions={
            <>
              <ConsoleLinkButton href={downloadUrl} size="md">
                <Download className="size-4" />
                Download
              </ConsoleLinkButton>
              <DeleteObsObjectButton
                bucket={object.bucket}
                objectKey={object.key}
                redirectTo={`/services/obs/${encodeURIComponent(object.bucket)}`}
              />
              <RefreshButton />
            </>
          }
          backHref={`/services/obs/${encodeURIComponent(object.bucket)}`}
          backLabel="Back to bucket"
          description={<DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />}
          eyebrow="OBS object"
          icon={FileText}
          iconClassName="bg-[#e9f8f1] text-[#16a34a]"
          title={object.key}
          titleClassName="break-all"
        />

        {result.error ? (
          <ConsoleCallout>{result.error}</ConsoleCallout>
        ) : null}

        <ConsoleSplitLayout order="sidebar-main" sidebarWidth="380">
          <ObsObjectDetails object={object} />

          <Preview object={object} />
        </ConsoleSplitLayout>
      </ConsoleMain>
    </ConsoleShell>
  );
}
