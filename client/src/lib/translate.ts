/**
 * Post translation — layered FREE engine, $0 operator cost.
 *
 * Engine order:
 *   1. On-device browser Translator API (Chrome/Edge 138+): instant, private,
 *      offline-capable. Feature-detected; absent on Safari/iOS.
 *   2. NIP-90 translation DVM (kind 5002 request → kind 6002 result): works
 *      everywhere, Nostr-native interop — we consume the same DVMs other
 *      clients use. Free-only: a `payment-required` status is treated as a
 *      miss, never surfaced as a paywall.
 *
 * Privacy model:
 *   - The DVM path takes a PUBLIC NostrEvent (it ships only the event *id*;
 *     the DVM fetches the post itself). It can never receive raw text, so
 *     encrypted surfaces (DMs, Concord) are structurally excluded — they may
 *     only use translateTextOnDevice(), which never leaves the device.
 *   - DVM requests are signed by a fresh ephemeral key per request, so
 *     translation activity is not linkable to the user's identity.
 *
 * UX contract (see TranslateControl): auto-OFFER (link appears on posts whose
 * detected language isn't one of the user's), manual FIRE (nothing is
 * requested until tapped), with an earned per-language "always translate"
 * upgrade after repeated manual use. Results are LRU-cached per
 * (eventId, targetLang) so a post translates once per device, ever.
 */
import type { Event as NostrEvent, Filter } from "nostr-tools";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { pool, DEFAULT_RELAYS } from "./nostr";
import { detectEventLanguage, detectForeignLanguage, getPreferredLanguages } from "./language";

// ── Wire constants (NIP-90) ─────────────────────────────────────────────────
export const KIND_DVM_TRANSLATE_REQUEST = 5002;
export const KIND_DVM_TRANSLATE_RESULT = 6002;
export const KIND_DVM_STATUS = 7000;

/** Broadcast targets for translation jobs — busy public relays DVM operators
 *  watch. One-shot request/response, so hot-relay load is negligible. */
export const TRANSLATE_DVM_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
];

/** Curated DVM pubkeys (hex). When non-empty the request is addressed to them
 *  (p-tags) and only their results are accepted; when empty the job is an open
 *  broadcast and the first valid result wins. Update per release as the DVM
 *  landscape shifts. */
export const CURATED_TRANSLATE_DVMS: string[] = [];

export const DVM_TOTAL_TIMEOUT_MS = 10_000;

// ── Settings keys ───────────────────────────────────────────────────────────
/** Master switch (default ON — only the literal "false" disables). */
export const TRANSLATION_ENABLED_KEY = "relay-outpost-translation-enabled";
/** JSON string[] of ISO-639-1 codes the user asked to auto-translate. */
export const AUTO_TRANSLATE_LANGS_KEY = "relay-outpost-translate-auto-langs";
const MANUAL_COUNTS_KEY = "relay-outpost-translate-manual-counts";
const AUTO_DISMISSED_KEY = "relay-outpost-translate-auto-dismissed";
const CACHE_KEY = "relay-outpost:translations:v1";

export const TRANSLATE_SETTINGS_EVENT = "relay-outpost:translate-settings";

export function translationEnabled(): boolean {
  try { return localStorage.getItem(TRANSLATION_ENABLED_KEY) !== "false"; } catch { return true; }
}

export function setTranslationEnabled(on: boolean): void {
  try { localStorage.setItem(TRANSLATION_ENABLED_KEY, on ? "true" : "false"); } catch {}
  try { window.dispatchEvent(new CustomEvent(TRANSLATE_SETTINGS_EVENT)); } catch {}
}

/** The language we translate INTO: the user's first preferred language. */
export function targetLanguage(): string {
  const first = getPreferredLanguages()[0];
  return (first || "en").split("-")[0].toLowerCase();
}

