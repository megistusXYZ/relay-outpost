/**
 * What the service health check (service-health.ts) asks, and how. The
 * addresses come from where the app keeps them, so a change there is checked
 * here without anyone remembering to; the few the server can't import from
 * client modules are pinned to them by service-health-targets.test.ts.
 */
import crypto from "node:crypto";
import { DEFAULT_RELAYS, SEARCH_RELAYS } from "../client/src/lib/relay-constants";
import { PROFILE_DIRECTORIES } from "@shared/profile-directories";
import { DEFAULT_LENS } from "@shared/default-lens";
import { GRAPERANK_UPSTREAM, BRAINSTORM_SEARCH_API } from "./graperank-proxy";
import { LANES, FORM } from "./translate";
import { PRICE_SOURCES } from "./btc-price";
import type { CheckResult, Dependency } from "./service-health";
import { probeDirectory, probeHttp, probeReachable, probeRelay } from "./service-probes";

/** Podcast Index signs every request with the key, the secret and the time. */
export function getPodcastIndexHeaders(): Record<string, string> {
  const apiKey = process.env.PODCAST_INDEX_API_KEY || "";
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET || "";
  const ts = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash("sha1").update(apiKey + apiSecret + String(ts)).digest("hex");
  return {
    "User-Agent": "RelayOutpost/1.0",
    "X-Auth-Date": String(ts),
    "X-Auth-Key": apiKey,
    "Authorization": hash,
  };
}

/** Primal's caches (client/src/lib/primal-cache.ts PRIMAL_CACHE_URLS). */
export const PRIMAL_CACHES = ["wss://cache.primal.net/v1", "wss://cache2.primal.net/v1", "wss://cache1.primal.net/v1"];
/** The default upload servers (client/src/lib/media-upload.ts DEFAULT_BLOSSOM_SERVERS). */
export const UPLOAD_SERVERS = ["https://blossom.primal.net", "https://nostr.build"];
/** People search (client/src/lib/people-search.ts PEOPLE_SEARCH_RELAY). */
export const PEOPLE_SEARCH = "wss://search.brainstorm.world";

/** Profiles that exist (the first suggested people): a directory holds most of them. */
export const KNOWN_PROFILES = [
  "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2",
  "c4eabae1be3cf657bc1855ee05e69de9f059cb7a059227168b80b89761cbc4e0",
  "edcd20558f17d99327d841e4582f9b006331ac4010806efa020ef0d40078e6da",
  "3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24",
  "eab0e756d32b80bcd464f3d844b8040303075a13eabc3599a762c9ac7ab91f4f",
  "460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c",
];

type Target = Dependency & { probe: () => Promise<CheckResult> };

const host = (url: string) => url.replace(/^wss?:\/\//, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

export function serviceHealthTargets(env: NodeJS.ProcessEnv = process.env): Target[] {
  const relays: Target[] = DEFAULT_RELAYS.map((url) => ({
    id: `relay:${host(url)}`, label: host(url), group: "Default relays", kind: "relay", target: url,
    probe: () => probeRelay(url),
  }));
  const search: Target[] = [...SEARCH_RELAYS, PEOPLE_SEARCH].map((url) => ({
    id: `search:${host(url)}`, label: host(url), group: "Search", kind: "relay", target: url,
    probe: () => probeRelay(url),
  }));
  const directories: Target[] = PROFILE_DIRECTORIES.map((url) => ({
    id: `directory:${host(url)}`, label: host(url), group: "Profile directories", kind: "directory", target: url,
    probe: () => probeDirectory(url, KNOWN_PROFILES),
  }));
  const primal: Target[] = PRIMAL_CACHES.map((url) => ({
    id: `primal:${host(url)}`, label: host(url), group: "Primal", kind: "socket", target: url,
    probe: () => probeRelay(url),
  }));
  const uploads: Target[] = UPLOAD_SERVERS.map((url) => ({
    id: `upload:${host(url)}`, label: host(url), group: "Uploads", kind: "http", target: url,
    probe: () => probeReachable(url),
  }));
  const services: Target[] = [
    {
      id: "http:trust-scores", label: "Trust scores (Brainstorm)", group: "Outside services", kind: "http",
      target: `${GRAPERANK_UPSTREAM}/user/…`,
      probe: () => probeHttp(`${GRAPERANK_UPSTREAM}/user/${DEFAULT_LENS}`),
    },
    {
      id: "http:brainstorm-search", label: "Profile search API (Brainstorm)", group: "Outside services", kind: "http",
      target: `${BRAINSTORM_SEARCH_API}/api/search/profiles/meili/document/…`,
      probe: () => probeHttp(`${BRAINSTORM_SEARCH_API}/api/search/profiles/meili/document/${DEFAULT_LENS}`),
    },
    ...LANES.map((lane): Target => ({
      id: `http:translate-${lane.name}`, label: `Translate (${lane.name})`, group: "Outside services", kind: "http",
      target: lane.url("en").replace(/\?.*$/, ""),
      probe: () => probeHttp(lane.url("en"), {
        init: { method: "POST", headers: FORM, body: new URLSearchParams({ q: "hola" }) },
        check: (json) => !!lane.parse(json)?.text,
      }),
    })),
    ...PRICE_SOURCES.map((src): Target => ({
      id: `http:price-${src.id}`, label: `Bitcoin price (${src.id})`, group: "Outside services", kind: "http",
      target: src.url.replace(/\?.*$/, ""),
      probe: () => probeHttp(src.url, { check: (json) => !!src.parse(json) }),
    })),
  ];
  if (env.PODCAST_INDEX_API_KEY && env.PODCAST_INDEX_API_SECRET) {
    services.push({
      id: "http:podcast-index", label: "Podcast search (Podcast Index)", group: "Outside services", kind: "http",
      target: "https://api.podcastindex.org/api/1.0/categories/list",
      probe: () => probeHttp("https://api.podcastindex.org/api/1.0/categories/list", { init: { headers: getPodcastIndexHeaders() } }),
    });
  }
  return [...relays, ...search, ...directories, ...primal, ...uploads, ...services];
}
