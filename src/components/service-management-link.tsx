"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";

export function ServiceManagementLink({ services }: { services: string[] }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const service = [...services].sort((a, b) => b.length - a.length).find(service => pathname === `/services/${service}` || pathname.startsWith(`/services/${service}/`));
  if (!service) return null;
  const parts = ["", "services", service, ...pathname.slice(`/services/${service}`.length).split("/").filter(Boolean)];
  if (parts[3] === "manage") return null;
  const search = new URLSearchParams();
  if (query.get("projectId")) search.set("projectId", query.get("projectId")!);
  if (service === "network" && parts[4]) {
    const prefixes: Record<string, string> = { vpcs: "vpc:", subnets: "subnet:", "security-groups": "sg:" };
    if (prefixes[parts[3]]) { let id = parts[4]; try { id = decodeURIComponent(id); } catch {} search.set("resourceId", `${prefixes[parts[3]]}${id}`); }
  } else if (parts[3]) {
    try { const id = decodeURIComponent(service === "cbr" && parts[3] === "vaults" ? parts[4] ?? "" : parts[3]); search.set("resourceId", service === "functiongraph" ? `function:${id}` : service === "ims" ? `image:${id}` : service === "iotda" ? `device:${id}` : service === "iam" ? `user:${id}` : service === "as" ? `group:${id}` : service === "swr" ? `repository:${id}` : service === "cbr" ? `vault:${id}` : id); } catch { search.set("resourceId", parts[3]); }
  }
  return <div className="border-b border-[#e4e9f2] px-5 py-3 dark:border-white/10"><Link className="inline-flex items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 py-2 text-sm font-bold text-[#2563eb] dark:bg-[#101828] dark:text-[#d0d5dd]" href={`/services/${service}/manage${search.size ? `?${search}` : ""}`}><Settings2 className="size-4" />Create and manage resources</Link></div>;
}
