import Link from "next/link";
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Copy,
  DatabaseBackup,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  Folder,
  KeyRound,
  LockKeyhole,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

const folders = [
  ["exports/", "Folder", "-", "May 3, 2026 16:58"],
  ["archive/", "Folder", "-", "May 2, 2026 09:14"],
  ["manifests/", "Folder", "-", "May 1, 2026 18:22"],
] as const;

const files = [
  ["orders-2026-05-03.csv", "CSV", "84.2 MB", "May 3, 2026 16:58", FileSpreadsheet],
  ["customers-2026-05-03.csv", "CSV", "18.7 MB", "May 3, 2026 16:50", FileSpreadsheet],
  ["orders.parquet", "Parquet", "2.4 GB", "May 2, 2026 09:14", FileArchive],
  ["latest.json", "JSON", "24 KB", "May 1, 2026 18:22", FileCode2],
  ["embeddings.bin.gz", "Archive", "89.2 MB", "Apr 30, 2026 11:07", FileArchive],
] as const;

const bucketFacts = [
  ["Region", "AL-Sao Paulo1"],
  ["Storage class", "Standard"],
  ["Versioning", "Enabled"],
  ["Encryption", "SSE-OBS"],
];

const policyRows = [
  ["Public access", "Blocked", ShieldCheck],
  ["Lifecycle", "Archive after 90 days", FileArchive],
  ["Replication", "LA-Santiago target", DatabaseBackup],
  ["Access keys", "2 active", KeyRound],
] as const;

export default async function ObsBucketPage({
  params,
}: {
  params: Promise<{ bucket: string }>;
}) {
  const { bucket } = await params;
  const bucketName = decodeURIComponent(bucket);

  return (
    <ConsoleShell active="Storage">
      <main className="grid gap-4 p-4 lg:p-6">
        <div className="flex flex-col gap-3">
          <Link
            className="inline-flex w-fit items-center gap-2 text-sm font-bold text-[#2563eb]"
            href="/services/obs"
          >
            <ArrowLeft className="size-4" />
            Back to OBS
          </Link>

          <section className="rounded-xl border border-[#e4e9f2] bg-white px-5 py-4 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#e9f8f1] text-[#16a34a]">
                  <Box className="size-6" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#667085]">
                    <span>OBS</span>
                    <ChevronRight className="size-4" />
                    <span>{bucketName}</span>
                    <ChevronRight className="size-4" />
                    <span className="text-[#101828]">Objects</span>
                  </div>
                  <h1 className="mt-1 truncate text-2xl font-black tracking-tight">
                    {bucketName}
                  </h1>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {[
                  ["Upload object", UploadCloud],
                  ["Create folder", Folder],
                  ["Refresh", RefreshCw],
                  ["Settings", Settings2],
                ].map(([label, Icon]) => (
                  <button
                    className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-bold shadow-sm hover:bg-[#f8fafc] first:border-0 first:bg-[#2563eb] first:text-white"
                    key={label as string}
                  >
                    <Icon className="size-4" />
                    {label as string}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <section className="grid gap-4 2xl:grid-cols-[1fr_340px]">
          <article className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
            <div className="border-b border-[#e4e9f2] p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="text-lg font-black">Objects</h2>
                  <p className="mt-1 text-sm font-medium text-[#667085]">
                    Browse folders and files in the current bucket prefix.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <label className="flex h-10 min-w-72 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-medium text-[#667085]">
                    <Search className="size-4" />
                    <input
                      aria-label="Search objects"
                      className="min-w-0 flex-1 bg-transparent outline-none"
                      placeholder="Search by object prefix..."
                    />
                  </label>
                  <button className="h-10 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-bold">
                    Prefix: /
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-b border-[#e4e9f2] bg-[#fbfcfe] px-5 py-3 text-sm font-bold text-[#667085]">
              <button className="text-[#2563eb]">Root</button>
              <ChevronRight className="size-4" />
              <button className="text-[#2563eb]">exports</button>
              <ChevronRight className="size-4" />
              <span className="text-[#101828]">current</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
                  <tr>
                    <th className="w-10 px-5 py-3">
                      <input aria-label="Select all objects" type="checkbox" />
                    </th>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Size</th>
                    <th className="px-5 py-3">Last modified</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e9f2]">
                  {folders.map(([name, type, size, modified]) => (
                    <tr className="group hover:bg-[#fbfcfe]" key={name}>
                      <td className="px-5 py-4">
                        <input aria-label={`Select ${name}`} type="checkbox" />
                      </td>
                      <td className="px-5 py-4">
                        <button className="flex items-center gap-3 font-black text-[#2563eb]">
                          <Folder className="size-5 fill-[#dbeafe] text-[#2563eb]" />
                          {name}
                        </button>
                      </td>
                      <td className="px-5 py-4 font-semibold">{type}</td>
                      <td className="px-5 py-4 text-[#667085]">{size}</td>
                      <td className="px-5 py-4 text-[#667085]">{modified}</td>
                      <td className="px-5 py-4">
                        <button className="font-bold text-[#2563eb]">
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}

                  {files.map(([name, type, size, modified, Icon]) => (
                    <tr className="group hover:bg-[#fbfcfe]" key={name}>
                      <td className="px-5 py-4">
                        <input aria-label={`Select ${name}`} type="checkbox" />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3 font-black">
                          <Icon className="size-5 text-[#667085]" />
                          {name}
                        </div>
                      </td>
                      <td className="px-5 py-4 font-semibold">{type}</td>
                      <td className="px-5 py-4 font-bold">{size}</td>
                      <td className="px-5 py-4 text-[#667085]">{modified}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-4">
                          <button className="font-bold text-[#2563eb]">
                            Download
                          </button>
                          <button className="font-bold text-[#2563eb]">
                            Share
                          </button>
                          <button
                            aria-label={`More actions for ${name}`}
                            className="text-[#667085]"
                          >
                            <MoreHorizontal className="size-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 border-t border-[#e4e9f2] px-5 py-4 text-sm font-semibold text-[#667085] sm:flex-row sm:items-center sm:justify-between">
              <span>8 items · 5 files · 3 folders</span>
              <span>Selected: 0</span>
            </div>
          </article>

          <aside className="grid content-start gap-4">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Bucket context</h2>
              <div className="mt-5 grid gap-3">
                {bucketFacts.map(([label, value]) => (
                  <div
                    className="flex items-center justify-between gap-4"
                    key={label}
                  >
                    <span className="text-sm font-bold text-[#667085]">
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
              <h2 className="text-lg font-black">Current prefix</h2>
              <div className="mt-5 rounded-lg bg-[#fbfcfe] p-4">
                <p className="text-xs font-black uppercase tracking-wide text-[#667085]">
                  Path
                </p>
                <p className="mt-2 break-all text-sm font-bold">
                  obs://{bucketName}/exports/current/
                </p>
                <button className="mt-4 flex items-center gap-2 text-sm font-bold text-[#2563eb]">
                  <Copy className="size-4" />
                  Copy path
                </button>
              </div>
            </article>

            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Protection</h2>
              <div className="mt-5 divide-y divide-[#e4e9f2]">
                {policyRows.map(([label, value, Icon]) => (
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
              <div className="flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-4">
                <LockKeyhole className="size-5 text-[#16a34a]" />
                <div>
                  <p className="text-sm font-black">Private bucket</p>
                  <p className="mt-1 text-xs font-semibold text-[#667085]">
                    Public access is blocked for this bucket.
                  </p>
                </div>
              </div>
            </article>
          </aside>
        </section>
      </main>
    </ConsoleShell>
  );
}
