import { defineConfig } from "vitest/config";
import path from "path";

// Standalone config for unit tests of pure logic (no app vite plugins).
// esbuild's automatic JSX runtime (same as the app build) lets tests import
// .tsx modules (e.g. FeedErrorBoundary) without the react plugin.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["client/src/**/*.test.ts", "server/**/*.test.ts", "shared/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
});
