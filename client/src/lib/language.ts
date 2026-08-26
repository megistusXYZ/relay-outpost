/**
 * Per-post language detection + the user's language preference.
 *
 * Uses `tinyld/light` (pure-JS, no network) to identify a post's language by
 * ISO-639-1 code — crucially able to separate same-script languages (en vs es
 * vs pt), which the old "hide <50% Latin" heuristic could not. Detection is
 * cached (short posts are treated as "unknown" and never filtered out).
 *
 * The preference defaults to the device's languages (`navigator.languages`) and
 * is user-editable in Settings. Discover filters to the preferred set; posts of
 * unknown/undetectable language are always kept (never over-filter).
 */
import type { Event } from "nostr-tools";

// tinyld is code-split (dynamic import) so it stays out of the main bundle and
// off the default feed path — it loads only when the Discover language filter
// first runs. Until it resolves, detection returns null (unknown → never filtered).
type DetectFn = (s: string) => string;
type DetectAllFn = (s: string) => Array<{ lang: string; accuracy: number }>;
let detectFn: DetectFn | null = null;
let detectAllFn: DetectAllFn | null = null;
let loadPromise: Promise<void> | null = null;

export function ensureLanguageDetector(): Promise<void> {
  if (detectFn) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = import("tinyld/light")
      .then((m) => {
        detectFn = m.detect as DetectFn;
        detectAllFn = m.detectAll as DetectAllFn;
      })
      .catch(() => { loadPromise = null; });
  }
  return loadPromise;
}

const STORAGE_KEY = "relay-outpost-languages";
export const LANGUAGES_CHANGED_EVENT = "languages-changed";

/** Below this many "wordy" chars, detection is unreliable → treat as unknown. */
const MIN_DETECT_CHARS = 12;

/** Strip URLs, nostr refs, hashtags, mentions, emoji, digits, punctuation — leave prose. */
function proseOnly(content: string): string {
  return content
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/nostr:[a-z0-9]+/gi, " ")
    .replace(/[#@][\w-]+/g, " ")
    // Strip emoji without unicode-property escapes (keeps the TS target low):
    // astral pairs + common BMP symbol/dingbat ranges + variation selectors.
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[←-➿⬀-⯿️⃣]/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const detectCache = new Map<string, string | null>();
const CACHE_MAX = 2000;

/** ISO-639-1 code (e.g. "en") or null when undetectable/too short. Cached. */
export function detectLanguage(content: string): string | null {
  const prose = proseOnly(content);
  if (prose.length < MIN_DETECT_CHARS) return null;
  const key = prose.slice(0, 240);
  const cached = detectCache.get(key);
  if (cached !== undefined) return cached;
  if (!detectFn) {
    ensureLanguageDetector(); // warm; treat as unknown until ready (don't cache)
    return null;
  }
  let lang: string | null = null;
  try {
    const d = detectFn(key);
    lang = d && d.length === 2 ? d : null;
  } catch {
    lang = null;
  }
  if (detectCache.size >= CACHE_MAX) detectCache.clear();
  detectCache.set(key, lang);
  return lang;
}

const eventLangCache = new Map<string, string | null>();
/** Detect + cache an event's language by its id (feed calls this per event). */
export function detectEventLanguage(event: Event): string | null {
  const hit = eventLangCache.get(event.id);
  if (hit !== undefined) return hit;
  const lang = detectLanguage(event.content);
  if (eventLangCache.size >= CACHE_MAX) eventLangCache.clear();
  eventLangCache.set(event.id, lang);
  return lang;
}

function primarySubtag(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0];
}

/** Device languages as deduped ISO-639-1 primary subtags (fallback ["en"]). */
export function deviceLanguages(): string[] {
  try {
    const list = (typeof navigator !== "undefined" && navigator.languages) || [];
    const out: string[] = [];
    for (const l of list) {
      const p = primarySubtag(l);
      if (p && p.length === 2 && !out.includes(p)) out.push(p);
    }
    return out.length ? out : ["en"];
  } catch {
    return ["en"];
  }
}

/** The user's preferred languages; defaults to device languages when unset. */
export function getPreferredLanguages(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
    }
  } catch {}
  return deviceLanguages();
}

