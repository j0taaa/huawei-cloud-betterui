import { Activity } from "lucide-react";

import { ServiceCategoryPage } from "@/components/service-category-page";

export default function MonitoringServicesPage() {
  return (
    <ServiceCategoryPage
      active="Monitoring"
      description="Observability services for metrics, logs, alarms, application operations, and audit trails."
      icon={Activity}
      title="Monitoring"
    />
  );
}
