/**
 * The profile's pinned rail on desktop (owner, 2026-10-01). The rules of what
 * it shows are in lib/profile-companion.test.ts; this pins the wiring that a
 * browser check found load-bearing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, f), "utf8");
const layout = read("IdentityProfileLayout.tsx");
const main = read("IdentityProfileMain.tsx");
const companion = read("ProfileCompanion.tsx");
const profile = read("../../pages/Profile.tsx");

describe("profile pinned rail", () => {
  it("is a desktop-only sticky block at the end of the rail, holding the companion's slot", () => {
    expect(layout).toMatch(/className="hidden lg:flex flex-col gap-4 sticky top-4 max-h-\[calc\(100dvh-6rem\)\]" data-testid="identity-rail-pinned"/);
    expect(layout).toMatch(/<div id=\{COMPANION_SLOT_ID\}/);
  });

  it("the compact identity appears only once the identity card has left, with the two primaries", () => {
    expect(layout).toMatch(/\{pinned && \(/);
    expect(layout).toMatch(/\{miniActions\}/);
    expect(profile).toMatch(/renderOtherUserHeaderActions\("-mini", \{ hideOverflow: true \}\)/);
  });

  it("the compact identity gives the name its own row at every width; the two buttons share the row beneath", () => {
    // Beside the name they squeezed it to "Vitor Pa…" (380px rail) and "[B…"
    // (320px rail) and clipped the follower count (owner screenshots).
    expect(layout).toMatch(/className="flex flex-wrap items-center gap-x-2\.5 gap-y-2 rounded-xl[^"]*"\s+data-testid="identity-rail-mini"/);
    expect(layout).not.toContain("xl:flex-nowrap");
    expect(profile).toMatch(/className="flex w-full shrink-0 gap-2 [^"]*\[&>button\]:flex-1 \[&>button\]:min-w-0" data-testid="identity-mini-actions"/);
    expect(profile).not.toMatch(/xl:w-auto[^"]*" data-testid="identity-mini-actions"/);
  });

  it("desktop gets a wider rail and a reading-width stream; phones and tablets keep one column", () => {
    expect(layout).toContain("grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,680px)]");
  });

  it("the profile wrapper is not a false scroll container on desktop", () => {
    // With overflow-y-auto at every width, `position: sticky` and scrollRootFor
    // resolved against a box that does not scroll: the block scrolled away and
    // the spine never moved (found in the browser, 2026-10-01).
    expect(profile).toMatch(/className="flex flex-col h-full overflow-y-auto lg:overflow-visible" data-testid="page-profile">\s*<IdentityProfileLayout/);
  });

  it("the spine and the stream's headings are the same words from the same function", () => {
    expect(main).toMatch(/import \{ timeChapter, streamChapters, type CompanionMedia \} from "@\/lib\/profile-companion"/);
    expect(main).not.toMatch(/function timeChapter\(/);
    expect(main).toMatch(/data-chapter-heading=\{chapter\}/);
    expect(main).toMatch(/data-stream-id=\{event\.id\}/);
  });

  it("the spine shows labels only: no counts, no bars", () => {
    const spine = companion.slice(companion.indexOf('data-testid="companion-spine"'), companion.indexOf('data-testid="companion-older"'));
    // Nothing per chapter but its label: no number, no sized bar.
    expect(spine).not.toMatch(/\.length\}|count/i);
    expect(spine).not.toMatch(/style=\{\{ (width|height)/);
  });

  it("never runs past the bottom of the screen: the spine scrolls inside itself, the pictures keep their place", () => {
    // Owner report, 2026-10-01: the pictures card was cut off at the bottom —
    // a pinned block taller than the screen has no way to be scrolled to.
    expect(layout).toMatch(/id=\{COMPANION_SLOT_ID\} className="flex flex-col gap-4 min-h-0"/);
    expect(companion).toMatch(/ref=\{spineRef\} className="relative pl-6 min-h-0 overflow-y-auto no-scrollbar/); // no visible scrollbar (owner call)
    expect(companion).toMatch(/className="shrink-0 rounded-xl[^"]*" data-testid="companion-media"/);
    expect(companion).toMatch(/mediaForChapter\(media, current, 3\)/);
    expect(companion).not.toMatch(/scrollIntoView\(\{ block: "nearest"/);
  });

  it("does no scroll work where the rail is not shown", () => {
    expect(companion).toMatch(/if \(slot\.offsetParent === null\) return;/);
  });
});
