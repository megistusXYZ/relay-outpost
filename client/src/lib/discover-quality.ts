/**
 * Stranger-quality floor for the global "For You" feed.
 *
 * Broadening the relay pool (see discover-relays.ts) makes the feed *alive* but
 * also lets in far more out-of-network strangers. This module is the pure,
 * testable decision for whether one OUT-OF-NETWORK post earns a slot — plus the
 * per-preset config that scales BOTH breadth (relay pool / sub caps / window)
 * and the stranger bar off the single Open / Balanced / Strict dial.
 *
 * In-network content (followed authors + positive-WoT authors) is NEVER gated
 * here — it always flows freely. The floor only ever removes cold posts from
 * brand-new, unknown, un-engaged strangers.
 *
 * Design: the preset is the one intuitive "how adventurous is my feed" knob.
 * Open = widest pool, folds every source, lenient stranger bar (near today).
 * Balanced (default) = wide pool, folds outbox + community, a real-but-fair bar.
 * Strict = network-centered pool, folds nothing extra, a high stranger bar.
 */
import type { StrictnessPreset } from "./trust-preset";

const SECONDS_PER_DAY = 24 * 60 * 60;

export interface DiscoverPresetConfig {
  /** Cap passed to getDiscoverFeedRelays — the size of the blended relay set. */
  relayPoolCap: number;
  /** Per-subscription relay cap (initial load, live tail, load-more). */
  subCap: number;
  /** Initial relay-fallback time window, in hours. */
  timeWindowH: number;
  /** Engagement score at/above which a stranger's post is admitted outright. */
  strangerEngagementFloor: number;
  /** First-seen age (days) beyond which a stranger counts as "established". */
  establishedAgeDays: number;
  /** Follower count at/above which a stranger counts as "established". */
  establishedMinFollowers: number;
  /**
   * NIP-13 proof-of-work (leading zero BITS of the event id) at/above which a
   * stranger's post is admitted on PoW alone. A per-post compute cost a
   * rotating throwaway-account spammer can't cheaply pay, so it's a durable
   * anti-spam signal even when every history-based axis (WoT / age / followers)
   * reads empty on a fresh key. These are BITS, not hex chars: 16 bits ≈ the
   * work to grind 4 leading zero hex digits.
   */
  minPow: number;
  /** Fold a capped slice of follows' outbox relays into the pool. */
  foldOutbox: boolean;
  /** Fold joined-community (outpost) relays into the pool. */
  foldCommunity: boolean;
}

/**
 * Preset → breadth + stranger-bar config. Thresholds spread wide so each step
 * visibly changes both how much content appears (breadth) and how strict the
 * stranger admission is. "custom" (hand-tuned raw knobs) maps to Balanced.
 */
export const DISCOVER_PRESET_CONFIG: Record<
  Exclude<StrictnessPreset, "custom">,
  DiscoverPresetConfig
> = {
  open: {
    relayPoolCap: 24,
    subCap: 24,
    timeWindowH: 12,
    strangerEngagementFloor: 1,
    establishedAgeDays: 3,
    establishedMinFollowers: 5,
    // ~12 bits: a modest "not free" bar — clearly ground, cheap enough that a
    // legit client that bothers to stamp PoW clears it, on the widest preset.
    minPow: 12,
    foldOutbox: true,
    foldCommunity: true,
  },
  balanced: {
    relayPoolCap: 18,
    subCap: 18,
    timeWindowH: 12,
    strangerEngagementFloor: 3,
    establishedAgeDays: 7,
    establishedMinFollowers: 15,
    // ~16 bits (≈4 leading zero hex digits): a real cost per post that grinds
    // in a fraction of a second for one honest post but taxes a burst-spammer.
    minPow: 16,
    foldOutbox: true,
    foldCommunity: true,
  },
  strict: {
    relayPoolCap: 10,
    subCap: 10,
    timeWindowH: 12,
    strangerEngagementFloor: 8,
    establishedAgeDays: 14,
    establishedMinFollowers: 40,
    // ~20 bits (5 leading zero hex digits): a high bar that still admits a
    // genuinely-mined post but demands meaningful, non-trivial work per event.
    minPow: 20,
    foldOutbox: false,
    foldCommunity: false,
  },
};

/** Resolve a preset (incl. "custom") to its breadth + stranger-bar config. */
export function getDiscoverPresetConfig(preset: StrictnessPreset): DiscoverPresetConfig {
  if (preset === "custom") return DISCOVER_PRESET_CONFIG.balanced;
  return DISCOVER_PRESET_CONFIG[preset];
}

