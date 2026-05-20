import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Code2, Play } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { FunctionGraphCodeViewer } from "@/components/functiongraph-code-viewer";
import { LocalDateTime } from "@/components/local-date-time";
import {
  getFunctionGraphFunction,
  type FunctionGraphFunction,
  withCloudResult,
} from "@/lib/huawei-cloud";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-[#eef2f7] py-3 last:border-0 sm:grid-cols-[160px_1fr] sm:gap-4">
      <dt className="text-xs font-black uppercase tracking-wide text-[#667085]">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm font-semibold text-[#101828]">
        {value || "-"}
      </dd>
    </div>
  );
}

export default async function FunctionGraphFunctionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await withCloudResult<FunctionGraphFunction | null>(
    null,
    (session) => getFunctionGraphFunction(session, id),
    `functiongraph-function:${id}`,
  );
  const fn = result.data;

  if (!fn) {
    notFound();
  }

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]"
              href="/services/functiongraph"
            >
              <ArrowLeft className="size-4" />
              Back to FunctionGraph
            </Link>
            <div className="flex items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <Code2 className="size-6" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black uppercase tracking-[0.14em] text-[#667085]">
                  FunctionGraph function
                </p>
                <h1 className="mt-1 break-words text-3xl font-black tracking-tight">
                  {fn.name}
                </h1>
                <p className="mt-2 break-all font-mono text-xs font-semibold text-[#667085]">
                  {fn.urn || fn.id}
                </p>
                <p className="mt-2 text-xs font-bold text-[#98a2b3]">
                  Showing {result.isCached ? "cached" : "fresh"} data from{" "}
                  <LocalDateTime value={result.updatedAt} />.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Function invocation is not implemented yet.">
              <Play className="size-4" />
              Invoke
            </DisabledCloudButton>
            <RefreshButton />
          </div>
        </div>

        {result.error ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {result.error}
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
          <aside className="grid content-start gap-6">
            <section className="rounded-2xl border border-[#d9e0eb] bg-white p-5 shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
              <h2 className="text-lg font-black">Configuration</h2>
              <dl className="mt-3">
                <Field label="Package" value={fn.packageName} />
                <Field label="Version" value={fn.version} />
                <Field label="Runtime" value={fn.runtime} />
                <Field label="Handler" value={fn.handler} />
                <Field label="Memory" value={fn.memorySize} />
                <Field label="CPU" value={fn.cpu} />
                <Field label="Timeout" value={fn.timeout} />
              </dl>
            </section>

            <section className="rounded-2xl border border-[#d9e0eb] bg-white p-5 shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
              <h2 className="text-lg font-black">Location</h2>
              <dl className="mt-3">
                <Field label="Region" value={fn.region} />
                <Field label="Project" value={fn.projectName} />
                <Field label="Project ID" value={fn.projectId} />
              </dl>
            </section>
          </aside>

          <div className="grid content-start gap-6">
            <FunctionGraphCodeViewer
              codePayload={fn.codeFile}
              codeSize={fn.codeSize}
              codeText={fn.codeText}
              codeType={fn.codeType}
              handler={fn.handler}
              runtime={fn.runtime}
              version={fn.version}
            />
            <section className="rounded-2xl border border-[#d9e0eb] bg-white p-5 shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
              <h2 className="text-lg font-black">Code metadata</h2>
              <dl className="mt-3">
                <Field label="Code type" value={fn.codeType} />
                <Field label="Code size" value={fn.codeSize} />
                <Field label="Digest" value={fn.digest || "-"} />
                <Field label="Last modified" value={<LocalDateTime value={fn.lastModified} />} />
              </dl>
            </section>
            <section className="rounded-2xl border border-[#d9e0eb] bg-white p-5 shadow-[0_18px_48px_rgba(16,24,40,0.08)]">
              <h2 className="text-lg font-black">Description</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#475467]">
                {fn.description || "No description provided."}
              </p>
            </section>
          </div>
        </section>
      </main>
    </ConsoleShell>
  );
}
