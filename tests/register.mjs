import { registerHooks } from "node:module";

// Exercise server modules outside Next without weakening the application boundary.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only")
      return {
        url: new URL("./fixtures/server-only.mjs", import.meta.url).href,
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});