export function setPreferredLanguages(langs: string[]): void {
  const clean = Array.from(new Set(langs.map(primarySubtag).filter((l) => l.length === 2)));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {}
  try {
    window.dispatchEvent(new Event(LANGUAGES_CHANGED_EVENT));
  } catch {}
}

/** True when no explicit override is stored — languages follow the device. */
export function isLanguagesAuto(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === null;
  } catch {
    return true;
  }
}

/** Drop the override and go back to following the device's languages. */
export function clearPreferredLanguages(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  try {
    window.dispatchEvent(new Event(LANGUAGES_CHANGED_EVENT));
  } catch {}
}

/** The device's languages (what Auto resolves to right now). */
export function getDeviceLanguages(): string[] {
  return deviceLanguages();
}

/**
 * True if the content is allowed under the preferred-language set. Unknown/too-
 * short posts are always allowed; an empty preference means "all languages".
 */
// ── Confidently-foreign detection ───────────────────────────────────────────
// tinyld/light's single best guess is unreliable on short Latin text: it calls
// English titles Norwegian/Romanian (sometimes at accuracy 1.0 — a unique-gram
// hit on a name) and whiffs entirely on some real German. Anything that ACTS on
// "this post is foreign" (Translate offers, the Discover language floor) must
// demand more than a best guess, or English posts get flagged/filtered.

// Core English function words that rarely appear as standalone words in other
// Latin-script languages ("was" excluded — it's a German word; "a"/"no"/"en"
// excluded — Romance collisions). Two distinct hits = the text is plausibly
// English no matter what the n-gram detector claims.
const EN_FUNCTION_WORDS = new Set([
  "the", "and", "is", "of", "to", "that", "for", "with", "this", "from",
  "are", "have", "not", "they", "in", "what", "been", "will", "would",
]);

const foreignCache = new Map<string, string | null>();

/** The post's language, ONLY when it is confidently one the user doesn't read;
 *  null when it's a user language, ambiguous, or undetectable. Rules (tuned on
 *  a labeled corpus, 23/23): the top candidate must not be a user language, no
 *  user language may sit in the top 3 within half the winner's accuracy, the
 *  winner needs accuracy ≥0.3 or ≥2× the runner-up, and for English readers
 *  two distinct core-English function words veto the guess outright. */
export function detectForeignLanguage(content: string, langs: string[]): string | null {
  if (!langs || langs.length === 0) return null;
  const prose = proseOnly(content);
  if (prose.length < MIN_DETECT_CHARS) return null;
  if (!detectAllFn) {
    ensureLanguageDetector();
    return null;
  }
  const mine = langs.map(primarySubtag);
  const key = prose.slice(0, 240) + "|" + mine.join(",");
  const cached = foreignCache.get(key);
  if (cached !== undefined) return cached;

  let lang: string | null = null;
  try {
    const all = detectAllFn(prose.slice(0, 240));
    const top = all[0];
    if (top && !mine.includes(top.lang)) {
      const rival = all.slice(0, 3).find((c) => mine.includes(c.lang));
      const second = all[1];
      const ambiguous =
        (rival && rival.accuracy >= top.accuracy * 0.5) ||
        (top.accuracy < 0.3 && second && top.accuracy < second.accuracy * 2);
      let vetoed = false;
      if (!ambiguous && mine.includes("en")) {
        const hits = new Set(
          prose.toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => EN_FUNCTION_WORDS.has(w)),
        );
        vetoed = hits.size >= 2;
      }
      if (!ambiguous && !vetoed) lang = top.lang;
    }
  } catch {
    lang = null;
  }
  if (foreignCache.size >= CACHE_MAX) foreignCache.clear();
  foreignCache.set(key, lang);
  return lang;
}

export function languageAllowed(content: string, langs: string[]): boolean {
  return detectForeignLanguage(content, langs) === null;
}
