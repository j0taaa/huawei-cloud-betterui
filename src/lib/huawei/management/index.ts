import "server-only";
import { randomUUID } from "node:crypto";
import { getSessionProjects, type BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, validateManagementValues, type ManagementContext, type ManagementHistoryEntry, type ManagementOutcome } from "@/lib/management-contract";
import { HuaweiApiError } from "@/lib/huawei/http";
import { CloudLoadError } from "@/lib/huawei/errors";
import { invalidateCloudResult } from "@/lib/huawei/result";
import { managementAdapters } from "./registry";
import { claimManagementOperation, listManagementHistory, readManagementHistory, saveManagementHistory } from "./history";

function adapterFor(service: string) {
  const adapter = Object.hasOwn(managementAdapters, service) ? managementAdapters[service] : undefined;
  if (!adapter) throw new ManagementInputError("Management workflows for this service have not been implemented yet.", 404);
  return adapter;
}

function selectedSession(session: BetterUiSession, service: string, projectId?: unknown) {
  const adapter = adapterFor(service);
  if (adapter.accountWide) {
    if (!session.accountToken) throw new ManagementInputError("Sign out and sign in again to obtain an account token.", 409);
    return session;
  }
  if (projectId !== undefined && typeof projectId !== "string") throw new ManagementInputError("Select a project from this session.");
  const project = getSessionProjects(session).find((project) => project.projectId === (projectId ?? session.projectId));
  if (!project) throw new ManagementInputError("The selected project is not part of this session.", 403);
  return { ...session, ...project, projects: [project] };
}

export async function getManagementContext(session: BetterUiSession, service: string, projectId?: string, operationId?: string, resourceId?: string): Promise<ManagementContext> {
  const adapter = adapterFor(service);
  const selected = selectedSession(session, service, projectId);
  if (operationId && !adapter.operations.some((operation) => operation.id === operationId)) throw new ManagementInputError("Unsupported operation.");
  const warnings: string[] = [];
  let resources: ManagementContext["resources"];
  try { resources = await adapter.inventory(selected); }
  catch (error) {
    if (!(error instanceof CloudLoadError) || !Array.isArray(error.partialData)) throw error;
    resources = error.partialData as ManagementContext["resources"];
    warnings.push(`Inventory is incomplete: ${error.message}. Available resources are shown; operations recheck current inventory before proceeding.`);
  }
  const resource = resources.find((item) => item.id === resourceId);
  const [choices, history] = await Promise.all([
    operationId && adapter.options ? adapter.options(selected, operationId, resource) : Promise.resolve({}),
    listManagementHistory(session, service),
  ]);
  return { service, title: adapter.title, accountWide: !!adapter.accountWide, projects: getSessionProjects(session).map((project) => ({ value: project.projectId, label: `${project.projectName} / ${project.region}` })), selectedProjectId: selected.projectId, operations: adapter.operations, resources, choices, history, ...(warnings.length ? { warnings } : {}) };
}

