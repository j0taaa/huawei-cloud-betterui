import { ShieldCheck } from "lucide-react";

import { ServiceCategoryPage } from "@/components/service-category-page";

export default function SecurityServicesPage() {
  return (
    <ServiceCategoryPage
      active="Security"
      description="Security and identity services for access control, encryption, web protection, firewall, and host defense."
      icon={ShieldCheck}
      title="Security"
    />
  );
}
