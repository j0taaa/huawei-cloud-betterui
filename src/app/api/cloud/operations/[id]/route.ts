import { getCurrentSession, getSessionProjects } from "@/lib/auth-session";
import { ManagementInputError } from "@/lib/management-contract";
import { readManagementHistory, saveManagementHistory } from "@/lib/huawei/management/history";
import { managementAdapters } from "@/lib/huawei/management/registry";
import { invalidateCloudResult } from "@/lib/huawei/result";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) return Response.json({ error: "Invalid operation ID." }, { status: 400 });
  try {
    const entry = await readManagementHistory(session, id);
    if (!entry) throw new ManagementInputError("Operation not found.", 404);
    const adapter = Object.hasOwn(managementAdapters, entry.service) ? managementAdapters[entry.service] : undefined;
    if (entry.state !== "submitted" || (!entry.jobId && !entry.observationId) || !adapter?.poll) return Response.json({ entry, canRefresh: false });
    const project = getSessionProjects(session).find((project) => project.projectId === entry.projectId);
    if (!project && !adapter.accountWide) throw new ManagementInputError("The operation's project is no longer in this session.", 403);
    const selected = adapter.accountWide ? session : { ...session, ...project!, projects: [project!] };
    const outcome = await adapter.poll(selected, entry);
    const next = { ...entry, ...(outcome.observedTask ? { observedTask: outcome.observedTask } : {}), state: outcome.state, message: outcome.message ?? entry.message, ...(outcome.resourceId ? { resultResourceId: outcome.resourceId, resourceId: entry.resourceId ?? outcome.resourceId } : {}), ...(outcome.state !== "submitted" ? { finishedAt: new Date().toISOString() } : {}) };
    await saveManagementHistory(session, next);
    if (outcome.state !== "submitted") await Promise.allSettled(adapter.invalidationKeys(entry.resourceId ? { id: entry.resourceId, name: entry.resourceName ?? entry.resourceId } : undefined).map((key) => invalidateCloudResult(session, key)));
    return Response.json({ entry: next, canRefresh: outcome.state === "submitted" });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Operation status could not be loaded." }, { status: error instanceof ManagementInputError ? error.status : 502 }); }
}
