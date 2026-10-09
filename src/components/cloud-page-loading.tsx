import { Bell, CircleHelp, Cloud, Loader2, MapPin } from "lucide-react";

import {
  CloudSidebar,
  CloudSidebarInset,
  CloudSidebarProvider,
} from "@/components/cloud-sidebar";
import {
  ConsoleLoadingChip,
  ConsoleMain,
  ConsolePanel,
  ConsolePanelHeader,
  ConsoleSkeletonBlock,
  ConsoleSkeletonButton,
  ConsoleSkeletonRow,
} from "@/components/console-ui";
import { ThemeModeToggle } from "@/components/theme-mode-toggle";

type LoadingSection =
  | "Dashboard"
  | "Compute"
  | "Containers"
  | "Storage"
  | "Networking"
  | "Databases"
  | "Security"
  | "Billing"
  | "Monitoring";

export function CloudPageLoading({
  active = "Dashboard",
  title = "Loading cloud data",
}: {
  active?: LoadingSection;
  title?: string;
}) {
  return (
    <CloudSidebarProvider>
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828] dark:bg-[#07111f] dark:text-[#f8fafc]">
        <CloudSidebar active={active} />
        <CloudSidebarInset>
          <header className="sticky top-0 z-20 border-b border-[#e4e9f2] bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b1220]/92">
            <div className="flex min-h-20 flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div className="flex flex-wrap items-center gap-3">
                <ConsoleLoadingChip icon={<Cloud className="size-4 text-[#2563eb]" />}>
                  Loading projects
                </ConsoleLoadingChip>
                <ConsoleLoadingChip icon={<MapPin className="size-4 text-[#d7000f]" />}>
                  Loading regions
                </ConsoleLoadingChip>
              </div>

              <ConsoleSkeletonButton className="w-full max-w-xl rounded-full bg-[#f7f9fc]" />

              <div className="flex items-center gap-4">
                <Bell className="size-5 text-[#98a2b3]" />
                <CircleHelp className="size-5 text-[#98a2b3]" />
                <ThemeModeToggle />
                <div className="hidden items-center gap-3 border-l border-[#e4e9f2] pl-4 sm:flex dark:border-white/10">
                  <ConsoleSkeletonBlock className="size-10" />
                  <div className="grid gap-2">
                    <ConsoleSkeletonBlock className="h-3 w-24" />
                    <ConsoleSkeletonBlock className="h-2.5 w-32 bg-[#eef2f7]" />
                  </div>
                </div>
              </div>
            </div>
          </header>

          <ConsoleMain>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="flex items-center gap-3 text-sm font-black text-[#2563eb]">
                  <Loader2 className="size-4 animate-spin" />
                  Fetching fresh API data
                </div>
                <h1 className="mt-3 text-3xl font-black tracking-tight">
                  {title}
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  The first load is warming the cache. Future visits will show
                  cached data immediately while updates run in the background.
                </p>
              </div>
              <ConsoleSkeletonButton className="w-28" />
            </div>

            <ConsolePanel>
              <ConsolePanelHeader>
                <ConsoleSkeletonBlock className="h-5 w-40" />
                <ConsoleSkeletonBlock className="mt-3 h-3 w-64 bg-[#f0f3f8]" />
              </ConsolePanelHeader>
              <div className="grid gap-3 p-5">
                {["row-one", "row-two", "row-three", "row-four", "row-five"].map(
                  (row) => (
                    <ConsoleSkeletonRow key={row}>
                      <ConsoleSkeletonBlock className="h-4" />
                      <ConsoleSkeletonBlock className="h-4 bg-[#eef2f7]" />
                      <ConsoleSkeletonBlock className="h-4 bg-[#eef2f7]" />
                      <ConsoleSkeletonBlock className="h-4 bg-[#f0f3f8]" />
                    </ConsoleSkeletonRow>
                  ),
                )}
              </div>
            </ConsolePanel>
          </ConsoleMain>
        </CloudSidebarInset>
      </div>
    </CloudSidebarProvider>
  );
}
