import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BellRing, Plus, Radio, ShieldCheck } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import { ConsoleShell } from "@/components/console-shell";
import { LocalDateTime } from "@/components/local-date-time";
import type { BetterUiSession } from "@/lib/auth-session";
import * as huaweiCloud from "@/lib/huawei-cloud";
import { withCloudResult } from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "SMN | Huawei Cloud Better UI",
};

type SmnTopic = {
  displayName?: string;
  enterpriseProjectId?: string;
  id?: string;
  name: string;
  projectId?: string;
  projectName?: string;
  pushPolicy?: number | string;
  region?: string;
  subscriptionsConfirmed?: number;
  subscriptionsTotal?: number;
  topicUrn: string;
  updatedAt?: string;
};

type ListSmnTopics = (session: BetterUiSession) => Promise<SmnTopic[]>;

const listSmnTopics =
  (huaweiCloud as typeof huaweiCloud & { listSmnTopics?: ListSmnTopics })
    .listSmnTopics ??
  (async () => {
    throw new Error("listSmnTopics is not exported from @/lib/huawei-cloud yet.");
  });

function pushPolicyLabel(value: SmnTopic["pushPolicy"]) {
  if (value === 0 || value === "0") {
    return "HTTP status only";
  }

  if (value === 1 || value === "1") {
    return "JSON envelope";
  }

  return value ? String(value) : "-";
}

export default async function SmnPage() {
  const result = await withCloudResult<SmnTopic[]>([], listSmnTopics);
  const topics = result.data;
  const confirmedSubscriptions = topics.reduce(
    (total, topic) => total + (topic.subscriptionsConfirmed ?? 0),
    0,
  );
  const totalSubscriptions = topics.reduce(
    (total, topic) => total + (topic.subscriptionsTotal ?? 0),
    0,
  );
  const enterpriseProjects = new Set(
    topics.map((topic) => topic.enterpriseProjectId).filter(Boolean),
  );

  return (
    <ConsoleShell active="Monitoring">
      <CloudRefreshIndicator show={result.isRefreshing} />
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]" href="/services/monitoring">
              <ArrowLeft className="size-4" />
              Back to Monitoring
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#fff7ed] text-[#c2410c]">
                <BellRing className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">Simple Message Notification</h1>
                <p className="mt-1 max-w-3xl text-sm font-medium text-[#667085]">
                  Notification topics, subscription readiness, push policy, and project ownership.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Topic creation is disabled in this read-only view.">
              <Plus className="size-4" />
              Create topic
            </DisabledCloudButton>
            <RefreshButton />
          </div>
        </div>

        {result.error ? (
          <section className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#b42318]">
            {result.error}
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          {[
            ["Topics", topics.length],
            ["Subscriptions", totalSubscriptions],
            ["Confirmed", confirmedSubscriptions],
            ["Enterprise projects", enterpriseProjects.size],
          ].map(([label, value]) => (
            <div className="rounded-xl border border-[#e4e9f2] bg-white p-4 shadow-[0_12px_36px_rgba(16,24,40,0.04)]" key={label}>
              <p className="text-xs font-black uppercase text-[#667085]">{label}</p>
              <p className="mt-2 text-2xl font-black">{value}</p>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e4e9f2] bg-white shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="border-b border-[#e4e9f2] p-5">
            <h2 className="text-lg font-black">Notification topics</h2>
            <p className="mt-1 text-sm font-medium text-[#667085]">
              {topics.length} topics · Showing {result.isCached ? "cached" : "fresh"} data from{" "}
              <LocalDateTime value={result.updatedAt} />.
            </p>
          </div>
          {topics.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-[#f7f9fc] text-xs font-black uppercase text-[#667085]">
                  <tr>
                    <th className="px-5 py-3">Topic</th>
                    <th className="px-5 py-3">Delivery policy</th>
                    <th className="px-5 py-3">Subscriptions</th>
                    <th className="px-5 py-3">Enterprise project</th>
                    <th className="px-5 py-3">Project / region</th>
                    <th className="px-5 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {topics.map((topic) => (
                    <tr className="hover:bg-[#fbfcfe]" key={topic.topicUrn || topic.id}>
                      <td className="px-5 py-4 align-top">
                        <p className="font-black">{topic.name}</p>
                        <p className="mt-1 text-sm font-semibold text-[#667085]">{topic.displayName || "No display name"}</p>
                        <p className="mt-2 break-all text-xs font-semibold text-[#98a2b3]">{topic.topicUrn}</p>
                      </td>
                      <td className="px-5 py-4 align-top font-semibold">
                        <p className="inline-flex items-center gap-1">
                          <Radio className="size-3.5 text-[#c2410c]" />
                          {pushPolicyLabel(topic.pushPolicy)}
                        </p>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <p className="font-black">{topic.subscriptionsConfirmed ?? "-"} / {topic.subscriptionsTotal ?? "-"} confirmed</p>
                        <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#667085]">
                          <ShieldCheck className="size-3.5" />
                          Delivery targets are not modified from this view
                        </p>
                      </td>
                      <td className="px-5 py-4 align-top font-semibold">{topic.enterpriseProjectId || "-"}</td>
                      <td className="px-5 py-4 align-top font-semibold">
                        <p>{topic.projectName || topic.projectId || "-"}</p>
                        <p className="mt-1 text-xs text-[#667085]">{topic.region || "-"}</p>
                      </td>
                      <td className="px-5 py-4 align-top font-semibold">
                        <LocalDateTime value={topic.updatedAt || ""} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <p className="text-lg font-black">No SMN topics found</p>
                <p className="mt-2 text-sm font-semibold text-[#667085]">No notification topics were returned for the selected projects and regions.</p>
              </div>
            </div>
          )}
        </section>
      </main>
    </ConsoleShell>
  );
}
