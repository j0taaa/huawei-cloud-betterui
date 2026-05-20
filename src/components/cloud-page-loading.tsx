import { Bell, CircleHelp, Cloud, Loader2, MapPin } from "lucide-react";

import {
  CloudSidebar,
  CloudSidebarInset,
  CloudSidebarProvider,
} from "@/components/cloud-sidebar";

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
      <div className="min-h-screen bg-[#f4f7fb] text-[#101828]">
        <CloudSidebar active={active} />
        <CloudSidebarInset>
          <header className="sticky top-0 z-20 border-b border-[#e4e9f2] bg-white/90 backdrop-blur-xl">
            <div className="flex min-h-20 flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm">
                  <Cloud className="size-4 text-[#2563eb]" />
                  Loading projects
                </div>
                <div className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm">
                  <MapPin className="size-4 text-[#d7000f]" />
                  Loading regions
                </div>
              </div>

              <div className="h-11 w-full max-w-xl rounded-full border border-[#d9e0eb] bg-[#f7f9fc]" />

              <div className="flex items-center gap-4">
                <Bell className="size-5 text-[#98a2b3]" />
                <CircleHelp className="size-5 text-[#98a2b3]" />
                <div className="hidden items-center gap-3 border-l border-[#e4e9f2] pl-4 sm:flex">
                  <div className="size-10 rounded-full bg-[#f0f3f8]" />
                  <div className="grid gap-2">
                    <div className="h-3 w-24 rounded-full bg-[#e4e9f2]" />
                    <div className="h-2.5 w-32 rounded-full bg-[#eef2f7]" />
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="grid gap-6 p-4 lg:p-8">
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
              <div className="h-11 w-28 rounded-lg border border-[#d9e0eb] bg-white shadow-sm" />
            </div>

            <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <div className="border-b border-[#e4e9f2] p-5">
                <div className="h-5 w-40 rounded-full bg-[#e4e9f2]" />
                <div className="mt-3 h-3 w-64 rounded-full bg-[#f0f3f8]" />
              </div>
              <div className="grid gap-3 p-5">
                {["row-one", "row-two", "row-three", "row-four", "row-five"].map(
                  (row) => (
                    <div
                      className="grid gap-4 rounded-lg border border-[#eef2f7] p-4 md:grid-cols-4"
                      key={row}
                    >
                      <div className="h-4 rounded-full bg-[#e4e9f2]" />
                      <div className="h-4 rounded-full bg-[#eef2f7]" />
                      <div className="h-4 rounded-full bg-[#eef2f7]" />
                      <div className="h-4 rounded-full bg-[#f0f3f8]" />
                    </div>
                  ),
                )}
              </div>
            </section>
          </main>
        </CloudSidebarInset>
      </div>
    </CloudSidebarProvider>
  );
}
