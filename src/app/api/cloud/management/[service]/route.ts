import { getCurrentSession } from "@/lib/auth-session";
import { getManagementContext, runManagementOperation } from "@/lib/huawei/management";
import { ManagementInputError } from "@/lib/management-contract";
import { isSameOriginManagementRequest } from "@/lib/huawei/management/request-origin";

const failure = (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Huawei Cloud management request failed." }, { status: error instanceof ManagementInputError ? error.status : 502 });

export async function GET(request: Request, { params }: { params: Promise<{ service: string }> }) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { service } = await params;
  const query = new URL(request.url).searchParams;
  try { return Response.json(await getManagementContext(session, service, query.get("projectId") ?? undefined, query.get("operation") ?? undefined, query.get("resourceId") ?? undefined)); } catch (error) { return failure(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ service: string }> }) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });
  const { service } = await params;
  if (!isSameOriginManagementRequest(request)) return Response.json({ error: "Cross-origin management requests are unavailable." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Enter valid JSON operation details." }, { status: 400 }); }
  try { return Response.json(await runManagementOperation(session, service, body)); } catch (error) { return failure(error); }
}
