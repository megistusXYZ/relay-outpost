/**
 * What the health check asks (server/service-health-targets.ts) is what the
 * app uses. A few addresses live in client modules the server can't import
 * (they pull in the relay pool), so they are listed here and pinned to the
 * client's own text; the rest come straight from the app's constants.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { nip19 } from "nostr-tools";
import { serviceHealthTargets, PRIMAL_CACHES, PEOPLE_SEARCH, KNOWN_PROFILES } from "./service-health-targets";
import { DEFAULT_RELAYS, SEARCH_RELAYS } from "../client/src/lib/relay-constants";
import { PROFILE_DIRECTORIES } from "@shared/profile-directories";
import { CURATED_SEED_NPUBS } from "../client/src/lib/curated-seed-follows";

const client = (f: string) => readFileSync(path.resolve(__dirname, "../client/src/lib", f), "utf8");

describe("service health targets", () => {
  it("Primal's caches and people search are the client's own", () => {
    const primal = client("primal-cache.ts");
    for (const url of PRIMAL_CACHES) expect(primal).toContain(`"${url}"`);
    expect(primal.match(/"wss:\/\/cache[0-9]*\.primal\.net\/v1"/g)?.length).toBe(PRIMAL_CACHES.length);
    expect(client("people-search.ts")).toContain(`PEOPLE_SEARCH_RELAY = "${PEOPLE_SEARCH}"`);
  });

  it("the well-known profiles are the first suggested people", () => {
    expect(KNOWN_PROFILES).toEqual(CURATED_SEED_NPUBS.slice(0, 6).map((n) => nip19.decode(n).data));
  });

  it("checks every default relay, search relay and profile directory, and each outside service", () => {
    const t = serviceHealthTargets({});
    const targets = new Set(t.map((x) => x.target));
    for (const url of [...DEFAULT_RELAYS, ...SEARCH_RELAYS, PEOPLE_SEARCH, ...PROFILE_DIRECTORIES, ...PRIMAL_CACHES]) expect(targets, url).toContain(url);
    const labels = t.map((x) => x.label).join(" | ");
    for (const s of ["Trust scores", "Profile search API", "Translate (gtx)", "Translate (dict)", "Bitcoin price (coingecko)"]) expect(labels).toContain(s);
    expect(new Set(t.map((x) => x.id)).size).toBe(t.length);
  });

  it("Podcast Index only when the server has its key", () => {
    expect(serviceHealthTargets({}).some((x) => x.id === "http:podcast-index")).toBe(false);
    expect(serviceHealthTargets({ PODCAST_INDEX_API_KEY: "k", PODCAST_INDEX_API_SECRET: "s" }).some((x) => x.id === "http:podcast-index")).toBe(true);
  });
});
