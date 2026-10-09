"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Banknote,
  CalendarClock,
  Code2,
  Cpu,
  FileText,
  GitBranch,
  Globe2,
  Layers3,
  Loader2,
  MemoryStick,
  Play,
  Save,
  Settings2,
  ShieldAlert,
  Signal,
  Timer,
  TerminalSquare,
} from "lucide-react";

import { RefreshButton } from "@/components/cloud-action-buttons";
import {
  ConsoleButton,
  ConsoleCallout,
  ConsoleCheckbox,
  ConsoleCodeBlock,
  ConsoleDangerZone,
  ConsoleDescriptionList,
  ConsoleField,
  ConsoleInput,
  ConsoleInsetPanel,
  ConsoleLinkButton,
  ConsoleLogEntry,
  ConsolePanelBody,
  ConsoleSelect,
  ConsoleSplitActionChip,
  ConsoleSummaryTile,
  ConsoleSummaryTileGrid,
  ConsoleSurface,
  ConsoleTextarea,
} from "@/components/console-ui";
import { ConsoleTabNav } from "@/components/console-tabs";
import { DeleteFunctionGraphFunctionButton } from "@/components/functiongraph-actions";
import { FunctionGraphCodeViewer } from "@/components/functiongraph-code-viewer";
import { FunctionGraphConfigEditor } from "@/components/functiongraph-config-editor";
import { FunctionGraphTriggerPanel } from "@/components/functiongraph-trigger-panel";
import { FunctionGraphMonitoringPanel } from "@/components/functiongraph-monitoring-panel";
import { LocalDateTime } from "@/components/local-date-time";
import type { FunctionGraphFunction } from "@/lib/huawei-cloud";

type TabId =
  "code" | "configuration" | "triggers" | "monitoring" | "logs" | "invocations";

type InvokeResponse = {
  body?: unknown;
  error?: string;
  log?: string;
  requestId?: string;
  status?: number;
  summary?: string;
};

type MonitoringCostResponse = {
  monitoring?: {
    cost: {
      amount: number;
      billingCycle: string;
      currency: string;
      recordCount: number;
    } | null;
  };
};

type FunctionGraphLogsResponse = {
  error?: string;
  logs?: {
    count: number;
    entries: Array<{
      content: string;
      labels: Record<string, string>;
      lineNumber: string;
    }>;
    groupId: string;
    groupName: string;
    streamId: string;
    streamName: string;
  };
};

type SavedTestEvent = {
  id: string;
  name: string;
  value: string;
};

function parseLogConfig(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function valueText(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function baseFunctionGraphId(value: string) {
  if (!value.startsWith("urn:") || !value.includes(":function:")) {
    return value;
  }

  const [prefix, suffix] = value.split(":function:");
  const parts = suffix.split(":");

  if (parts.length >= 3) {
    return `${prefix}:function:${parts.slice(0, 2).join(":")}`;
  }

  return value;
}

function MonthlyCostSummaryItem({ functionId }: { functionId: string }) {
  const [label, setLabel] = useState("Loading...");

  useEffect(() => {
    let cancelled = false;

    async function loadCost() {
      try {
        const response = await fetch(
          `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/monitoring?timeframe=30d`,
          { cache: "no-store" },
        );
        const payload = (await response
          .json()
          .catch(() => ({}))) as MonitoringCostResponse;
        const cost = payload.monitoring?.cost;

        if (cancelled) {
          return;
        }

        if (!response.ok || !cost) {
          setLabel("Unavailable");
          return;
        }

        setLabel(
          new Intl.NumberFormat("en-US", {
            currency: cost.currency,
            style: "currency",
          }).format(cost.amount),
        );
      } catch {
        if (!cancelled) {
          setLabel("Unavailable");
        }
      }
    }

    void loadCost();

    return () => {
      cancelled = true;
    };
  }, [functionId]);

  return (
    <ConsoleSummaryTile
      icon={<Banknote className="size-4" />}
      label="Monthly cost"
      tone="emerald"
      value={label}
    />
  );
}

function PrettyResult({ value }: { value: unknown }) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);

  return (
    <ConsoleCodeBlock className="max-h-80 border-transparent bg-[#0b1220] text-[#dbeafe] dark:bg-[#0b1220] dark:text-[#dbeafe]">
      {text}
    </ConsoleCodeBlock>
  );
}

