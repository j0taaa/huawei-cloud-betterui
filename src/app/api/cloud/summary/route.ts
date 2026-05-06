import { NextResponse } from "next/server";

import { loadCloudSummary } from "@/lib/huawei-cloud";

export async function GET() {
  const result = await loadCloudSummary();

  return NextResponse.json(result, {
    status: result.error ? 502 : 200,
  });
}