/** "ja" → "Japanese" in the user's own language. Falls back to the code. */
export function languageName(code: string): string {
  try {
    const dn = new Intl.DisplayNames([targetLanguage()], { type: "language" });
    return dn.of(code) || code;
  } catch {
    return code;
  }
}

// ── Capability gate (fail closed — never show a Translate link that can't
//    deliver) ────────────────────────────────────────────────────────────────
// Presence of the Translator API is NOT capability: some Chromium shells ship
// zombie bindings where availability() never settles (verified live in the
// embedded preview browser). So capability is PROVEN by a one-time probe —
// availability() must actually resolve, within a hard cap — and cached. Until
// the probe passes (or a curated DVM exists), no post shows a Translate link.
export const CAPABILITY_KEY = "relay-outpost:translate-capable:v1";
const CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // positive verdicts: re-probe weekly
// A "no" is often transient (cold server, flaky network) — retry within the hour.
const CAPABILITY_NEGATIVE_TTL_MS = 60 * 60 * 1000;

/** TTL for a stored verdict — a positive one is stable; a negative one retries soon. */
function capabilityTtl(ok: boolean): number {
  return ok ? CAPABILITY_TTL_MS : CAPABILITY_NEGATIVE_TTL_MS;
}

let probeStarted = false;

/** Synchronous read of proven capability. False until a probe has passed. */
export function translationCapable(): boolean {
  if (CURATED_TRANSLATE_DVMS.length > 0) return true;
  try {
    const raw = localStorage.getItem(CAPABILITY_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    if (typeof p?.ok !== "boolean" || Date.now() - (p.at || 0) > capabilityTtl(p.ok)) return false;
    return p.ok;
  } catch {
    return false;
  }
}

function storeCapability(ok: boolean): void {
  try { localStorage.setItem(CAPABILITY_KEY, JSON.stringify({ ok, at: Date.now() })); } catch {}
  if (ok) {
    // Mounted posts re-evaluate their offer the moment capability is proven.
    try { window.dispatchEvent(new CustomEvent(TRANSLATE_SETTINGS_EVENT)); } catch {}
  }
}

/** Health check of the server translation proxy (the lane that makes
 *  translation work on Safari/iOS and anywhere without on-device models).
 *  true/false are VERDICTS; null = inconclusive (timeout/network) — the
 *  page-load request storm can starve this fetch, and a timeout must never
 *  be recorded as "this deployment can't translate". */
async function probeServerTranslate(): Promise<boolean | null> {
  try {
    const r = await withTimeout(
      fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: "hola", target: "en" }),
      }).then((res) => res.ok),
      8_000,
    );
    return r === null ? null : r === true;
  } catch {
    return null;
  }
}

/** Fire-and-forget: prove (or disprove) translation capability once per TTL.
 *  Device first (a hanging availability() counts as incapable — the zombie
 *  case), then the server proxy — capable if EITHER lane works. Deferred past
 *  initial page load, and an inconclusive server probe retries once before
 *  any negative verdict is stored (negatives expire in an hour regardless). */
function kickCapabilityProbe(): void {
  if (probeStarted) return;
  probeStarted = true;
  try {
    const raw = localStorage.getItem(CAPABILITY_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p?.ok === "boolean" && Date.now() - (p.at || 0) <= capabilityTtl(p.ok)) return; // fresh verdict exists
    }
  } catch {}
  setTimeout(async () => {
    const g = globalThis as any;
    if (typeof g.Translator?.availability === "function") {
      const a = await withTimeout(
        Promise.resolve(g.Translator.availability({ sourceLanguage: "es", targetLanguage: "en" })),
        3_000,
      );
      if (a === "available" || a === "downloadable" || a === "downloading" || a === "after-download") {
        storeCapability(true);
        return;
      }
    }
    const first = await probeServerTranslate();
    if (first !== null) {
      storeCapability(first);
      return;
    }
    // Inconclusive — retry once after the network settles.
    setTimeout(async () => {
      const second = await probeServerTranslate();
      storeCapability(second === true);
    }, 12_000);
  }, 2_500);
}

