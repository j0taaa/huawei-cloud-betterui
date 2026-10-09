"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Braces,
  Check,
  Database,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  ListChecks,
  Loader2,
  Network,
  Pencil,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  TimerReset,
  Trash2,
  X,
} from "lucide-react";
import {
  ConsoleButton,
  ConsoleCallout,
  ConsoleEyebrow,
  ConsoleFieldList,
  ConsoleFramedTable,
  ConsoleIconButton,
  ConsoleIconTile,
  ConsoleInput,
  ConsoleInsetPanel,
  ConsoleSelect,
  ConsoleSidecarLayout,
  ConsoleSurface,
  ConsoleTextarea,
  type SimpleTableRow,
} from "@/components/console-ui";
import { ConsoleTabNav } from "@/components/console-tabs";
import type { FunctionGraphFunction } from "@/lib/huawei/services/functiongraph.types";

const memorySizes = [
  128, 256, 512, 768, 1024, 1280, 1536, 2048, 2560, 3072, 4096,
];
const runtimeOptions = [
  "Python3.10",
  "Python3.9",
  "Node.js18.15",
  "Node.js16.17",
  "Java8",
  "Java11",
  "Java17",
  "Go1.x",
  "PHP7.3",
  "PHP8.3",
  "Custom Image",
  "http",
];

type FormState = {
  appXrole: string;
  customImageConfig: string;
  description: string;
  domainNamesConfig: string;
  enableAuthInHeader: string;
  enableLtsLog: string;
  encryptedUserData: string;
  enterpriseProjectId: string;
  ephemeralStorage: string;
  extendConfig: string;
  funcVpcConfig: string;
  handler: string;
  initializerHandler: string;
  initializerTimeout: string;
  logConfig: string;
  memorySize: string;
  mountConfig: string;
  name: string;
  networkController: string;
  runtime: string;
  strategyConcurrency: string;
  strategyConfig: string;
  timeout: string;
  userData: string;
  xrole: string;
};

type FieldKind =
  "bool" | "json" | "memory" | "number" | "select" | "text" | "textarea";

type ConfigField = {
  key: keyof FormState;
  kind: FieldKind;
  label: string;
  options?: Array<{
    label: string;
    value: string;
  }>;
};

type ConfigCategory = {
  description: string;
  fields: ConfigField[];
  icon: React.ReactNode;
  id: string;
  readOnlyFields?: Array<{
    label: string;
    value: string;
  }>;
  title: string;
};

function numeric(value: string, fallback = "") {
  const match = value.match(/\d+/);
  return match?.[0] ?? fallback;
}

function clean(value: string) {
  return value === "-" ? "" : value;
}

function initialForm(fn: FunctionGraphFunction): FormState {
  return {
    appXrole: clean(fn.appXrole),
    customImageConfig: fn.customImageConfig,
    description: fn.description,
    domainNamesConfig: fn.domainNamesConfig,
    enableAuthInHeader: clean(fn.enableAuthInHeader),
    enableLtsLog: clean(fn.enableLtsLog),
    encryptedUserData: clean(fn.encryptedUserData),
    enterpriseProjectId: clean(fn.enterpriseProjectId),
    ephemeralStorage: numeric(fn.ephemeralStorage),
    extendConfig: fn.extendConfig,
    funcVpcConfig: fn.funcVpcConfig,
    handler: fn.handler,
    initializerHandler: clean(fn.initializerHandler),
    initializerTimeout: numeric(fn.initializerTimeout),
    logConfig: fn.logConfig,
    memorySize: numeric(fn.memorySize, "128"),
    mountConfig: fn.mountConfig,
    name: fn.name,
    networkController: fn.networkController,
    runtime: fn.runtime,
    strategyConcurrency: numeric(fn.strategyConcurrency),
    strategyConfig: fn.strategyConfig,
    timeout: numeric(fn.timeout, "3"),
    userData: clean(fn.userData),
    xrole: clean(fn.xrole),
  };
}

function boolOptions(value: string) {
  const normalized = value.toLowerCase();
  return normalized === "true" || normalized === "false" ? normalized : "";
}

function displayValue(value: string, field: ConfigField) {
  if (!value) {
    return "Not set";
  }

  if (field.kind === "bool") {
    const normalized = boolOptions(value);
    return normalized === "true"
      ? "Enabled"
      : normalized === "false"
        ? "Disabled"
        : "Default";
  }

  if (field.kind === "memory" || field.key === "ephemeralStorage") {
    return `${value} MB`;
  }

  return value;
}

