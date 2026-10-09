import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { packagesManagement } from "@/lib/huawei/management/adapters/packages";

/** Purchased packages are queried account-wide, once for each native enterprise-project scope. */
export async function listResourcePackages(session: BetterUiSession) {
  return packagesManagement.inventory(session);
}
