"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { serviceCatalog, type ServiceCategory } from "@/lib/service-catalog";

const appTitle = "Huawei Cloud Better UI";

const categoryTitles: Record<string, ServiceCategory | "Dashboard" | "Services"> = {
  "/": "Dashboard",
  "/services": "Services",
  "/services/billing": "Billing",
  "/services/compute": "Compute",
  "/services/containers": "Containers",
  "/services/databases": "Databases",
  "/services/monitoring": "Monitoring",
  "/services/networking": "Networking",
  "/services/security": "Security",
  "/services/storage": "Storage",
};

const serviceItems = Object.values(serviceCatalog).flat();

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function serviceForPath(pathname: string) {
  return serviceItems
    .filter((service) => service.href && pathname.startsWith(`${service.href}/`))
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0];
}

function exactServiceTitle(pathname: string) {
  const service = serviceItems.find((item) => item.href === pathname);
  return service?.shortName ?? service?.name;
}

function pageHeading() {
  return normalizeText(document.querySelector("main h1, h1")?.textContent);
}

function composeTitle(...parts: Array<string | undefined>) {
  const uniqueParts = parts.filter(
    (part, index, values): part is string =>
      Boolean(part) && values.indexOf(part) === index && part !== appTitle,
  );

  return uniqueParts.length ? `${uniqueParts.join(" | ")} | ${appTitle}` : appTitle;
}

function titleForPath(pathname: string) {
  if (pathname === "/login") {
    return composeTitle("Login");
  }

  const categoryTitle = categoryTitles[pathname];
  if (categoryTitle) {
    return composeTitle(categoryTitle);
  }

  const exactTitle = exactServiceTitle(pathname);
  if (exactTitle) {
    return composeTitle(exactTitle);
  }

  const service = serviceForPath(pathname);
  const heading = pageHeading();

  if (service) {
    return composeTitle(heading || service.shortName || service.name, service.shortName);
  }

  return composeTitle(heading);
}

export function AdaptivePageTitle() {
  const pathname = usePathname();

  useEffect(() => {
    let animationFrame = 0;

    function updateTitle() {
      document.title = titleForPath(pathname);
    }

    updateTitle();
    animationFrame = window.requestAnimationFrame(updateTitle);

    const observer = new MutationObserver(updateTitle);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
