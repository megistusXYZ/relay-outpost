/**
 * nostr.band is gone (2026-10-05: its relay times out, its spam list and
 * website don't answer). The app asked it for search, profiles, relay lists
 * and a shared spam list — every one of those asks waited out its timeout.
 * Nothing in the app may reach it now; search goes to search relays that
 * answered a live NIP-50 query the same day.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SEARCH_RELAYS } from "@/lib/relay-constants";

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

describe("nostr.band", () => {
  it("nothing in the app or the server reaches it", () => {
    const root = path.resolve(__dirname, "../..");
    const hits = [...sources(path.join(root, "client/src")), ...sources(path.join(root, "server"))]
      .filter((f) => /wss:\/\/relay\.nostr\.band|spam\.nostr\.band|api\.nostr\.band/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });

  it("search goes to search relays that answer", () => {
    expect(SEARCH_RELAYS).toEqual(["wss://search.nos.today", "wss://relay.ditto.pub"]);
  });
});
