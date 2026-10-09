"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Settings2 } from "lucide-react";
import { ConsoleButton, ConsoleField, ConsoleInput, ConsoleMain, ConsolePageHeader, ConsolePanel, ConsolePanelBody, ConsoleSelect, ConsoleTextarea, FieldGrid, StatusBadge } from "@/components/console-ui";
import { LocalDateTime } from "@/components/local-date-time";
import { validateManagementValues, type ManagementContext, type ManagementField, type ManagementOperation, type ManagementOutcome, type ManagementValues } from "@/lib/management-contract";
import { creationDraftFields, pickCreationDraft, restoreCreationDraft } from "@/lib/management-draft-values";

function initialValues(operation: ManagementOperation | undefined, resourceId: string, context: ManagementContext): ManagementValues {
  const resource = operation?.kind === "create" ? undefined : context.resources.find((resource) => resource.id === resourceId);
  return Object.fromEntries((operation?.fields ?? []).map((field) => [field.key, resource?.values?.[field.key] ?? field.defaultValue ?? (field.type === "boolean" ? false : field.type === "list" ? [] : "")]));
}

function FormField({ field, value, choices, onChange }: { field: ManagementField; value: ManagementValues[string] | undefined; choices: ManagementContext["choices"]; onChange: (value: ManagementValues[string]) => void }) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  const options = field.source ? choices[field.source] ?? [] : field.choices ?? [];
  if (field.type === "boolean") return <ConsoleField label={label}><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" aria-label={field.label} checked={value === true} onChange={(event) => onChange(event.target.checked)} />Enabled</label>{field.help ? <p className="mt-1 text-xs text-[#667085]">{field.help}</p> : null}</ConsoleField>;
  return <ConsoleField label={label}>
    {field.type === "select" || (field.type === "list" && field.source) ? <ConsoleSelect aria-label={field.label} multiple={field.type === "list"} value={field.type === "list" ? (Array.isArray(value) ? value : []) : String(value ?? "")} onChange={(event) => onChange(field.type === "list" ? Array.from(event.target.selectedOptions, (option) => option.value) : event.target.value)}><option value="" disabled={field.required}>Select {field.label.toLowerCase()}</option>{options.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</ConsoleSelect>
    : (field.type === "textarea" || field.type === "list") ? <ConsoleTextarea aria-label={field.label} value={Array.isArray(value) ? value.join("\n") : String(value ?? "")} maxLength={field.type === "list" ? undefined : field.max} onChange={(event) => onChange(field.type === "list" ? event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) : event.target.value)} />
    : <ConsoleInput aria-label={field.label} type={field.type === "password" ? "password" : (field.type === "number" || field.type === "decimal") ? "number" : "text"} autoComplete={field.type === "password" ? "new-password" : "off"} value={Array.isArray(value) ? value.join(", ") : String(value ?? "")} min={(field.type === "number" || field.type === "decimal") ? field.min : undefined} max={(field.type === "number" || field.type === "decimal") ? field.max : undefined} maxLength={(field.type === "number" || field.type === "decimal") ? undefined : field.max} onChange={(event) => onChange((field.type === "number" || field.type === "decimal") ? (event.target.value === "" ? "" : Number(event.target.value)) : field.type === "list" ? event.target.value.split(",").map((value) => value.trim()).filter(Boolean) : event.target.value)} />}
    {field.help || field.type === "list" ? <p className="mt-1 text-xs text-[#667085]">{field.type === "list" && !field.source ? "Enter one value per line. " : ""}{field.help?.replaceAll("Comma-separated", "One per line").replaceAll("comma-separated", "one per line")}</p> : null}
  </ConsoleField>;
}

