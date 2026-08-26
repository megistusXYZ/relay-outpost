/**
 * A control you can only see by hovering is a control a phone cannot use.
 *
 * `opacity-0 group-hover:opacity-100` is this repo's idiom for a row's trailing
 * buttons. On a touch screen `.group:hover` either never fires or LATCHES on the
 * last-tapped element, so the control is invisible for as long as someone needs
 * it — while staying hit-testable, which is worse than absent: it turns a
 * destructive act into a blind tap in an unmarked gutter.
 *
 * The replacement is `.reveal-on-hover` in index.css, which asks whether the
 * DEVICE HAS A HOVER rather than how wide it is. Width is the wrong question and
 * both broken spellings ask it: bare `opacity-0` hides at every width, and
 * `sm:opacity-0` un-hides below 640px while this app's own useIsMobile breaks at
 * 768 — so 640-767px, every tablet and every phone in landscape, keeps the
 * desktop behaviour on a touch screen.
 *
 * WHY THIS TEST IS SOURCE-READING AND NOT BEHAVIOURAL. jsdom cannot evaluate
 * `@media (hover: hover) and (pointer: fine)`; it reports no match for every
 * media query it does not implement. A test that rendered a component and
 * asserted `getComputedStyle(el).opacity` would pass identically before and
 * after the fix, which is a harness that cannot fail. The real behaviour was
 * verified in a browser with an emulated coarse pointer; this file exists to
 * stop the count growing back.
 *
 * Prove it can fail before trusting it: put `opacity-0 group-hover:opacity-100`
 * on any element in a file below and watch the count assertion go red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "client", "src");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const rel = (f: string) => f.slice(f.indexOf("client/src"));

/**
 * Blank out comments, preserving newlines so line numbers stay true.
 *
 * Not fussiness: the first run of this test flagged ChatListRow.tsx for a
 * `{/* … `opacity-0 group-hover:opacity-100` … *␟/}` comment explaining why that
 * very idiom had just been REMOVED there. A linter that cannot tell code from
 * prose about code reports the fix as the defect, and the natural way to quiet
 * it is to stop writing the explanation down.
 *
 * `(?<!:)//` so the `//` in an https:// URL is not treated as a line comment.
 */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(?<!:)\/\/[^\n]*/g, blank);
}

