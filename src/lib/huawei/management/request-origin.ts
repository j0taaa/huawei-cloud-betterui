/** The public host is retained by Traefik even when Next's internal URL uses localhost. */
export function isSameOriginManagementRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const internal = new URL(request.url);
  const host = request.headers.get("host") ?? internal.host;
  const forwarded = request.headers.get("x-forwarded-proto");
  const protocol = forwarded === "https" || forwarded === "http" ? `${forwarded}:` : internal.protocol;
  try { return new URL(origin).origin === `${protocol}//${host}`; } catch { return false; }
}
