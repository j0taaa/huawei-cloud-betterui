import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import Link from "next/link";
import {
  BellRing,
  Boxes,
  Code2,
  Cpu,
  DatabaseZap,
  GitBranch,
  PackageSearch,
  PackagePlus,
  Plus,
  Timer,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import { CloudRefreshIndicator } from "@/components/cloud-refresh-indicator";
import {
  ConsoleMain,
  ConsoleCallout,
  ConsoleInlineRowList,
  ConsoleIconTile,
  ConsolePageHeader,
  ConsoleMutedText,
  ConsolePanel,
  ConsoleResourceLink,
  ConsoleSplitLayout,
  DataFreshnessText,
  MetricCard,
  MetricGrid,
  SimpleTable,
  type SimpleTableRow,
} from "@/components/console-ui";
import { ConsoleShell } from "@/components/console-shell";
import {
  DeleteFunctionGraphFunctionButton,
  InvokeFunctionGraphFunctionButton,
} from "@/components/functiongraph-actions";
import { FunctionGraphDependenciesTable } from "@/components/functiongraph-dependencies-table";
import { FunctionGraphMainTabs } from "@/components/functiongraph-main-tabs";
import { FunctionGraphTriggerTypeTabs } from "@/components/functiongraph-trigger-type-tabs";
import { LocalDateTime } from "@/components/local-date-time";
import {
  listFunctionGraphDependencyInventory,
  listFunctionGraphFunctions,
  listFunctionGraphProjectOptions,
  listFunctionGraphTriggerInventory,
  withCloudResult,
} from "@/lib/huawei-cloud";
import type {
  FunctionGraphFunction,
  FunctionGraphTrigger,
  FunctionGraphTriggerInventoryItem,
} from "@/lib/huawei-cloud/types";

export const metadata: Metadata = {
  title: "FunctionGraph | Huawei Cloud Better UI",
};

function functionId(fn: FunctionGraphFunction) {
  return fn.id || fn.urn || fn.name;
}

function functionHref(id: string) {
  return `/services/functiongraph/${encodeURIComponent(id)}`;
}

function parseConfig(value: string) {
  if (!value || value === "-") {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function textField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function shortResourceName(value: string) {
  if (!value) {
    return "";
  }

  const parts = value.split(":").filter(Boolean);
  return parts.at(-1) || value;
}

function triggerSummary(trigger: FunctionGraphTrigger) {
  const eventData = parseConfig(trigger.eventData);
  const name = trigger.name && trigger.name !== "-" ? trigger.name : "";

  if (trigger.triggerTypeCode === "TIMER") {
    const schedule = textField(eventData, ["schedule"]);
    const scheduleType = textField(eventData, [
      "schedule_type",
      "scheduleType",
    ]);
    return {
      detail:
        [scheduleType, schedule].filter(Boolean).join(" · ") ||
        "Timer schedule",
      title: name || textField(eventData, ["name"]) || "Timer trigger",
    };
  }

  if (trigger.triggerTypeCode === "SMN") {
    const topicUrn = textField(eventData, ["topic_urn", "topicUrn"]);
    return {
      detail: topicUrn ? `Topic: ${shortResourceName(topicUrn)}` : "SMN topic",
      title: name || "SMN notification trigger",
    };
  }

  if (trigger.triggerTypeCode === "OBS") {
    const bucket = textField(eventData, [
      "bucket",
      "bucket_name",
      "bucketName",
    ]);
    const events = textField(eventData, [
      "events",
      "event",
      "event_type",
      "eventType",
    ]);
    return {
      detail:
        [bucket && `Bucket: ${bucket}`, events].filter(Boolean).join(" · ") ||
        "OBS events",
      title: name || bucket || "OBS trigger",
    };
  }

  if (
    trigger.triggerTypeCode === "APIG" ||
    trigger.triggerTypeCode === "APIC"
  ) {
    const method = textField(eventData, ["req_method", "reqMethod", "method"]);
    const path = textField(eventData, ["path"]);
    const protocol = textField(eventData, ["protocol"]);
    return {
      detail:
        [method, path, protocol].filter(Boolean).join(" · ") || "API request",
      title: name || path || "API trigger",
    };
  }

  const instance = textField(eventData, ["instance_id", "instanceId"]);
  const collection = textField(eventData, [
    "collection_name",
    "collectionName",
    "db_name",
    "dbName",
  ]);

  return {
    detail:
      [collection, instance && `Instance: ${shortResourceName(instance)}`]
        .filter(Boolean)
        .join(" · ") || `${trigger.triggerTypeCode} event source`,
    title: name || `${trigger.triggerTypeCode} trigger`,
  };
}

function FunctionGraphTriggerTable({
  triggers,
}: {
  triggers: FunctionGraphTriggerInventoryItem[];
}) {
  const rows: SimpleTableRow[] = triggers.map((trigger) => {
    const summary = triggerSummary(trigger);

    return {
      className: "align-top hover:bg-[#fbfcfe] dark:hover:bg-white/5",
      key: `${trigger.projectId}:${trigger.functionUrn}:${trigger.triggerTypeCode}:${trigger.id}`,
      cells: [
        <div className="flex items-start gap-3" key="trigger">
          <ConsoleIconTile
            className="bg-[#eff6ff] text-[#2563eb] dark:bg-white/10 dark:text-[#93c5fd]"
            size="md"
          >
            <BellRing className="size-5" />
          </ConsoleIconTile>
          <div>
            <p className="font-black">{summary.title}</p>
            <p className="mt-1 break-all font-mono text-[11px] font-semibold text-[#98a2b3]">
              {trigger.id}
            </p>
          </div>
        </div>,
        <span
          className="rounded-full bg-[#ecfdf3] px-2 py-1 text-xs font-black text-[#027a48] dark:bg-[#052e16] dark:text-[#86efac]"
          key="status"
        >
          {trigger.status}
        </span>,
        <ConsoleResourceLink
          href={functionHref(trigger.functionId)}
          key="function"
        >
          {trigger.functionName}
        </ConsoleResourceLink>,
        <span
          className="font-semibold text-[#667085] dark:text-[#98a2b3]"
          key="detail"
        >
          {summary.detail}
        </span>,
        <span className="font-semibold" key="project">
          {trigger.projectName}
          <span className="mt-1 block text-xs text-[#667085] dark:text-[#98a2b3]">
            {trigger.region}
          </span>
        </span>,
        <LocalDateTime
          key="updated"
          value={trigger.updatedAt || trigger.createdAt}
        />,
      ],
    };
  });

  return (
    <SimpleTable
      columns={[
        { header: "Trigger" },
        { header: "Status" },
        { header: "Function" },
        { header: "Event detail" },
        { header: "Project" },
        { header: "Updated" },
      ]}
      emptyState={
        <ConsoleMutedText weight="semibold">
          No triggers found for this type.
        </ConsoleMutedText>
      }
      minWidthClassName="min-w-[1080px]"
      rows={rows}
    />
  );
}

export default async function FunctionGraphPage() {
  const [result, projectResult, triggerResult, dependencyResult] =
    await Promise.all([
      withCloudResult(
        [],
        listFunctionGraphFunctions,
        cloudCacheKeys.listFunctionGraphFunctions,
      ),
      withCloudResult(
        [],
        listFunctionGraphProjectOptions,
        "functiongraph-projects",
      ),
      withCloudResult(
        [],
        listFunctionGraphTriggerInventory,
        cloudCacheKeys.functionGraphTriggers,
      ),
      withCloudResult(
        [],
        listFunctionGraphDependencyInventory,
        "functiongraph-managed-dependencies-v1",
      ),
    ]);
  const functions = result.data;
  const triggers = triggerResult.data;
  const dependencies = dependencyResult.data;
  const reservedFunctions = functions.filter(
    (fn) => (Number(fn.reservedInstances) || 0) > 0,
  );
  const runtimes = new Set(functions.map((fn) => fn.runtime).filter(Boolean));
  const packages = new Set(
    functions.map((fn) => fn.packageName).filter(Boolean),
  );
  const triggerTypes = Array.from(
    new Set(triggers.map((trigger) => trigger.triggerTypeCode || "Unknown")),
  ).sort((left, right) => left.localeCompare(right));
  const reserved = functions.reduce(
    (sum, fn) => sum + (Number(fn.reservedInstances) || 0),
    0,
  );
  const functionRows: SimpleTableRow[] = functions.map((item) => {
    const id = functionId(item);
    const href = functionHref(id);

    return {
      className: "align-top hover:bg-[#fbfcfe] dark:hover:bg-white/5",
      key: `${item.projectId}:${item.urn || item.id}`,
      cells: [
        <div key="function">
          <ConsoleResourceLink href={href}>{item.name}</ConsoleResourceLink>
          <p className="mt-1 text-xs font-bold text-[#667085] dark:text-[#98a2b3]">
            {item.packageName} · {item.version}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] font-semibold text-[#98a2b3]">
            {item.urn}
          </p>
        </div>,
        <span key="runtime">{item.runtime}</span>,
        <span key="handler">{item.handler}</span>,
        <span key="shape">
          {item.memorySize} · {item.timeout}
          <span className="mt-1 block text-xs text-[#667085] dark:text-[#98a2b3]">
            CPU {item.cpu} · concurrency {item.strategyConcurrency}
          </span>
        </span>,
        <span key="code">
          {item.codeType || "-"}
          <span className="mt-1 block text-xs text-[#667085] dark:text-[#98a2b3]">
            {item.codeSize}
          </span>
        </span>,
        <span key="project">
          {item.projectName}
          <span className="mt-1 block text-xs text-[#667085] dark:text-[#98a2b3]">
            {item.region}
          </span>
        </span>,
        <LocalDateTime key="lastModified" value={item.lastModified} />,
        <div className="flex flex-wrap gap-2" key="actions">
          <InvokeFunctionGraphFunctionButton
            functionId={id}
            projectId={item.projectId}
            size="sm"
          />
          <DeleteFunctionGraphFunctionButton
            functionId={id}
            functionName={item.name}
            projectId={item.projectId}
          />
        </div>,
      ],
    };
  });
  const reservedRows: SimpleTableRow[] = reservedFunctions.map((fn) => ({
    className: "align-top hover:bg-[#fbfcfe] dark:hover:bg-white/5",
    key: `${fn.projectId}:${fn.urn || fn.id}:reserved`,
    cells: [
      <ConsoleResourceLink href={functionHref(functionId(fn))} key="function">
        {fn.name}
      </ConsoleResourceLink>,
      <span
        className="rounded-full bg-[#dcfce7] px-3 py-1 text-sm font-black text-[#166534] dark:bg-[#052e16] dark:text-[#86efac]"
        key="reserved"
      >
        {fn.reservedInstances}
      </span>,
      <span key="runtime">{fn.runtime}</span>,
      <span key="shape">
        {fn.memorySize} · {fn.timeout}
      </span>,
      <span key="project">{fn.projectName}</span>,
      <span className="text-[#667085] dark:text-[#98a2b3]" key="region">
        {fn.region}
      </span>,
    ],
  }));

  return (
    <ConsoleShell active="Compute">
      <CloudRefreshIndicator
        show={
          result.isRefreshing ||
          projectResult.isRefreshing ||
          triggerResult.isRefreshing ||
          dependencyResult.isRefreshing
        }
      />
      <ConsoleMain background="muted">
        <ConsolePageHeader
          actions={
            <>
              <Link
                className="flex h-11 items-center gap-2 rounded-lg border border-[#7c3aed] bg-[#7c3aed] px-4 text-sm font-bold text-white shadow-sm hover:bg-[#6d28d9]"
                href="/services/functiongraph/manage?operation=create"
              >
                <Plus className="size-4" />
                Create function
              </Link>
              <RefreshButton />
            </>
          }
          backHref="/services/compute"
          backLabel="Back to Compute"
          description="Serverless functions with runnable test events, inline creation, code metadata, and guarded deletion."
          icon={Code2}
          iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
          title="FunctionGraph"
        />

        {result.error ||
        projectResult.error ||
        triggerResult.error ||
        dependencyResult.error ? (
          <ConsoleCallout>
            {result.error ||
              projectResult.error ||
              triggerResult.error ||
              dependencyResult.error}
          </ConsoleCallout>
        ) : null}

        <MetricGrid columns={5}>
          <MetricCard
            icon={Code2}
            iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
            label="Functions"
            value={String(functions.length)}
            variant="compact"
          />
          <MetricCard
            icon={Boxes}
            iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
            label="Packages"
            value={String(packages.size)}
            variant="compact"
          />
          <MetricCard
            icon={Cpu}
            iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
            label="Runtimes"
            value={String(runtimes.size)}
            variant="compact"
          />
          <MetricCard
            icon={GitBranch}
            iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
            label="Triggers"
            value={String(triggers.length)}
            variant="compact"
          />
          <MetricCard
            icon={DatabaseZap}
            iconClassName="bg-[#f5f3ff] text-[#7c3aed]"
            label="Reserved"
            value={String(reserved)}
            variant="compact"
          />
        </MetricGrid>

        <ConsoleSplitLayout
          breakpoint="lg"
          className="gap-4"
          order="sidebar-main"
          sidebarWidth="280"
        >
          <aside className="grid content-start gap-4">
            <ConsolePanel className="p-5" title="Runtime mix">
              <ConsoleInlineRowList
                className="mt-4"
                emptyState="No runtime data."
                items={Array.from(runtimes).map((runtime) => ({
                  key: runtime,
                  label: runtime,
                  value: functions.filter((fn) => fn.runtime === runtime)
                    .length,
                }))}
              />
            </ConsolePanel>
            <ConsolePanel className="p-5" title="Inventory state">
              <ConsoleMutedText className="mt-2" weight="semibold">
                <DataFreshnessText
                  isCached={result.isCached}
                  updatedAt={result.updatedAt}
                />
              </ConsoleMutedText>
            </ConsolePanel>
          </aside>

          <FunctionGraphMainTabs
            dependencies={
              <ConsolePanel
                actions={
                  <Link
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2563eb] px-4 text-sm font-black text-white shadow-sm transition hover:bg-[#1d4ed8]"
                    href="/services/functiongraph/dependencies/create"
                  >
                    <PackagePlus className="size-4" />
                    Add dependency
                  </Link>
                }
                className="rounded-none border-0 shadow-none"
                description="Managed FunctionGraph dependency packages available in the selected projects."
                icon={PackageSearch}
                iconClassName="text-[#be185d]"
                title="Code dependencies"
              >
                <FunctionGraphDependenciesTable dependencies={dependencies} />
              </ConsolePanel>
            }
            dependencyCount={dependencies.length}
            functions={
              <ConsolePanel
                className="rounded-none border-0 shadow-none"
                description="Invoke, inspect, and remove functions across selected projects."
                icon={Timer}
                iconClassName="text-[#7c3aed]"
                title="Functions"
              >
                <SimpleTable
                  columns={[
                    { header: "Function" },
                    { header: "Runtime" },
                    { header: "Handler" },
                    { header: "Shape" },
                    { header: "Code" },
                    { header: "Project" },
                    { header: "Last modified" },
                    { header: "Actions" },
                  ]}
                  emptyState={
                    <div>
                      <p className="text-lg font-black">
                        No FunctionGraph functions found
                      </p>
                      <ConsoleMutedText className="mt-2" weight="semibold">
                        Create an inline function or refresh after selecting
                        projects with FunctionGraph resources.
                      </ConsoleMutedText>
                    </div>
                  }
                  minWidthClassName="min-w-[1240px]"
                  rows={functionRows}
                />
              </ConsolePanel>
            }
            functionCount={functions.length}
            reserved={
              <ConsolePanel
                className="rounded-none border-0 shadow-none"
                description="Functions with reserved execution capacity."
                icon={DatabaseZap}
                iconClassName="text-[#16a34a]"
                title="Reserved instances"
              >
                <SimpleTable
                  columns={[
                    { header: "Function" },
                    { header: "Reserved instances" },
                    { header: "Runtime" },
                    { header: "Shape" },
                    { header: "Project" },
                    { header: "Region" },
                  ]}
                  emptyState={
                    <ConsoleMutedText weight="semibold">
                      No functions currently report reserved instances.
                    </ConsoleMutedText>
                  }
                  minWidthClassName="min-w-[920px]"
                  rows={reservedRows}
                />
              </ConsolePanel>
            }
            reservedCount={reservedFunctions.length}
            triggers={
              <ConsolePanel
                className="rounded-none border-0 shadow-none"
                description="Event sources grouped by trigger kind."
                icon={GitBranch}
                title="Triggers"
              >
                <FunctionGraphTriggerTypeTabs
                  tabs={triggerTypes.map((triggerType) => {
                    const triggerGroup = triggers.filter(
                      (trigger) =>
                        (trigger.triggerTypeCode || "Unknown") === triggerType,
                    );

                    return {
                      content: (
                        <FunctionGraphTriggerTable triggers={triggerGroup} />
                      ),
                      count: triggerGroup.length,
                      id: triggerType,
                      label: triggerType,
                    };
                  })}
                />
              </ConsolePanel>
            }
            triggerCount={triggers.length}
          />
        </ConsoleSplitLayout>
      </ConsoleMain>
    </ConsoleShell>
  );
}
