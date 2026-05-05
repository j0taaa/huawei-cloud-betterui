import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Gauge,
  RefreshCw,
  Server,
  Settings2,
  TrendingUp,
} from "lucide-react";

import { ConsoleShell } from "@/components/console-shell";

const policies = [
  ["scale-out-cpu", "CPU > 70%", "+2 instances", "300s cooldown"],
  ["scale-in-cpu", "CPU < 30%", "-1 instance", "600s cooldown"],
  ["morning-warmup", "08:00 weekdays", "Set desired to 8", "schedule"],
];

const instances = [
  ["ecs-api-as-01", "Running", "c7.large.4", "41% CPU"],
  ["ecs-api-as-02", "Running", "c7.large.4", "38% CPU"],
  ["ecs-api-as-03", "Running", "c7.large.4", "52% CPU"],
];

const events = [
  ["Scale out completed", "Added 2 instances", "14 minutes ago"],
  ["Alarm triggered", "CPU > 70%", "18 minutes ago"],
  ["Health replacement", "Replaced ecs-api-as-00", "2 hours ago"],
];

export default async function AutoScalingDetailPage({
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
        href="/services/as"
      >
        <ArrowLeft className="size-4" />
        Back to Auto Scaling
      </Link>

      <div className="grid gap-6">
        <section className="rounded-xl border border-[#e4e9f2] bg-white p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
                <Activity className="size-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight">{id}</h1>
                  <span className="rounded-full bg-[#e9f8f1] px-3 py-1 text-xs font-black text-[#15803d]">
                    Enabled
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#667085]">
                  Auto Scaling group · sa-brazil-1a/b
                </p>
              </div>
            </div>

            <button className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-bold shadow-sm hover:bg-[#f8fafc]">
              <RefreshCw className="size-4" />
              Refresh
            </button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ["Desired", "8", Gauge, "text-[#2563eb]"],
            ["Min / Max", "4 / 16", Settings2, "text-[#16a34a]"],
            ["Healthy ECS", "8", Server, "text-[#9333ea]"],
            ["Alarms", "2", BellRing, "text-[#f97316]"],
          ].map(([label, value, Icon, color]) => (
            <article
              className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]"
              key={label as string}
            >
              <Icon className={`size-5 ${color}`} />
              <p className="mt-4 text-sm font-bold text-[#667085]">
                {label as string}
              </p>
              <p className="mt-1 text-2xl font-black">{value as string}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="grid gap-6">
            <Table
              headers={["Policy", "Condition", "Action", "Cooldown"]}
              rows={policies}
              title="Scaling policies"
            />
            <Table
              headers={["Instance", "Status", "Flavor", "Load"]}
              rows={instances}
              title="Managed instances"
            />
          </div>

          <aside className="grid content-start gap-6">
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <h2 className="text-lg font-black">Recent activity</h2>
              <div className="mt-5 grid gap-4">
                {events.map(([title, detail, time]) => (
                  <div className="flex gap-3" key={title}>
                    <TrendingUp className="mt-0.5 size-5 text-[#2563eb]" />
                    <div>
                      <p className="text-sm font-bold">{title}</p>
                      <p className="mt-1 text-xs font-semibold text-[#667085]">
                        {detail} · {time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article className="rounded-xl border border-[#e4e9f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
              <div className="flex items-center gap-3 rounded-lg bg-[#fbfcfe] p-4">
                <CheckCircle2 className="size-5 text-[#16a34a]" />
                <p className="text-sm font-bold">
                  Group capacity is within configured limits.
                </p>
              </div>
            </article>
          </aside>
        </section>
      </div>
      </main>
    </ConsoleShell>
  );
}

function Table({
  headers,
  rows,
  title,
}: {
  headers: string[];
  rows: string[][];
  title: string;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
      <div className="border-b border-[#e4e9f2] p-5">
        <h2 className="text-lg font-black">{title}</h2>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-[#f7f9fc] text-xs font-black uppercase tracking-wide text-[#667085]">
          <tr>
            {headers.map((header) => (
              <th className="px-5 py-3" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e4e9f2]">
          {rows.map((row) => (
            <tr className="hover:bg-[#fbfcfe]" key={row.join("-")}>
              {row.map((cell) => (
                <td className="px-5 py-4 font-semibold" key={cell}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
