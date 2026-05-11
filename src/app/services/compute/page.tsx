import { Server } from "lucide-react";

import { ServiceCategoryPage } from "@/components/service-category-page";

export default function ComputeServicesPage() {
  return (
    <ServiceCategoryPage
      active="Compute"
      description="Core compute services for virtual machines, bare metal, images, dedicated hosts, and elastic capacity."
      icon={Server}
      title="Compute"
    />
  );
}
