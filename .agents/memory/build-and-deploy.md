---
name: build & deploy gotchas
description: Pre-republish QA heuristics for this Nostr client — build vs typecheck, dev vs prod, and package-firewall blocks
---

# Judge build health by `npm run build`, not by `tsc`
The production build (`tsx script/build.ts`) is vite + esbuild only — it does **not** type-check. `tsc`/`npm run check` reports many pre-existing type errors that never block the build or deploy. Don't treat them as republish blockers.

# A green dev preview does NOT prove a green production build
Vite dev can serve an import that the production Rollup build cannot resolve when a package is declared in package.json/lockfile but missing from node_modules (install drift). **Always run the real `npm run build` as the pre-republish gate**, plus a prod-server boot smoke test.

# The Socket package firewall can hard-block a pinned dep and abort the whole install
A single blocked version (HTTP 403 from `package-firewall.replit.local`, "Critical CVE") fails the entire `npm install`, even for a dev-only dep that's irrelevant to build/runtime. Deploys do a fresh install from the lockfile, so the **lockfile** must reference an allowed version.
**Why:** the deploy build installs devDependencies (needs vite/esbuild/tsx), so a blocked devDep version breaks the deploy.
**How to apply:** bump to an allowed version; update only the lockfile with `npm install --package-lock-only` to avoid node_modules rename churn. Don't retry the same blocked 403.

# npm ENOTEMPTY during install = stale reify temp dirs
Failed installs leave many `node_modules/.<pkg>-<8charhash>` temp dirs that then cause `ENOTEMPTY` rename errors. Clean with a find over that pattern, or prefer `--package-lock-only` when you only need the lockfile.
