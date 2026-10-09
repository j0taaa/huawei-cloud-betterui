"use client";

import { useMemo } from "react";
import { Cpu, HardDrive } from "lucide-react";

import {
  CellStack,
  EmptyContent,
  InlineIconText,
  ProjectRegionCell,
  ResourceIdentity,
  StatusBadge,
} from "@/components/console-ui";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DeleteImsImageButton } from "@/components/ims-image-actions";
import { LocalDateTime } from "@/components/local-date-time";
import type { ImsImage } from "@/lib/huawei-cloud";

export function imageTypeLabel(type: string) {
  const labels: Record<string, string> = {
    gold: "Public",
    market: "KooGallery",
    private: "Private",
    shared: "Shared",
  };

  return labels[type] ?? (type || "-");
}

function imageSearchText(image: ImsImage) {
  return [
    image.name,
    image.id,
    image.status,
    image.imageType,
    image.visibility,
    image.os,
    image.platform,
    image.osType,
    image.projectName,
    image.projectId,
    image.region,
  ]
    .filter(Boolean)
    .join(" ");
}

export function ImsImagesTable({ images }: { images: ImsImage[] }) {
  const columns = useMemo(
    (): DataTableColumn<ImsImage>[] => [
      {
        cell: (image) => (
          <ResourceIdentity
            href={`/services/ims/${image.id}?projectId=${encodeURIComponent(image.projectId)}`}
            id={image.id}
            name={image.name}
            scope={`${image.size} image size`}
          />
        ),
        header: "Image",
      },
      {
        cell: (image) => (
          <CellStack subValue={imageTypeLabel(image.imageType)}>
            <StatusBadge status={image.status || "UNKNOWN"} />
          </CellStack>
        ),
        header: "Status",
      },
      {
        cell: (image) => (
          <CellStack
            subValue={`${image.platform !== "-" ? image.platform : image.osType} platform`}
          >
            {image.os || "-"}
          </CellStack>
        ),
        className: "font-bold",
        header: "OS / platform",
      },
      {
        cell: (image) => (
          <div className="font-bold">
            <InlineIconText
              className="gap-2 text-sm font-bold text-[#101828] dark:text-white"
              icon={HardDrive}
              iconClassName="size-4 text-[#2563eb] dark:text-[#93c5fd]"
            >
              {image.minDisk} minimum disk
            </InlineIconText>
            <InlineIconText
              className="mt-2 gap-2"
              icon={Cpu}
              iconClassName="text-[#16a34a] dark:text-[#86efac]"
            >
              {image.minRam} minimum RAM
            </InlineIconText>
          </div>
        ),
        header: "Launch requirements",
      },
      {
        cell: (image) => (
          <CellStack
            subValue={image.isProtected ? "Protected" : "Not protected"}
          >
            {image.visibility} visibility
          </CellStack>
        ),
        className: "font-bold",
        header: "Access",
      },
      {
        cell: (image) => (
          <ProjectRegionCell
            projectId={image.projectId}
            projectName={image.projectName}
            region={image.region}
          />
        ),
        className: "font-bold",
        header: "Project / region",
      },
      {
        cell: (image) => <LocalDateTime value={image.createdAt} />,
        className: "font-bold",
        header: "Created",
      },
      {
        cell: (image) => (
          <div className="text-right">
            <DeleteImsImageButton
              imageId={image.id}
              imageName={image.name}
              imageType={image.imageType}
              isProtected={image.isProtected}
              projectId={image.projectId}
              status={image.status}
              visibility={image.visibility}
            />
          </div>
        ),
        header: "Actions",
        headerClassName: "text-right",
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      emptyState={<EmptyContent title="No IMS images found" />}
      getRowKey={(image) => `${image.region}:${image.id}`}
      getSearchText={imageSearchText}
      items={images}
      searchPlaceholder="Search images"
      tableMinWidthClassName="min-w-[1240px]"
    />
  );
}
