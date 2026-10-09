import Image from "next/image";
import {
  ArrowRight,
  Boxes,
  type LucideIcon,
} from "lucide-react";

import { ConsoleSearchInput } from "@/components/console-search-input";
import { ConsoleShell } from "@/components/console-shell";
import {
  ConsoleBackLink,
  ConsoleCatalogCard,
  ConsoleIconTile,
  ConsoleMain,
  ConsolePanel,
  ConsolePill,
} from "@/components/console-ui";
import {
  serviceCatalog,
  type ServiceCategory,
} from "@/lib/service-catalog";

export function ServiceCategoryPage({
  active,
  description,
  icon: Icon,
  title,
}: {
  active: ServiceCategory;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  const services = serviceCatalog[active];
  const availableCount = services.filter((service) => service.href).length;

  return (
    <ConsoleShell active={active}>
      <ConsoleMain>
        <ConsoleBackLink href="/">
          Back to dashboard
        </ConsoleBackLink>

        <ConsolePanel className="p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <ConsoleIconTile>
                <Icon className="size-6" />
              </ConsoleIconTile>
              <div>
                <h1 className="text-3xl font-black tracking-tight">{title}</h1>
                <p className="mt-1 max-w-3xl text-sm font-medium text-[#667085]">
                  {description}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-[#f7f9fc] px-4 py-3 text-sm font-bold text-[#475467]">
              {availableCount} available · {services.length} catalog services
            </div>
          </div>
        </ConsolePanel>

        <ConsolePanel
          actions={(
            <ConsoleSearchInput
              className="min-w-72"
              inputClassName="bg-white dark:bg-[#111827]"
              label={`Search ${title} services`}
              placeholder="Search services"
            />
          )}
          description="Common Huawei Cloud services for this category."
          title="Services"
        >

          <div className="grid gap-3 p-5 md:grid-cols-2 2xl:grid-cols-3">
            {services.map((service) => {
              const content = (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#f7f9fc] text-[#2563eb]">
                        {service.logo ? (
                          <Image
                            alt={`${service.shortName} logo`}
                            className="size-7 object-contain"
                            height={28}
                            src={service.logo}
                            width={28}
                          />
                        ) : (
                          <Boxes className="size-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-black">{service.shortName}</h3>
                          <span className="text-sm font-bold text-[#344054]">
                            {service.name}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-medium leading-6 text-[#667085]">
                          {service.description}
                        </p>
                      </div>
                    </div>
                    <ConsolePill tone={service.href ? "good" : "neutral"}>
                      {service.status ?? "Catalog"}
                    </ConsolePill>
                  </div>
                  <div className="mt-5 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#98a2b3]">
                      {service.href ? "Open console" : "Planned"}
                    </span>
                    <ArrowRight className="size-4 text-[#98a2b3]" />
                  </div>
                </>
              );

              return (
                <ConsoleCatalogCard
                  href={service.href}
                  key={service.shortName}
                >
                  {content}
                </ConsoleCatalogCard>
              );
            })}
          </div>
        </ConsolePanel>
      </ConsoleMain>
    </ConsoleShell>
  );
}