export function ServiceManagementWorkspace({ service, initialProjectId = "", initialResourceId = "", initialOperationId = "" }: { service: string; initialProjectId?: string; initialResourceId?: string; initialOperationId?: string }) {
  const router = useRouter();
  const [context, setContext] = useState<ManagementContext | null>(null);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [operationId, setOperationId] = useState(initialOperationId);
  const [resourceId, setResourceId] = useState(initialResourceId);
  const [values, setValues] = useState<ManagementValues>({});
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [review, setReview] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [outcome, setOutcome] = useState<ManagementOutcome | null>(null);
  const formScope = useRef("");
  const acceptedCreationScope = useRef("");
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const requestKey = JSON.stringify([service, projectId, operationId, resourceId, refresh]);
  const loading = loadedKey !== requestKey;
  const operation = context?.operations.find((operation) => operation.id === operationId);
  const resource = context?.resources.find((resource) => resource.id === resourceId);
  const unavailable = resource && operation && ((operation.resourcePrefixes && !operation.resourcePrefixes.some((prefix) => resource.id.startsWith(prefix))) || operation.excludedResourceIds?.includes(resource.id) || (operation.allowedStatuses && !operation.allowedStatuses.includes(resource.status ?? "UNKNOWN")));
  const confirmationNeeded = operation?.confirmation || operation?.kind === "delete";

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (projectId) query.set("projectId", projectId);
    if (operationId) query.set("operation", operationId);
    if (resourceId) query.set("resourceId", resourceId);
    fetch(`/api/cloud/management/${encodeURIComponent(service)}?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Management controls could not be loaded.");
        return body as ManagementContext;
      }).then(async (next) => {
        if (controller.signal.aborted) return;
        setContext(next); setLoadError("");
        if (!projectId && !next.accountWide) setProjectId(next.selectedProjectId);
        const selectedId = next.resources.some((resource) => resource.id === resourceId) ? resourceId : "";
        const selected = next.resources.find((resource) => resource.id === selectedId);
        const compatible = next.operations.filter((operation) => operation.kind !== "create" && operation.kind !== "delete" && !operation.confirmation && (!operation.resourcePrefixes || operation.resourcePrefixes.some((prefix) => selectedId.startsWith(prefix))) && !operation.excludedResourceIds?.includes(selectedId) && (!operation.allowedStatuses || operation.allowedStatuses.includes(selected?.status ?? "UNKNOWN")));
        const selectedOperationId = operationId || (selected ? compatible.find((operation) => operation.kind === "update")?.id ?? compatible.find((operation) => operation.kind === "inspect")?.id : undefined) || next.operations[0]?.id || "";
        if (!operationId) setOperationId(selectedOperationId);
        setResourceId(selectedId);
        const nextOperation = next.operations.find(operation => operation.id === selectedOperationId);
        const nextScope = JSON.stringify([service, next.accountWide ? "account" : next.selectedProjectId, selectedOperationId, selectedId]);
        if (formScope.current !== nextScope) {
          let restored: ManagementValues = {};
          let status = "";
          const justCreated = acceptedCreationScope.current === nextScope;
          if (justCreated) acceptedCreationScope.current = "";
          if (!justCreated && nextOperation && creationDraftFields(nextOperation).length) {
            try {
              const query = new URLSearchParams({ projectId: next.selectedProjectId, operation: selectedOperationId });
              const response = await fetch(`/api/cloud/management/${encodeURIComponent(service)}/draft?${query}`, { signal: controller.signal });
              const body = await response.json();
              if (!response.ok) throw new Error(body.error ?? "The saved draft could not be loaded.");
              if (body.draft) {
                const draft = restoreCreationDraft(nextOperation, body.draft.values, next.choices);
                restored = draft.values;
                status = draft.unavailable ? "Draft restored. Some saved choices are no longer available; select replacements." : "Draft restored.";
              }
            } catch (error) { status = error instanceof Error ? error.message : "The saved draft could not be loaded."; }
          }
          if (controller.signal.aborted) return;
          formScope.current = nextScope;
          setValues({ ...initialValues(nextOperation, selectedId, next), ...restored });
          setDraftDirty(false);
          setDraftStatus(status);
        }
        setLoadedKey(requestKey);
      }).catch((error) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Management controls could not be loaded."); setLoadedKey(requestKey);
      });
    return () => controller.abort();
    // The serialized request key includes every context selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const draftUrl = context && operation ? `/api/cloud/management/${encodeURIComponent(service)}/draft?${new URLSearchParams({ projectId: context.selectedProjectId, operation: operation.id })}` : "";
  useEffect(() => {
    if (!operation || !context || !draftDirty || loading || pending || draftBusy || !creationDraftFields(operation).length) return;
    const scope = formScope.current;
    const draft = pickCreationDraft(operation, values);
    const timer = setTimeout(() => {
      setDraftStatus("Saving draft…");
      // Serialize saves, so a slower earlier response cannot overwrite a newer draft.
      draftQueue.current = draftQueue.current.catch(() => undefined).then(async () => {
        try {
          const response = await fetch(draftUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "The creation draft could not be saved.");
          if (formScope.current === scope) setDraftStatus("Draft saved.");
        } catch (error) { if (formScope.current === scope) setDraftStatus(error instanceof Error ? error.message : "The creation draft could not be saved."); }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [operation, context, draftDirty, loading, pending, draftBusy, values, draftUrl]);

  async function discardDraft() {
    if (!operation || !context || draftBusy || pending) return;
    setDraftBusy(true);
    try {
      await draftQueue.current;
      const response = await fetch(draftUrl, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The saved draft could not be discarded.");
      setValues(initialValues(operation, resourceId, context));
      setDraftDirty(false);
      setDraftStatus("Draft discarded.");
    } catch (error) { setDraftStatus(error instanceof Error ? error.message : "The saved draft could not be discarded."); }
    finally { setDraftBusy(false); }
  }

  const reviewItems = useMemo(() => operation?.fields.filter((field) => values[field.key] !== "" && values[field.key] !== undefined).map((field) => ({ label: field.label, value: field.type === "password" ? "Set" : Array.isArray(values[field.key]) ? (values[field.key] as string[]).join(", ") : field.type === "boolean" ? values[field.key] ? "Enabled" : "Disabled" : String(values[field.key]) })) ?? [], [operation, values]);

  function prepare() {
    setError("");
    if (!context || !operation) return;
    try {
      validateManagementValues(operation, Object.fromEntries(operation.fields.filter((field) => (values[field.key] !== "" || field.allowEmpty)).map((field) => [field.key, values[field.key]])), context.choices);
      if (operation.kind !== "create" && !resource) throw new Error("Select a resource to manage.");
      if (unavailable) throw new Error("This operation is unavailable for the selected resource's state.");
      setConfirmation(""); setAcknowledged(false); setRequestId(crypto.randomUUID()); setReview(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Check the form values."); }
  }

  async function submit() {
    if (pending || !context || !operation || (confirmationNeeded && confirmation !== resource?.name) || (operation.impact && !acknowledged)) return;
    setPending(true); setError(""); setOutcome(null);
    try {
      await draftQueue.current;
      const response = await fetch(`/api/cloud/management/${encodeURIComponent(service)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, operation: operation.id, projectId: context.selectedProjectId, resourceId: operation.kind === "create" ? undefined : resourceId, confirmName: confirmationNeeded ? confirmation : undefined, acknowledgedImpact: acknowledged, values: Object.fromEntries(operation.fields.filter((field) => (values[field.key] !== "" || field.allowEmpty)).map((field) => [field.key, values[field.key]])) }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "The operation failed.");
      if (creationDraftFields(operation).length) {
        acceptedCreationScope.current = formScope.current;
      }
      formScope.current = "";
      setOutcome(body); setReview(false); setRefresh((value) => value + 1); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "The operation failed."); }
    finally { setPending(false); }
  }

  return <ConsoleMain><ConsolePageHeader title={`${context?.title ?? "Service"} management`} icon={Settings2} backHref={`/services/${service}`} backLabel="Back to inventory" description="Create resources, manage configuration, and review operation outcomes." />
    {loadError ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{loadError}<ConsoleButton variant="neutral" onClick={() => setRefresh((value) => value + 1)}>Retry</ConsoleButton></div> : null}
    {context?.warnings?.map((warning, index) => <div role="alert" key={index} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{warning}</div>)}
    {context ? <ConsolePanel title="Choose an operation"><ConsolePanelBody><div className="grid gap-4 md:grid-cols-2">
      {!context.accountWide ? <ConsoleField label="Project"><ConsoleSelect aria-label="Project" value={projectId || context.selectedProjectId} disabled={pending} onChange={(event) => { setProjectId(event.target.value); setResourceId(""); setReview(false); setOutcome(null); }}>{context.projects.map((project) => <option key={project.value} value={project.value}>{project.label}</option>)}</ConsoleSelect></ConsoleField> : null}
      <ConsoleField label="Operation"><ConsoleSelect aria-label="Operation" value={operationId} disabled={pending} onChange={(event) => { setOperationId(event.target.value); setReview(false); setOutcome(null); setError(""); }}>{context.operations.map((operation) => <option key={operation.id} value={operation.id}>{operation.label}</option>)}</ConsoleSelect></ConsoleField>
      {operation && operation.kind !== "create" ? <ConsoleField label="Resource"><ConsoleSelect aria-label="Resource" value={resourceId} disabled={pending || loading} onChange={(event) => { setResourceId(event.target.value); setValues(initialValues(operation, event.target.value, context)); setReview(false); setOutcome(null); setError(""); }}><option value="">Select a resource</option>{context.resources.filter((resource) => !operation.resourcePrefixes || operation.resourcePrefixes.some((prefix) => resource.id.startsWith(prefix))).map((resource) => <option key={resource.id} value={resource.id}>{resource.name} · {resource.id}</option>)}</ConsoleSelect></ConsoleField> : null}
    </div></ConsolePanelBody></ConsolePanel> : null}
    {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Loading management controls…</p> : null}
    {operation && !loading && !loadError ? <ConsolePanel title={review ? "Review operation" : operation.label}><ConsolePanelBody>
      <p className="mb-5 text-sm text-[#667085]">{operation.description}</p>
      {review ? <>
        <FieldGrid items={[{ label: "Project", value: context?.accountWide ? "Account-wide" : context?.projects.find((project) => project.value === context.selectedProjectId)?.label ?? projectId }, ...(resource ? [{ label: "Resource", value: `${resource.name} · ${resource.id}` }] : []), ...reviewItems]} />
        {operation.impact ? <label className="my-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><input type="checkbox" aria-label="Acknowledge operation impact" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{operation.impact}</span></label> : null}
        {confirmationNeeded ? <ConsoleField label={`Type ${resource?.name} to confirm`}><ConsoleInput aria-label="Confirmation name" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></ConsoleField> : null}
        <div className="mt-5 flex gap-3"><ConsoleButton disabled={pending} variant="neutral" onClick={() => setReview(false)}>Back to form</ConsoleButton><ConsoleButton disabled={pending || (confirmationNeeded && confirmation !== resource?.name) || (!!operation.impact && !acknowledged)} variant={operation.kind === "delete" ? "danger" : "primary"} onClick={submit}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}{operation.label}</ConsoleButton></div>
      </> : <>
        <fieldset disabled={pending || draftBusy} className="grid gap-4 md:grid-cols-2">{operation.fields.map((field) => <FormField key={field.key} field={field} value={values[field.key]} choices={context?.choices ?? {}} onChange={(value) => { setValues((previous) => ({ ...previous, [field.key]: value })); setDraftDirty(true); }} />)}</fieldset>
        {creationDraftFields(operation).length ? <div className="mt-4 rounded-lg border border-[#e4e9f2] p-3 text-sm"><p>Resource names and configuration choices are saved for 24 hours. Passwords and free-form content are not saved.</p>{draftStatus ? <p role="status" className="mt-1">{draftStatus}</p> : null}<ConsoleButton variant="neutral" className="mt-2" onClick={discardDraft} disabled={pending || draftBusy}>Discard saved draft</ConsoleButton></div> : null}
        {unavailable ? <p role="alert" className="mt-4 text-sm text-red-700">This operation is unavailable for the selected resource&apos;s state.</p> : null}
        <ConsoleButton className="mt-5" onClick={prepare} disabled={pending || !!unavailable || (operation.kind !== "create" && !resource)}>Review operation</ConsoleButton>
      </>}
      {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
    </ConsolePanelBody></ConsolePanel> : null}
    {outcome ? <ConsolePanel title="Operation outcome"><ConsolePanelBody><p role="status" className="text-sm font-bold text-green-800">{outcome.message}</p>{outcome.jobId ? <p className="mt-2 text-sm">Cloud job: {outcome.jobId} · <Link className="text-[#2563eb] underline" href="/tasks">Check operation history</Link></p> : null}{outcome.facts ? <FieldGrid items={outcome.facts} /> : null}{outcome.asynchronous ? <p className="mt-2 text-sm text-[#667085]">Huawei accepted the request. Provisioning or background work can continue after submission.</p> : null}</ConsolePanelBody></ConsolePanel> : null}
    {context ? <ConsolePanel title="Recent operation history"><ConsolePanelBody>{context.history.length ? <div className="space-y-3">{context.history.map((entry) => <div className="rounded-lg border border-[#e4e9f2] p-4" key={entry.id}><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-bold">{entry.operation} {entry.resourceName ? `· ${entry.resourceName}` : ""}</p><StatusBadge tone={entry.state === "failed" ? "bad" : entry.state === "succeeded" ? "good" : "warn"}>{entry.state}</StatusBadge></div><p className="mt-1 text-xs text-[#667085]"><LocalDateTime value={entry.startedAt} /></p>{entry.message ? <p className="mt-2 text-sm">{entry.message}</p> : null}</div>)}</div> : <p className="text-sm text-[#667085]">No operations have been recorded for this service.</p>}</ConsolePanelBody></ConsolePanel> : null}
  </ConsoleMain>;
}
