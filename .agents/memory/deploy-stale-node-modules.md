---
name: Prod crashes on missing module while dev is fine
description: VM deploy reused stale node_modules; fix is a clean install in the deploy build command.
---

# Symptom
Dev (`npm run dev` via tsx) runs clean, but the published VM deployment crash-loops at boot with `Error: Cannot find module '<pkg>'` (seen with `@noble/curves/secp256k1.js`), healthchecks return 500. `getDeploymentInfo()` can still report `hasSuccessfulBuild: true` because the *build* passes — esbuild externalizes runtime deps, so bundling never resolves them; only `node dist/index.cjs` fails when the deployed node_modules is stale/mismatched.

# Root cause
The deploy build command was just `npm run build`, which never reinstalls. The VM reused a stale `node_modules` from a prior deploy whose transitive dep versions no longer matched package.json/lockfile, so a require path (e.g. a newer `@noble/curves@2.x` export like `secp256k1.js`) was absent.

# Fix (strongest — applied after `npm ci` alone did NOT fix prod)
Even with `npm ci && npm run build` as the deploy build command, the VM's runtime node_modules still lacked the package (republish reproduced the identical crash). The reliable fix: make the server bundle self-contained. The esbuild build script has a bundle allowlist; any package the bundled server `require()`s at runtime must be IN the allowlist (added `@noble/curves`, `@noble/hashes` — nostr-tools was bundled but its crypto deps were externalized).
Verify with: extract non-builtin `require()` specifiers from `dist/index.cjs`; only optional try/catch requires (`pg-native`, `supports-color`, `utf-8-validate`) may remain. Final proof: copy `dist/index.cjs` + `dist/public` to an empty dir and boot it — must serve with zero node_modules.

# Native modules (sharp etc.)
Native packages cannot be bundled, so they must NEVER be top-level server imports — a stale deploy node_modules turns them into boot crashes (happened with `sharp` in the OG-card renderer). Pattern: lazy `await import()` inside a cached getter that throws a catchable error; feature routes degrade (e.g. redirect to static og-image.png) while the server keeps serving. Pure-JS deps of such features (satori, undici) go in the bundle allowlist instead.

# Fix (durable)
Set the deploy build command to reinstall cleanly before building:
`build = ["bash", "-c", "npm ci && npm run build"]` (via `deployConfig` or `.replit` `[deployment]`).
Verify first that `npm ci --dry-run` passes (lockfile in sync) so the deploy build won't fail. `npm ci` installs devDeps too (needed for vite/esbuild/tsx build), and keeps runtime deps for the externalized bundle.

**Why:** merges frequently add deps to package.json without the deploy environment reinstalling, so the deployment keeps whatever node_modules it had. A clean lockfile-exact install every deploy kills this whole failure class.
**How to apply:** whenever prod crashes with MODULE_NOT_FOUND but the same code boots locally after a fresh `npm run build` + `node dist/index.cjs`, suspect the deploy install step, not the code.
