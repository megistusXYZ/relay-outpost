/**
 * Where your app data goes (settings, news bookmarks, read marks: kind
 * 30078). Found by the pre-deploy sweep 2026-10-24: the three syncs wrote to
 * the first six of [your default relays, then your communities]. With six
 * defaults no community made the cut; dropping one default (#493) put your
 * first community on the list, so your private settings went to a community
 * relay, and that publish signed you in there under "Ask first".
 * App data is written to your own relays only, never a community. Reading
 * still looks at communities after them, so an older copy there is found.
 */
import { describe, it, expect } from "vitest";
import { appDataRelays } from "./app-data-relays";

const defaults = ["wss://d1", "wss://d2", "wss://d3", "wss://d4", "wss://d5"];
const communities = ["wss://community-a", "wss://community-b"];
const FALLBACK = ["wss://fallback"];
const keep = (xs: string[]) => xs;

describe("appDataRelays", () => {
  it("writes go to your relays only, never a community, whatever the count", () => {
    const w = appDataRelays("write", { active: defaults, communities, filter: keep, fallback: FALLBACK });
    expect(w).toEqual(defaults);
    expect(w.some((u) => u.includes("community"))).toBe(false);
  });

  it("reads look at your relays first, then your communities", () => {
    const r = appDataRelays("read", { active: defaults, communities, filter: keep, fallback: FALLBACK });
    expect(r).toEqual([...defaults, ...communities]);
  });

  it("at most six relays are written to", () => {
    const many = Array.from({ length: 9 }, (_, i) => `wss://r${i}`);
    expect(appDataRelays("write", { active: many, communities, filter: keep, fallback: FALLBACK })).toHaveLength(6);
  });

  it("no relays of your own: the fallback, still never a community", () => {
    expect(appDataRelays("write", { active: [], communities, filter: keep, fallback: FALLBACK })).toEqual(FALLBACK);
  });

  it("blocked relays are left out", () => {
    const filter = (xs: string[]) => xs.filter((u) => u !== "wss://d2");
    expect(appDataRelays("write", { active: defaults, communities, filter, fallback: FALLBACK })).not.toContain("wss://d2");
  });
});
