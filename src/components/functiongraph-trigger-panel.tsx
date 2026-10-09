"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  FileText,
  GitBranch,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  ConsoleButton,
  ConsoleEyebrow,
  ConsoleField,
  ConsoleIconButton,
  ConsoleInlineMessage,
  ConsoleInput,
  ConsoleInsetPanel,
  ConsolePill,
  ConsoleSelect,
  ConsoleTextarea,
} from "@/components/console-ui";
import type { FunctionGraphTrigger } from "@/lib/huawei/services/functiongraph.types";
const triggerTypeOptions = [
  "TIMER",
  "APIG",
  "CTS",
  "DDS",
  "DMS",
  "DIS",
  "LTS",
  "OBS",
  "SMN",
  "KAFKA",
  "RABBITMQ",
  "DEDICATEDGATEWAY",
  "OPENSOURCEKAFKA",
  "APIC",
  "GAUSSMONGO",
  "EVENTGRID",
  "IOTDA",
];

const triggerStatusOptions = ["ACTIVE", "DISABLED"];

type TriggerForm = {
  eventData: string;
  eventTypeCode: string;
  triggerStatus: string;
  triggerTypeCode: string;
};

function defaultEventData(triggerTypeCode: string) {
  if (triggerTypeCode === "TIMER") {
    return JSON.stringify(
      {
        name: "timer-trigger",
        schedule: "3m",
        schedule_type: "Rate",
        user_event: "",
      },
      null,
      2,
    );
  }

  if (triggerTypeCode === "SMN") {
    return JSON.stringify({ topic_urn: "" }, null, 2);
  }

  return "{}";
}

