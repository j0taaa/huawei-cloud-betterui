import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { Layers3 } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
import { DeleteCciNamespaceButton } from "@/components/cci-namespace-actions";
import { ConsoleResourceLink } from "@/components/console-ui";
import { listCciNamespaces, type CciNamespace, withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = { title: "CCI | Huawei Cloud Better UI" };

function namespaceTone(namespace: CciNamespace) {
  if (namespace.phase.toLowerCase() !== "active") {
    return "warn";
  }

  if (namespace.podCount > 0 && namespace.runningPods < namespace.podCount) {
    return "warn";
  }

  return "good";
}

export default async function CciPage() {
  const result = await withCloudResult<CciNamespace[]>([], listCciNamespaces, cloudCacheKeys.listCciNamespaces);
  const namespaces = result.data;
  const pods = namespaces.reduce((total, namespace) => total + namespace.podCount, 0);
  const runningPods = namespaces.reduce(
    (total, namespace) => total + namespace.runningPods,
    0,
  );
  const restarts = namespaces.reduce(
    (total, namespace) => total + namespace.restartCount,
    0,
  );
  const workloads = namespaces.reduce(
    (total, namespace) => total + namespace.workloadCount,
    0,
  );
  const services = namespaces.reduce(
    (total, namespace) => total + namespace.serviceCount,
    0,
  );
  const canDeleteEmpty = (namespace: CciNamespace) =>
    namespace.podCount === 0 &&
    namespace.workloadCount === 0 &&
    namespace.serviceCount === 0 &&
    namespace.configMapCount === 0 &&
    namespace.secretCount === 0 &&
    !namespace.terminating;

  return (
    <ServiceInventoryPage
      actionLabel="Create namespace"
      actionTitle="CCI namespace creation is intentionally disabled in this read-only view."
      active="Containers"
      backHref="/services/containers"
      backLabel="Back to Containers"
      columns={[
        {
          header: "Namespace",
          render: (namespace) => (
            <ConsoleResourceLink href={`/services/cci/${encodeURIComponent(namespace.id)}`}>
              {namespace.name}
            </ConsoleResourceLink>
          ),
        },
        {
          header: "Phase",
          render: (namespace) => <InventoryStatus tone={namespaceTone(namespace)}>{namespace.phase}</InventoryStatus>,
        },
        { header: "Pods", render: (namespace) => `${namespace.runningPods} running / ${namespace.podCount} total` },
        { header: "Workloads", render: (namespace) => namespace.workloadCount },
        { header: "Services", render: (namespace) => namespace.serviceCount },
        { header: "Containers", render: (namespace) => `${namespace.readyContainers} ready / ${namespace.containerCount} total` },
        { header: "Restarts", render: (namespace) => namespace.restartCount },
        {
          header: "Config",
          render: (namespace) => `${namespace.configMapCount} configmaps / ${namespace.secretCount} secrets`,
        },
        { header: "Scope", render: (namespace) => `${namespace.projectName} / ${namespace.region}` },
        {
          header: "Actions",
          render: (namespace) => (
            <DeleteCciNamespaceButton
              canDelete={canDeleteEmpty(namespace)}
              namespaceId={namespace.id}
              namespaceName={namespace.name}
              projectId={namespace.projectId}
              resourceSummary={`${namespace.podCount} pods, ${namespace.workloadCount} workloads, ${namespace.serviceCount} services`}
            />
          ),
        },
      ]}
      description="Serverless container namespace inventory with pod, workload, service, and configuration detail."
      empty="No CCI namespaces found."
      icon={Layers3}
      result={result}
      rows={namespaces}
      stats={[
        { label: "Namespaces", value: namespaces.length },
        { label: "Running pods", value: `${runningPods} / ${pods}`, tone: runningPods === pods ? "good" : "warn" },
        { label: "Workloads", value: workloads },
        { label: "Services", value: services },
        { label: "Restarts", value: restarts, tone: restarts ? "warn" : "neutral" },
      ]}
      tableTitle="CCI namespaces"
      title="Cloud Container Instance"
    />
  );
}
