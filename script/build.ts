import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import { execSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  // nostr-tools' crypto deps MUST be bundled alongside it: bundling nostr-tools
  // destroys nested node_modules resolution, so leaving these external makes the
  // deployed server resolve them against whatever top-level node_modules the VM
  // happens to have — a stale install crashes boot with "Cannot find module
  // '@noble/curves/secp256k1.js'" (the 2026-07-12 production outage).
  "@noble/ciphers",
  "@noble/curves",
  "@noble/hashes",
  "@scure/base",
  "@scure/bip32",
  "@scure/bip39",
  "@google/generative-ai",
  "@noble/curves",
  "@noble/hashes",
  "axios",
  "edge-tts-universal",
  // Its transitive deps (bytes, compressible, vary…) are NOT direct app deps,
  // so esbuild bundles them with it — the allowlist rule holds.
  "compression",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "helmet",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "node-edge-tts",
  "nodemailer",
  "nostr-tools",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "rss-parser",
  "satori",
  "stripe",
  "undici",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  const pkg = JSON.parse(await readFile("package.json", "utf-8"));

  // One build-version stamp for the WHOLE build: the client bundle bakes it in
  // as import.meta.env.VITE_APP_VERSION (vite.config.ts `define` picks up this
  // env var) and the server bundle bakes the identical string into
  // process.env.APP_VERSION (esbuild `define` below) for GET /api/version.
  // Computing it here — not separately in each build step — is what guarantees
  // client and server can never disagree by a few seconds of timestamp drift.
  // Prefix the build stamp with the git short SHA so a crash ticket pins the
  // exact commit ("a3202be+2026-07-20T09:50"); the timestamp keeps it unique
  // per Republish so the update check always fires. Falls back to the package
  // version outside a git checkout. The HUMAN version comes from the changelog
  // (client APP_VERSION) — this stamp is the machine-facing build id.
  let gitSha = "";
  try {
    gitSha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    /* not a git checkout — fall back to the package version below */
  }
  const appVersion =
    process.env.VITE_APP_VERSION ||
    `${gitSha || pkg.version || "0.0.0"}+${new Date().toISOString().slice(0, 16)}`;
  process.env.VITE_APP_VERSION = appVersion;

  console.log(`building client... (version ${appVersion})`);
  await viteBuild();

  console.log("building server...");
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.APP_VERSION": JSON.stringify(appVersion),
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
