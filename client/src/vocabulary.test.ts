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
  ["note (say post)", /\bnotes?\b/i],
  ["Otto (the assistant is called Relay; owner, 2026-11-18)", /\bOtto\b/],
];

/** Where a retired word is allowed, and why. Keep this list short and named. */
const ALLOW: Array<{ file: RegExp; word?: RegExp; why: string }> = [
  { file: /GalaxyWarpOverlay\.tsx|app-sidebar\.tsx|pages\/Login\.tsx/, word: /^OUTPOST$|RELAY OUTPOST|^Outpost$/, why: "the wordmark" },
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
  { file: /lib\/kind-catalog\.ts/, word: /Short Text Note/, why: "the event kind's name in the NIP" },
  { file: /components\/NostrPost\.tsx|relay-ops\/EventInspector\.tsx|relay-ops\/WireConsole\.tsx/, word: /Note ID \(NIP-19\)|short text note|Note code|note codes/, why: "the raw event tables name the NIP's own terms (a note1… code)" },
  { file: /ZapDialog\.tsx|pages\/Wallet\.tsx|badges\/GiveBadge\.tsx|HolidayManager\.tsx|relay-ops\/ConfirmAction\.tsx|relay-ops\/TeamScreens\.tsx|pages\/TrustReviews\.tsx|TrustReviewsPanel\.tsx|pages\/RelayOpsCenter\.tsx/, word: /\bnotes?\b/i, why: "a note on a zap, payment, badge, date, action or vouch, or for the team, is a memo, not a post" },
  { file: /lib\/channel-relays\.ts|relay-ops\/AccessControlTab\.tsx|pages\/AnalyticsDashboard\.tsx/, word: /\bnote:/, why: "a field named note, or a note code's prefix, not a sentence" },
  { file: /pages\/Privacy\.tsx/, word: /\bnote it\b/, why: "the verb" },
  { file: /lib\/error-noise\.ts/, word: /\bsignal/i, why: "a browser's own error text, matched to drop it" },
  { file: /lib\/concord\/concord-community\.ts/, word: /\bhangout/i, why: "a technical note on the stored record" },
  { file: /lib\/pinned-feeds\.ts|lib\/concord\/concord-stream\.ts/, why: "code, not sentences" },
  { file: /pages\/WotVsAlgorithms\.tsx|pages\/RelayCommunities\.tsx|pages\/PublishingPrivacy\.tsx/, word: /\bsignal/i, why: "essays use the ordinary word" },
  { file: /landing\/OutpostLanding\.tsx/, word: /\bOutposts?\b/, why: "the visitor landing speaks as Outpost, the site's name (owner, 2026-11-16)" },
  { file: /relays\/RelaysWelcome\.tsx/, word: /\bOutpost\b/, why: "\"Give your Outpost a home\": the product, by name (owner, 2026-11-16)" },
  { file: /pages\/EncryptedMessages\.tsx/, word: /\bSignal\b/, why: "the messenger app, by name" },
  { file: /pages\/relay-ops\/shared\.tsx|pages\/AnalyticsDashboard\.tsx/, word: /^Channel (Create|Metadata|Message|Hide|Mute|Msg)$/, why: "NIP-28 event-kind names in the operator and analytics kind tables" },
];

