/**
 * Help & Guides speaks to people, not developers (owner, 2026-10-10): a
 * newcomer reads about their key, their space, their communities and their
 * money in the words the app itself uses, never in protocol words, old
 * names, or the find-and-replace scars the rename left behind ("Community
 * community", "You tab", "Crew & Orbit").
 *
 * Source-reading, the way pages/relay-ops/plain-words.test.ts reads the
 * operator screens: the sentences people see — JSX text and quoted prose.
 * Prove it can fail: put "NIP-17" in any FAQ answer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "client", "src");
/** The Help page, its guest overlay, and every guide it links to. */
export const HELP_FILES = [
  "pages/WtfIsThis.tsx",
  "components/WtfWelcomeOverlay.tsx",
  "pages/FirstTenMinutes.tsx",
  "pages/SettingUpOutpost.tsx",
  "pages/ConnectingWallet.tsx",
  "pages/UsingContentCalendar.tsx",
  "pages/EncryptedMessages.tsx",
  "pages/PublishingPrivacy.tsx",
  "pages/ManagingCrew.tsx",
  "pages/WhyDecentralization.tsx",
  "pages/WotVsAlgorithms.tsx",
  "pages/RelayCommunities.tsx",
  "pages/DataSovereignty.tsx",
  "pages/WhereNostrIsHeading.tsx",
  "pages/NostrVsAlternatives.tsx",
];

const WORDS: Array<[string, RegExp]> = [
  ["NIP number", /\bNIP-?\d+\b/],
  ["npub/nsec/nevent/naddr", /\b(npub|nsec|nprofile|nevent|naddr)\b(?!\.cash)/i],
  ["pubkey", /\bpub ?keys?\b/i],
  ["kind number", /\bkind[- ]\d+/i],
  ["bunker", /\bbunker\b/i],
  ["outbox", /\boutbox\b/i],
  ["old name: Outpost", /(?<!Relay )\bOutposts?\b/],
  ["rename scar", /\bCommunity (community|communities|also)\b/],
  ["the You tab (it is Account)", /\bYou tab\b/],
  ["Crew / Orbit", /\b(Crew|Orbit)\b/],
  ["old key words", /\b(passphrase|recovery code|backup file|encrypted backup)\b/i],
  ["mission control", /\b(mission|orientation|field manual)\b/i],
  ["reach depth / hops", /\b(reach depth|hops?)\b/i],
];

const QUOTED = /(["'`])((?:(?!\1)[^\\]|\\.)*\s(?:(?!\1)[^\\]|\\.)*)\1/g;
const JSX_TEXT = />([^<>{}]*[A-Za-z][^<>{}]*)</g;
const CODE_ONLY = /^(import |\/\/|\*|\/\*)|console\.|data-testid|className=|localStorage|searchText:/;

export function helpOffenders(file: string): string[] {
  const out: string[] = [];
  const lines = readFileSync(join(SRC, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (CODE_ONLY.test(t) || /\btechnical\b/.test(line)) return;
    const said = [...line.matchAll(QUOTED)].map((m) => m[2]).concat([...line.matchAll(JSX_TEXT)].map((m) => m[1]));
    for (const raw of said) {
      const s = raw.replace(/\$\{[^}]*\}/g, "");
      if (/\)\(|=>|\[\w+\]|\?\?/.test(s)) continue;
      if (/^[\w.\-/:#?=&%\s…]*$/.test(s.trim()) && !/\s\w+\s\w+/.test(s)) continue;
      for (const [name, re] of WORDS) if (re.test(s)) out.push(`${file}:${i + 1} ${name}: ${s.trim().slice(0, 80)}`);
    }
  });
  return out;
}

describe("Help & Guides speaks plainly", () => {
  it("the Help page and its guest overlay", () => {
    expect(["pages/WtfIsThis.tsx", "components/WtfWelcomeOverlay.tsx"].flatMap(helpOffenders)).toEqual([]);
  });
  it("the guides", () => {
    expect(HELP_FILES.slice(2).flatMap(helpOffenders)).toEqual([]);
  });
});

describe("Help & Guides describes today's app", () => {
  const help = readFileSync(join(SRC, "pages/WtfIsThis.tsx"), "utf8");
  // Shipped 2026-10-10: a newcomer's first questions are about these.
  for (const [what, re] of [
    ["your space and the wider network", /Your space[\s\S]*wider network/],
    ["saving your key", /Save your key/],
    ["checking the saved key", /Check it works/],
    ["the password for this browser", /password for this browser/],
    ["communities as encrypted group chats", /end-to-end encrypted[\s\S]*communit/i],
    ["encrypted calls", /Calls/],
    ["how careful: the three choices", /Careful[\s\S]*Balanced/],
    ["pictures from outside your space", /blur/i],
    ["translation", /translat/i],
    // Shipped 2026-10-11: editing a published article from the article page or Account.
    ["editing an article", /Can I edit an article after publishing\?[\s\S]*Save changes/],
    // Shipped 2026-10-11: Delete on posts, the honest line, the undo hold, private messages.
    ["deleting a post", /Can I delete my posts or account\?[\s\S]*Delete<\/strong> in its menu[\s\S]*Undo[\s\S]*removed from this device/],
  ] as Array<[string, RegExp]>) {
    it(`answers about ${what}`, () => {
      expect(help).toMatch(re);
    });
  }
});
