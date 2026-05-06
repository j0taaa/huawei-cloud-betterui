import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Box, KeyRound, UploadCloud } from "lucide-react";

import {
  DisabledCloudButton,
  RefreshButton,
} from "@/components/cloud-action-buttons";
import { ConsoleShell } from "@/components/console-shell";

export const metadata: Metadata = {
  title: "OBS | Huawei Cloud Better UI",
};

export default function ObsPage() {
  return (
    <ConsoleShell active="Storage">
      <main className="grid gap-6 p-4 lg:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]" href="/">
              <ArrowLeft className="size-4" />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-[#e9f8f1] text-[#16a34a]">
                <Box className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight">
                  Object Storage Service
                </h1>
                <p className="mt-1 text-sm font-medium text-[#667085]">
                  OBS real-data support requires signed OBS requests.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <DisabledCloudButton title="Bucket creation needs OBS signed request support first.">
              <Box className="size-4" />
              Create bucket
            </DisabledCloudButton>
            <DisabledCloudButton title="Object upload needs OBS signed request support first.">
              <UploadCloud className="size-4" />
              Upload object
            </DisabledCloudButton>
            <RefreshButton />
          </div>
        </div>

        <section className="rounded-xl border border-[#dbe7ff] bg-[#f5f8ff] p-6 shadow-[0_12px_36px_rgba(16,24,40,0.06)]">
          <div className="flex gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-white text-[#2563eb] shadow-sm">
              <KeyRound className="size-6" />
            </div>
            <div>
              <h2 className="text-xl font-black">OBS is intentionally deferred</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#475467]">
                ECS, EVS, VPC, ELB, CCE, and RDS use the IAM token in the
                current Better UI session. Normal OBS bucket/object APIs use
                AK/SK-style request signing or temporary AK/SK credentials, so
                this page no longer displays fake buckets or objects.
              </p>
            </div>
          </div>
        </section>
      </main>
    </ConsoleShell>
  );
}