function parseTriggerEventData(value: string) {
  try {
    return JSON.parse(value || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function textField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" || typeof value === "boolean") {
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
  const eventData = parseTriggerEventData(trigger.eventData);
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

export function FunctionGraphTriggerPanel({
  functionName,
  functionId,
  projectId,
}: {
  functionName?: string;
  functionId: string;
  projectId: string;
}) {
  const [triggers, setTriggers] = useState<FunctionGraphTrigger[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<TriggerForm>({
    eventData: defaultEventData("TIMER"),
    eventTypeCode: "",
    triggerStatus: "ACTIVE",
    triggerTypeCode: "TIMER",
  });
  const [editForm, setEditForm] = useState<TriggerForm>({
    eventData: "{}",
    eventTypeCode: "",
    triggerStatus: "ACTIVE",
    triggerTypeCode: "TIMER",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const loadTriggers = useCallback(async () => {
    setIsLoading(true);
    setMessage("Loading triggers...");

    try {
      const query = new URLSearchParams({ projectId });
      const response = await fetch(
        `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/triggers?${query.toString()}`,
        { cache: "no-store" },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        triggers?: FunctionGraphTrigger[];
      };

      if (!response.ok) {
        throw new Error(
          body.error || `Trigger list returned ${response.status}.`,
        );
      }

      setTriggers(body.triggers ?? []);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load triggers.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [functionId, projectId]);

  async function submitCreate() {
    setIsSaving(true);
    setMessage("Creating trigger...");

    try {
      const response = await fetch(
        `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/triggers`,
        {
          body: JSON.stringify({ ...form, projectId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          body.error || `Trigger creation returned ${response.status}.`,
        );
      }

      setCreateOpen(false);
      setForm({
        eventData: defaultEventData("TIMER"),
        eventTypeCode: "",
        triggerStatus: "ACTIVE",
        triggerTypeCode: "TIMER",
      });
      await loadTriggers();
      setMessage("Created trigger.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to create trigger.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function submitEdit(trigger: FunctionGraphTrigger) {
    setIsSaving(true);
    setMessage("Updating trigger...");

    try {
      const response = await fetch(
        `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/triggers/${encodeURIComponent(trigger.triggerTypeCode)}/${encodeURIComponent(trigger.id)}`,
        {
          body: JSON.stringify({
            eventData: editForm.eventData,
            projectId,
            triggerStatus: editForm.triggerStatus,
          }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          body.error || `Trigger update returned ${response.status}.`,
        );
      }

      setEditingId("");
      await loadTriggers();
      setMessage("Updated trigger.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to update trigger.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteTrigger(trigger: FunctionGraphTrigger) {
    const summary = triggerSummary(trigger);

    if (
      !window.confirm(
        `Delete ${trigger.triggerTypeCode} trigger ${summary.title}?`,
      )
    ) {
      return;
    }

    setIsSaving(true);
    setMessage("Deleting trigger...");

    try {
      const response = await fetch(
        `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/triggers/${encodeURIComponent(trigger.triggerTypeCode)}/${encodeURIComponent(trigger.id)}`,
        {
          body: JSON.stringify({ projectId }),
          headers: { "Content-Type": "application/json" },
          method: "DELETE",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          body.error || `Trigger deletion returned ${response.status}.`,
        );
      }

      await loadTriggers();
      setMessage("Deleted trigger.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to delete trigger.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTriggers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadTriggers]);

  function updateCreate(key: keyof TriggerForm, value: string) {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "triggerTypeCode"
        ? { eventData: defaultEventData(value) }
        : {}),
    }));
    setMessage("");
  }

  function renderTriggerForm(
    state: TriggerForm,
    onChange: (key: keyof TriggerForm, value: string) => void,
    mode: "create" | "edit",
  ) {
    return (
      <ConsoleInsetPanel className="grid gap-3 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <ConsoleField label={<ConsoleEyebrow>Type</ConsoleEyebrow>}>
            <ConsoleSelect
              className="h-10 border-[#d0d5dd]"
              disabled={mode === "edit"}
              onChange={(event) =>
                onChange("triggerTypeCode", event.target.value)
              }
              value={state.triggerTypeCode}
            >
              {triggerTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </ConsoleSelect>
          </ConsoleField>
          <ConsoleField label={<ConsoleEyebrow>Status</ConsoleEyebrow>}>
            <ConsoleSelect
              className="h-10 border-[#d0d5dd]"
              onChange={(event) =>
                onChange("triggerStatus", event.target.value)
              }
              value={state.triggerStatus}
            >
              {triggerStatusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </ConsoleSelect>
          </ConsoleField>
          <ConsoleField label={<ConsoleEyebrow>Event type</ConsoleEyebrow>}>
            <ConsoleInput
              className="h-10 border-[#d0d5dd]"
              disabled={mode === "edit"}
              onChange={(event) =>
                onChange("eventTypeCode", event.target.value)
              }
              placeholder="Optional"
              value={state.eventTypeCode}
            />
          </ConsoleField>
        </div>
        <ConsoleField label={<ConsoleEyebrow>Event data JSON</ConsoleEyebrow>}>
          <ConsoleTextarea
            className="min-h-28 border-[#d0d5dd] font-mono text-xs leading-5"
            onChange={(event) => onChange("eventData", event.target.value)}
            rows={8}
            value={state.eventData}
          />
        </ConsoleField>
      </ConsoleInsetPanel>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ConsoleButton
          disabled={isSaving}
          onClick={() => setCreateOpen((current) => !current)}
        >
          <Plus className="size-4" />
          Add trigger
        </ConsoleButton>
        <ConsoleButton
          disabled={isLoading}
          onClick={loadTriggers}
          variant="ghost"
        >
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </ConsoleButton>
      </div>

      {message ? <ConsoleInlineMessage>{message}</ConsoleInlineMessage> : null}

      <ConsoleInsetPanel className="overflow-x-auto p-4">
        <div className="flex min-w-[620px] items-stretch gap-3">
          <div className="grid min-w-48 flex-1 gap-2">
            <ConsoleEyebrow className="flex items-center gap-2">
              <GitBranch className="size-4 text-[#2563eb] dark:text-[#93c5fd]" />
              Event sources
            </ConsoleEyebrow>
            {triggers.length ? (
              triggers.slice(0, 6).map((trigger) => {
                const summary = triggerSummary(trigger);
                return (
                  <ConsoleInsetPanel
                    className="rounded-lg bg-white p-3 dark:bg-[#0b1220]"
                    key={`map-${trigger.triggerTypeCode}-${trigger.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <ConsolePill className="rounded-md" tone="info">
                        {trigger.triggerTypeCode}
                      </ConsolePill>
                      <span
                        className={`size-2 rounded-full ${trigger.status === "ACTIVE" ? "bg-[#12b76a]" : "bg-[#f79009]"}`}
                      />
                    </div>
                    <p className="mt-2 truncate text-sm font-black text-[#101828] dark:text-white">
                      {summary.title}
                    </p>
                    <p className="mt-1 truncate text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
                      {summary.detail}
                    </p>
                  </ConsoleInsetPanel>
                );
              })
            ) : (
              <ConsoleInsetPanel
                className="rounded-lg bg-white p-4 text-sm font-bold text-[#667085] dark:bg-[#0b1220] dark:text-[#98a2b3]"
                dashed
              >
                No event source connected.
              </ConsoleInsetPanel>
            )}
          </div>
          <div className="grid place-items-center px-1 text-[#2563eb] dark:text-[#93c5fd]">
            <ChevronRight className="size-7" />
          </div>
          <ConsoleInsetPanel className="grid min-w-56 flex-1 place-items-center border-[#bfdbfe] bg-[#eff6ff] p-5 text-center dark:border-[#2563eb]/40 dark:bg-[#0b1730]">
            <span className="grid size-12 place-items-center rounded-xl bg-[#2563eb] text-white shadow-sm">
              <Zap className="size-5" />
            </span>
            <p className="mt-3 max-w-72 truncate text-base font-black text-[#101828] dark:text-white">
              {functionName || functionId}
            </p>
            <ConsoleEyebrow className="mt-1 block text-[#2563eb] dark:text-[#93c5fd]">
              FunctionGraph function
            </ConsoleEyebrow>
          </ConsoleInsetPanel>
          <div className="grid place-items-center px-1 text-[#2563eb] dark:text-[#93c5fd]">
            <ChevronRight className="size-7" />
          </div>
          <div className="grid min-w-48 flex-1 gap-2">
            <ConsoleEyebrow className="flex items-center gap-2">
              <FileText className="size-4 text-[#2563eb] dark:text-[#93c5fd]" />
              Outputs
            </ConsoleEyebrow>
            {["Response", "LTS logs", "Cloud Eye metrics"].map((target) => (
              <ConsoleInsetPanel
                className="rounded-lg bg-white p-3 text-sm font-black text-[#101828] dark:bg-[#0b1220] dark:text-white"
                key={target}
              >
                {target}
              </ConsoleInsetPanel>
            ))}
          </div>
        </div>
      </ConsoleInsetPanel>

      {createOpen ? (
        <div className="grid gap-3">
          {renderTriggerForm(form, updateCreate, "create")}
          <div className="flex flex-wrap gap-2">
            <ConsoleButton disabled={isSaving} onClick={submitCreate}>
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Create trigger
            </ConsoleButton>
            <ConsoleButton onClick={() => setCreateOpen(false)} variant="ghost">
              <X className="size-4" />
              Cancel
            </ConsoleButton>
          </div>
        </div>
      ) : null}

      {triggers.length ? (
        <div className="grid gap-3">
          {triggers.map((trigger) => {
            const editing = editingId === trigger.id;
            const summary = triggerSummary(trigger);

            return (
              <ConsoleInsetPanel
                className="p-4"
                key={`${trigger.triggerTypeCode}-${trigger.id}`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ConsolePill className="rounded-md" tone="info">
                        {trigger.triggerTypeCode}
                      </ConsolePill>
                      <ConsolePill
                        className="rounded-md bg-white dark:bg-[#0b1220]"
                        tone="neutral"
                      >
                        {trigger.status || "-"}
                      </ConsolePill>
                    </div>
                    <h4 className="mt-2 break-words text-base font-black text-[#101828] dark:text-white">
                      {summary.title}
                    </h4>
                    <p className="mt-1 break-words text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
                      {summary.detail}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ConsoleIconButton
                      onClick={() => {
                        setEditingId(trigger.id);
                        setEditForm({
                          eventData: trigger.eventData || "{}",
                          eventTypeCode:
                            trigger.eventTypeCode === "-"
                              ? ""
                              : trigger.eventTypeCode,
                          triggerStatus:
                            trigger.status === "-" ? "ACTIVE" : trigger.status,
                          triggerTypeCode: trigger.triggerTypeCode,
                        });
                      }}
                      title="Edit trigger"
                    >
                      <Pencil className="size-4" />
                    </ConsoleIconButton>
                    <ConsoleIconButton
                      disabled={isSaving}
                      onClick={() => deleteTrigger(trigger)}
                      title="Delete trigger"
                      variant="danger"
                    >
                      <Trash2 className="size-4" />
                    </ConsoleIconButton>
                  </div>
                </div>
                {editing ? (
                  <div className="mt-4 grid gap-3">
                    {renderTriggerForm(
                      editForm,
                      (key, value) => {
                        setEditForm((current) => ({
                          ...current,
                          [key]: value,
                        }));
                        setMessage("");
                      },
                      "edit",
                    )}
                    <div className="flex flex-wrap gap-2">
                      <ConsoleButton
                        disabled={isSaving}
                        onClick={() => submitEdit(trigger)}
                      >
                        {isSaving ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Save className="size-4" />
                        )}
                        Save trigger
                      </ConsoleButton>
                      <ConsoleButton
                        onClick={() => setEditingId("")}
                        variant="ghost"
                      >
                        <X className="size-4" />
                        Cancel
                      </ConsoleButton>
                    </div>
                  </div>
                ) : (
                  <details className="mt-3">
                    <summary className="cursor-pointer">
                      <ConsoleEyebrow>Raw trigger details</ConsoleEyebrow>
                    </summary>
                    <div className="mt-2 grid gap-2">
                      <div className="grid gap-1 rounded-lg bg-white p-3 dark:bg-[#0b1220]">
                        <ConsoleEyebrow>Trigger ID</ConsoleEyebrow>
                        <span className="break-all font-mono text-xs font-semibold text-[#101828] dark:text-white">
                          {trigger.id}
                        </span>
                      </div>
                      <pre className="max-h-80 overflow-auto rounded-lg bg-white p-3 font-mono text-xs font-semibold leading-5 text-[#101828] dark:bg-[#0b1220] dark:text-white">
                        {trigger.eventData || "{}"}
                      </pre>
                    </div>
                  </details>
                )}
              </ConsoleInsetPanel>
            );
          })}
        </div>
      ) : !isLoading ? (
        <ConsoleInsetPanel
          dashed
          icon={<ListChecks className="size-4" />}
          title="No triggers found"
        />
      ) : null}
    </div>
  );
}