export interface StrangerAdmitInput {
  /** In-network author (followed, self, or reposted by a follow) — always exempt. */
  isInNetwork: boolean;
  /** GrapeRank influence for the author. undefined = unscored. >0 = positive WoT. */
  wotScore: number | undefined;
  /** Engagement score for THIS event (computeEngagementScore). 0 when no stats. */
  engagementScore: number;
  /** Earliest-evidence timestamp (unix seconds) for the author, null = unknown. */
  firstSeen: number | null;
  /** Cached follower count for the author. undefined = unknown. */
  followerCount: number | undefined;
  /**
   * NIP-13 effective proof-of-work (leading zero BITS) for THIS event.
   * 0 when the post carries no PoW. See lib/nip13-pow.ts / effectivePow.
   */
  powDifficulty: number;
  /** Injected clock (unix seconds). */
  nowSeconds: number;
  config: DiscoverPresetConfig;
}

/**
 * Should this OUT-OF-NETWORK post be admitted to the global feed?
 *
 * Admit iff ANY earned signal is present:
 *   - the author is in-network (followed / self / reposted by a follow), OR
 *   - positive WoT (score > 0), OR
 *   - real engagement (score >= the preset floor), OR
 *   - meaningful NIP-13 proof-of-work (powDifficulty >= the preset minPow), OR
 *   - the author is "established": first-seen age > threshold OR followers >= threshold.
 *
 * PoW joins the OR-list as an ADDITIVE signal: it can only ADMIT a stranger who
 * would otherwise be dropped (real per-post compute the rotating spammer can't
 * pay), and never drops a stranger the other signals already admit. A cold,
 * zero-engagement, no-PoW post from a brand-new / unknown, unscored,
 * low-follower stranger has NO earned signal → drop. Unknown age (null) and
 * unknown follower count (undefined) simply don't count as established, so an
 * account we can't vouch for on any axis is exactly the one this floor removes.
 */
export function admitStranger(input: StrangerAdmitInput): boolean {
  const { isInNetwork, wotScore, engagementScore, powDifficulty, firstSeen, followerCount, nowSeconds, config } = input;

  // In-network content always flows freely.
  if (isInNetwork) return true;

  // Positive web-of-trust is an earned signal on its own.
  if (wotScore !== undefined && wotScore > 0) return true;

  // Real traction admits regardless of how new/unknown the author is.
  if (engagementScore >= config.strangerEngagementFloor) return true;

  // Meaningful proof-of-work is a per-post compute cost — an earned signal that
  // stands even on a fresh key with no history on any other axis.
  if (powDifficulty >= config.minPow) return true;

  // Established by age (older than the preset threshold).
  if (firstSeen !== null) {
    const ageDays = (nowSeconds - firstSeen) / SECONDS_PER_DAY;
    if (ageDays > config.establishedAgeDays) return true;
  }

  // Established by reach (enough followers).
  if (followerCount !== undefined && followerCount >= config.establishedMinFollowers) return true;

  // No earned signal on any axis → drop.
  return false;
}

// ---- Three-state profile gate for out-of-network authors --------------------
//
// Fresh spam accounts publish with NO kind-0 profile — a raw "npub1…" author
// row is a strong spam signal on discovery surfaces. But profiles load async:
// an account mid-load ALSO shows an npub for a beat, and those users must not
// be excluded. The whole feature is the difference between "no profile YET"
// (fetch in flight) and "no profile, PERIOD" (fetch settled, nothing found).

/**
 * Where profile resolution stands for an author:
 *  - "unknown": no kind-0 in the store and the fetch has NOT settled yet.
 *  - "named":   a kind-0 resolved with a non-empty name.
 *  - "unnamed": resolution completed — either a kind-0 with an empty name, or
 *               the fetch settled (EOSE everywhere / timeout) with no kind-0.
 */
export type ProfileResolution = "unknown" | "named" | "unnamed";

/**
 * The three-state decision:
 *  - "admit": show normally.
 *  - "grace": hold the post out of the visible feed (don't flash a raw-npub
 *             author card), re-evaluate when resolution completes.
 *  - "drop":  resolved with no usable profile — the spam case.
 */
export type ProfileGateDecision = "admit" | "grace" | "drop";

export interface ProfileGateInput {
  /** Followed / self / reposted-by-a-follow — the user's chosen network. */
  isInNetwork: boolean;
  /** GrapeRank influence. >0 = positive WoT — treated as in-network. */
  wotScore: number | undefined;
  resolution: ProfileResolution;
}

/**
 * Should this author's post show on a discovery surface, given profile state?
 *
 * In-network authors (followed, or positive WoT) are ALWAYS admitted — never
 * exclude people the user chose to follow, whatever their profile state.
 * Strangers: named → admit; unnamed (resolution COMPLETE, no usable profile)
 * → drop; unknown (still resolving) → grace, never a hard drop.
 *
 * Discover/stranger pipeline only (For You + the global media surfaces) — the
 * Following feed, threads, chats and profile pages never call this.
 */
export function gateStrangerProfile(input: ProfileGateInput): ProfileGateDecision {
  if (input.isInNetwork) return "admit";
  if (input.wotScore !== undefined && input.wotScore > 0) return "admit";
  switch (input.resolution) {
    case "named": return "admit";
    case "unnamed": return "drop";
    default: return "grace";
  }
}
