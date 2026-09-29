/**
 * Every card that suggests a person to follow must open that person's
 * profile (owner report, 2026-09-28): the Search suggestions showed a face,
 * a name and a Follow button, and no way to look at who you'd be following
 * before doing it. Follow stays its own button; the rest of the card is the
 * door to the profile.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Components that put a person in front of you with a Follow button.
const SUGGESTION_CARDS = [
  "components/SuggestedFollowsStrip.tsx",
  "components/PeopleToFollowStrip.tsx",
  "components/InviteAcceptCard.tsx",
];

describe("follow suggestions open the person's profile", () => {
  it("each suggestion card routes to /profile/<npub>", () => {
    const missing = SUGGESTION_CARDS.filter((f) => {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      return !/\/profile\/\$\{/.test(src);
    });
    expect(missing).toEqual([]);
  });

  it("no other component adds a Follow suggestion list without joining this guard", () => {
    // A new people list with Follow buttons uses useFollowAction; if it isn't
    // one of the cards above (or a single-person surface that already sits on
    // the profile), add it to SUGGESTION_CARDS and give it the profile link.
    const KNOWN = new Set([...SUGGESTION_CARDS, "components/nostr-post/ThreadEndBlock.tsx", "pages/Profile.tsx"]);
    const src = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const users = execSync("grep -rl useFollowAction components pages", { cwd: resolve(__dirname, ".."), encoding: "utf8" })
      .split("\n").filter((f) => f && !f.includes(".test.") && /useFollowAction\(/.test(src(f)));
    expect(users.filter((f) => !KNOWN.has(f))).toEqual([]);
  });
});
