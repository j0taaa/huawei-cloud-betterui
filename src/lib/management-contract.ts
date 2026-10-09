export type ManagementChoice = { value: string; label: string };
export type ManagementField = {
  key: string;
  label: string;
  type?: "text" | "password" | "number" | "decimal" | "select" | "boolean" | "textarea" | "list";
  required?: boolean;
  min?: number;
  max?: number;
  maxBytes?: number;
  allowEmpty?: boolean;
  pattern?: string;
  defaultValue?: string | number | boolean;
  choices?: ManagementChoice[];
  source?: string;
  help?: string;
};
export type ManagementOperation = {
  id: string;
  label: string;
  description: string;
  kind: "create" | "update" | "delete" | "action" | "inspect";
  fields: ManagementField[];
  confirmation?: boolean;
  impact?: string;
  allowedStatuses?: string[];
  excludedResourceIds?: string[];
  resourcePrefixes?: string[];
};
export type ManagementResource = {
  id: string;
  name: string;
  status?: string;
  values?: Record<string, string | number | boolean>;
};
export type ManagementValues = Record<string, string | number | boolean | string[]>;
export type ManagementOutcome = {
  message: string;
  resourceId?: string;
  jobId?: string;
  asynchronous?: boolean;
  facts?: Array<{ label: string; value: string }>;
};
export type ManagementHistoryEntry = {
  resultResourceId?: string;
  id: string;
  service: string;
  operation: string;
  resourceId?: string;
  resourceName?: string;
  projectId?: string;
  startedAt: string;
  finishedAt?: string;
  state: "running" | "submitted" | "succeeded" | "failed" | "uncertain";
  message?: string;
  jobId?: string;
};
export type ManagementContext = {
  service: string;
  title: string;
  accountWide: boolean;
  projects: ManagementChoice[];
  selectedProjectId: string;
  operations: ManagementOperation[];
  resources: ManagementResource[];
  choices: Record<string, ManagementChoice[]>;
  history: ManagementHistoryEntry[];
};

const managementErrorBrand = Symbol.for("betterui.management-input-error");
export class ManagementInputError extends Error {
  readonly [managementErrorBrand] = true;
  static [Symbol.hasInstance](value: unknown): boolean { return value !== null && typeof value === "object" && (value as Record<symbol, unknown>)[managementErrorBrand] === true; }
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** The UI and server use the same field contract; never forward arbitrary request JSON. */
export function validateManagementValues(operation: ManagementOperation, input: unknown, sources: Record<string, ManagementChoice[]> = {}): ManagementValues {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ManagementInputError("Form values are required.");
  const raw = input as Record<string, unknown>;
  const keys = new Set(operation.fields.map((field) => field.key));
  for (const key of Object.keys(raw)) if (!keys.has(key)) throw new ManagementInputError("The form included an unsupported field.");
  const values: ManagementValues = {};
  for (const field of operation.fields) {
    const value = raw[field.key];
    if (value === undefined || value === null || (value === "" && !field.allowEmpty)) {
      if (field.required) throw new ManagementInputError(`${field.label} is required.`);
      continue;
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new ManagementInputError(`${field.label} must be enabled or disabled.`);
      values[field.key] = value; continue;
    }
    if (field.type === "number" || field.type === "decimal") {
      if (typeof value !== "number" || (!Number.isFinite(value) || (field.type === "number" && !Number.isSafeInteger(value))) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) throw new ManagementInputError(`${field.label} must be a ${field.type === "decimal" ? "finite number" : "whole number"}${field.min !== undefined ? ` of at least ${field.min}` : ""}${field.max !== undefined ? ` and no more than ${field.max}` : ""}.`);
      values[field.key] = value; continue;
    }
    if (field.type === "list") {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new ManagementInputError(`${field.label} must be a list of names.`);
      const list = [...new Set(value.map((item) => (item as string).trim()))];
      if ((field.required && !list.length) || list.length > (field.max ?? 100)) throw new ManagementInputError(`${field.label} has an invalid number of selections.`);
      const available = field.source ? sources[field.source] : undefined;
      if (field.source && list.some((item) => !available?.some((choice) => choice.value === item))) throw new ManagementInputError(`${field.label} includes an unavailable selection.`);
      values[field.key] = list; continue;
    }
    if (typeof value !== "string") throw new ManagementInputError(`${field.label} must be text.`);
    const text = field.type === "password" ? value : value.trim();
    if ((field.required && !text) || text.length > (field.max ?? 2048) || (field.maxBytes !== undefined && new TextEncoder().encode(text).length > field.maxBytes) || (field.min !== undefined && text.length < field.min) || (field.pattern && !new RegExp(field.pattern, "u").test(text))) throw new ManagementInputError(`${field.label} has an invalid format.`);
    const choices = field.source ? sources[field.source] : field.choices;
    if ((field.type === "select" || field.source) && !choices?.some((choice) => choice.value === text)) throw new ManagementInputError(`${field.label} is not available for this project.`);
    values[field.key] = text;
  }
  return values;
}
