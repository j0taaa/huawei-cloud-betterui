import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    accountName: session.accountName,
    authenticated: true,
    expiresAt: session.expiresAt,
    projectName: session.projectName,
    region: session.region,
    userId: session.userId,
    username: session.username,
  });
}
