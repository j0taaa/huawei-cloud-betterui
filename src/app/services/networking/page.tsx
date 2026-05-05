import { Network } from "lucide-react";

import { ServiceCategoryPage } from "@/components/service-category-page";

export default function NetworkingServicesPage() {
  return (
    <ServiceCategoryPage
      active="Networking"
      description="Networking services for VPCs, subnets, public IPs, load balancing, private connectivity, DNS, and VPN."
      icon={Network}
      title="Networking"
    />
  );
}
