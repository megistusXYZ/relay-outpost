/**
 * One word per thing, app-wide (VOCABULARY.md; owner, 2026-10-10). The
 * first-use review found eight names for one secret and a mission-control
 * metaphor on every screen. This reads every user-visible string in the
 * client — JSX text and quoted sentences — and fails on a retired word, so a
 * new screen can't bring an old word back. Brand strings are allowed by
 * name below, not by loosening a rule.
 *
 * Prove it can fail: write "No broadcasts yet" in any component.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "client", "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== "__tests__") sourceFiles(full, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/ \d\./.test(name)) out.push(full);
  }
  return out;
}

/** The changelog is history and keeps its words; test helpers aren't screens. */
const SKIP_FILES = [/lib\/changelog\.ts$/, /\/test\//, /ci-globals/];

/** Retired words, as people would read them. */
const RETIRED: Array<[string, RegExp]> = [
  ["broadcast (say post / send)", /\bbroadcast(s|ed|ing)?\b/i],
  ["transmit (say send / post)", /\btransmi(t|ts|tted|tting|ssions?)\b/i],
  ["signal (say refresh / health / stream)", /\bsignals?\b/i],
  ["crew / orbit (say following / followers / your people)", /\b(crew|orbit)\b/i],
  ["station (say relay)", /\bstations?\b/i],
  ["mission / briefing / orientation / cockpit (say tour / menu)", /\b(mission|briefing|orientation|cockpit)s?\b/i],
  ["Flight Log / Vault (menu groups)", /\b(Flight Log|Vault)\b/],
  ["Wave (say post)", /\bWaves?\b/],
  ["secret key / private key / nsec (say your key)", /\b(secret key|private key|nsec)\b/i],
  ["passphrase (say password for this browser)", /\bpassphrases?\b/i],
  ["backup file / recovery code (say key file)", /\b(backup file|recovery code)\b/i],
  ["global feed / public Nostr (say the wider network)", /\b(global feed|public Nostr)\b/i],
  ["Alerts / Notifications as a place (say Activity)", /^(Alerts|Notifications)$/],
  ["You as the tab (say Account)", /\b(Discover, You|and You)\b/],
  ["Open / Strict as presets (say See everything / Careful)", /\b(Open|Strict)\s*[/·,]\s*Balanced|Balanced\s*[/·,]\s*(Open|Strict)\b/],
  ["WoT (say trust)", /\bWoT\b/],
  ["Shield Matrix (say Trust & safety)", /\bShield Matrix\b/],
  ["Trust & Safety title case (say Trust & safety)", /Trust & Safety|Trust &amp; Safety/],
  ["Relay Control (say console)", /\bRelay Control\b/],
  ["hangout (say call)", /\bhangouts?\b/i],
  ["channel for a room (say room)", /\bchannels?\b/i],
  ["Outpost as a thing (the wordmark is allowed)", /(?<!Relay )\bOutposts?\b(?! for everything)/],
];

/** Where a retired word is allowed, and why. Keep this list short and named. */
const ALLOW: Array<{ file: RegExp; word?: RegExp; why: string }> = [
  { file: /GalaxyWarpOverlay\.tsx|app-sidebar\.tsx|pages\/Login\.tsx/, word: /^OUTPOST$|RELAY OUTPOST/, why: "the wordmark" },
  { file: /use-document-title\.ts/, word: /Beyond the Algorithm/, why: "the tagline" },
  { file: /WotVsAlgorithms\.tsx|WtfIsThis\.tsx/, word: /Web of Trust/, why: "the essay that explains it, and its card" },
  { file: /pages\/LiveStreams\.tsx|components\/live\//, word: /\bchannels?\b/i, why: "a broadcaster's live channel is a channel" },
  { file: /lib\/channel-|Channels\.tsx|pages\/Search\.tsx/, word: /\bchannels?\b/i, why: "live channels tab" },
  { file: /concord-hangout\.ts|AudioSpace|audio-spaces|pages\/AudioFeed\.tsx|CornyChat/, word: /\bhangouts?\b|\bstations?\b/i, why: "audio rooms on Corny Chat and internet radio stations are their own things" },
  { file: /RadioStation|internet-radio|AudioFeed|pages\/Audio\.tsx/, word: /\bstations?\b/i, why: "a radio station is a station" },
  { file: /Settings\.tsx/, word: /Station Default|Geometric ops/, why: "a font's own name" },
  { file: /ImportKeyFlow\.tsx|key-storage-environment\.ts/, word: /\bnsec\b|ncryptsec/i, why: "the import screen names the formats other apps hand you" },
  { file: /pages\/DataSovereignty\.tsx|pages\/NostrVsAlternatives\.tsx|pages\/WhereNostrIsHeading\.tsx|pages\/WhyDecentralization\.tsx/, why: "the Go-deeper essays about the network (help-plain-words.test.ts holds them to its own bar)" },
  { file: /signer-notice\.ts|pages\/Settings\.tsx/, word: /nsec\.app/i, why: "an app's name" },
  { file: /lib\/kind-catalog\.ts/, word: /\bchannels?\b/i, why: "the catalogue of event kinds names the old public channels" },
  { file: /lib\/error-noise\.ts/, word: /\bsignal/i, why: "a browser's own error text, matched to drop it" },
  { file: /lib\/concord\/concord-community\.ts/, word: /\bhangout/i, why: "a technical note on the stored record" },
  { file: /lib\/pinned-feeds\.ts|lib\/concord\/concord-stream\.ts/, why: "code, not sentences" },
  { file: /pages\/WotVsAlgorithms\.tsx|pages\/RelayCommunities\.tsx|pages\/PublishingPrivacy\.tsx/, word: /\bsignal/i, why: "essays use the ordinary word" },
  { file: /LandingMarketing\.tsx/, word: /\bsignals?\b|\bbroadcast/i, why: "the landing page's own voice (owner to decide)" },
];

const QUOTED = /(["'`])((?:(?!\1)[^\\]|\\.)*\s(?:(?!\1)[^\\]|\\.)*)\1/g;
const JSX_TEXT = />([^<>{}]*[A-Za-z][^<>{}]*)</g;
const CODE_ONLY = /^(import |export \* |\/\/|\*|\/\*|\{\/\*)|console\.|data-testid|className=|localStorage|sessionStorage|throw new Error|searchText:|from "|href=|key=|aria-hidden|\.test\(|new RegExp|===|ring-|shadow-\[|rgba\(|trackSignupEvent|debug\(/;

function offenders(file: string): string[] {
  const rel = relative(SRC, file);
  if (SKIP_FILES.some((re) => re.test(file))) return [];
  const out: string[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (CODE_ONLY.test(t) || /\btechnical\b/.test(line)) return;
    const said = [...line.matchAll(QUOTED)].map((m) => m[2]).concat([...line.matchAll(JSX_TEXT)].map((m) => m[1]));
    for (const raw of said) {
      const s = raw.replace(/\$\{[^}]*\}/g, "");
      if (/\)\(|=>|\[\w+\]|\?\?|\bconst\b|\breturn\b/.test(s)) continue;
      if (/^[\w.\-/:#?=&%\s…]*$/.test(s.trim()) && !/\s\w+\s\w+/.test(s)) continue;
      for (const [name, re] of RETIRED) {
        const m = re.exec(s);
        if (!m) continue;
        const allowed = ALLOW.some((a) => a.file.test(file) && (!a.word || a.word.test(m[0]) || a.word.test(s)));
        if (!allowed) out.push(`${rel}:${i + 1} ${name}: ${s.trim().slice(0, 90)}`);
      }
    }
  });
  return out;
}

describe("the app says one word per thing (VOCABULARY.md)", () => {
  const files = sourceFiles(SRC);
  it("scans the client", () => {
    expect(files.length).toBeGreaterThan(500);
  });
  it("no retired word reaches a screen", () => {
    expect(files.flatMap(offenders)).toEqual([]);
  });
});
