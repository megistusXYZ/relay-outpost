/**
 * Impersonation guard — pure name-lookalike engine.
 *
 * Detects OUT-of-network accounts whose display name closely resembles someone
 * the user trusts (follows + strong/moderate GrapeRank tiers). Purely
 * informational: callers render a quiet chip, never hide or block content
 * (the app's never-auto-act moderation principle).
 *
 * Match rule (constants exported below):
 *   normalize(candidate) vs normalize(trusted) — exact after fold, or
 *   Levenshtein distance ≤ MAX_EDIT_DISTANCE (1) — against any trusted name
 *   of normalized length ≥ MIN_TRUSTED_NAME_LENGTH (4; shorter names like
 *   "ck" are too collision-prone). NIP-05 divergence (same-looking name,
 *   different or absent nip05) strengthens the reason but similarity alone
 *   suffices to flag.
 *
 * Hard exits:
 *   - candidate pubkey appears in the trusted set → null (never flag the real
 *     person, and never flag an account that is itself in-network).
 *   - empty/missing display name → null.
 */

export interface NameIdentity {
  pubkey: string;
  /** The preferred alias — what a verdict quotes back to the viewer. */
  displayName: string;
  /**
   * EVERY alias this identity publishes (display_name and name), when the caller
   * has them. Matching considers all of them; `displayName` is only what gets
   * shown. Optional so existing callers keep working — absent means "just the
   * one above".
   */
  displayNames?: string[];
  nip05?: string;
}

export interface ImpersonationVerdict {
  match: { pubkey: string; displayName: string };
  /** "exact-match" | "near-match", with "+nip05-divergent" appended when the
   *  lookalike's nip05 differs from (or is absent vs) the trusted account's. */
  reason: string;
}

/** Trusted names shorter than this (after normalization) are skipped. */
export const MIN_TRUSTED_NAME_LENGTH = 4;
/** Maximum normalized Levenshtein distance that still counts as a lookalike. */
export const MAX_EDIT_DISTANCE = 1;
/**
 * Distance-1 matches only apply when the SHORTER of the two normalized names
 * is at least this long. Below it, one edit spans ordinary distinct names —
 * the owner's report was "mar" pilled as "Resembles mark", and "marc"/"mark",
 * "joe"/"joel", "sam"/"sama" are all real-name pairs, not clones. Exact
 * normalized matches (homoglyph impersonation) still flag from
 * MIN_TRUSTED_NAME_LENGTH up.
 */
export const MIN_EDIT1_LENGTH = 5;

// Common confusable → Latin folds. Keys are the POST-lowercase forms (the
// normalizer lowercases first), values are ASCII lookalikes. Cyrillic block
// first, then Greek. Fullwidth forms are handled by NFKD, diacritics by
// stripping combining marks — neither needs a table entry.
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  "а": "a", // а
  "в": "b", // в
  "е": "e", // е
  "ё": "e", // ё
  "є": "e", // є
  "ѕ": "s", // ѕ
  "і": "i", // і
  "ї": "i", // ї
  "ј": "j", // ј
  "к": "k", // к
  "м": "m", // м
  "н": "h", // н
  "о": "o", // о
  "р": "p", // р
  "с": "c", // с
  "т": "t", // т
  "у": "y", // у
  "х": "x", // х
  "ѵ": "v", // ѵ
  "ԁ": "d", // ԁ
  "ԛ": "q", // ԛ
  "ԝ": "w", // ԝ
  // Greek
  "α": "a", // α
  "β": "b", // β
  "ε": "e", // ε
  "η": "n", // η
  "ι": "i", // ι
  "κ": "k", // κ
  "μ": "u", // μ
  "ν": "v", // ν
  "ο": "o", // ο
  "ρ": "p", // ρ
  "τ": "t", // τ
  "υ": "u", // υ
  "χ": "x", // χ
  "ω": "w", // ω
  // Latin oddballs
  "ı": "i", // ı dotless i
  "ł": "l", // ł
};

