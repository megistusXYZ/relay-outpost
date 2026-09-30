/**
 * A relay the pool skips (cooling down after a failure, or blocked) is never
 * asked, so it can never answer. Measured 2026-09-30: after relay.damus.io
 * refused a connection it was benched, the Discover lookups still counted it
 * among four relays, and with relay.primal.net silent the two relays that did
 * answer "nothing" never made a majority: 8 s waits (`finish 8000 n=0 ans=2
 * dec=0 of 4`). The pool now reports skipped relays as declined at once, so
 * collectOnce (lib/collect-once.ts) counts only relays that were asked.
 * Pinned on the source: the pool is wired to live sockets; the behaviour is
 * measured in the browser (Videos lookup 9.3 s -> ~1 s with damus benched).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.resolve(import.meta.dirname, "nostr.ts"), "utf8");
const fn = src.slice(src.indexOf("export function throttledPoolSubscribe("));
const body = fn.slice(0, fn.indexOf("\n}\n"));

describe("throttledPoolSubscribe and the relays it skips", () => {
  it("reports every relay it won't ask as declined", () => {
    expect(body).toMatch(/for \(const relay of relays\) \{[\s\S]*?if \(!healthyRelays\.includes\(relay\)\) opts\.onrelaydeclined\?\.\(relay\)/);
  });
});
