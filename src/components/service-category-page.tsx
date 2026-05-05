import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Search,
  type LucideIcon,
} from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";
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
      <main className="grid gap-6 p-4 lg:p-8">
        <Link
          className="inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]"
          href="/"
        >
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>

        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <Icon className="size-6" />
              </div>
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
        </section>

        <section className="rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-4 border-b border-[#e4e9f2] p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-black">Services</h2>
              <p className="mt-1 text-sm font-medium text-[#667085]">
                Common Huawei Cloud services for this category.
              </p>
            </div>
            <label className="flex h-10 min-w-72 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
              <Search className="size-4" />
              <input
                aria-label={`Search ${title} services`}
                className="min-w-0 flex-1 bg-transparent outline-none"
                placeholder="Search services"
              />
            </label>
          </div>

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
                    <span
                      className={
                        service.href
                          ? "rounded-full bg-[#e9f8f1] px-2.5 py-1 text-xs font-black text-[#15803d]"
                          : "rounded-full bg-[#f2f4f7] px-2.5 py-1 text-xs font-black text-[#667085]"
                      }
                    >
                      {service.status ?? "Catalog"}
                    </span>
                  </div>
                  <div className="mt-5 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-[#98a2b3]">
                      {service.href ? "Open console" : "Planned"}
                    </span>
                    <ArrowRight className="size-4 text-[#98a2b3]" />
                  </div>
                </>
              );

              if (!service.href) {
                return (
                  <article
                    className="rounded-xl border border-[#e4e9f2] bg-[#fbfcfe] p-4 opacity-85"
                    key={service.shortName}
                  >
                    {content}
                  </article>
                );
              }

              return (
                <Link
                  className="rounded-xl border border-[#e4e9f2] bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(16,24,40,0.08)]"
                  href={service.href}
                  key={service.shortName}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    </ConsoleShell>
  );
}
