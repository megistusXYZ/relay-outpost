import { describe, it, expect } from "vitest";
import {
  checkImpersonation,
  normalizeName,
  MIN_TRUSTED_NAME_LENGTH,
  MAX_EDIT_DISTANCE,
  type NameIdentity,
} from "./impersonation-check";

// Distinct hex-ish pubkeys — the engine only compares them by equality.
const PK_REAL = "aa".repeat(32);
const PK_FAKE = "bb".repeat(32);
const PK_OTHER = "cc".repeat(32);
const PK_ME = "dd".repeat(32);

function trustedSet(overrides: Partial<NameIdentity> = {}): NameIdentity[] {
  return [
    { pubkey: PK_REAL, displayName: "Jack Dorsey", nip05: "jack@cash.app", ...overrides },
  ];
}

describe("normalizeName", () => {
  it("lowercases and strips spaces/punctuation", () => {
    expect(normalizeName("Jack Dorsey")).toBe("jackdorsey");
    expect(normalizeName("jack.dorsey_!")).toBe("jackdorsey");
  });

  it("folds common Cyrillic homoglyphs to Latin", () => {
    // а е о р с ѕ і are Cyrillic lookalikes here
    expect(normalizeName("Jаck")).toBe("jack"); // Cyrillic а
    expect(normalizeName("Dоrsеy")).toBe("dorsey"); // Cyrillic о and е
    expect(normalizeName("ѕіmple")).toBe("simple"); // Cyrillic ѕ і
    expect(normalizeName("рс")).toBe("pc"); // Cyrillic р с
  });

  it("folds Greek homoglyphs to Latin", () => {
    expect(normalizeName("Jαck")).toBe("jack"); // Greek α
    expect(normalizeName("Dοrsey")).toBe("dorsey"); // Greek ο
  });

  it("folds fullwidth forms to ASCII", () => {
    expect(normalizeName("Ｊａｃｋ")).toBe("jack"); // Ｊａｃｋ
  });

  it("strips zero-width characters", () => {
    expect(normalizeName("Ja\u200Bck")).toBe("jack");
    expect(normalizeName("Ja\u200Cck")).toBe("jack");
    expect(normalizeName("Ja\u200Dck")).toBe("jack");
    expect(normalizeName("\uFEFFJack")).toBe("jack");
  });

  it("folds diacritics via decomposition", () => {
    expect(normalizeName("Jáck")).toBe("jack"); // á
  });
});

describe("checkImpersonation — match rule", () => {
  it("flags an exact match after normalization from a different pubkey", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "jackdorsey", nip05: "jack@scam.example" },
      trustedSet()
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.match.pubkey).toBe(PK_REAL);
    expect(verdict!.match.displayName).toBe("Jack Dorsey");
    expect(verdict!.reason).toContain("exact-match");
  });

  it("flags a homoglyph lookalike (Cyrillic а) as exact after fold", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jаck Dorsey" },
      trustedSet()
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.reason).toContain("exact-match");
  });

  it("flags a zero-width-injected lookalike", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jack\u200B Dorsey" },
      trustedSet()
    );
    expect(verdict).not.toBeNull();
  });

  it("flags names within Levenshtein distance 1 (insertion)", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jack Dorssey" },
      trustedSet()
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.reason).toContain("near-match");
  });

  it("flags names within Levenshtein distance 1 (deletion)", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jak Dorsey" },
      trustedSet()
    );
    expect(verdict).not.toBeNull();
  });

  it("flags names within Levenshtein distance 1 (substitution)", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jock Dorsey" },
      trustedSet()
    );
    expect(verdict).not.toBeNull();
  });

  it("does NOT flag names at distance 2", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jck Dorsy" },
      trustedSet()
    );
    expect(verdict).toBeNull();
  });

  it("does NOT flag clearly different names", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Satoshi Nakamoto" },
      trustedSet()
    );
    expect(verdict).toBeNull();
  });

  it("still flags when the nip05 is identical (similarity alone suffices)", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jack Dorsey", nip05: "jack@cash.app" },
      trustedSet()
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.reason).not.toContain("nip05-divergent");
  });

  it("marks nip05 divergence when the candidate's nip05 differs", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jack Dorsey", nip05: "jack@evil.example" },
      trustedSet()
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.reason).toContain("nip05-divergent");
  });

  it("marks nip05 divergence when the candidate has no nip05 but the trusted account does", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jack Dorsey" },
      trustedSet()
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.reason).toContain("nip05-divergent");
  });

  it("does not mark divergence when neither side has a nip05", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jack Dorsey" },
      [{ pubkey: PK_REAL, displayName: "Jack Dorsey" }]
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.reason).not.toContain("nip05-divergent");
  });
});