const HOMOGLYPH_RE = /[Ѐ-ԯͰ-Ͽıł]/g;
const ZERO_WIDTH_RE = /[​-‍⁠﻿]/g;
// Keep letters and digits only — drops spaces, punctuation, and the combining
// marks produced by NFKD decomposition (diacritic fold).
//
// It CANNOT be relied on to drop symbols, despite the obvious reading, which is
// what SYMBOL_RE below exists to fix.
const NON_ALNUM_RE = /[^\p{L}\p{N}]/gu;

/**
 * Symbols, stripped BEFORE NFKD. The order is the whole point.
 *
 * 920 Unicode symbols carry a compatibility decomposition into LETTERS or
 * DIGITS — "™" → "TM", "℠" → "SM", "№" → "No", "℡" → "TEL", "Ⓡ" → "R". Run NFKD
 * first and they are no longer symbols by the time NON_ALNUM_RE sees them: they
 * are letters, protected by \p{L}. So "CryptoCloaks™" folded to
 * "cryptocloakstm" and never matched "CryptoCloaks" — two edits apart, past the
 * distance threshold, skipped before comparison.
 *
 * That shipped, and it made the guard fail in the direction that matters most:
 * the engine folds Cyrillic "а"→"a" to defeat a deliberate attacker, then missed
 * a plain-ASCII impersonation of a trademarked brand because the VICTIM had
 * decorated their own name. It is also a live evasion in the other direction —
 * an attacker registering "Brand™" against a plain trusted "Brand" slipped past.
 *
 * "®" and "©" have NO decomposition and always matched correctly, which is why
 * the failure looked arbitrary and survived review.
 *
 * Scoped to \p{S} deliberately: a sweep of U+0020–U+2FFFF found every leaking
 * codepoint is category \p{S} and none are punctuation, so this is exactly
 * sufficient and exactly minimal. Widening it to \p{P} would be unearned. Note
 * this makes matching STRICTER — harder to evade — never looser.
 *
 * KNOWN RESIDUAL, needs a homoglyph entry rather than a category strip: modifier
 * letters like "Brandᵀᴹ" (U+1D40/U+1D39) are category \p{L}, survive this strip,
 * and still NFKD-expand to "TM".
 */
const SYMBOL_RE = /\p{S}/gu;

/**
 * Canonical comparison form of a display name:
 * strip symbols → NFKD (fullwidth → ASCII, é → e + combining mark) → lowercase
 * → strip zero-width chars → homoglyph fold → keep letters/digits only.
 */
export function normalizeName(raw: string): string {
  return raw
    .replace(SYMBOL_RE, "") // MUST precede NFKD — see SYMBOL_RE
    .normalize("NFKD")
    .toLowerCase()
    .replace(ZERO_WIDTH_RE, "")
    .replace(HOMOGLYPH_RE, (ch) => HOMOGLYPHS[ch] ?? ch)
    .replace(NON_ALNUM_RE, "");
}

/** True iff Levenshtein(a, b) ≤ 1. Specialized two-pointer check — no DP table. */
function withinEditDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  const diff = la - lb;
  if (diff > 1 || diff < -1) return false;
  if (diff === 0) {
    // exactly one substitution allowed
    let mismatches = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i] && ++mismatches > 1) return false;
    }
    return true;
  }
  // one insertion/deletion: walk the shorter against the longer, skip once
  const short = diff < 0 ? a : b;
  const long = diff < 0 ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      j++;
    }
  }
  return true;
}

interface PreparedTrusted {
  pubkeys: Set<string>;
  named: { pubkey: string; displayName: string; norm: string; nip05?: string }[];
  // Per-pubkey session verdict cache, invalidated when the candidate's
  // display name changes (profile metadata arriving late must not be stuck
  // behind a verdict computed for the npub fallback).
  verdicts: Map<string, { name: string; verdict: ImpersonationVerdict | null }>;
}

// Keyed by trusted-array identity: callers memoize/rebuild the trusted list,
// and every rebuild naturally starts a fresh normalization + verdict cache.
const preparedCache = new WeakMap<readonly NameIdentity[], PreparedTrusted>();