// ── Offer gating ────────────────────────────────────────────────────────────
// The statistical detector is unreliable on short Latin text (it happily calls
// "spearfishing barracuda" Dutch), so Latin-script posts need real length
// before we trust it enough to OFFER translation. CJK/Hangul are the opposite:
// the script alone identifies the language family, so even a 4-character post
// is confidently foreign — no detector needed.
const MIN_LATIN_OFFER_CHARS = 40;

const KANA_RE = /[぀-ゟ゠-ヿ]/g; // hiragana + katakana → Japanese
const HANGUL_RE = /[가-힣]/g; // → Korean
const HAN_RE = /[一-鿿㐀-䶿]/g; // Han without kana → Chinese (best guess)

/** Script-based language hint for short text the statistical detector can't
 *  handle. Returns null for Latin/other scripts (those need the detector). */
export function scriptLanguageHint(text: string): string | null {
  if ((text.match(KANA_RE) || []).length >= 2) return "ja";
  if ((text.match(HANGUL_RE) || []).length >= 2) return "ko";
  if ((text.match(HAN_RE) || []).length >= 2) return "zh";
  return null;
}

/** True when a post should carry the Translate affordance: feature on, the
 *  post's language is confidently detected, and it isn't one the user reads. */
export function shouldOfferTranslation(event: NostrEvent): string | null {
  if (!translationEnabled()) return null;
  // Fail closed: no link until translation is PROVEN to work here (probe
  // passed or a curated DVM exists). The probe kicks lazily on first ask and
  // fires TRANSLATE_SETTINGS_EVENT when it passes, so links appear then.
  if (!translationCapable()) {
    kickCapabilityProbe();
    return null;
  }
  const mine = getPreferredLanguages().map((l) => l.split("-")[0].toLowerCase());

  // Script shortcut first — catches short CJK posts the detector floor drops.
  const hint = scriptLanguageHint(event.content);
  if (hint) return mine.includes(hint) ? null : hint;

  // Latin-script short text: the detector's guess isn't trustworthy enough to
  // bother the user with a Translate link (false offers on English posts).
  if (event.content.replace(/https?:\/\/\S+|nostr:[a-z0-9]+/gi, "").trim().length < MIN_LATIN_OFFER_CHARS) return null;
  // Confidence-gated: only offer when the post is CONFIDENTLY in a language
  // the user doesn't read — a bare best guess flags English titles as
  // Norwegian/Romanian and litters English feeds with Translate links.
  return detectForeignLanguage(event.content, mine);
}

// ── Result cache — LRU per (eventId, targetLang) ────────────────────────────
export interface TranslationResult {
  text: string;
  /** ISO-639-1 source language ("und" when the engine didn't say). */
  from: string;
  engine: "device" | "server" | "dvm";
}

const CACHE_MAX = 200;
type CacheShape = { order: string[]; map: Record<string, TranslationResult> };

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p?.order) && p?.map && typeof p.map === "object") return p as CacheShape;
    }
  } catch {}
  return { order: [], map: {} };
}

function writeCache(c: CacheShape): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}

const cacheKeyFor = (eventId: string, lang: string) => `${eventId.slice(0, 16)}:${lang}`;

export function getCachedTranslation(eventId: string, lang: string): TranslationResult | null {
  return readCache().map[cacheKeyFor(eventId, lang)] ?? null;
}

export function putCachedTranslation(eventId: string, lang: string, result: TranslationResult): void {
  const c = readCache();
  const key = cacheKeyFor(eventId, lang);
  if (!(key in c.map)) c.order.push(key);
  c.map[key] = result;
  while (c.order.length > CACHE_MAX) {
    const evict = c.order.shift();
    if (evict) delete c.map[evict];
  }
  writeCache(c);
}

