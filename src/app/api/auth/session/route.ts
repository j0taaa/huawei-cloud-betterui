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
    projectId: session.projectId,
    projectName: session.projectName,
    projects: session.projects.map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      region: project.region,
    })),
    region: session.region,
    userId: session.userId,
    username: session.username,
  });
}
