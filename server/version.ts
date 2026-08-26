import { readFileSync } from "fs";
import path from "path";

// The server's single idea of the app version, resolved once at boot.
//
// Production: script/build.ts stamps process.env.APP_VERSION (esbuild define)
// with the exact same "1.0.0+2026-07-19T22:41" string baked into the client
// bundle as import.meta.env.VITE_APP_VERSION — so GET /api/version always
// describes the client build this server is serving, and the in-app update
// check can compare the two byte-for-byte.
//
// Development: no stamp exists — fall back to package.json's bare version.
// The dev client renders APP_VERSION as "dev" and never version-polls, so the
// unstamped value is display-only there.
function resolveVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"),
    );
    if (pkg?.version) return String(pkg.version);
  } catch {}
  return "unknown";
}

export const SERVER_APP_VERSION = resolveVersion();
