"use client";

import Link from "next/link";
import { Download, FileText, FolderOpen } from "lucide-react";

import { ConsoleLinkButton, ConsoleMonoText, ConsoleMutedText } from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { LocalDateTime } from "@/components/local-date-time";
import { DeleteObsBucketButton, DeleteObsObjectButton } from "@/components/obs-object-actions";
import type { ObsBucket, ObsObject } from "@/lib/huawei-cloud";

export function ObsBucketSearchTable({ buckets }: { buckets: ObsBucket[] }) {
  const columns: DataTableColumn<ObsBucket>[] = [
    {
      cell: (bucket) => (
        <Link
          className="inline-flex items-center gap-2 font-black text-[#2563eb] hover:underline"
          href={`/services/obs/${encodeURIComponent(bucket.name)}`}
        >
          <FolderOpen className="size-4" />
          {bucket.name}
        </Link>
      ),
      header: "Bucket",
    },
    {
      cell: (bucket) => bucket.location,
      header: "Location",
    },
    {
      cell: (bucket) => bucket.type,
      header: "Type",
    },
    {
      cell: (bucket) => bucket.storageClass,
      header: "Storage class",
    },
    {
      cell: (bucket) => <LocalDateTime value={bucket.createdAt} />,
      header: "Created",
    },
    {
      cell: (bucket) => <DeleteObsBucketButton bucket={bucket.name} small />,
      header: "Actions",
    },
  ];

  if (!buckets.length) {
    return null;
  }

  return (
    <DataTable
      columns={columns}
      emptyState={
        <div>
          <p className="text-lg font-black">No matching buckets</p>
          <ConsoleMutedText className="mt-2" weight="semibold">
            Try another bucket name, region, type, or storage class.
          </ConsoleMutedText>
        </div>
      }
      getRowKey={(bucket) => bucket.name}
      getSearchText={(bucket) =>
        [bucket.name, bucket.location, bucket.type, bucket.storageClass, bucket.createdAt].join(" ")
      }
      items={buckets}
      searchPlaceholder="Search buckets by name, region, type..."
      tableMinWidthClassName="min-w-[980px]"
    />
  );
}

export function ObsObjectSearchTable({
  bucketName,
  objects,
  prefix = "",
}: {
  bucketName: string;
  objects: ObsObject[];
  prefix?: string;
}) {
  const columns: DataTableColumn<ObsObject>[] = [
    {
      cell: (object) => (
        <Link
          className="flex items-center gap-2 font-black text-[#2563eb] hover:underline"
          href={`/services/obs/${encodeURIComponent(bucketName)}/objects?key=${encodeURIComponent(object.key)}`}
        >
          <FileText className="size-4 text-[#2563eb]" />
          <span className="break-all">{object.key}</span>
        </Link>
      ),
      header: "Object key",
    },
    {
      cell: (object) => object.size,
      header: "Size",
    },
    {
      cell: (object) => object.storageClass,
      header: "Storage class",
    },
    {
      cell: (object) => (
        <ConsoleMonoText>{object.etag}</ConsoleMonoText>
      ),
      header: "ETag",
    },
    {
      cell: (object) => <LocalDateTime value={object.lastModified} />,
      header: "Last modified",
    },
    {
      cell: (object) => (
        <>
          <ConsoleLinkButton
            href={`/api/cloud/obs/objects?bucket=${encodeURIComponent(bucketName)}&key=${encodeURIComponent(object.key)}`}
            size="sm"
            variant="neutral"
          >
            <Download className="size-3.5" />
            Download
          </ConsoleLinkButton>
          <div className="mt-2">
            <DeleteObsObjectButton
              bucket={bucketName}
              objectKey={object.key}
              redirectTo={`/services/obs/${encodeURIComponent(bucketName)}${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""}`}
              small
            />
          </div>
        </>
      ),
      header: "Actions",
    },
  ];

  if (!objects.length) {
    return null;
  }

  return (
    <DataTable
      columns={columns}
      emptyState={
        <div>
          <p className="text-lg font-black">No matching objects</p>
          <ConsoleMutedText className="mt-2" weight="semibold">
            Try another key, storage class, ETag, or date.
          </ConsoleMutedText>
        </div>
      }
      getRowKey={(object) => object.key}
      getSearchText={(object) =>
        [object.key, object.size, object.storageClass, object.etag, object.lastModified, object.owner].join(" ")
      }
      items={objects}
      searchPlaceholder="Search objects by key, size, ETag..."
      tableMinWidthClassName="min-w-[980px]"
    />
  );
}
