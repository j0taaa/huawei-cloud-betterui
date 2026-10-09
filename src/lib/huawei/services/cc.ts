import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { cloudConnectManagement } from "@/lib/huawei/management/adapters/cc";

/** Native account-wide CC inventory is queried once with the domain-scoped account token. */
export const listCloudConnections = (session: BetterUiSession) => cloudConnectManagement.inventory(session);
