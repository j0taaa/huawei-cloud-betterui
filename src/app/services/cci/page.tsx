import type { Metadata } from "next";
import { Layers3 } from "lucide-react";

import { InventoryStatus, ServiceInventoryPage } from "@/app/services/_components/service-inventory";
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
  const result = await withCloudResult<CciNamespace[]>([], listCciNamespaces);
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

  return (
    <ServiceInventoryPage
      actionLabel="Create namespace"
      actionTitle="CCI namespace creation is intentionally disabled in this read-only view."
      active="Containers"
      backHref="/services/containers"
      backLabel="Back to Containers"
      columns={[
        { header: "Namespace", render: (namespace) => <span className="font-black">{namespace.name}</span> },
        {
          header: "Phase",
          render: (namespace) => <InventoryStatus tone={namespaceTone(namespace)}>{namespace.phase}</InventoryStatus>,
        },
        { header: "Pods", render: (namespace) => `${namespace.runningPods} running / ${namespace.podCount} total` },
        { header: "Ready containers", render: (namespace) => namespace.readyContainers },
        { header: "Restarts", render: (namespace) => namespace.restartCount },
        { header: "Created", render: (namespace) => namespace.createdAt || "-" },
        { header: "Scope", render: (namespace) => `${namespace.projectName} / ${namespace.region}` },
      ]}
      description="Serverless container namespace inventory with pod readiness, running counts, and restart pressure."
      empty="No CCI namespaces found."
      icon={Layers3}
      result={result}
      rows={namespaces}
      stats={[
        { label: "Namespaces", value: namespaces.length },
        { label: "Running pods", value: `${runningPods} / ${pods}`, tone: runningPods === pods ? "good" : "warn" },
        { label: "Ready containers", value: namespaces.reduce((total, namespace) => total + namespace.readyContainers, 0) },
        { label: "Restarts", value: restarts, tone: restarts ? "warn" : "neutral" },
      ]}
      tableTitle="CCI namespace readiness"
      title="Cloud Container Instance"
    />
  );
}
