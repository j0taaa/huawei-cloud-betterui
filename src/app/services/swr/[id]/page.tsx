import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Code2,
  DatabaseBackup,
  Download,
  GitBranch,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

const tags = [
  ["v2.18.4", "sha256:91a5c0e", "284 MB", "Passed", "9 minutes ago"],
  ["v2.18.3", "sha256:6de122a", "284 MB", "Passed", "1 day ago"],
  ["v2.18.2", "sha256:a40bb12", "283 MB", "Warning", "3 days ago"],
  ["main-20260503", "sha256:102ad91", "286 MB", "Passed", "5 days ago"],
];

const policies = [
  ["Visibility", "Private", LockKeyhole],
  ["Immutable tags", "Enabled", ShieldCheck],
  ["Retention", "Keep last 30 tags", DatabaseBackup],
  ["Access tokens", "2 active", KeyRound],
] as const;

const scanClasses = {
  Passed: "bg-[#e9f8f1] text-[#15803d]",
  Warning: "bg-[#fff7ed] text-[#c2410c]",
};

export default async function SwrRepositoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <ConsoleShell active="Compute">
      <main className="grid gap-6 p-4 lg:p-8">
      <Link
        className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
        href="/services/swr"
      >
        <ArrowLeft className="size-4" />
        Back to SWR
      </Link>

      <div className="grid gap-6">
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <Code2 className="size-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">{id}</h1>
                  <span className="rounded-full bg-[#e9f8f1] px-3 py-1 text-xs font-black text-[#15803d]">
                    Private
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#667085]">
                  SWR repository · swr.sa-brazil-1.myhuaweicloud.com/acme-prod/{id}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {[
                ["Push image", UploadCloud],
                ["Pull command", Download],
                ["Refresh", RefreshCw],
              ].map(([label, Icon]) => (
                <button
                  className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-bold shadow-sm hover:bg-[#f8fafc]"
                  key={label as string}
                >
                  <Icon className="size-4" />
                  {label as string}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Tags", "142", GitBranch, "text-[#2563eb]"],
            ["Pulls today", "18.2K", Download, "text-[#16a34a]"],
            ["Scan status", "Passed", ShieldCheck, "text-[#9333ea]"],
          ].map(([label, value, Icon, color]) => (
            <article
              className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
              key={label as string}
            >
              <div className="grid size-11 place-items-center rounded-full bg-[#f7f9fc]">
                <Icon className={`size-5 ${color}`} />
              </div>
              <p className="mt-5 text-sm font-bold text-[#344054]">
                {label as string}
              </p>
              <p className="mt-1 text-2xl font-black tracking-tight">
                {value as string}
              </p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <article className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
            <div className="border-b border-[#e4e9f2] p-5">
              <h2 className="text-lg font-black">Image tags</h2>
              <p className="mt-1 text-sm font-medium text-[#667085]">
                Recent tags pushed to this repository.
              </p>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                <tr>
                  <th className="px-5 py-3">Tag</th>
                  <th className="px-5 py-3">Digest</th>
                  <th className="px-5 py-3">Size</th>
                  <th className="px-5 py-3">Scan</th>
                  <th className="px-5 py-3">Pushed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e9f2]">
                {tags.map(([tag, digest, size, scan, pushed]) => (
                  <tr className="hover:bg-[#fbfcfe]" key={tag}>
                    <td className="px-5 py-4 font-black">{tag}</td>
                    <td className="px-5 py-4 font-semibold text-[#667085]">
                      {digest}
                    </td>
                    <td className="px-5 py-4 font-bold">{size}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-black ${
                          scanClasses[scan as keyof typeof scanClasses]
                        }`}
                      >
                        {scan}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#667085]">{pushed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <aside className="grid content-start gap-6">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Repository policy</h2>
              <div className="mt-5 divide-y divide-[#e4e9f2]">
                {policies.map(([label, value, Icon]) => (
                  <div
                    className="flex items-center justify-between gap-4 py-3"
                    key={label}
                  >
                    <span className="flex items-center gap-3 text-sm font-bold text-[#475467]">
                      <Icon className="size-5 text-[#2563eb]" />
                      {label}
                    </span>
                    <span className="text-right text-sm font-black">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Health</h2>
              <div className="mt-5 flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-4">
                <CheckCircle2 className="size-5 text-[#16a34a]" />
                <div>
                  <p className="text-sm font-black">Ready for deployment</p>
                  <p className="mt-1 text-xs font-semibold text-[#667085]">
                    Latest tag passed scan and is pulled by CCE.
                  </p>
                </div>
              </div>
            </article>
          </aside>
        </section>
      </div>
      </main>
    </ConsoleShell>
  );
}