function FunctionGraphInvocationPanel({
  functionId,
  projectId,
}: {
  functionId: string;
  projectId: string;
}) {
  const templates = [
    { label: "Basic event", value: '{\n  "message": "hello"\n}' },
    {
      label: "API Gateway",
      value:
        '{\n  "httpMethod": "GET",\n  "path": "/",\n  "headers": {},\n  "queryStringParameters": {}\n}',
    },
    {
      label: "OBS event",
      value:
        '{\n  "Records": [\n    {\n      "eventName": "ObjectCreated:Put",\n      "obs": {\n        "bucket": { "name": "example-bucket" },\n        "object": { "key": "example.txt" }\n      }\n    }\n  ]\n}',
    },
  ];
  const [event, setEvent] = useState(templates[0].value);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [message, setMessage] = useState("");
  const [eventName, setEventName] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<InvokeResponse | null>(null);
  const storageKey = `functiongraph-test-events:${functionId}`;
  const [savedEvents, setSavedEvents] = useState<SavedTestEvent[]>([]);
  const validJson = useMemo(() => {
    try {
      JSON.parse(event || "{}");
      return true;
    } catch {
      return false;
    }
  }, [event]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        const parsed = stored ? (JSON.parse(stored) as SavedTestEvent[]) : [];
        setSavedEvents(Array.isArray(parsed) ? parsed : []);
      } catch {
        setSavedEvents([]);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [storageKey]);

  function persistSavedEvents(nextEvents: SavedTestEvent[]) {
    setSavedEvents(nextEvents);
    window.localStorage.setItem(storageKey, JSON.stringify(nextEvents));
  }

  function saveCurrentEvent() {
    if (!validJson) {
      setMessage("Fix the JSON before saving this test event.");
      return;
    }

    const name = eventName.trim() || `Test event ${savedEvents.length + 1}`;
    const nextEvents = [
      { id: `${Date.now()}`, name, value: event },
      ...savedEvents.filter((item) => item.name !== name),
    ].slice(0, 12);
    persistSavedEvents(nextEvents);
    setEventName("");
    setMessage(`Saved ${name}.`);
  }

  function deleteSavedEvent(id: string) {
    persistSavedEvents(savedEvents.filter((item) => item.id !== id));
  }

  async function invoke() {
    setPending(true);
    setMessage("");
    setResult(null);

    try {
      const response = await fetch(
        `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/invoke`,
        {
          body: JSON.stringify({ event, includeLogs, projectId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const payload = (await response
        .json()
        .catch(() => ({}))) as InvokeResponse;

      if (!response.ok) {
        throw new Error(
          payload.error || `Invocation returned ${response.status}.`,
        );
      }

      setResult(payload);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to invoke FunctionGraph function.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <ConsoleSurface
      actions={
        <ConsoleButton
          disabled={pending || !validJson}
          onClick={invoke}
          size="md"
          variant="success"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          Invoke
        </ConsoleButton>
      }
      description="Send a synchronous event, inspect the response body, and capture tail logs from the run."
      title="Test invocation"
    >
      <ConsolePanelBody gap="md">
        <div className="flex flex-wrap gap-2">
          {templates.map((template) => (
            <ConsoleButton
              key={template.label}
              onClick={() => setEvent(template.value)}
              size="sm"
              variant="primaryOutline"
            >
              {template.label}
            </ConsoleButton>
          ))}
        </div>

        <ConsoleInsetPanel className="grid gap-3 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <ConsoleField
              className="flex-1 font-black text-[#101828] dark:text-white"
              label="Save current event as"
            >
              <ConsoleInput
                className="h-10"
                onChange={(input) => setEventName(input.target.value)}
                placeholder="Smoke test, OBS upload, API health check"
                value={eventName}
              />
            </ConsoleField>
            <ConsoleButton
              disabled={!validJson}
              onClick={saveCurrentEvent}
              size="md"
            >
              <Save className="size-4" />
              Save test event
            </ConsoleButton>
          </div>
          {savedEvents.length ? (
            <div className="flex flex-wrap gap-2">
              {savedEvents.map((saved) => (
                <ConsoleSplitActionChip
                  actionLabel={`Load saved event ${saved.name}`}
                  key={saved.id}
                  onAction={() => {
                    setEvent(saved.value);
                    setMessage("");
                  }}
                  onRemove={() => deleteSavedEvent(saved.id)}
                  removeLabel={`Delete saved event ${saved.name}`}
                >
                  {saved.name}
                </ConsoleSplitActionChip>
              ))}
            </div>
          ) : null}
        </ConsoleInsetPanel>

        <ConsoleField
          className="font-black text-[#101828] dark:text-white"
          label="Event JSON"
        >
          <ConsoleTextarea
            className="min-h-72 rounded-xl bg-[#0b1220] px-4 py-3 font-mono text-xs leading-5 text-[#dbeafe] dark:bg-[#0b1220] dark:text-[#dbeafe]"
            focusTone="success"
            onChange={(input) => setEvent(input.target.value)}
            spellCheck={false}
            value={event}
          />
        </ConsoleField>

        <ConsoleCheckbox
          checked={includeLogs}
          label="Include tail logs"
          onChange={(input) => setIncludeLogs(input.target.checked)}
        />

        {!validJson ? (
          <ConsoleCallout tone="warning">
            Event payload must be valid JSON.
          </ConsoleCallout>
        ) : null}
      </ConsolePanelBody>

      {message ? (
        <ConsoleCallout className="rounded-lg px-3 py-2" tone="danger">
          {message}
        </ConsoleCallout>
      ) : null}

      {result ? (
        <div className="grid gap-3">
          <ConsoleCallout className="rounded-lg p-3" tone="success">
            Status {result.status ?? 200}
            {result.requestId ? ` · Request ${result.requestId}` : ""}
            {result.summary ? ` · ${result.summary}` : ""}
          </ConsoleCallout>
          <PrettyResult value={result.body} />
          {result.log ? (
            <ConsoleCodeBlock>{result.log}</ConsoleCodeBlock>
          ) : null}
        </div>
      ) : null}
    </ConsoleSurface>
  );
}

function FunctionGraphLogsPanel({ fn }: { fn: FunctionGraphFunction }) {
  const config = parseLogConfig(fn.logConfig);
  const groupName = valueText(config.group_name ?? config.groupName);
  const groupId = valueText(config.group_id ?? config.groupId);
  const streamName = valueText(config.stream_name ?? config.streamName);
  const streamId = valueText(config.stream_id ?? config.streamId);
  const enabled = fn.enableLtsLog === "true" || fn.enableLtsLog === "Enabled";
  const [keywords, setKeywords] = useState("");
  const [logs, setLogs] = useState<FunctionGraphLogsResponse["logs"] | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [timeframe, setTimeframe] = useState("1h");

  async function loadLogs() {
    setPending(true);
    setMessage("Loading logs from LTS...");

    try {
      const query = new URLSearchParams({
        limit: "50",
        projectId: fn.projectId,
        timeframe,
      });

      if (keywords.trim()) {
        query.set("keywords", keywords.trim());
      }

      const response = await fetch(
        `/api/cloud/functiongraph/${encodeURIComponent(fn.id || fn.urn || fn.name)}/logs?${query.toString()}`,
        { cache: "no-store" },
      );
      const payload = (await response
        .json()
        .catch(() => ({}))) as FunctionGraphLogsResponse;

      if (!response.ok || !payload.logs) {
        throw new Error(
          payload.error || `LTS query returned ${response.status}.`,
        );
      }

      setLogs(payload.logs);
      setMessage(
        payload.logs.entries.length ? "" : "No LTS logs matched this query.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load FunctionGraph logs.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <ConsoleSurface
      actions={
        <ConsoleLinkButton
          href="/services/lts"
          size="md"
          variant="primaryOutline"
        >
          <FileText className="size-4" />
          Open LTS
        </ConsoleLinkButton>
      }
      description="FunctionGraph logging configuration and recent tail-log workflow."
      title="Logs"
    >
      <ConsolePanelBody>
        <ConsoleSummaryTileGrid className="lg:grid-cols-4">
          <ConsoleSummaryTile
            icon={<TerminalSquare className="size-4" />}
            label="LTS logging"
            tone={enabled ? "emerald" : "orange"}
            value={enabled ? "Enabled" : fn.enableLtsLog || "Disabled"}
          />
          <ConsoleSummaryTile
            icon={<Layers3 className="size-4" />}
            label="Log group"
            tone="blue"
            value={groupName}
          />
          <ConsoleSummaryTile
            icon={<FileText className="size-4" />}
            label="Log stream"
            tone="violet"
            value={streamName}
          />
          <ConsoleSummaryTile
            icon={<Globe2 className="size-4" />}
            label="Project"
            tone="cyan"
            value={`${fn.projectName} · ${fn.region}`}
          />
        </ConsoleSummaryTileGrid>

        <ConsoleInsetPanel className="grid gap-3 p-4 lg:grid-cols-[1fr_180px_auto] lg:items-end">
          <ConsoleField
            className="font-black text-[#101828] dark:text-white"
            label="Keyword"
          >
            <ConsoleInput
              className="h-10"
              onChange={(input) => setKeywords(input.target.value)}
              placeholder="error, request id, message"
              value={keywords}
            />
          </ConsoleField>
          <ConsoleField
            className="font-black text-[#101828] dark:text-white"
            label="Timeframe"
          >
            <ConsoleSelect
              className="h-10"
              onChange={(input) => setTimeframe(input.target.value)}
              value={timeframe}
            >
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="6h">6h</option>
              <option value="24h">24h</option>
            </ConsoleSelect>
          </ConsoleField>
          <ConsoleButton
            disabled={pending || groupId === "-" || streamId === "-"}
            onClick={loadLogs}
            size="md"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <TerminalSquare className="size-4" />
            )}
            Query logs
          </ConsoleButton>
        </ConsoleInsetPanel>

        <ConsoleInsetPanel className="grid gap-3 p-4">
          <h3 className="text-sm font-black text-[#101828] dark:text-white">
            LTS target
          </h3>
          <ConsoleDescriptionList
            columns={2}
            items={[
              { label: "Group ID", value: groupId },
              { label: "Stream ID", value: streamId },
            ]}
          />
        </ConsoleInsetPanel>

        <ConsoleInsetPanel dashed>
          <div className="flex items-center gap-2 text-sm font-black text-[#101828] dark:text-white">
            <TerminalSquare className="size-4 text-[#2563eb] dark:text-[#93c5fd]" />
            Recent execution logs
          </div>
          {message ? (
            <p className="mt-2 text-sm font-semibold leading-6 text-[#667085] dark:text-[#98a2b3]">
              {message}
            </p>
          ) : null}
          {logs?.entries.length ? (
            <div className="mt-4 grid gap-2">
              {logs.entries.map((entry, index) => (
                <ConsoleLogEntry
                  key={entry.lineNumber || `${entry.content}-${index}`}
                  labels={Object.entries(entry.labels)
                    .slice(0, 6)
                    .map(([label, value]) => ({ label, value }))}
                >
                  {entry.content}
                </ConsoleLogEntry>
              ))}
            </div>
          ) : null}
        </ConsoleInsetPanel>
      </ConsolePanelBody>
    </ConsoleSurface>
  );
}

export function FunctionGraphFunctionWorkspace({
  fn,
  functionId,
}: {
  fn: FunctionGraphFunction;
  functionId: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("code");
  const [mountedTabs, setMountedTabs] = useState<Set<TabId>>(
    () => new Set(["code"]),
  );
  const apiFunctionId = baseFunctionGraphId(fn.urn || fn.id || functionId);
  const tabs: Array<{ id: TabId; icon: ReactNode; label: string }> = [
    { id: "code", icon: <Code2 className="size-4" />, label: "Code" },
    {
      id: "configuration",
      icon: <Settings2 className="size-4" />,
      label: "Configuration",
    },
    {
      id: "triggers",
      icon: <GitBranch className="size-4" />,
      label: "Triggers",
    },
    {
      id: "monitoring",
      icon: <Activity className="size-4" />,
      label: "Monitoring",
    },
    { id: "logs", icon: <FileText className="size-4" />, label: "Logs" },
    {
      id: "invocations",
      icon: <Play className="size-4" />,
      label: "Invocations",
    },
  ];

  return (
    <div className="grid gap-6">
      <ConsoleSummaryTileGrid className="lg:grid-cols-7">
        <ConsoleSummaryTile
          icon={<Signal className="size-4" />}
          label="Status"
          tone="emerald"
          value="Active"
        />
        <ConsoleSummaryTile
          icon={<Cpu className="size-4" />}
          label="Runtime"
          tone="violet"
          value={fn.runtime}
        />
        <ConsoleSummaryTile
          icon={<MemoryStick className="size-4" />}
          label="Memory"
          tone="indigo"
          value={fn.memorySize}
        />
        <ConsoleSummaryTile
          icon={<Timer className="size-4" />}
          label="Timeout"
          tone="orange"
          value={fn.timeout}
        />
        <ConsoleSummaryTile
          icon={<Globe2 className="size-4" />}
          label="Region"
          tone="cyan"
          value={fn.region}
        />
        <ConsoleSummaryTile
          icon={<CalendarClock className="size-4" />}
          label="Modified"
          tone="fuchsia"
          value={
            fn.lastModified ? <LocalDateTime value={fn.lastModified} /> : "-"
          }
        />
        <MonthlyCostSummaryItem functionId={apiFunctionId} />
      </ConsoleSummaryTileGrid>

      <ConsoleSurface>
        <ConsoleTabNav
          activeId={activeTab}
          ariaLabel="FunctionGraph function workflows"
          idPrefix="functiongraph"
          onSelect={(tabId) => {
            setActiveTab(tabId);
            setMountedTabs((current) => new Set(current).add(tabId));
          }}
          tabs={tabs}
          variant="pills"
        />
        <div className="bg-[#f8fafc] p-4 dark:bg-[#07111f]">
          <div
            hidden={activeTab !== "code"}
            id="functiongraph-panel-code"
            role="tabpanel"
            aria-labelledby="functiongraph-tab-code"
          >
            <FunctionGraphCodeViewer
              codeFile={fn.codeFile}
              codePayload={fn.codePayload}
              codeSize={fn.codeSize}
              codeText={fn.codeText}
              codeType={fn.codeType}
              functionId={apiFunctionId}
              handler={fn.handler}
              projectId={fn.projectId}
              runtime={fn.runtime}
            />
          </div>
          <div
            hidden={activeTab !== "configuration"}
            id="functiongraph-panel-configuration"
            role="tabpanel"
            aria-labelledby="functiongraph-tab-configuration"
          >
            {mountedTabs.has("configuration") ? (
              <FunctionGraphConfigEditor fn={fn} functionId={apiFunctionId} />
            ) : null}
          </div>
          <div
            hidden={activeTab !== "triggers"}
            id="functiongraph-panel-triggers"
            role="tabpanel"
            aria-labelledby="functiongraph-tab-triggers"
          >
            {mountedTabs.has("triggers") ? (
              <ConsoleSurface className="p-5">
                <FunctionGraphTriggerPanel
                  functionId={apiFunctionId}
                  functionName={fn.name}
                  projectId={fn.projectId}
                />
              </ConsoleSurface>
            ) : null}
          </div>
          <div
            hidden={activeTab !== "monitoring"}
            id="functiongraph-panel-monitoring"
            role="tabpanel"
            aria-labelledby="functiongraph-tab-monitoring"
          >
            {mountedTabs.has("monitoring") ? (
              <ConsoleSurface className="p-5">
                <FunctionGraphMonitoringPanel functionId={apiFunctionId} />
              </ConsoleSurface>
            ) : null}
          </div>
          <div
            hidden={activeTab !== "logs"}
            id="functiongraph-panel-logs"
            role="tabpanel"
            aria-labelledby="functiongraph-tab-logs"
          >
            {mountedTabs.has("logs") ? (
              <FunctionGraphLogsPanel fn={fn} />
            ) : null}
          </div>
          <div
            hidden={activeTab !== "invocations"}
            id="functiongraph-panel-invocations"
            role="tabpanel"
            aria-labelledby="functiongraph-tab-invocations"
          >
            {mountedTabs.has("invocations") ? (
              <FunctionGraphInvocationPanel
                functionId={apiFunctionId}
                projectId={fn.projectId}
              />
            ) : null}
          </div>
        </div>
      </ConsoleSurface>

      <ConsoleDangerZone
        actions={
          <>
            <RefreshButton />
            <DeleteFunctionGraphFunctionButton
              functionId={fn.id || fn.urn || fn.name}
              functionName={fn.name}
              projectId={fn.projectId}
              size="md"
            />
          </>
        }
        icon={<ShieldAlert className="size-5" />}
      >
        Destructive actions are separated from normal editing and require
        confirmation.
      </ConsoleDangerZone>
    </div>
  );
}
