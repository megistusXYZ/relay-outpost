import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Build-version stamp: package.json version + a minute-precision UTC build
// timestamp, e.g. "1.0.0+2026-07-19T22:41". Computed ONCE at build time (never
// at runtime) so every module in the bundle sees the same value. script/build.ts
// pre-computes the same string into process.env.VITE_APP_VERSION so the client
// bundle and the server's /api/version endpoint stay byte-identical — the
// in-app update check compares the two.
function computeAppVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf-8"),
    );
    const stamp = new Date().toISOString().slice(0, 16);
    return `${pkg.version || "0.0.0"}+${stamp}`;
  } catch {
    return "unknown";
  }
}

export default defineConfig(async ({ mode }) => {
  const isProd = mode === "production";

  return {
    // Only stamp production builds — dev keeps VITE_APP_VERSION unset so
    // APP_VERSION renders "dev" and the client update-poll stays off.
    define: isProd
      ? {
          "import.meta.env.VITE_APP_VERSION": JSON.stringify(
            process.env.VITE_APP_VERSION || computeAppVersion(),
          ),
        }
      : {},
    plugins: [
      react(),
      runtimeErrorOverlay({
        filter: (error: Error) => {
          const msg = error.message || "";
          if (!msg || msg === "(unknown runtime error)") return false;
          const noise = [
            "on a closed connection",
            "Tried to send message",
            "WebSocket is already in CLOSING",
            "WebSocket is not open",
            "auth timed out",
            "auth event validation failed",
            "auth-required",
            "restricted: not authenticated",
            "reading 'maybe'",
            "Unexpected response code",
            "WebSocket connection to",
            "Error during WebSocket handshake",
            "connection failed",
            "failed to connect",
            "net::ERR_",
            "WebSocket error event",
            "ResizeObserver",
            "Non-Error promise rejection",
            "Load failed",
            "Failed to fetch",
            "NetworkError",
            "AbortError",
            "NotAllowedError",
            "The operation was aborted",
            "cancelled",
            "Illegal invocation",
            "Script error",
          ];
          return !noise.some((n) => msg.includes(n));
        },
      }),
      ...(!isProd && process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer(),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
      // Bundle analyzer — dev-only, never ships, NOT a dependency. To use:
      // `npm i -D rollup-plugin-visualizer` then `ANALYZE=1 npm run build`
      // → emits dist/stats.html. Computed specifier so tsc/build don't require it.
      ...(process.env.ANALYZE
        ? await (async () => {
            try {
              const mod: any = await import(/* @vite-ignore */ ("rollup-plugin-" + "visualizer"));
              return [mod.visualizer({ filename: "dist/stats.html", template: "treemap", gzipSize: true, brotliSize: true })];
            } catch {
              console.warn("[analyze] install rollup-plugin-visualizer to use ANALYZE=1");
              return [];
            }
          })()
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "client", "src", "assets"),
      },
    },
    root: path.resolve(import.meta.dirname, "client"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      // Downlevel newer syntax for ~4-year-old browsers/Android WebViews. This
      // baseline matches the app's existing reliance on WebP (Safari 14+) and
      // keeps BigInt / optional-chaining (which the code uses) intact — going
      // older risks unpolyfillable runtime features. No heavy legacy polyfills.
      target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
      rollupOptions: {
        output: {
          manualChunks: {
            "react-vendor": ["react", "react-dom", "react-dom/client"],
            "router-query": ["wouter", "@tanstack/react-query"],
            "nostr-vendor": [
              "applesauce-core",
              "applesauce-content",
              "applesauce-factory",
              "applesauce-react",
              "applesauce-signers",
              "nostr-tools",
            ],
            "ui-radix": [
              "@radix-ui/react-dialog",
              "@radix-ui/react-dropdown-menu",
              "@radix-ui/react-popover",
              "@radix-ui/react-tooltip",
              "@radix-ui/react-tabs",
              "@radix-ui/react-toast",
              "@radix-ui/react-select",
              "@radix-ui/react-scroll-area",
            ],
            "motion-icons": ["framer-motion", "lucide-react"],
          },
        },
      },
    },
    esbuild: {
      drop: isProd ? ["debugger"] : [],
      pure: isProd
        ? ["console.log", "console.debug", "console.info", "console.trace"]
        : [],
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
