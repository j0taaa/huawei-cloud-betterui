"use client";

import Link from "next/link";
import { createContext, type ReactNode, useContext, useState } from "react";
import {
  Activity,
  ChevronLeft,
  CreditCard,
  Database,
  Grid2X2,
  HardDrive,
  Network,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type SidebarContextValue = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

const navigation: Array<{
  label: string;
  href: string;
  icon: LucideIcon;
}> = [
  { label: "Dashboard", href: "/", icon: Grid2X2 },
  { label: "Compute", href: "/services/ecs", icon: Server },
  { label: "Storage", href: "/services/obs", icon: HardDrive },
  { label: "Networking", href: "/services/network", icon: Network },
  { label: "Databases", href: "/services/rds", icon: Database },
  { label: "Security", href: "#", icon: ShieldCheck },
  { label: "Billing", href: "#", icon: CreditCard },
  { label: "Monitoring", href: "#", icon: Activity },
];

export function CloudSidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

function useSidebar() {
  const context = useContext(SidebarContext);

  if (!context) {
    throw new Error("CloudSidebar components must be used inside provider.");
  }

  return context;
}

export function CloudSidebar({
  active,
}: {
  active: "Dashboard" | "Compute" | "Storage" | "Networking" | "Databases";
}) {
  const { collapsed, setCollapsed } = useSidebar();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden border-r border-[#e4e9f2] bg-white transition-[width] duration-300 xl:block",
        collapsed ? "w-20" : "w-64",
      )}
    >
      <div
        className={cn(
          "flex h-20 items-center border-b border-[#e4e9f2]",
          collapsed ? "justify-center px-0" : "gap-3 px-6",
        )}
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#d7000f] text-lg font-black text-white">
          H
        </div>
        <div
          className={cn(
            "min-w-0 transition-opacity duration-200",
            collapsed ? "hidden opacity-0" : "block opacity-100",
          )}
        >
          <p className="truncate text-lg font-extrabold tracking-tight">
            HUAWEI CLOUD
          </p>
          <p className="text-xs font-semibold text-[#667085]">
            Better Console
          </p>
        </div>
      </div>

      <nav className={cn("grid gap-1", collapsed ? "p-3" : "p-4")}>
        {navigation.map(({ label, href, icon: Icon }) => {
          const isActive = active === label;

          return (
            <Link
              aria-label={collapsed ? label : undefined}
              className={cn(
                "flex h-12 items-center rounded-lg text-sm font-bold transition",
                collapsed ? "justify-center px-0" : "gap-3 px-4",
                isActive
                  ? "bg-[#2563eb] text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)]"
                  : "text-[#475467] hover:bg-[#f3f6fb] hover:text-[#101828]",
              )}
              href={href}
              key={label}
              title={collapsed ? label : undefined}
            >
              <Icon className="size-5 shrink-0" />
              <span className={collapsed ? "sr-only" : "truncate"}>
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      <button
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "absolute bottom-6 grid size-11 place-items-center rounded-full border border-[#d9e0eb] bg-[#101828] text-white shadow-[0_14px_32px_rgba(16,24,40,0.22)] transition",
          collapsed ? "left-1/2 -translate-x-1/2" : "left-6",
        )}
        onClick={() => setCollapsed(!collapsed)}
        type="button"
      >
        <ChevronLeft
          className={cn(
            "size-5 transition-transform",
            collapsed ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
    </aside>
  );
}

export function CloudSidebarInset({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div
      className={cn(
        "transition-[padding-left] duration-300",
        collapsed ? "xl:pl-20" : "xl:pl-64",
      )}
    >
      {children}
    </div>
  );
}