function prepare(trusted: readonly NameIdentity[]): PreparedTrusted {
  let prep = preparedCache.get(trusted);
  if (prep) return prep;
  const pubkeys = new Set<string>();
  const named: PreparedTrusted["named"] = [];
  for (const t of trusted) {
    pubkeys.add(t.pubkey);
    // EVERY name this identity publishes, not just the preferred one.
    //
    // A profile carries both `display_name` and `name`, and they often differ —
    // the real CryptoCloaks publishes display_name "CryptoCloaks™" AND name
    // "CryptoCloaks". Indexing only the preferred alias threw away a clean exact
    // match, and left the reverse attack open: copy the alias that is not being
    // indexed and the guard never fires.
    //
    // Deduped after normalization, so the common case where both aliases fold to
    // the same string costs nothing.
    const seen = new Set<string>();
    for (const raw of t.displayNames?.length ? t.displayNames : [t.displayName]) {
      if (!raw) continue;
      const norm = normalizeName(raw);
      if (norm.length < MIN_TRUSTED_NAME_LENGTH || seen.has(norm)) continue;
      seen.add(norm);
      named.push({ pubkey: t.pubkey, displayName: t.displayName || raw, norm, nip05: t.nip05 });
    }
  }
  prep = { pubkeys, named, verdicts: new Map() };
  preparedCache.set(trusted, prep);
  return prep;
}

function normalizeNip05(nip05: string | undefined): string {
  return (nip05 ?? "").trim().toLowerCase();
}

/**
 * Compare one candidate against the trusted set. Returns a verdict when the
 * candidate's name is a lookalike of a trusted name, else null. Verdicts are
 * cached per (trusted array, candidate pubkey, candidate name).
 */
export function checkImpersonation(
  candidate: { pubkey: string; displayName: string; nip05?: string },
  trusted: readonly NameIdentity[]
): ImpersonationVerdict | null {
  if (trusted.length === 0) return null;
  const prep = prepare(trusted);

  // Hard exit: in-network (which also covers "is the genuine account").
  if (prep.pubkeys.has(candidate.pubkey)) return null;

  const candNorm = normalizeName(candidate.displayName ?? "");
  if (!candNorm) return null;

  const cached = prep.verdicts.get(candidate.pubkey);
  if (cached && cached.name === candNorm) return cached.verdict;

  const candLen = candNorm.length;
  // Symmetric floor with the trusted side (prepare() skips short trusted
  // names): a candidate below it never flags at all.
  if (candLen < MIN_TRUSTED_NAME_LENGTH) {
    prep.verdicts.set(candidate.pubkey, { name: candNorm, verdict: null });
    return null;
  }
  let best: PreparedTrusted["named"][number] | null = null;
  let bestExact = false;
  for (const t of prep.named) {
    // Length-bounds pre-filter before any edit-distance work.
    const d = t.norm.length - candLen;
    if (d > MAX_EDIT_DISTANCE || d < -MAX_EDIT_DISTANCE) continue;
    if (t.norm === candNorm) {
      best = t;
      bestExact = true;
      break; // exact match wins outright
    }
    if (!best && Math.min(t.norm.length, candLen) >= MIN_EDIT1_LENGTH && withinEditDistance1(candNorm, t.norm)) {
      best = t; // keep scanning — a later exact match still takes precedence
    }
  }

  let verdict: ImpersonationVerdict | null = null;
  if (best) {
    const candNip = normalizeNip05(candidate.nip05);
    const trustedNip = normalizeNip05(best.nip05);
    const divergent = trustedNip !== "" && candNip !== trustedNip;
    verdict = {
      match: { pubkey: best.pubkey, displayName: best.displayName },
      reason: `${bestExact ? "exact-match" : "near-match"}${divergent ? "+nip05-divergent" : ""}`,
    };
  }
  prep.verdicts.set(candidate.pubkey, { name: candNorm, verdict });
  return verdict;
}
