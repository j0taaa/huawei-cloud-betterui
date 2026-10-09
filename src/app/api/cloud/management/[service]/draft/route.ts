import { getCurrentSession } from "@/lib/auth-session";
import { ManagementInputError } from "@/lib/management-contract";
import { managementAdapters } from "@/lib/huawei/management/registry";
import { deleteCreationDraft, readCreationDraft, saveCreationDraft } from "@/lib/huawei/management/drafts";
import { isSameOriginManagementRequest } from "@/lib/huawei/management/request-origin";
import { projectForId } from "@/lib/huawei/projects";

type Context = { params: Promise<{ service: string }> };
async function scopeFor(request: Request, context: Context) {
  const session = await getCurrentSession();
  if (!session) throw new ManagementInputError("Not signed in.", 401);
  const { service } = await context.params;
  if (!Object.hasOwn(managementAdapters, service)) throw new ManagementInputError("This service has no creation drafts.");
  const adapter = managementAdapters[service];
  const query = new URL(request.url).searchParams;
  const operation = adapter.operations.find(operation => operation.id === query.get("operation") && operation.kind === "create");
  if (!operation) throw new ManagementInputError("Select a creation workflow for the saved draft.");
  if (adapter.accountWide && !session.accountToken) throw new ManagementInputError("Sign in again to obtain an account token.", 409);
  let projectId = "account";
  if (!adapter.accountWide) {
    try { projectId = projectForId(session, query.get("projectId") ?? undefined).projectId; }
    catch { throw new ManagementInputError("The selected project is not part of this session.", 403); }
  }
  return { session, scope: { service, projectId, operation } };
}
const failure = (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "The creation draft request failed." }, { status: error instanceof ManagementInputError ? error.status : 502 });

export async function GET(request: Request, context: Context) {
  try { const { session, scope } = await scopeFor(request, context); return Response.json({ draft: await readCreationDraft(session, scope) }); }
  catch (error) { return failure(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { session, scope } = await scopeFor(request, context);
    if (!isSameOriginManagementRequest(request)) throw new ManagementInputError("Cross-origin management requests are unavailable.", 403);
    let body: unknown;
    try { body = await request.json(); } catch { throw new ManagementInputError("Enter valid JSON draft values."); }
    return Response.json({ draft: await saveCreationDraft(session, scope, body) });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const { session, scope } = await scopeFor(request, context);
    if (!isSameOriginManagementRequest(request)) throw new ManagementInputError("Cross-origin management requests are unavailable.", 403);
    await deleteCreationDraft(session, scope);
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
