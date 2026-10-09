import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";

export type EnterpriseProject = {
  id: string;
  name: string;
  description: string;
  status: string;
  type: string;
  createdAt: string;
  updatedAt: string;
};

export async function listEnterpriseProjects(session: BetterUiSession) {
  if (!session.accountToken)
    throw new Error(
      "Sign out and sign in again to access Enterprise Project Management with an account token.",
    );
  // EPS is account-wide. Never fan out this request using regional project tokens.
  const body = await huaweiList<Record<string, unknown>>(
    { ...session, token: session.accountToken },
    "eps",
    "/v1.0/enterprise-projects?offset=0&limit=100",
    {
      items: ["enterprise_projects"],
      kind: "offset",
      parameter: "offset",
      size: 100,
      total: ["total_count"],
    },
  );
  return asArray(body.enterprise_projects).map((value): EnterpriseProject => {
    const item = asRecord(value);
    const id = firstString([item.id], "");
    if (!id)
      throw new Error("EPS response did not include an enterprise project ID.");
    return {
      id,
      name: firstString([item.name], id),
      description: firstString([item.description]),
      status:
        item.status === 1
          ? "Enabled"
          : item.status === 2
            ? "Disabled"
            : "UNKNOWN",
      type:
        item.type === "prod"
          ? "Commercial"
          : item.type === "poc"
            ? "Test"
            : firstString([item.type]),
      createdAt: firstString([item.created_at]),
      updatedAt: firstString([item.updated_at]),
    };
  });
}
