import { Database } from "lucide-react";

import { ServiceCategoryPage } from "@/components/service-category-page";

export default function DatabaseServicesPage() {
  return (
    <ServiceCategoryPage
      active="Databases"
      description="Managed database services for relational, document, cache, replication, and warehouse workloads."
      icon={Database}
      title="Databases"
    />
  );
}