// ── Earned "always translate" ───────────────────────────────────────────────
const AUTO_OFFER_THRESHOLD = 3;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {}
  return fallback;
}

export function getAutoTranslateLangs(): string[] {
  return readJson<string[]>(AUTO_TRANSLATE_LANGS_KEY, []);
}

export function setAutoTranslateLangs(langs: string[]): void {
  try { localStorage.setItem(AUTO_TRANSLATE_LANGS_KEY, JSON.stringify(Array.from(new Set(langs)))); } catch {}
  try { window.dispatchEvent(new CustomEvent(TRANSLATE_SETTINGS_EVENT)); } catch {}
}

export function addAutoTranslateLang(lang: string): void {
  setAutoTranslateLangs([...getAutoTranslateLangs(), lang]);
}

export function removeAutoTranslateLang(lang: string): void {
  setAutoTranslateLangs(getAutoTranslateLangs().filter((l) => l !== lang));
}

/** Bump the manual-translation counter for a language; returns the new count. */
export function recordManualTranslation(lang: string): number {
  const counts = readJson<Record<string, number>>(MANUAL_COUNTS_KEY, {});
  counts[lang] = (counts[lang] || 0) + 1;
  try { localStorage.setItem(MANUAL_COUNTS_KEY, JSON.stringify(counts)); } catch {}
  return counts[lang];
}

export function dismissAlwaysTranslate(lang: string): void {
  const d = readJson<string[]>(AUTO_DISMISSED_KEY, []);
  if (!d.includes(lang)) {
    d.push(lang);
    try { localStorage.setItem(AUTO_DISMISSED_KEY, JSON.stringify(d)); } catch {}
  }
}

/** Offer the "Always translate X?" upgrade once a user has manually translated
 *  that language enough times — unless they already opted in or dismissed it. */
export function shouldOfferAlwaysTranslate(lang: string): boolean {
  if (getAutoTranslateLangs().includes(lang)) return false;
  if (readJson<string[]>(AUTO_DISMISSED_KEY, []).includes(lang)) return false;
  const counts = readJson<Record<string, number>>(MANUAL_COUNTS_KEY, {});
  return (counts[lang] || 0) >= AUTO_OFFER_THRESHOLD;
}

// ── Engine 1: on-device browser Translator API ──────────────────────────────
/** Resolve null when `promise` doesn't settle within `ms` — the UI must never
 *  sit in "Translating…" forever (Translator.create() can hang for minutes
 *  while Chrome downloads a language-pair model on first use). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

const ON_DEVICE_TIMEOUT_MS = 8_000;
/** Hard ceiling for a whole translateEvent call, every engine included. */
export const TRANSLATE_TOTAL_TIMEOUT_MS = 15_000;

/** Feature-detect the built-in translator (stable global, then origin-trial). */
export function browserTranslatorSupported(): boolean {
  const g = globalThis as any;
  return typeof g.Translator?.create === "function" || typeof g.translation?.createTranslator === "function";
}

/** On-device source-language detection (Chrome's LanguageDetector) — corrects
 *  the statistical/script guess before translating, so a Han-only Japanese
 *  post doesn't get run through the zh model (and the caption stays honest). */
async function detectSourceOnDevice(text: string): Promise<string | null> {
  const g = globalThis as any;
  if (typeof g.LanguageDetector?.create !== "function") return null;
  const result = await withTimeout(
    (async () => {
      const d = await g.LanguageDetector.create();
      const ranked = await d.detect(text);
      const top = ranked?.[0];
      return top && top.confidence > 0.5 ? String(top.detectedLanguage).slice(0, 2) : null;
    })(),
    2_000,
  );
  return result;
}

interface OnDeviceOutcome {
  text: string | null;
  /** True when the language-pair model is still downloading — a Retry in a
   *  moment will likely succeed, and the UI should say so honestly. */
  warming: boolean;
}

