/**
 * The two reasons your own reactions stopped showing, and the extra reactions
 * stopped being reachable. Both were reported as one complaint.
 *
 * Source-reading, for the same reason hover-reach.test.ts is: jsdom cannot
 * evaluate `(hover: none)` and reports no match for any media query it does not
 * implement, so a render test would pass identically before and after. The
 * behaviour was verified on the wire and in a browser; this stops it regressing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...p: string[]) => readFileSync(join(process.cwd(), "client", "src", ...p), "utf8");
/** Strip comments — this file's own prose names what it forbids. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

describe("your own reactions survive a reload", () => {
  const store = code(read("lib", "interaction-index-store.ts"));

  it("asks the network which posts the viewer already reacted to", () => {
    // The index is a read-model over the LOCAL event store, and nothing was
    // putting the viewer's past reactions into it. A heart lit up only while
    // the kind-7 happened to be cached — true right after tapping, false once
    // the post was fetched fresh. The reaction was never lost, never asked for.
    expect(store).toMatch(/authors:\s*\[viewer\]/);
    expect(store).toMatch(/"#e":\s*chunk/);
  });

  it("asks about reposts in the same round trip", () => {
    // Reposts were silently the same bug and share the filter.
    expect(store).toMatch(/kinds:\s*\[KIND_REACTION,\s*KIND_REPOST\]/);
  });

  it("forgets its answers when the viewer changes", () => {
    // "Have I reacted to this?" is a different question for a different person.
    // Without clearing, switching accounts inherits the last viewer's hearts
    // AND never re-asks, because the ids are already marked as asked.
    expect(store).toMatch(/this\.asked\.clear\(\)/);
    expect(store).toMatch(/this\.wanted\.clear\(\)/);
  });

  it("batches rather than one subscription per post", () => {
    // A feed mounts dozens of posts in a tick; one filter carrying their ids is
    // the difference between 1 REQ and 40 against every relay.
    expect(store).toMatch(/backfillTimer/);
  });
});

describe("the extra reactions are reachable on touch", () => {
  const post = code(read("components", "NostrPost.tsx"));

  it("decides by pointer capability, not viewport width", () => {
    // `innerWidth < 640` gave the desktop hover-dwell path to every tablet and
    // every phone in landscape (the app's own useIsMobile breaks at 768), where
    // a 400ms hover cannot happen — so only the plain heart tap ever worked.
    expect(post).toMatch(/matchMedia\("\(hover: none\), \(pointer: coarse\)"\)/);
    expect(
      /isMobileDevice\s*=\s*typeof window/.test(post),
      "the module-load width guess is back",
    ).toBe(false);
  });

  it("asks at call time, so rotating a tablet changes the answer", () => {
    // It was a `const` evaluated once at import. Whatever it decided at load
    // stayed true for the session.
    expect(post).toMatch(/export function prefersTapForReactions\(\)/);
    expect(post).toMatch(/if \(prefersTapForReactions\(\)\) return;/);
  });

  it("still offers more than one reaction to reach", () => {
    // Guards the lazy reading of "we only do hearts" — the answer was never to
    // add emoji, it was that five already existed behind an unreachable path.
    const count = (post.match(/\{ content: /g) || []).length;
    expect(count).toBeGreaterThanOrEqual(5);
  });
});
