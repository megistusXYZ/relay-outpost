import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  detectLanguage,
  detectForeignLanguage,
  languageAllowed,
  getPreferredLanguages,
  setPreferredLanguages,
  ensureLanguageDetector,
} from "./language";

// tinyld is loaded lazily via dynamic import — preload it before the sync tests.
beforeAll(async () => {
  await ensureLanguageDetector();
});

describe("detectLanguage", () => {
  it("separates same-script languages", () => {
    expect(detectLanguage("the quick brown fox jumps over the lazy dog today")).toBe("en");
    expect(detectLanguage("hola, esto es una prueba del idioma español de hoy")).toBe("es");
    expect(detectLanguage("bom dia, tudo bem com você hoje meu amigo querido")).toBe("pt");
  });
  it("detects non-latin scripts", () => {
    expect(detectLanguage("これは日本語のテストの文章です")).toBe("ja");
  });
  it("returns null for too-short / non-wordy content", () => {
    expect(detectLanguage("GM")).toBeNull();
    expect(detectLanguage("🔥🔥🔥")).toBeNull();
    expect(detectLanguage("https://example.com #nostr @bob")).toBeNull();
  });
});

describe("languageAllowed", () => {
  it("allows everything when no preference set", () => {
    expect(languageAllowed("これは日本語のテストの文章です", [])).toBe(true);
  });
  it("keeps preferred languages and drops others", () => {
    expect(languageAllowed("the quick brown fox jumps over the lazy dog", ["en"])).toBe(true);
    expect(languageAllowed("これは日本語のテストの文章です", ["en"])).toBe(false);
    expect(languageAllowed("hola, esto es una prueba del idioma", ["en", "es"])).toBe(true);
  });
  it("always keeps undetectable/short posts", () => {
    expect(languageAllowed("GM", ["en"])).toBe(true);
  });
});

describe("preferred languages storage", () => {
  // vitest runs in a node environment with no localStorage — provide a shim.
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  it("persists and normalizes to primary subtags", () => {
    setPreferredLanguages(["en-US", "es-ES", "en"]);
    expect(getPreferredLanguages()).toEqual(["en", "es"]);
  });
  it("falls back to a device default when unset", () => {
    const langs = getPreferredLanguages();
    expect(Array.isArray(langs)).toBe(true);
    expect(langs.length).toBeGreaterThan(0);
  });
});

describe("detectForeignLanguage — confidently foreign or nothing", () => {
  // The exact noise shapes observed in the field: English titles/prose that
  // tinyld's best guess mislabels (Norwegian, Romanian at accuracy 1.0, …).
  // None of these may earn a Translate link for an English reader.
  it("never flags English titles or prose for an English reader", () => {
    const english = [
      "Silhouettes and Sunsets by Joe Martin (Alone In Valentine)",
      "[LIVE] Project Zomboid Streamer: Commentary",
      "This post has % unverified and flagged participation.",
      "Paper Thin by Handled ( Frankie Payload )",
      "Summer River Flow Instrumental Tatar Soundtrack by Igor Marynowski",
      "M-Funded OpenAgents Pays Gamers and Everyday PCs in Bitcoin via Pylon Distributed AI Network",
      "God Of War TV series is recasting Kratos",
      "Just set up my first lightning node and the channel opened without any issues at all",
      "good morning everyone hope you have a wonderful day today",
    ];
    for (const text of english) {
      expect(detectForeignLanguage(text, ["en"]), text).toBeNull();
    }
  });

  it("still flags genuinely foreign prose for an English reader", () => {
    expect(detectForeignLanguage("Hoy es un buen día para aprender algo nuevo sobre el mundo", ["en"])).toBe("es");
    expect(detectForeignLanguage("Ich habe heute einen wunderbaren Spaziergang im Wald gemacht", ["en"])).toBe("de");
    expect(detectForeignLanguage("Il fait très beau aujourd hui et je suis très content de vous voir", ["en"])).toBe("fr");
    expect(detectForeignLanguage("Hoje é um bom dia para aprender algo novo sobre o mundo inteiro", ["en"])).toBe("pt");
    expect(detectForeignLanguage("Сегодня прекрасный день чтобы узнать что то новое о мире", ["en"])).toBe("ru");
    expect(detectForeignLanguage("これは日本語のテストの文章です", ["en"])).toBe("ja");
  });

  it("survives the German 'was' collision with the English stopword screen", () => {
    expect(
      detectForeignLanguage("Was für ein wunderschöner Tag heute ich bin sehr glücklich darüber", ["en"]),
    ).toBe("de");
  });

  it("flags English for a non-English reader", () => {
    expect(
      detectForeignLanguage("The mempool is clearing up nicely this weekend and fees are back down again", ["es"]),
    ).toBe("en");
  });

  it("returns null for user languages, empty prefs, and short text", () => {
    expect(detectForeignLanguage("Hoy es un buen día para aprender algo nuevo", ["es"])).toBeNull();
    expect(detectForeignLanguage("これは日本語のテストの文章です", [])).toBeNull();
    expect(detectForeignLanguage("GM", ["en"])).toBeNull();
  });
});
