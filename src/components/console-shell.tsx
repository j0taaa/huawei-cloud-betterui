import {
  ListTodo,
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
import { ThemeModeToggle } from "@/components/theme-mode-toggle";
import Link from "next/link";
import { ConsoleToolbarButton } from "@/components/console-ui";
import { getCurrentSession, getSessionProjects } from "@/lib/auth-session";
import { ServiceManagementLink } from "@/components/service-management-link";
import { managementAdapters } from "@/lib/huawei/management/registry";

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
  const projects = getSessionProjects(session);
  const projectName =
    projects.length > 1
      ? `${projects.length} projects`
      : session.projectName;
  const region = projects.length > 1 ? "All regions" : session.region;
  const username = session.username;

  return (
    <CloudSidebarProvider>
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828] dark:bg-[#07111f] dark:text-[#f8fafc]">
        <CloudSidebar active={active} />
        <CloudSidebarInset>
          <header className="sticky top-0 z-20 border-b border-[#e4e9f2] bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b1220]/92">
            <div className="flex min-h-20 flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div className="flex flex-wrap items-center gap-3">
                <ConsoleToolbarButton className="h-11 px-4">
                  <Cloud className="size-4 text-[#2563eb]" />
                  {projectName}
                  <ChevronDown className="size-4 text-[#667085] dark:text-[#98a2b3]" />
                </ConsoleToolbarButton>
                <ConsoleToolbarButton className="h-11 px-4">
                  <MapPin className="size-4 text-[#d7000f]" />
                  {region}
                  <ChevronDown className="size-4 text-[#667085] dark:text-[#98a2b3]" />
                </ConsoleToolbarButton>
              </div>

              <ServiceCommandSearch />

              <div className="flex items-center gap-4">
                <Link href="/tasks" aria-label="Operation history" className="inline-flex size-8 items-center justify-center text-[#475467] dark:text-[#98a2b3]"><ListTodo className="size-5" /></Link>
                <Link href="/services/coverage" className="text-xs font-bold text-[#2563eb]">Service coverage</Link>
                <CircleHelp className="size-5 text-[#475467] dark:text-[#98a2b3]" />
                <ThemeModeToggle />
                <div className="hidden items-center gap-3 border-l border-[#e4e9f2] pl-4 sm:flex dark:border-white/10">
                  <div className="grid size-10 place-items-center rounded-full bg-[#f0f3f8] dark:bg-white/10">
                    <UserRound className="size-5 text-[#667085] dark:text-[#d0d5dd]" />
                  </div>
                  <div>
                    <p className="text-sm font-extrabold">{username}</p>
                    <p className="text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
                      {accountName}
                    </p>
                  </div>
                </div>
                <LogoutButton />
              </div>
            </div>
          </header>
          <ServiceManagementLink services={Object.keys(managementAdapters)} />
          {children}
        </CloudSidebarInset>
      </div>
    </CloudSidebarProvider>
  );
}
