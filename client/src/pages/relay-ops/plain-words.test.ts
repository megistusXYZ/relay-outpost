import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Plain words on the plain screens (owner, 2026-10-04): a community manager
 * never meets protocol words — kinds, keys, NIP numbers, "relay" — on
 * Overview, Posts, People, Inbox or Community. They belong in Advanced, or
 * behind "Show technical details" (lines that read `technical`).
 *
 * This reads the words people see in the source — JSX text and quoted
 * sentences — so a new one fails CI. The browser rig ops-plain-words-e2e
 * checks the rendered screens.
 */
const PLAIN_SCREENS = [
  "ContentTab.tsx", "ContentFilterPanel.tsx", "PeopleTab.tsx", "InboxTab.tsx", "FeedbackTab.tsx",
  "AccessControlTab.tsx", "KindGateCard.tsx", "MemberInboxSettings.tsx", "TeamScreens.tsx",
  "FeaturedTab.tsx", "CommunityTab.tsx", "ConfirmAction.tsx", "ops-ui.tsx", "count-line.ts",
];
const WORDS: Array<[string, RegExp]> = [
  ["NIP number", /\bNIP-?\d+\b/],
  ["npub/nevent/naddr", /\b(npub|nprofile|nevent|naddr)\b/i],
  ["pubkey", /\bpub ?keys?\b/i],
  ["hex", /\bhex\b/i],
  ["kind number", /\bkind ?:? ?\d+/i],
  ["relay", /\brelays?\b(?![.\-]\w)/i],
];
// A sentence: quoted text with a space in it, or JSX text between tags.
const QUOTED = /(["'`])((?:(?!\1)[^\\]|\\.)*\s(?:(?!\1)[^\\]|\\.)*)\1/g;
const JSX_TEXT = />([^<>{}]*[A-Za-z][^<>{}]*)</g;
const CODE_ONLY = /^(import |\/\/|\*|\/\*)|console\.|data-testid|className=|localStorage|throw new Error\(`\[|addModLogEntry/;

function offenders(file: string): string[] {
  const out: string[] = [];
  const lines = readFileSync(resolve(__dirname, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (CODE_ONLY.test(t) || /\btechnical\b/.test(line)) return;
    const said = [...line.matchAll(QUOTED)].map((m) => m[2]).concat([...line.matchAll(JSX_TEXT)].map((m) => m[1]));
    for (const raw of said) {
      // Code inside a template (${…}) isn't words anyone reads.
      const s = raw.replace(/\$\{[^}]*\}/g, "");
      if (/\)\(|=>|\[\w+\]|\?\?/.test(s)) continue; // code between two quote marks, not a sentence
      if (/^[\w.\-/:#?=&%\s…]*$/.test(s.trim()) && !/\s\w+\s\w+/.test(s)) continue; // an id, a path, a class list
      for (const [name, re] of WORDS) if (re.test(s)) out.push(`${file}:${i + 1} ${name}: ${s.trim().slice(0, 80)}`);
    }
  });
  return out;
}

describe("the plain screens speak plainly", () => {
  it("no protocol words or 'relay' in what people read (Advanced and technical details excepted)", () => {
    expect(PLAIN_SCREENS.flatMap(offenders)).toEqual([]);
  });
});
