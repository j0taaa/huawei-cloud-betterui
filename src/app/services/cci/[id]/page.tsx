import { CloudErrorPage } from "@/components/cloud-error";
import { notFound } from "next/navigation";
import {
  Boxes,
  Container,
  FileKey,
  Layers3,
  Network,
  Tags,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleIconTile,
  ConsoleMutedText,
  ConsolePanel,
  ConsoleResponsiveGrid,
  DataFreshnessText,
  FactGrid,
  KeyValueGrid,
  MetricCard,
  MetricGrid,
  ResourceDetailHero,
  ResourceIdentity,
  SimpleTable,
  StatusBadge,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import { DeleteCciNamespaceButton } from "@/components/cci-namespace-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { getCciNamespace, type CciNamespace, withCloudResult } from "@/lib/huawei-cloud";

type DetailItem = {
  label: string;
  value: React.ReactNode;
};

function isHealthy(namespace: CciNamespace) {
  return (
    namespace.phase.toLowerCase() === "active" &&
    namespace.runningPods === namespace.podCount &&
    namespace.failedPods === 0
  );
}

export default async function CciNamespacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult(
    null,
    (session) => getCciNamespace(session, id),
    `cci-namespace:${id}`,
  );
  if (!result.data && result.error) return <CloudErrorPage active="Containers" backHref="/services/cci" error={result.error} />;
  const namespace = result.data;
  if (!namespace) notFound();
  const canDelete =
    namespace.podCount === 0 &&
    namespace.workloadCount === 0 &&
    namespace.serviceCount === 0 &&
    namespace.configMapCount === 0 &&
    namespace.secretCount === 0 &&
    !namespace.terminating;
  const details: DetailItem[] = [
    { label: "Phase", value: namespace.phase },
    { label: "Project", value: `${namespace.projectName} / ${namespace.region}` },
    { label: "Namespace ID", value: namespace.id },
    { label: "Created", value: <LocalDateTime value={namespace.createdAt} /> },
  ];

  return (
    <ConsoleShell active="Containers">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <ConsoleMain>
        <ResourceDetailHero
          actions={
            <>
              <DeleteCciNamespaceButton
                canDelete={canDelete}
                namespaceId={namespace.id}
                namespaceName={namespace.name}
                projectId={namespace.projectId}
                resourceSummary={`${namespace.podCount} pods, ${namespace.workloadCount} workloads, ${namespace.serviceCount} services`}
                variant="hero"
              />
              <RefreshButton />
            </>
          }
          backHref="/services/cci"
          backLabel="Back to CCI"
          description={<DataFreshnessText isCached={result.isCached} updatedAt={result.updatedAt} />}
          eyebrow="CCI namespace"
          icon={Layers3}
          id={namespace.id}
          title={namespace.name}
        />

        <MetricGrid>
          <MetricCard
            icon={Container}
            label="Pods"
            value={`${namespace.runningPods} / ${namespace.podCount}`}
            variant="compact"
          />
          <MetricCard
            icon={Boxes}
            label="Workloads"
            value={namespace.workloadCount}
            variant="compact"
          />
          <MetricCard
            icon={Network}
            label="Services"
            value={namespace.serviceCount}
            variant="compact"
          />
          <MetricCard
            icon={FileKey}
            label="Config"
            value={`${namespace.configMapCount} / ${namespace.secretCount}`}
            variant="compact"
          />
        </MetricGrid>

        <FactGrid
          className="xl:grid-cols-4"
          items={details.map((detail) => ({
            ...detail,
            value:
              detail.label === "Phase" ? (
                <StatusBadge status={namespace.phase} />
              ) : (
                detail.value
              ),
          }))}
        />

        <ConsolePanel title="Pod health">
          <SimpleTable
            columns={[
              { header: "Pod" },
              { header: "Phase" },
              { header: "Ready" },
              { header: "Restarts" },
              { header: "IP" },
              { className: "max-w-[320px] break-all", header: "Image" },
              { header: "Started" },
            ]}
            emptyState={<p className="text-sm font-black text-[#667085]">No pods found in this namespace.</p>}
            minWidthClassName="min-w-[980px]"
            rows={namespace.pods.map((pod) => ({
              cells: [
                <ResourceIdentity key="pod" name={pod.name} />,
                <StatusBadge key="phase" status={pod.phase} />,
                `${pod.readyContainers} / ${pod.containerCount}`,
                pod.restartCount,
                pod.ip,
                pod.image,
                <LocalDateTime key="started" value={pod.startedAt} />,
              ],
              key: pod.name,
            }))}
          />
        </ConsolePanel>

        <ConsolePanel title="Workloads">
          <SimpleTable
            columns={[
              { header: "Name" },
              { header: "Kind" },
              { header: "Status" },
              { header: "Ready" },
              { header: "Available" },
              { header: "Created" },
            ]}
            emptyState={<p className="text-sm font-black text-[#667085]">No deployments, StatefulSets, Jobs, or CronJobs found.</p>}
            minWidthClassName="min-w-[780px]"
            rows={namespace.workloads.map((workload) => ({
              cells: [
                <ResourceIdentity key="workload" name={workload.name} />,
                workload.kind,
                <StatusBadge key="status" status={workload.status} />,
                `${workload.ready} / ${workload.desired}`,
                workload.available,
                <LocalDateTime key="created" value={workload.createdAt} />,
              ],
              key: `${workload.kind}:${workload.name}`,
            }))}
          />
        </ConsolePanel>

        <ConsoleResponsiveGrid variant="lg-2">
          <ConsolePanel title="Labels">
            <KeyValueGrid emptyState="No namespace labels found." items={namespace.labels.slice(0, 12)} />
          </ConsolePanel>
          <ConsolePanel title="Annotations">
            <KeyValueGrid emptyState="No namespace annotations found." items={namespace.annotations.slice(0, 12)} />
          </ConsolePanel>
        </ConsoleResponsiveGrid>

        <ConsolePanel>
          <div className="flex items-center gap-3 p-5">
            <ConsoleIconTile
              className={
                isHealthy(namespace)
                  ? "bg-[#ecfdf3] text-[#039855]"
                  : "bg-[#fff7ed] text-[#c2410c]"
              }
              size="md"
            >
              <Tags className="size-5" />
            </ConsoleIconTile>
            <div>
              <h2 className="text-lg font-black">Namespace guardrails</h2>
              <ConsoleMutedText className="mt-1" weight="semibold">
                Deletion is available only for empty namespaces; populated namespaces must be cleared in CCI first.
              </ConsoleMutedText>
            </div>
          </div>
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
