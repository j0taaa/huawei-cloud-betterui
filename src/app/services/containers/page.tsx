import { Boxes } from "lucide-react";

import { ServiceCategoryPage } from "@/components/service-category-page";

export default function ContainerServicesPage() {
  return (
    <ServiceCategoryPage
      active="Containers"
      description="Container services for Kubernetes clusters, image repositories, serverless containers, and service mesh."
      icon={Boxes}
      title="Containers"
    />
  );
}
