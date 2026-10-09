import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementChoice, ManagementHistoryEntry, ManagementOperation, ManagementOutcome, ManagementResource, ManagementValues } from "@/lib/management-contract";

export type ManagementAdapter = {
  title: string;
  accountWide?: boolean;
  operations: ManagementOperation[];
  inventory: (session: BetterUiSession) => Promise<ManagementResource[]>;
  // Composite services may verify one independently authorized resource plane for an action.
  // The requested plane still requires a complete inventory and fresh ownership checks.
  inventoryForResource?: (session: BetterUiSession, id: string) => Promise<ManagementResource[]>;
  options?: (session: BetterUiSession, operation: string, resource?: ManagementResource) => Promise<Record<string, ManagementChoice[]>>;
  execute: (session: BetterUiSession, operation: string, values: ManagementValues, resource?: ManagementResource) => Promise<ManagementOutcome>;
  poll?: (session: BetterUiSession, entry: ManagementHistoryEntry) => Promise<{ state: "submitted" | "succeeded" | "failed"; message?: string; resourceId?: string; observedTask?: string }>;
  invalidationKeys: (resource?: ManagementResource) => string[];
};
