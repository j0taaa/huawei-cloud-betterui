// Production smoke tests route signed OBS requests to the same local provider mock.
// Never enabled by application configuration or production deployment.
const original = globalThis.fetch;
if (process.env.BETTERUI_SMOKE_OBS_URL) {
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (/(^|\.)obs\.sa-brazil-1\.myhuaweicloud\.com$/.test(url.hostname)) {
      const mock = new URL(process.env.BETTERUI_SMOKE_OBS_URL);
      mock.pathname = `/obs/${url.pathname.slice(1)}`; mock.search = url.search;
      const headers = new Headers(init?.headers);
      headers.set("x-betterui-smoke-original-host", url.hostname);
      return original(mock, { ...init, headers });
    }
    return original(input, init);
  };
}
