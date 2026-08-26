import base from "./vitest.config";
import { defineConfig, mergeConfig } from "vitest/config";

// The normal suite, minus the globals Node 20 doesn't have. See
// test/ci-globals.ts for why this exists and what it deliberately does not do.
//   npm run test:ci-globals
export default mergeConfig(
  base,
  defineConfig({
    test: { setupFiles: ["./test/ci-globals.ts"] },
  }),
);
