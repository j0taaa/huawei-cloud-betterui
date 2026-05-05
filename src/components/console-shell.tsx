import {
  Bell,
  ChevronDown,
  CircleHelp,
  Cloud,
  MapPin,
  UserRound,
} from "lucide-react";
import { redirect } from "next/navigation";

import {
  CloudSidebar,
  CloudSidebarInset,
  CloudSidebarProvider,
} from "@/components/cloud-sidebar";
import { LogoutButton } from "@/components/logout-button";
import { ServiceCommandSearch } from "@/components/service-command-search";
import { getCurrentSession } from "@/lib/auth-session";

type ConsoleSection =
  | "Dashboard"
  | "Compute"
  | "Containers"
  | "Storage"
  | "Networking"
  | "Databases"
  | "Security"
  | "Billing"
  | "Monitoring";

export async function ConsoleShell({
  active,
  children,
}: {
  active: ConsoleSection;
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const accountName = session.accountName;
  const projectName = session.projectName;
  const region = session.region;
  const username = session.username;

  return (
    <CloudSidebarProvider>
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828]">
        <CloudSidebar active={active} />
        <CloudSidebarInset>
          <header className="sticky top-0 z-20 border-b border-[#e4e9f2] bg-white/90 backdrop-blur-xl">
            <div className="flex min-h-20 flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div className="flex flex-wrap items-center gap-3">
                <button className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm">
                  <Cloud className="size-4 text-[#2563eb]" />
                  {projectName}
                  <ChevronDown className="size-4 text-[#667085]" />
                </button>
                <button className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm">
                  <MapPin className="size-4 text-[#d7000f]" />
                  {region}
                  <ChevronDown className="size-4 text-[#667085]" />
                </button>
              </div>

              <ServiceCommandSearch />

              <div className="flex items-center gap-4">
                <button aria-label="Notifications" className="relative">
                  <Bell className="size-5" />
                  <span className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-[#d7000f] text-[10px] font-bold text-white">
                    3
                  </span>
                </button>
                <CircleHelp className="size-5 text-[#475467]" />
                <div className="hidden items-center gap-3 border-l border-[#e4e9f2] pl-4 sm:flex">
                  <div className="grid size-10 place-items-center rounded-full bg-[#f0f3f8]">
                    <UserRound className="size-5 text-[#667085]" />
                  </div>
                  <div>
                    <p className="text-sm font-extrabold">{username}</p>
                    <p className="text-xs font-semibold text-[#667085]">
                      {accountName}
                    </p>
                  </div>
                </div>
                <LogoutButton />
              </div>
            </div>
          </header>
          {children}
        </CloudSidebarInset>
      </div>
    </CloudSidebarProvider>
  );
}
