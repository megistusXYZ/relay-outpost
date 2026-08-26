import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Event as NostrEvent } from "nostr-tools";

// node env has no localStorage; the cache/settings read/write it synchronously.
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
});

import {
  buildTranslateRequestTags,
  isPaymentRequired,
  acceptDvmResult,
  getCachedTranslation,
  putCachedTranslation,
  recordManualTranslation,
  shouldOfferAlwaysTranslate,
  dismissAlwaysTranslate,
  getAutoTranslateLangs,
  addAutoTranslateLang,
  removeAutoTranslateLang,
  translationEnabled,
  targetLanguage,
  shouldOfferTranslation,
  scriptLanguageHint,
  translationCapable,
  CAPABILITY_KEY,
  TRANSLATION_ENABLED_KEY,
  KIND_DVM_TRANSLATE_RESULT,
  TRANSLATE_DVM_RELAYS,
} from "./translate";

beforeEach(() => __store.clear());

const ev = (over: Partial<NostrEvent> = {}): NostrEvent =>
  ({ id: "e".repeat(64), kind: 1, content: "hello", tags: [], pubkey: "a".repeat(64), created_at: 0, sig: "", ...over }) as NostrEvent;

describe("NIP-90 request tags — the interop wire format", () => {
  it("ships only the event ID (never raw text) + target language + result relays", () => {
    const tags = buildTranslateRequestTags("abc123", "wss://r.example", "es", []);
    expect(tags).toContainEqual(["i", "abc123", "event", "wss://r.example"]);
    expect(tags).toContainEqual(["param", "language", "es"]);
    expect(tags).toContainEqual(["relays", ...TRANSLATE_DVM_RELAYS]);
    expect(tags.some((t) => t[0] === "p")).toBe(false); // open broadcast: no p-tags
  });

  it("addresses curated DVMs with p-tags when a shortlist exists", () => {
    const tags = buildTranslateRequestTags("abc", "", "es", ["d".repeat(64)]);
    expect(tags).toContainEqual(["p", "d".repeat(64)]);
  });
});

describe("free-only DVM policy", () => {
  it("payment-required status is recognized (and will be treated as a miss)", () => {
    expect(isPaymentRequired(ev({ kind: 7000, tags: [["status", "payment-required"]] }))).toBe(true);
    expect(isPaymentRequired(ev({ kind: 7000, tags: [["status", "processing"]] }))).toBe(false);
  });
});

describe("acceptDvmResult — which kind-6002 answers count", () => {
  const req = "f".repeat(64);
  const good = () => ev({ kind: KIND_DVM_TRANSLATE_RESULT, content: "hola", tags: [["e", req]] });

  it("accepts a non-empty 6002 tagging our request (open broadcast)", () => {
    expect(acceptDvmResult(good(), req, [])).toBe(true);
  });

  it("rejects wrong kind, missing e-tag, and empty content", () => {
    expect(acceptDvmResult(ev({ kind: 6001, content: "x", tags: [["e", req]] }), req, [])).toBe(false);
    expect(acceptDvmResult(ev({ kind: KIND_DVM_TRANSLATE_RESULT, content: "x", tags: [] }), req, [])).toBe(false);
    expect(acceptDvmResult(ev({ kind: KIND_DVM_TRANSLATE_RESULT, content: "  ", tags: [["e", req]] }), req, [])).toBe(false);
  });

  it("with a curated list, only listed DVMs are accepted", () => {
    const curated = ["b".repeat(64)];
    expect(acceptDvmResult(good(), req, curated)).toBe(false); // pubkey a… not listed
    const fromCurated = { ...good(), pubkey: "b".repeat(64) };
    expect(acceptDvmResult(fromCurated, req, curated)).toBe(true);
  });
});

describe("translation cache — once per device, ever", () => {
  it("round-trips a result per (eventId, targetLang)", () => {
    putCachedTranslation("e1".padEnd(64, "0"), "en", { text: "hi", from: "ja", engine: "dvm" });
    expect(getCachedTranslation("e1".padEnd(64, "0"), "en")).toEqual({ text: "hi", from: "ja", engine: "dvm" });
    expect(getCachedTranslation("e1".padEnd(64, "0"), "es")).toBeNull(); // per-language
  });

  it("evicts oldest beyond the LRU cap", () => {
    // ids must differ within their first 16 chars — that's the cache key prefix
    for (let i = 0; i < 201; i++) {
      putCachedTranslation(String(i).padEnd(64, "x"), "en", { text: `t${i}`, from: "ja", engine: "dvm" });
    }
    expect(getCachedTranslation(String(0).padEnd(64, "x"), "en")).toBeNull(); // first evicted
    expect(getCachedTranslation(String(200).padEnd(64, "x"), "en")).not.toBeNull();
  });
});