function parseEnvironmentVariables(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return [] as Array<{ key: string; value: string }>;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};

    return Object.entries(record).map(([key, entry]) => ({
      key,
      value: typeof entry === "string" ? entry : JSON.stringify(entry),
    }));
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return { key: key.trim(), value: rest.join("=").trim() };
      })
      .filter((entry) => entry.key);
  }
}

function serializeEnvironmentVariables(
  entries: Array<{ key: string; value: string }>,
) {
  return JSON.stringify(
    Object.fromEntries(
      entries
        .filter((entry) => entry.key.trim())
        .map((entry) => [entry.key.trim(), entry.value]),
    ),
    null,
    2,
  );
}

export function FunctionGraphConfigEditor({
  fn,
  functionId,
}: {
  fn: FunctionGraphFunction;
  functionId: string;
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState<FormState>(() => initialForm(fn));
  const [form, setForm] = useState<FormState>(() => initialForm(fn));
  const [activeCategory, setActiveCategory] = useState("basic");
  const [editingKey, setEditingKey] = useState<keyof FormState | null>(null);
  const [revealedEnvKeys, setRevealedEnvKeys] = useState<Set<string>>(
    new Set(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  function updateField(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setStatus("");
  }

  function cancelEdit(key: keyof FormState) {
    setForm((current) => ({ ...current, [key]: baseline[key] }));
    setEditingKey(null);
    setStatus("");
  }

  async function saveConfig(key: keyof FormState) {
    if (isSaving || form[key] === baseline[key]) {
      setEditingKey(null);
      return;
    }

    setIsSaving(true);
    setStatus("Saving configuration...");

    try {
      const response = await fetch(
        `/api/cloud/functiongraph/${encodeURIComponent(functionId)}/config`,
        {
          body: JSON.stringify({
            ...form,
            enableAuthInHeader: boolOptions(form.enableAuthInHeader),
            enableLtsLog: boolOptions(form.enableLtsLog),
            projectId: fn.projectId,
          }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };

      if (!response.ok || !body.ok) {
        throw new Error(
          body.error ||
            `FunctionGraph config update returned ${response.status}.`,
        );
      }

      setEditingKey(null);
      setBaseline(form);
      setStatus("Saved");
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to save FunctionGraph configuration.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function renderEditor(field: ConfigField) {
    const value = form[field.key];

    if (field.kind === "memory") {
      return (
        <ConsoleSelect
          autoFocus
          className="h-10 border-[#d0d5dd]"
          onChange={(event) => updateField(field.key, event.target.value)}
          value={value}
        >
          {memorySizes.map((size) => (
            <option key={size} value={String(size)}>
              {size} MB
            </option>
          ))}
        </ConsoleSelect>
      );
    }

    if (field.kind === "select") {
      const options = field.options?.some((option) => option.value === value)
        ? field.options
        : [
            { label: value || "Current value", value },
            ...(field.options ?? []),
          ];

      return (
        <ConsoleSelect
          autoFocus
          className="h-10 border-[#d0d5dd]"
          onChange={(event) => updateField(field.key, event.target.value)}
          value={value}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </ConsoleSelect>
      );
    }

    if (field.kind === "bool") {
      return (
        <ConsoleSelect
          autoFocus
          className="h-10 border-[#d0d5dd]"
          onChange={(event) => updateField(field.key, event.target.value)}
          value={boolOptions(value)}
        >
          <option value="">Default</option>
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </ConsoleSelect>
      );
    }

    if (field.kind === "json" || field.kind === "textarea") {
      return (
        <ConsoleTextarea
          autoFocus
          className="min-h-28 border-[#d0d5dd] font-mono text-xs leading-5"
          onChange={(event) => updateField(field.key, event.target.value)}
          rows={field.kind === "json" ? 7 : 4}
          value={value}
        />
      );
    }

    return (
      <ConsoleInput
        autoFocus
        className="h-10 border-[#d0d5dd]"
        min={field.kind === "number" ? 0 : undefined}
        onChange={(event) => updateField(field.key, event.target.value)}
        type={field.kind === "number" ? "number" : "text"}
        value={value}
      />
    );
  }

  function renderField(field: ConfigField) {
    const isEditing = editingKey === field.key;
    const hasChange = form[field.key] !== baseline[field.key];

    return (
      <div
        className="grid gap-3 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-start"
        key={field.key}
      >
        <ConsoleEyebrow className="pt-1">{field.label}</ConsoleEyebrow>
        <div className="min-w-0">
          {isEditing ? (
            <div className="grid gap-2">
              {renderEditor(field)}
              <div className="flex flex-wrap items-center gap-2">
                <ConsoleButton
                  disabled={isSaving || !hasChange}
                  onClick={() => saveConfig(field.key)}
                  size="xs"
                >
                  {isSaving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  Save
                </ConsoleButton>
                <ConsoleButton
                  disabled={isSaving}
                  onClick={() => cancelEdit(field.key)}
                  size="xs"
                  variant="ghost"
                >
                  <X className="size-3.5" />
                  Cancel
                </ConsoleButton>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 items-start gap-2">
              {field.kind === "json" || field.kind === "textarea" ? (
                <pre className="min-h-8 flex-1 whitespace-pre-wrap break-words rounded-lg bg-white px-3 py-2 font-mono text-xs font-semibold leading-5 text-[#101828] dark:bg-[#0b1220] dark:text-white">
                  {displayValue(form[field.key], field)}
                </pre>
              ) : (
                <p className="min-h-8 flex-1 break-words rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#101828] dark:bg-[#0b1220] dark:text-white">
                  {displayValue(form[field.key], field)}
                </p>
              )}
              <ConsoleIconButton
                aria-label={`Edit ${field.label}`}
                className="shrink-0"
                onClick={() => {
                  setEditingKey(field.key);
                  setStatus("");
                }}
                title={`Edit ${field.label}`}
              >
                <Pencil className="size-4" />
              </ConsoleIconButton>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderReadOnlyField(field: { label: string; value: string }) {
    return (
      <div
        className="grid gap-3 py-4 lg:grid-cols-[220px_minmax(0,1fr)]"
        key={field.label}
      >
        <div>
          <p className="text-sm font-black text-[#101828] dark:text-white">
            {field.label}
          </p>
          <p className="mt-1 text-xs font-semibold text-[#667085] dark:text-[#98a2b3]">
            Synced from FunctionGraph inventory.
          </p>
        </div>
        <p className="min-h-8 min-w-0 break-words rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#101828] dark:bg-[#0b1220] dark:text-white">
          {field.value || "-"}
        </p>
      </div>
    );
  }

  function renderEnvironmentVariableManager() {
    const entries = parseEnvironmentVariables(form.userData);
    const duplicateKeys = new Set(
      entries
        .map((entry) => entry.key)
        .filter((key, index, all) => key && all.indexOf(key) !== index),
    );

    function updateEntries(nextEntries: Array<{ key: string; value: string }>) {
      updateField("userData", serializeEnvironmentVariables(nextEntries));
    }

    const environmentRows: SimpleTableRow[] = entries.map((entry, index) => {
      const revealed = revealedEnvKeys.has(entry.key || `${index}`);
      const duplicate = duplicateKeys.has(entry.key);

      return {
        key: `${entry.key}-${index}`,
        cells: [
          <ConsoleInput
            className={`h-10 border-[#d0d5dd] ${duplicate ? "border-[#f79009]" : ""}`}
            focusTone={duplicate ? "orange" : "primary"}
            key="key"
            onChange={(event) => {
              const next = entries.map((item, itemIndex) =>
                itemIndex === index
                  ? { ...item, key: event.target.value }
                  : item,
              );
              updateEntries(next);
            }}
            placeholder="VARIABLE_NAME"
            value={entry.key}
          />,
          <ConsoleInput
            className="h-10 border-[#d0d5dd]"
            key="value"
            onChange={(event) => {
              const next = entries.map((item, itemIndex) =>
                itemIndex === index
                  ? { ...item, value: event.target.value }
                  : item,
              );
              updateEntries(next);
            }}
            type={revealed ? "text" : "password"}
            value={entry.value}
          />,
          <div className="flex gap-1" key="actions">
            <ConsoleIconButton
              onClick={() => {
                const key = entry.key || `${index}`;
                setRevealedEnvKeys((current) => {
                  const next = new Set(current);
                  if (next.has(key)) {
                    next.delete(key);
                  } else {
                    next.add(key);
                  }
                  return next;
                });
              }}
              title={revealed ? "Mask value" : "Reveal value"}
            >
              {revealed ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </ConsoleIconButton>
            <ConsoleIconButton
              onClick={() =>
                updateEntries(
                  entries.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              title="Delete variable"
              variant="danger"
            >
              <Trash2 className="size-4" />
            </ConsoleIconButton>
          </div>,
        ],
      };
    });

    return (
      <ConsoleInsetPanel className="mt-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="text-sm font-black text-[#101828] dark:text-white">
              Environment variables
            </h4>
            <p className="mt-1 text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
              Values stay masked until revealed. Duplicate keys are highlighted
              before saving.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ConsoleButton
              onClick={() =>
                updateEntries([...entries, { key: "", value: "" }])
              }
            >
              <Plus className="size-4" />
              Add variable
            </ConsoleButton>
            <ConsoleButton
              disabled={
                isSaving ||
                Boolean(duplicateKeys.size) ||
                form.userData === baseline.userData
              }
              onClick={() => saveConfig("userData")}
              variant="success"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save variables
            </ConsoleButton>
          </div>
        </div>

        {duplicateKeys.size ? (
          <ConsoleCallout tone="warning">
            Duplicate variable keys: {Array.from(duplicateKeys).join(", ")}
          </ConsoleCallout>
        ) : null}

        <ConsoleFramedTable
          className="mt-4"
          columns={[
            {
              header: "Key",
              className: "px-3 py-2",
              headerClassName: "px-3 py-2",
            },
            {
              header: "Value",
              className: "px-3 py-2",
              headerClassName: "px-3 py-2",
            },
            {
              header: "Actions",
              className: "w-24 px-3 py-2",
              headerClassName: "w-24 px-3 py-2",
            },
          ]}
          emptyState={
            <span className="text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
              No environment variables are configured.
            </span>
          }
          minWidthClassName="min-w-[620px]"
          rows={environmentRows}
        />
      </ConsoleInsetPanel>
    );
  }

  const categories: ConfigCategory[] = [
    {
      description: "Core function identity and execution shape.",
      fields: [
        { key: "name", kind: "text", label: "Function name" },
        {
          key: "runtime",
          kind: "select",
          label: "Runtime",
          options: runtimeOptions.map((runtime) => ({
            label: runtime,
            value: runtime,
          })),
        },
        { key: "handler", kind: "text", label: "Handler" },
        { key: "memorySize", kind: "memory", label: "Memory" },
        { key: "timeout", kind: "number", label: "Timeout seconds" },
        { key: "description", kind: "textarea", label: "Description" },
      ],
      icon: <Settings2 className="size-4" />,
      id: "basic",
      readOnlyFields: [
        { label: "Package", value: fn.packageName },
        { label: "Version", value: fn.version },
        { label: "CPU", value: fn.cpu },
        { label: "Reserved instances", value: fn.reservedInstances },
      ],
      title: "Basic Settings",
    },
    {
      description: "Function environment variables and encrypted user data.",
      fields: [
        { key: "userData", kind: "textarea", label: "User data" },
        {
          key: "encryptedUserData",
          kind: "textarea",
          label: "Encrypted user data",
        },
      ],
      icon: <KeyRound className="size-4" />,
      id: "environment",
      title: "Environment Variables",
    },
    {
      description: "Agencies and request authentication settings.",
      fields: [
        { key: "xrole", kind: "text", label: "Config agency" },
        { key: "appXrole", kind: "text", label: "App agency" },
        { key: "enableAuthInHeader", kind: "bool", label: "Auth in header" },
        {
          key: "enterpriseProjectId",
          kind: "text",
          label: "Enterprise project",
        },
      ],
      icon: <ShieldCheck className="size-4" />,
      id: "permissions",
      readOnlyFields: [
        { label: "Function URN", value: fn.urn },
        { label: "Service URN", value: fn.serviceUrn },
      ],
      title: "Permissions",
    },
    {
      description: "VPC, network controller, and domain routing configuration.",
      fields: [
        { key: "funcVpcConfig", kind: "json", label: "VPC" },
        { key: "networkController", kind: "json", label: "Network controller" },
        { key: "domainNamesConfig", kind: "json", label: "Domain names" },
      ],
      icon: <Network className="size-4" />,
      id: "network",
      readOnlyFields: [
        { label: "Region", value: fn.region },
        { label: "Project", value: fn.projectName },
        { label: "Project ID", value: fn.projectId },
        { label: "VPC ID", value: fn.vpcId },
      ],
      title: "Network",
    },
    {
      description: "Concurrency limits and strategy configuration.",
      fields: [
        { key: "strategyConcurrency", kind: "number", label: "Concurrency" },
        { key: "strategyConfig", kind: "json", label: "Strategy" },
      ],
      icon: <SlidersHorizontal className="size-4" />,
      id: "concurrency",
      title: "Concurrency",
    },
    {
      description: "Mounted file systems and storage attachments.",
      fields: [{ key: "mountConfig", kind: "json", label: "Mounts" }],
      icon: <Database className="size-4" />,
      id: "file-systems",
      title: "File Systems",
    },
    {
      description:
        "Async invocation destination and notification configuration.",
      fields: [],
      icon: <Bell className="size-4" />,
      id: "async-notification",
      title: "Async Notification",
    },
    {
      description: "Function logging and LTS integration.",
      fields: [
        { key: "enableLtsLog", kind: "bool", label: "LTS log" },
        { key: "logConfig", kind: "json", label: "Log" },
      ],
      icon: <FileText className="size-4" />,
      id: "logs",
      title: "Logs",
    },
    {
      description: "Resource tags associated with this function.",
      fields: [],
      icon: <Tags className="size-4" />,
      id: "tags",
      title: "Tags",
    },
    {
      description: "Initializer and lifecycle hook behavior.",
      fields: [
        {
          key: "initializerHandler",
          kind: "text",
          label: "Initializer handler",
        },
        {
          key: "initializerTimeout",
          kind: "number",
          label: "Initializer timeout",
        },
      ],
      icon: <TimerReset className="size-4" />,
      id: "lifecycle",
      readOnlyFields: [{ label: "Last modified", value: fn.lastModified }],
      title: "Lifecycle",
    },
    {
      description: "Less common raw FunctionGraph settings.",
      fields: [
        {
          key: "ephemeralStorage",
          kind: "number",
          label: "Ephemeral storage MB",
        },
        { key: "customImageConfig", kind: "json", label: "Custom image" },
        { key: "extendConfig", kind: "json", label: "Extended config" },
      ],
      icon: <Braces className="size-4" />,
      id: "advanced",
      readOnlyFields: [
        { label: "Code type", value: fn.codeType },
        { label: "Code size", value: fn.codeSize },
        { label: "Digest", value: fn.digest },
      ],
      title: "Advanced Settings",
    },
  ];
  const active =
    categories.find((category) => category.id === activeCategory) ??
    categories[0];

  return (
    <ConsoleSurface
      description="Use the pencil next to a setting to edit only that configuration."
      status={
        status ? (
          <p className="flex items-center gap-1.5 text-xs font-bold text-[#667085] dark:text-[#98a2b3]">
            {status === "Saved" ? (
              <Check className="size-3.5 text-[#12b76a]" />
            ) : null}
            {status}
          </p>
        ) : null
      }
      title="Configuration"
    >
      <ConsoleSidecarLayout
        contentProps={{
          "aria-labelledby": `functiongraph-config-tab-${active.id}`,
          id: `functiongraph-config-panel-${active.id}`,
          role: "tabpanel",
        }}
        sidebar={
          <ConsoleTabNav
            activeId={active.id}
            ariaLabel="FunctionGraph configuration categories"
            idPrefix="functiongraph-config"
            onSelect={(categoryId) => {
              setActiveCategory(categoryId);
              setEditingKey(null);
              setStatus("");
            }}
            tabs={categories.map((category) => ({
              icon: category.icon,
              id: category.id,
              label: category.title,
            }))}
            variant="sidebar"
          />
        }
      >
        <div className="mb-4 flex items-start gap-3">
          <ConsoleIconTile
            className="bg-[#eef4ff] text-[#2563eb] dark:bg-white/10 dark:text-[#93c5fd]"
            size="sm"
          >
            {active.icon}
          </ConsoleIconTile>
          <div>
            <h3 className="text-base font-black text-[#101828] dark:text-white">
              {active.title}
            </h3>
            <p className="mt-1 text-sm font-semibold text-[#667085] dark:text-[#98a2b3]">
              {active.description}
            </p>
          </div>
        </div>
        {active.fields.length || active.readOnlyFields?.length ? (
          <>
            <ConsoleFieldList>
              {active.fields.map(renderField)}
              {active.readOnlyFields?.map(renderReadOnlyField)}
            </ConsoleFieldList>
            {active.id === "environment"
              ? renderEnvironmentVariableManager()
              : null}
          </>
        ) : (
          <ConsoleInsetPanel
            dashed
            icon={<ListChecks className="size-4" />}
            title="No editable settings are available yet"
          >
            This category is ready for the matching FunctionGraph API data once
            it is wired into the resource loader.
          </ConsoleInsetPanel>
        )}
      </ConsoleSidecarLayout>
    </ConsoleSurface>
  );
}
