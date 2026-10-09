import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { GitBranch } from "lucide-react";

import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import {
  listCodeArtsRepositories,
  type CodeArtsRepository,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "CodeArts Repo | Huawei Cloud Better UI",
};

const columns: InventoryColumn<CodeArtsRepository>[] = [
  {
    header: "Repository",
    render: (repo) => (
      <ResourceIdentity id={repo.id} name={repo.name} />
    ),
  },
  { header: "Default branch", render: (repo) => repo.defaultBranch },
  { header: "Visibility", render: (repo) => <InventoryStatus>{repo.visibility}</InventoryStatus> },
  { header: "Web URL", render: (repo) => <span className="break-all">{repo.webUrl}</span> },
  { header: "SSH URL", render: (repo) => <span className="break-all">{repo.sshUrl}</span> },
  { header: "Project", render: (repo) => `${repo.projectName} / ${repo.region}` },
];

export default async function CodeArtsRepoPage() {
  const result = await withCloudResult<CodeArtsRepository[]>([], listCodeArtsRepositories, cloudCacheKeys.listCodeArtsRepositories);
  const repositories = result.data;
  const branches = new Set(repositories.map((repo) => repo.defaultBranch).filter((branch) => branch !== "-"));
  const linked = repositories.filter((repo) => repo.webUrl !== "-").length;

  return (
    <ServiceInventoryPage
      managementService="codearts-repo"
      actionLabel="Create repository"
      actionTitle="Repository creation is disabled in this read-only view."
      active="Compute"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="Project repositories, default branches, clone URLs, visibility, and project placement from CodeArts Repo."
      empty="No CodeArts repositories were returned for the selected projects."
      icon={GitBranch}
      result={result}
      rows={repositories}
      stats={[
        { label: "Repositories", value: repositories.length },
        { label: "Default branches", value: branches.size },
        { label: "With web URLs", value: linked },
        { label: "Projects", value: new Set(repositories.map((repo) => repo.projectId)).size },
      ]}
      tableTitle="Repository inventory"
      title="CodeArts Repo"
    />
  );
}