export async function runManagementOperation(session: BetterUiSession, service: string, body: unknown): Promise<ManagementOutcome & { ok: boolean; replayed?: boolean }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ManagementInputError("Enter valid operation details.");
  const input = body as Record<string, unknown>;
  const allowedKeys = new Set(["requestId", "operation", "projectId", "resourceId", "confirmName", "acknowledgedImpact", "values"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) throw new ManagementInputError("Unsupported operation details.");
  const adapter = adapterFor(service);
  const selected = selectedSession(session, service, input.projectId);
  const operation = adapter.operations.find((operation) => operation.id === input.operation);
  if (!operation) throw new ManagementInputError("Unsupported operation.");
  if (operation.impact && input.acknowledgedImpact !== true) throw new ManagementInputError("Review and acknowledge the operation's impact.");
  // Require a client-generated ID for mutations so a lost response can be retried safely.
  const requestId = operation.kind === "inspect" ? randomUUID() : input.requestId;
  if (typeof requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) throw new ManagementInputError("A valid operation request ID is required.");
  const previous = operation.kind === "inspect" ? null : await readManagementHistory(session, requestId);
  if (previous) {
    if (previous.service !== service || previous.operation !== operation.label || previous.projectId !== (adapter.accountWide ? undefined : selected.projectId) || (previous.resourceId && operation.kind !== "create" && previous.resourceId !== input.resourceId)) throw new ManagementInputError("This request ID belongs to another operation.", 409);
    if (["submitted", "succeeded"].includes(previous.state)) return { ok: true, message: previous.message ?? "This operation has already been accepted.", resourceId: previous.resultResourceId ?? previous.resourceId, jobId: previous.jobId, asynchronous: previous.state === "submitted", replayed: true };
    throw new ManagementInputError(previous.state === "failed" ? `This request already failed: ${previous.message ?? "Cloud operation failed."} Start a new operation to retry.` : "This request is already being processed or its outcome is uncertain. Check operation history and cloud resource state before starting another request.", 409);
  }
  if (operation.kind !== "create" && typeof input.resourceId !== "string") throw new ManagementInputError("Select a resource for this operation.");
  const resource = operation.kind === "create" ? undefined : (await (adapter.inventoryForResource
    ? adapter.inventoryForResource(selected, input.resourceId as string)
    : adapter.inventory(selected))).find((resource) => resource.id === input.resourceId);
  if (operation.kind !== "create" && !resource) throw new ManagementInputError("The resource was not found in the selected project.", 404);
  if (resource && operation.resourcePrefixes && !operation.resourcePrefixes.some((prefix) => resource.id.startsWith(prefix))) throw new ManagementInputError("Select a resource of the correct type for this operation.", 409);
  if (resource && operation.excludedResourceIds?.includes(resource.id)) throw new ManagementInputError("This operation is unavailable for the default or protected resource.", 409);
  if (resource && operation.allowedStatuses && !operation.allowedStatuses.includes(resource.status ?? "UNKNOWN")) throw new ManagementInputError(`This operation is unavailable while the resource status is ${resource.status ?? "UNKNOWN"}.`, 409);
  if ((operation.confirmation || operation.kind === "delete") && input.confirmName !== resource?.name) throw new ManagementInputError("Type the exact resource name to confirm this operation.");
  const options = adapter.options ? await adapter.options(selected, operation.id, resource) : {};
  const values = validateManagementValues(operation, input.values, options);
  const entry: ManagementHistoryEntry = { id: requestId, service, operation: operation.label, resourceId: resource?.id, resourceName: resource?.name, projectId: adapter.accountWide ? undefined : selected.projectId, startedAt: new Date().toISOString(), state: "running" };
  if (operation.kind !== "inspect") {
    if (!await claimManagementOperation(session, requestId)) throw new ManagementInputError("This request has already been submitted. Refresh operation history before retrying.", 409);
    await saveManagementHistory(session, entry);
  }
  let outcome: ManagementOutcome;
  try { outcome = await adapter.execute(selected, operation.id, values, resource); }
  catch (error) {
    let message = error instanceof Error ? error.message : "Huawei Cloud operation failed.";
    for (const field of operation.fields.filter((field) => field.type === "password")) {
      const secret = values[field.key];
      if (typeof secret === "string" && secret) message = message.split(secret).join("[redacted]");
    }
    const uncertain = !(error instanceof HuaweiApiError || error instanceof ManagementInputError) || (error instanceof HuaweiApiError && error.status >= 500);
    if (uncertain && operation.kind !== "inspect") message += " The cloud may have accepted this request. Check resource state before retrying.";
    if (operation.kind !== "inspect") await saveManagementHistory(session, { ...entry, finishedAt: new Date().toISOString(), state: uncertain ? "uncertain" : "failed", message }).catch(() => undefined);
    if (error instanceof ManagementInputError) throw new ManagementInputError(message, error.status);
    throw new Error(message);
  }
  if (operation.kind !== "inspect") {
    // A cloud success stays a success even when local maintenance fails.
    const maintenance = await Promise.allSettled([
      ...[...new Set(adapter.invalidationKeys(resource))].map((key) => invalidateCloudResult(session, key)),
      saveManagementHistory(session, { ...entry, resourceId: entry.resourceId ?? outcome.resourceId, resultResourceId: outcome.resourceId, ...(outcome.asynchronous ? {} : { finishedAt: new Date().toISOString() }), state: outcome.asynchronous ? "submitted" : "succeeded", jobId: outcome.jobId, verification: outcome.verification, message: outcome.message }),
    ]);
    if (maintenance.some((result) => result.status === "rejected")) outcome = { ...outcome, message: `${outcome.message} Local history or cache refresh failed; reload the inventory to verify cloud state. This request was accepted; do not resubmit it.` };
  }
  return { ok: true, ...outcome };
}
