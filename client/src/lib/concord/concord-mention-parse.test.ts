import { describe, it, expect } from "vitest";
import { getParsedContent } from "applesauce-content/text";
import { rumorRenderEvent } from "./concord-message-render";

/**
 * Regression (reported: raw `nostr:npub1…` tokens showing in Concord group
 * chat instead of resolving to @mentions). The load-bearing seam is the parse:
 * ConcordMessageBody feeds `rumorRenderEvent(msg)` through applesauce's
 * `getParsedContent`, and the chat component map turns each `mention` node into
 * a resolved @mention. If the parser ever stops recognizing these tokens (a
 * config/version drift), they'd fall through as raw text — this catches that
 * before it ships. Real npubs pulled from the reported group chat.
 */
const NPUBS = [
  "npub1936880gwwgyy3nt3lt8smy8lw2ndwhtytm2caam094nz7mmwss8q3c5xah",
  "npub18ams6ewn5aj2n3wt2qawzglx9mr4nzksxhvrdc4gzrecw7n5tvjqctp424",
  "npub16ye7evyevwnl0fc9hujsxf9zym72e063awn0pvde0huvpyec5nyq4dg4wn",
];

function mentionNodes(content: string) {
  const ev = rumorRenderEvent({ id: "m1", pubkey: "0".repeat(64), content });
  const nast = getParsedContent(ev, undefined, undefined, Symbol("concord-mention-test")) as {
    children?: { type: string; decoded?: { type: string; data: unknown } }[];
  };
  return (nast.children ?? []).filter((n) => n.type === "mention");
}

describe("Concord message parse: nostr:npub mentions resolve to mention nodes", () => {
  for (const npub of NPUBS) {
    it(`parses ${npub.slice(0, 14)}… into a mention node (not raw text)`, () => {
      const mentions = mentionNodes(`hey nostr:${npub} what's up`);
      expect(mentions).toHaveLength(1);
      expect(mentions[0].decoded?.type).toBe("npub");
    });
  }

  it("resolves a mention with no trailing space (message-boundary token)", () => {
    expect(mentionNodes(`gm nostr:${NPUBS[0]}`)).toHaveLength(1);
  });

  it("resolves a mention followed immediately by punctuation", () => {
    expect(mentionNodes(`glad you made it in, nostr:${NPUBS[1]}!`)).toHaveLength(1);
  });

  it("leaves ordinary prose with no mention nodes", () => {
    expect(mentionNodes("just chilling, no mentions here")).toHaveLength(0);
  });
});
