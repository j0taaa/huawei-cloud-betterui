import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Code2 } from "lucide-react";
import { CloudErrorPage } from "@/components/cloud-error";
import { LocalDateTime } from "@/components/local-date-time";
import {
  getSwrRepository,
  withCloudResult,
  type SwrRepositoryDetail,
  type SwrTag,
} from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { formatBytes } from "@/lib/huawei/parsers";
import {
  ResourceFacts,
  ServiceInventoryPage,
  type InventoryColumn,
} from "../../_components/service-inventory";

export const metadata: Metadata = {
  title: "SWR repository | Huawei Cloud Better UI",
};
const columns: InventoryColumn<SwrTag>[] = [
  { header: "Tag", render: (tag) => tag.name },
  {
    header: "Digest",
    render: (tag) => <code className="break-all text-xs">{tag.digest}</code>,
  },
  { header: "Size", render: (tag) => formatBytes(tag.size) },
  {
    header: "Pull command",
    render: (tag) =>
      tag.pullPath ? (
        <code className="break-all text-xs">docker pull {tag.pullPath}</code>
      ) : (
        "—"
      ),
  },
  {
    header: "Updated",
    render: (tag) => <LocalDateTime value={tag.updatedAt} />,
  },
];

export default async function SwrRepositoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult<SwrRepositoryDetail | null>(
    null,
    (session) => getSwrRepository(session, id),
    cloudCacheKeys.swrRepository(id),
  );
  if (!result.data) {
    if (result.error)
      return (
        <CloudErrorPage
          active="Containers"
          backHref="/services/swr"
          error={result.error}
        />
      );
    notFound();
  }
  const { repository, tags } = result.data;
  return (
    <ServiceInventoryPage
      active="Containers"
      backHref="/services/swr"
      backLabel="Back to SWR"
      icon={Code2}
      title={`${repository.namespace}/${repository.name}`}
      description={`${repository.region}${repository.description ? ` · ${repository.description}` : ""}`}
      result={result}
      rows={tags}
      rowKey={(tag) => tag.name}
      columns={columns}
      tableTitle="Image tags"
      empty="No image tags found."
      stats={[
        {
          label: "Visibility",
          value: repository.isPublic ? "Public" : "Private",
        },
        { label: "Tags", value: tags.length },
        { label: "Repository size", value: formatBytes(repository.size) },
        { label: "Downloads", value: repository.downloads },
      ]}
    >
      <ResourceFacts
        items={[
          { label: "Organization", value: repository.namespace },
          { label: "Repository ID", value: repository.repositoryId },
          { label: "Category", value: repository.category },
          {
            label: "Created",
            value: <LocalDateTime value={repository.createdAt} />,
          },
        ]}
      />
    </ServiceInventoryPage>
  );
}
