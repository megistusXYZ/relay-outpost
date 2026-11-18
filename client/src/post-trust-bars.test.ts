/**
 * The trust bars on posts and threads (2026-11-17) speak the app's one trust
 * language: colours from TIER_GLYPH (so the bar, its legend and the dot beside
 * each author agree, and red is for concerns only), the tier words, text at
 * 12px or more, and no raw averages in monospace on screen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname);
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

/** Problems in one bar's source. */
export function barProblems(src: string): string[] {
  const out: string[] = [];
  if (!/TIER_GLYPH/.test(src)) out.push("not on TIER_GLYPH");
  const small = [...src.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1])).filter((n) => n < 12);
  if (small.length) out.push(`text under 12px: ${small.join(",")}`);
  if (/font-mono/.test(src)) out.push("monospace numbers");
  if (/bg-red-400|bg-emerald-500|bg-blue-500|bg-cyan-500/.test(src)) out.push("hand-picked tier colours");
  return out;
}

const threadBar = () => {
  const src = read("components/nostr-post/author-hover.tsx");
  const s = src.indexOf("export function ThreadTrustBar");
  return src.slice(0, src.indexOf("\n", src.indexOf("import { TIER_GLYPH"))) + src.slice(s, src.indexOf("export function VouchedBySection", s));
};

describe("post and thread trust bars", () => {
  it("the check can fail: it catches the old shapes", () => {
    expect(barProblems(`<span className="text-[9px] font-mono">{avg}</span> bg-red-400`)).toEqual([
      "not on TIER_GLYPH", "text under 12px: 9", "monospace numbers", "hand-picked tier colours",
    ]);
  });

  it("the engagers' bar is one shared component on the shared colours", () => {
    expect(barProblems(read("components/nostr-post/EngagerTrustBar.tsx"))).toEqual([]);
    const post = read("components/NostrPost.tsx");
    expect(post.match(/<EngagerTrustBar /g)?.length).toBe(2);
    expect(post).not.toMatch(/grStrong|grSegments/);
  });

  it("the thread bar is on the shared colours too", () => {
    expect(barProblems(threadBar())).toEqual([]);
  });

  it("Trust & safety speaks the same language: shared tier colours, no old violet, ink switches", () => {
    const src = read("pages/ShieldMatrix.tsx");
    const live = src.slice(0, src.indexOf("{false && ("));
    expect(live).toMatch(/dotColor: TIER_GLYPH\.strong\.className/);
    expect(live).not.toMatch(/rgba\(140, ?100, ?220/);
    expect(live).not.toMatch(/\? "bg-brand" : "bg-input"/);
    expect([...live.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1])).filter((n) => n < 12)).toEqual([]);
  });

  it("Search's people tiers and cards, and the activity label, are readable and on the shared glyph", () => {
    const src = read("pages/Search.tsx");
    const part = (from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
    const tiers = part("function TierSection", "\nfunction ");
    const card = part("function ProfileCard", "\nfunction ");
    expect(tiers).toMatch(/<TrustTierGlyph /);
    expect(tiers).not.toMatch(/bg-emerald-500|bg-red-500|"▲"/);
    for (const s of [tiers, card]) expect([...s.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1])).filter((n) => n < 12)).toEqual([]);
    expect(card).not.toMatch(/via-brand\/40|#0d0d2b/);
    const activity = read("components/ActivityIndicator.tsx");
    expect([...activity.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1])).filter((n) => n < 12)).toEqual([]);
    expect(activity).not.toMatch(/\} notes`/);
  });

  it("the community discussion bar is on the shared colours too", () => {
    const src = read("pages/Outposts.tsx");
    const s = src.indexOf("function TopicTrustBar");
    const bar = src.slice(s, src.indexOf("\ninterface CommentNode", s));
    expect(/TIER_GLYPH/.test(src.slice(0, 4000))).toBe(true);
    expect(barProblems(`TIER_GLYPH ${bar}`)).toEqual([]);
  });
});