async function translateOnDeviceDetailed(text: string, from: string, to: string): Promise<OnDeviceOutcome> {
  const g = globalThis as any;
  let downloading = false;
  const attempt = async (): Promise<string | null> => {
    if (typeof g.Translator?.create === "function") {
      if (typeof g.Translator.availability === "function") {
        const a = await withTimeout(
          Promise.resolve(g.Translator.availability({ sourceLanguage: from, targetLanguage: to })),
          2_000,
        );
        if (a === null || a === "unavailable") return null; // hung or truly missing pair
        if (a === "downloadable" || a === "downloading" || a === "after-download") downloading = true;
      }
      const t = await g.Translator.create({ sourceLanguage: from, targetLanguage: to });
      return (await t.translate(text)) || null;
    }
    if (typeof g.translation?.createTranslator === "function") {
      const t = await g.translation.createTranslator({ sourceLanguage: from, targetLanguage: to });
      return (await t.translate(text)) || null;
    }
    return null;
  };
  try {
    // The timeout doubles as a first-use accommodation: create() keeps
    // downloading in the background after we bail, so a later Retry succeeds.
    const text2 = await withTimeout(attempt(), ON_DEVICE_TIMEOUT_MS);
    return { text: text2, warming: text2 === null && downloading };
  } catch {
    return { text: null, warming: downloading };
  }
}

/** Plain-text on-device translation — the ONLY function encrypted surfaces
 *  (DMs, Concord) may ever use. Never touches the network. */
export async function translateTextOnDevice(text: string, from: string, to: string): Promise<string | null> {
  return (await translateOnDeviceDetailed(text, from, to)).text;
}

// ── Engine 2: NIP-90 translation DVM ────────────────────────────────────────
/** Tags for a kind-5002 job. Ships only the event ID — the DVM fetches the
 *  post itself, so raw text never rides in the request. */
export function buildTranslateRequestTags(
  eventId: string,
  relayHint: string,
  target: string,
  dvmPubkeys: string[] = CURATED_TRANSLATE_DVMS,
): string[][] {
  const tags: string[][] = [
    ["i", eventId, "event", relayHint],
    ["param", "language", target],
    ["relays", ...TRANSLATE_DVM_RELAYS],
    ["output", "text/plain"],
  ];
  for (const pk of dvmPubkeys) tags.push(["p", pk]);
  return tags;
}

/** A kind-7000 status that asks for payment → treat the DVM as a miss. */
export function isPaymentRequired(status: NostrEvent): boolean {
  return status.tags.some((t) => t[0] === "status" && t[1] === "payment-required");
}

/** True when a kind-6002 result should be accepted for this request. With a
 *  curated list, only listed DVMs count; open broadcast accepts the first. */
export function acceptDvmResult(result: NostrEvent, requestId: string, curated: string[] = CURATED_TRANSLATE_DVMS): boolean {
  if (result.kind !== KIND_DVM_TRANSLATE_RESULT) return false;
  if (!result.tags.some((t) => t[0] === "e" && t[1] === requestId)) return false;
  if (!result.content.trim()) return false;
  if (curated.length > 0 && !curated.includes(result.pubkey)) return false;
  return true;
}

