import { HardDrive } from "lucide-react";

import { ServiceCategoryPage } from "@/components/service-category-page";

export default function StorageServicesPage() {
  return (
    <ServiceCategoryPage
      active="Storage"
      description="Storage services for objects, block disks, shared file systems, backups, and data transfer."
      icon={HardDrive}
      title="Storage"
    />
  );
}