describe("earned 'always translate' — auto mode is opt-in via demonstrated use", () => {
  it("offers the upgrade only after 3 manual translations of that language", () => {
    recordManualTranslation("ja");
    recordManualTranslation("ja");
    expect(shouldOfferAlwaysTranslate("ja")).toBe(false);
    recordManualTranslation("ja");
    expect(shouldOfferAlwaysTranslate("ja")).toBe(true);
    expect(shouldOfferAlwaysTranslate("es")).toBe(false); // per-language counters
  });

  it("never re-offers after dismissal or opt-in", () => {
    for (let i = 0; i < 3; i++) recordManualTranslation("ja");
    dismissAlwaysTranslate("ja");
    expect(shouldOfferAlwaysTranslate("ja")).toBe(false);

    for (let i = 0; i < 3; i++) recordManualTranslation("es");
    addAutoTranslateLang("es");
    expect(shouldOfferAlwaysTranslate("es")).toBe(false);
  });

  it("auto-language list adds, dedupes, and removes", () => {
    addAutoTranslateLang("ja");
    addAutoTranslateLang("ja");
    expect(getAutoTranslateLangs()).toEqual(["ja"]);
    removeAutoTranslateLang("ja");
    expect(getAutoTranslateLangs()).toEqual([]);
  });
});

describe("settings surface", () => {
  it("translation is ON by default; only the literal 'false' disables", () => {
    expect(translationEnabled()).toBe(true);
    localStorage.setItem(TRANSLATION_ENABLED_KEY, "false");
    expect(translationEnabled()).toBe(false);
  });

  it("target language falls back to en when no preference exists (node env)", () => {
    expect(targetLanguage()).toBe("en");
  });

  it("no affordance when the master switch is off", () => {
    localStorage.setItem(TRANSLATION_ENABLED_KEY, "false");
    expect(shouldOfferTranslation(ev({ content: "こんにちは、世界。今日はいい天気ですね。" }))).toBeNull();
  });

  it("no affordance when the language is undetectable (short/unknown text)", () => {
    localStorage.setItem(CAPABILITY_KEY, JSON.stringify({ ok: true, at: Date.now() }));
    expect(shouldOfferTranslation(ev({ content: "gm" }))).toBeNull();
  });
});

describe("capability gate — never show a Translate link that can't deliver", () => {
  it("fails closed: no offer at all without a proven-capable verdict", () => {
    // Node has no Translator API and no probe has passed → even an obviously
    // foreign post gets no link. (This is the zombie-bindings protection.)
    expect(translationCapable()).toBe(false);
    expect(shouldOfferTranslation(ev({ content: "修復魔法(意味深)" }))).toBeNull();
  });

  it("a fresh stored probe verdict opens the gate; a stale one doesn't", () => {
    localStorage.setItem(CAPABILITY_KEY, JSON.stringify({ ok: true, at: Date.now() }));
    expect(translationCapable()).toBe(true);
    localStorage.setItem(CAPABILITY_KEY, JSON.stringify({ ok: true, at: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    expect(translationCapable()).toBe(false); // >7d old → re-prove
  });
});

const seedCapable = () =>
  localStorage.setItem(CAPABILITY_KEY, JSON.stringify({ ok: true, at: Date.now() }));

describe("script-based offer gating — short posts", () => {
  beforeEach(seedCapable);
  it("short CJK posts ARE offered: the script itself identifies the language", () => {
    // "修復魔法(意味深)" — 9 chars, under the statistical-detector floor, but
    // unmistakably foreign to a Latin-language reader.
    expect(shouldOfferTranslation(ev({ content: "修復魔法(意味深)" }))).toBe("zh");
    expect(shouldOfferTranslation(ev({ content: "おはようございます" }))).toBe("ja"); // kana → ja
    expect(shouldOfferTranslation(ev({ content: "안녕하세요 여러분" }))).toBe("ko"); // hangul → ko
  });

  it("kana beats han for mixed Japanese text", () => {
    expect(scriptLanguageHint("修復の魔法です")).toBe("ja");
  });

  it("Latin script gives no hint — those posts need the statistical detector", () => {
    expect(scriptLanguageHint("spearfishing barracuda")).toBeNull();
    // …and short Latin text never earns an offer (detector too unreliable there).
    expect(shouldOfferTranslation(ev({ content: "spearfishing barracuda 🌴" }))).toBeNull();
  });
});
