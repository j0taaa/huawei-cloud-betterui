import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";

export const project: HuaweiProjectSession = {
  expiresAt: "2099-01-01T00:00:00Z",
  projectId: "project-1",
  projectName: "sa-brazil-1_team",
  region: "sa-brazil-1",
  token: "test-token",
};
export const session: BetterUiSession = {
  ...project,
  tokenExpiresAt: project.expiresAt,
  accountName: "test-account",
  createdAt: "2026-01-01T00:00:00Z",
  iamEndpoint: "https://iam.example.invalid",
  projects: [project],
  userId: "user-1",
  username: "test-user",
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
