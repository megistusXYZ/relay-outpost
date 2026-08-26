# Relay Outpost — multi-stage image.
#
# Build on Apple Silicon with:
#   docker buildx build --platform linux/amd64 -t <registry>/relay-outpost:latest .
# (sharp/esbuild ship per-arch binaries; the arrowhead cluster is amd64.)
#
# The runtime stage does NOT run `drizzle-kit push` — schema push runs as a
# Helm hook Job in the cluster (charts/relay-outpost in relay-op-ops), or via
# the explicit `command:` override in docker-compose.yml locally. A pod
# restart must never race DDL.

# ---------- build stage ----------
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Replit's publish flow rewrites lockfile `resolved` URLs to an internal proxy
# host — normalize back to the public registry (same fix CI applies). And use
# `npm install`, not `npm ci`: the lockfile omits the optional native
# bufferutil (via ws), which makes strict `npm ci` fail on Linux.
RUN sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json \
 && npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM node:20-slim
ENV NODE_ENV=production PORT=5000
# cwd MUST be /app: server/og-cards.ts reads process.cwd()/dist/public/logo.svg
# for OG images, and server/version.ts falls back to process.cwd()/package.json.
WORKDIR /app
# dist/index.cjs bundles every statically-imported server dep (see
# script/build.ts's allowlist). The ONLY packages resolved from node_modules
# at runtime are the optional dynamic imports — sharp (OG images), jsdom +
# @mozilla/readability (article extraction) — plus the drizzle toolchain the
# schema-push job uses. Installed WITHOUT the app package.json in scope so
# npm doesn't drag in the full client dep tree.
#
# KEEP THESE VERSIONS IN SYNC with package.json when bumping deps — drift here
# silently ships old native binaries. Fallback if this targeted install ever
# misbehaves: replace it with `COPY --from=build /app/node_modules ./node_modules`.
RUN npm install --no-save --no-audit --no-fund \
      sharp@0.35.4 jsdom@28.1.0 @mozilla/readability@0.6.0 \
      drizzle-kit@0.31.10 drizzle-orm@0.45.2 drizzle-zod@0.7.0 zod@3.24.2 pg@8.16.3 \
 && npm cache clean --force
COPY package.json drizzle.config.ts ./
COPY shared ./shared
COPY --from=build /app/dist ./dist
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