async function translateViaDvm(event: NostrEvent, to: string): Promise<TranslationResult | null> {
  // Ephemeral identity per request — translation activity never links to the user.
  const sk = generateSecretKey();
  const request = finalizeEvent(
    {
      kind: KIND_DVM_TRANSLATE_REQUEST,
      created_at: Math.floor(Date.now() / 1000),
      tags: buildTranslateRequestTags(event.id, DEFAULT_RELAYS[0] || "", to),
      content: "",
    },
    sk,
  );

  return new Promise((resolve) => {
    let done = false;
    const finish = (r: TranslationResult | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sub.close(); } catch {}
      resolve(r);
    };

    const filter: Filter = { kinds: [KIND_DVM_TRANSLATE_RESULT, KIND_DVM_STATUS], "#e": [request.id] };
    const sub = pool.subscribeMany(TRANSLATE_DVM_RELAYS, filter as any, {
      onevent(e: NostrEvent) {
        if (e.kind === KIND_DVM_STATUS) return; // free-only: payment-required is just a miss
        if (acceptDvmResult(e, request.id)) {
          const detected = detectEventLanguage(event) || "und";
          finish({ text: e.content, from: detected, engine: "dvm" });
        }
      },
    });

    const timer = setTimeout(() => finish(null), DVM_TOTAL_TIMEOUT_MS);

    // Publish after the listener is armed so a fast DVM can't beat the sub.
    try {
      for (const p of pool.publish(TRANSLATE_DVM_RELAYS, request)) p.catch(() => {});
    } catch {
      finish(null);
    }
  });
}

// ── Engine 2.5: server translation proxy ────────────────────────────────────
/** NOT exported on purpose: only translateEventInner (public events) may use
 *  it — encrypted surfaces are limited to translateTextOnDevice, so private
 *  text can never reach the server. Auto-detects the source server-side. */
async function translateViaServer(text: string, to: string): Promise<TranslationResult | null> {
  const result = await withTimeout(
    (async () => {
      const r = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, target: to }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      if (typeof data?.text !== "string" || !data.text.trim()) return null;
      return { text: data.text, from: typeof data.from === "string" ? data.from.slice(0, 2) : "und", engine: "server" as const };
    })(),
    9_000,
  );
  return result;
}

// ── Orchestrator ────────────────────────────────────────────────────────────
/** "warming" = the on-device model is still downloading; Retry shortly. */
export type TranslateOutcome = TranslationResult | "warming" | null;

async function translateEventInner(event: NostrEvent, to: string): Promise<TranslateOutcome> {
  // Best source guess: script shortcut / statistical detector, refined by the
  // on-device LanguageDetector when Chrome has one (it beats both on short text).
  const guessed = scriptLanguageHint(event.content) || detectEventLanguage(event);
  const from = (await detectSourceOnDevice(event.content)) || guessed;

  let warming = false;
  if (from && from !== to && browserTranslatorSupported()) {
    const device = await translateOnDeviceDetailed(event.content, from, to);
    if (device.text) {
      const result: TranslationResult = { text: device.text, from, engine: "device" };
      putCachedTranslation(event.id, to, result);
      return result;
    }
    warming = device.warming;
  }

  // Server proxy — the lane that works in every browser. Its auto-detected
  // source beats our guess for the caption when it has one.
  const viaServer = await translateViaServer(event.content, to);
  if (viaServer) {
    if (viaServer.from === "und" && from) viaServer.from = from;
    putCachedTranslation(event.id, to, viaServer);
    return viaServer;
  }

  // Model downloading + no curated DVM to race: report "warming" immediately
  // instead of burning the open-broadcast timeout on a lane nobody serves.
  if (warming && CURATED_TRANSLATE_DVMS.length === 0) return "warming";

  const viaDvm = await translateViaDvm(event, to);
  if (viaDvm) {
    if (from) viaDvm.from = from; // keep the refined source for the caption
    putCachedTranslation(event.id, to, viaDvm);
    return viaDvm;
  }
  return warming ? "warming" : null;
}

/** Translate a PUBLIC event's content into `to`. Cache → on-device → DVM.
 *  Hard-capped at TRANSLATE_TOTAL_TIMEOUT_MS — this promise ALWAYS settles,
 *  so the UI can never hang in "Translating…". Null → "unavailable · Retry";
 *  "warming" → "Preparing translator · Retry". */
export async function translateEvent(event: NostrEvent, to: string = targetLanguage()): Promise<TranslateOutcome> {
  const cached = getCachedTranslation(event.id, to);
  if (cached) return cached;
  return withTimeout(translateEventInner(event, to), TRANSLATE_TOTAL_TIMEOUT_MS);
}
