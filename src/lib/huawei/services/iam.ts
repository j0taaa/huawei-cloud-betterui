import "server-only";

import type { BetterUiSession } from "@/lib/auth-session";
import { huaweiAccountFetch } from "@/lib/huawei/http";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";

export type IamUser = {
  description: string;
  domainId: string;
  enabled: string;
  id: string;
  name: string;
  passwordExpiresAt: string;
};

export async function listIamUsers(session: BetterUiSession) {
  const body = await huaweiAccountFetch<{ users?: unknown[] }>(
    session,
    "/v3/users",
  );

  return asArray(body.users).map((user): IamUser => {
    const item = asRecord(user);

    return {
      description: asString(item.description, ""),
      domainId: asString(item.domain_id),
      enabled: String(item.enabled ?? "-"),
      id: asString(item.id),
      name: asString(item.name),
      passwordExpiresAt: firstString(
        [item.password_expires_at, item.pwd_status],
        "-",
      ),
    };
  });
}