describe("checkImpersonation — hard exits", () => {
  it("never flags the genuine account (candidate pubkey === trusted pubkey)", () => {
    const verdict = checkImpersonation(
      { pubkey: PK_REAL, displayName: "Jack Dorsey", nip05: "jack@cash.app" },
      trustedSet()
    );
    expect(verdict).toBeNull();
  });

  it("never flags a candidate that is itself in the trusted set (in-network exit)", () => {
    const trusted: NameIdentity[] = [
      { pubkey: PK_REAL, displayName: "Jack Dorsey" },
      // The candidate is in-network under a lookalike name — still exempt.
      { pubkey: PK_FAKE, displayName: "Jack Dorse" },
    ];
    const verdict = checkImpersonation(
      { pubkey: PK_FAKE, displayName: "Jack Dorse" },
      trusted
    );
    expect(verdict).toBeNull();
  });

  it("returns null for a missing/empty display name", () => {
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "" }, trustedSet())).toBeNull();
    expect(
      checkImpersonation({ pubkey: PK_FAKE, displayName: "\u200B \u200C" }, trustedSet())
    ).toBeNull();
  });

  it("returns null for an empty trusted set", () => {
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "Jack Dorsey" }, [])).toBeNull();
  });
});

describe("checkImpersonation — short-name collision guard", () => {
  it(`skips trusted names shorter than ${MIN_TRUSTED_NAME_LENGTH} normalized chars`, () => {
    const trusted: NameIdentity[] = [{ pubkey: PK_REAL, displayName: "ck" }];
    // Exact same short name — still not flagged, too collision-prone.
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "ck" }, trusted)).toBeNull();
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "cka" }, trusted)).toBeNull();
  });

  it("still matches names at exactly the minimum length", () => {
    const trusted: NameIdentity[] = [{ pubkey: PK_REAL, displayName: "fiatjaf".slice(0, 4) }]; // "fiat"
    expect(
      checkImpersonation({ pubkey: PK_FAKE, displayName: "fiat" }, trusted)
    ).not.toBeNull();
  });
});

describe("checkImpersonation — short CANDIDATE names (owner report: 'mar' flagged as 'Resembles mark')", () => {
  it("a 3-char candidate never flags, even one edit from a trusted name", () => {
    const trusted: NameIdentity[] = [{ pubkey: PK_REAL, displayName: "mark" }];
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "mar" }, trusted)).toBeNull();
  });

  it("short handles that prefix a trusted name are ordinary names, not lookalikes", () => {
    const trusted: NameIdentity[] = [{ pubkey: PK_REAL, displayName: "sama" }];
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "sam" }, trusted)).toBeNull();
  });

  it("distance-1 needs the SHORTER side at 5+ chars — 'marc' vs 'mark' is two real names", () => {
    const trusted: NameIdentity[] = [{ pubkey: PK_REAL, displayName: "mark" }];
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "marc" }, trusted)).toBeNull();
  });

  it("distance-1 still flags at 5+ chars ('primaal' aping 'primal')", () => {
    const trusted: NameIdentity[] = [{ pubkey: PK_REAL, displayName: "primal" }];
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "primaal" }, trusted)).not.toBeNull();
  });

  it("an exact homoglyph clone of a 4-char name still flags (m\u0430rk with Cyrillic a)", () => {
    const trusted: NameIdentity[] = [{ pubkey: PK_REAL, displayName: "mark" }];
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "m\u0430rk" }, trusted)).not.toBeNull();
  });
});

describe("checkImpersonation — length-bounds pre-filter", () => {
  it("does not flag names whose lengths differ by more than the edit budget", () => {
    const trusted: NameIdentity[] = [{ pubkey: PK_REAL, displayName: "Alexander" }];
    expect(checkImpersonation({ pubkey: PK_FAKE, displayName: "Alex" }, trusted)).toBeNull();
  });

  it(`edit budget constant is ${MAX_EDIT_DISTANCE}`, () => {
    expect(MAX_EDIT_DISTANCE).toBe(1);
    expect(MIN_TRUSTED_NAME_LENGTH).toBe(4);
  });
});

describe("checkImpersonation — verdict cache", () => {
  it("returns a stable verdict for repeat calls with the same trusted array", () => {
    const trusted = trustedSet();
    const a = checkImpersonation({ pubkey: PK_FAKE, displayName: "Jack Dorsey" }, trusted);
    const b = checkImpersonation({ pubkey: PK_FAKE, displayName: "Jack Dorsey" }, trusted);
    expect(a).not.toBeNull();
    expect(b).toBe(a); // cached object identity
  });

  it("recomputes when the candidate's display name changes (profile metadata arrived)", () => {
    const trusted = trustedSet();
    const before = checkImpersonation({ pubkey: PK_OTHER, displayName: "npub1qq...xyz" }, trusted);
    expect(before).toBeNull();
    const after = checkImpersonation({ pubkey: PK_OTHER, displayName: "Jack Dorsey" }, trusted);
    expect(after).not.toBeNull();
  });

  it("recomputes against a rebuilt trusted array", () => {
    const first = checkImpersonation(
      { pubkey: PK_ME, displayName: "Jack Dorsey" },
      [{ pubkey: PK_REAL, displayName: "Someone Else" }]
    );
    expect(first).toBeNull();
    const second = checkImpersonation(
      { pubkey: PK_ME, displayName: "Jack Dorsey" },
      [{ pubkey: PK_REAL, displayName: "Jack Dorsey" }]
    );
    expect(second).not.toBeNull();
  });
});

