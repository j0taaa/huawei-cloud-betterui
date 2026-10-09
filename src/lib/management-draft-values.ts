import { ManagementInputError, type ManagementChoice, type ManagementOperation, type ManagementValues } from "./management-contract";

/** Save configuration choices and resource names, never credentials or arbitrary text/JSON. */
export function creationDraftFields(operation: ManagementOperation) {
  if (operation.kind !== "create") return [];
  return operation.fields.filter(field => field.type === "select" || field.type === "boolean" || field.type === "number" || field.type === "decimal" || (field.type === "list" && !!field.source) || (field.key === "name" && (!field.type || field.type === "text")));
}

export function pickCreationDraft(operation: ManagementOperation, values: ManagementValues): ManagementValues {
  return Object.fromEntries(creationDraftFields(operation).filter(field => Object.hasOwn(values, field.key) && values[field.key] !== "" && values[field.key] !== undefined).map(field => [field.key, values[field.key]]));
}

export function restoreCreationDraft(operation: ManagementOperation, saved: ManagementValues, choices: Record<string, ManagementChoice[]>) {
  const values = pickCreationDraft(operation, saved);
  let unavailable = false;
  for (const field of creationDraftFields(operation)) {
    if (values[field.key] === undefined || (field.type !== "select" && !field.source)) continue;
    const allowed = field.source ? choices[field.source] ?? [] : field.choices ?? [];
    if (Array.isArray(values[field.key])) {
      const original = values[field.key] as string[];
      const remaining = original.filter(value => allowed.some(choice => choice.value === value));
      unavailable ||= original.length !== remaining.length;
      values[field.key] = remaining;
    } else if (!allowed.some(choice => choice.value === values[field.key])) {
      delete values[field.key];
      unavailable = true;
    }
  }
  return { values, unavailable };
}

export function validateCreationDraft(operation: ManagementOperation, input: unknown): ManagementValues {
  if (operation.kind !== "create") throw new ManagementInputError("Saved drafts are available for creation workflows only.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ManagementInputError("Enter valid draft values.");
  const fields = creationDraftFields(operation);
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !fields.some(field => field.key === key))) throw new ManagementInputError("This draft includes a field that cannot be saved.");
  const result: ManagementValues = {};
  for (const field of fields) {
    const value = raw[field.key];
    if (value === undefined) continue;
    if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new ManagementInputError("A saved draft switch must be enabled or disabled.");
    } else if (field.type === "number" || field.type === "decimal") {
      if (typeof value !== "number" || !Number.isFinite(value) || (field.type === "number" && !Number.isSafeInteger(value)) || (field.max !== undefined && value > field.max) || (field.min !== undefined && value < field.min)) throw new ManagementInputError("A saved draft number is outside this field's bounds.");
    } else if (field.type === "list") {
      if (!Array.isArray(value) || value.length > (field.max ?? 100) || value.some(item => typeof item !== "string" || item.length > 2048 || !item.trim())) throw new ManagementInputError("A saved draft selection list is invalid.");
    } else if (typeof value !== "string" || value.length > (field.type === "select" ? 4096 : field.max ?? 2048)) throw new ManagementInputError("A saved draft text value is invalid.");
    result[field.key] = value as ManagementValues[string];
  }
  // Drafts can contain outdated selections; the actual operation always validates live choices.
  if (new TextEncoder().encode(JSON.stringify(result)).length > 16384) throw new ManagementInputError("The saved draft is too large.");
  return result;
}