const QUOTED = /(["'`])((?:(?!\1)[^\\]|\\.)*\s(?:(?!\1)[^\\]|\\.)*)\1/g;
const JSX_TEXT = /(?<!=)>([^<>{}]*[A-Za-z][^<>{}]*)</g; // an arrow's => is not a tag
/**
 * Props whose value is screen text, read even when it is one word. The
 * sentence filter drops one-word strings as identifiers, which is how the
 * profile's "Notes" tab (label: "Notes") got past it.
 */
const TEXT_PROP = /\b(label|title|placeholder|aria-label|alt|description|heading|singular|plural|word)\s*[:=]\s*\{?(["'])([^"'{}]*[A-Za-z][^"'{}]*)\2/g;
/** Lines that are only code: nothing on them reaches a screen. */
const CODE_ONLY = /^(import |export \* |\/\/|\*|\/\*|\{\/\*)|console\.|localStorage|sessionStorage|throw new Error|searchText:|from "|\.test\(|new RegExp|trackSignupEvent|debug\(/;
/**
 * Attributes that never reach a screen, cut out of a line before it is read.
 * They used to disqualify the whole line, which hid every JSX sentence that
 * shared a line with a className (most of them): "No broadcasts yet" lived
 * on an account page for a month. Braces are balanced by hand, since a
 * className={`…${a ? "b" : "c"}…`} nests them.
 */
const CODE_ATTR = /\b(className|class|data-testid|href|key|src|style|id|to|onClick|onChange|ref|type|name|value|placeholderClass)=/g;
/** The pieces of a line that can hold a quoted string on their own: each <tag …>, each balanced {…}, or the whole line when it has no JSX. */
function segments(line: string): string[] {
  if (!line.includes("<")) return [line];
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "<") {
      const j = line.indexOf(">", i);
      if (j < 0) { out.push(line.slice(i)); break; }
      out.push(line.slice(i, j + 1)); i = j + 1;
    } else if (c === "{") {
      let depth = 0, j = i;
      for (; j < line.length; j++) { if (line[j] === "{") depth++; else if (line[j] === "}") { depth--; if (depth === 0) { j++; break; } } }
      out.push(line.slice(i, j)); i = j;
    } else i++;
  }
  return out;
}
function stripCodeAttrs(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    CODE_ATTR.lastIndex = i;
    const m = CODE_ATTR.exec(line);
    if (!m) { out += line.slice(i); break; }
    out += line.slice(i, m.index);
    let j = m.index + m[0].length;
    const open = line[j];
    if (open === "{") {
      let depth = 0;
      for (; j < line.length; j++) { if (line[j] === "{") depth++; else if (line[j] === "}") { depth--; if (depth === 0) { j++; break; } } }
    } else if (open === '"' || open === "'") {
      j = line.indexOf(open, j + 1); j = j < 0 ? line.length : j + 1;
    }
    i = j;
  }
  return out;
}

function offenders(file: string): string[] {
  if (SKIP_FILES.some((re) => re.test(file))) return [];
  return offendersIn(readFileSync(file, "utf8"), file, relative(SRC, file));
}

/** The guard itself, on a file's text: split out so it can be proved to catch a planted word. */
function offendersIn(text: string, file: string, rel: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  let inComment = false;
  const near = (i: number, step: 1 | -1) => { for (let j = i + step; j >= 0 && j < lines.length; j += step) { const t = lines[j].trim(); if (t) return t; } return ""; };
  lines.forEach((line, i) => {
    const t = line.trim();
    // A block comment, including a JSX {/* … */} that runs over lines, never reaches a screen.
    if (inComment) { if (t.includes("*/")) inComment = false; return; }
    if (/^(\{\/\*|\/\*)/.test(t) && !t.includes("*/")) { inComment = true; return; }
    if (CODE_ONLY.test(t) || /\btechnical\b/.test(line)) return;
    const read = stripCodeAttrs(line);
    // Quoted strings are read per segment (a tag, a {…} expression, or a
    // code line), never across the whole line: a closing quote in one
    // attribute and an opening quote in a later expression are not a string.
    const quoted = segments(read).flatMap((seg) => [...seg.matchAll(QUOTED)].map((m) => m[2]));
    const jsx = [...read.matchAll(JSX_TEXT)].map((m) => m[1]);
    // JSX text that the line itself doesn't fence in: a label on a line of its
    // own inside an element, or text that starts or ends at a line break
    // (this is how "Mute Signal" and "Raw Telemetry" hid in the post menu).
    const prev = near(i, -1), next = near(i, 1);
    const afterTag = /[^=]>$/.test(prev) || prev === ">";
    const beforeTag = /^[<{]/.test(next);
    const BARE = /^[^<>{}=;()[\]`"'|&]*[A-Za-z][^<>{}=;()[\]`"'|&]*$/;
    if ((afterTag || beforeTag) && BARE.test(t)) jsx.push(t);
    else {
      const lead = afterTag ? /^([^<>{}=;()[\]`"']*[A-Za-z][^<>{}=;()[\]`"']*)</.exec(t) : null;
      if (lead) jsx.push(lead[1]);
      const trail = beforeTag ? />([^<>{}=;()[\]`"']*[A-Za-z][^<>{}=;()[\]`"']*)$/.exec(t) : null;
      if (trail) jsx.push(trail[1]);
      // Text that runs into an expression on the same line ("WoT: {tier}+"):
      // read what's left once the {…} parts are taken out, if it's plain words.
      const outside = t.replace(/\{[^{}]*\}/g, " ");
      if ((afterTag || beforeTag) && outside !== t && BARE.test(outside)) jsx.push(outside);
    }
    const said = [...quoted.map((q) => ({ raw: q, isJsx: false })), ...jsx.map((q) => ({ raw: q, isJsx: true }))];
    const sentences: string[] = [];
    for (const { raw, isJsx } of said) {
      const s = raw.replace(/\$\{[^}]*\}/g, "");
      if (/\)\(|=>|\[\w+\]|\?\?|\bconst\b|\breturn\b/.test(s)) continue;
      if (/\b(ring|shadow|bg|text|border|from|to|via)-[\w\[\]\/]/.test(s) && !/\s[a-z]+\s[a-z]+\s[a-z]+/.test(s)) continue; // a class list, not a sentence
      // Short word-only strings are usually identifiers — except text between
      // tags (always on screen) and a capitalised label ("Mute Signal").
      if (!isJsx && /^[\w.\-/:#?=&%$\s…]*$/.test(s.trim()) && !/\s\w+\s\w+/.test(s) && !/^[A-Z][a-z]+\s[A-Za-z]/.test(s.trim())) continue;
      sentences.push(s);
    }
    const props = [...read.matchAll(TEXT_PROP)].map((m) => m[3]);
    for (const [name, re] of RETIRED) {
      const seen = new Set<string>();
      for (const s of sentences.concat(props)) {
        const m = re.exec(s);
        if (!m || seen.has(s)) continue;
        seen.add(s);
        const allowed = ALLOW.some((a) => a.file.test(file) && (!a.word || a.word.test(m[0]) || a.word.test(s)));
        if (!allowed) out.push(`${rel}:${i + 1} ${name}: ${s.trim().slice(0, 90)}`);
      }
    }
  });
  return out;
}

describe("the guard can fail (a harness that can't fail proves nothing)", () => {
  const caught = (src: string) => offendersIn(src, "client/src/components/Planted.tsx", "components/Planted.tsx");
  it("catches a retired word in a quoted string", () => {
    expect(caught(`const label = "Mute this signal now";`)).toHaveLength(1);
  });
  it("catches a retired word between tags on one line", () => {
    expect(caught(`<span className="x">Mute signal</span>`)).toHaveLength(1);
  });
  it("catches a retired word on a line of its own inside an element (how \"Mute Signal\" hid)", () => {
    expect(caught(["          <DropdownMenuItem onSelect={go}>", "            <VolumeX className=\"w-3.5 h-3.5\" />", "            Mute Signal", "          </DropdownMenuItem>"].join("\n"))).toHaveLength(1);
  });
  it("catches text after a tag that runs into an expression (how \"WoT: {tier}+\" hid)", () => {
    expect(caught(["                    <ShieldCheck className=\"w-3 h-3\" />", "                    WoT: {getSignalTierLabel(wotMinTier)}+", "                  </Badge>"].join("\n"))).toHaveLength(1);
  });
  it("catches text that runs up to a tag on the next line", () => {
    expect(caught(["        <p>", "          Your crew sees this first", "        </p>"].join("\n"))).toHaveLength(1);
  });
  it("catches a one-word label, and leaves the ids alone", () => {
    expect(caught(`  { id: "notes", label: "Notes", icon: FileText },`)).toHaveLength(1);
    expect(caught(`<TabCountLine count={n} singular="note" plural="notes" />`)).toHaveLength(2);
    expect(caught(`<div data-testid="container-no-notes" />`)).toEqual([]);
  });
  it("leaves code alone", () => {
    expect(caught(["const signal = controller.signal;", "  abort(signal)", "type Crew = Map<string, Member>"].join("\n"))).toEqual([]);
  });
});

describe("the app says one word per thing (VOCABULARY.md)", () => {
  const files = sourceFiles(SRC);
  it("scans the client", () => {
    expect(files.length).toBeGreaterThan(500);
  });
  it("no retired word reaches a screen", () => {
    expect(files.flatMap(offenders)).toEqual([]);
  });
});
