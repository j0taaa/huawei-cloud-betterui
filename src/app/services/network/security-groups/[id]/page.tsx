import Link from "next/link";
import { ArrowLeft, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

const rules = [
  ["Inbound", "TCP 443", "0.0.0.0/0", "HTTPS public traffic"],
  ["Inbound", "TCP 22", "10.24.0.0/16", "Admin access from VPC"],
  ["Outbound", "All", "0.0.0.0/0", "Default outbound"],
];

export default async function SecurityGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ConsoleShell active="Networking">
      <main className="grid gap-6 p-4 lg:p-8">
      <Link
        className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
        href="/services/network"
      >
        <ArrowLeft className="size-4" />
        Back to Networking
      </Link>
      <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="flex items-center gap-4">
          <div className="grid size-12 place-items-center rounded-xl bg-[#fff7ed] text-[#f97316]">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight">{id}</h1>
            <p className="mt-1 text-sm font-semibold text-[#667085]">
              Security group · vpc-commerce-core
            </p>
          </div>
        </div>
      </section>
      <section className="mt-6 overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="border-b border-[#e4e9f2] p-5">
          <h2 className="text-lg font-black">Rules</h2>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
            <tr>
              <th className="px-5 py-3">Direction</th>
              <th className="px-5 py-3">Protocol/port</th>
              <th className="px-5 py-3">Source/destination</th>
              <th className="px-5 py-3">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e9f2]">
            {rules.map(([direction, port, source, description]) => (
              <tr className="hover:bg-[#fbfcfe]" key={`${direction}-${port}`}>
                <td className="px-5 py-4 font-black">{direction}</td>
                <td className="px-5 py-4 font-semibold">{port}</td>
                <td className="px-5 py-4 font-semibold">{source}</td>
                <td className="px-5 py-4 text-[#667085]">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="mt-6 rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
        <div className="flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-4">
          <CheckCircle2 className="size-5 text-[#16a34a]" />
          <p className="text-sm font-bold">
            No unrestricted administrative inbound rules detected.
          </p>
          <LockKeyhole className="ml-auto size-5 text-[#2563eb]" />
        </div>
      </section>
      </main>
    </ConsoleShell>
  );
}
