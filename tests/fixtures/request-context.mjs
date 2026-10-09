import { AsyncLocalStorage } from "node:async_hooks";

const requests = new AsyncLocalStorage();
export function withSessionCookie(sessionId, run) {
  return requests.run(sessionId, run);
}
export async function cookies() {
  return {
    get() {
      const id = requests.getStore();
      return id ? { value: id } : undefined;
    },
  };
}