/** Bare or responsive-prefixed — both spellings are the bug. */
const OPACITY_ZERO = /(?:^|[\s"'`])(?:sm:|md:|lg:|xl:)?opacity-0(?:[\s"'`]|$)/;
const GROUP_HOVER_REVEAL = /group-hover:opacity-100/;

function hoverRevealSites(): { file: string; line: number; text: string }[] {
  const sites: { file: string; line: number; text: string }[] = [];
  for (const file of tsxFiles(SRC)) {
    stripComments(readFileSync(file, "utf8")).split("\n").forEach((text, i) => {
      if (GROUP_HOVER_REVEAL.test(text) && OPACITY_ZERO.test(text)) {
        sites.push({ file: rel(file), line: i + 1, text: text.trim() });
      }
    });
  }
  return sites;
}

/**
 * The sites that may keep the idiom, and WHY each one may.
 *
 * This started as a bare count — 33 files' worth of unclassified debt, with the
 * honest admission that triaging them was not that test's job. They have now
 * been triaged: 19 migrated to `.reveal-on-hover`, and every one that remains is
 * listed here with the reason it is not a defect. A number cannot be argued
 * with; a reason can, which is the point.
 *
 * Two shapes earn a place here and no others:
 *   DECORATION — the revealed thing is not a control. A glow, a gradient rule,
 *     an affordance hint on a parent that is itself the button. Nothing is lost
 *     when it never appears, and forcing it on would put a scrim over the very
 *     content it decorates.
 *   MITIGATED — the action has a real second path on touch. Not "the element is
 *     still hit-testable" (that is a blind tap, which is what made ChatListRow a
 *     defect) but an actual affordance a person can find.
 *
 * Adding an entry requires a sentence someone else can check. Removing one is
 * always welcome. A new FILE fails outright.
 */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "client/src/components/concord/RoomImagePicker.tsx": {
    count: 1,
    why: "DECORATION. The whole picker IS a <button>; the scrim is a hover hint. Tapping the avatar opens the file picker on touch either way, and making the scrim permanent would black out the image it edits.",
  },
  "client/src/pages/LiveStreams.tsx": {
    count: 1,
    why: "DECORATION. A relative timestamp on a live-chat line — information, not a control. Always-on would stamp every line of a fast-moving chat on the narrowest screens.",
  },
  "client/src/pages/Messages.tsx": {
    count: 2,
    why: "MITIGATED. Both carry `hidden md:block`, so they are desktop-only by construction, and touch gets the long-press sheet (onTouchStart :2719 → sheet :2804) offering the same delete/hide. This is precisely the mitigation ChatListRow lacked, which is why that one was a defect and these are not.",
  },
  "client/src/pages/Search.tsx": {
    count: 1,
    why: "DECORATION. A '+' hint at the end of a feed row; the row itself is the control.",
  },
  "client/src/pages/Settings.tsx": {
    count: 2,
    why: "DECORATION. Two blurred glow layers behind the Megistus logo. There is nothing to reach.",
  },
  "client/src/pages/WtfIsThis.tsx": {
    count: 2,
    why: "DECORATION. Gradient hairlines under a card.",
  },
  "client/src/pages/relay-ops/shared.tsx": {
    count: 2,
    why: "DECORATION. An ExternalLink glyph inside an <a> that is itself the link.",
  },
};

describe("hover-only controls", () => {
  it("never appears in a file that had none", () => {
    const byFile = new Map<string, number>();
    for (const s of hoverRevealSites()) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);
    const fresh = [...byFile.keys()].filter((f) => !(f in ALLOWED));
    expect(fresh, `New hover-only control(s). Use .reveal-on-hover (index.css) and DELETE the opacity-0 / group-hover:opacity-100 classes — width is the wrong question:\n${fresh.join("\n")}`).toEqual([]);
  });

  it("never grows in a file that already had some, and is ratcheted down when it shrinks", () => {
    const byFile = new Map<string, number>();
    for (const s of hoverRevealSites()) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);
    const grew: string[] = [];
    const shrank: string[] = [];
    for (const [file, { count: allowed }] of Object.entries(ALLOWED)) {
      const actual = byFile.get(file) ?? 0;
      if (actual > allowed) grew.push(`${file}: ${actual} > ${allowed}`);
      // A baseline above the real count is a check that cannot fail — the exact
      // mistake CLAUDE.md records about the tsc gate sitting at 123 while the
      // count was 90, leaving room for 33 new errors to land unnoticed.
      if (actual < allowed) shrank.push(`${file}: ${actual} < ${allowed} — lower the count, or drop the entry`);
    }
    expect(grew, `Hover-only controls increased:\n${grew.join("\n")}`).toEqual([]);
    expect(shrank, `Fixed sites — ratchet the baseline down:\n${shrank.join("\n")}`).toEqual([]);
  });

  it("keeps every exemption justified — a count is not an argument", () => {
    // The whole upgrade from the old bare-count baseline. An entry with an empty
    // or hand-wavy reason is how a triaged list decays back into tolerated debt,
    // so the shape of the reason is enforced, not just its presence.
    for (const [file, { why, count }] of Object.entries(ALLOWED)) {
      expect(count, `${file}: a zero-count entry should just be deleted`).toBeGreaterThan(0);
      expect(why.length, `${file}: needs a real reason, not a placeholder`).toBeGreaterThan(40);
      expect(
        /^(DECORATION|MITIGATED)\./.test(why),
        `${file}: a reason must start DECORATION. or MITIGATED. — those are the only two ways a hover-only control is acceptable`,
      ).toBe(true);
    }
  });

  it("never leaves opacity-0 on an element that also carries reveal-on-hover", () => {
    // The migration's silent failure, and it fails OPEN. On desktop
    // `.reveal-on-hover` wins and it looks right; on touch the media query does
    // not apply, so `.reveal-on-hover` contributes only a transition and
    // Tailwind's `.opacity-0` is the last rule standing. The control stays
    // invisible on exactly the devices the fix was for, and the diff looks done.
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      stripComments(readFileSync(file, "utf8")).split("\n").forEach((text, i) => {
        if (text.includes("reveal-on-hover") && OPACITY_ZERO.test(text)) {
          offenders.push(`${rel(file)}:${i + 1}`);
        }
      });
    }
    expect(offenders, `reveal-on-hover cannot un-hide these — the opacity-0 must be DELETED, not accompanied:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the .reveal-on-hover / .touch-target utilities themselves", () => {
  const css = readFileSync(join(SRC, "index.css"), "utf8");

  /** The text of the `{...}` block a declaration sits in, walking braces back. */
  function enclosingAtRule(needle: string): string {
    const at = css.indexOf(needle);
    expect(at, `${needle} missing from index.css`).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = at; i >= 0; i--) {
      if (css[i] === "}") depth++;
      else if (css[i] === "{") {
        if (depth === 0) return css.slice(css.lastIndexOf("\n", i), i);
        depth--;
      }
    }
    return "";
  }

  it("hides on a real pointer only — never on width, never unconditionally", () => {
    // If someone "simplifies" this to a bare `.reveal-on-hover { opacity: 0 }`,
    // every migrated control goes dark on every phone at once.
    const rule = enclosingAtRule(".reveal-on-hover.reveal-on-hover {\n      opacity: 0;");
    expect(rule).toContain("hover: hover");
    expect(rule).toContain("pointer: fine");
  });

  it("grows the tap target only where there is no real pointer", () => {
    // The other half: visible-but-not-hittable. Gated on capability so the dense
    // ops tables keep their layout under a mouse.
    const rule = enclosingAtRule(".touch-target {\n      min-width: 44px;");
    expect(rule).toMatch(/hover: none|pointer: coarse/);
  });

  it("brings the control back for a keyboard, which hover alone never does", () => {
    // An opacity-0 button keeps its place in the tab order, so without this a
    // keyboard user tabs to something they cannot see.
    expect(css).toContain(".reveal-on-hover:focus-within");
  });
});

/**
 * Opacity is not the only way to hide something until hover.
 *
 * The sweep above chases `opacity-0 group-hover:opacity-100`, which is this
 * repo's dominant idiom — and a scan built around that one spelling is blind to
 * every other. `text-transparent group-hover:text-muted-foreground` hides an
 * element just as completely, reads nothing like the pattern above, and was sat
 * in ConcordChat the whole time the opacity sweep ran clean.
 *
 * So the equivalents are enumerated. All are currently zero except the one, and
 * the value of listing an empty pattern is precisely that it stays empty: the
 * next person reaching for `invisible group-hover:visible` because the opacity
 * form is guarded finds this instead.
 */
const OTHER_HIDING_SPELLINGS: Array<{ name: string; hidden: RegExp; shown: RegExp }> = [
  { name: "text-transparent → group-hover:text-*", hidden: /(?<![\w-])text-transparent(?![\w-])/, shown: /group-hover:text-/ },
  { name: "invisible → group-hover:visible", hidden: /(?<![\w-])invisible(?![\w-])/, shown: /group-hover:visible/ },
  { name: "hidden → group-hover:block|flex|inline|grid", hidden: /(?<![\w-])hidden(?![\w-])/, shown: /group-hover:(?:block|flex|inline|grid)/ },
  { name: "scale-0 → group-hover:scale-*", hidden: /(?<![\w-])scale-0(?![\w-])/, shown: /group-hover:scale-/ },
  { name: "w-0 → group-hover:w-*", hidden: /(?<![\w-])w-0(?![\w-])/, shown: /group-hover:w-/ },
  { name: "max-h-0 → group-hover:max-h-*", hidden: /(?<![\w-])max-h-0(?![\w-])/, shown: /group-hover:max-h-/ },
];

/**
 * Same two-reason vocabulary as the opacity allowlist above, keyed by file.
 *
 * The single entry is a per-message timestamp in the Slack/Discord grouped-turn
 * layout: for a CONTINUATION message the avatar gutter becomes a hover-reveal
 * clock. It is exempt on evidence, not on the "it's only a timestamp" shrug —
 * the first message of every group renders a real always-visible `<time>`
 * (ConcordChat.tsx:1393), and day dividers sit above the whole list, so a phone
 * still gets the time at group granularity. Nothing is unreachable; only the
 * per-message repeat of an already-shown value is.
 */
const OTHER_SPELLING_ALLOWED: Record<string, { count: number; why: string }> = {
  "client/src/components/concord/ConcordChat.tsx": {
    count: 1,
    why: "DECORATION. Per-message clock in a grouped turn — not a control, and the group's first message already shows an always-visible <time> plus a day divider above the list.",
  },
};

describe("hover-only controls, hidden by something other than opacity", () => {
  function offendersByFile() {
    const byFile = new Map<string, number>();
    for (const file of tsxFiles(SRC)) {
      stripComments(readFileSync(file, "utf8")).split("\n").forEach((text) => {
        for (const s of OTHER_HIDING_SPELLINGS) {
          if (s.hidden.test(text) && s.shown.test(text)) {
            byFile.set(rel(file), (byFile.get(rel(file)) ?? 0) + 1);
          }
        }
      });
    }
    return byFile;
  }

  it("never appears in a file that has none", () => {
    const fresh = [...offendersByFile().keys()].filter((f) => !(f in OTHER_SPELLING_ALLOWED));
    expect(
      fresh,
      `Something is hidden until hover by a route the opacity rule does not cover.\nIf it is a CONTROL, use .reveal-on-hover so touch and keyboard reach it:\n${fresh.join("\n")}`,
    ).toEqual([]);
  });

  it("holds the exemptions to their exact count, with a reason", () => {
    const byFile = offendersByFile();
    const drift: string[] = [];
    for (const [file, { count, why }] of Object.entries(OTHER_SPELLING_ALLOWED)) {
      const actual = byFile.get(file) ?? 0;
      if (actual !== count) drift.push(`${file}: ${actual}, expected ${count}`);
      expect(/^(DECORATION|MITIGATED)\./.test(why), `${file}: reason must start DECORATION. or MITIGATED.`).toBe(true);
      expect(why.length, `${file}: needs a real reason`).toBeGreaterThan(40);
    }
    expect(drift, `Exemption counts moved — re-read the site:\n${drift.join("\n")}`).toEqual([]);
  });

  it("still enumerates every spelling, including the ones currently at zero", () => {
    // An empty pattern is the point: it is the one someone reaches for next
    // BECAUSE the opacity form is guarded. Deleting it to tidy up would reopen
    // the gap this whole block exists to close.
    const names = OTHER_HIDING_SPELLINGS.map((s) => s.name);
    expect(names).toContain("text-transparent → group-hover:text-*");
    expect(names).toContain("invisible → group-hover:visible");
    expect(OTHER_HIDING_SPELLINGS.length).toBeGreaterThanOrEqual(6);
  });
});
