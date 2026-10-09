import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementOperation } from "@/lib/management-contract";
import { validateCreationDraft } from "@/lib/management-draft-values";

export type CreationDraftScope = { service: string; projectId: string; operation: ManagementOperation };
const retentionMs = 24 * 60 * 60 * 1000;

function filename(session: BetterUiSession, scope: CreationDraftScope) {
  if (scope.operation.kind !== "create") throw new ManagementInputError("Saved drafts are available for creation workflows only.");
  const digest = createHash("sha256").update(JSON.stringify([session.accountName, session.userId ?? session.username, scope.service, scope.projectId, scope.operation.id])).digest("hex");
  return path.join(process.env.BETTERUI_DATA_DIR ?? path.join(process.cwd(), ".next", "cache", "betterui-data"), "creation-drafts", `${digest}.json`);
}

export async function readCreationDraft(session: BetterUiSession, scope: CreationDraftScope) {
  const file = filename(session, scope);
  let text: string;
  try { text = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("The saved creation draft could not be loaded."); }
  try {
    const draft = JSON.parse(text);
    const timestamp = Date.parse(draft.updatedAt);
    if (!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now() - timestamp >= retentionMs) { await rm(file, { force: true }); return null; }
    return { values: validateCreationDraft(scope.operation, draft.values), updatedAt: draft.updatedAt as string };
  } catch { throw new Error("The saved creation draft could not be verified. Discard it to start a new draft."); }
}

export async function saveCreationDraft(session: BetterUiSession, scope: CreationDraftScope, input: unknown) {
  const values = validateCreationDraft(scope.operation, input);
  const file = filename(session, scope);
  const temporary = `${file}.${randomUUID()}.tmp`;
  const updatedAt = new Date().toISOString();
  try {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify({ values, updatedAt }), { mode: 0o600 });
    await rename(temporary, file);
  } catch { await rm(temporary, { force: true }).catch(() => undefined); throw new Error("The creation draft could not be saved."); }
  return { values, updatedAt };
}

export async function deleteCreationDraft(session: BetterUiSession, scope: CreationDraftScope) {
  try { await rm(filename(session, scope), { force: true }); }
  catch { throw new Error("The saved creation draft could not be discarded."); }
}
