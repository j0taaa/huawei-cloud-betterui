import { getCurrentSession } from "@/lib/auth-session";
import { getManagementContext, runManagementOperation } from "@/lib/huawei/management";
import { ManagementInputError } from "@/lib/management-contract";

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
  const origin = request.headers.get("origin");
  if (origin) {
    // Next's internal URL can use localhost while Host retains the browser's host.
    // Traefik forwards the public protocol and preserves Host in this deployment.
    const internal = new URL(request.url);
    const host = request.headers.get("host") ?? internal.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProtocol === "https" || forwardedProtocol === "http" ? `${forwardedProtocol}:` : internal.protocol;
    let sameOrigin = false;
    try { const supplied = new URL(origin); sameOrigin = supplied.origin === `${protocol}//${host}`; } catch {}
    if (!sameOrigin) return Response.json({ error: "Cross-origin management requests are unavailable." }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Enter valid JSON operation details." }, { status: 400 }); }
  try { return Response.json(await runManagementOperation(session, service, body)); } catch (error) { return failure(error); }
}