describe("normalizeName — symbols that NFKD turns into letters", () => {
  // The bug this file shipped with. normalizeName ran NFKD FIRST, and ™ has a
  // compatibility decomposition to the two ASCII letters "TM" — so by the time
  // the keep-letters-and-digits filter ran, the ™ was no longer a symbol it
  // could drop. "CryptoCloaks™" folded to "cryptocloakstm", two edits from
  // "cryptocloaks", past the distance threshold, skipped before comparison.
  //
  // Measured, not assumed: "™".normalize("NFKD") === "TM".
  it.each([
    ["CryptoCloaks™", "cryptocloaks", "™ → TM"],
    ["Brand℠", "brand", "℠ → SM"],
    ["No№", "no", "№ → No"],
    ["Call℡", "call", "℡ → TEL"],
    ["MarkⓇ", "mark", "Ⓡ → R"],
  ])("folds %s to %s (%s)", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it("leaves ® and © alone — they have no decomposition and always worked", () => {
    // Kept as controls. These matched correctly before the fix, which is exactly
    // why the failure looked arbitrary and survived review.
    expect(normalizeName("CryptoCloaks®")).toBe("cryptocloaks");
    expect(normalizeName("CryptoCloaks©")).toBe("cryptocloaks");
  });

  it("does not fold away real letters that merely look like a decorator", () => {
    // The strip must not become "delete anything TM-ish". These are ordinary
    // names and must survive intact, or the guard starts firing on strangers.
    expect(normalizeName("TMobile")).toBe("tmobile");
    expect(normalizeName("ATM Machine")).toBe("atmmachine");
  });

  it("keeps every pre-existing fold working", () => {
    expect(normalizeName("José")).toBe("jose");
    expect(normalizeName("Ｊａｃｋ")).toBe("jack");
    expect(normalizeName("jack.dorsey_!")).toBe("jackdorsey");
  });
});

describe("checkImpersonation — the live case, end to end", () => {
  const IMPOSTER = "b4".repeat(32);
  const REAL = "f8".repeat(32);

  it("flags a plain copy of a ™-decorated trusted name", () => {
    // Exactly what was on screen: an admission row for a fresh key named
    // "CryptoCloaks", against a followed account named "CryptoCloaks™". Before
    // the fix this returned null and the row showed no warning at all.
    const verdict = checkImpersonation(
      { pubkey: IMPOSTER, displayName: "CryptoCloaks" },
      [{ pubkey: REAL, displayName: "CryptoCloaks™", nip05: "cryptocloaks@primal.net" }],
    );
    expect(verdict).not.toBeNull();
    expect(verdict!.match.pubkey).toBe(REAL);
    expect(verdict!.reason).toBe("exact-match+nip05-divergent");
  });

  it("flags the REVERSE too — decorating your own name is not an escape hatch", () => {
    // The evasion the same defect enabled: register "Brand™" against a plain
    // trusted "Brand" and the guard used to stay silent.
    const verdict = checkImpersonation(
      { pubkey: IMPOSTER, displayName: "CryptoCloaks™" },
      [{ pubkey: REAL, displayName: "CryptoCloaks" }],
    );
    expect(verdict?.reason).toBe("exact-match");
  });

  it("matches a SECONDARY alias, not just the preferred one", () => {
    // The real account publishes display_name "CryptoCloaks™" AND name
    // "CryptoCloaks". Indexing only the preferred alias threw away a clean exact
    // match — and left the reverse open: copy the alias nobody indexed.
    const verdict = checkImpersonation(
      { pubkey: IMPOSTER, displayName: "Cryptocloaks" },
      [{ pubkey: REAL, displayName: "Totally Different", displayNames: ["Totally Different", "CryptoCloaks"] }],
    );
    expect(verdict?.match.pubkey).toBe(REAL);
  });

  it("still says nothing about someone with no resemblance", () => {
    expect(checkImpersonation(
      { pubkey: IMPOSTER, displayName: "Quiet Bystander" },
      [{ pubkey: REAL, displayName: "CryptoCloaks™" }],
    )).toBeNull();
  });
});
