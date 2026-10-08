import type { Metadata } from "next";
import Link from "next/link";
import { Code2 } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import {
  listSwrRepositories,
  withCloudResult,
  type SwrRepository,
} from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { formatBytes } from "@/lib/huawei/parsers";
import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "../_components/service-inventory";

export const metadata: Metadata = { title: "SWR | Huawei Cloud Better UI" };
const columns: InventoryColumn<SwrRepository>[] = [
  {
    header: "Repository",
    render: (repository) => (
      <>
        <Link
          className="font-black text-[#2563eb]"
          href={`/services/swr/${repository.id}`}
        >
          {repository.name}
        </Link>
        <p className="mt-1 text-xs text-[#667085]">{repository.description}</p>
      </>
    ),
  },
  { header: "Organization", render: (repository) => repository.namespace },
  {
    header: "Visibility",
    render: (repository) => (
      <InventoryStatus tone={repository.isPublic ? "warn" : "neutral"}>
        {repository.isPublic ? "Public" : "Private"}
      </InventoryStatus>
    ),
  },
  { header: "Images", render: (repository) => repository.imageCount },
  { header: "Size", render: (repository) => formatBytes(repository.size) },
  { header: "Downloads", render: (repository) => repository.downloads },
  { header: "Region", render: (repository) => repository.region },
  {
    header: "Updated",
    render: (repository) => <LocalDateTime value={repository.updatedAt} />,
  },
];

export default async function SwrPage() {
  const result = await withCloudResult<SwrRepository[]>(
    [],
    listSwrRepositories,
    cloudCacheKeys.listSwrRepositories,
  );
  const repositories = result.data;
  return (
    <ServiceInventoryPage
      active="Containers"
      backHref="/services/containers"
      backLabel="Back to containers"
      icon={Code2}
      title="Software Repository for Container"
      description="SWR Basic edition repositories across accessible regions. Open a repository to inspect its image tags and pull commands."
      result={result}
      rows={repositories}
      rowKey={(repository) => repository.id}
      columns={columns}
      tableTitle="Repositories"
      empty="No repositories found."
      stats={[
        { label: "Repositories", value: repositories.length },
        {
          label: "Organizations with repositories",
          value: new Set(
            repositories.map(
              (repository) => `${repository.region}:${repository.namespace}`,
            ),
          ).size,
        },
        {
          label: "Images",
          value: repositories.reduce(
            (sum, repository) => sum + repository.imageCount,
            0,
          ),
        },
        {
          label: "Public repositories",
          value: repositories.filter((repository) => repository.isPublic)
            .length,
        },
      ]}
    />
  );
}
