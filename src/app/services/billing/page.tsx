import { CreditCard } from "lucide-react";

import { ServiceCategoryPage } from "@/components/service-category-page";

export default function BillingServicesPage() {
  return (
    <ServiceCategoryPage
      active="Billing"
      description="Billing, cost, budgets, resource packages, and enterprise project accounting."
      icon={CreditCard}
      title="Billing"
    />
  );
}
