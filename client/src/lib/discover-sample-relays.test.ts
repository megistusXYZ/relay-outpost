/**
 * Discover's broad samples (recent notes / articles / events / videos from
 * anyone) skip relay.damus.io. Measured 2026-09-30: a cold Discover load
 * asked every fast relay for the same samples, ~1.2 MB each (the 300-note
 * feed sample alone 819 KB), and damus allows ~1 MB of reads per minute per
 * IP ("read bandwidth budget exhausted"), so one load could use it all up and
 * every later request was refused. Damus keeps the small, targeted lookups
 * (trusted people, your follows); the other relays carry the samples.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { sampleRelays } from "./discover-sample-relays";

describe("sampleRelays", () => {
  it("leaves damus out of a broad sample", () => {
    expect(sampleRelays(["wss://relay.damus.io", "wss://relay.snort.social", "wss://nostr.land"]))
      .toEqual(["wss://relay.snort.social", "wss://nostr.land"]);
  });

  it("recognises damus written with a trailing slash or in capitals", () => {
    expect(sampleRelays(["wss://relay.damus.io/", "wss://nos.lol"])).toEqual(["wss://nos.lol"]);
    expect(sampleRelays(["WSS://Relay.Damus.io", "wss://nos.lol"])).toEqual(["wss://nos.lol"]);
  });

  it("never leaves a sample with no relay to ask", () => {
    expect(sampleRelays(["wss://relay.damus.io"])).toEqual(["wss://relay.damus.io"]);
  });
});

describe("Discover's broad samples use it", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "discover-data.ts"), "utf8");
  const lookups = [...src.matchAll(/collectOnce\(([^,]+),\s*\{([^}]*)\}/g)].map((m) => ({ relays: m[1].trim(), filter: m[2] }));

  it("every lookup without an authors list asks sampleRelays(...)", () => {
    // Market asks Conduit's listing relays only (`relays` there), and the
    // relay fallback names its set `sample`, built from sampleRelays below.
    const broad = lookups.filter((l) => !/authors/.test(l.filter) && l.relays !== "relays");
    expect(broad.length).toBeGreaterThanOrEqual(5);
    for (const l of broad) expect(l.relays, l.filter).toMatch(/^(sampleRelays\(|sample$)/);
    expect(src).toMatch(/const sample = sampleRelays\(/);
  });

  it("market's `relays` really is the listing relays (no damus to leave out)", () => {
    expect(src).toMatch(/const relays = \[\.\.\.LISTING_RELAYS\];/);
  });
});
