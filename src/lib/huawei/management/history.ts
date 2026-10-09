import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementHistoryEntry } from "@/lib/management-contract";

function directory(session: BetterUiSession) {
  const identity = JSON.stringify([session.accountName, session.userId ?? session.username]);
  return path.join(process.env.BETTERUI_DATA_DIR ?? path.join(process.cwd(), ".next", "cache", "betterui-data"), "operations", createHash("sha256").update(identity).digest("hex"));
}

export async function saveManagementHistory(session: BetterUiSession, entry: ManagementHistoryEntry) {
  if (!/^[a-f0-9-]{36}$/i.test(entry.id)) throw new Error("Invalid operation identifier.");
  const folder = directory(session);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const filename = path.join(folder, `${entry.id}.json`);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  // History stores operation metadata, never form values, tokens, or passwords.
  await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
  await rename(temporary, filename);
}

export async function listManagementHistory(session: BetterUiSession, service?: string) {
  const folder = directory(session);
  const names = await readdir(folder).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return [] as string[]; throw error; });
  const entries = await Promise.all(names.filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name)).map(async (name) => {
    try { return JSON.parse(await readFile(path.join(folder, name), "utf8")) as ManagementHistoryEntry; } catch { return null; }
  }));
  return entries.filter((entry): entry is ManagementHistoryEntry => !!entry && (!service || entry.service === service))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100);
}

export async function readManagementHistory(session: BetterUiSession, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid operation identifier.");
  try { return JSON.parse(await readFile(path.join(directory(session), `${id}.json`), "utf8")) as ManagementHistoryEntry; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Atomic on shared storage across Next workers and container restarts. */
export async function claimManagementOperation(session: BetterUiSession, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid operation identifier.");
  const folder = directory(session);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try { await mkdir(path.join(folder, `${id}.claim`), { mode: 0o700 }); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
}
